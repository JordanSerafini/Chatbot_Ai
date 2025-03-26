import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { ChromaService } from '../../services/chroma.service';
import { Logger } from '@nestjs/common';
import axios from 'axios';

async function testEmbeddings() {
  const logger = new Logger('TestEmbeddings');
  const app = await NestFactory.create(AppModule);
  const chromaService = app.get(ChromaService);

  try {
    // Test du service d'embeddings
    logger.log("Test du service d'embeddings...");
    const testTexts = [
      'Comment obtenir la liste des clients actifs ?',
      'Quels sont les projets en cours ?',
      'Montrez-moi les factures impayées',
    ];

    const response = await axios.post('http://embedding-service:8001/embed', {
      texts: testTexts,
    });

    logger.log("Réponse du service d'embeddings:");
    logger.log(
      `Nombre d'embeddings générés: ${response.data.embeddings.length}`,
    );
    logger.log(
      `Dimension des embeddings: ${response.data.embeddings[0].length}`,
    );

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

testEmbeddings();
