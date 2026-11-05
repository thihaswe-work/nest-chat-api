import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';
import { RedisIoAdapter } from './chat/redis-io.adapter.js';

/**
 * Application entry point.
 *
 * Boot order matters here:
 *   1. NestFactory.create(AppModule) builds the dependency-injection container.
 *      AppModule opens the PostgreSQL and MongoDB connections in the background.
 *   2. We swap Socket.IO's default in-memory adapter for the Redis adapter, so
 *      several copies of this server can share WebSocket rooms and messages.
 *   3. app.listen() starts the HTTP server (and the WebSocket server attached to it).
 *
 * Note: because package.json sets "type": "module", relative imports must end in
 * ".js" even though the source files are ".ts". TypeScript maps them at build time.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // ConfigService reads values from the .env file (see AppModule) or the process env.
  const configService = app.get(ConfigService);

  // --- WebSocket scaling setup -------------------------------------------------
  // Without this adapter, each server instance keeps its own Socket.IO clients in
  // memory. With it, messages published by one instance are forwarded over Redis
  // to every other instance, so a client can talk to any server behind a load
  // balancer and still receive the message.
  const redisIoAdapter = new RedisIoAdapter(app, configService);
  await redisIoAdapter.connectToRedis();
  app.useWebSocketAdapter(redisIoAdapter);

  // PORT comes from .env as a string; Number() converts it. Default to 3000
  // for a zero-config local start.
  const port = Number(configService.get<string>('PORT')) || 3000;
  await app.listen(port);

  console.log(`Server running on http://localhost:${port}`);
}

// Top-level await is allowed because this project is an ES module ("type": "module").
await bootstrap();
