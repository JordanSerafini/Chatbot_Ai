import { Module } from '@nestjs/common';
import { ChromaService } from '../services/chroma.service';
import { RagController } from './rag.controller';
import { RagService } from './rag.service';
import { QuestionsLoaderService } from './services/questions-loader.service';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule],
  controllers: [RagController],
  providers: [RagService, ChromaService, QuestionsLoaderService],
  exports: [RagService, ChromaService],
})
export class RagModule {}
