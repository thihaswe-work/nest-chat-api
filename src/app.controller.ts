import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/decorators/public.decorator.js';
import { AppService } from './app.service.js';
import { getInstanceInfo } from './common/instance-info.js';
import type { InstanceInfo } from './common/instance-info.js';

/**
 * HTTP layer for the root routes.
 *
 * Controllers only translate HTTP requests into service calls. Keeping business
 * logic out of controllers makes it reusable and easy to unit test.
 *
 *   GET /          -> "Hello World!" (public smoke/health check)
 *   GET /instance  -> which replica answered (public helper for load balancers)
 */
@Controller()
export class AppController {
  // Nest injects AppService here because AppModule lists it as a provider.
  constructor(private readonly appService: AppService) {}

  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  /**
   * Identify the process behind the load balancer.
   *
   * Call this through HAProxy several times with no cookie and you should see
   * different ids (round robin). Repeat with the `SERVERID` cookie and every
   * response should come from the same replica (sticky sessions).
   *
   * It is intentionally public: it exposes no user data, and it must be
   * reachable while debugging a broken auth setup.
   */
  @Public()
  @Get('instance')
  getInstance(): InstanceInfo {
    return getInstanceInfo();
  }
}
