import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from './redis/redis.service';

@Controller('health')
export class HealthController {
    constructor(
        private readonly configService: ConfigService,
        private readonly redisService: RedisService,
    ) { }

    @Get()
    async getHealth() {
        const redisHealth = await this.redisService.healthCheck();
        const overallStatus = redisHealth.connected ? 'ok' : 'degraded';

        const status = {
            status: overallStatus,
            timestamp: new Date().toISOString(),
            environment: this.configService.get('NODE_ENV', 'development'),
            version: process.env.npm_package_version || '1.0.0',
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            redis: {
                host: this.configService.get('REDIS_HOST'),
                port: this.configService.get('REDIS_PORT'),
                connected: redisHealth.connected,
                latency: redisHealth.latency,
                memory: redisHealth.memory,
                clients: redisHealth.clients,
                error: redisHealth.error,
            },
            aws: {
                region: this.configService.get('AWS_REGION'),
                buckets: {
                    processed: this.configService.get('PROCESSED_DATA_BUCKET'),
                    models: this.configService.get('MODELS_BUCKET'),
                    temp: this.configService.get('TEMP_BUCKET'),
                },
            },
        };

        return status;
    }

    @Get('live')
    getLiveness() {
        return {
            status: 'alive',
            timestamp: new Date().toISOString(),
        };
    }

    @Get('ready')
    async getReadiness() {
        const redisHealth = await this.redisService.healthCheck();
        const redisStatus = redisHealth.connected ? 'ok' : 'fail';
        const overallStatus = redisHealth.connected ? 'ready' : 'not_ready';

        return {
            status: overallStatus,
            timestamp: new Date().toISOString(),
            checks: {
                aws: 'ok',
                redis: redisStatus,
                redis_latency: redisHealth.latency ? `${redisHealth.latency}ms` : 'n/a',
            },
            errors: redisHealth.error ? [redisHealth.error] : [],
        };
    }
} 