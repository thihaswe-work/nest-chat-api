import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/decorators/public.decorator.js';
import { AppService } from './app.service.js';

/**
 * HTTP layer for the root route.
 *
 * Controllers only translate HTTP requests into service calls. Keeping business
 * logic out of controllers makes it reusable and easy to unit test.
 *
 * GET /  ->  "Hello World!"  (a public smoke/health check)
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
}
