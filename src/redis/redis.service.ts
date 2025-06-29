import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';

export interface RedisHealthStatus {
  connected: boolean;
  latency?: number;
  memory?: any;
  clients?: number;
  error?: string;
}

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: RedisClientType;
  private pubClient: RedisClientType;
  private subClient: RedisClientType;
  private isConnected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 5000; // 5 seconds
  private connectionTimeout: NodeJS.Timeout;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    const redisHost = this.configService.get('REDIS_HOST');
    const redisPort = this.configService.get('REDIS_PORT', 6379);

    if (!redisHost) {
      this.logger.warn('❌ Redis not configured (REDIS_HOST missing), using in-memory state only');
      this.logger.warn('💡 To enable Redis: Set REDIS_HOST environment variable');
      return;
    }

    this.logger.log(`🚀 Redis service initializing...`);
    this.logger.log(`📍 Target: ${redisHost}:${redisPort}`);

    const redisConfig = {
      socket: {
        host: redisHost,
        port: redisPort,
        connectTimeout: 10000,
        commandTimeout: 5000,
        lazyConnect: true,
        tls: true,
        rejectUnauthorized: false,
        reconnectStrategy: (retries: number) => {
          this.logger.warn(`🔄 Redis reconnection attempt ${retries + 1}/${this.maxReconnectAttempts}`);
          if (retries >= this.maxReconnectAttempts) {
            this.logger.error(`❌ Redis max reconnection attempts (${this.maxReconnectAttempts}) exceeded`);
            return false; // Stop reconnecting
          }
          return Math.min(retries * 1000, 30000); // Progressive backoff, max 30s
        },
      },
      retryDelayOnFailover: 100,
      enableOfflineQueue: false,
    };

    try {
      // Create Redis clients
      this.logger.log('🔧 Creating Redis clients...');
      this.client = createClient(redisConfig);
      this.pubClient = this.client.duplicate();
      this.subClient = this.client.duplicate();

      // Set up event handlers for all clients
      this.setupClientEventHandlers();

      // Start async connection process (non-blocking)
      this.connectAsync();

    } catch (error) {
      this.logger.error('❌ Failed to initialize Redis clients:', error.message);
    }
  }

  private setupClientEventHandlers() {
    // Main client events
    this.client.on('connect', () => {
      this.logger.log('🔗 Main Redis client connecting...');
    });

    this.client.on('ready', () => {
      this.logger.log('✅ Main Redis client ready');
      this.checkAllClientsReady();
    });

    this.client.on('error', (error) => {
      this.logger.error('❌ Main Redis client error:', error.message);
      this.isConnected = false;
    });

    this.client.on('end', () => {
      this.logger.warn('🔌 Main Redis client connection ended');
      this.isConnected = false;
    });

    this.client.on('reconnecting', () => {
      this.logger.log('🔄 Main Redis client reconnecting...');
    });

    // Pub client events
    this.pubClient.on('connect', () => {
      this.logger.log('🔗 Redis pub client connecting...');
    });

    this.pubClient.on('ready', () => {
      this.logger.log('✅ Redis pub client ready');
      this.checkAllClientsReady();
    });

    this.pubClient.on('error', (error) => {
      this.logger.error('❌ Redis pub client error:', error.message);
      this.isConnected = false;
    });

    this.pubClient.on('end', () => {
      this.logger.warn('🔌 Redis pub client connection ended');
      this.isConnected = false;
    });

    // Sub client events
    this.subClient.on('connect', () => {
      this.logger.log('🔗 Redis sub client connecting...');
    });

    this.subClient.on('ready', () => {
      this.logger.log('✅ Redis sub client ready');
      this.checkAllClientsReady();
    });

    this.subClient.on('error', (error) => {
      this.logger.error('❌ Redis sub client error:', error.message);
      this.isConnected = false;
    });

    this.subClient.on('end', () => {
      this.logger.warn('🔌 Redis sub client connection ended');
      this.isConnected = false;
    });
  }

  private async connectAsync() {
    this.logger.log('🚀 Starting asynchronous Redis connection...');
    
    // Use setTimeout to make this completely non-blocking
    setTimeout(async () => {
      try {
        this.logger.log('⏱️  Connecting to Redis (this won\'t block server startup)...');
        
        // Connect all clients in parallel
        const connectionPromises = [
          this.connectClientWithRetry(this.client, 'main'),
          this.connectClientWithRetry(this.pubClient, 'pub'),
          this.connectClientWithRetry(this.subClient, 'sub'),
        ];

        await Promise.all(connectionPromises);
        
        if (this.client.isReady && this.pubClient.isReady && this.subClient.isReady) {
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.logger.log('🎉 All Redis clients connected successfully!');
          
          // Log Redis server info
          await this.logRedisInfo();
        }
        
      } catch (error) {
        this.logger.error('❌ Redis connection failed:', error.message);
        this.scheduleReconnect();
      }
    }, 100); // Small delay to ensure server starts first
  }

  private async connectClientWithRetry(client: RedisClientType, clientName: string): Promise<void> {
    const maxAttempts = 3;
    let attempt = 1;

    while (attempt <= maxAttempts) {
      try {
        this.logger.log(`🔄 Connecting ${clientName} client (attempt ${attempt}/${maxAttempts})...`);
        await client.connect();
        this.logger.log(`✅ ${clientName} client connected successfully`);
        return;
      } catch (error) {
        this.logger.error(`❌ ${clientName} client connection attempt ${attempt} failed:`, error.message);
        
        if (attempt === maxAttempts) {
          throw new Error(`Failed to connect ${clientName} client after ${maxAttempts} attempts`);
        }
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        attempt++;
      }
    }
  }

  private checkAllClientsReady() {
    if (this.client?.isReady && this.pubClient?.isReady && this.subClient?.isReady) {
      if (!this.isConnected) {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.logger.log('🎉 All Redis clients are ready and connected!');
      }
    }
  }

  private async logRedisInfo() {
    try {
      const info = await this.client.info('server');
      const lines = info.split('\r\n');
      const versionLine = lines.find(line => line.startsWith('redis_version:'));
      const modeLine = lines.find(line => line.startsWith('redis_mode:'));
      
      if (versionLine) {
        this.logger.log(`📊 Redis version: ${versionLine.split(':')[1]}`);
      }
      if (modeLine) {
        this.logger.log(`🔧 Redis mode: ${modeLine.split(':')[1]}`);
      }
      
      // Log memory usage
      const memInfo = await this.client.info('memory');
      const memLines = memInfo.split('\r\n');
      const usedMemoryLine = memLines.find(line => line.startsWith('used_memory_human:'));
      if (usedMemoryLine) {
        this.logger.log(`💾 Redis memory usage: ${usedMemoryLine.split(':')[1]}`);
      }
      
    } catch (error) {
      this.logger.warn('⚠️  Could not fetch Redis server info:', error.message);
    }
  }

  private scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error(`❌ Max reconnection attempts (${this.maxReconnectAttempts}) reached. Giving up.`);
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * this.reconnectAttempts;
    
    this.logger.warn(`⏰ Scheduling Redis reconnection attempt ${this.reconnectAttempts} in ${delay / 1000}s...`);
    
    this.connectionTimeout = setTimeout(() => {
      this.logger.log(`🔄 Attempting Redis reconnection (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
      this.connectAsync();
    }, delay);
  }

  async onModuleDestroy() {
    this.logger.log('🛑 Redis service shutting down...');
    
    // Clear any pending reconnection attempts
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.logger.log('⏰ Cancelled pending reconnection attempts');
    }
    
    try {
      const disconnectPromises: Promise<void>[] = [];
      
      if (this.client?.isReady) {
        this.logger.log('🔌 Disconnecting main Redis client...');
        disconnectPromises.push(this.client.disconnect());
      }
      
      if (this.pubClient?.isReady) {
        this.logger.log('🔌 Disconnecting pub Redis client...');
        disconnectPromises.push(this.pubClient.disconnect());
      }
      
      if (this.subClient?.isReady) {
        this.logger.log('🔌 Disconnecting sub Redis client...');
        disconnectPromises.push(this.subClient.disconnect());
      }

      if (disconnectPromises.length > 0) {
        await Promise.all(disconnectPromises);
        this.logger.log('✅ All Redis clients disconnected cleanly');
      } else {
        this.logger.log('ℹ️  No active Redis connections to disconnect');
      }
      
      this.isConnected = false;
      
    } catch (error) {
      this.logger.error('❌ Error during Redis shutdown:', error.message);
    }
  }

  // Main client getter for application use
  getClient(): RedisClientType | null {
    if (!this.isConnected || !this.client?.isReady) {
      this.logger.debug('⚠️  Redis client requested but not available');
      return null;
    }
    return this.client;
  }

  // Pub/Sub clients for Socket.IO adapter
  getPubSubClients(): { pubClient: RedisClientType; subClient: RedisClientType } | null {
    if (!this.isConnected || !this.pubClient?.isReady || !this.subClient?.isReady) {
      this.logger.debug('⚠️  Redis pub/sub clients requested but not available');
      return null;
    }
    return { pubClient: this.pubClient, subClient: this.subClient };
  }

  // Connection status
  isRedisConnected(): boolean {
    const connected = this.isConnected && this.client?.isReady && this.pubClient?.isReady && this.subClient?.isReady;
    this.logger.debug(`🔍 Redis connection status check: ${connected ? 'connected' : 'disconnected'}`);
    return connected;
  }

  // Health check method for monitoring
  async healthCheck(): Promise<RedisHealthStatus> {
    this.logger.debug('🏥 Performing Redis health check...');
    
    if (!this.isConnected || !this.client?.isReady) {
      this.logger.debug('❌ Health check failed: Redis not connected');
      return {
        connected: false,
        error: 'Redis client not initialized or connected'
      };
    }

    try {
      const startTime = Date.now();
      
      // Ping test
      this.logger.debug('📡 Sending Redis ping...');
      const pong = await this.client.ping();
      const latency = Date.now() - startTime;
      
      if (pong !== 'PONG') {
        this.logger.error(`❌ Redis ping returned unexpected response: ${pong}`);
        return {
          connected: false,
          error: 'Redis ping returned unexpected response'
        };
      }

      this.logger.debug(`✅ Redis ping successful (${latency}ms)`);

      // Get server info
      this.logger.debug('📊 Fetching Redis server info...');
      const info = await this.client.info();
      const lines = info.split('\r\n');
      
      // Parse memory info
      const memoryLine = lines.find(line => line.startsWith('used_memory_human:'));
      const clientsLine = lines.find(line => line.startsWith('connected_clients:'));
      
      const healthStatus = {
        connected: true,
        latency,
        memory: memoryLine ? memoryLine.split(':')[1] : 'unknown',
        clients: clientsLine ? parseInt(clientsLine.split(':')[1]) : 0,
      };
      
      this.logger.debug('✅ Redis health check completed successfully');
      return healthStatus;
      
    } catch (error) {
      this.logger.error('❌ Redis health check failed:', error.message);
      return {
        connected: false,
        error: error.message
      };
    }
  }

  // Utility methods for application use
  async set(key: string, value: string, expireInSeconds?: number): Promise<boolean> {
    this.logger.debug(`📝 Redis SET: ${key} ${expireInSeconds ? `(expires in ${expireInSeconds}s)` : ''}`);
    
    const client = this.getClient();
    if (!client) {
      this.logger.warn(`⚠️  Redis SET failed: client not available for key ${key}`);
      return false;
    }

    try {
      if (expireInSeconds) {
        await client.setEx(key, expireInSeconds, value);
      } else {
        await client.set(key, value);
      }
      this.logger.debug(`✅ Redis SET successful: ${key}`);
      return true;
    } catch (error) {
      this.logger.error(`❌ Redis SET error for key ${key}:`, error.message);
      return false;
    }
  }

  async get(key: string): Promise<string | null> {
    this.logger.debug(`📖 Redis GET: ${key}`);
    
    const client = this.getClient();
    if (!client) {
      this.logger.warn(`⚠️  Redis GET failed: client not available for key ${key}`);
      return null;
    }

    try {
      const value = await client.get(key);
      this.logger.debug(`✅ Redis GET ${value ? 'successful' : 'returned null'}: ${key}`);
      return value;
    } catch (error) {
      this.logger.error(`❌ Redis GET error for key ${key}:`, error.message);
      return null;
    }
  }

  async del(key: string): Promise<boolean> {
    this.logger.debug(`🗑️  Redis DEL: ${key}`);
    
    const client = this.getClient();
    if (!client) {
      this.logger.warn(`⚠️  Redis DEL failed: client not available for key ${key}`);
      return false;
    }

    try {
      const result = await client.del(key);
      this.logger.debug(`✅ Redis DEL successful: ${key} (${result} keys removed)`);
      return true;
    } catch (error) {
      this.logger.error(`❌ Redis DEL error for key ${key}:`, error.message);
      return false;
    }
  }

  async exists(key: string): Promise<boolean> {
    this.logger.debug(`🔍 Redis EXISTS: ${key}`);
    
    const client = this.getClient();
    if (!client) {
      this.logger.warn(`⚠️  Redis EXISTS failed: client not available for key ${key}`);
      return false;
    }

    try {
      const result = await client.exists(key);
      const exists = result > 0;
      this.logger.debug(`✅ Redis EXISTS result: ${key} = ${exists}`);
      return exists;
    } catch (error) {
      this.logger.error(`❌ Redis EXISTS error for key ${key}:`, error.message);
      return false;
    }
  }

  // Client connection management
  async storeClientInfo(clientId: string, info: any): Promise<boolean> {
    this.logger.debug(`👤 Storing client info: ${clientId}`);
    return await this.set(`client:${clientId}`, JSON.stringify(info), 3600); // 1 hour TTL
  }

  async getClientInfo(clientId: string): Promise<any> {
    this.logger.debug(`👤 Getting client info: ${clientId}`);
    const data = await this.get(`client:${clientId}`);
    return data ? JSON.parse(data) : null;
  }

  async removeClientInfo(clientId: string): Promise<boolean> {
    this.logger.debug(`👤 Removing client info: ${clientId}`);
    return await this.del(`client:${clientId}`);
  }

  // Stream coordination for WebSocket services
  async claimStream(streamKey: string, ttlSeconds: number = 60): Promise<boolean> {
    this.logger.debug(`🔒 Claiming stream: ${streamKey} (TTL: ${ttlSeconds}s)`);
    
    const client = this.getClient();
    if (!client) {
      this.logger.warn(`⚠️  Stream claim failed: client not available for ${streamKey}`);
      return false;
    }

    try {
      // Use SET with NX (not exists) and EX (expire) for atomic claim
      const result = await client.set(streamKey, 'active', {
        NX: true, // Only set if key doesn't exist
        EX: ttlSeconds, // Expire after ttlSeconds
      });
      const claimed = result === 'OK';
      this.logger.debug(`${claimed ? '✅' : '❌'} Stream claim ${claimed ? 'successful' : 'failed'}: ${streamKey}`);
      return claimed;
    } catch (error) {
      this.logger.error(`❌ Redis stream claim error for ${streamKey}:`, error.message);
      return false;
    }
  }

  async refreshStreamClaim(streamKey: string, ttlSeconds: number = 60): Promise<boolean> {
    this.logger.debug(`🔄 Refreshing stream claim: ${streamKey} (TTL: ${ttlSeconds}s)`);
    
    const client = this.getClient();
    if (!client) {
      this.logger.warn(`⚠️  Stream refresh failed: client not available for ${streamKey}`);
      return false;
    }

    try {
      const result = await client.setEx(streamKey, ttlSeconds, 'active');
      const refreshed = result === 'OK';
      this.logger.debug(`${refreshed ? '✅' : '❌'} Stream refresh ${refreshed ? 'successful' : 'failed'}: ${streamKey}`);
      return refreshed;
    } catch (error) {
      this.logger.error(`❌ Redis stream refresh error for ${streamKey}:`, error.message);
      return false;
    }
  }

  async releaseStream(streamKey: string): Promise<boolean> {
    this.logger.debug(`🔓 Releasing stream: ${streamKey}`);
    return await this.del(streamKey);
  }
} 