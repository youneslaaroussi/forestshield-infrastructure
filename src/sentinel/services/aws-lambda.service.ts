import { Injectable, Logger } from '@nestjs/common';

export interface LambdaFunction {
  name: string;
  description: string;
  runtime: string;
  handler: string;
  code: string;
}

export interface NDVIProcessingRequest {
  imageId: string;
  redBandUrl: string;
  nirBandUrl: string;
  outputBucket: string;
  region: {
    latitude: number;
    longitude: number;
  };
}

@Injectable()
export class AWSLambdaService {
  private readonly logger = new Logger(AWSLambdaService.name);

  constructor() {
    this.logger.log('AWS Lambda Service initialized for serverless processing');
  }

  // Generate Lambda function for NDVI calculation
  generateNDVICalculatorFunction(): LambdaFunction {
    const code = `
import json
import boto3
import numpy as np
import rasterio
from rasterio.warp import calculate_default_transform, reproject, Resampling
import tempfile
import os

s3 = boto3.client('s3')

def lambda_handler(event, context):
    """
    AWS Lambda function to calculate NDVI from Sentinel-2 bands
    Processes data directly in S3 without local downloads
    """
    
    try:
        # Extract parameters
        image_id = event['imageId']
        red_band_url = event['redBandUrl'] 
        nir_band_url = event['nirBandUrl']
        output_bucket = event['outputBucket']
        
        # Use /vsis3/ to read directly from S3
        red_band_path = f"/vsis3/{red_band_url.split('amazonaws.com/')[-1]}"
        nir_band_path = f"/vsis3/{nir_band_url.split('amazonaws.com/')[-1]}"
        
        print(f"Processing NDVI for {image_id}")
        print(f"Red band: {red_band_path}")
        print(f"NIR band: {nir_band_path}")
        
        # Open bands directly from S3
        with rasterio.open(red_band_path) as red_dataset:
            with rasterio.open(nir_band_path) as nir_dataset:
                
                # Read band data
                red_band = red_dataset.read(1).astype(float)
                nir_band = nir_dataset.read(1).astype(float)
                
                # Calculate NDVI: (NIR - Red) / (NIR + Red)
                ndvi = np.divide(
                    nir_band - red_band,
                    nir_band + red_band,
                    out=np.zeros_like(nir_band),
                    where=(nir_band + red_band) != 0
                )
                
                # Handle invalid values
                ndvi = np.clip(ndvi, -1, 1)
                
                # Calculate vegetation statistics
                valid_pixels = ndvi[(ndvi > -1) & (ndvi < 1)]
                vegetation_coverage = np.sum(valid_pixels > 0.3) / len(valid_pixels) * 100
                
                # Classification
                dense_forest = np.sum(valid_pixels > 0.6) / len(valid_pixels) * 100
                light_forest = np.sum((valid_pixels > 0.3) & (valid_pixels <= 0.6)) / len(valid_pixels) * 100
                no_vegetation = np.sum(valid_pixels <= 0.3) / len(valid_pixels) * 100
                
                # Save NDVI to S3
                output_key = f"ndvi/{image_id}_ndvi.tif"
                
                with tempfile.NamedTemporaryFile(suffix='.tif') as tmp_file:
                    # Write NDVI with same georeferencing as input
                    profile = red_dataset.profile
                    profile.update(dtype=rasterio.float32, count=1)
                    
                    with rasterio.open(tmp_file.name, 'w', **profile) as dst:
                        dst.write(ndvi.astype(rasterio.float32), 1)
                    
                    # Upload to S3
                    s3.upload_file(tmp_file.name, output_bucket, output_key)
                
                # Return results
                return {
                    'statusCode': 200,
                    'body': json.dumps({
                        'success': True,
                        'imageId': image_id,
                        'ndvi_output': f"s3://{output_bucket}/{output_key}",
                        'statistics': {
                            'mean_ndvi': float(np.mean(valid_pixels)),
                            'min_ndvi': float(np.min(valid_pixels)),
                            'max_ndvi': float(np.max(valid_pixels)),
                            'vegetation_coverage': float(vegetation_coverage)
                        },
                        'classification': {
                            'dense_forest': float(dense_forest),
                            'light_forest': float(light_forest),
                            'no_vegetation': float(no_vegetation)
                        }
                    })
                }
                
    except Exception as e:
        print(f"Error processing NDVI: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({
                'success': False,
                'error': str(e)
            })
        }
`;

    return {
      name: 'forestshield-ndvi-calculator',
      description: 'Calculate NDVI from Sentinel-2 bands directly in S3',
      runtime: 'python3.9',
      handler: 'lambda_function.lambda_handler',
      code,
    };
  }

  // Generate SageMaker processing job configuration
  generateSageMakerKMeansJob() {
    return {
      jobName: 'forestshield-kmeans-clustering',
      description: 'K-means clustering for vegetation classification',
      instanceType: 'ml.m5.large',
      algorithm: 'k-means',
      hyperparameters: {
        k: '3', // Dense forest, light forest, no vegetation
        epochs: '10',
        init_method: 'random'
      },
      inputDataConfig: {
        ContentType: 'text/csv',
        S3DataType: 'S3Prefix',
        S3Uri: 's3://forestshield-data/ndvi-features/',
        S3DataDistributionType: 'FullyReplicated'
      },
      outputDataConfig: {
        S3OutputPath: 's3://forestshield-models/kmeans-output/'
      }
    };
  }

  // Generate Step Functions workflow for complete pipeline
  generateStepFunctionsWorkflow() {
    return {
      Comment: 'ForestShield deforestation detection pipeline',
      StartAt: 'SearchSentinelImages',
      States: {
        SearchSentinelImages: {
          Type: 'Task',
          Resource: 'arn:aws:lambda:us-west-2:123456789012:function:forestshield-search-images',
          Next: 'ProcessNDVI'
        },
        ProcessNDVI: {
          Type: 'Map',
          ItemsPath: '$.images',
          MaxConcurrency: 5,
          Iterator: {
            StartAt: 'CalculateNDVI',
            States: {
              CalculateNDVI: {
                Type: 'Task',
                Resource: 'arn:aws:lambda:us-west-2:123456789012:function:forestshield-ndvi-calculator',
                End: true
              }
            }
          },
          Next: 'RunKMeansClustering'
        },
        RunKMeansClustering: {
          Type: 'Task',
          Resource: 'arn:aws:states:::sagemaker:createProcessingJob.sync',
          Parameters: {
            ProcessingJobName: 'forestshield-kmeans-clustering',
            AppSpecification: {
              ImageUri: '683313688378.dkr.ecr.us-west-2.amazonaws.com/sagemaker-scikit-learn:0.23-1-cpu-py3'
            }
          },
          Next: 'DetectChanges'
        },
        DetectChanges: {
          Type: 'Task',
          Resource: 'arn:aws:lambda:us-west-2:123456789012:function:forestshield-change-detector',
          Next: 'GenerateAlerts'
        },
        GenerateAlerts: {
          Type: 'Task',
          Resource: 'arn:aws:lambda:us-west-2:123456789012:function:forestshield-alert-generator',
          End: true
        }
      }
    };
  }

  async simulateNDVIProcessing(request: NDVIProcessingRequest) {
    this.logger.log(`Simulating NDVI processing for ${request.imageId}`);
    
    // Simulate cloud processing without downloads
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    return {
      success: true,
      imageId: request.imageId,
      ndvi_output: `s3://${request.outputBucket}/ndvi/${request.imageId}_ndvi.tif`,
      processing_time: '1.2s',
      statistics: {
        mean_ndvi: 0.65,
        min_ndvi: -0.1,
        max_ndvi: 0.89,
        vegetation_coverage: 73.5
      },
      classification: {
        dense_forest: 45.2,
        light_forest: 28.3,
        no_vegetation: 26.5
      },
      lambda_function_used: 'forestshield-ndvi-calculator'
    };
  }
} 