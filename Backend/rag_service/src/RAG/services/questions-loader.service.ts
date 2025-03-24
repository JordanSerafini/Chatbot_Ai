import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ChromaService } from '../../services/chroma.service';
import { Question } from '../../interfaces/question.interface';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class QuestionsLoaderService implements OnModuleInit {
  private readonly logger = new Logger(QuestionsLoaderService.name);
  private readonly queryFiles = [
    'clients.query.json',
    'invoices.query.json',
    'planning.query.json',
    'projects.query.json',
  ];

  constructor(
    private readonly chromaService: ChromaService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    await this.waitForChromaDBReady();
    await this.loadAllQuestions();
  }

  private async waitForChromaDBReady(): Promise<void> {
    this.logger.log('Attente de la disponibilité de ChromaDB...');
    let isReady = false;
    let attempts = 0;
    const maxAttempts = 10;

    while (!isReady && attempts < maxAttempts) {
      try {
        // Tenter une opération simple pour vérifier si ChromaDB est prêt
        await this.chromaService.checkHealth();
        isReady = true;
        this.logger.log('ChromaDB est prêt');
      } catch (error) {
        console.log(error);
        attempts++;
        this.logger.warn(
          `ChromaDB n'est pas encore prêt (tentative ${attempts}/${maxAttempts})`,
        );
        // Attendre avant de réessayer avec un backoff exponentiel
        await new Promise((resolve) =>
          setTimeout(resolve, 1000 * Math.pow(1.5, attempts)),
        );
      }
    }

    if (!isReady) {
      this.logger.error(
        "ChromaDB n'est pas disponible après plusieurs tentatives. Continuer quand même...",
      );
    }
  }

  private async loadAllQuestions() {
    const questions: Question[] = [];

    // Définir plusieurs chemins possibles pour trouver les fichiers
    const possiblePaths = [
      // Chemin dans le conteneur Docker
      '/chroma_db/Query',
      // Chemin relatif dans l'environnement de développement
      path.join(process.cwd(), '../chroma_db/Query'),
      // Chemin absolu basé sur la configuration
      this.configService.get<string>('app.paths.queryDir'),
      // Autres alternatives
      path.join(process.cwd(), 'query'),
      path.join(process.cwd(), '..', '..', 'chroma_db', 'Query'),
    ].filter(Boolean); // Filtrer les chemins null/undefined

    this.logger.log(
      `Tentative de chargement des requêtes depuis plusieurs chemins possibles`,
    );

    let loaded = false;
    for (const queryDir of possiblePaths) {
      if (!queryDir) continue;

      this.logger.log(`Tentative avec le chemin : ${queryDir}`);

      // Vérifier d'abord si le répertoire existe
      try {
        await fs.access(queryDir);
        this.logger.log(`Répertoire trouvé : ${queryDir}`);

        let hasLoadedFiles = false;

        for (const file of this.queryFiles) {
          try {
            const filePath = path.join(queryDir, file);
            this.logger.log(`Lecture du fichier : ${filePath}`);

            // Vérifier si le fichier existe avant de le lire
            try {
              await fs.access(filePath);
            } catch {
              this.logger.warn(
                `Le fichier ${filePath} n'existe pas, passage au suivant`,
              );
              continue;
            }

            const fileContent = await fs.readFile(filePath, 'utf-8');
            const data = JSON.parse(fileContent);

            if (data.queries) {
              for (const query of data.queries) {
                // Pour chaque variante de question
                query.questions.forEach((question: string, index: number) => {
                  questions.push({
                    id: `${query.id}-${index}`,
                    question,
                    sql: query.sql,
                    description: query.description,
                    parameters: query.parameters || [],
                  });
                });
              }
              hasLoadedFiles = true;
            }
          } catch (error) {
            this.logger.error(
              `Erreur lors du chargement du fichier ${file}:`,
              error,
            );
          }
        }

        if (hasLoadedFiles) {
          this.logger.log(`Fichiers chargés avec succès depuis : ${queryDir}`);
          loaded = true;
          break; // Sortir de la boucle des chemins si les fichiers ont été chargés
        }
      } catch (error) {
        console.log(error);
        this.logger.warn(
          `Le répertoire ${queryDir} n'existe pas ou n'est pas accessible`,
        );
      }
    }

    if (!loaded) {
      this.logger.error(
        "Aucun fichier de requêtes n'a pu être chargé depuis les chemins disponibles",
      );
    }

    this.logger.log(`Nombre total de questions chargées: ${questions.length}`);

    if (questions.length > 0) {
      await this.loadQuestionsToChroma(questions);
    }
  }

  private async loadQuestionsToChroma(questions: Question[]): Promise<void> {
    try {
      // Supprimer et recréer la collection pour s'assurer qu'elle est propre
      try {
        await this.chromaService.deleteCollection();
        this.logger.log('Collection supprimée avec succès');
      } catch (deleteError) {
        this.logger.warn(
          "Impossible de supprimer la collection, elle n'existe peut-être pas encore:",
          deleteError,
        );
      }

      // Utiliser un délai adaptatif au lieu d'un délai fixe
      const delay = this.configService.get<number>('CHROMA_OP_DELAY') || 1000;
      await new Promise((resolve) => setTimeout(resolve, delay));

      try {
        await this.chromaService.addQuestions(questions);
        this.logger.log(
          `${questions.length} questions chargées avec succès dans ChromaDB`,
        );
      } catch (addError) {
        this.logger.error(
          "Erreur lors de l'ajout des questions dans ChromaDB:",
          addError,
        );

        // Réessayer avec un délai adaptatif
        const retryDelay =
          this.configService.get<number>('CHROMA_RETRY_DELAY') || 2000;
        this.logger.log(
          `Nouvel essai d'ajout des questions après ${retryDelay}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
        await this.chromaService.addQuestions(questions);
      }
    } catch (error) {
      this.logger.error(
        "Erreur générale lors de l'opération avec ChromaDB:",
        error,
      );
    }
  }
}
