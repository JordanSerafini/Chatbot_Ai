import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { ChromaService } from '../services/chroma.service';
import { Logger } from '@nestjs/common';

async function resetCollection() {
  const logger = new Logger('ResetCollection');
  const app = await NestFactory.create(AppModule);
  const chromaService = app.get(ChromaService);

  try {
    logger.log('Suppression de la collection existante...');
    await chromaService.deleteCollection();
    logger.log('Collection supprimée avec succès');
  } catch (error) {
    logger.error('Erreur lors de la suppression de la collection:', error);
  } finally {
    await app.close();
  }
}

resetCollection().catch((error) => {
  console.error('Erreur fatale:', error);
  process.exit(1);
});
