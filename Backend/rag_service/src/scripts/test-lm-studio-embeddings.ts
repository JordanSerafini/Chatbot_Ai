import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { ChromaService } from '../services/chroma.service';
import { Logger } from '@nestjs/common';
import { LmStudioEmbeddingFunction } from '../services/lm-studio-embedding';
import { ConfigService } from '@nestjs/config';

async function testLmStudioEmbeddings() {
  const logger = new Logger('TestLmStudioEmbeddings');
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const chromaService = app.get(ChromaService);

  try {
    // Test des embeddings via LmStudioEmbeddingFunction
    logger.log("Test du service d'embeddings LM Studio...");

    const embeddingFunction = new LmStudioEmbeddingFunction(configService);
    const testTexts = [
      'Comment obtenir la liste des clients actifs ?',
      'Quels sont les projets en cours ?',
      'Montrez-moi les factures impayées',
    ];

    logger.log('Génération des embeddings pour les exemples...');
    const embeddings = await embeddingFunction.generate(testTexts);

    logger.log(`Nombre d'embeddings générés: ${embeddings.length}`);
    if (embeddings.length > 0) {
      logger.log(`Dimension des embeddings: ${embeddings[0].length}`);

      // Afficher un échantillon du premier embedding
      logger.log(
        `Échantillon du premier embedding: [${embeddings[0].slice(0, 5).join(', ')}...]`,
      );
    }

    // Test de l'ajout de questions avec les embeddings LM Studio
    logger.log(
      "\nTest d'ajout de questions à ChromaDB avec embeddings LM Studio...",
    );
    const testQuestions = [
      {
        id: 'lm1',
        question:
          'Pouvez-vous me montrer les clients qui ont des factures impayées?',
        sql: 'SELECT c.* FROM clients c JOIN factures f ON c.id = f.client_id WHERE f.statut = "impayée"',
        description: 'Liste des clients avec factures impayées',
      },
      {
        id: 'lm2',
        question: 'Quels sont les projets qui ont dépassé leur budget?',
        sql: 'SELECT * FROM projets WHERE cout_actuel > budget_initial',
        description: 'Projets dépassant leur budget',
      },
      {
        id: 'lm3',
        question:
          'Montrez-moi les employés qui travaillent sur plus de 3 projets',
        sql: 'SELECT e.* FROM employes e JOIN affectations a ON e.id = a.employe_id GROUP BY e.id HAVING COUNT(DISTINCT a.projet_id) > 3',
        description: 'Employés affectés à plus de 3 projets',
      },
    ];

    await chromaService.addQuestions(testQuestions);

    // Tester une recherche de similarité
    logger.log('\nTest de recherche de questions similaires...');
    const query = "Qui sont les clients qui n'ont pas payé leurs factures?";
    logger.log(`Recherche pour: "${query}"`);

    const similarQuestions = await chromaService.findSimilarQuestions(query, 2);
    logger.log(`Résultats: ${JSON.stringify(similarQuestions, null, 2)}`);

    await app.close();
  } catch (error) {
    logger.error(`Erreur lors du test: ${error.message}`);
    if (error.stack) {
      logger.error(error.stack);
    }
    await app.close();
    process.exit(1);
  }
}

// Exécution du test
testLmStudioEmbeddings().catch((err) => {
  console.error('Erreur non capturée:', err);
  process.exit(1);
});
