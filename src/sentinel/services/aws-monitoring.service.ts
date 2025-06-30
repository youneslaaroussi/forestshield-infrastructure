import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { 
  CloudWatchClient, 
  GetMetricStatisticsCommand, 
  GetMetricDataCommand,
  DescribeAlarmsCommand,
  MetricDataQuery,
  MetricStat
} from '@aws-sdk/client-cloudwatch';
import {
  CloudWatchLogsClient,
  DescribeLogGroupsCommand,
  FilterLogEventsCommand,
  StartQueryCommand,
  GetQueryResultsCommand
} from '@aws-sdk/client-cloudwatch-logs';
import {
  CostExplorerClient,
  GetCostAndUsageCommand,
  GetUsageForecastCommand,
  GetCostCategoriesCommand
} from '@aws-sdk/client-cost-explorer';
import {
  LambdaClient,
  ListFunctionsCommand,
  GetFunctionCommand,
  GetAccountSettingsCommand
} from '@aws-sdk/client-lambda';
import {
  SFNClient,
  ListExecutionsCommand,
  DescribeExecutionCommand,
  GetExecutionHistoryCommand
} from '@aws-sdk/client-sfn';

export interface AWSServiceMetrics {
  id: string;
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  icon: string;
  metrics: {
    invocations: number;
    errors: number;
    duration: number;
    memory: number;
    storage: number;
    cost: number;
  };
  lastUpdated: Date;
}

export interface CloudWatchLog {
  id: string;
  timestamp: Date;
  level: 'INFO' | 'WARN' | 'ERROR';
  message: string;
  logGroup: string;
  logStream: string;
}

export interface CostData {
  dailyCosts: { date: string; amount: number }[];
  monthlyProjection: number;
  currentMonth: number;
  previousMonth: number;
  usageMetrics: {
    lambdaInvocations: number;
    s3Requests: number;
    dataTransferGB: number;
    computeHours: number;
  };
}

export interface StepFunctionExecution {
  executionArn: string;
  name: string;
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  startDate: Date;
  endDate?: Date;
  input: any;
  output?: any;
}

@Injectable()
export class AWSMonitoringService {
  private readonly logger = new Logger(AWSMonitoringService.name);
  private readonly cloudWatchClient: CloudWatchClient;
  private readonly cloudWatchLogsClient: CloudWatchLogsClient;
  private readonly costExplorerClient: CostExplorerClient;
  private readonly lambdaClient: LambdaClient;
  private readonly sfnClient: SFNClient;
  private readonly region: string;

  // ForestShield specific function names
  private readonly forestShieldFunctions = [
    'forestshield-vegetation-analyzer',
    'forestshield-results-consolidator', 
    'forestshield-model-manager-dev',
    'forestshield-visualization-generator',
    'forestshield-k-selector',
    'forestshield-search-images',
    'forestshield-sagemaker-processor'
  ];

  constructor(private readonly configService: ConfigService) {
    this.region = this.configService.get('AWS_REGION', 'us-west-2');
    
    this.cloudWatchClient = new CloudWatchClient({ region: this.region });
    this.cloudWatchLogsClient = new CloudWatchLogsClient({ region: this.region });
    this.costExplorerClient = new CostExplorerClient({ region: this.region });
    this.lambdaClient = new LambdaClient({ region: this.region });
    this.sfnClient = new SFNClient({ region: this.region });
    
    this.logger.log('AWS Monitoring Service initialized for real CloudWatch and Cost Explorer data');
  }

  async getAWSServiceMetrics(): Promise<AWSServiceMetrics[]> {
    this.logger.log('Fetching real AWS service metrics from CloudWatch');
    
    try {
      const [lambdaMetrics, s3Metrics, stepFunctionMetrics, sageMakerMetrics, snsMetrics] = await Promise.all([
        this.getLambdaServiceMetrics(),
        this.getS3ServiceMetrics(),
        this.getStepFunctionServiceMetrics(),
        this.getSageMakerServiceMetrics(),
        this.getSNSServiceMetrics()
      ]);

      return [
        lambdaMetrics,
        s3Metrics,
        stepFunctionMetrics,
        sageMakerMetrics,
        snsMetrics
      ];
    } catch (error) {
      this.logger.error('Failed to get AWS service metrics:', error);
      throw new Error(`AWS CloudWatch API unavailable: ${error.message}`);
    }
  }

  private async getLambdaServiceMetrics(): Promise<AWSServiceMetrics> {
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000); // Last 24 hours

    try {
      // Get metrics for all ForestShield Lambda functions
      const metricsPromises = this.forestShieldFunctions.map(functionName =>
        this.getLambdaFunctionMetrics(functionName, startTime, endTime)
      );
      
      const functionMetrics = await Promise.all(metricsPromises);
      const validMetrics = functionMetrics.filter(m => m !== null);

      // Aggregate metrics across all Lambda functions
      const totalInvocations = validMetrics.reduce((sum, m) => sum + (m?.invocations || 0), 0);
      const totalErrors = validMetrics.reduce((sum, m) => sum + (m?.errors || 0), 0);
      const avgDuration = validMetrics.length > 0 
        ? validMetrics.reduce((sum, m) => sum + (m?.duration || 0), 0) / validMetrics.length 
        : 0;
      const avgMemory = validMetrics.length > 0
        ? validMetrics.reduce((sum, m) => sum + (m?.memory || 0), 0) / validMetrics.length
        : 0;

      const errorRate = totalInvocations > 0 ? (totalErrors / totalInvocations) * 100 : 0;
      
      return {
        id: 'lambda-forestshield',
        name: 'Lambda Functions',
        status: errorRate < 1 ? 'healthy' : errorRate < 5 ? 'degraded' : 'unhealthy',
        icon: 'lambda',
        metrics: {
          invocations: totalInvocations,
          errors: totalErrors,
          duration: Math.round(avgDuration),
          memory: Math.round(avgMemory),
          storage: 0, // Lambda doesn't have persistent storage
          cost: await this.estimateLambdaCost(totalInvocations, avgDuration, avgMemory)
        },
        lastUpdated: new Date()
      };
    } catch (error) {
      this.logger.warn('Failed to get Lambda metrics:', error);
      throw new Error(`AWS Lambda metrics unavailable: ${error.message}`);
    }
  }

  private async getLambdaFunctionMetrics(functionName: string, startTime: Date, endTime: Date) {
    try {
      // Get invocation count
      const invocationsCommand = new GetMetricStatisticsCommand({
        Namespace: 'AWS/Lambda',
        MetricName: 'Invocations',
        Dimensions: [{ Name: 'FunctionName', Value: functionName }],
        StartTime: startTime,
        EndTime: endTime,
        Period: 86400, // 24 hours
        Statistics: ['Sum']
      });

      // Get error count
      const errorsCommand = new GetMetricStatisticsCommand({
        Namespace: 'AWS/Lambda',
        MetricName: 'Errors',
        Dimensions: [{ Name: 'FunctionName', Value: functionName }],
        StartTime: startTime,
        EndTime: endTime,
        Period: 86400,
        Statistics: ['Sum']
      });

      // Get duration
      const durationCommand = new GetMetricStatisticsCommand({
        Namespace: 'AWS/Lambda',
        MetricName: 'Duration',
        Dimensions: [{ Name: 'FunctionName', Value: functionName }],
        StartTime: startTime,
        EndTime: endTime,
        Period: 86400,
        Statistics: ['Average']
      });

      const [invocationsResult, errorsResult, durationResult] = await Promise.all([
        this.cloudWatchClient.send(invocationsCommand),
        this.cloudWatchClient.send(errorsCommand),
        this.cloudWatchClient.send(durationCommand)
      ]);

      // Get function configuration for memory
      const functionConfigCommand = new GetFunctionCommand({ FunctionName: functionName });
      const functionConfig = await this.lambdaClient.send(functionConfigCommand);

      const invocations = invocationsResult.Datapoints?.[0]?.Sum || 0;
      const errors = errorsResult.Datapoints?.[0]?.Sum || 0;
      const duration = durationResult.Datapoints?.[0]?.Average || 0;
      const memory = functionConfig.Configuration?.MemorySize || 0;

      return {
        functionName,
        invocations,
        errors,
        duration,
        memory
      };
    } catch (error) {
      this.logger.warn(`Failed to get metrics for function ${functionName}:`, error);
      return null;
    }
  }

  private async getS3ServiceMetrics(): Promise<AWSServiceMetrics> {
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000);

    try {
      // Get S3 bucket metrics for ForestShield buckets
      const bucketNames = [
        `forestshield-processed-data-${await this.getAccountId()}`,
        `forestshield-models-${await this.getAccountId()}`,
        `forestshield-temp-${await this.getAccountId()}`
      ];

      const metricsPromises = bucketNames.map(bucketName =>
        this.getS3BucketMetrics(bucketName, startTime, endTime)
      );
      
      const bucketMetrics = await Promise.all(metricsPromises);
      const validMetrics = bucketMetrics.filter(m => m !== null);

      const totalRequests = validMetrics.reduce((sum, m) => sum + (m?.requests || 0), 0);
      const totalStorage = validMetrics.reduce((sum, m) => sum + (m?.storage || 0), 0);

      return {
        id: 's3-forestshield-data',
        name: 'S3 Storage',
        status: totalStorage < 100000000000 ? 'healthy' : 'degraded', // 100GB threshold
        icon: 's3',
        metrics: {
          invocations: totalRequests,
          errors: 0, // S3 errors are harder to track via CloudWatch
          duration: 0, // Not applicable for S3
          memory: 0, // Not applicable for S3
          storage: Math.round(totalStorage / (1024 * 1024 * 1024)), // Convert to GB
          cost: await this.estimateS3Cost(totalStorage, totalRequests)
        },
        lastUpdated: new Date()
      };
    } catch (error) {
      this.logger.warn('Failed to get S3 metrics:', error);
      throw new Error(`AWS S3 metrics unavailable: ${error.message}`);
    }
  }

  private async getS3BucketMetrics(bucketName: string, startTime: Date, endTime: Date) {
    try {
      // Get number of requests
      const requestsCommand = new GetMetricStatisticsCommand({
        Namespace: 'AWS/S3',
        MetricName: 'NumberOfObjects',
        Dimensions: [
          { Name: 'BucketName', Value: bucketName },
          { Name: 'StorageType', Value: 'AllStorageTypes' }
        ],
        StartTime: startTime,
        EndTime: endTime,
        Period: 86400,
        Statistics: ['Average']
      });

      // Get bucket size
      const sizeCommand = new GetMetricStatisticsCommand({
        Namespace: 'AWS/S3',
        MetricName: 'BucketSizeBytes',
        Dimensions: [
          { Name: 'BucketName', Value: bucketName },
          { Name: 'StorageType', Value: 'StandardStorage' }
        ],
        StartTime: startTime,
        EndTime: endTime,
        Period: 86400,
        Statistics: ['Average']
      });

      const [requestsResult, sizeResult] = await Promise.all([
        this.cloudWatchClient.send(requestsCommand),
        this.cloudWatchClient.send(sizeCommand)
      ]);

      const requests = requestsResult.Datapoints?.[0]?.Average || 0;
      const storage = sizeResult.Datapoints?.[0]?.Average || 0;

      return {
        bucketName,
        requests,
        storage
      };
    } catch (error) {
      this.logger.warn(`Failed to get S3 metrics for bucket ${bucketName}:`, error);
      return null;
    }
  }

  private async getStepFunctionServiceMetrics(): Promise<AWSServiceMetrics> {
    try {
      const stateMachineArn = `arn:aws:states:${this.region}:${await this.getAccountId()}:stateMachine:forestshield-pipeline`;
      
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000);

      // Get execution metrics
      const executionsCommand = new GetMetricStatisticsCommand({
        Namespace: 'AWS/States',
        MetricName: 'ExecutionsStarted',
        Dimensions: [{ Name: 'StateMachineArn', Value: stateMachineArn }],
        StartTime: startTime,
        EndTime: endTime,
        Period: 86400,
        Statistics: ['Sum']
      });

      const failedCommand = new GetMetricStatisticsCommand({
        Namespace: 'AWS/States',
        MetricName: 'ExecutionsFailed',
        Dimensions: [{ Name: 'StateMachineArn', Value: stateMachineArn }],
        StartTime: startTime,
        EndTime: endTime,
        Period: 86400,
        Statistics: ['Sum']
      });

      const [executionsResult, failedResult] = await Promise.all([
        this.cloudWatchClient.send(executionsCommand),
        this.cloudWatchClient.send(failedCommand)
      ]);

      const executions = executionsResult.Datapoints?.[0]?.Sum || 0;
      const failed = failedResult.Datapoints?.[0]?.Sum || 0;
      const successRate = executions > 0 ? ((executions - failed) / executions) * 100 : 100;

      return {
        id: 'step-functions-workflow',
        name: 'Step Functions',
        status: successRate > 95 ? 'healthy' : successRate > 80 ? 'degraded' : 'unhealthy',
        icon: 'step-functions',
        metrics: {
          invocations: executions,
          errors: failed,
          duration: 0, // Will need separate query for execution duration
          memory: 0, // Not applicable
          storage: 0, // Not applicable
          cost: await this.estimateStepFunctionsCost(executions)
        },
        lastUpdated: new Date()
      };
    } catch (error) {
      this.logger.warn('Failed to get Step Functions metrics:', error);
      throw new Error(`AWS Step Functions metrics unavailable: ${error.message}`);
    }
  }

  private async getSageMakerServiceMetrics(): Promise<AWSServiceMetrics> {
    // SageMaker metrics implementation would go here
    // For now, return a basic healthy status
    return {
      id: 'sagemaker-k-means-clustering',
      name: 'SageMaker',
      status: 'healthy',
      icon: 'sagemaker',
      metrics: {
        invocations: 0,
        errors: 0,
        duration: 0,
        memory: 0,
        storage: 0,
        cost: 0
      },
      lastUpdated: new Date()
    };
  }

  private async getSNSServiceMetrics(): Promise<AWSServiceMetrics> {
    // SNS metrics implementation would go here
    // For now, return a basic healthy status
    return {
      id: 'sns-alert-notifications',
      name: 'SNS Notifications',
      status: 'healthy',
      icon: 'sns',
      metrics: {
        invocations: 0,
        errors: 0,
        duration: 0,
        memory: 0,
        storage: 0,
        cost: 0
      },
      lastUpdated: new Date()
    };
  }

  async getCostAndUsageData(): Promise<CostData> {
    this.logger.log('Fetching real cost data from AWS Cost Explorer');
    
    try {
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000); // Last 30 days

      const command = new GetCostAndUsageCommand({
        TimePeriod: {
          Start: startDate.toISOString().split('T')[0],
          End: endDate.toISOString().split('T')[0]
        },
        Granularity: 'DAILY',
        Metrics: ['BlendedCost'],
        GroupBy: [
          {
            Type: 'DIMENSION',
            Key: 'SERVICE'
          }
        ]
      });

      const result = await this.costExplorerClient.send(command);
      
      // Process daily costs
      const dailyCosts = result.ResultsByTime?.map(item => ({
        date: item.TimePeriod?.Start || '',
        amount: parseFloat(item.Total?.BlendedCost?.Amount || '0')
      })) || [];

      // Calculate monthly projections
      const currentMonthCosts = dailyCosts.slice(-30);
      const currentMonth = currentMonthCosts.reduce((sum, day) => sum + day.amount, 0);
      const dailyAverage = currentMonth / currentMonthCosts.length;
      const monthlyProjection = dailyAverage * 30;

      // Previous month (approximation)
      const previousMonthCosts = dailyCosts.slice(-60, -30);
      const previousMonth = previousMonthCosts.reduce((sum, day) => sum + day.amount, 0);

      return {
        dailyCosts,
        monthlyProjection,
        currentMonth,
        previousMonth,
        usageMetrics: await this.getUsageMetrics()
      };
    } catch (error) {
      this.logger.error('Failed to fetch cost data:', error);
      throw new Error(`AWS Cost Explorer unavailable: ${error.message}`);
    }
  }

  private async getUsageMetrics() {
    // This would typically come from multiple CloudWatch metrics
    // For now, return estimated values based on service metrics
    const lambdaMetrics = await this.getLambdaServiceMetrics();
    
    return {
      lambdaInvocations: lambdaMetrics.metrics.invocations,
      s3Requests: 0, // Would need to aggregate from S3 metrics
      dataTransferGB: 0, // Would need CloudWatch data transfer metrics
      computeHours: Math.round(lambdaMetrics.metrics.duration * lambdaMetrics.metrics.invocations / 3600000) // Convert ms to hours
    };
  }

  async getCloudWatchLogs(logGroupName?: string, limit: number = 50): Promise<CloudWatchLog[]> {
    this.logger.log(`Fetching real CloudWatch logs from ${logGroupName || 'all ForestShield log groups'}`);
    
    try {
      const logGroups = logGroupName ? [logGroupName] : await this.getForestShieldLogGroups();
      
      const logsPromises = logGroups.map(group => 
        this.getLogsFromGroup(group, limit)
      );
      
      const allLogs = await Promise.all(logsPromises);
      const flattenedLogs = allLogs.flat();
      
      // Sort by timestamp (most recent first) and limit
      return flattenedLogs
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
        .slice(0, limit);
        
    } catch (error) {
      this.logger.error('Failed to fetch CloudWatch logs:', error);
      throw new Error(`AWS CloudWatch Logs unavailable: ${error.message}`);
    }
  }

  private async getForestShieldLogGroups(): Promise<string[]> {
    try {
      const command = new DescribeLogGroupsCommand({
        logGroupNamePrefix: '/aws/lambda/forestshield'
      });
      
      const result = await this.cloudWatchLogsClient.send(command);
      return result.logGroups?.map(group => group.logGroupName || '') || [];
    } catch (error) {
      this.logger.warn('Failed to get log groups:', error);
      return this.forestShieldFunctions.map(func => `/aws/lambda/${func}`);
    }
  }

  private async getLogsFromGroup(logGroupName: string, limit: number): Promise<CloudWatchLog[]> {
    try {
      const endTime = Date.now();
      const startTime = endTime - (24 * 60 * 60 * 1000); // Last 24 hours
      
      const command = new FilterLogEventsCommand({
        logGroupName,
        startTime,
        endTime,
        limit
      });
      
      const result = await this.cloudWatchLogsClient.send(command);
      
      return result.events?.map(event => ({
        id: `${logGroupName}-${event.eventId}`,
        timestamp: new Date(event.timestamp || 0),
        level: this.extractLogLevel(event.message || ''),
        message: event.message || '',
        logGroup: logGroupName,
        logStream: event.logStreamName || ''
      })) || [];
      
    } catch (error) {
      this.logger.warn(`Failed to get logs from group ${logGroupName}:`, error);
      return [];
    }
  }

  private extractLogLevel(message: string): 'INFO' | 'WARN' | 'ERROR' {
    const upperMessage = message.toUpperCase();
    if (upperMessage.includes('ERROR') || upperMessage.includes('FAILED')) return 'ERROR';
    if (upperMessage.includes('WARN') || upperMessage.includes('WARNING')) return 'WARN';
    return 'INFO';
  }

  // Helper methods for cost estimation
  private async estimateLambdaCost(invocations: number, avgDurationMs: number, avgMemoryMB: number): Promise<number> {
    // AWS Lambda pricing: $0.0000002 per request + $0.0000166667 per GB-second
    const requestCost = invocations * 0.0000002;
    const computeCost = (avgMemoryMB / 1024) * (avgDurationMs / 1000) * invocations * 0.0000166667;
    return requestCost + computeCost;
  }

  private async estimateS3Cost(storageBytes: number, requests: number): Promise<number> {
    // AWS S3 pricing: $0.023 per GB per month + $0.0004 per 1000 requests
    const storageGB = storageBytes / (1024 * 1024 * 1024);
    const storageCost = storageGB * 0.023 / 30; // Daily cost
    const requestCost = (requests / 1000) * 0.0004;
    return storageCost + requestCost;
  }

  private async estimateStepFunctionsCost(executions: number): Promise<number> {
    // AWS Step Functions pricing: $0.025 per 1000 state transitions
    return (executions * 10) / 1000 * 0.025; // Assuming ~10 state transitions per execution
  }



  private async getAccountId(): Promise<string> {
    // Simple way to get account ID from configuration
    // In production, you'd use STS GetCallerIdentity
    return this.configService.get('AWS_ACCOUNT_ID', '381492060635');
  }
} 