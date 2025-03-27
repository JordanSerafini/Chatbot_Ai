import { Controller, Post, Body, Logger } from '@nestjs/common';
import { AnalyseService } from './analyze.service';

class QuestionDto {
  question: string;
}

@Controller('analyze')
export class AnalyseController {
  private readonly logger = new Logger(AnalyseController.name);

  constructor(private readonly analyseService: AnalyseService) {}

  @Post('question')
  async analyzeQuestion(@Body() questionDto: QuestionDto): Promise<string> {
    try {
      this.logger.log(`Analyse de la question: "${questionDto.question}"`);
      const result = await this.analyseService.analyzeQuestion(
        questionDto.question,
      );
      this.logger.log(`Résultat de l'analyse: "${result}"`);
      return result;
    } catch (error) {
      this.logger.error("Erreur lors de l'analyse de la question:", error);
      throw error;
    }
  }
}
