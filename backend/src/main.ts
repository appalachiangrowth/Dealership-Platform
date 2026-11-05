import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { AppModule } from './app.module.js';
import { assertJwtSecret } from './common/jwt.js';

// one failing Facebook step or e-mail must never take the whole API (and every dealer's Chrome) down
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e));

async function bootstrap() {
  assertJwtSecret();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: true });
  app.useBodyParser('json', { limit: '20mb' });
  // the visitor's real address comes from Nginx on the same server (X-Forwarded-For) — never from anyone else
  app.set('trust proxy', process.env.TRUST_PROXY || 'loopback, linklocal, uniquelocal');
  app.disable('x-powered-by');

  app.enableCors({
    // Dealer websites live on many domains, so any origin may call the API.
    // Admin calls use a Bearer token (no cookies), so this is safe.
    origin: (origin, cb) => cb(null, true),
    credentials: false,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-Id', 'X-Site-Host'],
    exposedHeaders: ['Content-Disposition', 'X-Frame-Seq'],
  });

  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));

  // Photos: /uploads/<dealership>/<year>/<month>/<file>
  const uploads = join(process.cwd(), 'uploads');
  mkdirSync(uploads, { recursive: true });
  app.useStaticAssets(uploads, {
    prefix: '/uploads/',
    maxAge: '30d',
    setHeaders: (res) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'");
    },
  });
  // Design preview images: /themes/<id>.jpg
  app.useStaticAssets(join(process.cwd(), 'public'), { maxAge: '7d' });

  // PM2 restart / server reboot: close every Facebook Chrome cleanly first (their logins stay saved)
  app.enableShutdownHooks();

  const port = process.env.PORT || 4000;
  await app.listen(port, process.env.HOST || '0.0.0.0'); // HOST=127.0.0.1 on a VPS behind Nginx
  console.log(`Dealer Platform API running on http://${process.env.HOST || 'localhost'}:${port} (${process.env.NODE_ENV || 'development'})`);
}

bootstrap().catch((err) => {
  console.error('Failed to start application:', err);
  process.exit(1);
});
