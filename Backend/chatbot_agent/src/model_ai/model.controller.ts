import { Body, Controller, Post, Logger } from '@nestjs/common';
import { ModelService } from './model.service';

interface QueryDto {
  question: string;
  context?: string;
}

interface SqlOption {
  question: string;
  sql: string;
  description: string;
  distance: number;
  parameters?: any[];
}

interface QueryResponseDto {
  question: string;
  answer: string;
  selectedSql?: {
    sql: string;
    description: string;
    distance: number;
  };
  allOptions?: SqlOption[];
  source: 'rag' | 'direct';
  confidence?: number;
}

interface SimilarityResponseDto {
  result: string;
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
      const context =
        queryDto.context ||
        "Vous êtes un assistant expert en gestion d'entreprise qui aide à répondre aux questions sur les clients, projets, factures et planning.";

      // 1. Obtenir toutes les questions similaires du service RAG
      const similarQuestions =
        await this.modelService.getSimilarQuestionsPublic(queryDto.question);

      // 2. Si aucune question similaire, générer une réponse directe
      if (!similarQuestions || similarQuestions.length === 0) {
        const directResponse =
          await this.modelService.generateDirectResponsePublic(
            context,
            queryDto.question,
          );

        return {
          question: queryDto.question,
          answer: directResponse,
          source: 'direct',
          allOptions: [],
        };
      }

      // 3. Faire choisir la requête SQL la plus pertinente par le LLM
      const bestMatch = await this.modelService.selectBestMatchPublic(
        queryDto.question,
        similarQuestions,
      );

      // 4. Reformater les résultats pour les inclure dans la réponse
      const options = similarQuestions.map((sq) => ({
        question: sq.question,
        sql: sq.metadata.sql,
        description: sq.metadata.description,
        distance: sq.distance,
        parameters: sq.metadata.parameters,
      }));

      // 5. Si aucune requête pertinente n'a été choisie
      if (!bestMatch) {
        // Génération d'une réponse directe puisque aucune requête SQL n'a été jugée pertinente
        const noMatchResponse =
          await this.modelService.generateDirectResponsePublic(
            context,
            queryDto.question,
          );

        return {
          question: queryDto.question,
          answer: noMatchResponse,
          source: 'direct',
          allOptions: options,
          confidence: 0,
        };
      }

      // 6. Générer une explication de la requête SQL choisie
      const response = await this.modelService.explainSqlQuery(
        context,
        queryDto.question,
        bestMatch,
      );

      // 7. Construire la réponse complète
      return {
        question: queryDto.question,
        answer: response,
        selectedSql: {
          sql: bestMatch.sql,
          description: bestMatch.description,
          distance: bestMatch.distance,
        },
        allOptions: options,
        source: 'rag',
        confidence: 1 - bestMatch.distance, // Convertir la distance en score de confiance (0-1)
      };
    } catch (error) {
      this.logger.error(`Error generating response: ${error.message}`);
      throw error;
    }
  }

  @Post('similarity-check')
  async checkSimilarity(@Body() queryDto: QueryDto): Promise<SimilarityResponseDto> {
    this.logger.log(`Checking similarity for question: ${queryDto.question}`);

    try {
      // Obtenir toutes les questions similaires du service RAG
      const similarQuestions = await this.modelService.getSimilarQuestionsPublic(queryDto.question);

      // Si aucune question similaire, retourner directement "pas de similarité"
      if (!similarQuestions || similarQuestions.length === 0) {
        return { result: 'pas de similarité' };
      }

      // Demander au modèle de vérifier la similarité
      const similarQuestion = await this.modelService.getSelectedQuestionOrSimilarity(
        queryDto.question,
        similarQuestions,
      );

      return { result: similarQuestion };
    } catch (error) {
      this.logger.error(`Error checking similarity: ${error.message}`);
      throw error;
    }
  }
}
