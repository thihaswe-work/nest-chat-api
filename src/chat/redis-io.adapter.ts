import { INestApplicationContext, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';

export class RedisIoAdapter extends IoAdapter {
  private readonly adapterLogger = new Logger(RedisIoAdapter.name);
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

    try {
      const pubClient = new Redis(url, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
      });
      const subClient = pubClient.duplicate();

      await pubClient.connect();
      await subClient.connect();

      this.adapterConstructor = createAdapter(pubClient, subClient, {
        key: 'chatapp-socket',
      });
      this.adapterLogger.log('Socket.IO connected to Redis adapter.');
    } catch (err) {
      this.adapterLogger.warn(
        'Redis is not running. Socket.IO falling back to in-memory adapter.',
      );
    }
  }

  override createIOServer(port: number, options?: any): any {
    const server = super.createIOServer(port, options);
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }
}
