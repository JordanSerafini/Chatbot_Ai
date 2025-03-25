import { Body, Controller, Post, Logger } from '@nestjs/common';
import { ModelService } from './model.service';

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

@Controller('ai')
export class ModelController {
  private readonly logger = new Logger(ModelController.name);

  constructor(private readonly modelService: ModelService) {}

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
}
