import {
  Body,
  Controller,
  Post,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { QuerierService } from './querier.service';

interface QueryDto {
  sql: string;
  params?: any[];
  description?: string;
}

interface QueryResult {
  success: boolean;
  data?: any[];
  count?: number;
  message?: string;
  error?: string;
  sql?: string;
  description?: string;
}

interface SelectedQueryDto {
  sql: string;
  parameters?: any[];
  description?: string;
}

interface SelectedQueryResult {
  success: boolean;
  data?: any[];
  count?: number;
  description?: string;
  query?: string;
  error?: string;
}

interface RagQueryDto {
  querySelected: {
    sql: string;
    description: string;
    question: string;
    distance: number;
  };
  otherQueries: any[];
}

interface RagQueryResult {
  success: boolean;
  data?: any[];
  count?: number;
  description?: string;
  question?: string;
  sql?: string;
  error?: string;
}

@Controller('query')
export class QuerierController {
  private readonly logger = new Logger(QuerierController.name);

  constructor(private readonly querierService: QuerierService) {}

  @Post('execute')
  async executeQuery(@Body() queryDto: QueryDto): Promise<QueryResult> {
    this.logger.log(`Received query request: ${queryDto.sql}`);

    try {
      if (!queryDto.sql || typeof queryDto.sql !== 'string') {
        throw new HttpException(
          'SQL query is required and must be a string',
          HttpStatus.BAD_REQUEST,
        );
      }

      // Exécuter la requête via le service
      const results = await this.querierService.executeQuery(
        queryDto.sql,
        queryDto.params || [],
      );

      return {
        success: true,
        data: results,
        count: results.length,
        sql: queryDto.sql,
        description: queryDto.description || 'Query executed successfully',
      };
    } catch (error) {
      this.logger.error(`Error executing query: ${error.message}`);

      // Retourner une réponse d'erreur structurée
      return {
        success: false,
        error: error.message,
        message: 'Failed to execute query',
        sql: queryDto.sql,
        description: queryDto.description,
      };
    }
  }

  @Post('selected')
  async executeSelectedQuery(
    @Body() queryDto: SelectedQueryDto,
  ): Promise<SelectedQueryResult> {
    this.logger.log(
      `Received selected query from ModelService: ${queryDto.sql.substring(0, 100)}...`,
    );

    try {
      if (!queryDto.sql) {
        throw new HttpException(
          'SQL query is required',
          HttpStatus.BAD_REQUEST,
        );
      }

      // Exécuter la requête sélectionnée
      const result = await this.querierService.executeSelectedQuery(
        queryDto.sql,
        queryDto.parameters || [],
      );

      return {
        success: true,
        data: result.result,
        count: result.result.length,
        description: queryDto.description || 'Query executed successfully',
        query: result.query,
      };
    } catch (error) {
      this.logger.error(`Error executing selected query: ${error.message}`);

      return {
        success: false,
        error: error.message,
        description: queryDto.description,
        query: queryDto.sql,
      };
    }
  }

  @Post('rag')
  async executeRagQuery(
    @Body() ragQueryDto: RagQueryDto,
  ): Promise<RagQueryResult> {
    this.logger.log(
      `Received RAG query: ${ragQueryDto.querySelected.sql.substring(0, 100)}...`,
    );

    try {
      if (!ragQueryDto.querySelected || !ragQueryDto.querySelected.sql) {
        throw new HttpException(
          'Selected SQL query is required',
          HttpStatus.BAD_REQUEST,
        );
      }

      // Exécuter la requête SQL sélectionnée
      const results = await this.querierService.executeRagQuery(
        ragQueryDto.querySelected.sql,
      );

      return {
        success: true,
        data: results,
        count: results.length,
        description: ragQueryDto.querySelected.description,
        question: ragQueryDto.querySelected.question,
        sql: ragQueryDto.querySelected.sql,
      };
    } catch (error) {
      this.logger.error(`Error executing RAG query: ${error.message}`);

      return {
        success: false,
        error: error.message,
        description: ragQueryDto.querySelected?.description,
        question: ragQueryDto.querySelected?.question,
        sql: ragQueryDto.querySelected?.sql,
      };
    }
  }
}
