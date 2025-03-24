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
  private readonly logger = new Logger(ModelService.name);
  // Configuration par défaut pour l'API LM Studio
  private readonly modelConfig = {
    temperature: 0.2,
    max_tokens: 1000,
    top_p: 0.9,
    top_k: 50,
    repeat_penalty: 1.1,
    stop: ['</s>'],
  };

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    this.logger.log('ModelService initialized for LM Studio');
    // Vérifier que LM Studio est accessible
    try {
      await this.checkLmStudioAvailability();
    } catch (error) {
      this.logger.warn(
        `LM Studio API may not be available: ${error.message}. Ensure LM Studio is running with API server enabled.`,
      );
    }
  }

  private async checkLmStudioAvailability(): Promise<void> {
    try {
      const lmStudioUrl = this.getLmStudioUrl();
      await axios.get(`${lmStudioUrl}/v1/models`);
      this.logger.log('Successfully connected to LM Studio API');
    } catch (error) {
      this.logger.error(`Failed to connect to LM Studio API: ${error.message}`);
      throw new Error(
        'LM Studio API is not available. Please ensure LM Studio is running with API server enabled.',
      );
    }
  }

  private getLmStudioUrl(): string {
    return (
      this.configService.get<string>('LM_STUDIO_URL') ||
      'http://localhost:1234/v1'
    );
  }

  private formatPrompt(context: string, userInput: string): string {
    // Format compatible avec Mistral-Nemo
    return `<|im_start|>system
${context}<|im_end|>
<|im_start|>user
${userInput}<|im_end|>
<|im_start|>assistant
`;
  }

  /**
   * Génère une réponse à partir de l'entrée utilisateur en utilisant le service RAG et le modèle LLM local
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

      // 3. Formater les résultats en langage naturel pour l'utilisateur
      const formattedPrompt = this.formatPrompt(
        `Vous êtes un assistant qui aide à expliquer des requêtes SQL et leurs résultats.`,
        `Question: "${userInput}"
         
J'ai trouvé une requête SQL qui pourrait répondre à cette question:
- Description: ${bestMatch.description}
- SQL: ${bestMatch.sql}
         
Veuillez expliquer ce que fait cette requête SQL et comment elle répond à la question. Quelles informations cette requête va-t-elle retourner?`,
      );

      // Appeler l'API LM Studio
      const response = await this.callLmStudioApi(formattedPrompt);
      return response;
    } catch (error) {
      this.logger.error(`Failed to generate response: ${error.message}`);
      throw new Error(`Failed to generate response: ${error.message}`);
    }
  }

  /**
   * Appelle l'API LM Studio pour générer une réponse
   */
  private async callLmStudioApi(prompt: string): Promise<string> {
    try {
      const lmStudioUrl = this.getLmStudioUrl();
      const response = await axios.post(`${lmStudioUrl}/completions`, {
        prompt,
        model: 'mistral-nemo-instruct-2407', // Ou laissez vide pour utiliser le modèle actuellement chargé
        ...this.modelConfig,
      });

      // Extraire et retourner le texte généré sans les balises de fin
      let generatedText = response.data.choices[0].text || '';

      // Nettoyer la sortie (enlever les balises de fin potentielles)
      if (generatedText.includes('<|im_end|>')) {
        generatedText = generatedText.split('<|im_end|>')[0];
      }

      return generatedText.trim();
    } catch (error) {
      this.logger.error(`Error calling LM Studio API: ${error.message}`);
      throw error;
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
        `Vous êtes un expert en SQL qui doit sélectionner la requête SQL la plus pertinente pour répondre à une question.`,
        `Question de l'utilisateur: "${userQuestion}"

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
      );

      // Appeler l'API LM Studio avec des paramètres pour une réponse courte
      const shortConfig = {
        ...this.modelConfig,
        max_tokens: 10,
      };

      const response = await axios.post(
        `${this.getLmStudioUrl()}/completions`,
        {
          prompt: formattedPrompt,
          ...shortConfig,
        },
      );

      // Extraire le numéro de l'option choisie
      const fullResponse = response.data.choices[0].text || '';
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

    try {
      const response = await axios.post(
        `${this.getLmStudioUrl()}/completions`,
        {
          prompt: formattedPrompt,
          ...this.modelConfig,
        },
      );

      let generatedText = response.data.choices[0].text || '';

      // Nettoyer la sortie
      if (generatedText.includes('<|im_end|>')) {
        generatedText = generatedText.split('<|im_end|>')[0];
      }

      return generatedText.trim();
    } catch (error) {
      this.logger.error(`Error generating direct response: ${error.message}`);
      throw error;
    }
  }

  /**
   * Récupère les questions similaires depuis le service RAG (méthode publique pour le contrôleur)
   */
  async getSimilarQuestionsPublic(question: string): Promise<RagQuestion[]> {
    return this.getSimilarQuestions(question);
  }

  /**
   * Demande au LLM de sélectionner la meilleure requête SQL parmi les options (méthode publique pour le contrôleur)
   */
  async selectBestMatchPublic(
    userQuestion: string,
    options: RagQuestion[],
  ): Promise<RagResponse | null> {
    return this.selectBestMatch(userQuestion, options);
  }

  /**
   * Génère une explication de la requête SQL sélectionnée
   */
  async explainSqlQuery(
    context: string,
    userQuestion: string,
    selectedQuery: RagResponse,
  ): Promise<string> {
    const formattedPrompt = this.formatPrompt(
      `Vous êtes un assistant qui aide à expliquer des requêtes SQL et leurs résultats.`,
      `Question: "${userQuestion}"
       
J'ai trouvé une requête SQL qui pourrait répondre à cette question:
- Description: ${selectedQuery.description}
- SQL: ${selectedQuery.sql}
       
Veuillez expliquer ce que fait cette requête SQL et comment elle répond à la question. Quelles informations cette requête va-t-elle retourner?`,
    );

    return this.callLmStudioApi(formattedPrompt);
  }

  /**
   * Génère une réponse directe sans utiliser de RAG (méthode publique pour le contrôleur)
   */
  async generateDirectResponsePublic(
    context: string,
    userInput: string,
  ): Promise<string> {
    return this.generateDirectResponse(context, userInput);
  }
}
