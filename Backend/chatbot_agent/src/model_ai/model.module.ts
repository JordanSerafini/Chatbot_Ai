import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ModelService } from './model.service';
import { HttpModule } from '@nestjs/axios';
import { ModelController } from './model.controller';

@Module({
  imports: [ConfigModule, HttpModule],
  controllers: [ModelController],
  providers: [ModelService],
  exports: [ModelService],
})
export class ModelModule {}
