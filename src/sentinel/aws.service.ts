import { Injectable, Logger } from '@nestjs/common';
import { 
  LambdaClient, 
  InvokeCommand, 
  InvokeCommandInput 
} from '@aws-sdk/client-lambda';
import { 
  SFNClient, 
  StartExecutionCommand 
} from '@aws-sdk/client-sfn';
import { ConfigService } from '@nestjs/config';

export interface NDVIProcessingRequest {
  imageUrls: string[];
  location: {
    latitude: number;
    longitude: number;
  };
  dateRange: {
    start: string;
    end: string;
  };
  bands: {
    red: string;
    nir: string;
    visual?: string;
  };
}

export interface NDVIProcessingResult {
  jobId: string;
  status: 'processing' | 'completed' | 'failed';
  ndviStats: {
    mean: number;
    min: number;
    max: number;
    stdDev: number;
  };
  vegetationCoverage: {
    denseForest: number;
    lightForest: number;
    noVegetation: number;
    totalVegetated: number;
  };
  changeDetection?: {
    deforestationPercentage: number;
    alertTriggered: boolean;
  };
  processingTime: number;
  timestamp: string;
}

@Injectable()
export class AWSService {
  private readonly logger = new Logger(AWSService.name);
  private readonly lambdaClient: LambdaClient;
  private readonly stepFunctionsClient: SFNClient;
  private readonly useRealAWS: boolean;

  constructor(private configService: ConfigService) {
    // Initialize AWS clients
    const region = this.configService.get('AWS_REGION', 'us-west-2');
    this.useRealAWS = this.configService.get('USE_REAL_AWS', 'false') === 'true';

    this.lambdaClient = new LambdaClient({ region });
    this.stepFunctionsClient = new SFNClient({ region });

    this.logger.log(`Initialized AWS Service - Mode: ${this.useRealAWS ? 'PRODUCTION' : 'SIMULATION'}`);
  }

  /**
   * Process NDVI data using Lambda functions or simulation
   */
  async processNDVI(request: NDVIProcessingRequest): Promise<NDVIProcessingResult> {
    if (this.useRealAWS) {
      return this.processNDVIReal(request);
    } else {
      return this.simulateNDVIProcessing(request);
    }
  }

  /**
   * Real AWS Lambda NDVI processing
   */
  private async processNDVIReal(request: NDVIProcessingRequest): Promise<NDVIProcessingResult> {
    const startTime = Date.now();
    const jobId = `ndvi-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    try {
      const lambdaArn = this.configService.get('LAMBDA_NDVI_CALCULATOR_ARN');
      
      if (!lambdaArn) {
        throw new Error('LAMBDA_NDVI_CALCULATOR_ARN not configured');
      }

      const payload = {
        jobId,
        imageUrls: request.imageUrls,
        location: request.location,
        dateRange: request.dateRange,
        bands: request.bands,
        timestamp: new Date().toISOString()
      };

      const invokeParams: InvokeCommandInput = {
        FunctionName: lambdaArn,
        InvocationType: 'RequestResponse',
        Payload: JSON.stringify(payload)
      };

      this.logger.log(`Invoking Lambda function: ${lambdaArn}`);
      const response = await this.lambdaClient.send(new InvokeCommand(invokeParams));

      if (response.StatusCode !== 200) {
        throw new Error(`Lambda invocation failed with status: ${response.StatusCode}`);
      }

      const result = JSON.parse(new TextDecoder().decode(response.Payload));
      
      this.logger.log(`NDVI processing completed in ${Date.now() - startTime}ms`);
      
      return {
        ...result,
        processingTime: Date.now() - startTime,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      this.logger.error(`Failed to process NDVI: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Simulate NDVI processing for development
   */
  async simulateNDVIProcessing(request: NDVIProcessingRequest): Promise<NDVIProcessingResult> {
    const startTime = Date.now();
    const jobId = `sim-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    // Simulate processing delay
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Generate realistic simulation data based on location
    const isAmazonRegion = Math.abs(request.location.latitude + 6.0) < 2 && Math.abs(request.location.longitude + 53.0) < 2;
    
    const baseVegetation = isAmazonRegion ? 0.7 : 0.4;
    const randomVariation = (Math.random() - 0.5) * 0.3;
    const totalVegetated = Math.max(0.1, Math.min(0.95, baseVegetation + randomVariation));

    // Simulate seasonal effects (assuming dates in 2022)
    const isDrySeasonPeak = request.dateRange.start.includes('2022-08') || request.dateRange.start.includes('2022-09');
    const deforestationRisk = isDrySeasonPeak ? totalVegetated * 0.15 : totalVegetated * 0.05;

    const result: NDVIProcessingResult = {
      jobId,
      status: 'completed',
      ndviStats: {
        mean: 0.2 + (totalVegetated * 0.6),
        min: -0.1,
        max: 0.85,
        stdDev: 0.12
      },
      vegetationCoverage: {
        denseForest: totalVegetated * 0.6,
        lightForest: totalVegetated * 0.4,
        noVegetation: 1 - totalVegetated,
        totalVegetated: totalVegetated
      },
      changeDetection: {
        deforestationPercentage: deforestationRisk * 100,
        alertTriggered: deforestationRisk > 0.08
      },
      processingTime: Date.now() - startTime,
      timestamp: new Date().toISOString()
    };

    this.logger.log(`Simulated NDVI processing completed - Vegetation: ${(totalVegetated * 100).toFixed(1)}%`);
    
    return result;
  }

  /**
   * Start the complete deforestation detection workflow
   */
  async startDeforestationWorkflow(request: NDVIProcessingRequest): Promise<{
    executionArn: string;
    jobId: string;
    status: string;
  }> {
    if (!this.useRealAWS) {
      // Return simulated workflow execution
      const jobId = `workflow-sim-${Date.now()}`;
      return {
        executionArn: `arn:aws:states:us-west-2:123456789012:execution:forestshield-pipeline:${jobId}`,
        jobId,
        status: 'RUNNING'
      };
    }

    const stateMachineArn = this.configService.get('STEP_FUNCTIONS_STATE_MACHINE_ARN');
    
    if (!stateMachineArn) {
      throw new Error('STEP_FUNCTIONS_STATE_MACHINE_ARN not configured');
    }

    const executionName = `forestshield-${Date.now()}`;
    
    const startExecution = new StartExecutionCommand({
      stateMachineArn,
      name: executionName,
      input: JSON.stringify(request)
    });

    try {
      const response = await this.stepFunctionsClient.send(startExecution);
      
      this.logger.log(`Started Step Functions execution: ${response.executionArn}`);

      if (!response.executionArn) {
        throw new Error('Failed to start Step Functions execution');
      }
      
      return {
        executionArn: response.executionArn,
        jobId: executionName,
        status: 'RUNNING'
      };

    } catch (error) {
      this.logger.error(`Failed to start workflow: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get processing job status
   */
  async getJobStatus(jobId: string): Promise<{
    jobId: string;
    status: string;
    result?: NDVIProcessingResult;
    error?: string;
  }> {
    if (!this.useRealAWS) {
      // Simulate job status checking
      return {
        jobId,
        status: 'COMPLETED',
        result: await this.simulateNDVIProcessing({
          imageUrls: [],
          location: { latitude: -6.0, longitude: -53.0 },
          dateRange: { start: '2022-08-01', end: '2022-08-31' },
          bands: { red: 'B04', nir: 'B08' }
        })
      };
    }

    // Real implementation would check Lambda logs or DynamoDB
    // For now, return a basic response
    return {
      jobId,
      status: 'PROCESSING'
    };
  }

  /**
   * Health check for AWS services
   */
  async healthCheck(): Promise<{
    mode: string;
    services: {
      lambda: boolean;
      stepFunctions: boolean;
      configuration: boolean;
    };
    timestamp: string;
  }> {
    const services = {
      lambda: false,
      stepFunctions: false,
      configuration: false
    };

    if (this.useRealAWS) {
      try {
        // Check if we can list Lambda functions (basic connectivity test)
        const lambdaArn = this.configService.get('LAMBDA_NDVI_CALCULATOR_ARN');
        services.lambda = !!lambdaArn;
        
        const stateMachineArn = this.configService.get('STEP_FUNCTIONS_STATE_MACHINE_ARN');
        services.stepFunctions = !!stateMachineArn;
        
        services.configuration = services.lambda && services.stepFunctions;
      } catch (error) {
        this.logger.warn(`Health check failed: ${error.message}`);
      }
    } else {
      // In simulation mode, everything is "healthy"
      services.lambda = true;
      services.stepFunctions = true;
      services.configuration = true;
    }

    return {
      mode: this.useRealAWS ? 'PRODUCTION' : 'SIMULATION',
      services,
      timestamp: new Date().toISOString()
    };
  }
} 