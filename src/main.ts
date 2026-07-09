import { ClassSerializerInterceptor, ValidationPipe } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';
import session from 'express-session';
import { AppModule } from './app.module';
import { isAllowedCorsOrigin } from './utils/frontend-base-url';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  app.use(compression());

  app.use((req, res, next) => {
    const path = req.path;
    if (path === '/auth/google' || path === '/auth/google/callback') {
      const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
      res.redirect(307, `/api${path}${query}`);
      return;
    }
    next();
  });

  // --- Google OAuth CSRF state (passport-google-oauth20 state: true) ---
  // Session is only used for OAuth state cookies, not for app login (JWT stays primary).
  const sessionSecret =
    process.env.JWT_SECRET?.trim() ||
    process.env.SESSION_SECRET?.trim() ||
    'dealioo-oauth-session';
  app.use(
    session({
      name: 'dealioo.sid',
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 10 * 60 * 1000,
      },
    }),
  );

  const jsonBodyLimit = process.env.BODY_JSON_LIMIT ?? '10mb';
  app.useBodyParser('json', {
    limit: jsonBodyLimit,
    verify: (req, _res, buf: Buffer) => {
      (req as import('express').Request & { rawBody?: Buffer }).rawBody = buf;
    },
  });
  app.useBodyParser('urlencoded', { limit: jsonBodyLimit, extended: true });
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: (origin, callback) => {
      if (isAllowedCorsOrigin(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`Blocked by CORS: ${origin ?? 'unknown'}`));
    },
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
