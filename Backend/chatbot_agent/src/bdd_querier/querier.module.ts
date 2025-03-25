import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { QuerierController } from './querier.controller';
import { QuerierService } from './querier.service';

@Module({
  imports: [ConfigModule],
  controllers: [QuerierController],
  providers: [QuerierService],
  exports: [QuerierService],
})
export class QuerierModule {} 