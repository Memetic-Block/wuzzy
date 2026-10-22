import type { NestExpressApplication } from '@nestjs/platform-express';
import { buildIndexesConfig, requestBodyLimit } from './indexes/index.config';

/**
 * Request bodies are accepted uncompressed only. With `inflate` off, a body
 * sent with any Content-Encoding is refused with 415 before anything decodes it.
 */
export function useBodyParsers(app: NestExpressApplication): void {
  // Commissioning posts one URL per page, so the body the API must accept is
  // a function of how many URLs one request may carry. Deriving it from that
  // same number keeps the limit from failing as a 413 that says nothing about
  // URLs. It is not a limit on how large an index may become.
  app.useBodyParser('json', {
    limit: requestBodyLimit(buildIndexesConfig().requestUrlLimit),
    inflate: false,
  });
  app.useBodyParser('urlencoded', { extended: true, inflate: false });
}
