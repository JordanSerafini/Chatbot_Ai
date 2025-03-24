import { Module } from '@nestjs/common';
import { SqlQueriesService } from './sql-queries.service';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule],
  providers: [SqlQueriesService],
  exports: [SqlQueriesService],
})
export class SqlQueriesModule {}
