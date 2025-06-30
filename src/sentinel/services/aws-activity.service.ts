import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { 
  CloudWatchClient, 
  GetMetricStatisticsCommand,
  DescribeAlarmsCommand 
} from '@aws-sdk/client-cloudwatch';
import {
  CloudWatchLogsClient,
  DescribeLogGroupsCommand,
  FilterLogEventsCommand
} from '@aws-sdk/client-cloudwatch-logs';
import {
  LambdaClient,
  ListFunctionsCommand,
  GetFunctionCommand,
  GetAccountSettingsCommand,
  InvokeCommand
} from '@aws-sdk/client-lambda';
import {
  SFNClient,
  ListExecutionsCommand,
  DescribeExecutionCommand,
  DescribeStateMachineCommand
} from '@aws-sdk/client-sfn';
import {
  S3Client,
  ListBucketsCommand,
  GetBucketLocationCommand,
  GetBucketMetricsConfigurationCommand,
  HeadBucketCommand
} from '@aws-sdk/client-s3';
import {
  CloudTrailClient,
  LookupEventsCommand
} from '@aws-sdk/client-cloudtrail';
import {
  SageMakerClient,
  ListEndpointsCommand,
  DescribeEndpointCommand,
  ListTrainingJobsCommand
} from '@aws-sdk/client-sagemaker';
import {
  SNSClient,
  ListTopicsCommand,
  GetTopicAttributesCommand
} from '@aws-sdk/client-sns';

export interface ActivityEvent {
  id: string;
  type: 'analysis' | 'alert' | 'region' | 'system' | 'error' | 'deployment' | 'optimization';
  message: string;
  timestamp: Date;
  regionName?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  service: string;
  details?: any;
}

export interface SystemHealthStatus {
  overall_health: 'healthy' | 'degraded' | 'unhealthy';
  aws_services: {
    lambda: 'healthy' | 'degraded' | 'unhealthy';
    step_functions: 'healthy' | 'degraded' | 'unhealthy';
    s3: 'healthy' | 'degraded' | 'unhealthy';
    sagemaker: 'healthy' | 'degraded' | 'unhealthy';
    sns: 'healthy' | 'degraded' | 'unhealthy';
    cloudwatch: 'healthy' | 'degraded' | 'unhealthy';
  };
  lambda_functions: Record<string, {
    status: 'healthy' | 'degraded' | 'unhealthy';
    last_invocation?: string;
    error_rate?: number;
    duration_avg?: number;
  }>;
  resource_utilization: {
    lambda_concurrent_executions: number;
    s3_storage_utilization: number;
    cloudwatch_api_calls: number;
    step_function_executions: number;
  };
  last_check: string;
}

@Injectable()
export class AWSActivityService {
  private readonly logger = new Logger(AWSActivityService.name);
  private readonly cloudWatchClient: CloudWatchClient;
  private readonly cloudWatchLogsClient: CloudWatchLogsClient;
  private readonly lambdaClient: LambdaClient;
  private readonly stepFunctionsClient: SFNClient;
  private readonly s3Client: S3Client;
  private readonly cloudTrailClient: CloudTrailClient;
  private readonly sageMakerClient: SageMakerClient;
  private readonly snsClient: SNSClient;
  private readonly awsRegion: string;

  private readonly forestShieldFunctions = [
    'forestshield-vegetation-analyzer',
    'forestshield-model-manager-dev',
    'forestshield-k-selector',
    'forestshield-results-consolidator',
    'forestshield-visualization-generator'
  ];

  private readonly forestShieldBuckets = [
    'forestshield-processed-data',
    'forestshield-models',
    'forestshield-satellite-images'
  ];

  constructor(private readonly configService: ConfigService) {
    this.awsRegion = this.configService.get<string>('AWS_REGION', 'us-east-1');
    
    const clientConfig = { region: this.awsRegion };
    this.cloudWatchClient = new CloudWatchClient(clientConfig);
    this.cloudWatchLogsClient = new CloudWatchLogsClient(clientConfig);
    this.lambdaClient = new LambdaClient(clientConfig);
    this.stepFunctionsClient = new SFNClient(clientConfig);
    this.s3Client = new S3Client(clientConfig);
    this.cloudTrailClient = new CloudTrailClient(clientConfig);
    this.sageMakerClient = new SageMakerClient(clientConfig);
    this.snsClient = new SNSClient(clientConfig);
  }

  /**
   * Get real AWS activity feed from CloudTrail and CloudWatch Logs
   */
  async getActivityFeed(limit: number = 50): Promise<ActivityEvent[]> {
    this.logger.log('🔍 Fetching real AWS activity feed from CloudTrail and CloudWatch');
    
    try {
      const [cloudTrailEvents, lambdaLogs, stepFunctionExecutions] = await Promise.all([
        this.getCloudTrailEvents(limit / 3),
        this.getLambdaActivityLogs(limit / 3),
        this.getStepFunctionActivity(limit / 3)
      ]);

      const activities: ActivityEvent[] = [
        ...cloudTrailEvents,
        ...lambdaLogs,
        ...stepFunctionExecutions
      ];

      // Sort by timestamp (most recent first) and limit
      return activities
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
        .slice(0, limit);

    } catch (error) {
      this.logger.error('Failed to fetch activity feed:', error);
      throw new Error(`Failed to fetch real AWS activity feed: ${error.message}`);
    }
  }

  /**
   * Get real system health status from AWS services
   */
  async getSystemHealth(): Promise<SystemHealthStatus> {
    this.logger.log('🏥 Getting real AWS system health status');
    
    try {
      const [
        lambdaHealth,
        stepFunctionsHealth,
        s3Health,
        sageMakerHealth,
        snsHealth,
        cloudWatchHealth,
        resourceUtilization
      ] = await Promise.all([
        this.getLambdaHealth(),
        this.getStepFunctionsHealth(),
        this.getS3Health(),
        this.getSageMakerHealth(),
        this.getSNSHealth(),
        this.getCloudWatchHealth(),
        this.getResourceUtilization()
      ]);

      const services = {
        lambda: lambdaHealth.status,
        step_functions: stepFunctionsHealth.status,
        s3: s3Health.status,
        sagemaker: sageMakerHealth.status,
        sns: snsHealth.status,
        cloudwatch: cloudWatchHealth.status
      };

      // Calculate overall health
      const healthyServices = Object.values(services).filter(s => s === 'healthy').length;
      const totalServices = Object.values(services).length;
      const overall_health = healthyServices === totalServices ? 'healthy' : 
                           healthyServices >= totalServices * 0.8 ? 'degraded' : 'unhealthy';

      return {
        overall_health,
        aws_services: services,
        lambda_functions: lambdaHealth.functions,
        resource_utilization: resourceUtilization,
        last_check: new Date().toISOString()
      };

    } catch (error) {
      this.logger.error('Failed to get system health:', error);
      throw new Error(`Failed to get real AWS system health: ${error.message}`);
    }
  }

  /**
   * Get real CloudTrail events for ForestShield
   */
  private async getCloudTrailEvents(limit: number): Promise<ActivityEvent[]> {
    try {
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000); // Last 24 hours

      const command = new LookupEventsCommand({
        StartTime: startTime,
        EndTime: endTime,
        MaxResults: limit,
        LookupAttributes: [
          {
            AttributeKey: 'ResourceName',
            AttributeValue: 'forestshield'
          }
        ]
      });

      const response = await this.cloudTrailClient.send(command);
      const events = response.Events || [];

      return events.map((event, index) => ({
        id: `cloudtrail-${event.EventId || index}`,
        type: this.mapCloudTrailEventType(event.EventName || ''),
        message: this.formatCloudTrailMessage(event),
        timestamp: event.EventTime || new Date(),
        service: 'CloudTrail',
        severity: this.getEventSeverity(event.EventName || ''),
        details: {
          eventName: event.EventName,
          sourceIPAddress: (event as any).SourceIPAddress,
          userAgent: (event as any).UserAgent,
          resources: event.Resources
        }
      }));

    } catch (error) {
      this.logger.warn('Failed to fetch CloudTrail events:', error);
      return [];
    }
  }

  /**
   * Get real Lambda activity from CloudWatch Logs
   */
  private async getLambdaActivityLogs(limit: number): Promise<ActivityEvent[]> {
    try {
      const activities: ActivityEvent[] = [];
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000);

      for (const functionName of this.forestShieldFunctions) {
        try {
          const logGroupName = `/aws/lambda/${functionName}`;
          
          const command = new FilterLogEventsCommand({
            logGroupName,
            startTime: startTime.getTime(),
            endTime: endTime.getTime(),
            limit: Math.ceil(limit / this.forestShieldFunctions.length),
            filterPattern: '[timestamp, requestId, level="INFO" || level="WARN" || level="ERROR"]'
          });

          const response = await this.cloudWatchLogsClient.send(command);
          const events = response.events || [];

          for (const logEvent of events) {
            activities.push({
              id: `lambda-${functionName}-${logEvent.eventId}`,
              type: 'analysis',
              message: this.formatLambdaLogMessage(functionName, logEvent.message || ''),
              timestamp: new Date(logEvent.timestamp || Date.now()),
              service: 'Lambda',
              severity: this.extractLogLevel(logEvent.message || ''),
              details: {
                functionName,
                logStream: logEvent.logStreamName,
                logEvent: logEvent.message
              }
            });
          }
        } catch (error) {
          this.logger.warn(`Failed to get logs for ${functionName}:`, error);
        }
      }

      return activities;
    } catch (error) {
      this.logger.warn('Failed to fetch Lambda activity logs:', error);
      return [];
    }
  }

  /**
   * Get real Step Functions execution activity
   */
  private async getStepFunctionActivity(limit: number): Promise<ActivityEvent[]> {
    try {
      const stateMachineArn = this.configService.get<string>('STEP_FUNCTIONS_STATE_MACHINE_ARN');
      if (!stateMachineArn) {
        return [];
      }

      const command = new ListExecutionsCommand({
        stateMachineArn,
        maxResults: limit
      });

      const response = await this.stepFunctionsClient.send(command);
      const executions = response.executions || [];

      return executions.map(execution => ({
        id: `stepfunctions-${execution.name}`,
        type: execution.status === 'SUCCEEDED' ? 'analysis' : 'error',
        message: this.formatStepFunctionMessage(execution),
        timestamp: execution.startDate || new Date(),
        service: 'Step Functions',
        severity: execution.status === 'FAILED' ? 'high' : 'low',
        details: {
          executionArn: execution.executionArn,
          status: execution.status,
          input: (execution as any).input
        }
      }));

    } catch (error) {
      this.logger.warn('Failed to fetch Step Functions activity:', error);
      return [];
    }
  }

  /**
   * Get real Lambda health status
   */
  private async getLambdaHealth(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    functions: Record<string, any>;
  }> {
    try {
      const functions: Record<string, any> = {};
      let healthyCount = 0;
      let totalCount = 0;

      for (const functionName of this.forestShieldFunctions) {
        try {
          const [functionInfo, metrics] = await Promise.all([
            this.lambdaClient.send(new GetFunctionCommand({ FunctionName: functionName })),
            this.getLambdaFunctionMetrics(functionName)
          ]);

          const isHealthy = metrics.errorRate < 5; // Less than 5% error rate
          if (isHealthy) healthyCount++;
          totalCount++;

          functions[functionName] = {
            status: isHealthy ? 'healthy' : 'degraded',
            last_invocation: metrics.lastInvocation,
            error_rate: metrics.errorRate,
            duration_avg: metrics.avgDuration,
            memory_size: functionInfo.Configuration?.MemorySize || 0,
            runtime: functionInfo.Configuration?.Runtime || 'unknown'
          };

        } catch (error: any) {
          functions[functionName] = {
            status: 'unhealthy',
            error: error?.message || 'Unknown error'
          };
          totalCount++;
        }
      }

      const healthPercentage = totalCount > 0 ? healthyCount / totalCount : 0;
      const status = healthPercentage >= 0.8 ? 'healthy' : 
                    healthPercentage >= 0.5 ? 'degraded' : 'unhealthy';

      return { status, functions };

    } catch (error) {
      this.logger.error('Failed to get Lambda health:', error);
      return {
        status: 'unhealthy',
        functions: {}
      };
    }
  }

  /**
   * Get Lambda function metrics from CloudWatch
   */
  private async getLambdaFunctionMetrics(functionName: string): Promise<{
    errorRate: number;
    avgDuration: number;
    lastInvocation: string;
  }> {
    try {
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000);

      const [invocationsResponse, errorsResponse, durationsResponse] = await Promise.all([
        this.cloudWatchClient.send(new GetMetricStatisticsCommand({
          Namespace: 'AWS/Lambda',
          MetricName: 'Invocations',
          Dimensions: [{ Name: 'FunctionName', Value: functionName }],
          StartTime: startTime,
          EndTime: endTime,
          Period: 3600, // 1 hour periods
          Statistics: ['Sum']
        })),
        this.cloudWatchClient.send(new GetMetricStatisticsCommand({
          Namespace: 'AWS/Lambda',
          MetricName: 'Errors',
          Dimensions: [{ Name: 'FunctionName', Value: functionName }],
          StartTime: startTime,
          EndTime: endTime,
          Period: 3600,
          Statistics: ['Sum']
        })),
        this.cloudWatchClient.send(new GetMetricStatisticsCommand({
          Namespace: 'AWS/Lambda',
          MetricName: 'Duration',
          Dimensions: [{ Name: 'FunctionName', Value: functionName }],
          StartTime: startTime,
          EndTime: endTime,
          Period: 3600,
          Statistics: ['Average']
        }))
      ]);

      const totalInvocations = invocationsResponse.Datapoints?.reduce((sum, dp) => sum + (dp.Sum || 0), 0) || 0;
      const totalErrors = errorsResponse.Datapoints?.reduce((sum, dp) => sum + (dp.Sum || 0), 0) || 0;
      const durationDatapoints = durationsResponse.Datapoints || [];
      const avgDuration = durationDatapoints.length > 0 
        ? durationDatapoints.reduce((sum, dp) => sum + (dp.Average || 0), 0) / durationDatapoints.length 
        : 0;

      const errorRate = totalInvocations > 0 ? (totalErrors / totalInvocations) * 100 : 0;
      const lastDatapoint = invocationsResponse.Datapoints && invocationsResponse.Datapoints.length > 0 
        ? invocationsResponse.Datapoints[invocationsResponse.Datapoints.length - 1] 
        : null;
      const lastInvocation = lastDatapoint?.Timestamp?.toISOString() || 'Never';

      return {
        errorRate,
        avgDuration,
        lastInvocation
      };

    } catch (error) {
      this.logger.warn(`Failed to get metrics for ${functionName}:`, error);
      return {
        errorRate: 0,
        avgDuration: 0,
        lastInvocation: 'Unknown'
      };
    }
  }

  /**
   * Get Step Functions health status
   */
  private async getStepFunctionsHealth(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy' }> {
    try {
      const stateMachineArn = this.configService.get<string>('STEP_FUNCTIONS_STATE_MACHINE_ARN');
      if (!stateMachineArn) {
        return { status: 'unhealthy' };
      }

      // Check if state machine exists and is valid
      await this.stepFunctionsClient.send(new DescribeStateMachineCommand({
        stateMachineArn
      }));

      // Check recent executions
      const executions = await this.stepFunctionsClient.send(new ListExecutionsCommand({
        stateMachineArn,
        maxResults: 10
      }));

      const recentExecutions = executions.executions || [];
      const successfulExecutions = recentExecutions.filter(e => e.status === 'SUCCEEDED').length;
      const successRate = recentExecutions.length > 0 ? successfulExecutions / recentExecutions.length : 1;

      return {
        status: successRate >= 0.8 ? 'healthy' : successRate >= 0.5 ? 'degraded' : 'unhealthy'
      };

    } catch (error) {
      this.logger.warn('Failed to get Step Functions health:', error);
      return { status: 'unhealthy' };
    }
  }

  /**
   * Get S3 health status
   */
  private async getS3Health(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy' }> {
    try {
      const accountId = this.configService.get<string>('AWS_ACCOUNT_ID', '');
      let healthyBuckets = 0;
      let totalBuckets = 0;

      for (const bucketPrefix of this.forestShieldBuckets) {
        const bucketName = accountId ? `${bucketPrefix}-${accountId}` : bucketPrefix;
        try {
          await this.s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
          healthyBuckets++;
        } catch (error) {
          this.logger.warn(`Bucket ${bucketName} not accessible:`, error);
        }
        totalBuckets++;
      }

      const healthPercentage = totalBuckets > 0 ? healthyBuckets / totalBuckets : 0;
      return {
        status: healthPercentage >= 0.8 ? 'healthy' : 
                healthPercentage >= 0.5 ? 'degraded' : 'unhealthy'
      };

    } catch (error) {
      this.logger.warn('Failed to get S3 health:', error);
      return { status: 'unhealthy' };
    }
  }

  /**
   * Get SageMaker health status
   */
  private async getSageMakerHealth(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy' }> {
    try {
      const endpoints = await this.sageMakerClient.send(new ListEndpointsCommand({
        NameContains: 'forestshield'
      }));

      const activeEndpoints = endpoints.Endpoints?.filter(e => e.EndpointStatus === 'InService').length || 0;
      const totalEndpoints = endpoints.Endpoints?.length || 0;

      if (totalEndpoints === 0) {
        return { status: 'healthy' }; // No endpoints expected
      }

      const healthPercentage = activeEndpoints / totalEndpoints;
      return {
        status: healthPercentage >= 0.8 ? 'healthy' : 
                healthPercentage >= 0.5 ? 'degraded' : 'unhealthy'
      };

    } catch (error) {
      this.logger.warn('Failed to get SageMaker health:', error);
      return { status: 'degraded' };
    }
  }

  /**
   * Get SNS health status
   */
  private async getSNSHealth(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy' }> {
    try {
      const topicArn = this.configService.get<string>('SNS_DEFORESTATION_TOPIC_ARN');
      if (!topicArn) {
        return { status: 'unhealthy' };
      }

      // Check if topic exists and get attributes
      await this.snsClient.send(new GetTopicAttributesCommand({
        TopicArn: topicArn
      }));

      return { status: 'healthy' };

    } catch (error) {
      this.logger.warn('Failed to get SNS health:', error);
      return { status: 'unhealthy' };
    }
  }

  /**
   * Get CloudWatch health status
   */
  private async getCloudWatchHealth(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy' }> {
    try {
      // Test CloudWatch connectivity by listing alarms
      await this.cloudWatchClient.send(new DescribeAlarmsCommand({
        MaxRecords: 1
      }));

      return { status: 'healthy' };

    } catch (error) {
      this.logger.warn('Failed to get CloudWatch health:', error);
      return { status: 'unhealthy' };
    }
  }

  /**
   * Get real resource utilization metrics
   */
  private async getResourceUtilization(): Promise<{
    lambda_concurrent_executions: number;
    s3_storage_utilization: number;
    cloudwatch_api_calls: number;
    step_function_executions: number;
  }> {
    try {
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - 60 * 60 * 1000); // Last hour

      const [lambdaMetrics, stepFunctionMetrics] = await Promise.all([
        this.cloudWatchClient.send(new GetMetricStatisticsCommand({
          Namespace: 'AWS/Lambda',
          MetricName: 'ConcurrentExecutions',
          StartTime: startTime,
          EndTime: endTime,
          Period: 300,
          Statistics: ['Maximum']
        })),
        this.cloudWatchClient.send(new GetMetricStatisticsCommand({
          Namespace: 'AWS/States',
          MetricName: 'ExecutionsStarted',
          StartTime: startTime,
          EndTime: endTime,
          Period: 300,
          Statistics: ['Sum']
        }))
      ]);

      const maxConcurrentExecutions = lambdaMetrics.Datapoints?.reduce((max, dp) => Math.max(max, dp.Maximum || 0), 0) || 0;
      const totalStepFunctionExecutions = stepFunctionMetrics.Datapoints?.reduce((sum, dp) => sum + (dp.Sum || 0), 0) || 0;

      return {
        lambda_concurrent_executions: maxConcurrentExecutions,
        s3_storage_utilization: 0, // Would require additional S3 metrics
        cloudwatch_api_calls: 0, // Would require CloudTrail analysis
        step_function_executions: totalStepFunctionExecutions
      };

    } catch (error) {
      this.logger.warn('Failed to get resource utilization:', error);
      return {
        lambda_concurrent_executions: 0,
        s3_storage_utilization: 0,
        cloudwatch_api_calls: 0,
        step_function_executions: 0
      };
    }
  }

  // Helper methods for formatting and mapping
  private mapCloudTrailEventType(eventName: string): ActivityEvent['type'] {
    if (eventName.includes('Lambda') || eventName.includes('Invoke')) return 'analysis';
    if (eventName.includes('SNS') || eventName.includes('Publish')) return 'alert';
    if (eventName.includes('S3') || eventName.includes('Put')) return 'system';
    if (eventName.includes('Error') || eventName.includes('Fail')) return 'error';
    return 'system';
  }

  private formatCloudTrailMessage(event: any): string {
    const eventName = event.EventName || 'Unknown Event';
    const sourceName = event.SourceIPAddress || 'Unknown Source';
    return `${eventName} executed from ${sourceName}`;
  }

  private formatLambdaLogMessage(functionName: string, logMessage: string): string {
    const shortName = functionName.replace('forestshield-', '');
    if (logMessage.includes('START RequestId')) return `${shortName} function started processing`;
    if (logMessage.includes('END RequestId')) return `${shortName} function completed processing`;
    if (logMessage.includes('ERROR')) return `${shortName} function encountered an error`;
    if (logMessage.includes('processing satellite images')) return `${shortName} processing satellite imagery`;
    if (logMessage.includes('model training')) return `${shortName} training ML model`;
    return `${shortName} function activity: ${logMessage.substring(0, 100)}`;
  }

  private formatStepFunctionMessage(execution: any): string {
    const status = execution.status || 'UNKNOWN';
    const name = execution.name || 'Unknown Workflow';
    return `ForestShield workflow "${name}" ${status.toLowerCase()}`;
  }

  private getEventSeverity(eventName: string): ActivityEvent['severity'] {
    if (eventName.includes('Error') || eventName.includes('Fail')) return 'high';
    if (eventName.includes('Warning') || eventName.includes('Throttle')) return 'medium';
    return 'low';
  }

  private extractLogLevel(message: string): ActivityEvent['severity'] {
    if (message.includes('ERROR') || message.includes('FATAL')) return 'high';
    if (message.includes('WARN')) return 'medium';
    return 'low';
  }
} 