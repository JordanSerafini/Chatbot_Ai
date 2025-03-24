import { Body, Controller, Post, Logger } from '@nestjs/common';
import { ModelService } from './model.service';

interface QueryDto {
  question: string;
  context?: string;
}

interface QueryResponseDto {
  question: string;
  answer: string;
  sql?: string;
  description?: string;
  source: 'rag' | 'direct';
  confidence?: number;
}

@Controller('ai')
export class ModelController {
  private readonly logger = new Logger(ModelController.name);

  constructor(private readonly modelService: ModelService) {}

  @Post('query')
  async generateResponse(
    @Body() queryDto: QueryDto,
  ): Promise<QueryResponseDto> {
    this.logger.log(`Received question: ${queryDto.question}`);

    try {
      // Contexte par défaut si non fourni
      const context =
        queryDto.context ||
        "Vous êtes un assistant expert en gestion d'entreprise qui aide à répondre aux questions sur les clients, projets, factures et planning.";

      // Obtenir la réponse du modèle
      const response = await this.modelService.generateResponse(
        context,
        queryDto.question,
      );

      return {
        question: queryDto.question,
        answer: response,
        source: 'rag',
      };
    } catch (error) {
      this.logger.error(`Error generating response: ${error.message}`);
      throw error;
    }
  }
}
