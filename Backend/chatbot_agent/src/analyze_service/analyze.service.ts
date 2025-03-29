import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

interface RagQuestion {
  question: string;
  metadata: {
    sql: string;
    description: string;
    parameters: {
      name: string;
      description: string;
      default?: string;
    }[];
  };
  distance: number;
}

@Injectable()
export class AnalyseService {
  private readonly logger = new Logger('Analyze_Service_Logger');

  constructor(private configService: ConfigService) {}

  async analyzeQuestion(question: string): Promise<string> {
    try {
      const similarQuestions = await this.getSimilarQuestions(question);
      return `Analyzed question: ${question}`;
    } catch (e) {
      this.logger.error(e);
      throw e;
    }
  }

  private async getSimilarQuestions(question: string): Promise<RagQuestion> {
    try {
      const ragServiceUrl = this.configService.get<string>('RAG_SERVICE_URL');
      const response = await axios.post(`${ragServiceUrl}/rag/similar`, { question });
      return response.data;
    } catch (error) {
      this.logger.error('Error getting similar questions:', error);
      throw error;
    }
  }
}
