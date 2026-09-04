import { Controller, Get, Header } from '@nestjs/common';

/**
 * HTMX endpoints return HTML fragments, not JSON. The frontend's demo button
 * swaps this response into the page.
 */
@Controller('api/hello')
export class HelloController {
  @Get()
  @Header('content-type', 'text/html; charset=utf-8')
  hello(): string {
    return `<p>Hello from NestJS at ${new Date().toISOString()}</p>`;
  }
}
