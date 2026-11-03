import { INestApplicationContext, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';

export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
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
      // Create clients with lazyConnect so they don't auto-connect right away
      const pubClient = new Redis(url, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
      });
      const subClient = pubClient.duplicate();

      // Explicitly connect both clients safely
      await pubClient.connect();
      await subClient.connect();

      this.adapterConstructor = createAdapter(pubClient, subClient, {
        key: 'chatapp-socket',
      });
      this.logger.log('Socket.IO connected to Redis adapter.');
    } catch (err) {
      this.logger.warn(
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
