import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { RagService } from './rag.service';
import { SqlQueriesService } from '../sql-queries/sql-queries.service';
import { ChromaService } from '../services/chroma.service';
import { SimilarQuestion } from '../interfaces/question.interface';
import { Logger } from '@nestjs/common';

class QuestionDto {
  question: string;
  nResults?: number;
}

@Controller('rag')
export class RagController {
  private readonly logger = new Logger(RagController.name);

  constructor(
    private readonly ragService: RagService,
    private readonly sqlQueriesService: SqlQueriesService,
    private readonly chromaService: ChromaService,
  ) {}

  @Post('collection/:name')
  async createCollection(@Param('name') name: string) {
    return this.ragService.createCollection(name);
  }

  @Post('collection/:name/documents')
  async addDocuments(
    @Param('name') collectionName: string,
    @Body() body: { documents: string[] },
  ) {
    return this.ragService.addDocuments(collectionName, body.documents);
  }

  @Post('collection/:name/upsert')
  async upsertDocuments(
    @Param('name') collectionName: string,
    @Body() body: { documents: string[]; ids?: string[] },
  ) {
    return this.ragService.upsertDocuments(
      collectionName,
      body.documents,
      body.ids,
    );
  }

  @Get('collection/:name/similar')
  async findSimilarDocuments(
    @Param('name') collectionName: string,
    @Query('query') query: string,
    @Query('limit') limit?: number,
  ) {
    return this.ragService.findSimilarDocuments(
      collectionName,
      query,
      limit ? parseInt(limit.toString(), 10) : undefined,
    );
  }

  @Get('collection/:name/check-prompt')
  async findSimilarPrompt(
    @Param('name') collectionName: string,
    @Query('prompt') prompt: string,
    @Query('threshold') threshold?: number,
  ) {
    return this.ragService.findSimilarPrompt(
      collectionName,
      prompt,
      threshold ? parseFloat(threshold.toString()) : undefined,
    );
  }

  @Post('question')
  async processQuestion(@Body() body: { question: string }): Promise<any> {
    try {
      const { question } = body;

      if (!question) {
        throw new BadRequestException('La question est requise');
      }

      this.logger.log(`Traitement de la question: "${question}"`);

      // Analyser la question pour détecter des patterns spécifiques
      const lowerQuestion = question.toLowerCase().trim();

      // Détection pour les questions sur les chantiers de cette année
      if (
        /chantier.*(?:cette année|année en cours|cette anné|annee|cet an)/i.test(
          lowerQuestion,
        ) ||
        /(?:cette année|année en cours|cette anné|annee|cet an).*chantier/i.test(
          lowerQuestion,
        ) ||
        /(?:projet|projets).*(?:cette année|année en cours|cette anné|annee|cet an)/i.test(
          lowerQuestion,
        ) ||
        /(?:cette année|année en cours|cette anné|annee|cet an).*(?:projet|projets)/i.test(
          lowerQuestion,
        )
      ) {
        this.logger.log(
          `Question détectée comme demande de chantiers pour cette année`,
        );

        // Forcer l'utilisation de la requête "projects_this_year"
        const sqlMetadata =
          await this.sqlQueriesService.getQueryMetadataById(
            'projects_this_year',
          );

        if (sqlMetadata) {
          return {
            question,
            finalQuery: sqlMetadata.sql,
            originalQuery: sqlMetadata.sql,
            fromStoredQuery: true,
            storedQueryId: 'projects_this_year',
            similarity: 0.95,
            source: 'rag',
            confidence: 0.95,
            parameters: [],
            description: sqlMetadata.description,
            bestMatch: {
              queryId: 'projects_this_year',
              sql: sqlMetadata.sql,
              description: sqlMetadata.description,
              similarity: 0.95,
            },
          };
        }
      }

      // Utiliser la méthode processQuestion qui intègre la recherche de questions similaires
      const result = await this.ragService.processQuestion(question);

      return result;
    } catch (error) {
      throw new HttpException(
        `Erreur lors du traitement de la question: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('collection/:name/cleanup')
  async cleanupCollection(@Param('name') collectionName: string) {
    try {
      // Vérifier si la collection existe
      const collection =
        await this.ragService.getOrCreateCollection(collectionName);

      // Obtenir tous les documents avec leurs métadonnées
      const allDocuments = await collection.get({
        include: ['embeddings', 'documents', 'metadatas'],
      });

      // Identifiants à supprimer (ceux qui n'ont pas d'embedding)
      const idsToDelete: string[] = [];

      if (allDocuments && allDocuments.ids) {
        for (let i = 0; i < allDocuments.ids.length; i++) {
          // Si l'embedding est vide ou inexistant pour cet ID
          if (
            !allDocuments.embeddings ||
            !allDocuments.embeddings[i] ||
            allDocuments.embeddings[i].length === 0
          ) {
            idsToDelete.push(allDocuments.ids[i]);
          }
        }
      }

      // Si nous avons des IDs à supprimer
      if (idsToDelete.length > 0) {
        // Supprimer les documents avec ces IDs
        await collection.delete({
          ids: idsToDelete,
        });
      }

      return {
        success: true,
        collectionName,
        documentsTotal: allDocuments.ids?.length || 0,
        documentsInvalid: idsToDelete.length,
        documentsRemaining:
          (allDocuments.ids?.length || 0) - idsToDelete.length,
        message: `Nettoyage terminé: ${idsToDelete.length} documents invalides supprimés`,
      };
    } catch (error) {
      throw new HttpException(
        `Erreur lors du nettoyage de la collection: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('collection/:name/reset')
  async resetCollection(@Param('name') collectionName: string) {
    try {
      // Supprimer et recréer la collection
      const client = this.ragService.getChromaClient();

      // Vérifier si la collection existe
      const collections = await client.listCollections();
      const collectionExists = collections.some((c) => c === collectionName);

      if (collectionExists) {
        // Supprimer la collection existante
        await client.deleteCollection({ name: collectionName });
      }

      // Créer une nouvelle collection
      const newCollection =
        await this.ragService.createCollection(collectionName);

      return {
        success: true,
        message: `Collection ${collectionName} réinitialisée avec succès`,
        collection: newCollection,
      };
    } catch (error) {
      throw new HttpException(
        `Erreur lors de la réinitialisation de la collection: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('reload-sql-queries')
  async reloadSqlQueries() {
    try {
      // Appeler la méthode de réinitialisation directement
      const result = await this.sqlQueriesService.resetSqlQueriesCollection();

      return {
        success: true,
        message: 'Collection sql_queries rechargée avec succès',
        details: result,
      };
    } catch (error) {
      throw new HttpException(
        `Erreur lors du rechargement des requêtes SQL: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('reload-collection')
  async reloadCollection(@Body() body: { collection: string }) {
    try {
      const { collection } = body;

      if (!collection) {
        throw new BadRequestException('Le nom de la collection est requis');
      }

      // Si c'est la collection sql_queries, utiliser le service dédié
      if (collection === 'sql_queries') {
        const result = await this.sqlQueriesService.resetSqlQueriesCollection();
        return {
          success: true,
          message: `Collection ${collection} rechargée avec succès`,
          details: result,
        };
      }
      // Sinon, réinitialiser la collection génériquement
      else {
        // Supprimer et recréer la collection
        const client = this.ragService.getChromaClient();

        // Vérifier si la collection existe
        const collections = await client.listCollections();
        const collectionExists = collections.some((c) => c === collection);

        if (collectionExists) {
          // Supprimer la collection existante
          await client.deleteCollection({ name: collection });
        }

        // Créer une nouvelle collection
        const newCollection =
          await this.ragService.createCollection(collection);

        return {
          success: true,
          message: `Collection ${collection} réinitialisée avec succès`,
          collection: newCollection,
        };
      }
    } catch (error) {
      throw new HttpException(
        `Erreur lors du rechargement de la collection: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('similar')
  async findSimilarQuestions(
    @Body() questionDto: QuestionDto,
  ): Promise<SimilarQuestion[]> {
    try {
      const collections = await this.ragService
        .getChromaClient()
        .listCollections();
      this.logger.log(
        `Collections disponibles: ${JSON.stringify(collections)}`,
      );
      this.logger.log(`Recherche pour la question: "${questionDto.question}"`);

      // Obtenir 5 résultats par recherche sémantique (embedding)
      const embeddingResults = await this.chromaService.findSimilarQuestions(
        questionDto.question,
        5, // Limiter à 5 résultats pour les embeddings
      );

      // Obtenir 5 résultats par recherche par mots-clés
      // On utilise une approche de recherche textuelle pour diversifier les résultats
      const keywordMatches = await this.sqlQueriesService.findQueriesByKeywords(
        questionDto.question,
        5, // Limiter à 5 résultats pour les mots-clés
      );

      // Convertir les résultats de mots-clés au même format que les résultats d'embedding
      const keywordResults: SimilarQuestion[] = keywordMatches.map((match) => ({
        question: match.question,
        metadata: {
          sql: match.sql,
          description: match.description,
          parameters: match.parameters || [],
        },
        distance: match.similarity, // Utiliser le score de similarité comme distance
      }));

      // Combiner les deux ensembles de résultats
      const combinedResults = [...embeddingResults];

      // Ajouter uniquement les résultats de mots-clés qui ne sont pas déjà présents dans les résultats d'embedding
      // (éviter les doublons basés sur la requête SQL)
      for (const keywordResult of keywordResults) {
        const isDuplicate = combinedResults.some(
          (r) => r.metadata.sql === keywordResult.metadata.sql,
        );

        if (!isDuplicate) {
          combinedResults.push(keywordResult);
        }
      }

      // Trier l'ensemble combiné par distance (croissante)
      combinedResults.sort((a, b) => a.distance - b.distance);

      // Limiter à un maximum de 10 résultats
      const finalResults = combinedResults.slice(0, 10);

      this.logger.log(`Résultats totaux trouvés: ${finalResults.length}`);

      return finalResults;
    } catch (error) {
      this.logger.error(`Erreur lors de la recherche: ${error.message}`);
      throw error;
    }
  }

  @Get('similar')
  async getSimilarQuestions(
    @Query('question') question: string,
    @Query('limit') limit?: number,
  ): Promise<SimilarQuestion[]> {
    if (!question) {
      throw new BadRequestException('Le paramètre "question" est requis');
    }

    try {
      const collections = await this.ragService
        .getChromaClient()
        .listCollections();
      this.logger.log(
        `Collections disponibles: ${JSON.stringify(collections)}`,
      );
      this.logger.log(`Recherche pour la question: "${question}"`);

      const results = await this.chromaService.findSimilarQuestions(
        question,
        limit ? parseInt(limit.toString(), 10) : 5,
      );

      this.logger.log(`Résultats trouvés: ${results.length}`);

      return results;
    } catch (error) {
      this.logger.error(`Erreur lors de la recherche: ${error.message}`);
      throw error;
    }
  }

  @Post('analyse')
  async analyseQuestion(@Body() { question }: { question: string }) {
    const similarQuestions =
      await this.chromaService.findSimilarQuestions(question);

    // Formater les résultats pour le prompt
    const sqlQueries = similarQuestions
      .map(
        (q) =>
          `Question: ${q.question}\nSQL: ${q.metadata.sql}\nDescription: ${q.metadata.description}`,
      )
      .join('\n\n');
    console.log(sqlQueries);
    // ... suite du traitement
  }

  @Get('collections')
  async listCollections() {
    try {
      const collections = await this.ragService
        .getChromaClient()
        .listCollections();
      return {
        collections,
        count: collections.length,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      throw new HttpException(
        `Erreur lors de la liste des collections: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('questions')
  async getAllQuestions(): Promise<string[]> {
    try {
      return await this.chromaService.getAllQuestions();
    } catch (error) {
      this.logger.error('Erreur lors de la récupération des questions:', error);
      throw new HttpException(
        'Erreur lors de la récupération des questions',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
