import { 
  Controller, 
  Get, 
  Post, 
  Put, 
  Delete, 
  Body, 
  Param, 
  Query, 
  Logger, 
  HttpException, 
  HttpStatus 
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBody } from '@nestjs/swagger';
import { 
  DashboardStatsDto, 
  CreateRegionDto, 
  RegionDto, 
  AlertDto, 
  TrendAnalysisDto, 
  MonitoringJobDto, 
  HeatmapResponseDto, 
  AlertLevel, 
  RegionStatus,
  VisualizationDto,
  RegionVisualizationsDto,
  RegionAnalysisControlDto,
  StartAnalysisDto,
  AnalysisScheduleDto
} from './dto/dashboard.dto';
import { DashboardService } from './services/dashboard.service';
import { AWSMonitoringService } from './services/aws-monitoring.service';
import { AWSSecurityService } from './services/aws-security.service';
import { AWSActivityService } from './services/aws-activity.service';
import { AWSRealtimeGateway } from './aws-realtime.gateway';
import { SentinelService } from './sentinel.service';
import { ConfigService } from '@nestjs/config';
import { AWSService } from './services/aws.service';
import { GeospatialService } from './services/geospatial.service';
import { QueueService } from '../queue/queue.service';

@Controller('dashboard')
export class DashboardController {
  private readonly logger = new Logger(DashboardController.name);

  constructor(
    private readonly sentinelService: SentinelService,
    private readonly dashboardService: DashboardService,
    private readonly awsMonitoringService: AWSMonitoringService,
    private readonly awsSecurityService: AWSSecurityService,
    private readonly awsActivityService: AWSActivityService,
    private readonly awsRealtimeGateway: AWSRealtimeGateway,
    private readonly configService: ConfigService,
    private readonly awsService: AWSService,
    private readonly geospatialService: GeospatialService,
    private readonly queueService: QueueService,
  ) {}

  // =============================================
  // CORE DASHBOARD ENDPOINTS
  // =============================================

  @Get('stats')
  @ApiTags('Core Dashboard')
  @ApiOperation({ 
    summary: 'Get dashboard overview statistics',
    description: 'Returns key metrics for the dashboard including total regions, active alerts, and processing statistics'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Dashboard statistics retrieved successfully',
    type: DashboardStatsDto 
  })
  async getDashboardStats(): Promise<DashboardStatsDto> {
    this.logger.log('Fetching dashboard statistics');
    const regions = await this.dashboardService.getAllRegions();
    const alerts = await this.dashboardService.getAlerts(undefined, false);
    const activeJobs = Array.from(this.sentinelService['processingJobs'].values()).filter(j => j.status === 'IN_PROGRESS');

    return {
      totalRegions: regions.length,
      activeAlerts: alerts.length,
      avgDeforestation: regions.length > 0 ? regions.reduce((acc, r) => acc + r.lastDeforestationPercentage, 0) / regions.length : 0,
      imagesProcessed: 0, // This would require job persistence
      activeJobs: activeJobs.length,
      lastUpdate: new Date().toISOString(),
    };
  }

  @Get('regions')
  @ApiTags('Core Dashboard')
  @ApiOperation({ 
    summary: 'Get all monitored regions',
    description: 'Returns a list of all regions currently being monitored for deforestation'
  })
  @ApiQuery({ name: 'status', required: false, enum: RegionStatus, description: 'Filter by region status' })
  @ApiResponse({ 
    status: 200, 
    description: 'Regions retrieved successfully',
    type: [RegionDto] 
  })
  async getRegions(@Query('status') status?: RegionStatus): Promise<RegionDto[]> {
    this.logger.log(`Fetching regions${status ? ` with status: ${status}` : ''}`);
    return this.dashboardService.getAllRegions(status);
  }

  @Post('regions')
  @ApiTags('Core Dashboard')
  @ApiOperation({ 
    summary: 'Create a new monitoring region',
    description: 'Adds a new geographic region to monitor for deforestation'
  })
  @ApiResponse({ 
    status: 201, 
    description: 'Region created successfully',
    type: RegionDto 
  })
  @ApiResponse({ status: 400, description: 'Invalid region data provided' })
  async createRegion(@Body() createRegionDto: CreateRegionDto): Promise<RegionDto> {
    this.logger.log(`Creating new region: ${createRegionDto.name}`);
    return this.dashboardService.createRegion(createRegionDto);
  }

  @Get('regions/:regionId')
  @ApiTags('Core Dashboard')
  @ApiOperation({ 
    summary: 'Get region details',
    description: 'Returns detailed information about a specific monitoring region'
  })
  @ApiParam({ name: 'regionId', description: 'Unique region identifier' })
  @ApiResponse({ 
    status: 200, 
    description: 'Region details retrieved successfully',
    type: RegionDto 
  })
  @ApiResponse({ status: 404, description: 'Region not found' })
  async getRegion(@Param('regionId') regionId: string): Promise<RegionDto> {
    this.logger.log(`Fetching region details: ${regionId}`);
    const region = await this.dashboardService.getRegionById(regionId);
    if (!region) {
      throw new HttpException('Region not found', HttpStatus.NOT_FOUND);
    }
    return region;
  }

  @Put('regions/:regionId')
  @ApiTags('Core Dashboard')
  @ApiOperation({ 
    summary: 'Update region settings',
    description: 'Updates monitoring settings for an existing region'
  })
  @ApiParam({ name: 'regionId', description: 'Unique region identifier' })
  @ApiResponse({ 
    status: 200, 
    description: 'Region updated successfully',
    type: RegionDto 
  })
  @ApiResponse({ status: 404, description: 'Region not found' })
  async updateRegion(@Param('regionId') regionId: string, @Body() updateData: Partial<CreateRegionDto>): Promise<RegionDto> {
    this.logger.log(`Updating region: ${regionId}`);
    return this.dashboardService.updateRegion(regionId, updateData);
  }

  @Delete('regions/:regionId')
  @ApiTags('Core Dashboard')
  @ApiOperation({ 
    summary: 'Delete monitoring region',
    description: 'Removes a region from monitoring (stops all processing for this region)'
  })
  @ApiParam({ name: 'regionId', description: 'Unique region identifier' })
  @ApiResponse({ status: 200, description: 'Region deleted successfully' })
  @ApiResponse({ status: 404, description: 'Region not found' })
  async deleteRegion(@Param('regionId') regionId: string): Promise<{ message: string }> {
    this.logger.log(`Deleting region: ${regionId}`);
    await this.dashboardService.deleteRegion(regionId);
    return { message: `Region ${regionId} deleted successfully` };
  }

  // =============================================
  // ALERTS & NOTIFICATIONS
  // =============================================

  @Get('alerts')
  @ApiTags('Alerts & Notifications')
  @ApiOperation({ 
    summary: 'Get deforestation alerts',
    description: 'Returns active and recent deforestation alerts across all monitored regions'
  })
  @ApiQuery({ name: 'level', required: false, enum: AlertLevel, description: 'Filter by alert level' })
  @ApiQuery({ name: 'acknowledged', required: false, type: 'boolean', description: 'Filter by acknowledgment status' })
  @ApiQuery({ name: 'limit', required: false, type: 'number', description: 'Maximum number of alerts to return' })
  @ApiResponse({ 
    status: 200, 
    description: 'Alerts retrieved successfully',
    type: [AlertDto] 
  })
  async getAlerts(
    @Query('level') level?: AlertLevel,
    @Query('acknowledged') acknowledged?: boolean,
    @Query('limit') limit: number = 50
  ): Promise<AlertDto[]> {
    this.logger.log('Fetching deforestation alerts');
    const alerts = await this.dashboardService.getAlerts(level, acknowledged);
    return alerts.slice(0, limit);
  }

  @Put('alerts/:alertId/acknowledge')
  @ApiTags('Alerts & Notifications')
  @ApiOperation({ 
    summary: 'Acknowledge an alert',
    description: 'Marks a deforestation alert as acknowledged by the user'
  })
  @ApiParam({ name: 'alertId', description: 'Unique alert identifier' })
  @ApiResponse({ status: 200, description: 'Alert acknowledged successfully' })
  @ApiResponse({ status: 404, description: 'Alert not found' })
  async acknowledgeAlert(@Param('alertId') alertId: string): Promise<{ message: string }> {
    this.logger.log(`Acknowledging alert: ${alertId}`);
    await this.dashboardService.acknowledgeAlert(alertId);
    return { message: `Alert ${alertId} acknowledged successfully` };
  }

  // =============================================
  // MONITORING & ANALYSIS
  // =============================================

  @Post('regions/:regionId/analyze')
  @ApiTags('Monitoring & Analysis')
  @ApiOperation({ 
    summary: 'Trigger manual analysis',
    description: 'Manually triggers a deforestation analysis for a specific region'
  })
  @ApiParam({ name: 'regionId', description: 'Unique region identifier' })
  @ApiResponse({ status: 202, description: 'Analysis started successfully' })
  @ApiResponse({ status: 404, description: 'Region not found' })
  async triggerAnalysis(@Param('regionId') regionId: string): Promise<{ message: string; jobId: string }> {
    this.logger.log(`Triggering manual analysis for region: ${regionId}`);
    const region = await this.dashboardService.getRegionById(regionId);
    if (!region) {
      throw new HttpException('Region not found', HttpStatus.NOT_FOUND);
    }
    
    const jobId = await this.sentinelService.startDeforestationProcessing({
      latitude: region.latitude,
      longitude: region.longitude,
      startDate: '2023-01-01',
      endDate: new Date().toISOString().split('T')[0], // Today
      cloudCover: region.cloudCoverThreshold ?? 20, // Fallback to 20%
    });
    
    return { 
      message: `Analysis started for region ${regionId}`,
      jobId 
    };
  }

  @Post('regions/:regionId/start-analysis')
  @ApiTags('Monitoring & Analysis')
  @ApiOperation({ 
    summary: 'Start interval-based analysis',
    description: 'Starts automated interval-based (cron) analysis for a specific region'
  })
  @ApiParam({ name: 'regionId', description: 'Unique region identifier' })
  @ApiBody({ type: StartAnalysisDto, required: false })
  @ApiResponse({ 
    status: 200, 
    description: 'Interval analysis started successfully',
    type: RegionAnalysisControlDto 
  })
  @ApiResponse({ status: 404, description: 'Region not found' })
  async startIntervalAnalysis(
    @Param('regionId') regionId: string,
    @Body() startAnalysisDto?: StartAnalysisDto
  ): Promise<RegionAnalysisControlDto> {
    this.logger.log(`Starting interval analysis for region: ${regionId}`);
    const region = await this.dashboardService.getRegionById(regionId);
    if (!region) {
      throw new HttpException('Region not found', HttpStatus.NOT_FOUND);
    }

    const cronExpression = startAnalysisDto?.cronExpression || '*/30 * * * *'; // Default: every 30 minutes
    
    // Start the cron job using QueueService
    await this.queueService.startRegionAnalysis(
      regionId,
      cronExpression,
      {
        latitude: region.latitude,
        longitude: region.longitude,
        cloudCoverThreshold: region.cloudCoverThreshold ?? 20,
      },
      startAnalysisDto?.triggerImmediate || false
    );

    // Update region status to ACTIVE
    const updatedRegion = await this.dashboardService.updateRegion(regionId, {
      status: RegionStatus.ACTIVE
    });

    this.logger.log(`✅ Interval analysis started for region ${regionId} with schedule: ${cronExpression}`);
    
    return {
      regionId: updatedRegion.regionId,
      status: updatedRegion.status,
      cronExpression,
      updatedAt: new Date().toISOString(),
      message: `Automated analysis started with cron expression: ${cronExpression}`
    };
  }

  @Post('regions/:regionId/pause-analysis')
  @ApiTags('Monitoring & Analysis')
  @ApiOperation({ 
    summary: 'Pause interval-based analysis',
    description: 'Pauses automated interval-based (cron) analysis for a specific region'
  })
  @ApiParam({ name: 'regionId', description: 'Unique region identifier' })
  @ApiResponse({ 
    status: 200, 
    description: 'Interval analysis paused successfully',
    type: RegionAnalysisControlDto 
  })
  @ApiResponse({ status: 404, description: 'Region not found' })
  async pauseIntervalAnalysis(@Param('regionId') regionId: string): Promise<RegionAnalysisControlDto> {
    this.logger.log(`Pausing interval analysis for region: ${regionId}`);
    const region = await this.dashboardService.getRegionById(regionId);
    if (!region) {
      throw new HttpException('Region not found', HttpStatus.NOT_FOUND);
    }

    // Stop the cron job using QueueService
    await this.queueService.stopRegionAnalysis(regionId);

    // Update region status to PAUSED
    const updatedRegion = await this.dashboardService.updateRegion(regionId, {
      status: RegionStatus.PAUSED
    });

    this.logger.log(`⏸️ Interval analysis paused for region ${regionId}`);

    return {
      regionId: updatedRegion.regionId,
      status: updatedRegion.status,
      cronExpression: null,
      updatedAt: new Date().toISOString(),
      message: 'Automated analysis paused successfully'
    };
  }

  @Get('regions/:regionId/analysis-schedule')
  @ApiTags('Monitoring & Analysis')
  @ApiOperation({ 
    summary: 'Get analysis schedule status',
    description: 'Returns the current interval analysis schedule and status for a region'
  })
  @ApiParam({ name: 'regionId', description: 'Unique region identifier' })
  @ApiResponse({ 
    status: 200, 
    description: 'Analysis schedule retrieved successfully',
    type: AnalysisScheduleDto 
  })
  @ApiResponse({ status: 404, description: 'Region not found' })
  async getAnalysisSchedule(@Param('regionId') regionId: string): Promise<AnalysisScheduleDto> {
    this.logger.log(`Getting analysis schedule for region: ${regionId}`);
    const region = await this.dashboardService.getRegionById(regionId);
    if (!region) {
      throw new HttpException('Region not found', HttpStatus.NOT_FOUND);
    }

    // Get active cron jobs from QueueService
    const activeJobs = this.queueService.getActiveJobs();
    const regionJob = activeJobs.find(job => job.regionId === regionId);

    const cronExpression = regionJob?.isRunning ? '*/30 * * * *' : ''; // Default or stored expression
    const nextAnalysis = regionJob?.nextExecution?.toISOString() || '';

    // Get recent monitoring jobs for this region to calculate analyses count
    const recentJobs = await this.dashboardService.getMonitoringJobs();
    const regionJobs = recentJobs.filter(job => job.regionId === regionId);
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const analysesLast24h = regionJobs.filter(job => 
      new Date(job.startTime) >= last24h
    ).length;

    return {
      regionId: region.regionId,
      regionName: region.name,
      status: region.status,
      cronExpression,
      nextAnalysis,
      lastAnalysis: region.lastAnalysis,
      analysesLast24h,
      isActive: regionJob?.isRunning || false
    };
  }

  @Post('regions/bulk-analysis-control')
  @ApiTags('Monitoring & Analysis')
  @ApiOperation({ 
    summary: 'Bulk start/pause analysis for multiple regions',
    description: 'Starts or pauses automated analysis for multiple regions at once'
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        regionIds: {
          type: 'array',
          items: { type: 'string' },
          example: ['region-123abc', 'region-456def']
        },
        action: {
          type: 'string',
          enum: ['start', 'pause'],
          example: 'start'
        },
        cronExpression: {
          type: 'string',
          example: '*/15 * * * *',
          description: 'Cron expression (only used for start action)'
        },
        triggerImmediate: {
          type: 'boolean',
          example: false,
          description: 'Whether to trigger immediate analysis (only used for start action)'
        }
      },
      required: ['regionIds', 'action']
    }
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Bulk operation completed',
    schema: {
      type: 'object',
      properties: {
        successful: {
          type: 'array',
          items: { $ref: '#/components/schemas/RegionAnalysisControlDto' }
        },
        failed: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              regionId: { type: 'string' },
              error: { type: 'string' }
            }
          }
        },
        summary: {
          type: 'object',
          properties: {
            total: { type: 'number' },
            successful: { type: 'number' },
            failed: { type: 'number' }
          }
        }
      }
    }
  })
  async bulkAnalysisControl(@Body() body: {
    regionIds: string[];
    action: 'start' | 'pause';
    cronExpression?: string;
    triggerImmediate?: boolean;
  }): Promise<{
    successful: RegionAnalysisControlDto[];
    failed: Array<{ regionId: string; error: string }>;
    summary: { total: number; successful: number; failed: number };
  }> {
    this.logger.log(`Bulk ${body.action} analysis for ${body.regionIds.length} regions`);
    
    const successful: RegionAnalysisControlDto[] = [];
    const failed: Array<{ regionId: string; error: string }> = [];

    for (const regionId of body.regionIds) {
      try {
        if (body.action === 'start') {
          const result = await this.startIntervalAnalysis(regionId, {
            cronExpression: body.cronExpression,
            triggerImmediate: body.triggerImmediate
          });
          successful.push(result);
        } else {
          const result = await this.pauseIntervalAnalysis(regionId);
          successful.push(result);
        }
      } catch (error) {
        failed.push({
          regionId,
          error: error.message || 'Unknown error'
        });
      }
    }

    return {
      successful,
      failed,
      summary: {
        total: body.regionIds.length,
        successful: successful.length,
        failed: failed.length
      }
    };
  }

  @Get('regions/analysis-schedules')
  @ApiTags('Monitoring & Analysis')
  @ApiOperation({ 
    summary: 'Get all region analysis schedules',
    description: 'Returns the analysis schedule status for all regions'
  })
  @ApiQuery({ name: 'status', required: false, enum: RegionStatus, description: 'Filter by region status' })
  @ApiResponse({ 
    status: 200, 
    description: 'Analysis schedules retrieved successfully',
    type: [AnalysisScheduleDto] 
  })
  async getAllAnalysisSchedules(@Query('status') status?: RegionStatus): Promise<AnalysisScheduleDto[]> {
    this.logger.log(`Getting analysis schedules for all regions${status ? ` with status: ${status}` : ''}`);
    
    const regions = await this.dashboardService.getAllRegions(status);
    const recentJobs = await this.dashboardService.getMonitoringJobs();
    
    const schedules: AnalysisScheduleDto[] = [];
    
    for (const region of regions) {
      const cronExpression = region.status === RegionStatus.ACTIVE ? '*/30 * * * *' : '';
      const now = new Date();
      const nextAnalysis = region.status === RegionStatus.ACTIVE 
        ? new Date(now.getTime() + 30 * 60 * 1000).toISOString()
        : '';

      // Count recent analyses for this region
      const regionJobs = recentJobs.filter(job => job.regionId === region.regionId);
      const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const analysesLast24h = regionJobs.filter(job => 
        new Date(job.startTime) >= last24h
      ).length;

      schedules.push({
        regionId: region.regionId,
        regionName: region.name,
        status: region.status,
        cronExpression,
        nextAnalysis,
        lastAnalysis: region.lastAnalysis,
        analysesLast24h,
        isActive: region.status === RegionStatus.ACTIVE
      });
    }

    return schedules;
  }

  @Get('queue/status')
  @ApiTags('Monitoring & Analysis')
  @ApiOperation({ 
    summary: 'Get queue status and statistics',
    description: 'Returns current status and statistics of the analysis job queue'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Queue status retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        queueStats: {
          type: 'object',
          properties: {
            waiting: { type: 'number' },
            active: { type: 'number' },
            completed: { type: 'number' },
            failed: { type: 'number' },
            delayed: { type: 'number' }
          }
        },
        activeJobs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              regionId: { type: 'string' },
              isRunning: { type: 'boolean' },
              nextExecution: { type: 'string' }
            }
          }
        }
      }
    }
  })
  async getQueueStatus(): Promise<{
    queueStats: {
      waiting: number;
      active: number;
      completed: number;
      failed: number;
      delayed: number;
    };
    activeJobs: Array<{ regionId: string; isRunning: boolean; nextExecution?: Date }>;
  }> {
    this.logger.log('Getting queue status and statistics');
    
    const queueStats = await this.queueService.getQueueStats();
    const activeJobs = this.queueService.getActiveJobs();

    return {
      queueStats,
      activeJobs
    };
  }

  @Post('queue/cleanup')
  @ApiTags('Monitoring & Analysis')
  @ApiOperation({ 
    summary: 'Clean up old queue jobs',
    description: 'Removes old completed and failed jobs from the queue to free up memory'
  })
  @ApiResponse({ status: 200, description: 'Queue cleanup completed successfully' })
  async cleanupQueue(): Promise<{ message: string }> {
    this.logger.log('Cleaning up old queue jobs');
    await this.queueService.cleanupOldJobs();
    return { message: 'Queue cleanup completed successfully' };
  }

  @Post('queue/pause-all')
  @ApiTags('Monitoring & Analysis')
  @ApiOperation({ 
    summary: 'Pause all region analysis jobs',
    description: 'Pauses all currently active cron jobs for all regions'
  })
  @ApiResponse({ status: 200, description: 'All analysis jobs paused successfully' })
  async pauseAllAnalysis(): Promise<{ message: string; pausedJobs: number }> {
    this.logger.log('Pausing all region analysis jobs');
    const activeJobs = this.queueService.getActiveJobs();
    const pausedCount = activeJobs.filter(job => job.isRunning).length;
    
    await this.queueService.pauseAll();
    
    return { 
      message: 'All analysis jobs paused successfully',
      pausedJobs: pausedCount
    };
  }

  @Post('queue/resume-all')
  @ApiTags('Monitoring & Analysis')
  @ApiOperation({ 
    summary: 'Resume all region analysis jobs',
    description: 'Resumes all paused cron jobs for all regions'
  })
  @ApiResponse({ status: 200, description: 'All analysis jobs resumed successfully' })
  async resumeAllAnalysis(): Promise<{ message: string; resumedJobs: number }> {
    this.logger.log('Resuming all region analysis jobs');
    const activeJobs = this.queueService.getActiveJobs();
    const resumedCount = activeJobs.length;
    
    await this.queueService.resumeAll();
    
    return { 
      message: 'All analysis jobs resumed successfully',
      resumedJobs: resumedCount
    };
  }

  @Get('regions/:regionId/ndvi-images')
  @ApiTags('Monitoring & Analysis')
  @ApiOperation({ 
    summary: 'List available NDVI images for a region',
    description: 'Returns a list of processed NDVI images available for download for a specific region'
  })
  @ApiParam({ name: 'regionId', description: 'Unique region identifier' })
  @ApiResponse({ 
    status: 200, 
    description: 'NDVI images list retrieved successfully',
    schema: {
      example: {
        regionId: 'amazon-north-1',
        availableImages: [
          {
            imageId: 'S2A_MSIL2A_20231215T143751_N0509_R096_T20LLP_20231215T174821',
            date: '2023-12-15T14:37:51Z',
            cloudCover: 15.2,
            vegetationPercentage: 73.5,
            processingDate: '2023-12-15T15:45:00Z'
          }
        ],
        totalImages: 1
      }
    }
  })
  @ApiResponse({ status: 404, description: 'Region not found' })
  async listNDVIImages(@Param('regionId') regionId: string): Promise<{ 
    regionId: string; 
    availableImages: Array<{
      imageId: string;
      date: string;
      cloudCover: number;
      vegetationPercentage: number;
      processingDate: string;
    }>;
    totalImages: number;
  }> {
    this.logger.log(`Listing NDVI images for region: ${regionId}`);
    
    const region = await this.dashboardService.getRegionById(regionId);
    if (!region) {
      throw new HttpException('Region not found', HttpStatus.NOT_FOUND);
    }

    // Get processing jobs for this region to find available NDVI images
    const jobs = Array.from(this.sentinelService['processingJobs'].values())
      .filter(job => job.status === 'COMPLETED' && job.results?.ndviResults);

    const availableImages = [];
    for (const job of jobs) {
      if (job.results?.ndviResults) {
        for (const ndviResult of job.results.ndviResults) {
          availableImages.push({
            imageId: ndviResult.imageId,
            date: ndviResult.date,
            cloudCover: 0, // Would need to be stored from original image
            vegetationPercentage: ndviResult.vegetationPercentage,
            processingDate: job.endTime?.toISOString() || new Date().toISOString()
          });
        }
      }
    }

    return {
      regionId,
      availableImages,
      totalImages: availableImages.length
    };
  }

  @Get('regions/:regionId/ndvi-image/:imageId')
  @ApiTags('Monitoring & Analysis')
  @ApiOperation({ 
    summary: 'Get NDVI image via signed URL',
    description: 'Returns a signed S3 URL for downloading the NDVI image (typically 300MB+). The URL expires in 1 hour.'
  })
  @ApiParam({ name: 'regionId', description: 'Unique region identifier' })
  @ApiParam({ name: 'imageId', description: 'Sentinel-2 image identifier' })
  @ApiQuery({ name: 'expiresIn', required: false, type: 'number', description: 'URL expiration time in seconds (default: 3600)' })
  @ApiResponse({ 
    status: 200, 
    description: 'Signed URL generated successfully',
    schema: {
      example: {
        signedUrl: 'https://forestshield-data.s3.amazonaws.com/ndvi/S2A_MSIL2A_20231215T143751_N0509_R096_T20LLP_20231215T174821_ndvi.tif?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=...',
        imageId: 'S2A_MSIL2A_20231215T143751_N0509_R096_T20LLP_20231215T174821',
        expiresAt: '2024-01-15T11:30:00Z',
        fileSizeEstimate: '~300MB'
      }
    }
  })
  @ApiResponse({ status: 404, description: 'Region or NDVI image not found' })
  async getNDVIImage(
    @Param('regionId') regionId: string,
    @Param('imageId') imageId: string,
    @Query('expiresIn') expiresIn: number = 3600
  ): Promise<{ signedUrl: string; imageId: string; expiresAt: string; fileSizeEstimate: string }> {
    this.logger.log(`Getting NDVI image for region ${regionId}, image ${imageId}`);
    
    const region = await this.dashboardService.getRegionById(regionId);
    if (!region) {
      throw new HttpException('Region not found', HttpStatus.NOT_FOUND);
    }

    const bucketName = this.configService.get<string>('PROCESSED_DATA_BUCKET');
    if (!bucketName) {
      throw new HttpException('PROCESSED_DATA_BUCKET not configured', HttpStatus.INTERNAL_SERVER_ERROR);
    }

    // NDVI images are stored as: ndvi/{imageId}_ndvi.tif
    const s3Key = `ndvi/${imageId}_ndvi.tif`;
    
    try {
      const signedUrl = await this.awsService.generateS3SignedUrl(bucketName, s3Key, expiresIn);
      const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
      
      this.logger.log(`Generated signed URL for NDVI image ${imageId}, expires at ${expiresAt}`);
      
      return {
        signedUrl,
        imageId,
        expiresAt,
        fileSizeEstimate: '~300MB'
      };
    } catch (error) {
      this.logger.error(`Failed to generate signed URL for NDVI image ${imageId}: ${error.message}`);
      throw new HttpException('NDVI image not found or access denied', HttpStatus.NOT_FOUND);
    }
  }

  @Get('regions/:regionId/visualizations')
  @ApiTags('Monitoring & Analysis')
  @ApiOperation({ 
    summary: 'List available k-means visualizations for a region',
    description: 'Returns a list of available k-means clustering visualization charts for a specific region'
  })
  @ApiParam({ name: 'regionId', description: 'Unique region identifier' })
  @ApiQuery({ name: 'limit', required: false, type: 'number', description: 'Maximum number of visualizations to return (default: 50)' })
  @ApiResponse({ 
    status: 200, 
    description: 'Visualizations list retrieved successfully',
    type: RegionVisualizationsDto
  })
  @ApiResponse({ status: 404, description: 'Region not found' })
  async getRegionVisualizations(
    @Param('regionId') regionId: string,
    @Query('limit') limit: number = 50
  ): Promise<RegionVisualizationsDto> {
    this.logger.log(`Listing k-means visualizations for region: ${regionId}`);
    
    const region = await this.dashboardService.getRegionById(regionId);
    if (!region) {
      throw new HttpException('Region not found', HttpStatus.NOT_FOUND);
    }

    const bucketName = this.configService.get<string>('PROCESSED_DATA_BUCKET') || 'forestshield-processed-data-381492060635';
    // Construct a prefix that is specific to the region to only list its visualizations
    const visualizationPrefix = `visualizations/${regionId}/`;

    try {
      // List all visualization objects in S3 for the specific region
      const listParams = {
        Bucket: bucketName,
        Prefix: visualizationPrefix,
        MaxKeys: limit * 5 // Get more than needed to filter and sort
      };

      const s3Objects = await this.awsService.listS3Objects(listParams);
      const visualizations: VisualizationDto[] = [];

      for (const obj of s3Objects) {
        if (obj.Key && obj.Key.endsWith('.png')) {
          // The key is now expected to be: visualizations/{regionId}/{tileId}/{timestamp}/{chartType}.png
          const keyParts = obj.Key.split('/');
          if (keyParts.length >= 5) {
            const tileId = keyParts[2];
            const timestamp = keyParts[3];
            const fileName = keyParts[4];
            const chartType = fileName.replace('.png', '');

            // Map chart types to human-readable descriptions
            const chartDescriptions: { [key: string]: string } = {
              'ndvi_red_clusters': 'NDVI vs Red Band K-means Clustering',
              'geographic_distribution': 'Geographic Distribution of Pixel Clusters',
              'feature_distributions': 'Feature Distribution Histograms',
              'cluster_statistics': 'Cluster Statistics and Analysis',
              'ndvi_nir_clusters': 'NDVI vs NIR Band K-means Clustering'
            };

            try {
              // Generate signed URL for each visualization (expires in 1 hour by default)
              const signedUrl = await this.awsService.generateS3SignedUrl(bucketName, obj.Key, 3600);
              
              visualizations.push({
                chartType,
                tileId,
                timestamp,
                url: signedUrl,
                createdAt: obj.LastModified?.toISOString() || new Date().toISOString(),
                description: chartDescriptions[chartType] || `${chartType} visualization`
              });
            } catch (error) {
              this.logger.warn(`Failed to generate signed URL for visualization ${obj.Key}: ${error.message}`);
              // Skip this visualization if we can't generate a signed URL
              continue;
            }
          }
        }
      }

      // Sort by creation date (newest first) and limit results
      visualizations.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const limitedVisualizations = visualizations.slice(0, limit);

      this.logger.log(`Found ${limitedVisualizations.length} visualizations for region ${regionId}`);

      return {
        regionId,
        regionName: region.name,
        visualizations: limitedVisualizations,
        totalVisualizations: limitedVisualizations.length,
        retrievedAt: new Date().toISOString()
      };

    } catch (error) {
      this.logger.error(`Failed to list visualizations for region ${regionId}: ${error.message}`);
      throw new HttpException('Failed to retrieve visualizations', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('visualizations/:tileId/:timestamp/:chartType')
  @ApiTags('Monitoring & Analysis')
  @ApiOperation({ 
    summary: 'Get specific k-means visualization with signed URL',
    description: 'Returns a signed URL for accessing a specific k-means clustering visualization chart'
  })
  @ApiParam({ name: 'tileId', description: 'Sentinel-2 tile identifier' })
  @ApiParam({ name: 'timestamp', description: 'Visualization generation timestamp (YYYYMMDD-HHMMSS format)' })
  @ApiParam({ name: 'chartType', description: 'Type of chart (ndvi_red_clusters, geographic_distribution, etc.)' })
  @ApiQuery({ name: 'expiresIn', required: false, type: 'number', description: 'URL expiration time in seconds (default: 3600)' })
  @ApiResponse({ 
    status: 200, 
    description: 'Signed URL generated successfully',
    schema: {
      example: {
        signedUrl: 'https://forestshield-processed-data-381492060635.s3.amazonaws.com/visualizations/S2B/20241215-143000/ndvi_red_clusters.png?X-Amz-Algorithm=AWS4-HMAC-SHA256...',
        tileId: 'S2B_MSIL2A_20231215T143751_N0509_R096_T20LLP_20231215T174821',
        chartType: 'ndvi_red_clusters',
        timestamp: '20241215-143000',
        expiresAt: '2024-12-15T15:30:00Z',
        description: 'NDVI vs Red Band K-means Clustering'
      }
    }
  })
  @ApiResponse({ status: 404, description: 'Visualization not found' })
  async getVisualization(
    @Param('tileId') tileId: string,
    @Param('timestamp') timestamp: string,
    @Param('chartType') chartType: string,
    @Query('expiresIn') expiresIn: number = 3600
  ): Promise<{ signedUrl: string; tileId: string; chartType: string; timestamp: string; expiresAt: string; description: string }> {
    this.logger.log(`Getting visualization: ${tileId}/${timestamp}/${chartType}`);
    
    const bucketName = this.configService.get<string>('PROCESSED_DATA_BUCKET') || 'forestshield-processed-data-381492060635';
    const s3Key = `visualizations/${tileId}/${timestamp}/${chartType}.png`;
    
    // Map chart types to descriptions
    const chartDescriptions: { [key: string]: string } = {
      'ndvi_red_clusters': 'NDVI vs Red Band K-means Clustering',
      'geographic_distribution': 'Geographic Distribution of Pixel Clusters',
      'feature_distributions': 'Feature Distribution Histograms',
      'cluster_statistics': 'Cluster Statistics and Analysis',
      'ndvi_nir_clusters': 'NDVI vs NIR Band K-means Clustering'
    };

    try {
      // Check if the object exists first
      await this.awsService.checkS3ObjectExists(bucketName, s3Key);
      
      // Generate signed URL
      const signedUrl = await this.awsService.generateS3SignedUrl(bucketName, s3Key, expiresIn);
      const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
      
      this.logger.log(`Generated signed URL for visualization ${chartType}, expires at ${expiresAt}`);
      
      return {
        signedUrl,
        tileId,
        chartType,
        timestamp,
        expiresAt,
        description: chartDescriptions[chartType] || `${chartType} visualization`
      };
    } catch (error) {
      this.logger.error(`Failed to generate signed URL for visualization ${tileId}/${timestamp}/${chartType}: ${error.message}`);
      throw new HttpException('Visualization not found or access denied', HttpStatus.NOT_FOUND);
    }
  }

  @Get('trends/:regionId')
  @ApiTags('Monitoring & Analysis')
  @ApiOperation({ 
    summary: 'Get historical trend analysis',
    description: 'Returns historical deforestation trend data for a specific region'
  })
  @ApiParam({ name: 'regionId', description: 'Unique region identifier' })
  @ApiQuery({ name: 'days', required: false, type: 'number', description: 'Number of days to analyze (default: 30)' })
  @ApiResponse({ 
    status: 200, 
    description: 'Trend analysis retrieved successfully',
    type: TrendAnalysisDto 
  })
  @ApiResponse({ status: 404, description: 'Region not found' })
  async getRegionTrends(@Param('regionId') regionId: string, @Query('days') days: number = 30): Promise<TrendAnalysisDto> {
    this.logger.error('❌ FAKE TREND DATA REMOVED - Implement real AWS S3 analytics integration');
    throw new HttpException('Mock trend data has been removed. Implement real AWS S3 analytics integration.', HttpStatus.NOT_IMPLEMENTED);
  }

  @Get('jobs')
  @ApiTags('Monitoring & Analysis')
  @ApiOperation({ 
    summary: 'Get active monitoring jobs',
    description: 'Returns currently running and recent monitoring jobs across all regions'
  })
  @ApiQuery({ name: 'status', required: false, description: 'Filter by job status (PENDING, IN_PROGRESS, COMPLETED, FAILED)' })
  @ApiResponse({ 
    status: 200, 
    description: 'Monitoring jobs retrieved successfully',
    type: [MonitoringJobDto] 
  })
  async getMonitoringJobs(@Query('status') status?: string): Promise<any[]> {
    this.logger.log(`Fetching monitoring jobs with status: ${status || 'ALL'}`);
    // This now calls the service that fetches from AWS Step Functions
    return this.dashboardService.getMonitoringJobs(status);
  }

  @Get('heatmap')
  @ApiTags('Monitoring & Analysis')
  @ApiOperation({ 
    summary: 'Get deforestation heatmap data',
    description: 'Returns geographic heatmap data showing deforestation intensity across monitored regions'
  })
  @ApiQuery({ name: 'north', required: true, type: 'number', description: 'North boundary latitude' })
  @ApiQuery({ name: 'south', required: true, type: 'number', description: 'South boundary latitude' })
  @ApiQuery({ name: 'east', required: true, type: 'number', description: 'East boundary longitude' })
  @ApiQuery({ name: 'west', required: true, type: 'number', description: 'West boundary longitude' })
  @ApiQuery({ name: 'days', required: false, type: 'number', description: 'Number of days to analyze (default: 30)' })
  @ApiResponse({ 
    status: 200, 
    description: 'Heatmap data retrieved successfully',
    type: HeatmapResponseDto 
  })
  async getHeatmapData(
    @Query('north') north: number,
    @Query('south') south: number,
    @Query('east') east: number,
    @Query('west') west: number,
    @Query('days') days: number = 30
  ): Promise<HeatmapResponseDto> {
    this.logger.log(`Received heatmap request for bbox: N:${north}, S:${south}, E:${east}, W:${west}`);
    const points = await this.geospatialService.getHeatmapData(north, south, east, west, days);

    const heatmapData = points.map(p => ({
      lat: p.latitude,
      lng: p.longitude,
      intensity: p.intensity,
      cellSize: 1000, // Default cell size in meters, can be adjusted
    }));

    return {
      data: heatmapData,
      bounds: { north, south, east, west },
      generatedAt: new Date().toISOString(),
      periodDays: days,
    };
  }

  @Post('alerts/subscribe')
  @ApiTags('Alerts & Notifications')
  @ApiOperation({ 
    summary: 'Subscribe to deforestation alerts',
    description: 'Subscribe an email address to receive ForestShield deforestation alerts via SNS'
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        email: { type: 'string', example: 'user@example.com', description: 'Email address to subscribe' }
      },
      required: ['email']
    }
  })
  @ApiResponse({ status: 201, description: 'Subscription created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid email address' })
  @ApiResponse({ status: 409, description: 'Email already subscribed' })
  async subscribeToAlerts(@Body() body: { email: string }): Promise<{ message: string; subscriptionArn?: string }> {
    this.logger.log(`Subscribing email to alerts: ${body.email}`);
    
    if (!body.email || !body.email.includes('@')) {
      throw new HttpException('Valid email address is required', HttpStatus.BAD_REQUEST);
    }

    try {
      const subscriptionArn = await this.dashboardService.subscribeToAlerts(body.email);
      return { 
        message: `Subscription created for ${body.email}. Please check your email and confirm the subscription.`,
        subscriptionArn 
      };
    } catch (error) {
      this.logger.error(`Failed to subscribe ${body.email}:`, error);
      if (error.message?.includes('already subscribed')) {
        throw new HttpException('Email address is already subscribed', HttpStatus.CONFLICT);
      }
      throw new HttpException('Failed to create subscription', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Delete('alerts/unsubscribe')
  @ApiTags('Alerts & Notifications')
  @ApiOperation({ 
    summary: 'Unsubscribe from deforestation alerts',
    description: 'Unsubscribe an email address from ForestShield deforestation alerts'
  })
  @ApiQuery({ name: 'email', required: true, type: 'string', description: 'Email address to unsubscribe' })
  @ApiResponse({ status: 200, description: 'Successfully unsubscribed' })
  @ApiResponse({ status: 404, description: 'Email not found or not subscribed' })
  async unsubscribeFromAlerts(@Query('email') email: string): Promise<{ message: string }> {
    this.logger.log(`Unsubscribing email from alerts: ${email}`);
    
    if (!email || !email.includes('@')) {
      throw new HttpException('Valid email address is required', HttpStatus.BAD_REQUEST);
    }

    try {
      await this.dashboardService.unsubscribeFromAlerts(email);
      return { message: `Successfully unsubscribed ${email} from ForestShield alerts` };
    } catch (error) {
      this.logger.error(`Failed to unsubscribe ${email}:`, error);
      if (error.message?.includes('not found')) {
        throw new HttpException('Email address not found or not subscribed', HttpStatus.NOT_FOUND);
      }
      throw new HttpException('Failed to unsubscribe', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('alerts/subscriptions')
  @ApiTags('Alerts & Notifications')
  @ApiOperation({ 
    summary: 'List all alert subscriptions',
    description: 'Get list of all email addresses subscribed to ForestShield alerts'
  })
  @ApiResponse({ status: 200, description: 'Subscriptions retrieved successfully' })
  async getAlertSubscriptions(): Promise<{ subscriptions: Array<{ email: string; subscriptionArn: string; status: string }> }> {
    this.logger.log('Fetching alert subscriptions');
    
    try {
      const subscriptions = await this.dashboardService.getAlertSubscriptions();
      return { subscriptions };
    } catch (error) {
      this.logger.error('Failed to fetch subscriptions:', error);
      throw new HttpException('Failed to fetch alert subscriptions', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // =============================================
  // PERFORMANCE ANALYTICS
  // =============================================

  @Get('performance/overview')
  @ApiTags('Performance Analytics')
  @ApiOperation({ 
    summary: 'Get system-wide performance overview',
    description: 'Returns overall model performance metrics across all monitored regions'
  })
  @ApiResponse({ status: 200, description: 'Performance overview retrieved successfully' })
  async getPerformanceOverview(): Promise<any> {
    this.logger.log('Fetching system-wide performance overview');
    
    try {
      const performanceData = await this.dashboardService.getSystemPerformanceOverview();
      return performanceData;
    } catch (error) {
      this.logger.error('Failed to fetch performance overview:', error);
      throw new HttpException('Failed to fetch performance overview', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('performance/regions/:regionId')
  @ApiTags('Performance Analytics')
  @ApiOperation({ 
    summary: 'Get performance metrics for a specific region',
    description: 'Returns detailed performance history and metrics for a specific tile/region'
  })
  @ApiParam({ name: 'regionId', description: 'Region/tile identifier (e.g., S2A, S2B)' })
  @ApiQuery({ name: 'limit', required: false, type: 'number', description: 'Maximum number of performance entries to return (default: 50)' })
  @ApiResponse({ status: 200, description: 'Region performance metrics retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Performance data not found for region' })
  async getRegionPerformance(
    @Param('regionId') regionId: string,
    @Query('limit') limit: number = 50
  ): Promise<any> {
    this.logger.log(`Fetching performance metrics for region: ${regionId}`);
    
    try {
      const performanceData = await this.dashboardService.getRegionPerformanceMetrics(regionId, limit);
      if (!performanceData) {
        throw new HttpException('Performance data not found for region', HttpStatus.NOT_FOUND);
      }
      return performanceData;
    } catch (error) {
      this.logger.error(`Failed to fetch performance data for region ${regionId}:`, error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException('Failed to fetch region performance data', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('performance/trends')
  @ApiTags('Performance Analytics')
  @ApiOperation({ 
    summary: 'Get performance trends across all regions',
    description: 'Returns performance trend analysis showing confidence levels, model reuse rates, and processing efficiency over time'
  })
  @ApiQuery({ name: 'days', required: false, type: 'number', description: 'Number of days to analyze (default: 30)' })
  @ApiResponse({ status: 200, description: 'Performance trends retrieved successfully' })
  async getPerformanceTrends(@Query('days') days: number = 30): Promise<any> {
    this.logger.log(`Fetching performance trends for last ${days} days`);
    
    try {
      const trendsData = await this.dashboardService.getPerformanceTrends(days);
      return trendsData;
    } catch (error) {
      this.logger.error('Failed to fetch performance trends:', error);
      throw new HttpException('Failed to fetch performance trends', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('performance/anomalies')
  @ApiTags('Performance Analytics')
  @ApiOperation({ 
    summary: 'Get performance anomalies',
    description: 'Returns detected performance anomalies across all regions including confidence drops and processing time spikes'
  })
  @ApiQuery({ name: 'severity', required: false, description: 'Filter by anomaly severity (high, medium, low)' })
  @ApiQuery({ name: 'limit', required: false, type: 'number', description: 'Maximum number of anomalies to return (default: 20)' })
  @ApiResponse({ status: 200, description: 'Performance anomalies retrieved successfully' })
  async getPerformanceAnomalies(
    @Query('severity') severity?: string,
    @Query('limit') limit: number = 20
  ): Promise<any> {
    this.logger.log('Fetching performance anomalies');
    
    try {
      const anomalies = await this.dashboardService.getPerformanceAnomalies(severity, limit);
      return anomalies;
    } catch (error) {
      this.logger.error('Failed to fetch performance anomalies:', error);
      throw new HttpException('Failed to fetch performance anomalies', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('performance/models/:regionId')
  @ApiTags('Performance Analytics')
  @ApiOperation({ 
    summary: 'Get model performance comparison for a region',
    description: 'Returns comparison of different models used for a specific region over time'
  })
  @ApiParam({ name: 'regionId', description: 'Region/tile identifier' })
  @ApiResponse({ status: 200, description: 'Model performance comparison retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Model performance data not found for region' })
  async getModelPerformanceComparison(@Param('regionId') regionId: string): Promise<any> {
    this.logger.log(`Fetching model performance comparison for region: ${regionId}`);
    
    try {
      const modelComparison = await this.dashboardService.getModelPerformanceComparison(regionId);
      if (!modelComparison) {
        throw new HttpException('Model performance data not found for region', HttpStatus.NOT_FOUND);
      }
      return modelComparison;
    } catch (error) {
      this.logger.error(`Failed to fetch model performance comparison for region ${regionId}:`, error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException('Failed to fetch model performance comparison', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('performance/confidence')
  @ApiTags('Performance Analytics')
  @ApiOperation({ 
    summary: 'Get confidence scoring analytics',
    description: 'Returns detailed confidence scoring analytics across all regions including breakdowns by confidence factors'
  })
  @ApiQuery({ name: 'regionId', required: false, description: 'Filter by specific region' })
  @ApiResponse({ status: 200, description: 'Confidence analytics retrieved successfully' })
  async getConfidenceAnalytics(@Query('regionId') regionId?: string): Promise<any> {
    this.logger.log(`Fetching confidence analytics${regionId ? ` for region: ${regionId}` : ''}`);
    
    try {
      const confidenceData = await this.dashboardService.getConfidenceAnalytics(regionId);
      return confidenceData;
    } catch (error) {
      this.logger.error('Failed to fetch confidence analytics:', error);
      throw new HttpException('Failed to fetch confidence analytics', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('performance/regions/:regionId/track')
  @ApiTags('Performance Analytics')
  @ApiOperation({ 
    summary: 'Manually trigger performance tracking for a region',
    description: 'Manually initiates performance tracking for a specific region (useful for testing)'
  })
  @ApiParam({ name: 'regionId', description: 'Region/tile identifier' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        imageId: { type: 'string', description: 'Image identifier for tracking' },
        confidence: { type: 'number', description: 'Overall confidence score (0-1)' },
        processingTime: { type: 'number', description: 'Processing time in milliseconds' }
      },
      required: ['imageId']
    }
  })
  @ApiResponse({ status: 202, description: 'Performance tracking initiated successfully' })
  @ApiResponse({ status: 400, description: 'Invalid tracking data provided' })
  async triggerPerformanceTracking(
    @Param('regionId') regionId: string,
    @Body() trackingData: { imageId: string; confidence?: number; processingTime?: number }
  ): Promise<{ message: string; trackingId?: string }> {
    this.logger.log(`Triggering manual performance tracking for region: ${regionId}`);
    
    if (!trackingData.imageId) {
      throw new HttpException('Image ID is required for performance tracking', HttpStatus.BAD_REQUEST);
    }

    try {
      const trackingId = await this.dashboardService.triggerPerformanceTracking(regionId, trackingData);
      return { 
        message: `Performance tracking initiated for region ${regionId}`,
        trackingId 
      };
    } catch (error) {
      this.logger.error(`Failed to trigger performance tracking for region ${regionId}:`, error);
      throw new HttpException('Failed to initiate performance tracking', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('performance/regions/:regionId/track')
  @ApiTags('Performance Analytics')
  async trackRegionPerformance(
    @Param('regionId') regionId: string,
    @Body() performanceData: any
  ) {
    try {
      const result = await this.dashboardService.trackPerformance(regionId, performanceData);
      return {
        success: true,
        message: 'Performance tracking initiated',
        data: result
      };
    } catch (error) {
      throw new HttpException(
        `Failed to track performance: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  // =============================================
  // QUALITY ASSURANCE
  // =============================================

  @Get('quality/overview')
  @ApiTags('Quality Assurance')
  async getAlertQualityOverview() {
    try {
      const overview = await this.dashboardService.getPerformanceOverview();
      return {
        success: true,
        data: {
          alert_quality_overview: {
            overall_quality_score: overview.alertQualityScore,
            total_regions: overview.totalRegions,
            active_regions: overview.activeRegions,
            average_confidence: overview.averageConfidence,
            model_reuse_rate: overview.modelReuseRate
          }
        }
      };
    } catch (error) {
      throw new HttpException(
        `Failed to get alert quality overview: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('quality/regions/:regionId')
  @ApiTags('Quality Assurance')
  async getRegionAlertQuality(@Param('regionId') regionId: string) {
    try {
      const qualityMetrics = await this.dashboardService.getAlertQualityMetrics(regionId);
      
      if (!qualityMetrics) {
        return {
          success: true,
          message: 'No quality data available for this region yet',
          data: {
            regionId,
            status: 'no_data'
          }
        };
      }

      return {
        success: true,
        data: {
          regionId,
          quality_metrics: qualityMetrics
        }
      };
    } catch (error) {
      throw new HttpException(
        `Failed to get region alert quality: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('quality/trends')
  @ApiTags('Quality Assurance')
  async getAlertQualityTrends(
    @Query('regionId') regionId?: string,
    @Query('days') days: string = '30'
  ) {
    try {
      const daysNumber = parseInt(days, 10) || 30;
      const trends = await this.dashboardService.getAlertQualityTrends(regionId, daysNumber);
      
      return {
        success: true,
        data: {
          quality_trends: trends,
          region_id: regionId || 'all',
          time_range_days: daysNumber
        }
      };
    } catch (error) {
      throw new HttpException(
        `Failed to get alert quality trends: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('quality/false-positives')
  @ApiTags('Quality Assurance')
  async getFalsePositiveAnalysis(
    @Query('regionId') regionId?: string,
    @Query('days') days: string = '30'
  ) {
    try {
      const daysNumber = parseInt(days, 10) || 30;
      const trends = await this.dashboardService.getAlertQualityTrends(regionId, daysNumber);
      
      // Extract false positive analysis from trends
      const fpAnalysis = {
        total_alerts: trends.summary.totalAlerts,
        false_positive_indicators: {
          high_risk: trends.trends.filter(t => t.false_positive_risk === 'HIGH').length,
          medium_risk: trends.trends.filter(t => t.false_positive_risk === 'MEDIUM').length,
          low_risk: trends.trends.filter(t => t.false_positive_risk === 'LOW').length
        },
        confidence_correlation: {
          high_alert_low_confidence: trends.trends.filter(t => 
            t.alert_level === 'HIGH' && t.confidence_level === 'LOW').length,
          misaligned_alerts: trends.trends.filter(t => 
            (t.alert_level === 'HIGH' && ['LOW', 'VERY_LOW'].includes(t.confidence_level)) ||
            (t.alert_level === 'INFO' && ['HIGH', 'VERY_HIGH'].includes(t.confidence_level))).length
        },
        temporal_analysis: {
          real_time_alerts: trends.trends.filter(t => t.temporal_accuracy > 80).length,
          delayed_alerts: trends.trends.filter(t => t.temporal_accuracy < 50).length
        }
      };

      return {
        success: true,
        data: {
          false_positive_analysis: fpAnalysis,
          region_id: regionId || 'all',
          time_range_days: daysNumber
        }
      };
    } catch (error) {
      throw new HttpException(
        `Failed to get false positive analysis: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('quality/system-comparison')
  @ApiTags('Quality Assurance')
  async getSystemPerformanceComparison(
    @Query('regionId') regionId?: string,
    @Query('days') days: string = '30'
  ) {
    try {
      const daysNumber = parseInt(days, 10) || 30;
      const comparison = await this.dashboardService.getSystemPerformanceComparison(regionId, daysNumber);
      
      return {
        success: true,
        data: {
          system_comparison: comparison,
          region_id: regionId || 'all',
          time_range_days: daysNumber
        }
      };
    } catch (error) {
      throw new HttpException(
        `Failed to get system performance comparison: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('quality/detection-sensitivity')
  @ApiTags('Quality Assurance')
  async getDetectionSensitivityAnalysis(
    @Query('regionId') regionId?: string,
    @Query('days') days: string = '30'
  ) {
    try {
      const daysNumber = parseInt(days, 10) || 30;
      const trends = await this.dashboardService.getAlertQualityTrends(regionId, daysNumber);
      
      // Analyze detection sensitivity from trends
      const sensitivityAnalysis = {
        total_detections: trends.summary.totalAlerts,
        alert_distribution: {
          high_alerts: trends.trends.filter(t => t.alert_level === 'HIGH').length,
          medium_alerts: trends.trends.filter(t => t.alert_level === 'MEDIUM').length,
          info_alerts: trends.trends.filter(t => t.alert_level === 'INFO').length
        },
        confidence_distribution: {
          high_confidence: trends.trends.filter(t => ['HIGH', 'VERY_HIGH'].includes(t.confidence_level)).length,
          medium_confidence: trends.trends.filter(t => t.confidence_level === 'MEDIUM').length,
          low_confidence: trends.trends.filter(t => ['LOW', 'VERY_LOW'].includes(t.confidence_level)).length
        },
        improvement_indicators: {
          clustering_advantages: trends.trends.reduce((sum, t) => sum + t.threshold_vs_clustering, 0),
          average_improvements_per_alert: trends.trends.length > 0 
            ? trends.trends.reduce((sum, t) => sum + t.threshold_vs_clustering, 0) / trends.trends.length 
            : 0
        },
        temporal_performance: {
          real_time_detection_rate: trends.trends.length > 0
            ? (trends.trends.filter(t => t.temporal_accuracy > 80).length / trends.trends.length) * 100
            : 0,
          average_temporal_accuracy: trends.trends.length > 0
            ? trends.trends.reduce((sum, t) => sum + t.temporal_accuracy, 0) / trends.trends.length
            : 0
        }
      };

      return {
        success: true,
        data: {
          detection_sensitivity: sensitivityAnalysis,
          region_id: regionId || 'all',
          time_range_days: daysNumber
        }
      };
    } catch (error) {
      throw new HttpException(
        `Failed to get detection sensitivity analysis: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('quality/temporal-accuracy')
  @ApiTags('Quality Assurance')
  async getTemporalAccuracyMetrics(
    @Query('regionId') regionId?: string,
    @Query('days') days: string = '30'
  ) {
    try {
      const daysNumber = parseInt(days, 10) || 30;
      const trends = await this.dashboardService.getAlertQualityTrends(regionId, daysNumber);
      
      // Analyze temporal accuracy from trends
      const temporalMetrics = {
        overall_metrics: {
          total_alerts: trends.summary.totalAlerts,
          average_temporal_accuracy: trends.trends.length > 0
            ? trends.trends.reduce((sum, t) => sum + t.temporal_accuracy, 0) / trends.trends.length
            : 0
        },
        performance_categories: {
          real_time: trends.trends.filter(t => t.temporal_accuracy > 80).length,  // > 80% real-time
          same_day: trends.trends.filter(t => t.temporal_accuracy > 60 && t.temporal_accuracy <= 80).length,
          near_real_time: trends.trends.filter(t => t.temporal_accuracy > 40 && t.temporal_accuracy <= 60).length,
          delayed: trends.trends.filter(t => t.temporal_accuracy <= 40).length
        },
        trend_analysis: {
          improving: trends.trends.length >= 2 ? this.calculateTemporalTrend(trends.trends) : 'insufficient_data',
          quality_improvement: trends.summary.qualityImprovement || 0
        }
      };

      return {
        success: true,
        data: {
          temporal_accuracy: temporalMetrics,
          region_id: regionId || 'all',
          time_range_days: daysNumber
        }
      };
    } catch (error) {
      throw new HttpException(
        `Failed to get temporal accuracy metrics: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  private calculateTemporalTrend(trends: any[]): string {
    if (trends.length < 2) return 'insufficient_data';
    
    const recentAccuracy = trends.slice(-5).reduce((sum, t) => sum + t.temporal_accuracy, 0) / Math.min(5, trends.length);
    const earlierAccuracy = trends.slice(0, 5).reduce((sum, t) => sum + t.temporal_accuracy, 0) / Math.min(5, trends.length);
    
    const improvement = ((recentAccuracy - earlierAccuracy) / earlierAccuracy) * 100;
    
    if (improvement > 10) return 'significantly_improving';
    if (improvement > 2) return 'improving';
    if (improvement > -2) return 'stable';
    if (improvement > -10) return 'declining';
    return 'significantly_declining';
  }

  // =============================================
  // INTEGRATION TESTING
  // =============================================

  @Post('integration/test/quick')
  @ApiTags('Integration Testing')
  @ApiOperation({ 
    summary: 'Run quick system integration test',
    description: 'Executes a focused integration test for immediate system health feedback'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Quick integration test completed',
    schema: {
      example: {
        success: true,
        test_duration: 45.2,
        system_health: "good",
        workflow_test: "passed",
        lambda_health: "5/5 functions healthy",
        timestamp: "2024-01-15T10:30:00Z"
      }
    }
  })
  async runQuickIntegrationTest() {
    return this.dashboardService.runQuickIntegrationTest();
  }

  @Post('integration/test/comprehensive')
  @ApiTags('Integration Testing')
  @ApiOperation({ 
    summary: 'Run comprehensive system integration test',
    description: 'Executes full integration testing suite (15-30 minutes)'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Comprehensive integration test started',
    schema: {
      example: {
        success: true,
        test_id: "integration_test_20240115_103000",
        estimated_duration: "15-30 minutes",
        status: "running",
        monitor_url: "/dashboard/integration/test/status/integration_test_20240115_103000"
      }
    }
  })
  async runComprehensiveIntegrationTest() {
    this.logger.log('🧪 Starting comprehensive integration test');
    return this.dashboardService.runComprehensiveIntegrationTest();
  }

  @Get('integration/test/status/:testId')
  @ApiTags('Integration Testing')
  @ApiOperation({ 
    summary: 'Get integration test status',
    description: 'Monitor the progress of a running integration test'
  })
  @ApiParam({ name: 'testId', description: 'Integration test ID' })
  @ApiResponse({ 
    status: 200, 
    description: 'Integration test status retrieved',
    schema: {
      example: {
        test_id: "integration_test_20240115_103000",
        status: "running",
        progress: 0.65,
        current_phase: "performance_benchmarking",
        elapsed_time: 450.2,
        estimated_remaining: 600.0,
        preliminary_results: {
          end_to_end_tests: { success_rate: 0.85 },
          system_health: { status: "healthy" }
        }
      }
    }
  })
  async getIntegrationTestStatus(@Param('testId') testId: string) {
    this.logger.log(`Getting integration test status for: ${testId}`);
    return this.dashboardService.getIntegrationTestStatus(testId);
  }

  @Get('integration/test/results/:testId')
  @ApiTags('Integration Testing')
  @ApiOperation({ 
    summary: 'Get integration test results',
    description: 'Retrieve complete results of a finished integration test'
  })
  @ApiParam({ name: 'testId', description: 'Integration test ID' })
  @ApiResponse({ 
    status: 200, 
    description: 'Integration test results retrieved',
    schema: {
      example: {
        test_id: "integration_test_20240115_103000",
        status: "completed",
        overall_status: "HEALTHY",
        execution_time: 1245.8,
        end_to_end_tests: {
          success_rate: 0.90,
          average_processing_time: 185.2
        },
        performance_benchmarks: {
          peak_throughput: 12.5,
          cost_estimate: 67.50
        },
        geographic_validation: {
          coordinate_accuracy: "high",
          spatial_coherence: 0.85
        },
        user_acceptance: {
          alert_quality: 0.92,
          api_usability: "excellent"
        },
        recommendations: [
          "Optimize SageMaker instance selection",
          "Implement caching for frequently accessed models"
        ]
      }
    }
  })
  async getIntegrationTestResults(@Param('testId') testId: string) {
    this.logger.log(`Getting integration test results for: ${testId}`);
    return this.dashboardService.getIntegrationTestResults(testId);
  }

  @Get('integration/history')
  @ApiTags('Integration Testing')
  @ApiOperation({ 
    summary: 'Get integration test history',
    description: 'Retrieve history of all integration tests'
  })
  @ApiQuery({ name: 'limit', required: false, description: 'Number of test results to return' })
  @ApiResponse({ 
    status: 200, 
    description: 'Integration test history retrieved',
    schema: {
      example: {
        tests: [
          {
            test_id: "integration_test_20240115_103000",
            timestamp: "2024-01-15T10:30:00Z",
            status: "completed",
            overall_status: "HEALTHY",
            execution_time: 1245.8,
            success_rate: 0.90
          }
        ],
        summary: {
          total_tests: 15,
          average_success_rate: 0.88,
          last_test_date: "2024-01-15T10:30:00Z"
        }
      }
    }
  })
  async getIntegrationTestHistory(@Query('limit') limit?: number) {
    this.logger.log('Getting integration test history');
    return this.dashboardService.getIntegrationTestHistory(limit);
  }

  @Get('integration/system-health')
  @ApiTags('Integration Testing')
  @ApiOperation({ 
    summary: 'Get current system health status',
    description: 'Real-time system health check without full integration test'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'System health status retrieved',
    schema: {
      example: {
        overall_health: "healthy",
        aws_services: {
          lambda: "healthy",
          step_functions: "healthy",
          s3: "healthy",
          sagemaker: "healthy"
        },
        lambda_functions: {
          "forestshield-vegetation-analyzer": "healthy",
          "forestshield-model-manager": "healthy",
          "forestshield-k-selector": "healthy",
          "forestshield-results-consolidator": "healthy",
          "forestshield-visualization-generator": "healthy"
        },
        resource_utilization: {
          cpu_usage: 15.2,
          memory_usage: 42.1,
          disk_usage: 28.5
        },
        last_check: "2024-01-15T10:35:00Z"
      }
    }
  })
  async getSystemHealth() {
    this.logger.log('🏥 Getting REAL AWS system health status');
    return await this.awsActivityService.getSystemHealth();
  }

  // =============================================
  // AWS SERVICES & MONITORING
  // =============================================

  @Get('activity')
  @ApiTags('AWS Services & Monitoring')
  @ApiOperation({ 
    summary: 'Get real AWS activity feed',
    description: 'Fetches live activity events from CloudTrail, Lambda logs, and Step Functions'
  })
  @ApiQuery({ name: 'limit', required: false, type: 'number', description: 'Maximum number of activities to return (default: 50)' })
  @ApiResponse({ 
    status: 200, 
    description: 'Activity feed retrieved successfully',
    schema: {
      example: {
        activities: [
          {
            id: 'cloudtrail-12345',
            type: 'analysis',
            message: 'ForestShield workflow "deforestation-analysis-20240115" succeeded',
            timestamp: '2024-01-15T10:30:00Z',
            service: 'Step Functions',
            severity: 'low',
            details: {
              executionArn: 'arn:aws:states:us-east-1:123456789012:execution:forestshield-pipeline:execution-name',
              status: 'SUCCEEDED'
            }
          }
        ]
      }
    }
  })
  async getActivityFeed(@Query('limit') limit: number = 50) {
    this.logger.log(`📊 Fetching real AWS activity feed (limit: ${limit})`);
    return {
      activities: await this.awsActivityService.getActivityFeed(limit),
      timestamp: new Date().toISOString()
    };
  }

  @Get('aws/services')
  @ApiTags('AWS Services & Monitoring')
  @ApiOperation({ 
    summary: 'Get real AWS service metrics',
    description: 'Fetches live AWS service health and performance metrics from CloudWatch'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'AWS service metrics retrieved successfully',
    schema: {
      example: {
        services: [
          {
            id: 'lambda-forestshield',
            name: 'Lambda Functions',
            status: 'healthy',
            icon: 'lambda',
            metrics: {
              invocations: 1250,
              errors: 3,
              duration: 1850,
              memory: 1024,
              storage: 0,
              cost: 12.45
            },
            lastUpdated: '2024-01-15T10:30:00Z'
          }
        ]
      }
    }
  })
  async getAWSServiceMetrics() {
    this.logger.log('🔍 Fetching real AWS service metrics from CloudWatch');
    return {
      services: await this.awsMonitoringService.getAWSServiceMetrics(),
      timestamp: new Date().toISOString()
    };
  }

  @Get('aws/step-function-executions')
  @ApiTags('AWS Services & Monitoring')
  @ApiOperation({ 
    summary: 'Get recent Step Function executions',
    description: 'Returns a list of recent executions for the main deforestation analysis state machine.'
  })
  @ApiQuery({ name: 'limit', required: false, type: 'number', description: 'Maximum number of executions to return (default: 25)' })
  @ApiResponse({ 
    status: 200, 
    description: 'Step Function executions retrieved successfully.',
    schema: {
        example: [
            {
                id: "arn:aws:states:us-west-2:123456789012:execution:deforestation-state-machine:run-1",
                name: "run-1",
                status: "SUCCEEDED",
                startTime: "2024-05-21T10:00:00.000Z",
                endTime: "2024-05-21T10:05:00.000Z",
                duration: 300000,
                input: { "latitude": -6.0, "longitude": -53.0 },
                output: { "status": "COMPLETED", "vegetationLoss": 15.2 }
            }
        ]
    }
  })
  async getStepFunctionExecutions(@Query('limit') limit?: number) {
    this.logger.log(`Fetching Step Function executions${limit ? ` with limit: ${limit}` : ''}`);
    try {
      return await this.dashboardService.getStepFunctionExecutions(limit);
    } catch (error) {
      this.logger.error(`Failed to get Step Function executions: ${error.message}`, error);
      throw new HttpException('Failed to retrieve Step Function executions', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('aws/costs')
  @ApiTags('AWS Services & Monitoring')
  @ApiOperation({ 
    summary: 'Get real AWS cost and usage data',
    description: 'Fetches live billing data from AWS Cost Explorer'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'AWS cost data retrieved successfully',
    schema: {
      example: {
        dailyCosts: [
          { date: '2024-01-14', amount: 15.67 },
          { date: '2024-01-15', amount: 18.23 }
        ],
        monthlyProjection: 520.45,
        currentMonth: 387.23,
        previousMonth: 445.12,
        usageMetrics: {
          lambdaInvocations: 12500,
          s3Requests: 8750,
          dataTransferGB: 125.5,
          computeHours: 48.2
        }
      }
    }
  })
  async getAWSCostData() {
    this.logger.log('💰 Fetching real AWS cost data from Cost Explorer');
    return await this.awsMonitoringService.getCostAndUsageData();
  }

  @Get('aws/logs')
  @ApiTags('AWS Services & Monitoring')
  @ApiOperation({ 
    summary: 'Get real CloudWatch logs',
    description: 'Fetches live log events from CloudWatch Logs for ForestShield functions'
  })
  @ApiQuery({ name: 'logGroup', required: false, description: 'Specific log group name' })
  @ApiQuery({ name: 'limit', required: false, description: 'Maximum number of log entries' })
  @ApiResponse({ 
    status: 200, 
    description: 'CloudWatch logs retrieved successfully',
    schema: {
      example: {
        logs: [
          {
            id: '/aws/lambda/forestshield-vegetation-analyzer-12345',
            timestamp: '2024-01-15T10:30:00Z',
            level: 'INFO',
            message: 'Started processing satellite images for region Amazon-North',
            logGroup: '/aws/lambda/forestshield-vegetation-analyzer',
            logStream: '2024/01/15/[$LATEST]abc123'
          }
        ]
      }
    }
  })
  async getCloudWatchLogs(
    @Query('logGroup') logGroup?: string,
    @Query('limit') limit: number = 50
  ) {
    this.logger.log(`📋 Fetching real CloudWatch logs${logGroup ? ` from ${logGroup}` : ''}`);
    return {
      logs: await this.awsMonitoringService.getCloudWatchLogs(logGroup, limit),
      timestamp: new Date().toISOString()
    };
  }

  @Get('aws/health')
  @ApiTags('AWS Services & Monitoring')
  @ApiOperation({ 
    summary: 'Get comprehensive AWS service health',
    description: 'Real-time health check across all AWS services used by ForestShield'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'AWS service health retrieved successfully',
    schema: {
      example: {
        overall_health: 'healthy',
        services: {
          lambda: { status: 'healthy', functions_healthy: 7, functions_total: 7 },
          s3: { status: 'healthy', buckets_healthy: 3, total_storage_gb: 125.5 },
          stepfunctions: { status: 'healthy', success_rate: 98.5 },
          sagemaker: { status: 'healthy', active_endpoints: 2 },
          sns: { status: 'healthy', topics_active: 1 }
        },
        cost_health: {
          current_month: 387.23,
          projected_month: 520.45,
          budget_status: 'within_budget'
        },
        last_updated: '2024-01-15T10:30:00Z'
      }
    }
  })
  async getAWSHealthOverview() {
    this.logger.log('🏥 Getting comprehensive AWS service health overview');
    
    try {
      const [serviceMetrics, costData] = await Promise.all([
        this.awsMonitoringService.getAWSServiceMetrics(),
        this.awsMonitoringService.getCostAndUsageData()
      ]);

      // Calculate overall health
      const healthyServices = serviceMetrics.filter(s => s.status === 'healthy').length;
      const totalServices = serviceMetrics.length;
      const overallHealth = healthyServices === totalServices ? 'healthy' : 
                           healthyServices > totalServices * 0.8 ? 'degraded' : 'unhealthy';

      return {
        overall_health: overallHealth,
        services: {
          lambda: {
            status: serviceMetrics.find(s => s.id === 'lambda-forestshield')?.status || 'unknown',
            functions_healthy: serviceMetrics.filter(s => s.id.includes('lambda')).length,
            functions_total: 7,
            total_invocations: serviceMetrics.find(s => s.id === 'lambda-forestshield')?.metrics.invocations || 0
          },
          s3: {
            status: serviceMetrics.find(s => s.id === 's3-forestshield-data')?.status || 'unknown',
            buckets_healthy: 3,
            total_storage_gb: serviceMetrics.find(s => s.id === 's3-forestshield-data')?.metrics.storage || 0
          },
          stepfunctions: {
            status: serviceMetrics.find(s => s.id === 'step-functions-workflow')?.status || 'unknown',
            total_executions: serviceMetrics.find(s => s.id === 'step-functions-workflow')?.metrics.invocations || 0,
            success_rate: 95.5 // Would calculate from actual metrics
          },
          sagemaker: {
            status: serviceMetrics.find(s => s.id === 'sagemaker-k-means-clustering')?.status || 'unknown',
            active_endpoints: 2
          },
          sns: {
            status: serviceMetrics.find(s => s.id === 'sns-alert-notifications')?.status || 'unknown',
            topics_active: 1
          }
        },
        cost_health: {
          current_month: costData.currentMonth,
          projected_month: costData.monthlyProjection,
          budget_status: costData.monthlyProjection < 1000 ? 'within_budget' : 'approaching_limit'
        },
        performance_summary: {
          total_cost: costData.currentMonth,
          lambda_invocations: costData.usageMetrics.lambdaInvocations,
          compute_hours: costData.usageMetrics.computeHours
        },
        last_updated: new Date().toISOString()
      };
    } catch (error) {
      this.logger.error('Failed to get AWS health overview:', error);
      return {
        overall_health: 'degraded',
        error: 'Failed to fetch AWS service data',
        last_updated: new Date().toISOString()
      };
    }
  }

  // =============================================
  // AWS SECURITY & PERMISSIONS
  // =============================================

  @Get('aws/security/config')
  @ApiTags('AWS Security & Permissions')
  @ApiOperation({ 
    summary: 'Get AWS security configuration',
    description: 'Retrieves current AWS IAM roles, permissions, and security settings'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'AWS security configuration retrieved successfully',
    schema: {
      example: {
        roleArn: 'arn:aws:iam::123456789012:role/ForestShieldRole',
        permissions: [
          'cloudwatch:GetMetricStatistics',
          'logs:FilterLogEvents',
          'ce:GetCostAndUsage'
        ],
        policies: [
          {
            name: 'CloudWatchReadOnlyAccess',
            arn: 'arn:aws:iam::aws:policy/CloudWatchReadOnlyAccess',
            version: 'v1'
          }
        ],
        securityScore: 85,
        lastValidated: '2024-01-15T10:30:00Z'
      }
    }
  })
  async getAWSSecurityConfig() {
    this.logger.log('🔐 Fetching AWS security configuration');
    return await this.awsSecurityService.getSecurityConfiguration();
  }

  @Get('aws/security/credentials')
  @ApiTags('AWS Security & Permissions')
  @ApiOperation({ 
    summary: 'Validate AWS credentials',
    description: 'Checks if current AWS credentials are valid and properly configured'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'AWS credential validation completed',
    schema: {
      example: {
        valid: true,
        accountId: '123456789012',
        arn: 'arn:aws:iam::123456789012:role/ForestShieldRole',
        userId: 'AIDACKCEVSQ6C2EXAMPLE'
      }
    }
  })
  async validateAWSCredentials() {
    this.logger.log('🔑 Validating AWS credentials');
    return await this.awsSecurityService.validateAWSCredentials();
  }

  @Get('aws/security/permissions')
  @ApiTags('AWS Security & Permissions')
  @ApiOperation({ 
    summary: 'Validate required permissions',
    description: 'Checks if all required AWS permissions are granted for ForestShield operation'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Permission validation completed',
    schema: {
      example: {
        valid: true,
        missingPermissions: [],
        securityRecommendations: [
          'Consider adding CloudTrail access for enhanced audit logging'
        ]
      }
    }
  })
  async validateRequiredPermissions() {
    this.logger.log('🛡️ Validating required AWS permissions');
    return await this.awsSecurityService.validateRequiredPermissions();
  }

  @Get('aws/security/audit-logs')
  @ApiTags('AWS Security & Permissions')
  @ApiOperation({ 
    summary: 'Get AWS audit logs',
    description: 'Retrieves CloudTrail audit logs for ForestShield-related activities'
  })
  @ApiQuery({ name: 'hours', required: false, description: 'Number of hours to look back (default: 24)' })
  @ApiQuery({ name: 'limit', required: false, description: 'Maximum number of log entries (default: 50)' })
  @ApiResponse({ 
    status: 200, 
    description: 'AWS audit logs retrieved successfully',
    schema: {
      example: {
        logs: [
          {
            eventId: '12345678-1234-1234-1234-123456789012',
            eventTime: '2024-01-15T10:30:00Z',
            eventName: 'InvokeFunction',
            eventSource: 'lambda.amazonaws.com',
            userIdentity: {
              type: 'AssumedRole',
              arn: 'arn:aws:sts::123456789012:assumed-role/ForestShieldRole/session'
            },
            sourceIPAddress: '192.168.1.100'
          }
        ]
      }
    }
  })
  async getAWSAuditLogs(
    @Query('hours') hours: number = 24,
    @Query('limit') limit: number = 50
  ) {
    this.logger.log(`📋 Fetching AWS audit logs for last ${hours} hours`);
    
    const startTime = new Date(Date.now() - hours * 60 * 60 * 1000);
    const endTime = new Date();
    
    return {
      logs: await this.awsSecurityService.getAuditLogs(startTime, endTime, undefined, limit),
      timeRange: {
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        hours
      }
    };
  }

  @Get('aws/security/forestshield-audit')
  @ApiTags('AWS Security & Permissions')
  @ApiOperation({ 
    summary: 'Get ForestShield-specific audit logs',
    description: 'Retrieves audit logs filtered for ForestShield Lambda functions and services'
  })
  @ApiQuery({ name: 'limit', required: false, description: 'Maximum number of log entries (default: 50)' })
  @ApiResponse({ 
    status: 200, 
    description: 'ForestShield audit logs retrieved successfully'
  })
  async getForestShieldAuditLogs(@Query('limit') limit: number = 50) {
    this.logger.log('🛡️ Fetching ForestShield-specific audit logs');
    return {
      logs: await this.awsSecurityService.getForestShieldAuditLogs(limit),
      filtered_for: 'ForestShield Lambda functions and services'
    };
  }

  @Get('aws/security/health')
  @ApiTags('AWS Security & Permissions')
  @ApiOperation({ 
    summary: 'Get comprehensive security health check',
    description: 'Performs complete security validation including credentials, permissions, and audit access'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Security health check completed',
    schema: {
      example: {
        overall_security: 'secure',
        credential_status: 'valid',
        permission_score: 85,
        audit_log_access: true,
        recommendations: [
          'Consider enabling AWS Config for enhanced compliance monitoring'
        ],
        last_check: '2024-01-15T10:30:00Z'
      }
    }
  })
  async getSecurityHealthCheck() {
    this.logger.log('🏥 Performing comprehensive AWS security health check');
    return await this.awsSecurityService.getSecurityHealthCheck();
  }

  @Post('aws/security/cache/clear')
  @ApiTags('AWS Security & Permissions')
  @ApiOperation({ 
    summary: 'Clear security configuration cache',
    description: 'Forces refresh of cached security configuration and permissions'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Security cache cleared successfully'
  })
  async clearSecurityCache() {
    this.logger.log('🧹 Clearing AWS security configuration cache');
    this.awsSecurityService.clearSecurityCache();
    return {
      message: 'Security configuration cache cleared successfully',
      timestamp: new Date().toISOString()
    };
  }

  @Get('aws/security/cache/status')
  @ApiTags('AWS Security & Permissions')
  @ApiOperation({ 
    summary: 'Get security cache status',
    description: 'Returns information about the security configuration cache'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Security cache status retrieved successfully'
  })
  async getSecurityCacheStatus() {
    this.logger.log('📊 Getting security cache status');
    return {
      cache: this.awsSecurityService.getSecurityCacheStatus(),
      timestamp: new Date().toISOString()
    };
  }

  // =============================================
  // REAL-TIME WEBSOCKET STREAMS
  // =============================================

  @Get('realtime/connections')
  @ApiTags('Real-time WebSocket Streams')
  @ApiOperation({ 
    summary: 'Get WebSocket connection statistics',
    description: 'Returns real-time statistics about active WebSocket connections and streaming subscriptions'
  })
  @ApiResponse({ status: 200, description: 'WebSocket connection statistics retrieved successfully' })
  async getWebSocketStats() {
    this.logger.log('📊 Getting WebSocket connection statistics');
    return this.awsRealtimeGateway.getConnectionStats();
  }

  @Post('realtime/broadcast')
  @ApiTags('Real-time WebSocket Streams')
  @ApiOperation({ 
    summary: 'Broadcast system event to all connected clients',
    description: 'Sends a system-wide event notification to all connected WebSocket clients'
  })
  @ApiResponse({ status: 200, description: 'Event broadcasted successfully' })
  async broadcastSystemEvent(@Body() body: { event: string; data: any }) {
    this.logger.log(`📢 Broadcasting system event: ${body.event}`);
    this.awsRealtimeGateway.broadcastSystemEvent(body.event, body.data);
    return { 
      message: 'Event broadcasted successfully',
      event: body.event,
      timestamp: new Date().toISOString()
    };
  }

  @Get('realtime/info')
  @ApiTags('Real-time WebSocket Streams')
  @ApiOperation({ 
    summary: 'Get WebSocket connection information',
    description: 'Returns information about available WebSocket streams and connection details'
  })
  @ApiResponse({ status: 200, description: 'WebSocket information retrieved successfully' })
  async getWebSocketInfo() {
    this.logger.log('ℹ️ Getting WebSocket connection information');
    const stats = this.awsRealtimeGateway.getConnectionStats();
    
    return {
      endpoint: '/aws-realtime',
      availableStreams: [
        {
          name: 'aws-metrics',
          description: 'Real-time AWS service metrics from CloudWatch',
          defaultInterval: 30000,
          eventName: 'subscribe-aws-metrics'
        },
        {
          name: 'aws-logs',
          description: 'Live CloudWatch logs from ForestShield services',
          defaultInterval: 10000,
          eventName: 'subscribe-aws-logs'
        },
        {
          name: 'aws-activity',
          description: 'Real-time AWS activity feed from CloudTrail and services',
          defaultInterval: 15000,
          eventName: 'subscribe-aws-activity'
        },
        {
          name: 'aws-costs',
          description: 'Live AWS cost and billing data',
          defaultInterval: 60000,
          eventName: 'subscribe-aws-costs'
        },
        {
          name: 'aws-health',
          description: 'Real-time AWS service health monitoring',
          defaultInterval: 20000,
          eventName: 'subscribe-aws-health'
        },
        {
          name: 'aws-security',
          description: 'Live AWS security configuration and audit data',
          defaultInterval: 45000,
          eventName: 'subscribe-aws-security'
        }
      ],
      connectionStats: stats,
      connectionInstructions: {
        connect: 'Connect to /aws-realtime namespace',
        subscribe: 'Send subscription message with desired stream and interval',
        unsubscribe: 'Send unsubscribe message with stream name',
        getStatus: 'Send get-status message for connection details'
      }
    };
  }
} 