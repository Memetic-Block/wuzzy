import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { buildIndexesConfig, requestBodyLimit } from './indexes/index.config';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });

  // Commissioning posts one URL per page, so the body the API must accept is
  // a function of how many URLs one request may carry. Deriving it from that
  // same number keeps the limit from failing as a 413 that says nothing about
  // URLs. It is not a limit on how large an index may become.
  app.useBodyParser('json', { limit: requestBodyLimit(buildIndexesConfig().requestUrlLimit) });
  app.useBodyParser('urlencoded', { extended: true });

  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`backend listening on :${port}`);
}

void bootstrap();
