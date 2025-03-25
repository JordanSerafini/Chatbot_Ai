import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

interface RagQuestion {
  question: string;
  metadata: {
    sql: string;
    description: string;
    parameters: any[];
  };
  distance: number;
}

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

@Injectable()
export class ModelService {
  private readonly logger = new Logger(ModelService.name);

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    this.logger.log('ModelService initialized for LM Studio');
    this.logger.log(`LM Studio URL: ${this.getLmStudioUrl()}`);
    this.logger.log(`RAG Service URL: ${this.getRagUrl()}`);

    try {
      await this.checkLmStudioAvailability();
    } catch (error) {
      this.logger.warn(
        `LM Studio API may not be available: ${error.message}. Ensure LM Studio is running with API server enabled.`,
      );
    }
  }

  private getLmStudioUrl(): string {
    return (
      this.configService.get('LM_STUDIO_URL') || 'http://localhost:1234/v1'
    );
  }

  private getRagUrl(): string {
    return this.configService.get('RAG_SERVICE_URL') || 'http://localhost:3002';
  }

  private async checkLmStudioAvailability(): Promise<void> {
    try {
      const lmStudioUrl = this.getLmStudioUrl();
      await axios.get(`${lmStudioUrl}/models`);
      this.logger.log('Successfully connected to LM Studio API');
    } catch (error) {
      this.logger.error(`Failed to connect to LM Studio API: ${error.message}`);
      this.logger.error(
        'Make sure LM Studio is running with API server enabled',
      );
    }
  }

  async generateResponse(question: string): Promise<RagResponse> {
    this.logger.log(`Starting generateResponse with question: ${question}`);
    try {
      // 1. Get similar questions from RAG
      const similarQuestions = await this.getSimilarQuestions(question);
      this.logger.log(`Found ${similarQuestions.length} similar questions`);

      if (similarQuestions.length === 0) {
        return {
          querySelected: {
            sql: '',
            description: '',
            question: '',
            distance: 0,
          },
          otherQueries: [],
        };
      }

      // 2. Select best match using LM Studio
      const bestMatch = await this.selectBestMatch(question, similarQuestions);
      this.logger.log(`Selected best match: ${bestMatch.question}`);

      // 3. Prepare other options avec toutes les informations
      const otherQueriesDetails = similarQuestions
        .filter((q) => q.question !== bestMatch.question)
        .slice(0, 2)
        .map((q) => ({
          sql: q.metadata.sql,
          description: q.metadata.description,
          question: q.question,
          distance: q.distance,
          parameters: q.metadata.parameters || [],
        }));

      // 4. Return response avec structure complète
      return {
        querySelected: {
          sql: bestMatch.metadata.sql,
          description: bestMatch.metadata.description,
          question: bestMatch.question,
          distance: bestMatch.distance,
          parameters: bestMatch.metadata.parameters || [],
        },
        otherQueries: otherQueriesDetails,
      };
    } catch (error) {
      this.logger.error(`Error in generateResponse: ${error.message}`);
      return {
        querySelected: {
          sql: '',
          description: '',
          question: '',
          distance: 0,
        },
        otherQueries: [],
      };
    }
  }

  private async getSimilarQuestions(question: string): Promise<RagQuestion[]> {
    try {
      const ragUrl = this.getRagUrl();
      const serviceUrl = ragUrl.replace('localhost', 'rag_service');

      this.logger.log(`Calling RAG service at ${serviceUrl}/rag/similar`);

      const response = await axios.post(
        `${serviceUrl}/rag/similar`,
        { question, nResults: 5 },
        {
          timeout: 10000,
          headers: { 'Content-Type': 'application/json' },
        },
      );

      if (!response.data || !Array.isArray(response.data)) {
        this.logger.error(
          `Unexpected RAG response format: ${JSON.stringify(response.data)}`,
        );
        return [];
      }

      return response.data.filter(
        (q) => q.question && q.metadata?.sql && typeof q.distance === 'number',
      );
    } catch (error) {
      this.logger.error(`RAG service error: ${error.message}`);
      return [];
    }
  }

  private async selectBestMatch(
    question: string,
    options: RagQuestion[],
  ): Promise<RagQuestion> {
    try {
      // Préparer le prompt pour LM Studio
      const prompt = this.prepareSelectionPrompt(question, options);
      this.logger.log('Sending prompt to LM Studio for selection');

      // Appeler LM Studio pour évaluer la pertinence
      const response = await axios.post(
        `${this.getLmStudioUrl()}/completions`,
        {
          prompt,
          max_tokens: 10,
          temperature: 2,
          top_p: 1.0,
        },
        { timeout: 30000 },
      );

      // Extraire la réponse
      const fullResponse = response.data.choices[0].text.trim();
      this.logger.log(`LM Studio response: "${fullResponse}"`);

      // Extraire l'index de la question la plus pertinente
      const match = fullResponse.match(/\d+/);
      const index = match ? parseInt(match[0], 10) - 1 : 0;

      // Vérifier que l'index est valide
      if (index >= 0 && index < options.length) {
        this.logger.log(
          `Selected option ${index + 1}: "${options[index].question}"`,
        );
        return options[index];
      } else {
        this.logger.warn(
          `Invalid index ${index}, falling back to distance-based selection`,
        );
        // Fallback: trier par distance
        const sorted = [...options].sort((a, b) => a.distance - b.distance);
        return sorted[0];
      }
    } catch (error) {
      this.logger.error(
        `Error using LM Studio for selection: ${error.message}`,
      );
      if (error.response) {
        this.logger.error(`Response status: ${error.response.status}`);
        this.logger.error(
          `Response data: ${JSON.stringify(error.response.data)}`,
        );
      }
      // Fallback: trier par distance en cas d'erreur
      const sorted = [...options].sort((a, b) => a.distance - b.distance);
      return sorted[0];
    }
  }

  private prepareSelectionPrompt(
    question: string,
    options: RagQuestion[],
  ): string {
    let optionsText = '';
    options.forEach((option, index) => {
      optionsText += `${index + 1}) "${option.question}" (score de similarité: ${(1 - option.distance).toFixed(2)})\n`;
    });
    
    return `Tu es un assistant SQL spécialisé qui aide à sélectionner la question la plus pertinente par rapport à la requête de l'utilisateur.

Question de l'utilisateur: "${question}"

Voici les questions similaires disponibles (avec leur score de similarité calculé par distance vectorielle):
${optionsText}

Ta tâche:
1. Analyse attentivement la question de l'utilisateur
2. Compare-la avec chaque option proposée
3. Sélectionne l'option qui correspond le mieux à l'intention et au besoin de l'utilisateur
`;
  }
}
