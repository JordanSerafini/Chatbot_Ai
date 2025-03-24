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
      // Attendre un peu que ChromaDB soit complètement démarré
      await new Promise((resolve) => setTimeout(resolve, 3000));
      
      try {
        // Vérifier si la collection existe et contient des données
        const count = await this.chromaService.getCount();

        if (count === 0) {
          this.logger.log(
            'Aucune donnée trouvée dans ChromaDB. Initialisation...',
          );

          // Charger les requêtes SQL
          const result = await this.sqlQueriesService.resetSqlQueriesCollection();

          this.logger.log(`Initialisation terminée: ${result.message}`);
        } else {
          this.logger.log(
            `Base ChromaDB déjà initialisée avec ${count} documents`,
          );
        }
      } catch (error) {
        // Si l'erreur concerne une collection inexistante, on l'initialise
        if (error.message && error.message.includes('does not exist')) {
          this.logger.log('Collection inexistante, initialisation...');
          const result = await this.sqlQueriesService.resetSqlQueriesCollection();
          this.logger.log(`Initialisation forcée terminée: ${result.message}`);
        } else {
          throw error;
        }
      }
    } catch (error) {
      this.logger.error("Erreur lors de l'initialisation de ChromaDB:", error);
      // On ne relance pas l'erreur pour permettre au service de démarrer quand même
    }
  }
}
