import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { ChromaService } from '../services/chroma.service';
import { Logger } from '@nestjs/common';
import { DefaultEmbeddingFunction } from 'chromadb';

async function testEmbeddings() {
  const logger = new Logger('TestEmbeddings');
  const app = await NestFactory.create(AppModule);
  const chromaService = app.get(ChromaService);

  try {
    // Test des embeddings via DefaultEmbeddingFunction
    logger.log(
      "Test du service d'embeddings par défaut (DefaultEmbeddingFunction)...",
    );

    const embeddingFunction = new DefaultEmbeddingFunction();
    const testTexts = [
      'Comment obtenir la liste des clients actifs ?',
      'Quels sont les projets en cours ?',
      'Montrez-moi les factures impayées',
    ];

    logger.log('Génération des embeddings pour les exemples...');
    const embeddings = await embeddingFunction.generate(testTexts);

    logger.log(`Nombre d'embeddings générés: ${embeddings.length}`);
    logger.log(`Dimension des embeddings: ${embeddings[0].length}`);

    // Test de l'ajout de questions
    logger.log("\nTest d'ajout de questions à ChromaDB...");
    const testQuestions = [
      {
        id: 'q1',
        question: 'Comment obtenir la liste des clients actifs ?',
        sql: 'SELECT * FROM clients WHERE actif = true',
        description: 'Requête listant tous les clients actifs',
      },
      {
        id: 'q2',
        question: 'Quels sont les projets en cours ?',
        sql: 'SELECT * FROM projets WHERE statut = "en_cours"',
        description: 'Requête listant tous les projets en cours',
      },
      {
        id: 'q3',
        question: 'Montrez-moi les factures impayées',
        sql: 'SELECT * FROM factures WHERE statut = "impayée"',
        description: 'Requête listant toutes les factures impayées',
      },
    ];

    await chromaService.addQuestions(testQuestions);
    logger.log('Questions ajoutées avec succès');

    // Test de la recherche sémantique
    logger.log('\nTest de la recherche sémantique...');
    const results = await chromaService.findSimilarQuestions(
      'Comment voir les clients qui ont des factures en retard ?',
      3,
    );

    logger.log('Résultats de la recherche:');
    results.forEach((result, index) => {
      logger.log(`\nRésultat ${index + 1}:`);
      logger.log(`Question: ${result.question}`);
      logger.log(`Score de similarité: ${result.distance}`);
      logger.log(`SQL: ${result.metadata.sql}`);
    });
  } catch (error) {
    logger.error('Erreur lors des tests:', error);
  } finally {
    await app.close();
  }
}

testEmbeddings().catch((error) => {
  console.error('Erreur fatale:', error);
  process.exit(1);
});
