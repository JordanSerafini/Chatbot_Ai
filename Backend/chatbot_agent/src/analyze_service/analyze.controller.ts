import { Controller, Post, Body, Logger } from '@nestjs/common';
import { AnalyseService } from './analyze.service';

@Controller('analyze')
export class AnalyseController {
  private readonly logger = new Logger(AnalyseController.name);

  constructor(private readonly analyseService: AnalyseService) {}

  @Post('question')
  async analyzeQuestion(@Body() body: any): Promise<any> {
    try {
      // Vérification si la question est définie
      if (!body || !body.question) {
        this.logger.error('Question non définie dans la requête');
        return {
          error:
            'Question non définie. Veuillez fournir une question dans le format JSON { "question": "votre question" }',
          exempleFormat: { question: 'votre question' },
        };
      }

      this.logger.log(`Analyse de la question: "${body.question}"`);
      const analysisResult = await this.analyseService.analyzeQuestion(
        body.question,
      );
      this.logger.log(
        `Résultat de l'analyse: ${JSON.stringify(analysisResult)}`,
      );

      // Réponse simplifiée
      return {
        original: body.question,
        reformulation: analysisResult.reformulation,
        keywords: analysisResult.keywords,
        client: analysisResult.entities.client || '',
        chantier: analysisResult.entities.chantier || '',
        planning: analysisResult.entities.planning || '',
        date: analysisResult.entities.date || '',
      };
    } catch (error) {
      this.logger.error("Erreur lors de l'analyse de la question:", error);
      return {
        error: `Erreur lors de l'analyse de la question: ${error.message || JSON.stringify(error)}`,
      };
    }
  }
}
