import { Injectable, Logger } from '@nestjs/common';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

@Injectable()
export class AWSLambdaService {
  private readonly logger = new Logger(AWSLambdaService.name);

  constructor() {
    this.logger.log('AWS Lambda Service initialized for serverless processing');
  }

  getLambdaFunctions() {
    return {
      functions: [
        {
          name: 'forestshield-ndvi-calculator-java',
          runtime: 'java17',
          handler: 'com.forestshield.NDVICalculatorHandler::handleRequest',
          description: 'Calculate NDVI from Sentinel-2 Red and NIR bands using Java + SnapStart',
          memory: 1024,
          timeout: 300,
          snapstart: true,
          source_file: 'lambda-functions/ndvi-calculator/src/main/java/com/forestshield/NDVICalculatorHandler.java',
          build_file: 'lambda-functions/ndvi-calculator/pom.xml',
          deployment_package: 'lambda-functions/ndvi-calculator/ndvi-calculator-deployment.zip',
          features: [
            'Zero cold start with SnapStart',
            'CRaC (Coordinated Restore at Checkpoint)',
            'GeoTools integration for satellite data',
            'NDVI vegetation classification',
            'S3 integration for band processing'
          ]
        },
        {
          name: 'forestshield-search-images-java',
          runtime: 'java17', 
          handler: 'com.forestshield.SearchImagesHandler::handleRequest',
          description: 'Search Sentinel-2 images via AWS STAC API using Java + SnapStart',
          memory: 512,
          timeout: 120,
          snapstart: true,
          source_file: 'lambda-functions/search-images/src/main/java/com/forestshield/SearchImagesHandler.java',
          build_file: 'lambda-functions/search-images/pom.xml',
          deployment_package: 'lambda-functions/search-images/search-images-deployment.zip',
          features: [
            'Zero cold start with SnapStart',
            'HTTP client pre-warming',
            'STAC API integration',
            'Parallel image processing',
            'Cloud cover filtering'
          ]
        },
        {
          name: 'forestshield-sagemaker-processor-java',
          runtime: 'java17',
          handler: 'com.forestshield.SageMakerProcessorHandler::handleRequest', 
          description: 'Process NDVI data with SageMaker K-means clustering using Java + SnapStart',
          memory: 1024,
          timeout: 900,
          snapstart: true,
          source_file: 'lambda-functions/sagemaker-processor/src/main/java/com/forestshield/SageMakerProcessorHandler.java',
          build_file: 'lambda-functions/sagemaker-processor/pom.xml',
          deployment_package: 'lambda-functions/sagemaker-processor/sagemaker-processor-deployment.zip',
          features: [
            'Zero cold start with SnapStart',
            'SageMaker SDK pre-initialization',
            'K-means clustering orchestration',
            'SNS notification integration',
            'Deforestation pattern analysis'
          ]
        }
      ],
      step_functions_workflow: {
        name: 'forestshield-deforestation-detection',
        definition_file: 'lambda-functions/step-functions/deforestation-detection-workflow.json',
        description: 'Complete serverless workflow for deforestation detection',
        states: 7,
        parallel_processing: true,
        features: [
          'Image search and filtering',
          'NDVI calculation pipeline', 
          'SageMaker ML processing',
          'Error handling and retries',
          'SNS alert system'
        ]
      },
      deployment: {
        build_script: 'lambda-functions/build-all.sh',
        infrastructure: 'terraform',
        snapstart_enabled: true,
        estimated_costs: {
          lambda_requests: '$0.20 per 1M requests',
          lambda_duration: '$16.67 per 1GB-second',
          sagemaker_training: '$0.065 per hour (ml.m5.large)',
          s3_storage: '$0.023 per GB',
          data_transfer: '$0.09 per GB'
        }
      }
    };
  }

  getSourceCode(functionName: string): { exists: boolean; content?: string; path?: string } {
    const functionMap = {
      'ndvi-calculator': 'lambda-functions/ndvi-calculator/src/main/java/com/forestshield/NDVICalculatorHandler.java',
      'search-images': 'lambda-functions/search-images/src/main/java/com/forestshield/SearchImagesHandler.java', 
      'sagemaker-processor': 'lambda-functions/sagemaker-processor/src/main/java/com/forestshield/SageMakerProcessorHandler.java'
    };

    const filePath = functionMap[functionName];
    if (!filePath) {
      return { exists: false };
    }

    const fullPath = join(process.cwd(), filePath);
    
    if (!existsSync(fullPath)) {
      return { exists: false, path: fullPath };
    }

    try {
      const content = readFileSync(fullPath, 'utf-8');
      return { exists: true, content, path: fullPath };
    } catch (error) {
      this.logger.error(`Failed to read source code for ${functionName}: ${error.message}`);
      return { exists: false, path: fullPath };
    }
  }

  getBuildConfiguration(functionName: string): { exists: boolean; content?: string; path?: string } {
    const buildMap = {
      'ndvi-calculator': 'lambda-functions/ndvi-calculator/pom.xml',
      'search-images': 'lambda-functions/search-images/pom.xml',
      'sagemaker-processor': 'lambda-functions/sagemaker-processor/pom.xml'
    };

    const filePath = buildMap[functionName];
    if (!filePath) {
      return { exists: false };
    }

    const fullPath = join(process.cwd(), filePath);
    
    if (!existsSync(fullPath)) {
      return { exists: false, path: fullPath };
    }

    try {
      const content = readFileSync(fullPath, 'utf-8');
      return { exists: true, content, path: fullPath };
    } catch (error) {
      this.logger.error(`Failed to read build config for ${functionName}: ${error.message}`);
      return { exists: false, path: fullPath };
    }
  }

  getStepFunctionsWorkflow(): { exists: boolean; workflow?: any; path?: string } {
    const workflowPath = 'lambda-functions/step-functions/deforestation-detection-workflow.json';
    const fullPath = join(process.cwd(), workflowPath);
    
    if (!existsSync(fullPath)) {
      return { exists: false, path: fullPath };
    }

    try {
      const content = readFileSync(fullPath, 'utf-8');
      const workflow = JSON.parse(content);
      return { exists: true, workflow, path: fullPath };
    } catch (error) {
      this.logger.error(`Failed to read Step Functions workflow: ${error.message}`);
      return { exists: false, path: fullPath };
    }
  }

  async simulateNDVIProcessing(imageId: string): Promise<any> {
    this.logger.log('AWS Lambda Service initialized for serverless processing');
    this.logger.log(`Simulating NDVI processing for ${imageId}`);
    
    // Simulate realistic processing time
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Get actual source code info
    const sourceInfo = this.getSourceCode('ndvi-calculator');
    
    return {
      success: true,
      lambda_function: 'forestshield-ndvi-calculator-java',
      runtime: 'java17',
      snapstart_enabled: true,
      cold_start_time: '0ms (SnapStart)',
      execution_time: '847ms',
      memory_used: '892MB',
      source_code_available: sourceInfo.exists,
      source_file: sourceInfo.path,
      image_id: imageId,
      ndvi_output: `s3://forestshield-processed/ndvi/${imageId}_ndvi.tif`,
      statistics: {
        mean_ndvi: 0.735,
        min_ndvi: -0.124,
        max_ndvi: 0.912,
        vegetation_coverage: 73.5,
        valid_pixels: 2847392
      },
      classification: {
        dense_forest: 45.2,
        light_forest: 28.3,
        no_vegetation: 26.5
      },
      processing_details: {
        bands_processed: ['B04 (Red)', 'B08 (NIR)'],
        algorithm: 'NDVI = (NIR - Red) / (NIR + Red)',
        output_format: 'GeoTIFF',
        coordinate_system: 'EPSG:4326'
      }
    };
  }

  getSageMakerConfiguration() {
    return {
      algorithm: 'k-means',
      instance_type: 'ml.m5.large',
      instance_count: 1,
      volume_size_gb: 30,
      max_runtime_seconds: 3600,
      hyperparameters: {
        k: 3,
        feature_dim: 1,
        mini_batch_size: 1000,
        epochs: 10,
        init_method: 'kmeans++',
        local_init_method: 'kmeans++',
        half_life_time_size: 0,
        epochs_between_reporting: 1
      },
      input_data: {
        content_type: 'text/csv',
        s3_data_type: 'S3Prefix',
        s3_data_distribution_type: 'FullyReplicated',
        compression_type: 'None'
      },
      output_config: {
        s3_output_path: 's3://forestshield-sagemaker-output/kmeans/'
      },
      java_implementation: {
        source_available: this.getSourceCode('sagemaker-processor').exists,
        snapstart_enabled: true,
        features: [
          'Zero cold start latency',
          'Pre-initialized SageMaker client',
          'Automatic job monitoring',
          'SNS notification integration'
        ]
      }
    };
  }
} 