import { Module } from '@nestjs/common';
import { RagModule } from './RAG/rag.module';
import { SqlQueriesModule } from './sql-queries/sql-queries.module';
import { InitService } from './services/init.service';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [configuration],
      isGlobal: true,
    }),
    RagModule,
    SqlQueriesModule,
  ],
  providers: [InitService],
})
export class AppModule {}
