import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ChromaClient, Collection, GetCollectionParams } from 'chromadb';
import { Question, SimilarQuestion } from '../interfaces/question.interface';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ChromaService implements OnModuleInit {
  private readonly logger = new Logger(ChromaService.name);
  private client: ChromaClient;
  private collection: Collection | undefined;
  private readonly COLLECTION_NAME = 'questions_collection';
  private readonly embeddingFunction = {
    generate: (texts: string[]): Promise<number[][]> => {
      return Promise.resolve(
        texts.map(() =>
          Array(1536)
            .fill(0)
            .map(() => Math.random() * 2 - 1),
        ),
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
    // 1. Calcul Jaccard Similarity basé sur les mots
    const words1 = new Set(
      text1.split(/\s+/).filter((word) => word.length > 2),
    );
    const words2 = new Set(
      text2.split(/\s+/).filter((word) => word.length > 2),
    );

    const intersection = new Set(
      [...words1].filter((word) => words2.has(word)),
    );
    const union = new Set([...words1, ...words2]);

    // Calculer l'indice Jaccard
    const jaccardSimilarity = intersection.size / union.size;

    // 2. Vérifier s'il y a des mots exacts importants en commun
    const importantWordsCount = this.countImportantWordsMatches(text1, text2);

    // 3. Combinaison des scores (distance plus petite = meilleure correspondance)
    return 1 - (jaccardSimilarity * 0.7 + (importantWordsCount > 0 ? 0.3 : 0));
  }

  // Compte le nombre de mots clés importants en commun
  private countImportantWordsMatches(text1: string, text2: string): number {
    // Liste de mots clés importants pour le domaine
    const importantKeywords = [
      'client',
      'clients',
      'actif',
      'actifs',
      'actives',
      'projet',
      'projets',
      'facture',
      'factures',
      'devis',
      'planning',
      'budget',
      'budgets',
      'cours',
      'terminés',
      'terminé',
      'retard',
      'impayé',
      'impayés',
      'liste',
    ];

    // Compter les correspondances
    let count = 0;
    for (const keyword of importantKeywords) {
      if (text1.includes(keyword) && text2.includes(keyword)) {
        count++;
      }
    }

    return count;
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
