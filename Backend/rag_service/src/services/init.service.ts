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
      // Augmenter ce délai car ChromaDB peut prendre plus de temps à démarrer
      this.logger.log('Attente du démarrage complet de ChromaDB...');
      await new Promise((resolve) => setTimeout(resolve, 10000));

      // Vérifier la santé de ChromaDB
      this.logger.log('Vérification de la santé de ChromaDB...');
      let chromeReady = false;
      let attempts = 0;
      while (!chromeReady && attempts < 5) {
        try {
          await this.chromaService.checkHealth();
          chromeReady = true;
          this.logger.log('ChromaDB est prêt !');
        } catch (err) {
          attempts++;
          this.logger.warn(
            `ChromaDB n'est pas prêt (tentative ${attempts}/5), nouvelle tentative dans 5 secondes... Erreur: ${err.message}`,
          );
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }
      }

      if (!chromeReady) {
        this.logger.error(
          "ChromaDB n'est pas disponible après plusieurs tentatives",
        );
        return;
      }

      // Vérifier si la collection contient déjà des données avant de la réinitialiser
      const count = await this.chromaService.getCount();
      this.logger.log(`Collection existante contient ${count} éléments`);

      // Toujours réinitialiser la collection pour s'assurer qu'elle est correctement configurée
      this.logger.log('Réinitialisation de la collection...');
      await this.chromaService.deleteCollection();
      this.logger.log('Collection réinitialisée avec succès');

      // Attendre un peu pour que ChromaDB traite la création de la collection
      await new Promise((resolve) => setTimeout(resolve, 3000));

      try {
        // Vérifier à nouveau le compte
        const newCount = await this.chromaService.getCount();
        this.logger.log(`Nombre d'éléments dans la collection: ${newCount}`);

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
        await new Promise((resolve) => setTimeout(resolve, 5000));

        const result = await this.sqlQueriesService.resetSqlQueriesCollection();
        this.logger.log(`Initialisation forcée terminée: ${result.message}`);
      }
    } catch (error) {
      this.logger.error("Erreur lors de l'initialisation de ChromaDB:", error);
      // On ne relance pas l'erreur pour permettre au service de démarrer quand même
    }
  }
}
