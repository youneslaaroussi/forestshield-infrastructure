import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SentinelDataService, SearchParams, SentinelImage, NDVIResult } from './services/sentinel-data.service';
import { AWSService } from './services/aws.service';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

export interface ProcessingJob {
  jobId: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  progress: number;
  startTime: Date;
  endTime?: Date;
  results?: {
    imagesProcessed: number;
    deforestationPercentage: number;
    alertMessage: string;
    ndviResults: NDVIResult[];
    timeSeriesData: Array<{ date: string; vegetationPercentage: number }>;
  };
  error?: string;
}

@Injectable()
export class SentinelService {
  private readonly logger = new Logger(SentinelService.name);
  private readonly snsClient: SNSClient;
  private readonly processingJobs = new Map<string, ProcessingJob>();

  constructor(
    private readonly sentinelDataService: SentinelDataService,
    private readonly awsService: AWSService,
    private readonly configService: ConfigService,
  ) {
    const region = this.configService.get('AWS_REGION', 'us-east-1');
    this.snsClient = new SNSClient({ region });
  }

  async searchSentinelImages(params: SearchParams): Promise<SentinelImage[]> {
    this.logger.log(`Searching Sentinel-2 images for region: ${params.latitude}, ${params.longitude}`);
    
    const images = await this.sentinelDataService.searchImages(params);
    
    this.logger.log(`Found ${images.length} images for processing`);
    return images;
  }

  async startDeforestationProcessing(searchParams: SearchParams, maxImages: number = 10): Promise<string> {
    const jobId = `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    this.logger.log(`Starting deforestation processing job: ${jobId}`);
    
    // Initialize job tracking
    const job: ProcessingJob = {
      jobId,
      status: 'PENDING',
      progress: 0,
      startTime: new Date(),
    };
    
    this.processingJobs.set(jobId, job);
    
    // Start async processing
    this.processDeforestationAsync(jobId, searchParams, maxImages).catch(error => {
      this.logger.error(`Job ${jobId} failed: ${error.message}`);
      const failedJob = this.processingJobs.get(jobId);
      if (failedJob) {
        failedJob.status = 'FAILED';
        failedJob.error = error.message;
        failedJob.endTime = new Date();
      }
    });
    
    return jobId;
  }

  private async processDeforestationAsync(jobId: string, searchParams: SearchParams, maxImages: number): Promise<void> {
    const job = this.processingJobs.get(jobId);
    if (!job) return;

    try {
      // Update job status
      job.status = 'IN_PROGRESS';
      job.progress = 10;

      // Search for images
      this.logger.log(`Job ${jobId}: Searching for satellite images`);
      const allImages = await this.sentinelDataService.searchImages(searchParams);
      
      // Limit images for processing
      const images = allImages.slice(0, maxImages);
      this.logger.log(`Job ${jobId}: Processing ${images.length} images`);
      
      job.progress = 25;

      // Process images for vegetation analysis using NEW Python Lambda
      this.logger.log(`Job ${jobId}: Processing vegetation with Python analyzer`);
      const region = { latitude: searchParams.latitude, longitude: searchParams.longitude };
      const ndviResults = await this.sentinelDataService.processImagesForDeforestation(images, region);
      
      job.progress = 70;

      // Detect deforestation changes
      this.logger.log(`Job ${jobId}: Analyzing deforestation patterns`);
      const changeAnalysis = await this.sentinelDataService.detectDeforestationChanges(ndviResults);
      
      job.progress = 90;

      // Send alert if significant deforestation detected
      if (changeAnalysis.deforestationPercentage > 5) {
        await this.sendDeforestationAlert(changeAnalysis.alertMessage, searchParams);
      }

      // Complete job
      job.status = 'COMPLETED';
      job.progress = 100;
      job.endTime = new Date();
      job.results = {
        imagesProcessed: images.length,
        deforestationPercentage: changeAnalysis.deforestationPercentage,
        alertMessage: changeAnalysis.alertMessage,
        ndviResults: ndviResults,
        timeSeriesData: changeAnalysis.timeSeriesData,
      };

      this.logger.log(`Job ${jobId} completed successfully. Deforestation: ${changeAnalysis.deforestationPercentage}%`);

    } catch (error) {
      this.logger.error(`Job ${jobId} processing failed: ${error.message}`);
      job.status = 'FAILED';
      job.error = error.message;
      job.endTime = new Date();
      throw error;
    }
  }

  async getProcessingJobStatus(jobId: string): Promise<ProcessingJob | null> {
    const job = this.processingJobs.get(jobId);
    
    if (!job) {
      throw new Error(`Processing job ${jobId} not found`);
    }

    return job;
  }

  async analyzeRegionForDeforestation(searchParams: SearchParams): Promise<{
    imagesFound: number;
    analysisResults: {
      deforestationPercentage: number;
      alertMessage: string;
      timeSeriesData: Array<{ date: string; vegetationPercentage: number }>;
    };
    processingTime: string;
  }> {
    const startTime = Date.now();
    
    this.logger.log(`Analyzing region for deforestation: ${searchParams.latitude}, ${searchParams.longitude}`);
    
    // Search for images
    const images = await this.sentinelDataService.searchImages(searchParams);
    
    if (images.length === 0) {
      throw new Error('No satellite images found for the specified region and time period');
    }

    // Process first 5 images for quick analysis
    const imagesToProcess = images.slice(0, 5);
    
    // Process with NEW Python vegetation analyzer
    this.logger.log('🌱 Processing vegetation with Python analyzer');
    const region = { latitude: searchParams.latitude, longitude: searchParams.longitude };
    const ndviResults = await this.sentinelDataService.processImagesForDeforestation(imagesToProcess, region);
    
    // Detect changes
    const changeAnalysis = await this.sentinelDataService.detectDeforestationChanges(ndviResults);
    
    const processingTime = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;
    
    this.logger.log(`Region analysis completed in ${processingTime}. Deforestation: ${changeAnalysis.deforestationPercentage}%`);

    return {
      imagesFound: images.length,
      analysisResults: {
        deforestationPercentage: changeAnalysis.deforestationPercentage,
        alertMessage: changeAnalysis.alertMessage,
        timeSeriesData: changeAnalysis.timeSeriesData,
      },
      processingTime,
    };
  }

  private async sendDeforestationAlert(alertMessage: string, searchParams: SearchParams): Promise<void> {
    const snsTopicArn = this.configService.get<string>('SNS_DEFORESTATION_TOPIC_ARN');
    
    if (!snsTopicArn) {
      this.logger.warn('SNS_DEFORESTATION_TOPIC_ARN not configured, skipping alert');
      return;
    }

    const message = {
      alert: alertMessage,
      location: {
        latitude: searchParams.latitude,
        longitude: searchParams.longitude,
      },
      timeRange: {
        start: searchParams.startDate,
        end: searchParams.endDate,
      },
      timestamp: new Date().toISOString(),
      source: 'ForestShield Deforestation Detection System',
    };

    const command = new PublishCommand({
      TopicArn: snsTopicArn,
      Message: JSON.stringify(message, null, 2),
      Subject: '🚨 ForestShield Deforestation Alert',
    });

    try {
      await this.snsClient.send(command);
      this.logger.log('Deforestation alert sent successfully');
    } catch (error) {
      this.logger.error(`Failed to send deforestation alert: ${error.message}`);
      throw error;
    }
  }

  async triggerStepFunctionsWorkflow(searchParams: SearchParams): Promise<{ executionArn: string }> {
    const stateMachineArn = this.configService.get<string>('STEP_FUNCTIONS_STATE_MACHINE_ARN');
    
    if (!stateMachineArn) {
      throw new Error('STEP_FUNCTIONS_STATE_MACHINE_ARN environment variable is required');
    }

    const input = {
      searchParams,
      timestamp: new Date().toISOString(),
    };

    return this.awsService.startStepFunctionsExecution(stateMachineArn, input);
  }
} 