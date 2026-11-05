import { Injectable } from '@nestjs/common';

/**
 * Root service.
 *
 * Services hold business logic and are marked @Injectable() so Nest can create
 * and inject them. This one is intentionally tiny: it just proves the HTTP stack
 * is alive.
 */
@Injectable()
export class AppService {
  getHello(): string {
    return 'Hello World!';
  }
}
