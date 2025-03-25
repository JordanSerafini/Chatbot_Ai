import {
  Body,
  Controller,
  Post,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ModelService } from './model.service';
import { QuerierService } from '../bdd_querier/querier.service';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

interface RagResponse {
  querySelected: {
    sql: string;
    description: string;
    question: string;
    distance: number;
    parameters?: any[];
  };
  otherQueries: {
    sql: string;
    description: string;
    question: string;
    distance: number;
    parameters?: any[];
  }[];
}

interface QueryDto {
  question: string;
}

interface QueryExecutionResponse {
  success: boolean;
  data?: any[];
  count?: number;
  sql?: string;
  description?: string;
  error?: string;
  selectedQuery?: {
    question: string;
    sql: string;
    description: string;
  };
  alternativeQuestions?: {
    question: string;
    sql: string;
    description: string;
  }[];
  textResponse?: string;
}

@Controller('ai')
export class ModelController {
  private readonly logger = new Logger(ModelController.name);

  constructor(
    private readonly modelService: ModelService,
    private readonly querierService: QuerierService,
    private readonly httpService: HttpService,
  ) {}

  @Post('query')
  async generateResponse(@Body() queryDto: QueryDto): Promise<RagResponse> {
    this.logger.log(`Received question: ${queryDto.question}`);

    const response = await this.modelService.generateResponse(
      queryDto.question,
    );

    this.logger.log(
      `Generated response: ${JSON.stringify({
        selectedQuestion: response.querySelected.question,
        otherQueriesCount: response.otherQueries.length,
      })}`,
    );

    return response;
  }

  @Post('query-execute')
  async queryAndExecute(
    @Body() queryDto: QueryDto,
  ): Promise<QueryExecutionResponse> {
    this.logger.log(`Received query execution request: ${queryDto.question}`);

    try {
      // 1. Obtenir la requête SQL via le RAG
      const response = await this.modelService.generateResponse(
        queryDto.question,
      );

      if (!response.querySelected || !response.querySelected.sql) {
        throw new HttpException(
          'No suitable SQL query found for your question',
          HttpStatus.BAD_REQUEST,
        );
      }

      this.logger.log(`Query selected: ${response.querySelected.sql}`);

      try {
        // 2. Exécuter la requête SQL via le QuerierService
        const sqlResult = await this.querierService.executeSelectedQuery(
          response.querySelected.sql,
          response.querySelected.parameters || [],
        );

        // 3. Retourner la réponse combinée
        const otherQueries = response.otherQueries.map((query) => ({
          question: query.question,
          sql: query.sql,
          description: query.description,
        }));

        return {
          success: true,
          data: sqlResult.result,
          count: sqlResult.result.length,
          sql: response.querySelected.sql,
          description: response.querySelected.description,
          selectedQuery: {
            question: response.querySelected.question,
            sql: response.querySelected.sql,
            description: response.querySelected.description,
          },
          alternativeQuestions: otherQueries,
          textResponse: await this.modelService.generateNaturalResponse(
            response.querySelected.description,
            sqlResult.result,
            queryDto.question,
          ),
        };
      } catch (sqlError) {
        // Gestion des erreurs SQL
        this.logger.error(`SQL execution error: ${sqlError.message}`);
        return {
          success: false,
          error: `SQL execution error: ${sqlError.message}`,
          sql: response.querySelected.sql,
          description: response.querySelected.description,
        };
      }
    } catch (error) {
      this.logger.error(`Error in query-execute: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  @Post('query-run')
  async queryAndRun(@Body() queryDto: QueryDto): Promise<any> {
    this.logger.log(`Received RAG query and run request: ${queryDto.question}`);

    try {
      // 1. Obtenir la requête SQL via le RAG
      const ragResponse = await this.modelService.generateResponse(
        queryDto.question,
      );

      // 2. Envoyer la requête au contrôleur querier via HTTP
      const querierUrl = 'http://localhost:3001/query/rag';
      this.logger.log(`Sending request to querier: ${querierUrl}`);

      try {
        const response = await firstValueFrom(
          this.httpService.post(querierUrl, ragResponse),
        );

        // 3. Préparer une réponse complète pour le chatbot
        const otherQuestions = ragResponse.otherQueries.map((query) => ({
          question: query.question,
          sql: query.sql,
          description: query.description,
        }));

        return {
          success: true,
          // Résultats de l'exécution SQL
          data: response.data.data || [],
          count: response.data.count || 0,

          // Informations sur la requête exécutée
          selectedQuery: {
            question: ragResponse.querySelected.question,
            sql: ragResponse.querySelected.sql,
            description: ragResponse.querySelected.description,
          },

          // Questions alternatives pour le chatbot
          alternativeQuestions: otherQuestions,

          // Résumé pour le chatbot
          summary: {
            question: queryDto.question,
            selectedQuestion: ragResponse.querySelected.question,
            resultsCount: response.data.data?.length || 0,
            alternativesCount: otherQuestions.length,
          },

          // Réponse textuelle pour l'interface utilisateur
          textResponse: await this.modelService.generateNaturalResponse(
            ragResponse.querySelected.description,
            response.data.data || [],
            queryDto.question,
          ),
        };
      } catch (httpError) {
        this.logger.error(`HTTP error: ${httpError.message}`);
        if (httpError.response) {
          this.logger.error(
            `Response data: ${JSON.stringify(httpError.response.data)}`,
          );
        }

        return {
          success: false,
          error: `Error executing query: ${httpError.message}`,
          selectedQuery: ragResponse.querySelected,
          alternativeQuestions: ragResponse.otherQueries.map((query) => ({
            question: query.question,
            sql: query.sql,
            description: query.description,
          })),
        };
      }
    } catch (error) {
      this.logger.error(`Error in queryAndRun: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}
