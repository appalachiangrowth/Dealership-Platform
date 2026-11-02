import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: true });
  app.useBodyParser('json', { limit: '20mb' });
  app.set('trust proxy', true);

  app.enableCors({
    // Dealer websites live on many domains, so any origin may call the API.
    // Admin calls use a Bearer token (no cookies), so this is safe.
    origin: (origin, cb) => cb(null, true),
    credentials: false,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-Id', 'X-Site-Host'],
    exposedHeaders: ['Content-Disposition'],
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

  const port = process.env.PORT || 4000;
  await app.listen(port, '0.0.0.0');
  console.log(`Dealer Platform API running on http://localhost:${port}`);
}

bootstrap().catch((err) => {
  console.error('Failed to start application:', err);
  process.exit(1);
});
