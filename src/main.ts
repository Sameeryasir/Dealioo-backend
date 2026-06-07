import { ClassSerializerInterceptor, ValidationPipe } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';
import { getCorsOrigins } from './utils/frontend-base-url';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  const jsonBodyLimit = process.env.BODY_JSON_LIMIT ?? '10mb';
  app.useBodyParser('json', {
    limit: jsonBodyLimit,
    verify: (req, _res, buf: Buffer) => {
      (req as import('express').Request & { rawBody?: Buffer }).rawBody = buf;
    },
  });
  app.useBodyParser('urlencoded', { limit: jsonBodyLimit, extended: true });
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads/' });
  app.enableCors({
    origin: getCorsOrigins(),
    credentials: true,
  });
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.listen(process.env.PORT ?? 4001);
}
bootstrap();
