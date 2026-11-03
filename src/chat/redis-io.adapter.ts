import { INestApplicationContext, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';

export class RedisIoAdapter extends IoAdapter {
  private readonly redisLogger = new Logger(RedisIoAdapter.name);
  private adapterConstructor?: ReturnType<typeof createAdapter>;
  constructor(
    app: INestApplicationContext,
    private readonly config: ConfigService,
  ) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    const url =
      this.config.get<string>('REDIS_URL') || 'redis://localhost:6379';
    const pubClient = new Redis(url, { maxRetriesPerRequest: 1 });
    const subClient = pubClient.duplicate();
    await Promise.all([pubClient.connect(), subClient.connect()]);
    this.adapterConstructor = createAdapter(pubClient, subClient);
    this.redisLogger.log(
      'Successfully connected to Redis and created adapter.',
    );
  }

  createIOServer(port: number, options?: any): any {
    const server = super.createIOServer(port, options);
    if (!this.adapterConstructor) {
      throw new Error(
        'Redis adapter is not initialized. Call connectToRedis() first.',
      );
    }
    server.adapter(this.adapterConstructor);
    return server;
  }
}
