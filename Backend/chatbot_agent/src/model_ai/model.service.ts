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
      const bestMatch = this.selectBestMatch(question, similarQuestions);
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

  private selectBestMatch(
    question: string,
    options: RagQuestion[],
  ): RagQuestion {
    try {
      this.logger.log(`Comparaison directe avec question: "${question}"`);

      // Normaliser la question de l'utilisateur
      const normalizedUserQuestion = question
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

      this.logger.log(`Question normalisée: "${normalizedUserQuestion}"`);

      // Filtrer les mots clés significatifs
      const keywords = this.extractSignificantKeywords(normalizedUserQuestion);
      this.logger.log(`Mots-clés extraits: ${keywords.join(', ')}`);

      // Comparer avec chaque option
      const scoredOptions = options.map((option) => {
        // Normaliser la question de l'option
        const normalizedOptionQuestion = option.question
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '');

        // Analyse de correspondance des mots-clés
        const matchScore = this.calculateKeywordMatchScore(
          keywords,
          normalizedOptionQuestion,
        );

        // Analyse de correspondance des dates/périodes
        const timeMatch = this.containsSameTimeReferences(
          normalizedUserQuestion,
          normalizedOptionQuestion,
        );
        const timeBonus = timeMatch ? 5 : 0;

        // Score final combiné
        const totalScore = matchScore + timeBonus - option.distance;

        this.logger.log(
          `Option "${option.question}" - Score: ${totalScore} (match: ${matchScore}, time: ${timeBonus}, distance: ${option.distance})`,
        );

        return {
          option,
          score: totalScore,
        };
      });

      // Trier par score
      scoredOptions.sort((a, b) => b.score - a.score);

      // Prendre la meilleure option
      const bestOption = scoredOptions[0].option;
      this.logger.log(
        `Meilleure option sélectionnée: "${bestOption.question}"`,
      );

      return bestOption;
    } catch (error) {
      this.logger.error(`Erreur lors de la sélection: ${error.message}`);
      // Fallback: trier par distance en cas d'erreur
      const sorted = [...options].sort((a, b) => a.distance - b.distance);
      return sorted[0];
    }
  }

  // Extraire les mots-clés significatifs de la question
  private extractSignificantKeywords(text: string): string[] {
    // Mots à ignorer (stopwords)
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
      'à',
      'au',
      'aux',
      'et',
      'ou',
      'que',
      'qui',
      'quoi',
      'comment',
      'quel',
      'quelle',
      'quels',
      'quelles',
      'ce',
      'cette',
      'ces',
      'mon',
      'ma',
      'mes',
      'ton',
      'ta',
      'tes',
      'son',
      'sa',
      'ses',
      'pour',
      'par',
      'avec',
      'sans',
      'dans',
      'sur',
      'sous',
      'entre',
      'vers',
      'chez',
      'est',
      'sont',
      'suis',
      'es',
      'sommes',
      'êtes',
      'être',
      'avoir',
      'ai',
      'as',
      'avons',
      'avez',
      'ont',
      'je',
      'tu',
      'il',
      'elle',
      'nous',
      'vous',
      'ils',
      'elles',
    ];

    // Mots particulièrement importants à mettre en valeur
    const importantWords = [
      'total',
      'cumul',
      'cumulé',
      'montant',
      'somme',
      'devis',
      'facture',
      'facturé',
      'tva',
      'ht',
      'ttc',
      'janvier',
      'fevrier',
      'mars',
      'avril',
      'mai',
      'juin',
      'juillet',
      'aout',
      'septembre',
      'octobre',
      'novembre',
      'decembre',
      '2023',
      '2024',
      '2025',
      '2026',
    ];

    // Découper en mots
    const words = text.split(/\s+/);

    // Filtrer et pondérer
    const keywords = words
      .filter((word) => word.length > 2 && !stopwords.includes(word))
      .map((word) => {
        // Donner plus d'importance aux mots clés
        if (importantWords.some((important) => word.includes(important))) {
          return word.trim();
        }
        return word.trim();
      });

    return keywords;
  }

  // Calcule un score de correspondance basé sur les mots-clés
  private calculateKeywordMatchScore(keywords: string[], text: string): number {
    let score = 0;

    for (const keyword of keywords) {
      if (text.includes(keyword)) {
        // Donner plus de poids aux mots significatifs
        if (
          [
            'total',
            'cumul',
            'cumulé',
            'montant',
            'somme',
            'tva',
            'ttc',
            'ht',
          ].includes(keyword)
        ) {
          score += 3;
        } else if (
          ['devis', 'facture', 'facturé', 'période'].includes(keyword)
        ) {
          score += 2;
        } else {
          score += 1;
        }
      }
    }

    return score;
  }

  // Vérifie si les deux textes contiennent les mêmes références temporelles
  private containsSameTimeReferences(text1: string, text2: string): boolean {
    // Vérifier les années
    const years = ['2023', '2024', '2025', '2026'];

    for (const year of years) {
      const hasYear1 = text1.includes(year);
      const hasYear2 = text2.includes(year);

      // Si les deux textes mentionnent la même année, c'est un bon match
      if (hasYear1 && hasYear2) {
        return true;
      }

      // Si un seul des textes mentionne une année mais pas l'autre, c'est un mauvais match
      if (
        (hasYear1 && !text2.includes('année')) ||
        (hasYear2 && !text1.includes('année'))
      ) {
        return false;
      }
    }

    // Vérifier les périodes
    const periods = [
      { words: ['jour', 'journée', 'aujourd'], type: 'day' },
      { words: ['semaine', 'hebdo'], type: 'week' },
      { words: ['mois', 'mensuel'], type: 'month' },
      { words: ['trimestre'], type: 'quarter' },
      { words: ['année', 'annuel'], type: 'year' },
    ];

    for (const period of periods) {
      const hasPeriod1 = period.words.some((word) => text1.includes(word));
      const hasPeriod2 = period.words.some((word) => text2.includes(word));

      if (hasPeriod1 && hasPeriod2) {
        return true;
      }
    }

    return false;
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
        const dataType = 'Empty';
        return `Je n'ai trouvé aucun résultat pour votre question "${userQuestion}".\n<!--dataType:${dataType}-->`;
      }

      // Détecter le type de données
      const dataType = this.detectDataType(data);

      // Prétraiter les données pour une meilleure lisibilité
      const processedData = this.preprocessData(data);

      // Préparer une version de données formatées pour l'affichage
      const formattedDataString = this.formatDataForDisplay(data);

      // Formater les données prétraitées pour le prompt
      const promptData = JSON.stringify(processedData, null, 2);

      // Préparer le prompt avec des instructions beaucoup plus précises et strictes
      const prompt = `
Tu es un assistant d'entreprise pour une société BTP. Tu dois répondre en français de manière directe, factuelle et concise.

Question : "${userQuestion}"

Données disponibles (${processedData.length} résultats) :
${promptData}

CONSIGNES STRICTES:
1. Tu dois analyser la question de l'utilisateur "${userQuestion}"
2. Tu dois répondre directement à la question en utilisant les données de ${promptData}
3. Ta réponse doit être naturelle et humaine, sans phrases d'introduction ou de conclusion
4. Cite toutes les informations contenues dans ${promptData} dans ta réponse
5. Ne fais aucune référence à ta réflexion interne ou aux instructions
6. Ne répète jamais la même information
7. N'utilise pas de formulations comme "il semble que", "d'après les données", etc.

Ta réponse DOIT commencer directement par le fait principal, sans phrase d'introduction.`;

      // Envoyer le prompt à LM Studio
      const response = await axios.post(
        `${this.getLmStudioUrl()}/completions`,
        {
          prompt,
          max_tokens: 1500,
          temperature: 1,
          top_p: 0.9,
          frequency_penalty: 0.3,
        },
        { timeout: 30000 },
      );

      // Extraire et nettoyer le paragraphe généré
      let generatedParagraph = response.data.choices[0].text.trim();
      generatedParagraph = this.cleanupResponse(generatedParagraph);

      // Combiner le paragraphe explicatif avec les données formatées
      const finalResponse = `${generatedParagraph}\n\n${formattedDataString}`;

      this.logger.log(`Generated response with explanation and formatted data`);

      // Ajouter un commentaire HTML invisible pour le type de données - TOUJOURS PRÉSENT
      const responseWithType = `${finalResponse}\n<!--dataType:${dataType}-->`;

      return responseWithType;
    } catch (error) {
      this.logger.error(`Error generating natural response: ${error.message}`);

      // Fallback simple avec les données formatées
      const formattedData = this.formatDataForDisplay(data);
      const dataType = this.detectDataType(data);
      // S'assurer que le dataType est toujours présent
      return `Voici les informations concernant votre demande sur ${description.toLowerCase()}:\n\n${formattedData}\n<!--dataType:${dataType}-->`;
    }
  }

  /**
   * Détecte le type de données basé sur les propriétés présentes
   */
  private detectDataType(data: any[]): string {
    if (!data || data.length === 0) return 'Unknown';

    const sample = data[0];
    const keys = Object.keys(sample);

    // Détection basée sur les clés présentes
    if (keys.includes('invoice_count') || keys.includes('total_tva')) {
      return 'Invoice_Summary';
    }

    if (
      keys.includes('issue_date') &&
      keys.includes('due_date') &&
      keys.includes('total_ttc')
    ) {
      if (keys.includes('status') && sample.status === 'Devis') {
        return 'Quotation';
      }
      return 'Invoice';
    }

    if (
      keys.includes('name') &&
      keys.includes('start_date') &&
      keys.includes('client_name')
    ) {
      return 'Project';
    }

    if (keys.includes('days_worked') || keys.includes('total_hours')) {
      return 'Planning';
    }

    if (
      keys.includes('firstname') &&
      keys.includes('lastname') &&
      keys.includes('role')
    ) {
      return 'Staff';
    }

    if (keys.includes('payment_rate')) {
      return 'Finance';
    }

    // Détection des clients (tous les clients sont juste "Customer" même avec projets)
    if (
      keys.includes('firstname') &&
      keys.includes('lastname') &&
      keys.includes('email')
    ) {
      return 'Customer';
    }

    // Détection des projets actifs pour les clients
    if (keys.some((key) => key.includes('project'))) {
      return 'Customer';
    }

    return 'Generic';
  }

  /**
   * Formatage des données pour l'affichage
   */
  private formatDataForDisplay(data: any[]): string {
    if (!data || data.length === 0) return '';

    let result = '';

    // Formatter chaque élément
    data.forEach((item, index) => {
      result += `${index + 1}. `;

      // Obtenir les propriétés triées, avec priorité à certaines propriétés importantes
      const priorityKeys = [
        'reference',
        'name',
        'client_name',
        'issue_date',
        'due_date',
        'total_ttc',
        'status',
      ];
      const otherKeys = Object.keys(item).filter(
        (key) => !priorityKeys.includes(key),
      );
      const sortedKeys = [
        ...priorityKeys.filter((key) => item[key] !== undefined),
        ...otherKeys,
      ];

      const formattedProperties = sortedKeys.map((key) => {
        let value = item[key];

        // Formatter les dates
        if (typeof value === 'string' && value.match(/^\d{4}-\d{2}-\d{2}/)) {
          const dateObj = new Date(value);
          // Vérifier si la date est valide avant de la formater
          if (!isNaN(dateObj.getTime())) {
            value = dateObj.toLocaleDateString('fr-FR');
          }
        }

        // Formatter les montants
        if (
          typeof value === 'string' &&
          (key.includes('total') ||
            key.includes('amount') ||
            key.includes('prix')) &&
          !isNaN(parseFloat(value))
        ) {
          const numVal = parseFloat(value);
          value =
            numVal.toLocaleString('fr-FR', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            }) + ' €';
        }

        const displayKey = key.replace(/_/g, ' ');
        // S'assurer que la valeur est correctement convertie en chaîne
        let displayValue: string;
        if (value === null) {
          displayValue = 'Non défini';
        } else if (typeof value === 'object') {
          try {
            displayValue = JSON.stringify(value);
          } catch {
            displayValue = '[Objet complexe]';
          }
        } else {
          displayValue = String(value);
        }
        return `${displayKey}: ${displayValue}`;
      });

      result += formattedProperties.join(' | ') + '\n';
    });

    return result;
  }

  /**
   * Prétraitement des données pour améliorer la qualité des réponses
   */
  private preprocessData(data: any[]): any[] {
    return data.map((item) => {
      const processed = { ...item };

      // Formater les dates
      for (const [key, value] of Object.entries(processed)) {
        if (typeof value === 'string' && value.match(/^\d{4}-\d{2}-\d{2}/)) {
          const dateObj = new Date(value);
          // Vérifier si la date est valide avant de la formater
          if (!isNaN(dateObj.getTime())) {
            processed[key] = dateObj.toLocaleDateString('fr-FR');
          }
        }
      }

      return processed;
    });
  }

  /**
   * Nettoie la réponse de tout contenu non désiré
   */
  private cleanupResponse(response: string): string {
    // Vérifier si la réponse est un JSON brut
    const isJsonLike = /^\s*[{[]/.test(response);
    if (isJsonLike) {
      return ''; // Renvoyer une chaîne vide pour forcer la génération d'un résumé côté frontend
    }

    // Enlever d'abord les guillemets qui entourent toute la réponse
    let cleaned = response.replace(/^"(.*)"$/s, '$1');
    
    // Supprimer les doublons de phrases - étape 1: normaliser
    const sentences = cleaned.split(/[.!?]\s+/).filter((s) => s.length > 0);
    const uniqueSentences = [...new Set(sentences)];
    cleaned = uniqueSentences.join('. ') + (cleaned.endsWith('.') ? '' : '.');
    
    // Liste des patterns à supprimer
    const patternsToRemove = [
      // Métadiscours et réflexions
      /Sois respectueux.*\./gi,
      /Je dois donc structurer.*\./gi,
      /Bon, maintenant je dois.*\./gi,
      /Je vais donc afficher.*\./gi,
      /D'après les données.*\./gi,
      /Donc je vais lister.*\./gi,
      /Ensuite j'ai à conclure.*\./gi,
      /^(D'accord|OK|Bien|Je comprends),.*$/gim,
      // Phrases d'analyse et de réflexion
      /Donc, si chaque client.*$/gim,
      /^Peut-être que les données.*$/gim,
      /^Par exemple,.*$/gim,
      /^Si cela est le cas.*$/gim,
      /^Aucun client ne peut.*$/gim,
      /^Assure-toi que.*$/gim,
      /^Cela semble bizarre.*$/gim,
      // Instructions et méta-commentaires
      /^Tout d'abord,.*$/gim,
      /^Ensuite,.*$/gim,
      /^Enfin,.*$/gim,
      /^Incluez.*$/gim,
      /^Pour répondre à.*$/gim,
      /^Il faut mentionner.*$/gim,
      /^Voici.*$/gim,
      /^Donc, d'après.*$/gim,
      /^Après analyse.*$/gim,
      /^Ci-dessous.*$/gim,
      /^Pourriez-vous me fournir.*$/gim,
      // Balises et styles
      /<think>[\s\S]*?<\/think>/gi,
      /\[.*?\]/g,
      /\*\*(.*?)\*\*/g,
      // Préfixes et suffixes
      /^(Réponse|RÉPONSE)\s*:/i,
      /Taquin,.*$/gm,
      /le \d+ \w+ 2\d{3}/g,
      // Phrases de réflexion en anglais et français
      /Okay,.*$/g,
      /^.*\b(think|First|Let|Ok|question|Looking|The|This)\b.*$/gim,
      /^Je me demande.*$/gim,
      /^Je me souviens.*$/gim,
      /^Je vous (explique|informe).*$/gim,
      // Structure de données et émojis
      /^\d+\.\s+id:.*\|.*$/gim,
      /^Posez votre question\.\.\.$/gim,
      /^Envoyer.*$/gim,
      // Phrases coupées ou incomplètes
      /^Il semble que plusieurs clients.*$/gim,
      /^En fonction des.*$/gim,
      // Emojis et champs spéciaux
      /^👥.*$/gim,
      /^📧.*$/gim,
      /^📞.*$/gim,
      /^ID:.*$/gim,
      /^Clients$/gim,
      /^\d+ résultats$/gim,
    ];

    // Appliquer tous les patterns de nettoyage
    patternsToRemove.forEach((pattern) => {
      cleaned = cleaned.replace(pattern, '');
    });

    // Nettoyer les phrases de type analytique
    const phrasesToClean = [
      /Il y a \d+ (résultats?|données?).*$/gim,
      /C'est une.*$/gim,
      /Comme tous les clients.*$/gim,
      /Comme aucun client.*$/gim,
      /Il semble que tous les clients.*$/gim,
      /Il semble que les.*$/gim,
      /Si vous souhaitez identifier.*$/gim,
      /Voici quelques exemples.*$/gim,
      /Voici quelques noms d'exemple.*$/gim,
    ];

    phrasesToClean.forEach((pattern) => {
      cleaned = cleaned.replace(pattern, '');
    });

    // Supprimer les répétitions
    cleaned = cleaned.replace(/(.*?)\. \1\.?/gi, '$1.');

    // Supprimer les lignes vides multiples et nettoyer
    cleaned = cleaned.replace(/\n{2,}/g, '\n');
    cleaned = cleaned.replace(/^[\s\-_*]+$/gm, '');
    cleaned = cleaned.replace(/^(👥|📧|📞)$/gmu, '');
    cleaned = cleaned.replace(/^ID:.*$/gim, '');

    // Mettre en forme les nombres dans le texte
    cleaned = cleaned.replace(/(\d+)(\d{3})/g, '$1 $2');

    // Préserver les commentaires HTML invisibles de dataType
    const dataTypeMatch = response.match(/<!--dataType:(.*?)-->/);
    if (dataTypeMatch) {
      cleaned = `${cleaned.trim()}\n<!--dataType:${dataTypeMatch[1]}-->`;
    }

    return cleaned.trim();
  }
}
