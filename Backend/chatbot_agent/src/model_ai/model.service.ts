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
      this.logger.log(
        'Sélection de la meilleure question via LM Studio et distance vectorielle',
      );

      // 1. Utiliser d'abord l'approche LLM - LM Studio
      const prompt = this.prepareSelectionPrompt(question, options);

      // Envoyer le prompt à LM Studio
      const response = await axios.post(
        `${this.getLmStudioUrl()}/completions`,
        {
          prompt,
          max_tokens: 10,
          temperature: 0.0,
          top_p: 1.0,
        },
        { timeout: 30000 },
      );

      // Extraire la réponse
      const fullResponse = response.data.choices[0].text.trim();
      this.logger.log(`LM Studio response: "${fullResponse}"`);

      // Extraire l'index choisi par le LLM
      const match = fullResponse.match(/\d+/);
      const llmIndex = match ? parseInt(match[0], 10) - 1 : -1;

      // Vérifier que l'index est valide
      if (llmIndex >= 0 && llmIndex < options.length) {
        this.logger.log(
          `LLM a sélectionné l'option ${llmIndex + 1}: "${options[llmIndex].question}"`,
        );

        // Vérifier si les mots-clés temporels (mois, semaine, etc.) correspondent
        if (this.keywordMatch(question, options[llmIndex].question)) {
          this.logger.log(
            'Mots-clés temporels correspondants, sélection LLM validée',
          );
          return options[llmIndex];
        } else {
          this.logger.log(
            "Mots-clés temporels différents, passage à l'analyse secondaire",
          );
        }
      }

      // 2. Approche par recherche de mots-clés thématiques
      const matchedByKeywords = this.findBestMatchByKeywords(question, options);
      if (matchedByKeywords) {
        this.logger.log(
          `Sélection par mots-clés: "${matchedByKeywords.question}"`,
        );
        return matchedByKeywords;
      }

      // 3. Fallback: trier par distance vectorielle (meilleur score de similarité)
      this.logger.log('Fallback: sélection par distance vectorielle');
      const sortedByDistance = [...options].sort(
        (a, b) => a.distance - b.distance,
      );
      return sortedByDistance[0];
    } catch (error) {
      this.logger.error(`Erreur lors de la sélection: ${error.message}`);
      // Fallback: trier par distance en cas d'erreur
      const sorted = [...options].sort((a, b) => a.distance - b.distance);
      return sorted[0];
    }
  }

  // Vérifier si des mots-clés temporels correspondent entre la question et l'option
  private keywordMatch(question: string, option: string): boolean {
    // Normaliser les deux textes
    const normalizedQuestion = question
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    const normalizedOption = option
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    // Détecter automatiquement les mots-clés temporels dans les questions
    const timePatterns = [
      { regex: /\b(aujourd[''']?hui|ce jour|journee|ajd)\b/, period: 'day' },
      { regex: /\b(demain)\b/, period: 'tomorrow' },
      { regex: /\b(hier)\b/, period: 'yesterday' },
      { regex: /\b(semaine|hebdo|7 jours|sept jours)\b/, period: 'week' },
      {
        regex: /\b(mois|mensuel|30 jours|trente jours|ce mois)\b/,
        period: 'month',
      },
      {
        regex: /\b(annee|an|annuel|12 mois|douze mois|cette annee)\b/,
        period: 'year',
      },
      { regex: /\b(trimestre|3 mois|trois mois)\b/, period: 'quarter' },
      { regex: /\b(semestre|6 mois|six mois)\b/, period: 'semester' },
    ];

    // Détecter les périodes mentionnées dans chaque texte
    const questionPeriods = new Set(
      timePatterns
        .filter((pattern) => pattern.regex.test(normalizedQuestion))
        .map((pattern) => pattern.period),
    );

    const optionPeriods = new Set(
      timePatterns
        .filter((pattern) => pattern.regex.test(normalizedOption))
        .map((pattern) => pattern.period),
    );

    // Si aucune période n'est mentionnée dans les deux, on ne peut pas juger
    if (questionPeriods.size === 0 && optionPeriods.size === 0) {
      return true;
    }

    // Vérifier l'intersection des périodes
    let hasCommonPeriod = false;
    questionPeriods.forEach((period) => {
      if (optionPeriods.has(period)) {
        hasCommonPeriod = true;
      }
    });

    // S'il y a au moins une période commune, c'est un bon match
    if (hasCommonPeriod) {
      return true;
    }

    // Si les deux mentionnent des périodes mais aucune en commun, c'est un mauvais match
    if (questionPeriods.size > 0 && optionPeriods.size > 0) {
      return false;
    }

    // Cas par défaut: une seule mentionne une période, on ne peut pas être certain
    return true;
  }

  // Trouver la meilleure correspondance par mots-clés thématiques
  private findBestMatchByKeywords(
    question: string,
    options: RagQuestion[],
  ): RagQuestion | null {
    // Normaliser la question
    const normalizedQuestion = question
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    // Extraire les mots-clés importants (enlever les mots communs)
    const keywords = this.extractKeywords(normalizedQuestion);

    // Évaluer chaque option
    let bestScore = 0;
    let bestMatch: RagQuestion | null = null;

    for (const option of options) {
      const normalizedOption = option.question
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      let score = 0;

      // Compter combien de mots-clés correspondent
      for (const keyword of keywords) {
        if (normalizedOption.includes(keyword)) {
          score += 1;
        }
      }

      // Bonus pour les mots-clés temporels correspondants
      if (this.keywordMatch(normalizedQuestion, normalizedOption)) {
        score += 2;
      }

      // Si c'est un meilleur score, mettre à jour
      if (score > bestScore) {
        bestScore = score;
        bestMatch = option;
      }
    }

    return bestMatch;
  }

  // Extraire les mots-clés importants d'une question
  private extractKeywords(text: string): string[] {
    // Mots communs à ignorer
    const stopwords = [
      'le',
      'la',
      'les',
      'un',
      'une',
      'des',
      'du',
      'de',
      'a',
      'est',
      'sont',
      'et',
      'ou',
      'que',
      'qui',
      'quoi',
      'comment',
      'quel',
      'quelle',
    ];

    // Découper le texte en mots
    const words = text.split(/\s+/);

    // Filtrer les mots communs et courts
    return words.filter((word) => word.length > 2 && !stopwords.includes(word));
  }

  private prepareSelectionPrompt(
    question: string,
    options: RagQuestion[],
  ): string {
    // Générer le texte des options avec leur description complète
    let optionsText = '';
    options.forEach((option, index) => {
      optionsText += `Option ${index + 1}:
- QUESTION: "${option.question}"
- DESCRIPTION: "${option.metadata.description}"
- SCORE DE SIMILARITÉ: ${(1 - option.distance).toFixed(2)}
`;
    });

    return `Tu es un assistant SQL spécialisé qui aide à comprendre les intentions des utilisateurs.

QUESTION DE L'UTILISATEUR: "${question}"

TÂCHE:
Analyse attentivement la question de l'utilisateur et détermine quelle option répond le mieux à son besoin réel.

OPTIONS DISPONIBLES:
${optionsText}

INSTRUCTIONS DÉTAILLÉES:
1. Analyse la sémantique et l'intention réelle de la question de l'utilisateur
2. Identifie les concepts clés (dates, périodes, entités) mentionnés dans la question
3. Compare ces concepts avec chaque option (question ET description)
4. Accorde plus d'importance à la compréhension de l'intention qu'au score de similarité
5. Prête attention particulière aux éléments temporels (aujourd'hui, demain, semaine, mois)

RÉPONSE:
Réponds uniquement par le numéro de l'option choisie (1, 2, 3, etc.) sans aucune explication ni justification.`;
  }

  async generateNaturalResponse(
    description: string,
    data: any[],
    userQuestion: string,
  ): Promise<string> {
    this.logger.log(
      `Generating natural language response for query: "${userQuestion}"`,
    );

    try {
      if (!data || data.length === 0) {
        return `Je n'ai trouvé aucun résultat pour votre question "${userQuestion}".`;
      }

      // Formater les données pour le prompt
      const formattedData = JSON.stringify(data, null, 2);

      // Préparer le prompt pour LM Studio
      const prompt = `
Tu es un assistant d'entreprise spécialisé dans la construction et le BTP. Tu dois répondre en français à une question d'un utilisateur en te basant sur des données SQL.

Question de l'utilisateur: "${userQuestion}"

Description de la requête SQL: "${description}"

Résultats de la requête SQL (${data.length} résultats):
${formattedData}

En tant qu'assistant, génère une réponse concise mais complète qui:
1. Commence par une phrase d'introduction qui répond directement à la question
2. Présente les informations importantes des résultats de manière claire et organisée
3. Si pertinent, fournis un résumé ou une analyse des données (tendances, points importants)
4. Utilise un ton professionnel mais conversationnel
5. Ne mentionne pas que tu utilises des "données SQL" ou des "résultats de requête" dans ta réponse

Ta réponse:`;

      // Envoyer le prompt à LM Studio
      const response = await axios.post(
        `${this.getLmStudioUrl()}/completions`,
        {
          prompt,
          max_tokens: 1000,
          temperature: 0.7,
          top_p: 0.95,
        },
        { timeout: 60000 },
      );

      // Extraire et retourner la réponse générée
      const generatedResponse = response.data.choices[0].text.trim();
      this.logger.log(
        `Generated natural response of length: ${generatedResponse.length}`,
      );

      return generatedResponse;
    } catch (error) {
      this.logger.error(`Error generating natural response: ${error.message}`);

      // Fallback à une réponse simple en cas d'erreur
      return `J'ai trouvé ${data.length} résultat(s) pour votre recherche sur "${description.toLowerCase()}".`;
    }
  }
}
