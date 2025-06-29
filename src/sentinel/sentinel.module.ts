import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { SentinelController } from './sentinel.controller';
import { DashboardController } from './dashboard.controller';
import { SentinelService } from './sentinel.service';
import { SentinelDataService } from './services/sentinel-data.service';
import { AWSService } from './services/aws.service';
import { AWSMonitoringService } from './services/aws-monitoring.service';
import { AWSSecurityService } from './services/aws-security.service';
import { AWSActivityService } from './services/aws-activity.service';
import { DashboardService } from './services/dashboard.service';
import { AWSRealtimeGateway } from './aws-realtime.gateway';
import { GeospatialService } from './services/geospatial.service';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [
    HttpModule,
    RedisModule,
  ],
  controllers: [SentinelController, DashboardController],
  providers: [
    SentinelService,
    SentinelDataService,
    AWSService,
    AWSMonitoringService,
    AWSSecurityService,
    AWSActivityService,
    DashboardService,
    AWSRealtimeGateway,
    GeospatialService
  ],
  exports: [SentinelService, DashboardService, GeospatialService],
})
export class SentinelModule {} 