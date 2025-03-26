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
      console.log(question);
    } catch (e) {
      console.log(e);
    }
  }

  private getSimilarQuestions(question: string): Promise<RagQuestion> {}
}
