import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { HttpService } from '@nestjs/axios';

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
    max_tokens: 2000,
    temperature: 0.1,
    top_p: 0.95,
    stop: ['</s>'], // Arrêter la génération au format DeepSeek
  };

  constructor(
    private httpService: HttpService,
    private configService: ConfigService,
  ) {}

  async onModuleInit() {
    this.logger.log('ModelService initialized for LM Studio');
    this.logger.log(`LM Studio URL: ${this.getLmStudioUrl()}`);
    this.logger.log(
      `RAG Service URL: ${this.configService.get<string>('RAG_SERVICE_URL')}`,
    );
    try {
      await this.checkLmStudioAvailability();
    } catch (error) {
      this.logger.error(`LM Studio not available: ${error.message}`);
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
    // Format compatible avec DeepSeek
    return `<s>${context}

${userInput}</s>`;
  }

  /**
   * Génère une réponse à partir de l'entrée utilisateur en utilisant le service RAG et le modèle LLM local
   */
  async generateResponse(context: string, userInput: string): Promise<any> {
    this.logger.log(`Starting generateResponse with input: ${userInput}`);
    try {
      this.logger.log('Getting similar questions...');
      const similarQuestions = await this.getSimilarQuestions(userInput);

      this.logger.log(`Got ${similarQuestions?.length || 0} similar questions`);

      if (!similarQuestions || similarQuestions.length === 0) {
        this.logger.log('No similar questions found');
        return {
          question: userInput,
          answer: 'Pas de similarité trouvée',
          source: 'direct',
          allOptions: [],
          confidence: 0,
        };
      }

      // Préparer le prompt de sélection - sans le formatprompt qui ajoute un système assistant
      let optionsText = '';
      similarQuestions.forEach((option, index) => {
        optionsText += `${index + 1}) "${option.question}" (${(1 - option.distance).toFixed(2)})\n`;
      });

      const rawSelectionPrompt = `QUESTION POSÉE: "${userInput}"

QUESTIONS DISPONIBLES:
${optionsText}

RÈGLES:
1. Analysez la similarité sémantique entre la question posée et chaque option
2. Tenez compte du score de similarité indiqué entre parenthèses
3. Répondez UNIQUEMENT par un chiffre:
   - 1 à 5 pour sélectionner une option
   - 0 si aucune option n'est suffisamment similaire

VOTRE RÉPONSE (un seul chiffre):`;

      this.logger.log('Appel direct à LM Studio avec prompt de sélection');
      this.logger.log(`Raw prompt: ${rawSelectionPrompt}`);

      // Configuration LM Studio pour obtenir un seul chiffre
      const lmStudioConfig = {
        max_tokens: 2,
        temperature: 0.1,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0,
        stop: ['\n', ' ', ',', '.'],
      };

      try {
        const lmStudioUrl = this.getLmStudioUrl();

        const response = await axios.post(
          `${lmStudioUrl}/completions`,
          {
            prompt: rawSelectionPrompt,
            ...lmStudioConfig,
          },
          {
            timeout: 120000,
          },
        );

        this.logger.log(`LM Studio response: ${JSON.stringify(response.data)}`);

        const fullResponse = response.data.choices[0].text.trim();
        this.logger.log(`Raw selection response: "${fullResponse}"`);

        const match = fullResponse.match(/^[0-5]$/);
        this.logger.log(`Matched selection: ${match ? match[0] : 'no match'}`);

        // Trier les options par distance
        const sortedOptions = [...similarQuestions].sort(
          (a, b) => a.distance - b.distance,
        );
        const other2Query = sortedOptions
          .slice(0, 2)
          .map((opt) => opt.metadata.sql);

        if (!match || match[0] === '0') {
          this.logger.log('No sufficient match found');
          return {
            question: userInput,
            answer: 'pas de similarité',
            source: 'direct',
            allOptions: similarQuestions,
            confidence: 0,
            noQuery: 'pas de similarité',
            other2Query,
          };
        }

        const selectedIndex = parseInt(match[0], 10) - 1;
        if (selectedIndex < 0 || selectedIndex >= similarQuestions.length) {
          this.logger.log(`Selected index ${selectedIndex} is out of bounds`);
          return {
            question: userInput,
            answer: 'pas de similarité',
            source: 'direct',
            allOptions: similarQuestions,
            confidence: 0,
            noQuery: 'pas de similarité',
            other2Query,
          };
        }

        const selectedQuestion = similarQuestions[selectedIndex];
        this.logger.log(`Selected question: ${selectedQuestion.question}`);

        return {
          question: userInput,
          answer: `J'ai trouvé une correspondance : ${selectedQuestion.question}`,
          source: 'sql',
          selectedQuery: {
            sql: selectedQuestion.metadata.sql,
            description: selectedQuestion.metadata.description,
            parameters: selectedQuestion.metadata.parameters || [],
          },
          allOptions: similarQuestions,
          confidence: 1 - selectedQuestion.distance,
          querySelected: selectedQuestion.metadata.sql,
          other2Query: sortedOptions
            .filter((_, index) => index !== selectedIndex)
            .slice(0, 2)
            .map((opt) => opt.metadata.sql),
        };
      } catch (error) {
        this.logger.error(`Error in LM Studio selection: ${error.message}`);
        // En cas d'erreur, on revient à la sélection par distance
        const sortedOptions = [...similarQuestions].sort(
          (a, b) => a.distance - b.distance,
        );
        const bestOption = sortedOptions[0];
        const other2Query = sortedOptions
          .slice(1, 3)
          .map((opt) => opt.metadata.sql);

        this.logger.log(
          `Fallback to distance-based selection: ${bestOption.question}`,
        );

        return {
          question: userInput,
          answer: `J'ai trouvé une correspondance : ${bestOption.question}`,
          source: 'sql',
          selectedQuery: {
            sql: bestOption.metadata.sql,
            description: bestOption.metadata.description,
            parameters: bestOption.metadata.parameters || [],
          },
          allOptions: similarQuestions,
          confidence: 1 - bestOption.distance,
          querySelected: bestOption.metadata.sql,
          other2Query,
        };
      }
    } catch (error) {
      this.logger.error(`Error in generateResponse: ${error.message}`);
      throw error;
    }
  }

  private async selectBestMatch(
    userQuestion: string,
    options: RagQuestion[],
    selectionPrompt: string,
  ): Promise<any> {
    try {
      this.logger.log('Starting selectBestMatch process...');

      const formattedPrompt = this.formatPrompt(
        `Vous êtes un système de sélection automatique qui doit choisir la question la plus similaire.`,
        selectionPrompt,
      );

      const shortConfig = {
        ...this.modelConfig,
        max_tokens: 1,
        temperature: 0.1,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0,
        stop: ['\n', ' ', ',', '.'],
      };

      this.logger.log('Sending prompt to LM Studio:', formattedPrompt);
      const response = await axios.post(
        `${this.getLmStudioUrl()}/completions`,
        {
          prompt: formattedPrompt,
          ...shortConfig,
        },
        {
          timeout: 120000,
        },
      );

      this.logger.log('LM Studio response:', response.data);
      const fullResponse = response.data.choices[0].text.trim();
      this.logger.log('Parsed response:', fullResponse);
      const match = fullResponse.match(/^[0-5]$/);

      // Trier les options par distance
      const sortedOptions = [...options].sort(
        (a, b) => a.distance - b.distance,
      );
      const other2Query = sortedOptions
        .slice(0, 2)
        .map((opt) => opt.metadata.sql);

      if (!match || match[0] === '0') {
        return {
          noQuery: 'pas de similarité',
          other2Query,
        };
      }

      const selectedIndex = parseInt(match[0], 10) - 1;
      if (selectedIndex < 0 || selectedIndex >= options.length) {
        return {
          noQuery: 'pas de similarité',
          other2Query,
        };
      }

      return {
        querySelected: options[selectedIndex].metadata.sql,
        other2Query: sortedOptions
          .filter((_, index) => index !== selectedIndex)
          .slice(0, 2)
          .map((opt) => opt.metadata.sql),
      };
    } catch (error) {
      this.logger.error(`Error in selectBestMatch: ${error.message}`);
      return {
        noQuery: 'pas de similarité',
        other2Query: [],
      };
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
      this.logger.log(
        `Calling RAG service at ${ragServiceUrl}/rag/similar with question: ${question}`,
      );

      // Ajout de paramètres pour améliorer la recherche
      const response = await axios.post(`${ragServiceUrl}/rag/similar`, {
        question,
        nResults: 5,
        threshold: 0.3, // Seuil de similarité plus permissif
        collection: 'sql_queries', // Spécifier explicitement la collection
        includeMetadata: true, // S'assurer que les métadonnées sont incluses
      });

      if (!response.data || !Array.isArray(response.data)) {
        this.logger.error(
          'RAG service response is not in expected format',
          response.data,
        );
        return [];
      }

      const questions = response.data;
      this.logger.log(`Found ${questions.length} similar questions`);

      // Log détaillé de chaque question trouvée
      questions.forEach((q, index) => {
        this.logger.log(`Question ${index + 1}:
        - Question: ${q.question}
        - Distance: ${q.distance}
        - Description: ${q.metadata?.description}
        - SQL: ${q.metadata?.sql}`);
      });

      // Vérification de la validité des questions
      const validQuestions = questions.filter(
        (q) =>
          q.question &&
          q.metadata?.sql &&
          q.metadata?.description &&
          typeof q.distance === 'number',
      );

      if (validQuestions.length === 0) {
        this.logger.warn('No valid questions found in RAG response');
        return [];
      }

      if (validQuestions.length < questions.length) {
        this.logger.warn(
          `Filtered out ${questions.length - validQuestions.length} invalid questions`,
        );
      }

      return validQuestions;
    } catch (error) {
      this.logger.error(`Error getting similar questions: ${error.message}`);
      if (error.response) {
        this.logger.error(
          `Response data: ${JSON.stringify(error.response.data)}`,
        );
        this.logger.error(`Response status: ${error.response.status}`);
        this.logger.error(
          `Response headers: ${JSON.stringify(error.response.headers)}`,
        );
      }
      if (error.request) {
        this.logger.error('Request was made but no response received');
      }
      return [];
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
        {
          timeout: 120000, // Augmentation du timeout à 120 secondes
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
   * Génère une explication de la requête SQL sélectionnée
   */
  async explainSqlQuery(
    context: string,
    userQuestion: string,
    selectedQuery: RagResponse,
  ): Promise<string> {
    const formattedPrompt = this.formatPrompt(
      `Vous êtes un assistant spécialisé dans l'analyse de données pour une entreprise de bâtiment. Votre rôle est d'expliquer clairement les informations que nous pouvons obtenir à partir d'une requête SQL.`,
      `Question de l'utilisateur: "${userQuestion}"

La requête SQL suivante a été sélectionnée comme la plus pertinente:
- Description: ${selectedQuery.description}
- SQL: ${selectedQuery.sql}

Instructions pour la réponse:
1. Commencez par confirmer que cette requête est pertinente pour la question posée
2. Expliquez en termes simples quelles informations cette requête va chercher dans la base de données
3. Détaillez les différents éléments qui seront affichés (noms des projets, dates, clients, etc.)
4. Si la requête contient des filtres ou conditions (WHERE, HAVING, etc.), expliquez leur signification
5. Concluez en expliquant comment ces informations répondent à la question de l'utilisateur

Votre réponse doit être claire, concise et adaptée à un utilisateur qui n'est pas technique.
Utilisez un format structuré avec des puces ou des paragraphes courts pour une meilleure lisibilité.`,
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

  /**
   * Renvoie la question choisie ou indique l'absence de similarité
   */
  async getSelectedQuestionOrSimilarity(
    userQuestion: string,
    options: RagQuestion[],
  ): Promise<string> {
    const selectionPrompt = `QUESTION POSÉE: "${userQuestion}"

QUESTIONS DISPONIBLES:
${options.map((opt, i) => `${i + 1}) "${opt.question}" (${(1 - opt.distance).toFixed(2)})\n`).join('')}

RÈGLES:
1. Analysez la similarité sémantique entre la question posée et chaque option
2. Tenez compte du score de similarité indiqué entre parenthèses
3. Répondez UNIQUEMENT par un chiffre:
   - 1 à 5 pour sélectionner une option
   - 0 si aucune option n'est suffisamment similaire

VOTRE RÉPONSE (un seul chiffre):`;

    const bestMatch = await this.selectBestMatch(
      userQuestion,
      options,
      selectionPrompt,
    );

    if (!bestMatch) {
      return 'pas de similarité';
    }

    return bestMatch.question;
  }

  /**
   * Méthode publique pour la sélection de la meilleure correspondance (utilisée par le contrôleur)
   */
  async selectBestMatchPublic(
    userQuestion: string,
    options: RagQuestion[],
  ): Promise<RagResponse | null> {
    const selectionPrompt = `QUESTION POSÉE: "${userQuestion}"

QUESTIONS DISPONIBLES:
${options.map((opt, i) => `${i + 1}) "${opt.question}" (${(1 - opt.distance).toFixed(2)})\n`).join('')}

RÈGLES:
1. Analysez la similarité sémantique entre la question posée et chaque option
2. Tenez compte du score de similarité indiqué entre parenthèses
3. Répondez UNIQUEMENT par un chiffre:
   - 1 à 5 pour sélectionner une option
   - 0 si aucune option n'est suffisamment similaire

VOTRE RÉPONSE (un seul chiffre):`;

    return this.selectBestMatch(userQuestion, options, selectionPrompt);
  }

  /**
   * Appelle l'API LM Studio pour générer une réponse
   */
  private async callLmStudioApi(prompt: string): Promise<string> {
    try {
      const lmStudioUrl = this.getLmStudioUrl();
      this.logger.log(`Sending prompt to LM Studio:\n${prompt}`);

      const requestBody = {
        prompt,
        model: 'deepseek-r1-distill-llama-8b',
        ...this.modelConfig,
      };

      this.logger.log(
        `Request configuration: ${JSON.stringify(requestBody, null, 2)}`,
      );

      const response = await axios.post(
        `${lmStudioUrl}/completions`,
        requestBody,
        {
          timeout: 120000,
        },
      );

      this.logger.log(
        `LM Studio raw response: ${JSON.stringify(response.data, null, 2)}`,
      );

      const generatedText = response.data.choices[0].text || '';
      const cleanedText = generatedText.trim();

      this.logger.log(`Cleaned response text: "${cleanedText}"`);
      return cleanedText;
    } catch (error) {
      this.logger.error(`Error calling LM Studio API: ${error.message}`);
      throw error;
    }
  }
}
