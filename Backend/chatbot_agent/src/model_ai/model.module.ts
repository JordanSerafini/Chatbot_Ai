import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ModelService } from './model.service';
import { HttpModule } from '@nestjs/axios';
import { ModelController } from './model.controller';
import { QuerierModule } from '../bdd_querier/querier.module';
import { TextProcessorService } from './text-processor.service';

@Module({
  imports: [ConfigModule, HttpModule, QuerierModule],
  controllers: [ModelController],
  providers: [ModelService, TextProcessorService],
  exports: [ModelService, TextProcessorService],
})
export class ModelModule {}
