import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Activer CORS
  app.enableCors({
    origin: true, // Permet toutes les origines en développement
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  // Activer la validation globale des requêtes
  app.useGlobalPipes(new ValidationPipe({
    transform: true,
    whitelist: true,
  }));
  console.log("serveur lancer sur le port", process.env.PORT);
  await app.listen(process.env.PORT ?? 3001);
}
bootstrap().catch((error) => {
  console.error("Erreur lors du démarrage de l'application:", error);
  process.exit(1);
});
