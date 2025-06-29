import { Controller, Get, Post, Body, Param, Logger, Inject } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBody } from '@nestjs/swagger';
import { SentinelService } from './sentinel.service';
import { SearchParams } from './services/sentinel-data.service';
import { DashboardService } from './services/dashboard.service';
import { AlertLevel } from './dto/dashboard.dto';

@ApiTags('analysis')
@Controller('sentinel')
export class SentinelController {
  private readonly logger = new Logger(SentinelController.name);

  constructor(
    private readonly sentinelService: SentinelService,
    private readonly dashboardService: DashboardService,
  ) {}

  @Get('health')
  @ApiOperation({ 
    summary: 'Health check',
    description: 'Returns the service health status and basic information'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Service is healthy',
    schema: {
      example: {
        status: 'healthy',
        timestamp: '2024-01-15T10:30:00Z',
        service: 'ForestShield Sentinel-2 Processing',
        version: '1.0.0'
      }
    }
  })
  async getHealth() {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'ForestShield Sentinel-2 Processing',
      version: '1.0.0',
    };
  }

  @Post('search')
  @ApiOperation({ 
    summary: 'Search satellite images',
    description: 'Search for Sentinel-2 satellite images based on geographic and temporal criteria'
  })
  @ApiBody({
    description: 'Search parameters for satellite imagery',
    schema: {
      example: {
        latitude: -6.0,
        longitude: -53.0,
        startDate: "2022-06-01",
        endDate: "2022-09-01",
        cloudCover: 20
      }
    }
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Satellite images found successfully',
    schema: {
      example: {
        success: true,
        count: 22,
        params: {
          latitude: -6.0,
          longitude: -53.0,
          startDate: "2022-06-01",
          endDate: "2022-09-01",
          cloudCover: 20
        },
        images: []
      }
    }
  })
  async searchImages(@Body() params: SearchParams) {
    this.logger.log(`Searching images for coordinates: ${params.latitude}, ${params.longitude}`);
    
    const images = await this.sentinelService.searchSentinelImages(params);
    
    return {
      success: true,
      count: images.length,
      params,
      images,
    };
  }

  @Post('process')
  @ApiOperation({ 
    summary: 'Start deforestation processing job',
    description: 'Initiates a long-running deforestation analysis job for the specified region'
  })
  @ApiBody({
    description: 'Processing job parameters',
    schema: {
      example: {
        searchParams: {
          latitude: -6.0,
          longitude: -53.0,
          startDate: "2022-06-01",
          endDate: "2022-09-01",
          cloudCover: 20
        },
        maxImages: 10
      }
    }
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Processing job started successfully',
    schema: {
      example: {
        success: true,
        jobId: "job-1705312345-abc123",
        message: "Deforestation processing job started",
        estimatedCompletionTime: "10-15 minutes"
      }
    }
  })
  async processForDeforestation(@Body() body: { 
    searchParams: SearchParams;
    maxImages?: number;
  }) {
    this.logger.log('Starting deforestation processing job');
    
    const { searchParams, maxImages = 10 } = body;
    
    const jobId = await this.sentinelService.startDeforestationProcessing(searchParams, maxImages);
    
    return {
      success: true,
      jobId,
      message: 'Deforestation processing job started',
      estimatedCompletionTime: '10-15 minutes',
    };
  }

  @Get('status/:jobId')
  @ApiOperation({ 
    summary: 'Get processing job status',
    description: 'Returns the current status and progress of a deforestation processing job'
  })
  @ApiParam({ name: 'jobId', description: 'Unique job identifier returned from the process endpoint' })
  @ApiResponse({ 
    status: 200, 
    description: 'Job status retrieved successfully',
    schema: {
      example: {
        success: true,
        jobId: "job-1705312345-abc123",
        status: "IN_PROGRESS",
        progress: 75,
        startTime: "2024-01-15T10:00:00Z"
      }
    }
  })
  @ApiResponse({ status: 404, description: 'Job not found' })
  async getJobStatus(@Param('jobId') jobId: string) {
    this.logger.log(`Getting status for job: ${jobId}`);
    
    const status = await this.sentinelService.getProcessingJobStatus(jobId);
    
    return {
      success: true,
      jobId,
      ...status,
    };
  }

  @Post('analyze-region')
  @ApiOperation({ 
    summary: 'Analyze region for deforestation',
    description: 'Performs immediate deforestation analysis for a specific geographic region'
  })
  @ApiBody({
    description: 'Region analysis parameters',
    schema: {
      example: {
        latitude: -6.0,
        longitude: -53.0,
        startDate: "2022-06-01",
        endDate: "2022-09-01",
        cloudCover: 20
      }
    }
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Region analysis completed successfully',
    schema: {
      example: {
        success: true,
        region: {
          coordinates: [-6.0, -53.0],
          timeRange: "2022-06-01 to 2022-09-01"
        },
        imagesFound: 22,
        analysisResults: {
          deforestationPercentage: 8.5,
          alertMessage: "⚠️ MODERATE DEFORESTATION: 8.5% vegetation loss detected",
          timeSeriesData: []
        },
        processingTime: "45.2s"
      }
    }
  })
  async analyzeRegion(@Body() body: {
    latitude: number;
    longitude: number;
    startDate: string;
    endDate: string;
    cloudCover?: number;
  }) {
    this.logger.log(`Analyzing region: ${body.latitude}, ${body.longitude}`);
    
    const searchParams: SearchParams = {
      latitude: body.latitude,
      longitude: body.longitude,
      startDate: body.startDate,
      endDate: body.endDate,
      cloudCover: body.cloudCover || 20,
    };

    const analysis = await this.sentinelService.analyzeRegionForDeforestation(searchParams);
    
    // Create or update a region in the dashboard for this analysis
    const regionName = `Analysis ${body.latitude}, ${body.longitude}`;
    let region;
    
    try {
      // Try to find existing region with same coordinates
      const existingRegions = await this.dashboardService.getAllRegions();
      region = existingRegions.find(r => 
        Math.abs(r.latitude - body.latitude) < 0.01 && 
        Math.abs(r.longitude - body.longitude) < 0.01
      );
      
      if (!region) {
        // Create new region if none found
        region = await this.dashboardService.createRegion({
          name: regionName,
          latitude: body.latitude,
          longitude: body.longitude,
          description: `Auto-created from analysis ${new Date().toISOString()}`,
          radiusKm: 10,
          cloudCoverThreshold: body.cloudCover || 20,
        });
      }
      // Actually update the region with the latest analysis results
      region = await this.dashboardService.updateRegion(region.regionId, {
        lastDeforestationPercentage: analysis.analysisResults.deforestationPercentage,
        lastAnalysis: new Date().toISOString(),
      });
      this.logger.log(`Updated region ${region.regionId} with ${analysis.analysisResults.deforestationPercentage}% deforestation`);
    } catch (error) {
      this.logger.warn(`Could not save region to dashboard: ${error.message}`);
    }

    // Create alert if deforestation is significant
    if (analysis.analysisResults.deforestationPercentage > 3 && region) {
      try {
        await this.dashboardService.createAlert(region, analysis.analysisResults.deforestationPercentage);
        this.logger.log(`Created alert for ${analysis.analysisResults.deforestationPercentage}% deforestation in region ${region.name}`);
      } catch (error) {
        this.logger.warn(`Could not create alert: ${error.message}`);
      }
    }
    
    return {
      success: true,
      region: {
        coordinates: [body.latitude, body.longitude],
        timeRange: `${body.startDate} to ${body.endDate}`,
      },
      ...analysis,
      dashboardUpdated: !!region,
    };
  }

  @Post('step-functions/trigger')
  @ApiOperation({ 
    summary: 'Trigger Step Functions workflow',
    description: 'Starts the AWS Step Functions workflow for comprehensive deforestation analysis'
  })
  @ApiBody({
    description: 'Step Functions workflow parameters',
    schema: {
      example: {
        searchParams: {
          latitude: -6.0,
          longitude: -53.0,
          startDate: "2022-06-01",
          endDate: "2022-09-01",
          cloudCover: 20
        }
      }
    }
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Step Functions workflow started successfully',
    schema: {
      example: {
        success: true,
        executionArn: "arn:aws:states:us-west-2:123456789:execution:forestshield:exec-abc123",
        message: "Step Functions workflow started"
      }
    }
  })
  async triggerWorkflow(@Body() body: { searchParams: SearchParams }) {
    this.logger.log('Triggering Step Functions workflow');
    
    const execution = await this.sentinelService.triggerStepFunctionsWorkflow(body.searchParams);
    
    return {
      success: true,
      executionArn: execution.executionArn,
      message: 'Step Functions workflow started',
    };
  }
} 