import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { SentinelController } from './sentinel.controller';
import { DashboardController } from './dashboard.controller';
import { SentinelService } from './sentinel.service';
import { SentinelDataService } from './services/sentinel-data.service';
import { AWSService } from './services/aws.service';
import { ImageDownloadService } from './services/image-download.service';
import { AWSLambdaService } from './aws-lambda.service';
import { DashboardService } from './services/dashboard.service';

@Module({
  imports: [HttpModule],
  controllers: [SentinelController, DashboardController],
  providers: [
    SentinelService,
    SentinelDataService,
    AWSService,
    ImageDownloadService,
    AWSLambdaService,
    DashboardService,
  ],
  exports: [SentinelService, DashboardService],
})
export class SentinelModule {} 