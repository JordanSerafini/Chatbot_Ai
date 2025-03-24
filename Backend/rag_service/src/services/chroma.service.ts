import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ChromaClient, Collection, GetCollectionParams } from 'chromadb';
import { Question, SimilarQuestion } from '../interfaces/question.interface';

@Injectable()
export class ChromaService implements OnModuleInit {
  private readonly logger = new Logger(ChromaService.name);
  private client: ChromaClient;
  private collection: Collection;
  private readonly COLLECTION_NAME = 'questions_collection';

  constructor() {
    this.client = new ChromaClient({
      path: 'http://localhost:8000',
    });
  }

  async onModuleInit() {
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
      this.collection = await this.client.getCollection(params);
    }
  }

  async addQuestions(questions: Question[]) {
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
