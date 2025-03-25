import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ChromaClient, Collection, GetCollectionParams } from 'chromadb';
import { Question, SimilarQuestion } from '../interfaces/question.interface';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class ChromaService implements OnModuleInit {
  private readonly logger = new Logger(ChromaService.name);
  private client: ChromaClient;
  private collection: Collection | undefined;
  private readonly COLLECTION_NAME = 'questions_collection';
  private readonly embeddingFunction = {
    generate: (texts: string[]): Promise<number[][]> => {
      // Utiliser une fonction déterministe pour générer des embeddings
      // basés sur le contenu du texte
      return Promise.resolve(
        texts.map((text) => this.generateDeterministicEmbedding(text)),
      );
    },
  };

  constructor(private configService: ConfigService) {
    const chromaUrl =
      this.configService.get<string>('CHROMA_URL') || 'http://ChromaDB:8000';
    this.logger.log(`Connexion à ChromaDB sur : ${chromaUrl}`);
    this.client = new ChromaClient({
      path: chromaUrl,
    });
  }

  /**
   * Génère un embedding déterministe pour un texte donné
   * Ceci assure que le même texte produit toujours le même vecteur
   */
  private generateDeterministicEmbedding(text: string): number[] {
    // Normaliser le texte pour une meilleure cohérence
    const normalizedText = text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    // Créer un hash SHA-256 du texte
    const hash = crypto
      .createHash('sha256')
      .update(normalizedText)
      .digest('hex');

    // Convertir le hash en un vecteur de 1536 dimensions (taille standard)
    const vector = new Array(1536).fill(0);

    // Remplir le vecteur avec des valeurs dérivées du hash
    for (let i = 0; i < 1536; i++) {
      // Utiliser des sous-sections du hash pour générer des valeurs pour chaque dimension
      const position = i % 64;
      const byte1 = parseInt(hash.substring(position, position + 1), 16);
      const byte2 = parseInt(
        hash.substring((position + 1) % 64, (position + 2) % 64),
        16,
      );

      // Convertir en valeur entre -1 et 1
      vector[i] = ((byte1 / 15) * 2 - 1) * 0.8 + ((byte2 / 15) * 2 - 1) * 0.2;
    }

    return vector;
  }

  async onModuleInit() {
    try {
      // On vérifie d'abord si la collection existe
      const collections = await this.client.listCollections();
      this.logger.log(
        `Collections disponibles: ${JSON.stringify(collections)}`,
      );

      if (collections.includes(this.COLLECTION_NAME)) {
        // On récupère la collection existante
        this.logger.log(
          `Collection ${this.COLLECTION_NAME} trouvée, récupération...`,
        );

        const params: GetCollectionParams = {
          name: this.COLLECTION_NAME,
          embeddingFunction: this.embeddingFunction,
        };

        this.collection = await this.client.getCollection(params);
        this.logger.log('Collection récupérée avec succès');
      } else {
        // On crée la collection
        this.logger.log(
          `Collection ${this.COLLECTION_NAME} non trouvée, création...`,
        );
        this.collection = await this.client.createCollection({
          name: this.COLLECTION_NAME,
          metadata: { description: 'Collection des questions pour le chatbot' },
          embeddingFunction: this.embeddingFunction,
        });
        this.logger.log('Collection créée avec succès');
      }
    } catch (error) {
      this.logger.error(
        "Erreur lors de l'initialisation de la collection:",
        error,
      );

      try {
        // On tente de créer la collection en dernier recours
        this.collection = await this.client.createCollection({
          name: this.COLLECTION_NAME,
          metadata: { description: 'Collection des questions pour le chatbot' },
          embeddingFunction: this.embeddingFunction,
        });
        this.logger.log('Collection créée avec succès (après erreur)');
      } catch (finalError) {
        this.logger.error(
          "Erreur fatale lors de l'initialisation de ChromaDB:",
          finalError,
        );
      }
    }
  }

  // Fonction utilitaire pour hacher un texte
  private hashText(text: string): string {
    let hash = 0;
    if (text.length === 0) return hash.toString();

    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Conversion en un entier 32 bits
    }

    // Convertir en chaîne hexadécimale
    const hexHash = (hash >>> 0).toString(16);
    // Étendre le hash pour qu'il soit assez long
    const extendedHash = hexHash
      .repeat(Math.ceil(64 / hexHash.length))
      .slice(0, 64);

    return extendedHash;
  }

  async addQuestions(questions: Question[]) {
    try {
      if (!this.collection) {
        this.logger.warn(
          'Collection non initialisée, tentative de récupération...',
        );

        // On vérifie d'abord si la collection existe
        const collections = await this.client.listCollections();
        this.logger.log(
          `Collections disponibles: ${JSON.stringify(collections)}`,
        );

        if (collections.includes(this.COLLECTION_NAME)) {
          // On récupère la collection existante
          const params: GetCollectionParams = {
            name: this.COLLECTION_NAME,
            embeddingFunction: this.embeddingFunction,
          };
          this.collection = await this.client.getCollection(params);
        } else {
          // On crée la collection
          this.collection = await this.client.createCollection({
            name: this.COLLECTION_NAME,
            metadata: {
              description: 'Collection des questions pour le chatbot',
            },
            embeddingFunction: this.embeddingFunction,
          });
        }

        this.logger.log(
          'Collection récupérée/créée avec succès dans addQuestions',
        );
      }

      const ids = questions.map((q) => q.id);
      const documents = questions.map((q) => q.question);
      const metadatas = questions.map((q) => ({
        sql: q.sql,
        description: q.description,
      }));

      await this.collection.add({
        ids,
        documents,
        metadatas,
      });
    } catch (error) {
      this.logger.error('Erreur dans addQuestions:', error);
      throw error;
    }
  }

  async findSimilarQuestions(
    question: string,
    nResults: number = 5,
  ): Promise<SimilarQuestion[]> {
    if (!this.collection) {
      this.logger.error('Collection non initialisée dans findSimilarQuestions');
      return [];
    }

    try {
      // Utiliser la recherche en texte intégral de ChromaDB
      const results = await this.collection.query({
        queryTexts: [question],
        nResults: Math.min(50, nResults * 5),
      });

      if (!results || !results.documents || results.documents.length === 0) {
        return [];
      }

      // Ensuite, réordonnons les résultats en fonction de la similarité textuelle
      const candidates = results.documents[0].map((doc, index) => ({
        question: doc || '',
        metadata: {
          sql: (results.metadatas[0][index] as any)?.sql || '',
          description: (results.metadatas[0][index] as any)?.description || '',
          parameters: (results.metadatas[0][index] as any)?.parameters || [],
        },
        distance: results.distances ? results.distances[0][index] : 0,
      }));

      // Calculer un score de similarité textuelle plus précis
      const scoredCandidates = candidates.map((candidate) => {
        const similarityScore = this.calculateTextualSimilarity(
          question.toLowerCase(),
          candidate.question.toLowerCase(),
        );
        return {
          ...candidate,
          distance: similarityScore,
        };
      });

      // Trier par similarité et prendre les N meilleurs
      const sortedResults = scoredCandidates
        .sort((a, b) => a.distance - b.distance)
        .slice(0, nResults);

      return sortedResults;
    } catch (error) {
      this.logger.error(
        'Erreur lors de la recherche de questions similaires:',
        error,
      );
      return [];
    }
  }

  // Fonction qui calcule un score de similarité entre deux textes
  private calculateTextualSimilarity(text1: string, text2: string): number {
    // Normaliser les textes
    const normalized1 = text1
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    const normalized2 = text2
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    // 1. Calcul Jaccard Similarity basé sur les mots (filtrer les mots courts)
    const words1 = new Set(
      normalized1.split(/\s+/).filter((word) => word.length > 2),
    );
    const words2 = new Set(
      normalized2.split(/\s+/).filter((word) => word.length > 2),
    );

    const intersection = new Set(
      [...words1].filter((word) => words2.has(word)),
    );
    const union = new Set([...words1, ...words2]);

    // Calculer l'indice Jaccard
    const jaccardSimilarity =
      union.size > 0 ? intersection.size / union.size : 0;

    // 2. Importance accrue des mots-clés pertinents pour le métier
    const keywordScore = this.calculateKeywordImportance(
      normalized1,
      normalized2,
    );

    // 3. Vérifier les intentions (devis, factures, projets, etc.)
    const intentScore = this.matchIntent(normalized1, normalized2);

    // 4. Similarité des paramètres (dates, montants, statuts, etc.)
    const paramScore = this.matchParameters(normalized1, normalized2);

    // Combinaison des scores (distance plus petite = meilleure correspondance)
    // Note: les poids sont ajustés pour donner plus d'importance aux intentions et mots-clés
    const weightedScore =
      1 -
      (jaccardSimilarity * 0.3 +
        keywordScore * 0.3 +
        intentScore * 0.3 +
        paramScore * 0.1);

    return Math.max(0, Math.min(1, weightedScore));
  }

  // Évalue l'importance des mots-clés du domaine
  private calculateKeywordImportance(text1: string, text2: string): number {
    // Liste des mots-clés importants pour le domaine BTP
    const businessKeywords = [
      'client',
      'clients',
      'projet',
      'projets',
      'chantier',
      'chantiers',
      'facture',
      'factures',
      'devis',
      'proposition',
      'propositions',
      'refusé',
      'refusée',
      'refusés',
      'refusées',
      'rejeté',
      'rejetée',
      'accepté',
      'acceptée',
      'validé',
      'validée',
      'matériaux',
      'équipement',
      'équipe',
      'planning',
      'récent',
      'récents',
      'récente',
      'récentes',
      'entreprise',
      'personnel',
      'staff',
      'employé',
      'employés',
    ];

    // Compter les correspondances et leur donner un poids plus élevé
    let score = 0;
    let totalMatchableKeywords = 0;

    for (const keyword of businessKeywords) {
      const inText1 = text1.includes(keyword);
      const inText2 = text2.includes(keyword);

      if (inText1) {
        totalMatchableKeywords++;
        if (inText2) {
          // Pondération plus forte pour les termes métier spécifiques
          if (
            [
              'refusé',
              'refusée',
              'refusés',
              'refusées',
              'rejeté',
              'rejetée',
            ].includes(keyword)
          ) {
            score += 3;
          } else if (
            ['devis', 'proposition', 'propositions'].includes(keyword)
          ) {
            score += 2;
          } else {
            score += 1;
          }
        }
      }
    }

    // Normaliser le score entre 0 et 1
    return totalMatchableKeywords > 0
      ? Math.min(1, score / totalMatchableKeywords)
      : 0;
  }

  // Détecte si les deux textes partagent la même intention
  private matchIntent(text1: string, text2: string): number {
    // Catégories d'intentions principales
    const intentions = [
      { type: 'devis', terms: ['devis', 'proposition', 'offre', 'cotation'] },
      {
        type: 'facture',
        terms: ['facture', 'paiement', 'règlement', 'impayé'],
      },
      {
        type: 'projet',
        terms: ['projet', 'chantier', 'travaux', 'construction'],
      },
      {
        type: 'client',
        terms: ['client', 'contact', 'personne', 'entreprise'],
      },
      {
        type: 'planning',
        terms: ['planning', 'calendrier', 'agenda', 'emploi du temps'],
      },
      {
        type: 'status',
        terms: ['refusé', 'rejeté', 'accepté', 'validé', 'en cours', 'terminé'],
      },
    ];

    // Vérifier si les deux textes partagent les mêmes intentions
    let maxScore = 0;

    for (const intent of intentions) {
      const inText1 = intent.terms.some((term) => text1.includes(term));
      const inText2 = intent.terms.some((term) => text2.includes(term));

      if (inText1 && inText2) {
        // Les intentions "status" avec termes exacts sont plus importantes
        if (intent.type === 'status') {
          for (const term of intent.terms) {
            if (text1.includes(term) && text2.includes(term)) {
              maxScore = Math.max(maxScore, 1.0);
              break;
            }
          }
        } else {
          maxScore = Math.max(maxScore, 0.8);
        }
      }
    }

    return maxScore;
  }

  // Détecte si les deux textes font référence aux mêmes types de paramètres
  private matchParameters(text1: string, text2: string): number {
    const paramPatterns = [
      {
        type: 'date',
        pattern:
          /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b\d{4}[/-]\d{1,2}[/-]\d{1,2}\b/,
      },
      { type: 'montant', pattern: /\b\d+([,.]\d{1,2})?\s*(€|euros?)\b/ },
      {
        type: 'id',
        pattern: /\b[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\b/i,
      },
      {
        type: 'ville',
        pattern: /\b(?:à|de|sur|pour)\s+([A-Z][a-zéèêàâôûùïüç-]+)\b/,
      },
    ];

    let matchCount = 0;
    let totalParams = 0;

    for (const param of paramPatterns) {
      const inText1 = param.pattern.test(text1);
      const inText2 = param.pattern.test(text2);

      if (inText1 || inText2) {
        totalParams++;
        if (inText1 && inText2) {
          matchCount++;
        }
      }
    }

    return totalParams > 0 ? matchCount / totalParams : 0;
  }

  async deleteCollection() {
    try {
      const collections = await this.client.listCollections();

      if (collections.includes(this.COLLECTION_NAME)) {
        await this.client.deleteCollection({
          name: this.COLLECTION_NAME,
        });
        this.logger.log(
          `Collection ${this.COLLECTION_NAME} supprimée avec succès`,
        );
        // Réinitialiser la référence de collection
        this.collection = undefined;
      } else {
        this.logger.warn(
          `Collection ${this.COLLECTION_NAME} introuvable, rien à supprimer`,
        );
      }
    } catch (error) {
      this.logger.error(
        'Erreur lors de la suppression de la collection:',
        error,
      );
      throw error;
    }
  }

  async getCount(): Promise<number> {
    if (!this.collection) {
      this.logger.error('Collection non initialisée dans getCount');
      return 0;
    }
    return await this.collection.count();
  }

  /**
   * Vérifie si ChromaDB est disponible en tentant de lister les collections
   * @returns Une promesse qui se résout si ChromaDB est disponible, sinon rejette avec une erreur
   */
  async checkHealth(): Promise<boolean> {
    try {
      // Tente de lister les collections pour vérifier la connexion
      await this.client.listCollections();
      return true;
    } catch (error) {
      this.logger.error(
        'Erreur lors de la vérification de la santé de ChromaDB:',
        error,
      );
      throw error;
    }
  }
}
