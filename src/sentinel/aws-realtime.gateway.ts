import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, Logger } from '@nestjs/common';
import { createAdapter } from '@socket.io/redis-adapter';
import { AWSMonitoringService } from './services/aws-monitoring.service';
import { AWSActivityService } from './services/aws-activity.service';
import { AWSSecurityService } from './services/aws-security.service';
import { RedisService } from '../redis/redis.service';

interface ClientSubscription {
  socketId: string;
  subscriptions: string[];
  lastActivity: Date;
}

@Injectable()
@WebSocketGateway({
  cors: {
    origin: '*', // Configure based on your frontend domain
    credentials: true,
  },
  namespace: '/aws-realtime',
})
export class AWSRealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(AWSRealtimeGateway.name);
  private localStreamingIntervals = new Map<string, NodeJS.Timeout>();
  private redisAdapterInitialized = false;

  constructor(
    private readonly awsMonitoringService: AWSMonitoringService,
    private readonly awsActivityService: AWSActivityService,
    private readonly awsSecurityService: AWSSecurityService,
    private readonly redisService: RedisService,
  ) {}

  // Initialize Redis adapter when server is available
  private initializeRedisAdapter() {
    if (this.redisAdapterInitialized || !this.server) return;

    const redisClients = this.redisService.getPubSubClients();
    
    if (redisClients) {
      const { pubClient, subClient } = redisClients;
      this.server.adapter(createAdapter(pubClient, subClient));
      this.logger.log('🔗 Redis adapter configured for Socket.IO - multi-instance WebSocket support enabled');
    } else {
      this.logger.warn('⚠️  Redis not available, using in-memory adapter (single instance only)');
    }
    
    this.redisAdapterInitialized = true;
  }

  // Connection Management
  async handleConnection(client: Socket): Promise<void> {
    this.logger.log(`🔗 Client connected: ${client.id}`);
    
    // Initialize Redis adapter on first connection
    this.initializeRedisAdapter();
    
    // Store client info in Redis
    await this.redisService.storeClientInfo(client.id, {
      socketId: client.id,
      subscriptions: [],
      lastActivity: new Date(),
    });

    // Send initial connection confirmation
    client.emit('connection-established', {
      clientId: client.id,
      timestamp: new Date().toISOString(),
      availableStreams: [
        'aws-metrics',
        'aws-logs',
        'aws-activity',
        'aws-costs',
        'aws-health',
        'aws-security'
      ]
    });
  }

  async handleDisconnect(client: Socket): Promise<void> {
    this.logger.log(`❌ Client disconnected: ${client.id}`);
    
    // Clean up local streaming intervals
    const clientStreamKeys = Array.from(this.localStreamingIntervals.keys())
      .filter(key => key.startsWith(`${client.id}-`));
    
    clientStreamKeys.forEach(key => {
      const interval = this.localStreamingIntervals.get(key);
      if (interval) {
        clearInterval(interval);
        this.localStreamingIntervals.delete(key);
      }
    });
    
    // Remove client info from Redis
    await this.redisService.removeClientInfo(client.id);
  }

  // Redis-backed subscription management
  private async addSubscription(clientId: string, streamType: string): Promise<void> {
    const clientInfo = await this.redisService.getClientInfo(clientId);
    if (clientInfo) {
      if (!clientInfo.subscriptions.includes(streamType)) {
        clientInfo.subscriptions.push(streamType);
        clientInfo.lastActivity = new Date();
        await this.redisService.storeClientInfo(clientId, clientInfo);
      }
    }
  }

  // Streaming coordination using Redis locks
  private async claimStreamingSlot(clientId: string, streamType: string): Promise<boolean> {
    const streamKey = `streaming:${streamType}`;
    return await this.redisService.claimStream(streamKey, 60); // 60 second TTL
  }

  private async refreshStreamingSlot(clientId: string, streamType: string): Promise<boolean> {
    const streamKey = `streaming:${streamType}`;
    return await this.redisService.refreshStreamClaim(streamKey, 60);
  }

  // Real-Time AWS Metrics Streaming
  @SubscribeMessage('subscribe-aws-metrics')
  async handleMetricsSubscription(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { interval?: number }
  ): Promise<void> {
    const interval = data.interval || 30000; // Default 30 seconds
    
    this.logger.log(`📊 Client ${client.id} subscribed to AWS metrics (${interval}ms interval)`);
    
    // Add to Redis-backed subscriptions
    await this.addSubscription(client.id, 'aws-metrics');

    // Try to claim the streaming slot (prevent duplicate streams across instances)
    const canStream = await this.claimStreamingSlot(client.id, 'aws-metrics');
    
    if (canStream) {
      this.logger.log(`🎯 Client ${client.id} claimed metrics streaming slot`);
      
      // Start streaming metrics
      const streamKey = `${client.id}-metrics`;
      const streamInterval = setInterval(async () => {
        try {
          // Refresh the streaming claim
          const stillClaimed = await this.refreshStreamingSlot(client.id, 'aws-metrics');
          if (!stillClaimed) {
            this.logger.warn(`⚠️ Lost streaming claim for metrics, stopping stream for ${client.id}`);
            clearInterval(streamInterval);
            this.localStreamingIntervals.delete(streamKey);
            return;
          }

          const metrics = await this.awsMonitoringService.getAWSServiceMetrics();
          
          // Emit to all clients in the namespace (Redis adapter handles distribution)
          this.server.emit('aws-metrics-update', {
            timestamp: new Date().toISOString(),
            data: metrics,
            type: 'metrics'
          });
        } catch (error) {
          this.logger.error(`❌ Error streaming metrics:`, error.message);
          this.server.emit('aws-error', {
            type: 'metrics',
            error: error.message,
            timestamp: new Date().toISOString()
          });
        }
      }, interval);

      this.localStreamingIntervals.set(streamKey, streamInterval);
    } else {
      this.logger.log(`🔄 Client ${client.id} subscribed to metrics (another instance is streaming)`);
    }

    client.emit('subscription-confirmed', {
      stream: 'aws-metrics',
      interval,
      timestamp: new Date().toISOString(),
      streaming: canStream
    });
  }

  // Real-Time AWS Logs Streaming
  @SubscribeMessage('subscribe-aws-logs')
  async handleLogsSubscription(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { logGroup?: string; interval?: number }
  ): Promise<void> {
    const interval = data.interval || 10000; // Default 10 seconds for logs
    const logGroup = data.logGroup || 'all';
    
    this.logger.log(`📝 Client ${client.id} subscribed to AWS logs (${logGroup}, ${interval}ms interval)`);
    
    await this.addSubscription(client.id, 'aws-logs');

    const canStream = await this.claimStreamingSlot(client.id, 'aws-logs');
    
    if (canStream) {
      const streamKey = `${client.id}-logs`;
      const streamInterval = setInterval(async () => {
        try {
          const stillClaimed = await this.refreshStreamingSlot(client.id, 'aws-logs');
          if (!stillClaimed) {
            clearInterval(streamInterval);
            this.localStreamingIntervals.delete(streamKey);
            return;
          }

          const logs = await this.awsMonitoringService.getCloudWatchLogs(
            logGroup !== 'all' ? logGroup : undefined,
            50
          );
          
          this.server.emit('aws-logs-update', {
            timestamp: new Date().toISOString(),
            data: logs,
            logGroup,
            type: 'logs'
          });
        } catch (error) {
          this.logger.error(`❌ Error streaming logs:`, error.message);
          this.server.emit('aws-error', {
            type: 'logs',
            error: error.message,
            timestamp: new Date().toISOString()
          });
        }
      }, interval);

      this.localStreamingIntervals.set(streamKey, streamInterval);
    }

    client.emit('subscription-confirmed', {
      stream: 'aws-logs',
      logGroup,
      interval,
      timestamp: new Date().toISOString(),
      streaming: canStream
    });
  }

  // Real-Time AWS Activity Feed Streaming
  @SubscribeMessage('subscribe-aws-activity')
  async handleActivitySubscription(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { interval?: number }
  ): Promise<void> {
    const interval = data.interval || 15000; // Default 15 seconds
    
    this.logger.log(`🔄 Client ${client.id} subscribed to AWS activity feed (${interval}ms interval)`);
    
    await this.addSubscription(client.id, 'aws-activity');

    const canStream = await this.claimStreamingSlot(client.id, 'aws-activity');
    
    if (canStream) {
      const streamKey = `${client.id}-activity`;
      const streamInterval = setInterval(async () => {
        try {
          const stillClaimed = await this.refreshStreamingSlot(client.id, 'aws-activity');
          if (!stillClaimed) {
            clearInterval(streamInterval);
            this.localStreamingIntervals.delete(streamKey);
            return;
          }

          const activity = await this.awsActivityService.getActivityFeed();
          this.server.emit('aws-activity-update', {
            timestamp: new Date().toISOString(),
            data: activity,
            type: 'activity'
          });
        } catch (error) {
          this.logger.error(`❌ Error streaming activity:`, error.message);
          this.server.emit('aws-error', {
            type: 'activity',
            error: error.message,
            timestamp: new Date().toISOString()
          });
        }
      }, interval);

      this.localStreamingIntervals.set(streamKey, streamInterval);
    }

    client.emit('subscription-confirmed', {
      stream: 'aws-activity',
      interval,
      timestamp: new Date().toISOString(),
      streaming: canStream
    });
  }

  // Real-Time AWS Cost Streaming
  @SubscribeMessage('subscribe-aws-costs')
  async handleCostSubscription(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { interval?: number }
  ): Promise<void> {
    const interval = data.interval || 60000; // Default 60 seconds for costs
    
    this.logger.log(`💰 Client ${client.id} subscribed to AWS costs (${interval}ms interval)`);
    
    await this.addSubscription(client.id, 'aws-costs');

    const canStream = await this.claimStreamingSlot(client.id, 'aws-costs');
    
    if (canStream) {
      const streamKey = `${client.id}-costs`;
      const streamInterval = setInterval(async () => {
        try {
          const stillClaimed = await this.refreshStreamingSlot(client.id, 'aws-costs');
          if (!stillClaimed) {
            clearInterval(streamInterval);
            this.localStreamingIntervals.delete(streamKey);
            return;
          }

          const costs = await this.awsMonitoringService.getCostAndUsageData();
          this.server.emit('aws-costs-update', {
            timestamp: new Date().toISOString(),
            data: costs,
            type: 'costs'
          });
        } catch (error) {
          this.logger.error(`❌ Error streaming costs:`, error.message);
          this.server.emit('aws-error', {
            type: 'costs',
            error: error.message,
            timestamp: new Date().toISOString()
          });
        }
      }, interval);

      this.localStreamingIntervals.set(streamKey, streamInterval);
    }

    client.emit('subscription-confirmed', {
      stream: 'aws-costs',
      interval,
      timestamp: new Date().toISOString(),
      streaming: canStream
    });
  }

  // Real-Time AWS Health Streaming
  @SubscribeMessage('subscribe-aws-health')
  async handleHealthSubscription(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { interval?: number }
  ): Promise<void> {
    const interval = data.interval || 30000; // Default 30 seconds
    
    this.logger.log(`🏥 Client ${client.id} subscribed to AWS health (${interval}ms interval)`);
    
    await this.addSubscription(client.id, 'aws-health');

    const canStream = await this.claimStreamingSlot(client.id, 'aws-health');
    
    if (canStream) {
      const streamKey = `${client.id}-health`;
      const streamInterval = setInterval(async () => {
        try {
          const stillClaimed = await this.refreshStreamingSlot(client.id, 'aws-health');
          if (!stillClaimed) {
            clearInterval(streamInterval);
            this.localStreamingIntervals.delete(streamKey);
            return;
          }

          const health = await this.awsMonitoringService.getAWSServiceMetrics();
          this.server.emit('aws-health-update', {
            timestamp: new Date().toISOString(),
            data: health,
            type: 'health'
          });
        } catch (error) {
          this.logger.error(`❌ Error streaming health:`, error.message);
          this.server.emit('aws-error', {
            type: 'health',
            error: error.message,
            timestamp: new Date().toISOString()
          });
        }
      }, interval);

      this.localStreamingIntervals.set(streamKey, streamInterval);
    }

    client.emit('subscription-confirmed', {
      stream: 'aws-health',
      interval,
      timestamp: new Date().toISOString(),
      streaming: canStream
    });
  }

  // Real-Time AWS Security Streaming
  @SubscribeMessage('subscribe-aws-security')
  async handleSecuritySubscription(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { interval?: number }
  ): Promise<void> {
    const interval = data.interval || 30000; // Default 30 seconds
    
    this.logger.log(`🔒 Client ${client.id} subscribed to AWS security (${interval}ms interval)`);
    
    await this.addSubscription(client.id, 'aws-security');

    const canStream = await this.claimStreamingSlot(client.id, 'aws-security');
    
    if (canStream) {
      const streamKey = `${client.id}-security`;
      const streamInterval = setInterval(async () => {
        try {
          const stillClaimed = await this.refreshStreamingSlot(client.id, 'aws-security');
          if (!stillClaimed) {
            clearInterval(streamInterval);
            this.localStreamingIntervals.delete(streamKey);
            return;
          }

          const security = await this.awsSecurityService.getSecurityHealthCheck();
          this.server.emit('aws-security-update', {
            timestamp: new Date().toISOString(),
            data: security,
            type: 'security'
          });
        } catch (error) {
          this.logger.error(`❌ Error streaming security:`, error.message);
          this.server.emit('aws-error', {
            type: 'security',
            error: error.message,
            timestamp: new Date().toISOString()
          });
        }
      }, interval);

      this.localStreamingIntervals.set(streamKey, streamInterval);
    }

    client.emit('subscription-confirmed', {
      stream: 'aws-security',
      interval,
      timestamp: new Date().toISOString(),
      streaming: canStream
    });
  }

  // Unsubscribe from streams
  @SubscribeMessage('unsubscribe')
  async handleUnsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { stream: string }
  ): Promise<void> {
    this.logger.log(`🛑 Client ${client.id} unsubscribing from ${data.stream}`);
    
    const streamKey = `${client.id}-${data.stream.replace('aws-', '')}`;
    const interval = this.localStreamingIntervals.get(streamKey);
    
    if (interval) {
      clearInterval(interval);
      this.localStreamingIntervals.delete(streamKey);
    }
    
    // Release streaming claim
    await this.redisService.releaseStream(`streaming:${data.stream}`);
    
    client.emit('unsubscribed', {
      stream: data.stream,
      timestamp: new Date().toISOString()
    });
  }

  // Get connection status
  @SubscribeMessage('get-status')
  async handleGetStatus(@ConnectedSocket() client: Socket): Promise<void> {
    const clientInfo = await this.redisService.getClientInfo(client.id);
    
    client.emit('status', {
      clientId: client.id,
      subscriptions: clientInfo?.subscriptions || [],
      redisConnected: this.redisService.isRedisConnected(),
      timestamp: new Date().toISOString()
    });
  }

  // Utility method to stop streaming for a client
  private stopStreamForClient(clientId: string, stream: string): void {
    const streamKey = `${clientId}-${stream.replace('aws-', '')}`;
    const interval = this.localStreamingIntervals.get(streamKey);
    
    if (interval) {
      clearInterval(interval);
      this.localStreamingIntervals.delete(streamKey);
    }
  }

  // Broadcast system events to all connected clients
  broadcastSystemEvent(event: string, data: any): void {
    this.server.emit('system-event', {
      event,
      data,
      timestamp: new Date().toISOString()
    });
  }

  // Get connection statistics
  async getConnectionStats(): Promise<any> {
    const redisHealth = await this.redisService.healthCheck();
    
    return {
      totalConnections: this.server.engine.clientsCount,
      activeStreams: this.localStreamingIntervals.size,
      redisConnected: redisHealth.connected,
      redisLatency: redisHealth.latency,
      timestamp: new Date().toISOString()
    };
  }
}