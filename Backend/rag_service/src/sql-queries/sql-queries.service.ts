import { Injectable, Logger } from '@nestjs/common';
import {
  ChromaClient,
  Collection,
  GetCollectionParams,
  Metadata,
  IEmbeddingFunction,
} from 'chromadb';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

// Fonction d'embedding vide pour satisfaire le typage
class NoOpEmbeddingFunction implements IEmbeddingFunction {
  public generate(texts: string[]): Promise<number[][]> {
    // Retourne un vecteur vide pour chaque texte
    return Promise.resolve(texts.map(() => []));
  }
}

interface QueryData {
  id: string;
  questions: string[];
  sql: string;
  description: string;
}

interface JsonData {
  queries: QueryData[];
}

interface QueryHash {
  id: string;
  hash: string;
}

interface QueryMetadata extends Metadata {
  sql: string;
  description: string;
}

interface HashMetadata extends Metadata {
  hash: string;
}

@Injectable()
export class SqlQueriesService {
  private readonly logger = new Logger(SqlQueriesService.name);
  private readonly client: ChromaClient;
  private readonly COLLECTION_NAME = 'sql_queries';
  private readonly HASH_COLLECTION_NAME = 'query_hashes';
  private readonly embeddingFunction: IEmbeddingFunction;
  private collection: Collection;
  private hashCollection: Collection;

  constructor() {
    this.client = new ChromaClient({
      path: 'http://localhost:8000',
    });
    this.embeddingFunction = new NoOpEmbeddingFunction();
  }

  private calculateHash(query: QueryData): string {
    const content = JSON.stringify({
      questions: query.questions,
      sql: query.sql,
      description: query.description,
    });
    return crypto.createHash('md5').update(content).digest('hex');
  }

  private async initializeCollections() {
    try {
      const params: Omit<GetCollectionParams, 'metadata'> = {
        name: this.COLLECTION_NAME,
        embeddingFunction: this.embeddingFunction,
      };

      const hashParams: Omit<GetCollectionParams, 'metadata'> = {
        name: this.HASH_COLLECTION_NAME,
        embeddingFunction: this.embeddingFunction,
      };

      // Créer ou récupérer la collection principale
      this.collection = await this.client.createCollection(params);

      // Créer ou récupérer la collection de hashes
      this.hashCollection = await this.client.createCollection(hashParams);
    } catch {
      // Si les collections existent déjà, les récupérer
      this.collection = await this.client.getCollection({
        name: this.COLLECTION_NAME,
        embeddingFunction: this.embeddingFunction,
      });
      this.hashCollection = await this.client.getCollection({
        name: this.HASH_COLLECTION_NAME,
        embeddingFunction: this.embeddingFunction,
      });
    }
  }

  private async loadQueryFile(filePath: string): Promise<JsonData> {
    const fileContent = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(fileContent) as JsonData;
  }

  private async checkForUpdates(queryFiles: string[]): Promise<boolean> {
    let hasUpdates = false;
    const queryDir = path.join(process.cwd(), 'Backend', 'chroma_db', 'query');
    const currentHashes = new Map<string, string>();

    // Charger les hashes actuels
    const existingHashes = await this.hashCollection.get({});
    if (existingHashes.ids && existingHashes.metadatas) {
      existingHashes.ids.forEach((id, index) => {
        const metadata = existingHashes.metadatas[index] as HashMetadata;
        if (metadata && metadata.hash) {
          currentHashes.set(id, metadata.hash);
        }
      });
    }

    for (const file of queryFiles) {
      try {
        const filePath = path.join(queryDir, file);
        const data = await this.loadQueryFile(filePath);

        for (const query of data.queries) {
          const newHash = this.calculateHash(query);
          const currentHash = currentHashes.get(query.id);

          if (!currentHash || currentHash !== newHash) {
            hasUpdates = true;
            this.logger.log(`Mise à jour détectée pour la requête ${query.id}`);
          }
        }
      } catch (err) {
        this.logger.error(
          `Erreur lors de la vérification du fichier ${file}:`,
          err,
        );
      }
    }

    return hasUpdates;
  }

  async resetSqlQueriesCollection() {
    try {
      await this.initializeCollections();

      // Charger les fichiers de requêtes
      const queryFiles = [
        'clients.query.json',
        'invoices.query.json',
        'planning.query.json',
        'projects.query.json',
        'quotations.query.json',
      ];

      // Vérifier les mises à jour
      const hasUpdates = await this.checkForUpdates(queryFiles);

      if (!hasUpdates && (await this.collection.count()) > 0) {
        this.logger.log(
          'Aucune mise à jour détectée dans les fichiers de requêtes',
        );
        return {
          success: true,
          totalQueries: await this.collection.count(),
          message: 'Aucune mise à jour nécessaire',
        };
      }

      // Si des mises à jour sont détectées, réinitialiser les collections
      await this.client.deleteCollection({ name: this.COLLECTION_NAME });
      await this.client.deleteCollection({ name: this.HASH_COLLECTION_NAME });
      await this.initializeCollections();

      const queryDir = path.join(
        process.cwd(),
        'Backend',
        'chroma_db',
        'query',
      );
      this.logger.log(`Chargement des requêtes depuis: ${queryDir}`);

      let totalQueries = 0;
      const newHashes: QueryHash[] = [];

      for (const file of queryFiles) {
        try {
          const filePath = path.join(queryDir, file);
          const data = await this.loadQueryFile(filePath);

          if (data.queries) {
            const documents: string[] = [];
            const metadatas: QueryMetadata[] = [];
            const ids: string[] = [];

            data.queries.forEach((query, queryIndex) => {
              // Calculer le hash pour cette requête
              const hash = this.calculateHash(query);
              newHashes.push({ id: query.id, hash });

              query.questions.forEach((question, index) => {
                documents.push(question);
                metadatas.push({
                  sql: query.sql,
                  description: query.description,
                });
                ids.push(`${query.id}-${queryIndex}-${index}`);
              });
            });

            if (documents.length > 0) {
              await this.collection.add({
                documents,
                metadatas,
                ids,
              });

              // Stocker les hashes
              await this.hashCollection.add({
                ids: newHashes.map((h) => h.id),
                documents: newHashes.map((h) => h.id),
                metadatas: newHashes.map((h) => ({ hash: h.hash })),
              });

              totalQueries += documents.length;
              this.logger.log(
                `${documents.length} questions chargées depuis ${file}`,
              );
            }
          }
        } catch (err) {
          this.logger.error(
            `Erreur lors du chargement du fichier ${file}:`,
            err,
          );
        }
      }

      return {
        success: true,
        totalQueries,
        message: `Collection ${this.COLLECTION_NAME} mise à jour avec ${totalQueries} requêtes`,
      };
    } catch (err) {
      this.logger.error(
        'Erreur lors de la réinitialisation de la collection:',
        err,
      );
      throw err;
    }
  }
}
