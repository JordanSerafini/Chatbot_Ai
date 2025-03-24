import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ChromaService } from '../../services/chroma.service';
import { Question } from '../../interfaces/question.interface';
import * as fs from 'fs/promises';
import * as path from 'path';

@Injectable()
export class QuestionsLoaderService implements OnModuleInit {
  private readonly logger = new Logger(QuestionsLoaderService.name);
  private readonly queryFiles = [
    'clients.query.json',
    'invoices.query.json',
    'planning.query.json',
    'projects.query.json',
  ];

  constructor(private readonly chromaService: ChromaService) {}

  async onModuleInit() {
    // Attendre que ChromaDB soit complètement démarré
    await new Promise((resolve) => setTimeout(resolve, 5000));
    await this.loadAllQuestions();
  }

  private async loadAllQuestions() {
    const questions: Question[] = [];
    const queryDir = path.join(process.cwd(), 'query');

    this.logger.log(`Chargement des requêtes depuis : ${queryDir}`);

    for (const file of this.queryFiles) {
      try {
        const filePath = path.join(queryDir, file);
        this.logger.log(`Lecture du fichier : ${filePath}`);
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
              });
            });
          }
        }
      } catch (error) {
        this.logger.error(
          `Erreur lors du chargement du fichier ${file}:`,
          error,
        );
      }
    }

    this.logger.log(`Nombre total de questions chargées: ${questions.length}`);

    if (questions.length > 0) {
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

        // Attendre un peu que la suppression soit effective
        await new Promise((resolve) => setTimeout(resolve, 2000));

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

          // Réessayer une dernière fois après un délai
          this.logger.log("Nouvel essai d'ajout des questions après délai...");
          await new Promise((resolve) => setTimeout(resolve, 3000));
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
}
