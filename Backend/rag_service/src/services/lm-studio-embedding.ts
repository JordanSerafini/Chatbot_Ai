import { Logger } from '@nestjs/common';
import axios from 'axios';
import { IEmbeddingFunction } from 'chromadb';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

/**
 * Classe qui implémente une fonction d'embedding utilisant LM Studio
 * Cette classe est compatible avec l'interface IEmbeddingFunction de ChromaDB
 */
export class LmStudioEmbeddingFunction implements IEmbeddingFunction {
  private readonly logger = new Logger(LmStudioEmbeddingFunction.name);
  private lmStudioUrl: string; // Suppression de readonly pour permettre la modification
  // Cache des embeddings pour éviter de recalculer les mêmes textes
  private embeddingCache: Map<string, number[]> = new Map();
  // Version API (v1 ou non)
  private isApiV1: boolean = true;
  // Flag pour vérifier si l'API d'embeddings native est disponible
  private hasEmbeddingsApi: boolean = true;
  // Flag pour vérifier si la vérification initiale a été effectuée
  private initialCheckDone: boolean = false;
  // Compteurs pour la progression
  private processedCount: number = 0;
  private totalCount: number = 0;
  private startTime: number = 0;
  private lastLogTime: number = 0;
  private readonly LOG_INTERVAL: number = 5000; // Intervalle entre les logs en ms (5 secondes)

  constructor(private configService: ConfigService) {
    this.lmStudioUrl = this.getLmStudioUrl();
    this.logger.log(
      `LmStudioEmbeddingFunction initialized with URL: ${this.lmStudioUrl}`,
    );
    // Détecter automatiquement la version de l'API
    void this.detectApiVersion(); // Utilisation de void pour ignorer explicitement la promesse
    // Vérifier une seule fois au démarrage si l'API d'embeddings est disponible
    void this.checkEmbeddingsApiAvailability();
  }

  private async checkEmbeddingsApiAvailability(): Promise<void> {
    try {
      // Essai avec un texte très court et un timeout réduit
      await axios.post(
        `${this.lmStudioUrl}/embeddings`,
        {
          input: 'test',
          model: 'embedding',
        },
        { timeout: 3000 }, // Timeout réduit pour un test rapide
      );

      this.hasEmbeddingsApi = true;
      this.logger.log('Embeddings API is available!');
    } catch (error) {
      console.log(error);

      this.hasEmbeddingsApi = false;
      this.logger.warn(
        'Embeddings API is not available. Will use chat API for embeddings generation.',
      );
    }
    this.initialCheckDone = true;
  }

  private async detectApiVersion(): Promise<void> {
    try {
      // Tenter d'accéder à l'API v1/models
      await axios.get(`${this.lmStudioUrl}/models`, { timeout: 5000 });
      this.isApiV1 = true;
      this.logger.log('Detected LM Studio API v1');
    } catch (error) {
      console.log(error);
      // Préfixer avec _ pour indiquer qu'il est intentionnellement non utilisé
      // Si échec, essayer sans le préfixe v1
      try {
        const baseUrl = this.lmStudioUrl.replace('/v1', '');
        await axios.get(`${baseUrl}/models`, { timeout: 5000 });
        this.lmStudioUrl = baseUrl;
        this.isApiV1 = false;
        this.logger.log('Detected non-v1 LM Studio API');
      } catch (secondError) {
        console.log(secondError);

        // Préfixer avec _ pour indiquer qu'il est intentionnellement non utilisé
        this.logger.warn(
          'Could not detect API version, defaulting to v1. Embeddings may not work correctly.',
        );
      }
    }
  }

  private getLmStudioUrl(): string {
    const url =
      this.configService.get<string>('LM_STUDIO_URL') ||
      'https://7b90-2a01-cb15-4c5-c200-ff2e-b498-e114-f0c2.ngrok-free.app';

    // Assurer que l'URL se termine par /v1 si nécessaire
    if (!url.endsWith('/v1')) {
      return `${url}/v1`;
    }
    return url;
  }

  /**
   * Génère des embeddings pour les textes fournis
   * @param texts Tableau de textes à encoder
   * @returns Promise avec un tableau de vecteurs d'embedding
   */
  async generate(texts: string[]): Promise<number[][]> {
    this.totalCount = texts.length;
    this.processedCount = 0;
    this.startTime = Date.now();
    this.lastLogTime = this.startTime;

    this.logger.log(
      `Démarrage de la génération d'embeddings pour ${this.totalCount} textes avec LM Studio...`,
    );

    // Attendre que la vérification initiale soit terminée
    if (!this.initialCheckDone) {
      await this.checkEmbeddingsApiAvailability();
    }

    try {
      const embeddings: number[][] = [];
      const cachedCount = texts.filter((text) =>
        this.embeddingCache.has(this.hashText(text)),
      ).length;
      if (cachedCount > 0) {
        this.logger.log(
          `${cachedCount} textes déjà en cache (${Math.round((cachedCount / this.totalCount) * 100)}%)`,
        );
      }

      // Traiter chaque texte individuellement pour plus de robustesse
      for (const text of texts) {
        const embedding = await this.generateSingleEmbedding(text);
        embeddings.push(embedding);

        // Incrémenter le compteur et afficher la progression
        this.processedCount++;
        this.logProgress();
      }

      const totalTime = Math.round((Date.now() - this.startTime) / 1000);
      this.logger.log(
        `Terminé! ${this.totalCount} embeddings générés en ${this.formatTime(totalTime)}.`,
      );
      return embeddings;
    } catch (error) {
      this.logger.error(`Error generating embeddings: ${error.message}`);
      throw new Error(`Failed to generate embeddings: ${error.message}`);
    }
  }

  /**
   * Affiche la progression du traitement des embeddings
   */
  private logProgress(): void {
    const now = Date.now();
    // Vérifier si le temps écoulé depuis le dernier log est suffisant ou si c'est le dernier élément
    if (
      now - this.lastLogTime >= this.LOG_INTERVAL ||
      this.processedCount === this.totalCount
    ) {
      this.lastLogTime = now;

      const progress = Math.round(
        (this.processedCount / this.totalCount) * 100,
      );
      const elapsedTime = now - this.startTime;
      const estimatedTotalTime =
        (this.totalCount * elapsedTime) / this.processedCount;
      const remainingTime = Math.max(0, estimatedTotalTime - elapsedTime);

      this.logger.log(
        `Progression: ${this.processedCount}/${this.totalCount} (${progress}%) - Temps restant estimé: ${this.formatTime(remainingTime / 1000)}`,
      );
    }
  }

  /**
   * Formate le temps en heures, minutes et secondes
   */
  private formatTime(seconds: number): string {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hrs > 0) {
      return `${hrs}h ${mins}m ${secs}s`;
    } else if (mins > 0) {
      return `${mins}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  }

  /**
   * Génère un embedding pour un seul texte en utilisant l'API de chat/completions
   * @param text Texte à encoder
   * @returns Vecteur d'embedding
   */
  private async generateSingleEmbedding(text: string): Promise<number[]> {
    // Hasher le texte pour l'utiliser comme clé de cache
    const textHash = this.hashText(text);

    // Vérifier si l'embedding est déjà en cache
    const cachedEmbedding = this.embeddingCache.get(textHash);
    if (cachedEmbedding) {
      // Vérifier si cachedEmbedding est défini
      return cachedEmbedding;
    }

    try {
      // Si l'API d'embeddings est disponible, l'utiliser, sinon passer directement à l'API de chat
      if (this.hasEmbeddingsApi) {
        try {
          const response = await axios.post(
            `${this.lmStudioUrl}/embeddings`,
            {
              input: text,
              model: 'embedding',
            },
            { timeout: 10000 },
          );

          // Si ça fonctionne, utiliser l'embedding retourné
          const embedding = response.data.data[0].embedding;
          // Mettre en cache
          this.embeddingCache.set(textHash, embedding);
          return embedding;
        } catch (embeddingError) {
          // Si c'est la première erreur, désactiver l'API d'embeddings pour les futurs appels
          if (this.hasEmbeddingsApi) {
            this.hasEmbeddingsApi = false;
            this.logger.warn(
              `Embeddings API not available: ${embeddingError.message}. Falling back to chat API for all future requests.`,
            );
          }

          // Continuer avec l'API de chat
        }
      }

      // Utiliser l'API de chat comme alternative
      // Déterminer l'endpoint de chat à utiliser
      const chatEndpoint = this.isApiV1
        ? '/chat/completions'
        : '/v1/chat/completions';

      // Utiliser l'API de chat pour générer une représentation du texte
      const response = await axios.post(
        this.lmStudioUrl + chatEndpoint,
        {
          messages: [
            {
              role: 'system',
              content:
                'Extract all key concepts and themes from the following text as a comma-separated list.',
            },
            { role: 'user', content: text },
          ],
          temperature: 0.1,
          max_tokens: 50,
        },
        { timeout: 10000 },
      );

      // Extraire le texte généré
      let chatResponse;
      if (response.data.choices && response.data.choices.length > 0) {
        chatResponse = response.data.choices[0].message?.content || '';
      } else {
        chatResponse = '';
      }

      // Convertir la réponse textuelle en vecteur numérique
      const embedding = this.textToVector(chatResponse, text);
      // Mettre en cache
      this.embeddingCache.set(textHash, embedding);
      return embedding;
    } catch (error) {
      this.logger.error(
        `Error generating embedding for text: ${error.message}`,
      );

      // En cas d'erreur, retourner un embedding de secours (vecteur aléatoire)
      this.logger.warn('Returning fallback embedding (random vector)');
      const fallbackEmbedding = this.textToVector(text, '');
      // Ne pas mettre en cache les embeddings de secours
      return fallbackEmbedding;
    }
  }

  /**
   * Convertit une chaîne de texte en vecteur numérique
   * @param text Le texte à convertir
   * @param seed Texte supplémentaire pour aider à générer un vecteur plus unique
   * @returns Vecteur d'embedding (384 dimensions)
   */
  private textToVector(text: string, seed: string): number[] {
    const combinedText = text + seed;
    const normalizedText = combinedText.toLowerCase();

    // Créer un vecteur de 384 dimensions (taille typique d'un embedding)
    const embedding = new Array(384).fill(0);

    // Utiliser un hash SHA-256 pour générer des nombres à partir du texte
    const hash = crypto
      .createHash('sha256')
      .update(normalizedText)
      .digest('hex');

    // Utiliser le hash pour initialiser un générateur de nombres pseudo-aléatoires
    const seededRandom = (index: number): number => {
      const hashPart = hash.substring(index % 64, (index % 64) + 8);
      const value = parseInt(hashPart, 16);
      return (value / 0xffffffff) * 2 - 1; // Valeur entre -1 et 1
    };

    // Remplir le vecteur avec des valeurs dérivées du texte
    for (let i = 0; i < normalizedText.length && i < 100; i++) {
      const charCode = normalizedText.charCodeAt(i);
      const baseIndex = (i * 3) % 384;

      // Affecter 3 dimensions par caractère
      embedding[baseIndex % 384] = (charCode / 255) * 2 - 1;
      embedding[(baseIndex + 1) % 384] = Math.sin(charCode / 20);
      embedding[(baseIndex + 2) % 384] = Math.cos(charCode / 30);
    }

    // Compléter le reste du vecteur avec des valeurs déterministes
    for (let i = 0; i < 384; i++) {
      if (embedding[i] === 0) {
        embedding[i] = seededRandom(i);
      }
    }

    // Normaliser le vecteur
    const magnitude = Math.sqrt(
      embedding.reduce((sum, value) => sum + value * value, 0),
    );

    return embedding.map((value) => value / (magnitude || 1));
  }

  /**
   * Hache un texte pour créer une clé de cache
   */
  private hashText(text: string): string {
    return crypto.createHash('md5').update(text).digest('hex');
  }
}
