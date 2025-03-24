import { Module } from '@nestjs/common';
import { SqlQueriesService } from './sql-queries.service';

@Module({
  providers: [SqlQueriesService],
  exports: [SqlQueriesService],
})
export class SqlQueriesModule {}
