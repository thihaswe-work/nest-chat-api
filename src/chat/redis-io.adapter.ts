import { INestApplicationContext, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';

/**
 * Socket.IO adapter backed by Redis pub/sub.
 *
 * Why this exists (the "scaling" part of the project):
 *
 *   Client A connects to Server 1, Client B connects to Server 2.
 *   Both join room "room:42". Socket.IO alone only knows about the clients
 *   connected to its own process, so Server 1 cannot emit to Client B.
 *
 *   With the Redis adapter, each server subscribes to a Redis channel. When
 *   Server 1 emits to "room:42", the packet goes to Redis and every server
 *   (including Server 1) forwards it to its local members. The app instances
 *   stay stateless and can be scaled horizontally behind a load balancer.
 *
 * The adapter needs two Redis connections:
 *   - pubClient: publishes outgoing packets.
 *   - subClient: subscribes to incoming packets. A connection in subscriber
 *     mode cannot run normal commands, hence the duplicate().
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly adapterLogger = new Logger(RedisIoAdapter.name);
  private adapterConstructor?: ReturnType<typeof createAdapter>;

  constructor(
    app: INestApplicationContext,
    private readonly config: ConfigService,
  ) {
    super(app);
  }

  /**
   * Connect to Redis and build the adapter factory.
   *
   * If Redis is unavailable we log a warning and leave adapterConstructor
   * undefined. createIOServer() then keeps Socket.IO's default in-memory
   * adapter, so a single instance still works for local development.
   */
  async connectToRedis(): Promise<void> {
    const url =
      this.config.get<string>('REDIS_URL') || 'redis://localhost:6379';

    try {
      const pubClient = new Redis(url, {
        // Do not connect on construction; we connect explicitly below so we can
        // catch and handle connection errors in one place.
        lazyConnect: true,
        maxRetriesPerRequest: 1,
      });
      const subClient = pubClient.duplicate();

      await pubClient.connect();
      await subClient.connect();

      // `key` namespaces this app's Redis channels. Change it if several
      // applications share one Redis database.
      this.adapterConstructor = createAdapter(pubClient, subClient, {
        key: 'chatapp-socket',
      });
      this.adapterLogger.log('Socket.IO connected to Redis adapter.');
    } catch {
      this.adapterLogger.warn(
        'Redis is not running. Socket.IO falling back to in-memory adapter.',
      );
    }
  }

  /**
   * Called by Nest when it creates the Socket.IO server. We let the base class
   * build the server, then attach the Redis adapter if the connection succeeded.
   */
  override createIOServer(port: number, options?: any): any {
    const server = super.createIOServer(port, options);
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }
}
