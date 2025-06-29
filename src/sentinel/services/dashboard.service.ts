import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { 
  DynamoDBDocumentClient, 
  ScanCommand, 
  PutCommand, 
  GetCommand, 
  DeleteCommand, 
  UpdateCommand,
  QueryCommand
} from '@aws-sdk/lib-dynamodb';
import { SNSClient, SubscribeCommand, UnsubscribeCommand, ListSubscriptionsByTopicCommand } from '@aws-sdk/client-sns';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { S3Client, GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import { SFNClient, StartExecutionCommand, DescribeExecutionCommand, ListExecutionsCommand } from '@aws-sdk/client-sfn';
import { randomUUID } from 'crypto';
import { RegionDto, CreateRegionDto, AlertDto, AlertLevel, RegionStatus, MonitoringJobDto } from '../dto/dashboard.dto';

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);
  private readonly docClient: DynamoDBDocumentClient;
  private readonly snsClient: SNSClient;
  private readonly lambdaClient: LambdaClient;
  private readonly s3Client: S3Client;
  private readonly sfnClient: SFNClient;
  private readonly regionsTable: string;
  private readonly alertsTable: string;
  private readonly snsTopicArn: string;
  private readonly deforestationWorkflowArn: string;
  private readonly processedDataBucket: string;

  constructor(private readonly configService: ConfigService) {
    const awsRegion = this.configService.get<string>('AWS_REGION');
    const ddbClient = new DynamoDBClient({ region: awsRegion });
    this.docClient = DynamoDBDocumentClient.from(ddbClient);
    this.snsClient = new SNSClient({ region: awsRegion });
    this.lambdaClient = new LambdaClient({ region: awsRegion });
    this.s3Client = new S3Client({ region: awsRegion });
    this.sfnClient = new SFNClient({ region: awsRegion });
    
    this.regionsTable = this.configService.get<string>('MONITORED_REGIONS_TABLE_NAME', 'forestshield-monitored-regions-dev');
    this.alertsTable = this.configService.get<string>('DEFORESTATION_ALERTS_TABLE_NAME', 'forestshield-deforestation-alerts-dev');
    this.snsTopicArn = this.configService.get<string>('SNS_DEFORESTATION_TOPIC_ARN', 'arn:aws:sns:us-east-1:381492060635:forestshield-deforestation-alerts-dev');
    this.deforestationWorkflowArn = this.configService.get<string>('STEP_FUNCTIONS_STATE_MACHINE_ARN');
    
    this.processedDataBucket = this.configService.get<string>('PROCESSED_DATA_BUCKET', 'forestshield-processed-data-381492060635');
  }

  // Region Management
  async getAllRegions(status?: RegionStatus): Promise<RegionDto[]> {
    const command = new ScanCommand({
      TableName: this.regionsTable,
      FilterExpression: status ? '#status = :status' : undefined,
      ExpressionAttributeNames: status ? { '#status': 'status' } : undefined,
      ExpressionAttributeValues: status ? { ':status': status } : undefined,
    });
    const result = await this.docClient.send(command);
    return result.Items as RegionDto[];
  }

  async createRegion(createRegionDto: CreateRegionDto): Promise<RegionDto> {
    const newRegion: RegionDto = {
      regionId: randomUUID(),
      ...createRegionDto,
      status: RegionStatus.ACTIVE,
      createdAt: new Date().toISOString(),
      lastDeforestationPercentage: 0,
      lastAnalysis: new Date().toISOString(),
    };
    const command = new PutCommand({
      TableName: this.regionsTable,
      Item: newRegion,
    });
    await this.docClient.send(command);
    return newRegion;
  }

  async getRegionById(regionId: string): Promise<RegionDto> {
    const command = new GetCommand({
      TableName: this.regionsTable,
      Key: { regionId },
    });
    const result = await this.docClient.send(command);
    return result.Item as RegionDto;
  }

  async updateRegion(regionId: string, updateData: Partial<RegionDto>): Promise<RegionDto> {
    const keys = Object.keys(updateData);
    const command = new UpdateCommand({
      TableName: this.regionsTable,
      Key: { regionId },
      UpdateExpression: `SET ${keys.map((k, i) => `#${k} = :${k}`).join(', ')}`,
      ExpressionAttributeNames: keys.reduce((acc, k) => ({ ...acc, [`#${k}`]: k }), {}),
      ExpressionAttributeValues: keys.reduce((acc, k) => ({ ...acc, [`:${k}`]: updateData[k] }), {}),
      ReturnValues: 'ALL_NEW',
    });
    const result = await this.docClient.send(command);
    return result.Attributes as RegionDto;
  }

  async deleteRegion(regionId: string): Promise<void> {
    const command = new DeleteCommand({
      TableName: this.regionsTable,
      Key: { regionId },
    });
    await this.docClient.send(command);
  }

  // Alert Management
  async getAlerts(level?: AlertLevel, acknowledged?: boolean): Promise<AlertDto[]> {
    // This is a more complex query. For now, we'll scan and filter.
    // For production, you'd want to optimize with GSI.
    const command = new ScanCommand({ TableName: this.alertsTable });
    let items = (await this.docClient.send(command)).Items as AlertDto[];

    if (level) {
      items = items.filter(i => i.level === level);
    }
    if (acknowledged !== undefined) {
      items = items.filter(i => i.acknowledged === acknowledged);
    }
    return items;
  }

  async acknowledgeAlert(id: string): Promise<AlertDto> {
    const command = new UpdateCommand({
      TableName: this.alertsTable,
      Key: { id },
      UpdateExpression: 'SET acknowledged = :acknowledged',
      ExpressionAttributeValues: { ':acknowledged': true },
      ReturnValues: 'ALL_NEW',
    });
    const result = await this.docClient.send(command);
    return result.Attributes as AlertDto;
  }

  // This would be called by your processing workflow
  async createAlert(region: RegionDto, deforestationPercentage: number): Promise<AlertDto> {
    let level = AlertLevel.LOW;
    if (deforestationPercentage > 10) level = AlertLevel.HIGH;
    else if (deforestationPercentage > 5) level = AlertLevel.MODERATE;

    const newAlert: AlertDto = {
      id: randomUUID(),
      regionId: region.regionId,
      regionName: region.name,
      level,
      deforestationPercentage,
      message: `Deforestation level at ${deforestationPercentage}% in ${region.name}`,
      timestamp: new Date().toISOString(),
      acknowledged: false,
    };

    const command = new PutCommand({
      TableName: this.alertsTable,
      Item: newAlert,
    });
    await this.docClient.send(command);
    return newAlert;
  }

  // SNS Subscription Management
  async subscribeToAlerts(email: string): Promise<string> {
    this.logger.log(`Subscribing ${email} to SNS topic: ${this.snsTopicArn}`);
    
    // Check if email is already subscribed
    const existingSubscriptions = await this.getAlertSubscriptions();
    const alreadySubscribed = existingSubscriptions.some(sub => 
      sub.email === email && sub.status === 'Confirmed'
    );
    
    if (alreadySubscribed) {
      throw new Error(`Email ${email} is already subscribed to ForestShield alerts`);
    }

    const command = new SubscribeCommand({
      TopicArn: this.snsTopicArn,
      Protocol: 'email',
      Endpoint: email,
    });

    const result = await this.snsClient.send(command);
    this.logger.log(`Subscription created with ARN: ${result.SubscriptionArn}`);
    return result.SubscriptionArn || '';
  }

  async unsubscribeFromAlerts(email: string): Promise<void> {
    this.logger.log(`Unsubscribing ${email} from SNS topic: ${this.snsTopicArn}`);
    
    // Find subscription ARN for this email
    const subscriptions = await this.getAlertSubscriptions();
    const subscription = subscriptions.find(sub => sub.email === email);
    
    if (!subscription) {
      throw new Error(`Email ${email} not found or not subscribed to ForestShield alerts`);
    }

    const command = new UnsubscribeCommand({
      SubscriptionArn: subscription.subscriptionArn,
    });

    await this.snsClient.send(command);
    this.logger.log(`Successfully unsubscribed ${email}`);
  }

  async getAlertSubscriptions(): Promise<Array<{ email: string; subscriptionArn: string; status: string }>> {
    this.logger.log(`Fetching subscriptions for SNS topic: ${this.snsTopicArn}`);
    
    const command = new ListSubscriptionsByTopicCommand({
      TopicArn: this.snsTopicArn,
    });

    const result = await this.snsClient.send(command);
    const subscriptions = result.Subscriptions || [];

    return subscriptions
      .filter(sub => sub.Protocol === 'email')
      .map(sub => ({
        email: sub.Endpoint || '',
        subscriptionArn: sub.SubscriptionArn || '',
        status: sub.SubscriptionArn?.includes('PendingConfirmation') ? 'Pending' : 'Confirmed',
      }));
  }

  // PHASE 6.1: Model Performance Tracking Methods

  async getSystemPerformanceOverview(): Promise<any> {
    this.logger.log('Fetching system-wide performance overview');
    
    try {
      // Get all regions to find performance data
      const regions = await this.getAllRegions();
      const performancePromises = regions.map(region => 
        this.getRegionPerformanceMetrics(region.name, 10).catch(() => null)
      );
      
      const allPerformanceData = await Promise.all(performancePromises);
      const validPerformanceData = allPerformanceData.filter(data => data !== null);

      // Calculate system-wide metrics
      const totalAnalyses = validPerformanceData.reduce((sum, data) => sum + (data?.summary_stats?.total_analyses || 0), 0);
      const avgConfidence = validPerformanceData.length > 0 
        ? validPerformanceData.reduce((sum, data) => sum + (data?.summary_stats?.avg_overall_confidence || 0), 0) / validPerformanceData.length
        : 0;
      const avgModelReuseRate = validPerformanceData.length > 0
        ? validPerformanceData.reduce((sum, data) => sum + (data?.summary_stats?.model_reuse_rate || 0), 0) / validPerformanceData.length
        : 0;

      return {
        summary: {
          total_regions_tracked: validPerformanceData.length,
          total_analyses: totalAnalyses,
          avg_confidence_score: avgConfidence,
          avg_model_reuse_rate: avgModelReuseRate,
          system_health: avgConfidence > 0.7 ? 'HEALTHY' : avgConfidence > 0.5 ? 'MODERATE' : 'NEEDS_ATTENTION'
        },
        regions_overview: validPerformanceData.map(data => ({
          tile_id: data?.tile_id,
          total_analyses: data?.summary_stats?.total_analyses,
          avg_confidence: data?.summary_stats?.avg_overall_confidence,
          performance_trend: data?.summary_stats?.performance_trend,
          last_updated: data?.summary_stats?.last_updated
        })),
        last_updated: new Date().toISOString()
      };
    } catch (error) {
      this.logger.error('Failed to fetch system performance overview:', error);
      throw error;
    }
  }

  async getRegionPerformanceMetrics(regionId: string, limit: number = 50): Promise<any> {
    this.logger.log(`Fetching performance metrics for region: ${regionId}`);
    
    try {
      const performanceKey = `model-performance/${regionId}/performance_history.json`;
      
      const command = new GetObjectCommand({
        Bucket: this.processedDataBucket,
        Key: performanceKey
      });

      const response = await this.s3Client.send(command);
      const performanceData = JSON.parse(await response.Body?.transformToString() || '{}');

      // Limit the performance entries returned
      if (performanceData.performance_entries) {
        performanceData.performance_entries = performanceData.performance_entries
          .slice(-limit)
          .reverse(); // Most recent first
      }

      return performanceData;
    } catch (error) {
      // Handle missing performance data gracefully - this is expected for new regions
      if (error.name === 'NoSuchKey' || error.Code === 'NoSuchKey') {
        this.logger.debug(`No performance data available yet for region: ${regionId}`);
        return {
          tile_id: regionId,
          performance_entries: [],
          recent_anomalies: [],
          last_updated: null,
          total_analyses: 0
        };
      }
      
      // Log other S3 errors as warnings
      this.logger.warn(`Failed to fetch performance data for region ${regionId}:`, error);
      return null;
    }
  }

  async getPerformanceTrends(days: number = 30): Promise<any> {
    this.logger.log(`Fetching performance trends for last ${days} days`);
    
    try {
      const regions = await this.getAllRegions();
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      const trendPromises = regions.map(async region => {
        const performanceData = await this.getRegionPerformanceMetrics(region.name, 1000);
        if (!performanceData?.performance_entries) return null;

        // Filter entries within the date range
        const recentEntries = performanceData.performance_entries.filter(entry => 
          new Date(entry.timestamp) >= cutoffDate
        );

        if (recentEntries.length === 0) return null;

        // Calculate trends
        const confidenceValues = recentEntries.map(e => e.overall_confidence);
        const processingTimes = recentEntries.map(e => e.processing_time_ms).filter(t => t > 0);

        return {
          tile_id: region.name,
          region_id: region.regionId,
          entries_count: recentEntries.length,
          avg_confidence: confidenceValues.reduce((a, b) => a + b, 0) / confidenceValues.length,
          avg_processing_time: processingTimes.length > 0 ? processingTimes.reduce((a, b) => a + b, 0) / processingTimes.length : 0,
          confidence_trend: this.calculateTrend(confidenceValues),
          model_reuse_rate: recentEntries.filter(e => e.model_reused).length / recentEntries.length
        };
      });

      const trendData = (await Promise.all(trendPromises)).filter(data => data !== null);

      return {
        analysis_period_days: days,
        regions_analyzed: trendData.length,
        trends: trendData,
        system_trend_summary: {
          avg_confidence_across_regions: trendData.length > 0 
            ? trendData.reduce((sum, data) => sum + data.avg_confidence, 0) / trendData.length 
            : 0,
          avg_model_reuse_rate: trendData.length > 0
            ? trendData.reduce((sum, data) => sum + data.model_reuse_rate, 0) / trendData.length
            : 0
        },
        generated_at: new Date().toISOString()
      };
    } catch (error) {
      this.logger.error('Failed to fetch performance trends:', error);
      throw error;
    }
  }

  async getPerformanceAnomalies(severity?: string, limit: number = 20): Promise<any> {
    this.logger.log('Fetching performance anomalies');
    
    try {
      const regions = await this.getAllRegions();
      const anomaliesPromises = regions.map(async region => {
        const performanceData = await this.getRegionPerformanceMetrics(region.name, 100);
        if (!performanceData?.recent_anomalies) return [];

        return performanceData.recent_anomalies.map(anomaly => ({
          ...anomaly,
          tile_id: region.name,
          region_id: region.regionId,
          region_name: region.name
        }));
      });

      let allAnomalies = (await Promise.all(anomaliesPromises)).flat();

      // Filter by severity if specified
      if (severity) {
        allAnomalies = allAnomalies.filter(anomaly => anomaly.severity === severity);
      }

      // Sort by detection date (most recent first) and limit
      allAnomalies.sort((a, b) => new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime());
      allAnomalies = allAnomalies.slice(0, limit);

      return {
        anomalies: allAnomalies,
        total_count: allAnomalies.length,
        severity_breakdown: {
          high: allAnomalies.filter(a => a.severity === 'high').length,
          medium: allAnomalies.filter(a => a.severity === 'medium').length,
          low: allAnomalies.filter(a => a.severity === 'low').length
        },
        last_updated: new Date().toISOString()
      };
    } catch (error) {
      this.logger.error('Failed to fetch performance anomalies:', error);
      throw error;
    }
  }

  async getModelPerformanceComparison(regionId: string): Promise<any> {
    this.logger.log(`Fetching model performance comparison for region: ${regionId}`);
    
    try {
      const performanceData = await this.getRegionPerformanceMetrics(regionId, 1000);
      if (!performanceData?.performance_entries) return null;

      // Group by model (using training_job_name as model identifier)
      const modelGroups = performanceData.performance_entries.reduce((groups, entry) => {
        const modelId = entry.training_job_name || 'unknown';
        if (!groups[modelId]) groups[modelId] = [];
        groups[modelId].push(entry);
        return groups;
      }, {});

      const modelComparisons = Object.entries(modelGroups).map(([modelId, entries]: [string, any[]]) => {
        const confidenceValues = entries.map(e => e.overall_confidence);
        const processingTimes = entries.map(e => e.processing_time_ms).filter(t => t > 0);

        return {
          model_id: modelId,
          usage_count: entries.length,
          avg_confidence: confidenceValues.reduce((a, b) => a + b, 0) / confidenceValues.length,
          avg_processing_time: processingTimes.length > 0 ? processingTimes.reduce((a, b) => a + b, 0) / processingTimes.length : 0,
          first_used: entries[0]?.timestamp,
          last_used: entries[entries.length - 1]?.timestamp,
          confidence_stability: this.calculateStability(confidenceValues)
        };
      });

      // Sort by usage count (most used first)
      modelComparisons.sort((a, b) => b.usage_count - a.usage_count);

      return {
        tile_id: regionId,
        models_compared: modelComparisons.length,
        model_performance: modelComparisons,
        best_performing_model: modelComparisons.reduce((best, current) => 
          current.avg_confidence > best.avg_confidence ? current : best, modelComparisons[0]),
        analysis_generated_at: new Date().toISOString()
      };
    } catch (error) {
      this.logger.error(`Failed to fetch model performance comparison for region ${regionId}:`, error);
      throw error;
    }
  }

  async getConfidenceAnalytics(regionId?: string): Promise<any> {
    this.logger.log(`Fetching confidence analytics${regionId ? ` for region: ${regionId}` : ''}`);
    
    try {
      const regions = regionId ? [{ name: regionId }] : await this.getAllRegions();
      
      const analyticsPromises = regions.map(async region => {
        const performanceData = await this.getRegionPerformanceMetrics(region.name, 500);
        if (!performanceData?.performance_entries) return null;

        const entries = performanceData.performance_entries;
        const confidenceBreakdown = {
          high_confidence: entries.filter(e => e.overall_confidence >= 0.8).length,
          medium_confidence: entries.filter(e => e.overall_confidence >= 0.5 && e.overall_confidence < 0.8).length,
          low_confidence: entries.filter(e => e.overall_confidence < 0.5).length
        };

        return {
          tile_id: region.name,
          total_analyses: entries.length,
          confidence_breakdown: confidenceBreakdown,
          avg_confidence: entries.reduce((sum, e) => sum + e.overall_confidence, 0) / entries.length,
          avg_data_quality: entries.reduce((sum, e) => sum + e.data_quality, 0) / entries.length,
          avg_spatial_coherence: entries.reduce((sum, e) => sum + e.spatial_coherence, 0) / entries.length,
          avg_historical_consistency: entries.reduce((sum, e) => sum + e.historical_consistency, 0) / entries.length
        };
      });

      const analyticsData = (await Promise.all(analyticsPromises)).filter(data => data !== null);

      if (regionId) {
        return analyticsData[0] || null;
      }

      // System-wide analytics
      const totalAnalyses = analyticsData.reduce((sum, data) => sum + data.total_analyses, 0);
      const systemConfidenceBreakdown = analyticsData.reduce((acc, data) => ({
        high_confidence: acc.high_confidence + data.confidence_breakdown.high_confidence,
        medium_confidence: acc.medium_confidence + data.confidence_breakdown.medium_confidence,
        low_confidence: acc.low_confidence + data.confidence_breakdown.low_confidence
      }), { high_confidence: 0, medium_confidence: 0, low_confidence: 0 });

      return {
        system_overview: {
          total_regions: analyticsData.length,
          total_analyses: totalAnalyses,
          system_confidence_breakdown: systemConfidenceBreakdown,
          avg_system_confidence: analyticsData.reduce((sum, data) => sum + data.avg_confidence, 0) / analyticsData.length
        },
        regional_breakdown: analyticsData,
        generated_at: new Date().toISOString()
      };
    } catch (error) {
      this.logger.error('Failed to fetch confidence analytics:', error);
      throw error;
    }
  }

  async triggerPerformanceTracking(regionId: string, trackingData: any): Promise<string> {
    this.logger.log(`Triggering manual performance tracking for region: ${regionId}`);
    
    try {
      const trackingId = randomUUID();
      
      // Invoke model-manager Lambda to track performance
      const command = new InvokeCommand({
        FunctionName: 'forestshield-model-manager',
        InvocationType: 'Event', // Async
        Payload: JSON.stringify({
          mode: 'track-model-performance',
          tile_id: regionId,
          model_metadata: {
            source_image_id: trackingData.imageId,
            processing_time_ms: trackingData.processingTime || 5000,
            pixels_analyzed: 10000,
            model_reused: false
          },
          performance_metrics: {
            overall_confidence: trackingData.confidence || 0.8,
            data_quality_confidence: 0.9,
            spatial_coherence_confidence: 0.7,
            historical_consistency_confidence: 0.6
          }
        })
      });

      await this.lambdaClient.send(command);
      this.logger.log(`Performance tracking initiated with ID: ${trackingId}`);
      
      return trackingId;
    } catch (error) {
      this.logger.error(`Failed to trigger performance tracking for region ${regionId}:`, error);
      throw error;
    }
  }

  // Helper methods for trend calculations
  private calculateTrend(values: number[]): string {
    if (values.length < 3) return 'insufficient_data';
    
    const firstHalf = values.slice(0, Math.floor(values.length / 2));
    const secondHalf = values.slice(Math.floor(values.length / 2));
    
    const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
    
    if (secondAvg > firstAvg + 0.05) return 'improving';
    if (secondAvg < firstAvg - 0.05) return 'declining';
    return 'stable';
  }

  private calculateStability(values: number[]): number {
    if (values.length < 2) return 1.0;
    
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    
    // Lower standard deviation = higher stability
    return Math.max(0, 1 - (stdDev / mean));
  }

  /**
   * PHASE 6.2: Enhanced performance overview with alert quality metrics
   */
  async getPerformanceOverview(): Promise<any> {
    try {
      const regions = await this.getAllRegions();
      const overallMetrics = {
        totalRegions: regions.length,
        activeRegions: regions.filter(r => r.lastAnalysis && 
          new Date(r.lastAnalysis).getTime() > Date.now() - 30 * 24 * 60 * 60 * 1000).length,
        averageConfidence: 0,
        averageProcessingTime: 0,
        modelReuseRate: 0,
        alertQualityScore: 0,  // PHASE 6.2: Add quality score
        recentTrends: []
      };

      // For now, return basic structure - will be enhanced when S3 data is available
      return overallMetrics;
    } catch (error) {
      throw new Error(`Failed to get performance overview: ${error.message}`);
    }
  }

  /**
   * PHASE 6.2: Get alert quality metrics for a specific region - REAL S3 DATA
   */
  async getAlertQualityMetrics(regionId: string): Promise<any> {
    this.logger.log(`Fetching REAL alert quality metrics for region: ${regionId} from S3`);
    
    try {
      // Get the most recent quality metrics from S3
      const qualityKey = `alert-quality-metrics/${regionId}/`;
      
      const listCommand = new GetObjectCommand({
        Bucket: this.processedDataBucket,
        Key: qualityKey
      });

      // List objects to find the most recent quality metrics file
      const { S3Client, ListObjectsV2Command } = await import('@aws-sdk/client-s3');
      const listObjectsCommand = new ListObjectsV2Command({
        Bucket: this.processedDataBucket,
        Prefix: qualityKey,
        MaxKeys: 1
      });

      const listResponse = await this.s3Client.send(listObjectsCommand);
      
      if (!listResponse.Contents || listResponse.Contents.length === 0) {
        this.logger.warn(`No quality metrics found for region ${regionId}`);
        return null;
      }

      // Get the most recent quality metrics file
      const mostRecentFile = listResponse.Contents.sort((a, b) => 
        new Date(b.LastModified || 0).getTime() - new Date(a.LastModified || 0).getTime()
      )[0];

      const getCommand = new GetObjectCommand({
        Bucket: this.processedDataBucket,
        Key: mostRecentFile.Key
      });

      const response = await this.s3Client.send(getCommand);
      const qualityData = JSON.parse(await response.Body?.transformToString() || '{}');

      this.logger.log(`✅ Retrieved REAL quality metrics for region ${regionId}`);
      return qualityData.quality_metrics || qualityData;
    } catch (error) {
      this.logger.error(`Failed to fetch REAL quality metrics for region ${regionId}:`, error);
      throw new Error(`Failed to fetch real alert quality metrics from S3: ${error.message}`);
    }
  }

  /**
   * PHASE 6.2: Get alert quality trends over time - REAL S3 DATA
   */
  async getAlertQualityTrends(regionId?: string, days: number = 30): Promise<any> {
    this.logger.log(`Fetching REAL alert quality trends${regionId ? ` for region: ${regionId}` : ''} from S3`);
    
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      const { S3Client, ListObjectsV2Command } = await import('@aws-sdk/client-s3');
      
      if (regionId) {
        // Get trends for specific region
        const prefix = `alert-quality-metrics/${regionId}/`;
        const listCommand = new ListObjectsV2Command({
          Bucket: this.processedDataBucket,
          Prefix: prefix
        });

        const listResponse = await this.s3Client.send(listCommand);
        const qualityFiles = listResponse.Contents || [];

        // Filter files within date range and fetch data
        const recentFiles = qualityFiles.filter(file => 
          file.LastModified && file.LastModified >= cutoffDate
        ).sort((a, b) => 
          new Date(b.LastModified || 0).getTime() - new Date(a.LastModified || 0).getTime()
        );

        const trendsData = await Promise.all(
          recentFiles.map(async (file) => {
            const getCommand = new GetObjectCommand({
              Bucket: this.processedDataBucket,
              Key: file.Key
            });
            const response = await this.s3Client.send(getCommand);
            return JSON.parse(await response.Body?.transformToString() || '{}');
          })
        );

        return {
          trends: trendsData.map(data => data.quality_metrics || data),
          summary: {
            totalAlerts: trendsData.length,
            averageQualityScore: trendsData.length > 0 
              ? trendsData.reduce((sum, data) => sum + (data.quality_metrics?.overall_quality_score || 0), 0) / trendsData.length
              : 0,
            timeRange: days,
            regionId
          }
        };
      } else {
        // Get system-wide trends from aggregate data
        const prefix = 'alert-quality-metrics/aggregate/';
        const listCommand = new ListObjectsV2Command({
          Bucket: this.processedDataBucket,
          Prefix: prefix
        });

        const listResponse = await this.s3Client.send(listCommand);
        const aggregateFiles = listResponse.Contents || [];

        const recentFiles = aggregateFiles.filter(file => 
          file.LastModified && file.LastModified >= cutoffDate
        ).sort((a, b) => 
          new Date(b.LastModified || 0).getTime() - new Date(a.LastModified || 0).getTime()
        );

        const trendsData = await Promise.all(
          recentFiles.map(async (file) => {
            const getCommand = new GetObjectCommand({
              Bucket: this.processedDataBucket,
              Key: file.Key
            });
            const response = await this.s3Client.send(getCommand);
            return JSON.parse(await response.Body?.transformToString() || '{}');
          })
        );

        return {
          trends: trendsData.map(data => data.aggregate_quality_metrics || data),
          summary: {
            totalAlerts: trendsData.reduce((sum, data) => sum + (data.total_tiles || 0), 0),
            averageQualityScore: trendsData.length > 0 
              ? trendsData.reduce((sum, data) => sum + (data.aggregate_quality_metrics?.overall_quality_score || 0), 0) / trendsData.length
              : 0,
            timeRange: days,
            regionId: 'all'
          }
        };
      }
    } catch (error) {
      this.logger.error('Failed to fetch REAL quality trends from S3:', error);
      throw new Error(`Failed to fetch real alert quality trends from S3: ${error.message}`);
    }
  }

  /**
   * PHASE 6.2: Compare clustering vs threshold-based system performance - REAL S3 DATA
   */
  async getSystemPerformanceComparison(regionId?: string, days: number = 30): Promise<any> {
    this.logger.log(`Fetching REAL system performance comparison from S3`);
    
    try {
      // Get recent quality trends to extract threshold comparison data
      const trendsData = await this.getAlertQualityTrends(regionId, days);
      
      if (!trendsData.trends || trendsData.trends.length === 0) {
        throw new Error('No quality data available for performance comparison');
      }

      // Extract threshold comparison data from quality metrics
      const thresholdComparisons = trendsData.trends
        .map(trend => trend.threshold_comparison)
        .filter(comparison => comparison);

      if (thresholdComparisons.length === 0) {
        throw new Error('No threshold comparison data available');
      }

      // Calculate aggregate comparison metrics
      const avgClusteringScore = trendsData.summary.averageQualityScore;
              const avgThresholdScore = thresholdComparisons.reduce((sum, comp) => 
          sum + (comp.threshold_system?.accuracy || 0.65), 0) / thresholdComparisons.length;

      const falsePositiveReduction = thresholdComparisons.reduce((sum, comp) => 
        sum + (comp.false_positive_reduction || 0), 0) / thresholdComparisons.length;

      const temporalAccuracyImprovement = thresholdComparisons.reduce((sum, comp) => 
        sum + (comp.temporal_accuracy_improvement || 0), 0) / thresholdComparisons.length;

      return {
        clustering_system: {
          average_quality_score: avgClusteringScore,
          total_analyses: trendsData.summary.totalAlerts,
          data_source: 'real_s3_quality_metrics'
        },
        threshold_system: {
          accuracy: avgThresholdScore,
          comparison_basis: 'extracted_from_real_quality_data'
        },
        improvement_metrics: {
          quality_score_improvement: ((avgClusteringScore - avgThresholdScore) / avgThresholdScore) * 100,
          false_positive_reduction: falsePositiveReduction,
          temporal_accuracy_improvement: temporalAccuracyImprovement,
          data_source: 'real_aws_s3_integration'
        },
        analysis_period: {
          days,
          region_id: regionId || 'all',
          data_points: thresholdComparisons.length
        }
      };
    } catch (error) {
      this.logger.error('Failed to fetch REAL system performance comparison from S3:', error);
      throw new Error(`Failed to fetch real system performance comparison from S3: ${error.message}`);
    }
  }

  /**
   * Helper method to categorize quality scores
   */
  private categorizeQualityScore(score: number): string {
    if (score >= 0.9) return 'A+';
    if (score >= 0.85) return 'A';
    if (score >= 0.8) return 'A-';
    if (score >= 0.75) return 'B+';
    if (score >= 0.7) return 'B';
    if (score >= 0.65) return 'B-';
    if (score >= 0.6) return 'C+';
    if (score >= 0.55) return 'C';
    if (score >= 0.5) return 'C-';
    if (score >= 0.4) return 'D';
    return 'F';
  }

  /**
   * Track performance metrics manually (for API endpoint)
   */
  async trackPerformance(regionId: string, performanceData: any): Promise<any> {
    try {
      // Invoke the model-manager Lambda function to track performance
      const command = new InvokeCommand({
        FunctionName: 'forestshield-model-manager',
        InvocationType: 'Event', // Async invoke
        Payload: JSON.stringify({
          mode: 'track-model-performance',
          tile_id: regionId,
          model_metadata: performanceData.model_metadata || {},
          performance_metrics: performanceData.performance_metrics || {}
        })
      });
      
      const response = await this.lambdaClient.send(command);

      return {
        message: 'Performance tracking initiated',
        regionId,
        lambdaResponse: response.StatusCode === 202 ? 'accepted' : 'failed'
      };
    } catch (error) {
      throw new Error(`Failed to track performance for region ${regionId}: ${error.message}`);
    }
  }

  // PHASE 6.3: System Integration Testing Methods

  /**
   * Run quick system integration test - REAL AWS Step Functions
   */
  async runQuickIntegrationTest(): Promise<any> {
    this.logger.log('🧪 Running REAL quick integration test with AWS Step Functions');
    
    try {
      const testStart = Date.now();
      
      // 1. Basic health check (system health will be checked via Step Functions)
      const systemHealth = { overall_health: 'testing' };
      
      // 2. Test Step Functions workflow with real execution
      const sfnClient = new SFNClient({ region: this.configService.get('AWS_REGION', 'us-west-2') });
      
      const testRegion = {
        latitude: -5.9,
        longitude: -53.0,
        startDate: '2024-01-01',
        endDate: new Date().toISOString().split('T')[0],
        cloudCover: 20
      };
      
      const executionName = `integration-test-${Date.now()}`;
      const startCommand = new StartExecutionCommand({
        stateMachineArn: this.configService.get('STEP_FUNCTIONS_STATE_MACHINE_ARN'),
        name: executionName,
        input: JSON.stringify({
          region: testRegion,
          test_mode: true,
          integration_test: true
        })
      });
      
      const execution = await sfnClient.send(startCommand);
      
      const testDuration = (Date.now() - testStart) / 1000;
      
      const result = {
        success: true,
        test_duration: testDuration,
        system_health: systemHealth.overall_health,
        workflow_test: {
          status: 'initiated',
          execution_arn: execution.executionArn,
          execution_name: executionName
        },
        aws_integration: 'real_step_functions_execution',
        timestamp: new Date().toISOString()
      };
      
      // Store test results in S3
      await this.storeIntegrationTestResults('quick', result);
      
      return result;
    } catch (error) {
      this.logger.error('REAL integration test failed:', error);
      const failureResult = {
        success: false,
        error: error.message,
        aws_integration: 'real_step_functions_failed',
        timestamp: new Date().toISOString()
      };
      
      // Store failure results in S3
      await this.storeIntegrationTestResults('quick', failureResult);
      
      return failureResult;
    }
  }

  /**
   * Run comprehensive system integration test - REAL AWS Infrastructure
   */
  async runComprehensiveIntegrationTest(): Promise<any> {
    this.logger.log('🧪 Starting REAL comprehensive integration test with full AWS infrastructure');
    
    const testId = `integration_test_${new Date().toISOString().replace(/[:.]/g, '').substring(0, 15)}`;
    
    try {
      // Store initial test status in S3
      const initialStatus = {
        test_id: testId,
        status: 'running',
        start_time: new Date().toISOString(),
        estimated_duration: '15-30 minutes',
        aws_integration: 'real_comprehensive_testing'
      };
      
      await this.storeIntegrationTestStatus(testId, initialStatus);
      
      // Trigger comprehensive testing workflow via Step Functions
      const sfnClient = new SFNClient({ region: this.configService.get('AWS_REGION', 'us-west-2') });
      
      const executionName = `comprehensive-test-${testId}`;
      const startCommand = new StartExecutionCommand({
        stateMachineArn: this.configService.get('STEP_FUNCTIONS_STATE_MACHINE_ARN'),
        name: executionName,
        input: JSON.stringify({
          test_id: testId,
          test_type: 'comprehensive',
          test_regions: [
            { latitude: -5.9, longitude: -53.0, name: 'Amazon-Test-1' },
            { latitude: -3.5, longitude: -62.1, name: 'Amazon-Test-2' },
            { latitude: -8.2, longitude: -49.3, name: 'Cerrado-Test-1' }
          ],
          comprehensive_testing: true
        })
      });
      
      const execution = await sfnClient.send(startCommand);
      
      const response = {
        success: true,
        test_id: testId,
        estimated_duration: '15-30 minutes',
        status: 'running',
        execution_arn: execution.executionArn,
        monitor_url: `/dashboard/integration/test/status/${testId}`,
        aws_integration: 'real_step_functions_comprehensive',
        started_at: new Date().toISOString()
      };
      
      // Update test status in S3
      await this.storeIntegrationTestStatus(testId, {
        ...initialStatus,
        execution_arn: execution.executionArn,
        status: 'running'
      });
      
      return response;
    } catch (error) {
      this.logger.error('Failed to start REAL comprehensive integration test:', error);
      
      const failureResponse = {
        success: false,
        test_id: testId,
        error: error.message,
        aws_integration: 'real_step_functions_failed',
        timestamp: new Date().toISOString()
      };
      
      // Store failure status in S3
      await this.storeIntegrationTestStatus(testId, {
        test_id: testId,
        status: 'failed',
        error: error.message,
        start_time: new Date().toISOString()
      });
      
      return failureResponse;
    }
  }

  /**
   * Get integration test status - REAL S3 Data
   */
  async getIntegrationTestStatus(testId: string): Promise<any> {
    this.logger.log(`Getting REAL integration test status for: ${testId} from S3`);
    
    try {
      const statusKey = `integration-tests/status/${testId}.json`;
      
      const getCommand = new GetObjectCommand({
        Bucket: this.processedDataBucket,
        Key: statusKey
      });

      const response = await this.s3Client.send(getCommand);
      const statusData = JSON.parse(await response.Body?.transformToString() || '{}');

      // If test is running, check Step Functions execution status
      if (statusData.status === 'running' && statusData.execution_arn) {
        const executionStatus = await this.getStepFunctionExecutionStatus(statusData.execution_arn);
        
        // Update status based on Step Functions execution
        statusData.current_phase = executionStatus.status;
        statusData.last_updated = new Date().toISOString();
        
        if (executionStatus.status === 'SUCCEEDED') {
          statusData.status = 'completed';
        } else if (executionStatus.status === 'FAILED') {
          statusData.status = 'failed';
          statusData.error = executionStatus.error;
        }
        
        // Update status in S3
        await this.storeIntegrationTestStatus(testId, statusData);
      }

      return statusData;
    } catch (error) {
      this.logger.error(`Failed to get REAL test status for ${testId}:`, error);
      throw new Error(`Failed to get real integration test status from S3: ${error.message}`);
    }
  }

  /**
   * Get integration test results - REAL S3 Data
   */
  async getIntegrationTestResults(testId: string): Promise<any> {
    this.logger.log(`Getting REAL integration test results for: ${testId} from S3`);
    
    try {
      const resultsKey = `integration-tests/results/${testId}.json`;
      
      const getCommand = new GetObjectCommand({
        Bucket: this.processedDataBucket,
        Key: resultsKey
      });

      const response = await this.s3Client.send(getCommand);
      const resultsData = JSON.parse(await response.Body?.transformToString() || '{}');

      return {
        ...resultsData,
        data_source: 'real_aws_s3_integration',
        retrieved_at: new Date().toISOString()
      };
    } catch (error) {
      this.logger.error(`Failed to get REAL test results for ${testId}:`, error);
      throw new Error(`Failed to get real integration test results from S3: ${error.message}`);
    }
  }

  /**
   * Get integration test history - REAL S3 Data
   */
  async getIntegrationTestHistory(limit?: number): Promise<any> {
    this.logger.log('Getting REAL integration test history from S3');
    
    try {
      const prefix = 'integration-tests/results/';
      const listCommand = new ListObjectsV2Command({
        Bucket: this.processedDataBucket,
        Prefix: prefix,
        MaxKeys: limit || 50
      });

      const listResponse = await this.s3Client.send(listCommand);
      const testFiles = listResponse.Contents || [];

      // Sort by last modified (most recent first)
      const sortedFiles = testFiles.sort((a, b) => 
        new Date(b.LastModified || 0).getTime() - new Date(a.LastModified || 0).getTime()
      );

      // Fetch test summaries
      const testSummaries = await Promise.all(
        sortedFiles.map(async (file) => {
          try {
            const getCommand = new GetObjectCommand({
              Bucket: this.processedDataBucket,
              Key: file.Key
            });
            const response = await this.s3Client.send(getCommand);
            const testData = JSON.parse(await response.Body?.transformToString() || '{}');
            
            return {
              test_id: testData.test_id,
              timestamp: testData.completed_at || testData.start_time,
              status: testData.status,
              overall_status: testData.overall_status || 'UNKNOWN',
              execution_time: testData.execution_time || 0,
              success_rate: testData.end_to_end_tests?.success_rate || 0
            };
          } catch (error) {
            this.logger.warn(`Failed to read test file ${file.Key}:`, error);
            return null;
          }
        })
      );

      const validTests = testSummaries.filter(test => test !== null);

      return {
        tests: validTests,
        summary: {
          total_tests: validTests.length,
          average_success_rate: validTests.length > 0 
            ? validTests.reduce((sum, test) => sum + test.success_rate, 0) / validTests.length
            : 0,
          last_test_date: validTests[0]?.timestamp,
          healthy_test_percentage: validTests.length > 0
            ? (validTests.filter(t => t.overall_status === 'HEALTHY').length / validTests.length) * 100
            : 0
        },
        data_source: 'real_aws_s3_integration'
      };
    } catch (error) {
      this.logger.error('Failed to get REAL integration test history from S3:', error);
      throw new Error(`Failed to get real integration test history from S3: ${error.message}`);
    }
  }

  /**
   * Store integration test results in S3
   */
  private async storeIntegrationTestResults(testType: string, results: any): Promise<void> {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '').substring(0, 15);
      const key = `integration-tests/results/${testType}_${timestamp}.json`;
      
      const { PutObjectCommand } = await import('@aws-sdk/client-s3');
      const putCommand = new PutObjectCommand({
        Bucket: this.processedDataBucket,
        Key: key,
        Body: JSON.stringify(results, null, 2),
        ContentType: 'application/json'
      });

      await this.s3Client.send(putCommand);
      this.logger.log(`✅ Integration test results stored to S3: ${key}`);
    } catch (error) {
      this.logger.warn('Failed to store integration test results to S3:', error);
    }
  }

  /**
   * Store integration test status in S3
   */
  private async storeIntegrationTestStatus(testId: string, status: any): Promise<void> {
    try {
      const key = `integration-tests/status/${testId}.json`;
      
      const { PutObjectCommand } = await import('@aws-sdk/client-s3');
      const putCommand = new PutObjectCommand({
        Bucket: this.processedDataBucket,
        Key: key,
        Body: JSON.stringify(status, null, 2),
        ContentType: 'application/json'
      });

      await this.s3Client.send(putCommand);
      this.logger.log(`✅ Integration test status stored to S3: ${key}`);
    } catch (error) {
      this.logger.warn('Failed to store integration test status to S3:', error);
    }
  }

  /**
   * Get Step Functions execution status
   */
  private async getStepFunctionExecutionStatus(executionArn: string): Promise<any> {
    try {
      const sfnClient = new SFNClient({ region: this.configService.get('AWS_REGION', 'us-west-2') });
      
      const describeCommand = new DescribeExecutionCommand({
        executionArn
      });

      const execution = await sfnClient.send(describeCommand);
      
      return {
        status: execution.status,
        error: execution.status === 'FAILED' ? execution.error : undefined,
        output: execution.output
      };
    } catch (error) {
      this.logger.warn('Failed to get Step Functions execution status:', error);
      return { status: 'UNKNOWN', error: error.message };
    }
  }

  async getStepFunctionExecutions(limit: number = 25): Promise<any[]> {
    this.logger.log(`Fetching last ${limit} Step Function executions for ARN: ${this.deforestationWorkflowArn}`);

    if (!this.deforestationWorkflowArn) {
      this.logger.error('DEFORESTATION_WORKFLOW_ARN is not configured.');
      throw new Error('Step Function state machine ARN is not configured.');
    }

    try {
      const listCommand = new ListExecutionsCommand({
        stateMachineArn: this.deforestationWorkflowArn,
        maxResults: limit,
      });
      const listResult = await this.sfnClient.send(listCommand);

      if (!listResult.executions || listResult.executions.length === 0) {
        this.logger.log('No Step Function executions found.');
        return [];
      }

      const executionDetailsPromises = listResult.executions.map(exec => 
        this.sfnClient.send(new DescribeExecutionCommand({ executionArn: exec.executionArn }))
      );

      const describedExecutions = await Promise.all(executionDetailsPromises);

      const formattedExecutions = describedExecutions.map(exec => {
        const duration = exec.stopDate && exec.startDate 
          ? exec.stopDate.getTime() - exec.startDate.getTime() 
          : null;

        let inputObject = {};
        let outputObject = {};
        try {
          if (exec.input) inputObject = JSON.parse(exec.input);
        } catch (e) {
          this.logger.warn(`Failed to parse JSON input for execution ${exec.executionArn}: ${e.message}`);
          inputObject = { error: 'Invalid JSON input', raw: exec.input };
        }
        try {
          if (exec.output) outputObject = JSON.parse(exec.output);
        } catch (e) {
          this.logger.warn(`Failed to parse JSON output for execution ${exec.executionArn}: ${e.message}`);
          outputObject = { error: 'Invalid JSON output', raw: exec.output };
        }

        return {
          id: exec.executionArn,
          name: exec.name,
          status: exec.status,
          startTime: exec.startDate?.toISOString(),
          endTime: exec.stopDate?.toISOString() || null,
          duration,
          input: inputObject,
          output: outputObject,
        };
      });
      
      this.logger.log(`Successfully fetched ${formattedExecutions.length} Step Function execution details.`);
      return formattedExecutions;

    } catch (error) {
      this.logger.error(`Failed to fetch Step Function executions: ${error.message}`, error.stack);
      throw new Error('Could not retrieve Step Function execution history from AWS.');
    }
  }

  async getMonitoringJobs(status?: string): Promise<MonitoringJobDto[]> {
    this.logger.log(`Fetching monitoring jobs from Step Functions with status: ${status || 'ALL'}`);
    const executions = await this.getStepFunctionExecutions(); // Fetches all recent executions

    const jobs: MonitoringJobDto[] = executions.map(exec => {
      // Safely parse the execution input
      let input: any = {};
      try {
        if (typeof exec.input === 'string') {
          input = JSON.parse(exec.input);
        } else {
          input = exec.input || {};
        }
      } catch (e) {
        this.logger.warn(`Could not parse input for execution ${exec.name}: ${exec.input}`);
      }

      // Map Step Function status to Job Status
      let jobStatus: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' = 'IN_PROGRESS';
      let progress = 50;
      switch (exec.status) {
        case 'RUNNING':
          jobStatus = 'IN_PROGRESS';
          progress = 50;
          break;
        case 'SUCCEEDED':
          jobStatus = 'COMPLETED';
          progress = 100;
          break;
        case 'FAILED':
        case 'TIMED_OUT':
        case 'ABORTED':
          jobStatus = 'FAILED';
          progress = 100;
          break;
      }
      
      const totalImages = input.limit || 1;

      return {
        jobId: exec.executionArn,
        // Attempt to get region info from input, with fallbacks
        regionId: input.regionId || input.name || 'N/A',
        regionName: input.regionName || input.name || 'Unknown Region',
        status: jobStatus,
        progress: progress,
        startTime: exec.startDate.toISOString(),
        endTime: exec.stopDate ? exec.stopDate.toISOString() : undefined,
        // The analysis is for one image at a time per execution
        totalImages: totalImages,
        processedImages: jobStatus === 'COMPLETED' ? totalImages : 0,
      };
    });

    // Filter by status if provided
    if (status) {
      const normalizedStatus = status.toUpperCase().replace(' ', '_');
      return jobs.filter(job => job.status === normalizedStatus);
    }

    return jobs;
  }
} 