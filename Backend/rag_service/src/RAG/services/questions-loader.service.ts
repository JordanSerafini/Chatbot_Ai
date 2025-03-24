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
    await this.loadAllQuestions();
  }

  private async loadAllQuestions() {
    const questions: Question[] = [];
    const queryDir = path.join(process.cwd(), 'Database', 'Query');

    for (const file of this.queryFiles) {
      try {
        const filePath = path.join(queryDir, file);
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

    if (questions.length > 0) {
      try {
        await this.chromaService.deleteCollection();
        await this.chromaService.addQuestions(questions);
        this.logger.log(
          `${questions.length} questions chargées avec succès dans ChromaDB`,
        );
      } catch (error) {
        this.logger.error(
          "Erreur lors de l'ajout des questions dans ChromaDB:",
          error,
        );
      }
    }
  }
}
