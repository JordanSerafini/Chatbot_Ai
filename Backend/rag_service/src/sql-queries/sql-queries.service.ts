import { Injectable, Logger } from '@nestjs/common';
import {
  ChromaClient,
  Collection,
  GetCollectionParams,
  Metadata,
  DefaultEmbeddingFunction,
} from 'chromadb';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';

// Classe pour la gestion des hashes
interface QueryHash {
  id: string;
  hash: string;
}

// Définir les types pour les métadonnées des requêtes
interface QueryMetadata {
  sql: string;
  description: string;
  parameters: string;
  [key: string]: string | number | boolean;
}

interface QueryData {
  id: string;
  questions: string[];
  sql: string;
  description: string;
  parameters?: Array<{ name: string; description: string }>;
}

interface JsonData {
  queries: QueryData[];
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
  private readonly embeddingFunction = new DefaultEmbeddingFunction();
  private collection: Collection;
  private hashCollection: Collection;

  constructor(private configService: ConfigService) {
    const chromaUrl =
      this.configService.get<string>('CHROMA_URL') || 'http://ChromaDB:8000';
    this.logger.log(`Connexion à ChromaDB sur : ${chromaUrl}`);
    this.client = new ChromaClient({
      path: chromaUrl,
    });
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
    const queryDir = path.join(process.cwd(), 'query');
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

      const queryDir = path.join(process.cwd(), 'query');
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

                // Convertir les paramètres en chaîne JSON si nécessaire
                const metadata: QueryMetadata = {
                  sql: query.sql,
                  description: query.description,
                  parameters: query.parameters
                    ? JSON.stringify(query.parameters)
                    : '[]',
                };

                metadatas.push(metadata);
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

  async executeQuery(
    queryId: string,
    params?: Record<string, string>,
  ): Promise<any> {
    try {
      const collection = await this.getOrCreateCollection();
      const results = await collection.get({
        where: { id: queryId },
      });

      if (!results || !results.ids.length) {
        throw new Error(`Requête non trouvée: ${queryId}`);
      }

      const index = results.ids.indexOf(queryId);
      if (index === -1) {
        throw new Error(`Index de requête non trouvé: ${queryId}`);
      }

      let sql = (results.metadatas[index] as QueryMetadata).sql;

      // Remplacer les paramètres dans la requête SQL si des paramètres sont fournis
      if (params) {
        Object.entries(params).forEach(([key, value]) => {
          // Échapper les valeurs pour éviter les injections SQL
          const escapedValue = this.escapeSqlValue(value);
          // Remplacer tous les occurrences de [KEY] par la valeur
          const parameterPattern = new RegExp(`\\[${key}\\]`, 'gi');
          sql = sql.replace(parameterPattern, escapedValue);
        });
      }

      this.logger.log(`Exécution de la requête SQL: ${sql}`);
      // Ici, vous connecteriez à votre base de données et exécuteriez la requête SQL
      // Retourner le résultat
      return { sql, params, status: 'success' };
    } catch (error) {
      this.logger.error(
        `Erreur lors de l'exécution de la requête: ${error.message}`,
      );
      throw error;
    }
  }

  private escapeSqlValue(value: string): string {
    // Méthode simple d'échappement pour éviter les injections SQL
    // Dans une implémentation réelle, utilisez les fonctionnalités d'échappement
    // fournies par votre bibliothèque de base de données
    return value.replace(/'/g, "''");
  }

  /**
   * Récupère ou crée la collection ChromaDB pour les requêtes SQL
   */
  private async getOrCreateCollection(): Promise<Collection> {
    try {
      // Simple no-op embedding function
      const embeddingFunction = this.embeddingFunction;

      // Vérifier si la collection existe déjà
      const collections = await this.client.listCollections();
      if (collections.includes(this.COLLECTION_NAME)) {
        // Récupérer la collection existante
        return await this.client.getCollection({
          name: this.COLLECTION_NAME,
          embeddingFunction,
        });
      } else {
        // Créer une nouvelle collection
        return await this.client.createCollection({
          name: this.COLLECTION_NAME,
          embeddingFunction,
          metadata: {
            description: 'Collection des requêtes SQL paramétrées',
          },
        });
      }
    } catch (error) {
      this.logger.error(
        `Erreur lors de l'accès à la collection: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Récupère les métadonnées d'une requête SQL par son ID
   * @param queryId Identifiant de la requête
   * @returns Les métadonnées de la requête (sql, description, paramètres)
   */
  async getQueryMetadataById(queryId: string): Promise<QueryMetadata | null> {
    try {
      this.logger.log(`Recherche de la requête avec l'ID: ${queryId}`);
      
      // Parcourir les fichiers de requêtes pour trouver celle avec l'ID spécifié
      const queryDir = path.join(process.cwd(), 'query');
      const queryFiles = [
        'clients.query.json',
        'invoices.query.json',
        'planning.query.json',
        'projects.query.json',
        'quotations.query.json',
      ];
      
      for (const file of queryFiles) {
        try {
          const filePath = path.join(queryDir, file);
          const data = await this.loadQueryFile(filePath);
          
          // Chercher la requête avec l'ID correspondant
          const query = data.queries.find(q => q.id === queryId);
          
          if (query) {
            this.logger.log(`Requête trouvée dans le fichier ${file}`);
            return {
              sql: query.sql,
              description: query.description,
              parameters: JSON.stringify(query.parameters || []),
            };
          }
        } catch (err) {
          this.logger.error(`Erreur lors de la lecture du fichier ${file}:`, err);
        }
      }
      
      // Si la requête n'est pas trouvée dans les fichiers, rechercher dans ChromaDB
      const result = await this.hashCollection.get({
        where: { query_id: queryId },
        limit: 1,
      });
      
      if (result.ids && result.ids.length > 0 && result.metadatas && result.metadatas.length > 0) {
        const metadata = result.metadatas[0] as QueryMetadata;
        this.logger.log(`Requête trouvée dans ChromaDB`);
        return metadata;
      }
      
      this.logger.warn(`Aucune requête trouvée avec l'ID: ${queryId}`);
      return null;
    } catch (error) {
      this.logger.error(`Erreur lors de la récupération de la requête: ${error.message}`);
      return null;
    }
  }
}
