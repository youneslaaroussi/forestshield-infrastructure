import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { AWSService } from './aws.service';

export interface SearchParams {
  latitude: number;
  longitude: number;
  startDate: string;
  endDate: string;
  cloudCover: number;
}

export interface SentinelImage {
  id: string;
  date: string;
  cloudCover: number;
  geometry: any;
  assets: {
    red: string; // Red band (B04)
    nir: string; // NIR band (B08)
    blue: string; // Blue band (B02)
    green: string; // Green band (B03)
    visual?: string; // RGB composite
  };
  bbox: number[];
}

export interface NDVIResult {
  imageId: string;
  date: string;
  ndviStats: {
    mean: number;
    min: number;
    max: number;
    stdDev: number;
  };
  ndviImagePath: string;
  vegetationPercentage: number;
}

@Injectable()
export class SentinelDataService {
  private readonly logger = new Logger(SentinelDataService.name);
  
  // STAC API endpoint for Sentinel-2 on AWS
  private readonly stacEndpoint = 'https://earth-search.aws.element84.com/v1';
  
  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly awsService: AWSService,
  ) {}

  async searchImages(params: SearchParams): Promise<SentinelImage[]> {
    this.logger.log(`Searching Sentinel-2 images via Lambda for coordinates: ${params.latitude}, ${params.longitude}`);
    
    // Re-add date validation before invoking the Lambda
    let { startDate: originalStartDate, endDate: originalEndDate, ...rest } = params;
    let endDate = new Date(originalEndDate);
    const now = new Date();

    if (endDate > now) {
      this.logger.warn(`End date ${originalEndDate} is in the future. Adjusting to today.`);
      endDate = now;
    }

    let startDate = new Date(originalStartDate);
    if (startDate > endDate) {
      this.logger.warn(`Start date ${originalStartDate} is after end date ${endDate.toISOString().split('T')[0]}. Adjusting start date to 30 days prior.`);
      startDate = new Date(endDate);
      startDate.setDate(endDate.getDate() - 30);
    }
    
    const finalParams = {
      ...rest,
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
    };

    const functionName = this.configService.get<string>('SEARCH_IMAGES_FUNCTION_ARN');
    if (!functionName) {
      this.logger.error('SEARCH_IMAGES_FUNCTION_ARN is not set in environment variables.');
      throw new Error('Search image function is not configured.');
    }

    try {
      // aws.service.invokeLambda returns the parsed body directly
      const results = await this.awsService.invokeLambda(functionName, finalParams);
      
      this.logger.debug(`Lambda response: ${JSON.stringify(results)}`);

      if (!results || typeof results.success === 'undefined') {
         throw new Error('Invalid response from Search Lambda');
      }

      if (results.success === false) {
        this.logger.warn(`Search Lambda reported failure: ${JSON.stringify(results)}`);
        return []; // Return empty on reported failure
      }

      this.logger.log(`Found ${results.count || 0} Sentinel-2 images via Lambda.`);

      // The Java lambda returns raw STAC features. We need to map them to our SentinelImage interface.
      const features = results.images || [];
      return features.map((feature: any) => ({
        id: feature.id,
        date: feature.date,
        cloudCover: feature.cloudCover || 0,
        geometry: feature.geometry,
        bbox: feature.bbox,
        assets: {
          red: feature.assets?.B04 || '',
          nir: feature.assets?.B08 || '',
          blue: feature.assets?.B02 || '',
          green: feature.assets?.B03 || '',
          visual: feature.assets?.visual || '',
        },
      }));

    } catch (error) {
      this.logger.error(`Failed to invoke search-images lambda: ${error.message}`, error.stack);
      return [];
    }
  }

  async calculateNDVIWithLambda(image: SentinelImage, region?: {latitude: number, longitude: number}): Promise<NDVIResult> {
    this.logger.log(`🌱 Sending vegetation analysis to Python Lambda for image: ${image.id}`);
    this.logger.debug(`Red band URL: ${image.assets.red}`);
    this.logger.debug(`NIR band URL: ${image.assets.nir}`);

    if (!image.assets.red || !image.assets.nir) {
      throw new Error(`Missing required bands (red or nir) for NDVI calculation in image ${image.id}`);
    }

    const bucketName = this.configService.get<string>('PROCESSED_DATA_BUCKET');
    if (!bucketName) {
      throw new Error('PROCESSED_DATA_BUCKET environment variable is required');
    }

    // Payload for the new Python vegetation analyzer
    const lambdaPayload = {
      imageId: image.id,
      redBandUrl: image.assets.red,
      nirBandUrl: image.assets.nir,
      outputBucket: bucketName,
      region: region || {
        latitude: 0,
        longitude: 0,
      },
    };

    try {
      // Invoke the NEW Python vegetation analyzer Lambda function
      const apiGatewayEvent = {
        body: JSON.stringify(lambdaPayload),
        headers: {
          'Content-Type': 'application/json'
        },
        httpMethod: 'POST',
        isBase64Encoded: false,
        path: '/analyze-vegetation',
        queryStringParameters: null,
        requestContext: {
          requestId: `req-${Date.now()}`,
        }
      };

      this.logger.debug(`🐍 Sending Python Lambda payload: ${JSON.stringify(lambdaPayload, null, 2)}`);
      
      const lambdaResponse = await this.awsService.invokeLambda(
        'forestshield-vegetation-analyzer',
        apiGatewayEvent
      );

      this.logger.debug(`🌱 Python Lambda response: ${JSON.stringify(lambdaResponse, null, 2)}`);

      // Parse the API Gateway response
      let responseBody;
      try {
        responseBody = typeof lambdaResponse.body === 'string' 
          ? JSON.parse(lambdaResponse.body) 
          : lambdaResponse.body;
      } catch (parseError) {
        this.logger.error(`Failed to parse Python Lambda response: ${parseError.message}`);
        this.logger.debug(`Raw Lambda response: ${JSON.stringify(lambdaResponse)}`);
        throw new Error(`Invalid Lambda response format: ${parseError.message}`);
      }

      if (!responseBody.success) {
        throw new Error(`Python vegetation analysis failed: ${responseBody.error || 'Unknown error'}`);
      }

      const stats = responseBody.statistics;
      
      this.logger.log(`🎉 Python NDVI calculated for ${image.id}: mean=${stats.mean_ndvi.toFixed(3)}, vegetation=${stats.vegetation_coverage.toFixed(1)}%`);

      return {
        imageId: image.id,
        date: image.date,
        ndviStats: {
          mean: Number(stats.mean_ndvi.toFixed(4)),
          min: Number(stats.min_ndvi.toFixed(4)),
          max: Number(stats.max_ndvi.toFixed(4)),
          stdDev: Number(stats.std_ndvi.toFixed(4)),
        },
        ndviImagePath: responseBody.ndvi_output,
        vegetationPercentage: Number(stats.vegetation_coverage.toFixed(2)),
      };
    } catch (error) {
      this.logger.error(`Python vegetation analysis failed for ${image.id}: ${error.message}`);
      throw error;
    }
  }

  async processImagesForDeforestation(images: SentinelImage[], region?: {latitude: number, longitude: number}): Promise<NDVIResult[]> {
    this.logger.log(`Processing ${images.length} images for deforestation analysis using Lambda`);

    const results: NDVIResult[] = [];

    for (const image of images) {
      try {
        const ndviResult = await this.calculateNDVIWithLambda(image, region);
        results.push(ndviResult);
      } catch (error) {
        this.logger.error(`Failed to process image ${image.id}: ${error.message}`);
        throw error;
      }
    }

    // Sort by date for temporal analysis
    results.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    return results;
  }

  async detectDeforestationChanges(ndviResults: NDVIResult[]): Promise<{
    deforestationPercentage: number;
    alertMessage: string;
    timeSeriesData: Array<{ date: string; vegetationPercentage: number }>;
  }> {
    if (ndviResults.length < 2) {
      throw new Error('At least 2 images are required for change detection');
    }

    const timeSeriesData = ndviResults.map(result => ({
      date: result.date,
      vegetationPercentage: result.vegetationPercentage,
    }));

    // Calculate vegetation loss between first and last image
    const initialVegetation = ndviResults[0].vegetationPercentage;
    const finalVegetation = ndviResults[ndviResults.length - 1].vegetationPercentage;
    const deforestationPercentage = initialVegetation - finalVegetation;

    let alertMessage = '';
    if (deforestationPercentage > 10) {
      alertMessage = `🚨 CRITICAL DEFORESTATION ALERT: ${deforestationPercentage.toFixed(1)}% vegetation loss detected`;
    } else if (deforestationPercentage > 5) {
      alertMessage = `⚠️ MODERATE DEFORESTATION: ${deforestationPercentage.toFixed(1)}% vegetation loss detected`;
    } else if (deforestationPercentage > 0) {
      alertMessage = `📊 Minor vegetation change: ${deforestationPercentage.toFixed(1)}% loss detected`;
    } else {
      alertMessage = `✅ No significant deforestation detected. Vegetation stable at ${finalVegetation.toFixed(1)}%`;
    }

    this.logger.log(`Deforestation analysis complete: ${deforestationPercentage.toFixed(1)}% change`);

    return {
      deforestationPercentage: Number(deforestationPercentage.toFixed(2)),
      alertMessage,
      timeSeriesData,
    };
  }
} 