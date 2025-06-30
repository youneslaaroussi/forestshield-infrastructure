import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { CronJob } from 'cron';

export interface RegionAnalysisJob {
  regionId: string;
  latitude: number;
  longitude: number;
  cloudCoverThreshold: number;
  cronExpression: string;
}

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);
  private cronJobs = new Map<string, CronJob>();
  private jobStates = new Map<string, boolean>();

  constructor(
    @InjectQueue('region-analysis')
    private readonly analysisQueue: Queue,
  ) {}

  /**
   * Start interval-based analysis for a region
   */
  async startRegionAnalysis(
    regionId: string,
    cronExpression: string,
    regionData: {
      latitude: number;
      longitude: number;
      cloudCoverThreshold: number;
    },
    triggerImmediate = false
  ): Promise<void> {
    this.logger.log(`Starting interval analysis for region ${regionId} with cron: ${cronExpression}`);

    // Stop existing cron job if it exists
    await this.stopRegionAnalysis(regionId);

    // Create new cron job
    const cronJob = new CronJob(
      cronExpression,
      async () => {
        this.logger.log(`Triggering scheduled analysis for region: ${regionId}`);
        await this.queueAnalysisJob(regionId, regionData);
      },
      null, // onComplete
      false, // start
      'America/New_York' // timezone
    );

    // Store the cron job
    this.cronJobs.set(regionId, cronJob);
    this.jobStates.set(regionId, true);

    // Start the cron job
    cronJob.start();

    this.logger.log(`✅ Cron job started for region ${regionId}`);

    // Trigger immediate analysis if requested
    if (triggerImmediate) {
      this.logger.log(`Triggering immediate analysis for region: ${regionId}`);
      await this.queueAnalysisJob(regionId, regionData);
    }
  }

  /**
   * Stop interval-based analysis for a region
   */
  async stopRegionAnalysis(regionId: string): Promise<void> {
    const existingJob = this.cronJobs.get(regionId);
    if (existingJob) {
      existingJob.stop();
      this.cronJobs.delete(regionId);
      this.jobStates.delete(regionId);
      this.logger.log(`🛑 Stopped cron job for region ${regionId}`);
    }

    // Also remove any pending jobs from the queue
    const jobs = await this.analysisQueue.getJobs(['waiting', 'delayed']);
    const regionJobs = jobs.filter(job => job.data.regionId === regionId);
    
    for (const job of regionJobs) {
      await job.remove();
      this.logger.log(`🗑️ Removed pending job ${job.id} for region ${regionId}`);
    }
  }

  /**
   * Queue an analysis job for immediate execution
   */
  private async queueAnalysisJob(
    regionId: string,
    regionData: {
      latitude: number;
      longitude: number;
      cloudCoverThreshold: number;
    }
  ): Promise<void> {
    const jobData: RegionAnalysisJob = {
      regionId,
      latitude: regionData.latitude,
      longitude: regionData.longitude,
      cloudCoverThreshold: regionData.cloudCoverThreshold,
      cronExpression: '', // This is filled by the cron job
    };

    const job = await this.analysisQueue.add('analyze-region', jobData, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: 5,
      removeOnFail: 3,
    });

    this.logger.log(`📋 Queued analysis job ${job.id} for region ${regionId}`);
  }

  /**
   * Get status of all active cron jobs
   */
  getActiveJobs(): Array<{ regionId: string; isRunning: boolean; nextExecution?: Date }> {
    const activeJobs: Array<{ regionId: string; isRunning: boolean; nextExecution?: Date }> = [];

    this.cronJobs.forEach((cronJob, regionId) => {
      activeJobs.push({
        regionId,
        isRunning: this.jobStates.get(regionId) || false,
        nextExecution: cronJob.nextDate()?.toJSDate(),
      });
    });

    return activeJobs;
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }> {
    const waiting = await this.analysisQueue.getWaiting();
    const active = await this.analysisQueue.getActive();
    const completed = await this.analysisQueue.getCompleted();
    const failed = await this.analysisQueue.getFailed();
    const delayed = await this.analysisQueue.getDelayed();

    return {
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
      delayed: delayed.length,
    };
  }

  /**
   * Clean up old jobs
   */
  async cleanupOldJobs(): Promise<void> {
    await this.analysisQueue.clean(24 * 60 * 60 * 1000, 'completed'); // 24 hours
    await this.analysisQueue.clean(7 * 24 * 60 * 60 * 1000, 'failed'); // 7 days
    this.logger.log('🧹 Cleaned up old queue jobs');
  }

  /**
   * Pause all region analysis jobs
   */
  async pauseAll(): Promise<void> {
    this.cronJobs.forEach((cronJob, regionId) => {
      cronJob.stop();
      this.jobStates.set(regionId, false);
      this.logger.log(`⏸️ Paused cron job for region ${regionId}`);
    });
  }

  /**
   * Resume all region analysis jobs
   */
  async resumeAll(): Promise<void> {
    this.cronJobs.forEach((cronJob, regionId) => {
      cronJob.start();
      this.jobStates.set(regionId, true);
      this.logger.log(`▶️ Resumed cron job for region ${regionId}`);
    });
  }
} 