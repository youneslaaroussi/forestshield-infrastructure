import { Processor, Process } from '@nestjs/bull';
import { Logger, Injectable } from '@nestjs/common';
import { Job } from 'bull';
import { RegionAnalysisJob } from './queue.service';
import { SentinelService } from '../sentinel/sentinel.service';
import { DashboardService } from '../sentinel/services/dashboard.service';
import { AWSRealtimeGateway } from '../sentinel/aws-realtime.gateway';

@Injectable()
@Processor('region-analysis')
export class AnalysisProcessor {
  private readonly logger = new Logger(AnalysisProcessor.name);

  constructor(
    private readonly sentinelService: SentinelService,
    private readonly dashboardService: DashboardService,
    private readonly awsRealtimeGateway: AWSRealtimeGateway,
  ) {}

  @Process('analyze-region')
  async handleRegionAnalysis(job: Job<RegionAnalysisJob>) {
    const { regionId, latitude, longitude, cloudCoverThreshold } = job.data;
    
    this.logger.log(`🔄 Processing scheduled analysis job ${job.id} for region ${regionId}`);
    
    // Send initial notification
    this.awsRealtimeGateway.broadcastSystemEvent('analysis-started', {
      regionId,
      jobId: job.id,
      analysisType: 'scheduled'
    });
    
    try {
      // Update job progress
      await job.progress(10);

      this.logger.log(`📍 Running real deforestation analysis for region ${regionId} at coordinates: ${latitude}, ${longitude}`);
      
      // Get region details for alerts
      const region = await this.dashboardService.getRegionById(regionId);
      if (!region) {
        throw new Error(`Region ${regionId} not found in database`);
      }

      await job.progress(20);

      // **REAL ANALYSIS**: Use the actual SentinelService for analysis
      this.logger.log(`🛰️ Starting real satellite analysis via SentinelService...`);
      
      const analysisResult = await this.sentinelService.analyzeRegionForDeforestation({
        latitude,
        longitude,
        startDate: this.getStartDate(), // Last 30 days
        endDate: new Date().toISOString().split('T')[0], // Today
        cloudCover: cloudCoverThreshold,
      });

      await job.progress(80);

      const deforestationPercentage = analysisResult.analysisResults.deforestationPercentage;
      
      this.logger.log(`✅ Real analysis completed for region ${regionId} - Deforestation: ${deforestationPercentage}%`);

      // 1. Update region's lastAnalysis timestamp and deforestation percentage
      await this.dashboardService.updateRegion(regionId, { 
        lastAnalysis: new Date().toISOString(),
        lastDeforestationPercentage: deforestationPercentage
      });

      await job.progress(90);
      
      // 2. Create alert if deforestation is significant (>3% threshold)
      if (deforestationPercentage > 3) {
        this.logger.warn(`⚠️ Creating alert - significant deforestation detected: ${deforestationPercentage}%`);
        await this.dashboardService.createAlert(region, deforestationPercentage);
        
        // Send high-priority real-time alert
        this.awsRealtimeGateway.broadcastSystemEvent('deforestation-alert', {
          regionId,
          regionName: region.name,
          deforestationPercentage,
          alertLevel: deforestationPercentage > 10 ? 'HIGH' : deforestationPercentage > 5 ? 'MODERATE' : 'LOW',
          analysisType: 'scheduled'
        });
      }
      
      await job.progress(100);
      
      // 3. Send completion notification with results
      this.awsRealtimeGateway.broadcastSystemEvent('analysis-completed', {
        regionId,
        regionName: region.name,
        deforestationPercentage,
        imagesAnalyzed: analysisResult.imagesFound,
        processingTime: analysisResult.processingTime,
        analysisType: 'scheduled',
        completedAt: new Date().toISOString()
      });
      
      this.logger.log(`🎉 Scheduled analysis completed successfully for region ${regionId}`);
      
      return {
        success: true,
        regionId,
        deforestationPercentage,
        imagesAnalyzed: analysisResult.imagesFound,
        processingTime: analysisResult.processingTime,
        completedAt: new Date().toISOString(),
        analysisType: 'scheduled',
        alertCreated: deforestationPercentage > 3
      };
      
    } catch (error) {
      this.logger.error(`❌ Failed to process analysis job ${job.id} for region ${regionId}:`, error);
      
      // Send failure notification
      this.awsRealtimeGateway.broadcastSystemEvent('analysis-failed', {
        regionId,
        jobId: job.id,
        error: error.message,
        analysisType: 'scheduled',
        failedAt: new Date().toISOString()
      });
      
      throw error;
    }
  }

  /**
   * Get start date for analysis (30 days ago)
   */
  private getStartDate(): string {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return date.toISOString().split('T')[0];
  }

} 