import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ModelModule } from './model_ai/model.module';
import { HealthModule } from './health/health.module';
import { QuerierModule } from './bdd_querier/querier.module';
import { AnalyseModule } from './analyze_service/analyze.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        () => ({
          LM_STUDIO_URL:
            process.env.LM_STUDIO_URL ||
            'https://34a3-2a01-cb15-4c5-c200-ff2e-b498-e114-f0c2.ngrok-free.app',
          RAG_SERVICE_URL:
            process.env.RAG_SERVICE_URL || 'http://localhost:3002',
          POSTGRES_HOST: process.env.POSTGRES_HOST || 'postgres',
          POSTGRES_PORT: process.env.POSTGRES_PORT || '5432',
          POSTGRES_USER: process.env.POSTGRES_USER || 'postgres',
          POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD || 'postgres',
          POSTGRES_DB: process.env.POSTGRES_DB || 'postgres',
        }),
      ],
    }),
    ModelModule,
    HealthModule,
    QuerierModule,
    AnalyseModule,
  ],
})
export class AppModule {}
