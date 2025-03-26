import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

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

  private ModelQuery(question:string): Promise<string> {
   
  }
}
