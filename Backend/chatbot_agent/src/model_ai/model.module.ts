import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ModelService } from './model.service';
import { HttpModule } from '@nestjs/axios';
import { ModelController } from './model.controller';
import { QuerierModule } from '../bdd_querier/querier.module';

@Module({
  imports: [ConfigModule, HttpModule, QuerierModule],
  controllers: [ModelController],
  providers: [ModelService],
  exports: [ModelService],
})
export class ModelModule {}
