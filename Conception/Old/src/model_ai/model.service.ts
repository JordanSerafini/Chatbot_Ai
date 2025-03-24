import { HfInference } from '@huggingface/inference';
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
  question: string;
  sql: string;
  description: string;
  distance: number;
  parameters?: any[];
}

@Injectable()
export class ModelService {
  private model: HfInference;
  private readonly modelName = 'mistralai/Mistral-7B-Instruct-v0.2';
  private readonly logger = new Logger(ModelService.name);
  private readonly modelConfig = {
    inputs: 'text',
    parameters: {
      max_new_tokens: 1000,
      temperature: 0.2,
      repetition_penalty: 1.1,
      top_k: 50,
      top_p: 0.9,
    },
  };

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    const token = this.configService.get<string>('HUGGING_FACE_TOKEN');
    if (!token) {
      throw new Error('HUGGINGFACE_TOKEN is not set');
    }
    await this.initializeModel(token);
    this.logger.log('ModelService initialized');
  }

  private async initializeModel(token: string): Promise<void> {
    this.model = new HfInference(token);
    await Promise.resolve();
  }

  private formatPrompt(context: string, userInput: string): string {
    return `<s>[INST] ${context}

${userInput} [/INST]</s>`;
  }

  /**
   * Génère une réponse à partir de l'entrée utilisateur en utilisant le service RAG et le modèle LLM
   */
  async generateResponse(context: string, userInput: string): Promise<string> {
    try {
      // 1. Obtenir des questions similaires depuis le service RAG
      const similarQuestions = await this.getSimilarQuestions(userInput);

      if (!similarQuestions || similarQuestions.length === 0) {
        // Si aucune question similaire n'est trouvée, générer une réponse directement avec le LLM
        return await this.generateDirectResponse(context, userInput);
      }

      // 2. Demander au LLM de choisir la meilleure requête SQL
      const bestMatch = await this.selectBestMatch(userInput, similarQuestions);

      if (!bestMatch) {
        // Si le LLM ne peut pas sélectionner une requête, générer une réponse directement
        return await this.generateDirectResponse(context, userInput);
      }

      // 3. Exécuter la requête SQL (à implémenter ultérieurement)
      // const queryResult = await this.executeQuery(bestMatch.sql);

      // 4. Formater les résultats en langage naturel pour l'utilisateur
      const formattedPrompt = this.formatPrompt(
        `Vous êtes un assistant qui aide à expliquer des requêtes SQL et leurs résultats.
         
La question de l'utilisateur est: "${userInput}"
         
J'ai trouvé une requête SQL qui pourrait répondre à cette question:
- Description: ${bestMatch.description}
- SQL: ${bestMatch.sql}
         
Veuillez expliquer ce que fait cette requête SQL et comment elle répond à la question de l'utilisateur.
Expliquez également quelles informations cette requête va retourner.`,
        "Veuillez m'expliquer cette requête SQL.",
      );

      const response = await this.model.textGeneration({
        model: this.modelName,
        inputs: formattedPrompt,
        parameters: this.modelConfig.parameters,
      });

      return response.generated_text;
    } catch (error) {
      this.logger.error(`Failed to generate response: ${error.message}`);
      throw new Error(`Failed to generate response: ${error.message}`);
    }
  }

  /**
   * Récupère les questions similaires depuis le service RAG
   */
  private async getSimilarQuestions(question: string): Promise<RagQuestion[]> {
    try {
      const ragServiceUrl =
        this.configService.get<string>('RAG_SERVICE_URL') ||
        'http://localhost:3002';
      const response = await axios.post(`${ragServiceUrl}/rag/similar`, {
        question,
        nResults: 5,
      });

      return response.data;
    } catch (error) {
      this.logger.error(`Error getting similar questions: ${error.message}`);
      return [];
    }
  }

  /**
   * Demande au LLM de sélectionner la meilleure requête SQL parmi les options
   */
  private async selectBestMatch(
    userQuestion: string,
    options: RagQuestion[],
  ): Promise<RagResponse | null> {
    try {
      // Préparer le prompt avec toutes les options pour que le LLM choisisse
      let optionsText = '';
      options.forEach((option, index) => {
        optionsText += `Option ${index + 1}:
- Question: ${option.question}
- Description: ${option.metadata.description}
- SQL: ${option.metadata.sql}
- Distance: ${option.distance}

`;
      });

      const formattedPrompt = this.formatPrompt(
        `Vous êtes un expert en SQL qui doit sélectionner la requête SQL la plus pertinente pour répondre à une question.
         
Question de l'utilisateur: "${userQuestion}"

Voici des options de requêtes SQL existantes:
${optionsText}

Analysez la question et les options de requêtes SQL disponibles. 
Pour chaque option, évaluez si elle répond à la question posée, en tenant compte:
1. De la sémantique de la question
2. Des tables et colonnes référencées dans la requête SQL
3. Des conditions et filtres appliqués
4. De la pertinence globale pour répondre exactement à ce qui est demandé

Choisissez l'option la plus pertinente et retournez uniquement son numéro (1, 2, 3, 4 ou 5). 
Si aucune option n'est pertinente, répondez "0".`,
        "Quelle est l'option de requête SQL la plus pertinente pour cette question?",
      );

      const response = await this.model.textGeneration({
        model: this.modelName,
        inputs: formattedPrompt,
        parameters: {
          ...this.modelConfig.parameters,
          max_new_tokens: 10,
        },
      });

      // Extraire le numéro de l'option choisie
      const fullResponse = response.generated_text;
      const match = fullResponse.match(/\d+/);

      if (!match || match[0] === '0') {
        // Aucune option pertinente trouvée
        return null;
      }

      const selectedIndex = parseInt(match[0], 10) - 1;
      if (selectedIndex < 0 || selectedIndex >= options.length) {
        return null;
      }

      const selected = options[selectedIndex];
      return {
        question: selected.question,
        sql: selected.metadata.sql,
        description: selected.metadata.description,
        distance: selected.distance,
        parameters: selected.metadata.parameters,
      };
    } catch (error) {
      this.logger.error(`Error selecting best match: ${error.message}`);
      return null;
    }
  }

  /**
   * Génère une réponse directe sans utiliser de RAG
   */
  private async generateDirectResponse(
    context: string,
    userInput: string,
  ): Promise<string> {
    const formattedPrompt = this.formatPrompt(context, userInput);
    const response = await this.model.textGeneration({
      model: this.modelName,
      inputs: formattedPrompt,
      parameters: this.modelConfig.parameters,
    });

    return response.generated_text;
  }
}
