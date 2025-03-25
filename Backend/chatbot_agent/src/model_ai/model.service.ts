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
        return `Je n'ai trouvé aucun résultat pour votre question "${userQuestion}".`;
      }

      // Prétraiter les données pour une meilleure lisibilité
      const processedData = this.preprocessData(data);

      // Préparer une version de données formatées pour l'affichage
      const formattedDataString = this.formatDataForDisplay(data);

      // Formater les données prétraitées pour le prompt
      const promptData = JSON.stringify(processedData, null, 2);

      // Préparer le prompt pour le LLM avec un ton conversationnel
      const prompt = `
Tu es un assistant d'entreprise conversationnel et amical pour une entreprise du secteur BTP. Réponds en français.

Question de l'utilisateur: "${userQuestion}"

Description des données: "${description}"

Données disponibles (${processedData.length} résultats):
${promptData}

INSTRUCTIONS:
1. Écris UN SEUL paragraphe conversationnel qui explique les données ci-dessus de manière claire et concise
2. Utilise un ton amical et naturel, comme si tu parlais à un collègue
3. Ne commence pas par "Voici les résultats" ou "J'ai trouvé"
4. Mentionne les informations les plus pertinentes et les tendances notables
5. N'oublie pas de mentionner le nombre total d'éléments trouvés
6. Format les montants avec des espaces pour séparer les milliers (ex: 10 000 €)
7. NE liste PAS les éléments individuels, fais juste un résumé global
8. NE fais PAS de liste à puces ou de présentation formelle
9. Limite-toi à un paragraphe d'environ 3-5 phrases maximum
10. N'utilise PAS de terme technique comme "requête SQL", "données" ou "résultats"
11. Ne mentionne PAS ton processus d'analyse ou ta réflexion, donne directement la réponse finale
12. Évite les phrases comme "je dois maintenant analyser" ou "structure du message"
13. Reste concis et ne tronque pas ta réponse finale

Ton paragraphe explicatif (pas plus de 5 phrases):`;

      // Envoyer le prompt à LM Studio
      const response = await axios.post(
        `${this.getLmStudioUrl()}/completions`,
        {
          prompt,
          max_tokens: 500,
          temperature: 0.7, // Plus élevé pour un ton plus naturel
          top_p: 0.9,
          frequency_penalty: 0.3,
        },
        { timeout: 30000 },
      );

      // Extraire et nettoyer le paragraphe généré
      let generatedParagraph = response.data.choices[0].text.trim();
      generatedParagraph = this.cleanupResponse(generatedParagraph);

      // Vérifier si le paragraphe contient des traces d'instructions ou d'analyse
      if (
        generatedParagraph.includes('analyse') ||
        generatedParagraph.includes('structure') ||
        generatedParagraph.includes('Je dois') ||
        generatedParagraph.includes('maintenant')
      ) {
        // Si oui, utiliser la réponse de secours
        generatedParagraph = this.generateSummaryFromData(
          data,
          userQuestion,
          description,
        );
      }

      // Combiner le paragraphe explicatif avec les données formatées
      const finalResponse = `${generatedParagraph}\n\n${formattedDataString}`;

      this.logger.log(`Generated response with explanation and formatted data`);
      return finalResponse;
    } catch (error) {
      this.logger.error(`Error generating natural response: ${error.message}`);

      // Fallback simple avec les données formatées
      const formattedData = this.formatDataForDisplay(data);
      return `Voici les informations concernant votre demande sur ${description.toLowerCase()}:\n\n${formattedData}`;
    }
  }

  /**
   * Génère un résumé structuré à partir des données
   */
  private generateSummaryFromData(
    data: any[],
    question: string,
    description: string,
  ): string {
    try {
      // Détecter si ce sont des données de TVA/factures ou de chantiers
      const isTvaData = data.length > 0 && data[0].month_name !== undefined;
      const isProjectData =
        data.length > 0 &&
        data[0].name !== undefined &&
        data[0].start_date !== undefined;

      // Cas des données de TVA par mois
      if (isTvaData) {
        // Filtrer les données pour 2025
        const data2025 = data.filter(
          (item) => item.month_name && item.month_name.includes('2025'),
        );

        // Calculer le total pour 2025
        let totalAmount = 0;
        let totalCount = 0;

        if (data2025.length > 0) {
          data2025.forEach((item) => {
            totalAmount += parseFloat(item.total_tva || '0');
            totalCount += parseInt(item.invoice_count || '0', 10);
          });
        }

        // Construire la réponse
        let summary = '';

        if (question.toLowerCase().includes('2025')) {
          summary = `Pour l'année 2025, le montant cumulé de TVA s'élève à ${totalAmount.toLocaleString(
            'fr-FR',
            {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            },
          )} € réparti sur ${totalCount} factures. `;
        } else {
          summary = `Sur les 12 derniers mois, nous avons enregistré ${data.length} périodes avec un total de TVA variable selon ${description}. `;
        }

        // Ajouter des détails sur le mois le plus important
        const maxMonth = [...data].sort(
          (a, b) =>
            parseFloat(b.total_tva || '0') - parseFloat(a.total_tva || '0'),
        )[0];

        if (maxMonth) {
          summary += `${maxMonth.month_name.trim()} est la période la plus importante avec ${parseFloat(
            maxMonth.total_tva,
          ).toLocaleString('fr-FR', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })} € de TVA sur ${maxMonth.invoice_count} facture(s). `;
        }

        // Mentionner les anomalies si présentes
        const negativeMonths = data.filter(
          (item) => parseFloat(item.total_tva || '0') < 0,
        );
        if (negativeMonths.length > 0) {
          summary += `Attention, ${negativeMonths.length} mois présente(nt) des montants négatifs, notamment ${negativeMonths[0].month_name.trim()} avec ${parseFloat(
            negativeMonths[0].total_tva,
          ).toLocaleString('fr-FR', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })} €.`;
        }

        return summary.trim();
      }
      // Cas des données de chantiers/projets
      else if (isProjectData) {
        // Formatage des dates
        const formattedProjects = data.map((project) => {
          const date = new Date(project.start_date);
          return {
            ...project,
            formatted_date: date.toLocaleDateString('fr-FR'),
          };
        });

        // Construire la réponse
        let summary = '';

        // Résumé du nombre et période
        if (question.toLowerCase().includes('mois')) {
          const currentMonth = new Date().toLocaleString('fr-FR', {
            month: 'long',
          });
          summary = `Ce mois de ${currentMonth}, ${data.length} chantier${data.length > 1 ? 's' : ''} ${data.length > 1 ? 'sont prévus' : 'est prévu'} selon ${description}. `;
        } else {
          summary = `Actuellement, ${data.length} projet${data.length > 1 ? 's sont planifiés' : ' est planifié'} selon ${description}. `;
        }

        // Ajouter les noms des projets si peu nombreux
        if (data.length <= 3) {
          const projectNames = formattedProjects.map((p) => p.name);
          summary += `Il s'agit de ${projectNames.join(', ')}. `;
        }

        // Ajouter la ville si tous les projets sont dans la même ville
        const cities = [
          ...new Set(
            formattedProjects.filter((p) => p.city).map((p) => p.city),
          ),
        ];
        if (cities.length === 1) {
          summary += `Tous ces chantiers sont situés à ${cities[0]}. `;
        }

        return summary.trim();
      }
      // Cas par défaut
      else {
        return `Nous avons trouvé ${data.length} résultat(s) concernant ${description.toLowerCase()}.`;
      }
    } catch (error) {
      this.logger.error(`Error in generateSummaryFromData: ${error.message}`);
      return `Les données montrent un total de ${data.length} résultat(s) concernant ${description.toLowerCase()}.`;
    }
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
    // Supprimer les balises de formatation ou de pensée
    let cleaned = response
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/^[\s-_*]+|[\s-_*]+$/gm, '')
      .replace(/^(Réponse|RÉPONSE)\s*:/i, '')
      .replace(/^"(.+)"$/s, '$1'); // Supprimer les guillemets englobants

    // Supprimer les lignes vides multiples
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

    // Mettre en forme les nombres dans le texte
    cleaned = cleaned.replace(/(\d+)(\d{3})/g, '$1 $2');

    return cleaned.trim();
  }
}
