import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getRoot() {
    return {
      service: 'ForestShield API',
      version: '1.0.0',
      description: 'AWS-powered deforestation detection using Sentinel-2 satellite imagery',
      endpoints: {
        health: '/sentinel/health',
        search: 'POST /sentinel/search',
        process: 'POST /sentinel/process',
        analyze: 'POST /sentinel/analyze-region',
        status: 'GET /sentinel/status/:jobId',
      },
      documentation: 'Real-time deforestation monitoring for Amazon rainforest',
    };
  }

  @Get('forestshield')
  getForestShield() {
    return {
      project: 'ForestShield',
      version: '1.0.0',
      purpose: 'Real-time deforestation detection using AWS and Sentinel-2 satellite imagery',
      target: 'Amazon Rainforest - Pará, Brazil (Novo Progresso region)',
      architecture: 'AWS Serverless (Lambda, SageMaker, S3, Step Functions, SNS)',
      capabilities: [
        'Sentinel-2 satellite image search and processing',
        'NDVI calculation for vegetation analysis',
        'Real-time deforestation change detection',
        'Automated alerts via SNS',
        'S3-based data storage and processing',
        'Step Functions workflow orchestration'
      ],
      status: 'Production Ready - No Demo Mode',
      deployment: 'Requires AWS credentials and infrastructure deployment',
    };
  }

  @Get('sentinel/amazon-data')
  async getAmazonData() {
    // This will be a quick way to test our Amazon region data
    return {
      message: 'Amazon rainforest data endpoint ready',
      region: 'Pará, Brazil',
      coordinates: [-6.0, -53.0],
      timeframe: '2022-06-01 to 2022-09-01',
      note: 'Use POST /sentinel/process to start processing'
    };
  }
}
