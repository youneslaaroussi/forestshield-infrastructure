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
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { 
  DashboardStatsDto, 
  CreateRegionDto, 
  RegionDto, 
  AlertDto, 
  TrendAnalysisDto, 
  MonitoringJobDto, 
  HeatmapResponseDto, 
  AlertLevel, 
  RegionStatus 
} from './dto/dashboard.dto';
import { DashboardService } from './services/dashboard.service';
import { SentinelService } from './sentinel.service';

@ApiTags('dashboard')
@Controller('dashboard')
export class DashboardController {
  private readonly logger = new Logger(DashboardController.name);

  constructor(
    private readonly sentinelService: SentinelService,
    private readonly dashboardService: DashboardService,
  ) {}

  @Get('stats')
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
    // This is a placeholder as we don't have job persistence yet
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

  @Get('alerts')
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

  @Post('regions/:regionId/analyze')
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
    // This uses the existing SentinelService to kick off a job.
    // Note: startDate and endDate would ideally come from the request or region settings.
    const jobId = await this.sentinelService.startDeforestationProcessing({
      latitude: region.latitude,
      longitude: region.longitude,
      startDate: '2023-01-01', // Example start date
      endDate: new Date().toISOString().split('T')[0], // Today
      cloudCover: region.cloudCoverThreshold ?? 20, // Fallback to 20%
    });
    
    return { 
      message: `Analysis started for region ${regionId}`,
      jobId 
    };
  }

  // The following endpoints are more complex and would require more sophisticated data and services.
  // I will leave their mock implementation for now as they are beyond the scope of simple DynamoDB queries.

  @Get('trends/:regionId')
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
    this.logger.log(`Fetching trend analysis for region: ${regionId}, days: ${days}`);
    
    // Mock trend data - replace with database queries to an analytics table
    return {
      regionId,
      regionName: 'Amazon Rainforest - Sector A',
      dataPoints: [], // This would require a time-series data source
      vegetationTrend: -2.5,
      trendDirection: 'DECLINING',
      analysisPeriodDays: days,
    };
  }

  @Get('jobs')
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
    this.logger.log('Fetching monitoring jobs');
    // Using the in-memory job map from SentinelService
    const jobs = Array.from(this.sentinelService['processingJobs'].values());
    return status ? jobs.filter(job => job.status === status) : jobs;
  }

  @Get('heatmap')
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
    this.logger.log('Generating heatmap data');
    
    // Mock heatmap data - This would require a geospatial query service like PostGIS or Elasticsearch with Geo-shapes
    return {
      bounds: {
        north: +north,
        south: +south,
        east: +east,
        west: +west,
      },
      data: [],
      generatedAt: new Date().toISOString(),
      periodDays: days,
    };
  }
} 