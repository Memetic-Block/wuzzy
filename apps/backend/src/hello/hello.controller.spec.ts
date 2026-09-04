import { describe, expect, it } from 'bun:test';
import { HelloController } from './hello.controller';

describe('HelloController', () => {
  it('returns an html fragment', () => {
    const html = new HelloController().hello();
    expect(html).toStartWith('<p>');
    expect(html).toContain('Hello from NestJS');
  });
});
