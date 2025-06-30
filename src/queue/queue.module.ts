import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QueueService } from './queue.service';
import { AnalysisProcessor } from './analysis.processor';
import { SentinelModule } from '../sentinel/sentinel.module';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const redisHost = configService.get('REDIS_HOST');
        const redisPort = configService.get('REDIS_PORT', 6379);
        
        if (!redisHost) {
          // Fallback to memory queue if Redis is not available
          return {
            redis: {
              host: 'localhost',
              port: 6379,
            },
            defaultJobOptions: {
              removeOnComplete: 10,
              removeOnFail: 5,
            },
          };
        }

        return {
          redis: {
            host: redisHost,
            port: redisPort,
          },
          defaultJobOptions: {
            removeOnComplete: 10,
            removeOnFail: 5,
          },
        };
      },
      inject: [ConfigService],
    }),
    BullModule.registerQueue({
      name: 'region-analysis',
    }),
    // We use forwardRef to avoid circular dependency with SentinelModule
    forwardRef(() => SentinelModule),
  ],
  providers: [QueueService, AnalysisProcessor],
  exports: [QueueService],
})
export class QueueModule {} 