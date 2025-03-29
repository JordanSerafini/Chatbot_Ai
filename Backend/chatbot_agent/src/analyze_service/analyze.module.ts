import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { AnalyseController } from './analyze.controller';
import { AnalyseService } from './analyze.service';

@Module({
  imports: [HttpModule, ConfigModule],
  controllers: [AnalyseController],
  providers: [AnalyseService],
  exports: [AnalyseService],
})
export class AnalyseModule {}
