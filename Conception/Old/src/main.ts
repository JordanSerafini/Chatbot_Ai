import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ?? 3001);
}
bootstrap().catch((error) => {
  console.error("Erreur lors du démarrage de l'application:", error);
  process.exit(1);
});
