import { Injectable, Logger } from '@nestjs/common';
import { LambdaClient, ListFunctionsCommand, GetFunctionCommand } from '@aws-sdk/client-lambda';
import { ConfigService } from '@nestjs/config';

export interface LambdaFunction {
  name: string;
  description: string;
  runtime: string;
  handler: string;
  code: string;
}

export interface NDVIProcessingRequest {
  imageId: string;
  redBandUrl: string;
  nirBandUrl: string;
  outputBucket: string;
  region: {
    latitude: number;
    longitude: number;
  };
}

@Injectable()
export class AWSLambdaService {
  private readonly logger = new Logger(AWSLambdaService.name);
  private readonly lambdaClient: LambdaClient;

  constructor(private readonly configService: ConfigService) {
    const region = this.configService.get('AWS_REGION', 'us-west-2');
    this.lambdaClient = new LambdaClient({ region });
    this.logger.log('AWS Lambda Service initialized for serverless processing');
  }

  async getLambdaFunctions() {
    this.logger.log('Fetching real Lambda functions from AWS');
    
    try {
      const command = new ListFunctionsCommand({});
      const response = await this.lambdaClient.send(command);
      
      if (!response.Functions) {
        throw new Error('No Lambda functions found');
      }

      // Filter for ForestShield functions
      const forestShieldFunctions = response.Functions.filter(func => 
        func.FunctionName?.includes('forestshield')
      );

      const functionDetails = await Promise.all(
        forestShieldFunctions.map(async (func) => {
          try {
            const detailCommand = new GetFunctionCommand({ FunctionName: func.FunctionName });
            const detail = await this.lambdaClient.send(detailCommand);
            
            return {
              name: func.FunctionName || 'unknown',
              description: func.Description || 'No description',
              runtime: func.Runtime || 'unknown',
              handler: func.Handler || 'unknown',
              memory: func.MemorySize || 0,
              timeout: func.Timeout || 0,
              lastModified: func.LastModified || '',
              codeSize: func.CodeSize || 0,
              environment: detail.Configuration?.Environment?.Variables || {},
              role: func.Role || ''
            };
          } catch (error) {
            this.logger.warn(`Failed to get details for function ${func.FunctionName}:`, error);
            return {
              name: func.FunctionName || 'unknown',
              description: func.Description || 'No description',
              runtime: func.Runtime || 'unknown',
              handler: func.Handler || 'unknown',
              memory: func.MemorySize || 0,
              timeout: func.Timeout || 0,
              lastModified: func.LastModified || '',
              codeSize: func.CodeSize || 0,
              environment: {},
              role: func.Role || '',
              error: 'Failed to fetch detailed configuration'
            };
          }
        })
      );

      return {
        functions: functionDetails,
        totalCount: forestShieldFunctions.length,
        lastUpdated: new Date()
      };
    } catch (error) {
      this.logger.error('Failed to fetch Lambda functions:', error);
      throw new Error(`AWS Lambda API unavailable: ${error.message}`);
    }
  }




} 