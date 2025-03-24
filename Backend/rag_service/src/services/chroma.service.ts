import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ChromaClient, Collection, GetCollectionParams } from 'chromadb';
import { Question, SimilarQuestion } from '../interfaces/question.interface';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ChromaService implements OnModuleInit {
  private readonly logger = new Logger(ChromaService.name);
  private client: ChromaClient;
  private collection: Collection;
  private readonly COLLECTION_NAME = 'questions_collection';

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
      try {
        this.collection = await this.client.createCollection({
          name: this.COLLECTION_NAME,
          metadata: { description: 'Collection des questions pour le chatbot' },
        });
        this.logger.log('Collection créée avec succès');
      } catch (error) {
        this.logger.log('Collection existante, récupération...');
        console.log(error);
        const params: GetCollectionParams = {
          name: this.COLLECTION_NAME,
          embeddingFunction: {
            generate: async (texts) => {
              // Fonction simple qui crée un embedding vide de la bonne dimension pour chaque texte
              return Promise.resolve(texts.map(() => new Array(1536).fill(0)));
            },
          },
        };
        try {
          this.collection = await this.client.getCollection(params);
          this.logger.log('Collection récupérée avec succès');
        } catch (collectionError) {
          this.logger.error(
            'Erreur lors de la récupération de la collection:',
            collectionError,
          );
          // Réessayer de créer la collection si elle n'existe pas
          this.collection = await this.client.createCollection({
            name: this.COLLECTION_NAME,
            metadata: {
              description: 'Collection des questions pour le chatbot',
            },
          });
          this.logger.log('Collection recréée avec succès');
        }
      }
    } catch (finalError) {
      this.logger.error(
        "Erreur fatale lors de l'initialisation de ChromaDB:",
        finalError,
      );
    }
  }

  async addQuestions(questions: Question[]) {
    try {
      if (!this.collection) {
        this.logger.warn(
          'Collection non initialisée, tentative de récupération...',
        );
        const params: GetCollectionParams = {
          name: this.COLLECTION_NAME,
          embeddingFunction: {
            generate: async (texts) => {
              return Promise.resolve(texts.map(() => new Array(1536).fill(0)));
            },
          },
        };
        this.collection = await this.client.getCollection(params);
        this.logger.log('Collection récupérée avec succès dans addQuestions');
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

      // Si la collection n'existe pas, essayer de la créer
      if (error.message && error.message.includes('does not exist')) {
        try {
          this.logger.log('Tentative de création de la collection...');

          // Vérifier si la collection existe déjà dans la liste des collections
          const collections = await this.client.listCollections();
          this.logger.log(
            `Collections existantes: ${JSON.stringify(collections)}`,
          );

          // Supprimer la collection si elle existe
          if (collections.includes(this.COLLECTION_NAME)) {
            this.logger.log(
              `Suppression de la collection existante: ${this.COLLECTION_NAME}`,
            );
            await this.client.deleteCollection({ name: this.COLLECTION_NAME });
          }

          // Créer une nouvelle collection avec un nom fixe
          this.collection = await this.client.createCollection({
            name: this.COLLECTION_NAME,
            metadata: {
              description: 'Collection des questions pour le chatbot',
            },
          });

          // Réessayer l'ajout
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

          this.logger.log(
            'Ajout des questions réussi après création de la collection',
          );
        } catch (retryError) {
          this.logger.error(
            'Échec de la tentative de récupération:',
            retryError,
          );
          throw retryError;
        }
      } else {
        throw error;
      }
    }
  }

  async findSimilarQuestions(
    question: string,
    nResults: number = 5,
  ): Promise<SimilarQuestion[]> {
    const results = await this.collection.query({
      queryTexts: [question],
      nResults,
    });

    if (!results || !results.documents || results.documents.length === 0) {
      return [];
    }

    return results.documents[0].map((doc, index) => ({
      question: doc || '',
      metadata: {
        sql: (results.metadatas[0][index] as any)?.sql || '',
        description: (results.metadatas[0][index] as any)?.description || '',
      },
      distance: results.distances ? results.distances[0][index] : 0,
    }));
  }

  async deleteCollection() {
    await this.client.deleteCollection({
      name: this.COLLECTION_NAME,
    });
  }

  async getCount(): Promise<number> {
    return await this.collection.count();
  }
}
