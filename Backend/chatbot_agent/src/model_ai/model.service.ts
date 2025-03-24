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
    this.logger.log(`RAG Service URL: ${this.configService.get<string>('RAG_SERVICE_URL')}`);
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
  async generateResponse(context: string, userInput: string): Promise<string> {
    this.logger.log(`Starting generateResponse with input: ${userInput}`);
    try {
      this.logger.log('Getting similar questions...');
      const similarQuestions = await this.getSimilarQuestions(userInput);

      this.logger.log(`Got ${similarQuestions?.length || 0} similar questions`);
      
      if (!similarQuestions || similarQuestions.length === 0) {
        this.logger.log('No similar questions found, generating direct response');
        return await this.generateDirectResponse(context, userInput);
      }

      this.logger.log('Selecting best match...');
      const bestMatch = await this.selectBestMatch(userInput, similarQuestions);

      if (!bestMatch) {
        this.logger.log('No best match found, generating direct response');
        return await this.generateDirectResponse(context, userInput);
      }

      this.logger.log(`Best match found: ${JSON.stringify(bestMatch)}`);
      return await this.explainSqlQuery(context, userInput, bestMatch);
    } catch (error) {
      this.logger.error(`Error in generateResponse: ${error.message}`);
      throw error;
    }
  }

  /**
   * Appelle l'API LM Studio pour générer une réponse
   */
  private async callLmStudioApi(prompt: string): Promise<string> {
    try {
      const lmStudioUrl = this.getLmStudioUrl();
      const response = await axios.post(
        `${lmStudioUrl}/completions`,
        {
          prompt,
          model: 'deepseek-r1-distill-llama-8b',
          ...this.modelConfig,
        },
        {
          timeout: 120000, // Augmentation du timeout à 120 secondes
        },
      );

      // Extraire et retourner le texte généré sans les balises de fin
      const generatedText = response.data.choices[0].text || '';

      // Nettoyer la sortie
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
      const ragServiceUrl = this.configService.get<string>('RAG_SERVICE_URL') || 'http://localhost:3002';
      this.logger.log(`Calling RAG service at ${ragServiceUrl}/rag/similar with question: ${question}`);
      
      // Ajout de paramètres pour améliorer la recherche
      const response = await axios.post(`${ragServiceUrl}/rag/similar`, {
        question,
        nResults: 5,
        threshold: 0.3, // Seuil de similarité plus permissif
        collection: 'sql_queries', // Spécifier explicitement la collection
        includeMetadata: true // S'assurer que les métadonnées sont incluses
      });

      if (!response.data || !Array.isArray(response.data)) {
        this.logger.error('RAG service response is not in expected format', response.data);
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
      const validQuestions = questions.filter(q => 
        q.question && 
        q.metadata?.sql && 
        q.metadata?.description &&
        typeof q.distance === 'number'
      );

      if (validQuestions.length === 0) {
        this.logger.warn('No valid questions found in RAG response');
        return [];
      }

      if (validQuestions.length < questions.length) {
        this.logger.warn(`Filtered out ${questions.length - validQuestions.length} invalid questions`);
      }

      return validQuestions;
    } catch (error) {
      this.logger.error(`Error getting similar questions: ${error.message}`);
      if (error.response) {
        this.logger.error(`Response data: ${JSON.stringify(error.response.data)}`);
        this.logger.error(`Response status: ${error.response.status}`);
        this.logger.error(`Response headers: ${JSON.stringify(error.response.headers)}`);
      }
      if (error.request) {
        this.logger.error('Request was made but no response received');
      }
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
      let optionsText = '';
      options.forEach((option, index) => {
        optionsText += `Option ${index + 1}:
- Question originale: ${option.question}
- Description: ${option.metadata.description}
- SQL: ${option.metadata.sql}
- Score de similarité: ${(1 - option.distance).toFixed(2)}

`;
      });

      const formattedPrompt = this.formatPrompt(
        `Vous êtes un expert en analyse sémantique et en SQL. Votre tâche est d'évaluer si une des questions proposées correspond suffisamment à la question de l'utilisateur pour être utilisée.`,
        `Question de l'utilisateur: "${userQuestion}"

Voici 5 questions existantes avec leurs requêtes SQL associées:
${optionsText}

Processus d'analyse à suivre:
1. Analysez l'intention principale de la question de l'utilisateur
2. Pour chaque option:
   - Comparez l'intention sémantique avec la question de l'utilisateur
   - Vérifiez si la requête SQL associée permettrait de répondre à la question
   - Tenez compte du score de similarité (plus il est proche de 1, plus c'est similaire)
3. Une option est considérée comme valide si:
   - Elle capture la même intention que la question de l'utilisateur
   - La requête SQL permet effectivement d'obtenir les informations demandées
   - Le score de similarité est suffisamment élevé (> 0.5)

Répondez UNIQUEMENT avec:
- Le numéro de l'option la plus pertinente (1-5) si une correspondance valide est trouvée
- "0" si aucune option ne correspond suffisamment à la question

Votre réponse (juste un chiffre):`,
      );

      const shortConfig = {
        ...this.modelConfig,
        max_tokens: 10,
        temperature: 0.1, // Réduction de la température pour une réponse plus déterministe
      };

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

      const fullResponse = response.data.choices[0].text || '';
      const match = fullResponse.match(/\d+/);

      if (!match || match[0] === '0') {
        this.logger.log('Aucune correspondance suffisante trouvée');
        return null;
      }

      const selectedIndex = parseInt(match[0], 10) - 1;
      if (selectedIndex < 0 || selectedIndex >= options.length) {
        this.logger.log('Index sélectionné hors limites');
        return null;
      }

      const selected = options[selectedIndex];
      
      // Vérification supplémentaire du score de similarité
      if (selected.distance > 0.5) {
        this.logger.log('Score de similarité trop faible');
        return null;
      }

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
    const bestMatch = await this.selectBestMatch(userQuestion, options);
    
    if (!bestMatch) {
      return 'pas de similarité';
    }
    
    return bestMatch.question;
  }
}
