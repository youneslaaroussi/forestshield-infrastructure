# 🔗 Redis Integration Guide for ForestShield WebSocket

This guide explains how to integrate Redis with your existing `AWSRealtimeGateway` to enable multi-instance scaling with App Runner.

## 🎯 Goal

Transform your in-memory WebSocket state management to Redis-backed distributed state, allowing multiple App Runner instances to share connection state.

## 📦 Required Dependencies

Add these to your `package.json`:

```bash
pnpm add redis @socket.io/redis-adapter
pnpm add -D @types/redis
```

## 🔧 Configuration Changes

### 1. Environment Variables (Already configured in CloudFormation)

```bash
REDIS_HOST=your-redis-cluster.cache.amazonaws.com
REDIS_PORT=6379
```

### 2. Redis Client Setup

Create `src/redis/redis.service.ts`:

```typescript
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: RedisClientType;
  private pubClient: RedisClientType;
  private subClient: RedisClientType;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    const redisHost = this.configService.get('REDIS_HOST');
    const redisPort = this.configService.get('REDIS_PORT', 6379);

    if (!redisHost) {
      this.logger.warn('Redis not configured, using in-memory state');
      return;
    }

    // Main Redis client
    this.client = createClient({
      socket: {
        host: redisHost,
        port: redisPort,
      },
    });

    // Pub/Sub clients for Socket.IO adapter
    this.pubClient = this.client.duplicate();
    this.subClient = this.client.duplicate();

    await Promise.all([
      this.client.connect(),
      this.pubClient.connect(),
      this.subClient.connect(),
    ]);

    this.logger.log(`Connected to Redis at ${redisHost}:${redisPort}`);
  }

  async onModuleDestroy() {
    await Promise.all([
      this.client?.disconnect(),
      this.pubClient?.disconnect(),
      this.subClient?.disconnect(),
    ]);
  }

  getClient(): RedisClientType {
    return this.client;
  }

  getPubSubClients(): { pubClient: RedisClientType; subClient: RedisClientType } {
    return { pubClient: this.pubClient, subClient: this.subClient };
  }
}
```

### 3. Update WebSocket Gateway

Modify `src/sentinel/aws-realtime.gateway.ts`:

```typescript
import { createAdapter } from '@socket.io/redis-adapter';
import { RedisService } from '../redis/redis.service';

@Injectable()
@WebSocketGateway({
  cors: { origin: '*', credentials: true },
  namespace: '/aws-realtime',
})
export class AWSRealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect, AfterGatewayInit {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(AWSRealtimeGateway.name);
  
  // Remove in-memory Maps - Redis will handle state
  // private clients = new Map<string, ClientSubscription>();
  // private streamingIntervals = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly awsMonitoringService: AWSMonitoringService,
    private readonly awsActivityService: AWSActivityService,
    private readonly awsSecurityService: AWSSecurityService,
    private readonly redisService: RedisService, // Add Redis service
  ) {}

  // Set up Redis adapter after gateway initialization
  afterGatewayInit(server: Server) {
    const { pubClient, subClient } = this.redisService.getPubSubClients();
    
    if (pubClient && subClient) {
      server.adapter(createAdapter(pubClient, subClient));
      this.logger.log('Redis adapter configured for Socket.IO');
    } else {
      this.logger.warn('Redis not available, using in-memory adapter');
    }
  }

  // Connection handling (simplified - Socket.IO + Redis handles state)
  handleConnection(client: Socket): void {
    this.logger.log(`🔗 Client connected: ${client.id}`);
    
    // Store minimal client info in Redis
    this.storeClientInfo(client.id, {
      socketId: client.id,
      subscriptions: [],
      lastActivity: new Date(),
    });

    client.emit('connection-established', {
      clientId: client.id,
      timestamp: new Date().toISOString(),
      availableStreams: [
        'aws-metrics', 'aws-logs', 'aws-activity', 
        'aws-costs', 'aws-health', 'aws-security'
      ]
    });
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`❌ Client disconnected: ${client.id}`);
    this.removeClientInfo(client.id);
  }

  // Redis helper methods
  private async storeClientInfo(clientId: string, info: any): Promise<void> {
    const redisClient = this.redisService.getClient();
    if (redisClient) {
      await redisClient.setEx(`client:${clientId}`, 3600, JSON.stringify(info));
    }
  }

  private async getClientInfo(clientId: string): Promise<any> {
    const redisClient = this.redisService.getClient();
    if (redisClient) {
      const data = await redisClient.get(`client:${clientId}`);
      return data ? JSON.parse(data) : null;
    }
    return null;
  }

  private async removeClientInfo(clientId: string): Promise<void> {
    const redisClient = this.redisService.getClient();
    if (redisClient) {
      await redisClient.del(`client:${clientId}`);
    }
  }

  // Subscription methods remain mostly the same
  // Socket.IO + Redis handles room management automatically
  @SubscribeMessage('subscribe-aws-metrics')
  async handleMetricsSubscription(@ConnectedSocket() client: Socket, @MessageBody() data: { interval?: number }): Promise<void> {
    const interval = data.interval || 30000;
    
    // Join Socket.IO room (Redis-backed)
    client.join('aws-metrics');
    
    // Update client subscription in Redis
    const clientInfo = await this.getClientInfo(client.id) || { subscriptions: [] };
    clientInfo.subscriptions.push('aws-metrics');
    await this.storeClientInfo(client.id, clientInfo);

    // Start streaming (only one instance needs to do this)
    this.startMetricsStream(interval);

    client.emit('subscription-confirmed', {
      stream: 'aws-metrics',
      interval,
      timestamp: new Date().toISOString()
    });
  }

  // Optimized streaming - use Redis to coordinate between instances
  private async startMetricsStream(interval: number): Promise<void> {
    const redisClient = this.redisService.getClient();
    const streamKey = 'metrics-stream-active';
    
    // Check if another instance is already streaming
    const isActive = await redisClient?.get(streamKey);
    if (isActive) return;

    // Claim the streaming responsibility
    await redisClient?.setEx(streamKey, interval / 1000 + 10, 'true');

    const streamInterval = setInterval(async () => {
      try {
        const metrics = await this.awsMonitoringService.getAWSServiceMetrics();
        
        // Emit to all connected clients across all instances
        this.server.to('aws-metrics').emit('aws-metrics-update', {
          timestamp: new Date().toISOString(),
          data: metrics,
          type: 'metrics'
        });

        // Refresh the lock
        await redisClient?.setEx(streamKey, interval / 1000 + 10, 'true');
      } catch (error) {
        this.logger.error('Metrics streaming error:', error);
        clearInterval(streamInterval);
        await redisClient?.del(streamKey);
      }
    }, interval);
  }
}
```

### 4. Update App Module

Add the Redis service and health controller to `src/app.module.ts`:

```typescript
import { RedisService } from './redis/redis.service';
import { HealthController } from './health.controller';

@Module({
  imports: [
    // ... existing imports
  ],
  controllers: [
    // ... existing controllers
    HealthController,
  ],
  providers: [
    // ... existing providers
    RedisService,
  ],
})
export class AppModule {}
```

## 🚀 Benefits

### Before (In-Memory):
- ❌ Single instance only
- ❌ Lost connections on deployment
- ❌ No horizontal scaling

### After (Redis-Backed):
- ✅ Multiple App Runner instances
- ✅ Persistent connections across deployments
- ✅ Automatic horizontal scaling
- ✅ Shared real-time state

## 🔍 Monitoring

### Redis Health Check
```bash
curl https://api.forestshieldapp.com/health
# Shows Redis connection status
```

### Connection Stats
```bash
# Via Redis CLI
redis-cli -h your-redis-endpoint info clients
```

## 🐛 Troubleshooting

### Redis Connection Issues
1. Check VPC Connector configuration
2. Verify security group rules (port 6379)
3. Ensure Redis cluster is in same region

### WebSocket State Issues
1. Monitor Redis memory usage
2. Check Socket.IO adapter logs
3. Verify client reconnection logic

## 💰 Cost Impact

**Additional Monthly Costs:**
- ElastiCache t3.micro (primary): ~$12
- ElastiCache t3.micro (replica): ~$12
- VPC Connector: ~$15
- **Total: ~$39/month** for HA Redis setup

## 🔄 Migration Strategy

1. **Phase 1:** Deploy CloudFormation (creates Redis cluster)
2. **Phase 2:** Update code with Redis integration
3. **Phase 3:** Deploy API container
4. **Phase 4:** Enable App Runner scaling (min 1, max 10)

Your existing WebSocket functionality will work immediately with minimal code changes! 