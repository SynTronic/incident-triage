import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  // The upload widget is embedded on other origins and inside WebViews.
  app.enableCors({ origin: process.env.CORS_ORIGINS?.split(',') ?? true });
  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
