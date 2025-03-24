import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ModelModule } from './model_ai/model.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [() => ({
        LM_STUDIO_URL: process.env.LM_STUDIO_URL || 'http://localhost:1234/v1',
        RAG_SERVICE_URL: process.env.RAG_SERVICE_URL || 'http://localhost:3002',
      })],
    }),
    ModelModule,
    HealthModule,
  ],
})
export class AppModule {}
