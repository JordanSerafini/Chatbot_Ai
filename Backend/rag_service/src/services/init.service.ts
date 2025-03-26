import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { SqlQueriesService } from '../sql-queries/sql-queries.service';
import { ChromaService } from './chroma.service';

@Injectable()
export class InitService implements OnModuleInit {
  private readonly logger = new Logger(InitService.name);

  constructor(
    private readonly sqlQueriesService: SqlQueriesService,
    private readonly chromaService: ChromaService,
  ) {}

  async onModuleInit() {
    try {
      // Attendre que ChromaDB soit complètement démarré
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // Réinitialiser complètement la collection
      await this.chromaService.deleteCollection();
      this.logger.log('Collection réinitialisée avec succès');

      // Attendre un peu pour que ChromaDB traite la création de la collection
      await new Promise((resolve) => setTimeout(resolve, 2000));

      try {
        // Vérifier si la collection existe et contient des données
        const count = await this.chromaService.getCount();
        this.logger.log(`Nombre d'éléments dans la collection: ${count}`);

        // Charger les requêtes SQL
        this.logger.log('Chargement des requêtes SQL...');
        const result = await this.sqlQueriesService.resetSqlQueriesCollection();
        this.logger.log(`Initialisation terminée: ${result.message}`);
      } catch (error) {
        // Si l'erreur concerne une collection inexistante, on l'initialise
        this.logger.error(
          'Erreur lors de la vérification/initialisation:',
          error,
        );
        this.logger.log("Nouvelle tentative d'initialisation...");

        // Attendre un peu et réessayer
        await new Promise((resolve) => setTimeout(resolve, 3000));

        const result = await this.sqlQueriesService.resetSqlQueriesCollection();
        this.logger.log(`Initialisation forcée terminée: ${result.message}`);
      }
    } catch (error) {
      this.logger.error("Erreur lors de l'initialisation de ChromaDB:", error);
      // On ne relance pas l'erreur pour permettre au service de démarrer quand même
    }
  }
}
