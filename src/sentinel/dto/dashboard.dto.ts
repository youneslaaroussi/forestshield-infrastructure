import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNumber, IsOptional, IsDateString, IsEnum, IsArray, IsBoolean, Min, Max } from 'class-validator';

export enum AlertLevel {
  LOW = 'LOW',
  MODERATE = 'MODERATE', 
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL'
}

export enum RegionStatus {
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  MONITORING = 'MONITORING'
}

export class DashboardStatsDto {
  @ApiProperty({ example: 12, description: 'Total number of monitored regions' })
  totalRegions: number;

  @ApiProperty({ example: 3, description: 'Number of active alerts' })
  activeAlerts: number;

  @ApiProperty({ example: 8.5, description: 'Average deforestation percentage across all regions' })
  avgDeforestation: number;

  @ApiProperty({ example: 156, description: 'Total images processed this month' })
  imagesProcessed: number;

  @ApiProperty({ example: 4, description: 'Currently running processing jobs' })
  activeJobs: number;

  @ApiProperty({ example: '2024-01-15T10:30:00Z', description: 'Last update timestamp' })
  lastUpdate: string;
}

export class CreateRegionDto {
  @ApiProperty({ example: 'Amazon Rainforest - Sector A', description: 'Human-readable name for the region' })
  @IsString()
  name: string;

  @ApiProperty({ example: -6.0, description: 'Latitude coordinate' })
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @ApiProperty({ example: -53.0, description: 'Longitude coordinate' })
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;

  @ApiPropertyOptional({ example: 'Critical deforestation hotspot in Pará, Brazil', description: 'Optional description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: 10, description: 'Monitoring radius in kilometers' })
  @IsNumber()
  @Min(1)
  @Max(50)
  radiusKm: number;

  @ApiPropertyOptional({ example: 20, description: 'Maximum cloud cover percentage (0-100)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  cloudCoverThreshold?: number;
}

export class RegionDto extends CreateRegionDto {
  @ApiProperty({ example: 'region-123abc', description: 'Unique region identifier' })
  regionId: string;

  @ApiProperty({ enum: RegionStatus, example: RegionStatus.ACTIVE, description: 'Current monitoring status' })
  status: RegionStatus;

  @ApiProperty({ example: '2024-01-01T00:00:00Z', description: 'Region creation timestamp' })
  createdAt: string;

  @ApiProperty({ example: 12.5, description: 'Latest deforestation percentage detected' })
  lastDeforestationPercentage: number;

  @ApiProperty({ example: '2024-01-15T10:30:00Z', description: 'Last analysis timestamp' })
  lastAnalysis: string;
}

export class AlertDto {
  @ApiProperty({ example: 'alert-456def', description: 'Unique alert identifier' })
  alertId: string;

  @ApiProperty({ example: 'region-123abc', description: 'Region identifier that triggered the alert' })
  regionId: string;

  @ApiProperty({ example: 'Amazon Rainforest - Sector A', description: 'Region name' })
  regionName: string;

  @ApiProperty({ enum: AlertLevel, example: AlertLevel.HIGH, description: 'Alert severity level' })
  level: AlertLevel;

  @ApiProperty({ example: 15.2, description: 'Deforestation percentage that triggered the alert' })
  deforestationPercentage: number;

  @ApiProperty({ example: '🚨 HIGH DEFORESTATION: 15.2% vegetation loss detected in Amazon Rainforest - Sector A', description: 'Alert message' })
  message: string;

  @ApiProperty({ example: '2024-01-15T10:30:00Z', description: 'Alert creation timestamp' })
  timestamp: string;

  @ApiProperty({ example: false, description: 'Whether the alert has been acknowledged' })
  acknowledged: boolean;
}

export class HistoricalDataPointDto {
  @ApiProperty({ example: '2024-01-15T10:30:00Z', description: 'Analysis timestamp' })
  date: string;

  @ApiProperty({ example: 78.5, description: 'Vegetation percentage (0-100)' })
  vegetationPercentage: number;

  @ApiProperty({ example: 12.5, description: 'Deforestation percentage detected' })
  deforestationPercentage: number;

  @ApiProperty({ example: 0.65, description: 'Average NDVI value' })
  ndviValue: number;

  @ApiProperty({ example: 15, description: 'Cloud cover percentage' })
  cloudCover: number;
}

export class TrendAnalysisDto {
  @ApiProperty({ example: 'region-123abc', description: 'Region identifier' })
  regionId: string;

  @ApiProperty({ example: 'Amazon Rainforest - Sector A', description: 'Region name' })
  regionName: string;

  @ApiProperty({ type: [HistoricalDataPointDto], description: 'Historical data points' })
  dataPoints: HistoricalDataPointDto[];

  @ApiProperty({ example: -2.5, description: 'Vegetation trend percentage (negative = declining)' })
  vegetationTrend: number;

  @ApiProperty({ example: 'DECLINING', description: 'Trend direction', enum: ['IMPROVING', 'STABLE', 'DECLINING'] })
  trendDirection: string;

  @ApiProperty({ example: 30, description: 'Number of days analyzed' })
  analysisPeriodDays: number;
}

export class MonitoringJobDto {
  @ApiProperty({ example: 'job-789ghi', description: 'Unique job identifier' })
  jobId: string;

  @ApiProperty({ example: 'region-123abc', description: 'Region being monitored' })
  regionId: string;

  @ApiProperty({ example: 'Amazon Rainforest - Sector A', description: 'Region name' })
  regionName: string;

  @ApiProperty({ example: 'IN_PROGRESS', description: 'Job status', enum: ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED'] })
  status: string;

  @ApiProperty({ example: 75, description: 'Job completion percentage (0-100)' })
  progress: number;

  @ApiProperty({ example: '2024-01-15T10:00:00Z', description: 'Job start timestamp' })
  startTime: string;

  @ApiPropertyOptional({ example: '2024-01-15T10:15:00Z', description: 'Job completion timestamp' })
  endTime?: string;

  @ApiProperty({ example: 12, description: 'Number of satellite images being processed' })
  totalImages: number;

  @ApiProperty({ example: 9, description: 'Number of images processed so far' })
  processedImages: number;
}

export class GeoBoundsDto {
  @ApiProperty({ example: -6.1, description: 'North boundary latitude' })
  north: number;

  @ApiProperty({ example: -5.9, description: 'South boundary latitude' })  
  south: number;

  @ApiProperty({ example: -52.9, description: 'East boundary longitude' })
  east: number;

  @ApiProperty({ example: -53.1, description: 'West boundary longitude' })
  west: number;
}

export class HeatmapDataDto {
  @ApiProperty({ example: -6.0, description: 'Latitude coordinate' })
  lat: number;

  @ApiProperty({ example: -53.0, description: 'Longitude coordinate' })
  lng: number;

  @ApiProperty({ example: 15.2, description: 'Deforestation intensity (0-100)' })
  intensity: number;

  @ApiProperty({ example: 0.1, description: 'Grid cell size in degrees' })
  cellSize: number;
}

export class HeatmapResponseDto {
  @ApiProperty({ type: GeoBoundsDto, description: 'Geographic boundaries of the heatmap' })
  bounds: GeoBoundsDto;

  @ApiProperty({ type: [HeatmapDataDto], description: 'Heatmap data points' })
  data: HeatmapDataDto[];

  @ApiProperty({ example: '2024-01-15T10:30:00Z', description: 'Data generation timestamp' })
  generatedAt: string;

  @ApiProperty({ example: 30, description: 'Number of days the data covers' })
  periodDays: number;
}

export class VisualizationDto {
  @ApiProperty({ example: 'ndvi_red_clusters', description: 'Type of visualization chart' })
  chartType: string;

  @ApiProperty({ example: 'S2B_MSIL2A_20231215T143751_N0509_R096_T20LLP_20231215T174821', description: 'Tile ID associated with the visualization' })
  tileId: string;

  @ApiProperty({ example: '20241215-143000', description: 'Generation timestamp' })
  timestamp: string;

  @ApiProperty({ example: 'https://forestshield-processed-data-381492060635.s3.amazonaws.com/visualizations/S2B/20241215-143000/ndvi_red_clusters.png', description: 'Public URL to access the visualization' })
  url: string;

  @ApiProperty({ example: '2024-12-15T14:30:00Z', description: 'When the visualization was created' })
  createdAt: string;

  @ApiProperty({ example: 'NDVI vs Red Band K-means Clustering', description: 'Human-readable description of the chart' })
  description: string;
}

export class RegionVisualizationsDto {
  @ApiProperty({ example: 'region-123abc', description: 'Region identifier' })
  regionId: string;

  @ApiProperty({ example: 'Amazon Rainforest - Sector A', description: 'Region name' })
  regionName: string;

  @ApiProperty({ type: [VisualizationDto], description: 'Available visualizations for this region' })
  visualizations: VisualizationDto[];

  @ApiProperty({ example: 15, description: 'Total number of visualizations available' })
  totalVisualizations: number;

  @ApiProperty({ example: '2024-12-15T14:30:00Z', description: 'When this data was retrieved' })
  retrievedAt: string;
}

export class RegionAnalysisControlDto {
  @ApiProperty({ example: 'region-123abc', description: 'Region identifier' })
  regionId: string;

  @ApiProperty({ enum: RegionStatus, example: RegionStatus.ACTIVE, description: 'New monitoring status' })
  status: RegionStatus;

  @ApiProperty({ example: '*/15 * * * *', description: 'Cron expression for analysis interval (optional)', required: false })
  @IsOptional()
  @IsString()
  cronExpression?: string;

  @ApiProperty({ example: '2024-01-15T10:30:00Z', description: 'When the status change was applied' })
  updatedAt: string;

  @ApiProperty({ example: 'Automated analysis started with 15-minute intervals', description: 'Status change message' })
  message: string;
}

export class StartAnalysisDto {
  @ApiPropertyOptional({ example: '*/30 * * * *', description: 'Cron expression for analysis interval (default: every 30 minutes)' })
  @IsOptional()
  @IsString()
  cronExpression?: string;

  @ApiPropertyOptional({ example: true, description: 'Whether to trigger immediate analysis when starting (default: false)' })
  @IsOptional()
  @IsBoolean()
  triggerImmediate?: boolean;
}

export class AnalysisScheduleDto {
  @ApiProperty({ example: 'region-123abc', description: 'Region identifier' })
  regionId: string;

  @ApiProperty({ example: 'Amazon Rainforest - Sector A', description: 'Region name' })
  regionName: string;

  @ApiProperty({ enum: RegionStatus, example: RegionStatus.ACTIVE, description: 'Current monitoring status' })
  status: RegionStatus;

  @ApiProperty({ example: '*/30 * * * *', description: 'Current cron expression for analysis interval' })
  cronExpression: string;

  @ApiProperty({ example: '2024-01-15T10:30:00Z', description: 'Next scheduled analysis time' })
  nextAnalysis: string;

  @ApiProperty({ example: '2024-01-15T10:00:00Z', description: 'Last analysis time' })
  lastAnalysis: string;

  @ApiProperty({ example: 24, description: 'Number of analyses completed in last 24 hours' })
  analysesLast24h: number;

  @ApiProperty({ example: true, description: 'Whether automated analysis is currently active' })
  isActive: boolean;
} 