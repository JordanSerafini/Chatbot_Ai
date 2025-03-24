import { Module } from '@nestjs/common';
import { RagModule } from './RAG/rag.module';
import { SqlQueriesModule } from './sql-queries/sql-queries.module';
import { InitService } from './services/init.service';

@Module({
  imports: [RagModule, SqlQueriesModule],
  providers: [InitService],
})
export class AppModule {}
