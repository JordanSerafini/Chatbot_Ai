import { Injectable, Logger } from '@nestjs/common';
import { ChromaClient } from 'chromadb';
import { v4 as uuidv4 } from 'uuid';
import { ConfigService } from '@nestjs/config';

interface BestMatch {
  prompt: string;
  id: string;
  similarity: number;
  metadata?: Record<string, any>;
}

@Injectable()
export class RagService {
  private client: ChromaClient;
  private readonly logger = new Logger(RagService.name);
  private readonly collections = new Map();

  constructor(private configService: ConfigService) {
    this.client = new ChromaClient({
      path:
        this.configService.get<string>('CHROMA_URL') || 'http://ChromaDB:8000',
    });
    this.logger.log('Service RAG initialisé');
  }

  // Méthode pour obtenir une collection (avec mise en cache)
  private async getCollection(name: string) {
    if (this.collections.has(name)) {
      return this.collections.get(name);
    }

    try {
      // Pour la recherche en texte intégral, nous n'avons pas besoin d'une fonction d'embedding
      const collection = await this.client.getOrCreateCollection({
        name,
      });

      this.collections.set(name, collection);
      return collection;
    } catch (error) {
      this.logger.error(
        `Erreur lors de l'accès à la collection: ${error.message}`,
      );
      throw error;
    }
  }

  // Fonction utilitaire pour hacher un texte (identique à celle du ChromaService)
  private hashText(text: string): string {
    let hash = 0;
    if (text.length === 0) return hash.toString();

    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Conversion en un entier 32 bits
    }

    // Convertir en chaîne hexadécimale
    const hexHash = (hash >>> 0).toString(16);
    // Étendre le hash pour qu'il soit assez long
    const extendedHash = hexHash
      .repeat(Math.ceil(64 / hexHash.length))
      .slice(0, 64);

    return extendedHash;
  }

  async createCollection(name: string) {
    try {
      // Pour la recherche en texte intégral, nous n'avons pas besoin d'une fonction d'embedding
      const collection = await this.client.createCollection({
        name,
      });

      this.collections.set(name, collection);
      return collection;
    } catch (error) {
      this.logger.error(
        `Erreur lors de la création de la collection: ${error.message}`,
      );
      throw error;
    }
  }

  async getOrCreateCollection(name: string) {
    return this.getCollection(name);
  }

  async addDocuments(collectionName: string, documents: string[]) {
    try {
      const collection = await this.getCollection(collectionName);

      const ids = documents.map(() => uuidv4());

      await collection.add({
        documents,
        ids,
      });

      return { success: true, count: documents.length, ids };
    } catch (error) {
      this.logger.error(
        `Erreur lors de l'ajout de documents: ${error.message}`,
      );
      throw error;
    }
  }

  async upsertDocuments(
    collectionName: string,
    documents: string[],
    ids?: string[],
    metadatas?: Record<string, any>[],
  ) {
    try {
      const collection = await this.getCollection(collectionName);

      const documentIds = ids || documents.map(() => uuidv4());

      // Vérifier si les IDs existent déjà dans la collection
      const existingIds = new Set<string>();
      try {
        const allIds = await collection.get({
          include: ['metadatas'],
        });
        if (allIds && allIds.ids) {
          allIds.ids.forEach((id) => existingIds.add(id));
        }
      } catch (error) {
        this.logger.warn(
          `Impossible de récupérer les IDs existants: ${error.message}`,
        );
      }

      // Séparer les documents en deux groupes: à ajouter et à mettre à jour
      const toAdd = {
        documents: [] as string[],
        ids: [] as string[],
        metadatas: [] as Record<string, any>[],
      };

      const toUpdate = {
        documents: [] as string[],
        ids: [] as string[],
        metadatas: [] as Record<string, any>[],
      };

      // Classer chaque document
      for (let i = 0; i < documents.length; i++) {
        const id = documentIds[i];
        const metadata = metadatas ? metadatas[i] : undefined;

        if (existingIds.has(id)) {
          toUpdate.documents.push(documents[i]);
          toUpdate.ids.push(id);
          if (metadata) toUpdate.metadatas.push(metadata);
        } else {
          toAdd.documents.push(documents[i]);
          toAdd.ids.push(id);
          if (metadata) toAdd.metadatas.push(metadata);
        }
      }

      // Exécuter les opérations séparément
      const results = {
        added: 0,
        updated: 0,
        ids: documentIds,
        metadatas,
      };

      if (toAdd.documents.length > 0) {
        await collection.add({
          documents: toAdd.documents,
          ids: toAdd.ids,
          metadatas: toAdd.metadatas.length ? toAdd.metadatas : undefined,
        });
        results.added = toAdd.documents.length;
      }

      if (toUpdate.documents.length > 0) {
        await collection.update({
          documents: toUpdate.documents,
          ids: toUpdate.ids,
          metadatas: toUpdate.metadatas.length ? toUpdate.metadatas : undefined,
        });
        results.updated = toUpdate.documents.length;
      }

      this.logger.log(
        `Upsert terminé: ${results.added} ajoutés, ${results.updated} mis à jour`,
      );
      return {
        success: true,
        count: documents.length,
        ...results,
      };
    } catch (error) {
      this.logger.error(
        `Erreur lors de la mise à jour de documents: ${error.message}`,
      );
      throw error;
    }
  }

  async findSimilarDocuments(
    collectionName: string,
    query: string,
    limit: number = 10,
  ) {
    try {
      const collection = await this.getCollection(collectionName);

      return await collection.query({
        queryTexts: [query],
        nResults: limit,
        where: {},
      });
    } catch (error) {
      this.logger.error(
        `Erreur lors de la recherche de documents similaires: ${error.message}`,
      );
      throw error;
    }
  }

  async findSimilarPrompt(
    collectionName: string,
    prompt: string,
    similarityThreshold: number = 0.85,
  ) {
    try {
      // Créer la collection si elle n'existe pas déjà
      const collection = await this.getCollection(collectionName);
      const collectionInfo = await collection.count();

      if (collectionInfo === 0) {
        this.logger.log(
          `Collection ${collectionName} est vide, aucune recherche possible`,
        );
        return { found: false, reason: 'collection_empty' };
      }

      this.logger.log(
        `Recherche de similarité dans ${collectionName} avec seuil: ${similarityThreshold}`,
      );

      try {
        const results = await this.findSimilarDocuments(
          collectionName,
          prompt,
          5, // Récupérer 5 résultats pour augmenter les chances de trouver une correspondance
        );

        // Vérifier si des résultats ont été trouvés
        if (
          !results.distances ||
          !results.distances[0] ||
          !results.distances[0][0]
        ) {
          this.logger.warn(
            `Aucun résultat de similarité trouvé dans ${collectionName}, tentative de récupération directe`,
          );

          // Tenter de récupérer tous les documents de la collection
          try {
            const allDocuments = await collection.get({});

            if (allDocuments.documents && allDocuments.documents.length > 0) {
              // Vérifier si une correspondance exacte existe
              for (let i = 0; i < allDocuments.documents.length; i++) {
                const doc = allDocuments.documents[i];
                const similarity = this.calculateExactMatchScore(prompt, doc);

                // Si correspondance exacte ou très proche
                if (similarity >= 0.9) {
                  this.logger.log(
                    `Correspondance exacte trouvée via récupération directe: ${similarity}`,
                  );
                  return {
                    found: true,
                    prompt: doc,
                    id: allDocuments.ids[i],
                    similarity: similarity,
                    metadata: allDocuments.metadatas?.[i],
                  };
                }
              }

              // Vérifier si une correspondance approximative existe
              let bestMatch: BestMatch | null = null;
              let bestSimilarity = 0;

              for (let i = 0; i < allDocuments.documents.length; i++) {
                const doc = allDocuments.documents[i];
                const similarity = this.calculateSimilarityScore(prompt, doc);

                if (similarity > bestSimilarity) {
                  bestSimilarity = similarity;
                  bestMatch = {
                    prompt: doc,
                    id: allDocuments.ids[i],
                    similarity,
                    metadata: allDocuments.metadatas?.[i],
                  };
                }
              }

              if (bestMatch && bestSimilarity >= similarityThreshold) {
                this.logger.log(
                  `Meilleure correspondance trouvée via comparaison directe: ${bestSimilarity}`,
                );
                return {
                  found: true,
                  ...bestMatch,
                };
              } else if (bestMatch) {
                this.logger.log(
                  `Meilleure correspondance trouvée mais en dessous du seuil: ${bestSimilarity}`,
                );
                return {
                  found: false,
                  reason: 'below_threshold',
                  bestMatch: bestMatch.prompt,
                  similarity: bestSimilarity,
                };
              }
            }

            this.logger.warn(
              `Aucune correspondance trouvée parmi ${allDocuments.documents?.length || 0} documents`,
            );
            return { found: false, reason: 'no_match_in_collection' };
          } catch (listError) {
            this.logger.error(
              `Erreur lors de la récupération des documents: ${listError.message}`,
            );
            return {
              found: false,
              reason: 'list_error',
              error: listError.message,
            };
          }
        }

        const similarity = 1 - results.distances[0][0];
        this.logger.log(
          `Prompt trouvé avec similarité: ${similarity} (seuil: ${similarityThreshold})`,
        );

        if (similarity >= similarityThreshold) {
          return {
            found: true,
            prompt: results.documents?.[0]?.[0],
            id: results.ids?.[0]?.[0],
            similarity: similarity,
            metadata: results.metadatas?.[0]?.[0],
          };
        } else {
          this.logger.log(
            `Similarité ${similarity} inférieure au seuil ${similarityThreshold}`,
          );
          return {
            found: false,
            reason: 'below_threshold',
            similarity: similarity,
            bestMatch: results.documents?.[0]?.[0],
          };
        }
      } catch (queryError) {
        // Si la recherche échoue, tenter une approche différente
        this.logger.warn(`Recherche similaire échouée: ${queryError.message}`);
        return {
          found: false,
          reason: 'query_error',
          error: queryError.message,
        };
      }
    } catch (error) {
      this.logger.error(
        `Erreur lors de la recherche de prompt similaire: ${error.message}`,
      );
      return { found: false, reason: 'general_error', error: error.message };
    }
  }

  async deleteOldDocuments(collectionName: string, olderThanDays: number = 30) {
    try {
      const collection = await this.getCollection(collectionName);

      // Calculer la date limite
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
      const cutoffTimestamp = cutoffDate.toISOString();

      // Récupérer tous les documents avec leurs métadonnées
      const allDocs = await collection.get();

      // Filtrer les IDs à supprimer
      const idsToDelete: string[] = [];

      if (allDocs.ids && allDocs.metadatas) {
        for (let i = 0; i < allDocs.ids.length; i++) {
          const metadata = allDocs.metadatas[i];
          // Vérifier si ce document a un timestamp et s'il est plus ancien que la date limite
          if (
            metadata &&
            metadata.timestamp &&
            metadata.timestamp < cutoffTimestamp
          ) {
            idsToDelete.push(allDocs.ids[i]);
          }
        }
      }

      // Supprimer les documents si nécessaire
      if (idsToDelete.length > 0) {
        await collection.delete({
          ids: idsToDelete,
        });
        this.logger.log(
          `${idsToDelete.length} documents supprimés car plus anciens que ${olderThanDays} jours`,
        );
      }

      return {
        success: true,
        deletedCount: idsToDelete.length,
      };
    } catch (error) {
      this.logger.error(
        `Erreur lors de la suppression des anciens documents: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Calcule un score de similarité entre deux chaînes
   * Méthode simple pour la correspondance approximative
   */
  private calculateSimilarityScore(str1: string, str2: string): number {
    // Convertir en minuscules et supprimer la ponctuation
    const normalize = (s: string) => s.toLowerCase().replace(/[^\w\s]/g, '');

    const s1 = normalize(str1);
    const s2 = normalize(str2);

    // Compter les mots communs
    const words1 = s1.split(/\s+/).filter((w) => w.length > 2); // Ignorer les mots très courts
    const words2 = s2.split(/\s+/).filter((w) => w.length > 2);

    if (words1.length === 0 || words2.length === 0) return 0;

    // Mots-clés discriminants avec leur poids
    const keywordWeights = {
      personne: 2.0,
      personnel: 2.0,
      staff: 2.0,
      employe: 2.0,
      travaille: 1.5,
      projet: 2.0,
      quels: 1.5,
      quelles: 1.5,
      chantier: 1.5,
      mois: 1.0,
      semaine: 1.0,
      prochain: 1.0,
      prochaine: 1.0,
      commence: 1.5,
      démarre: 1.5,
      début: 1.5,
    };

    let commonWords = 0;
    let weightedCommonWords = 0;
    let totalWeight = 0;

    // Calculer les mots communs avec poids
    for (const word of words1) {
      const wordWeight = keywordWeights[word] || 1.0;
      totalWeight += wordWeight;

      if (words2.includes(word)) {
        commonWords++;
        weightedCommonWords += wordWeight;
      }
    }

    // Calculer le score Jaccard standard (intersection/union)
    const uniqueWords = new Set([...words1, ...words2]);
    const jaccardScore = commonWords / uniqueWords.size;

    // Calculer le score pondéré
    const weightedScore =
      totalWeight > 0 ? weightedCommonWords / totalWeight : 0;

    // Combiner les deux scores (70% poids sur le score pondéré, 30% sur Jaccard)
    return weightedScore * 0.7 + jaccardScore * 0.3;
  }

  /**
   * Vérifie si deux chaînes sont identiques ou très similaires
   */
  private calculateExactMatchScore(str1: string, str2: string): number {
    // Normaliser les chaînes pour la comparaison
    const normalize = (s: string) =>
      s
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    const s1 = normalize(str1);
    const s2 = normalize(str2);

    // Vérifier si les chaînes sont identiques
    if (s1 === s2) return 1.0;

    // Vérifier si l'une contient l'autre
    if (s1.includes(s2) || s2.includes(s1)) {
      const ratio =
        Math.min(s1.length, s2.length) / Math.max(s1.length, s2.length);
      // Si le ratio de longueur est élevé, c'est probablement la même question
      return ratio >= 0.8 ? 0.95 : 0.85;
    }

    return 0;
  }

  // Méthode pour trouver une question similaire dans le stockage
  private async findSimilarStoredQuestion(
    question: string,
    reformulatedQuestion: string,
  ): Promise<{
    found: boolean;
    queryId?: string;
    sql?: string;
    description?: string;
    similarity?: number;
    parameters?: any[];
  }> {
    try {
      const collection = await this.getCollection('questions_collection');
      if (!collection) {
        return { found: false };
      }

      const cleanInput = this.cleanText(question);

      // Recherche des questions similaires
      const result = await collection.query({
        queryTexts: [cleanInput],
        nResults: 10,
      });

      if (!result.ids || result.ids.length === 0 || !result.ids[0].length) {
        return { found: false };
      }

      // Analyser les résultats
      const questions = result.documents[0] as string[];
      const ids = result.ids[0] as string[];
      const metadatas = result.metadatas[0] as Record<string, any>[];
      const distances = result.distances ? result.distances[0] : [];

      // Calculer la similarité et sélectionner la meilleure correspondance
      const candidates = questions.map((q, i) => {
        // Utiliser une approche hybride - combinaison de la distance vectorielle et textuelle
        const vectorDistance = distances[i] || 0;
        const textSimilarity = this.calculateSimilarity(
          cleanInput,
          this.cleanText(q),
        );
        // Combiner les scores avec un poids plus important sur la similarité textuelle
        const combinedScore = 0.2 * (1 - vectorDistance) + 0.8 * textSimilarity;

        return {
          question: q,
          id: ids[i],
          metadata: metadatas[i],
          similarity: combinedScore,
        };
      });

      // Trier par score de similarité
      candidates.sort((a, b) => b.similarity - a.similarity);

      // Prendre la meilleure correspondance si elle dépasse le seuil (réduit à 0.4)
      const bestMatch = candidates[0];

      if (bestMatch && bestMatch.similarity > 0.4) {
        const queryId = bestMatch.id.split('-')[0];

        // Extraire les paramètres possibles de la requête
        const parameters = bestMatch.metadata.parameters || [];

        // Détecter les valeurs des paramètres dans la question de l'utilisateur
        const extractedParams = this.extractParametersFromQuestion(
          question,
          reformulatedQuestion,
          parameters,
        );

        return {
          found: true,
          queryId,
          sql: bestMatch.metadata.sql,
          description: bestMatch.metadata.description,
          similarity: bestMatch.similarity,
          parameters: extractedParams,
        };
      }

      return { found: false };
    } catch (error) {
      this.logger.error(
        'Erreur lors de la recherche de questions similaires:',
        error,
      );
      return { found: false };
    }
  }

  /**
   * Extrait les valeurs des paramètres depuis la question de l'utilisateur
   */
  private extractParametersFromQuestion(
    originalQuestion: string,
    reformulatedQuestion: string,
    parameters: Array<{ name: string; description: string }>,
  ): Array<{ name: string; value: string }> {
    if (!parameters || parameters.length === 0) {
      return [];
    }

    const extractedParams: Array<{ name: string; value: string }> = [];

    // Pour chaque paramètre défini
    for (const param of parameters) {
      const paramName = param.name;

      // Stratégies d'extraction de paramètres
      // 1. Recherche de motifs spécifiques (ex: "à Paris", "pour Paris")
      const cityPattern = new RegExp(
        `(?:à|de|pour|dans|sur)\\s+([A-ZÀ-Ú][a-zà-ú-]+)`,
        'i',
      );
      const datePattern = new RegExp(
        `(?:le|du|avant|après|depuis)\\s+(\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4})`,
        'i',
      );

      let extractedValue: string | null = null;

      // Appliquer la stratégie d'extraction appropriée selon le type de paramètre
      if (paramName === 'CITY') {
        const match =
          originalQuestion.match(cityPattern) ||
          reformulatedQuestion.match(cityPattern);
        if (match && match[1]) {
          extractedValue = match[1];
        }
      } else if (paramName.includes('DATE')) {
        const match =
          originalQuestion.match(datePattern) ||
          reformulatedQuestion.match(datePattern);
        if (match && match[1]) {
          extractedValue = match[1];
        }
      }

      // Si une valeur a été extraite, l'ajouter aux paramètres
      if (extractedValue) {
        extractedParams.push({
          name: paramName,
          value: extractedValue,
        });
      }
    }

    return extractedParams;
  }

  // Nettoyer le texte pour une meilleure comparaison
  private cleanText(text: string): string {
    if (!text) return '';

    return text
      .toLowerCase()
      // Normaliser les caractères accentués
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      // Supprimer la ponctuation
      .replace(/[.,/#!$%&*;:{}=\-_`~()]/g, '')
      // Réduire les espaces multiples
      .replace(/\s{2,}/g, ' ')
      // Supprimer les articles et mots communs qui n'aident pas à la comparaison sémantique
      .replace(/\b(le|la|les|un|une|des|du|de|l'|d'|et|ou|a|à|au|aux|en|pour|par|sur|dans|avec|qui|que|quoi|dont|où|comment|quand|pourquoi|quel|quelle|quels|quelles|ce|cette|ces|mon|ma|mes|ton|ta|tes|son|sa|ses)\b/g, ' ')
      .trim();
  }

  // Calculer la similarité entre deux textes (méthode améliorée basée sur les mots communs et importants)
  private calculateSimilarity(text1: string, text2: string): number {
    // Nettoyer les textes
    const cleanedText1 = this.cleanText(text1);
    const cleanedText2 = this.cleanText(text2);

    // Extraire les mots
    const words1 = cleanedText1.split(/\s+/).filter(word => word.length > 1);
    const words2 = cleanedText2.split(/\s+/).filter(word => word.length > 1);

    if (words1.length === 0 || words2.length === 0) return 0;

    // Mots-clés importants avec leur poids pour le domaine (chantiers, projets, etc.)
    const keywordWeights = {
      'chantier': 2,
      'chantiers': 2,
      'projet': 2,
      'projets': 2,
      'annee': 2,
      'année': 2,
      'cette': 1.5,
      'actuel': 1.5,
      'actuels': 1.5,
      'en': 1,
      'cours': 1,
      'prevu': 1.5,
      'prévus': 1.5,
      'planifié': 1.5,
      'planifiés': 1.5
    };

    // Calculer un score pondéré pour les mots communs
    let matchScore = 0;
    let totalWeight = 0;

    // Pour chaque mot du premier texte
    for (const word of words1) {
      const baseWeight = keywordWeights[word] || 1;
      totalWeight += baseWeight;

      // Si le mot exact existe dans le deuxième texte
      if (words2.includes(word)) {
        matchScore += baseWeight;
        continue;
      }

      // Recherche de mots similaires (distance de Levenshtein simplifiée)
      const similarWord = words2.find(w2 => {
        // Pour les mots courts, autoriser seulement 1 différence, pour les plus longs, 2
        const maxDiff = word.length <= 5 ? 1 : 2;
        // Différence de longueur trop importante
        if (Math.abs(word.length - w2.length) > maxDiff) return false;
        
        // Compter les différences de caractères (algo simplifié)
        let diffCount = 0;
        for (let i = 0; i < Math.min(word.length, w2.length); i++) {
          if (word[i] !== w2[i]) diffCount++;
          if (diffCount > maxDiff) return false;
        }
        return true;
      });

      if (similarWord) {
        matchScore += baseWeight * 0.8; // Score légèrement réduit pour les mots similaires
      }
    }

    // S'il n'y a pas de poids total, retourner 0
    if (totalWeight === 0) return 0;

    // Normaliser le score par rapport au poids total
    return matchScore / totalWeight;
  }

  // Fonction utilitaire pour calculer la similarité cosinus
  private cosineSimilarity(embedding1: number[], embedding2: number[]): number {
    if (!embedding1 || !embedding2 || embedding1.length !== embedding2.length) {
      return 0;
    }

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < embedding1.length; i++) {
      dotProduct += embedding1[i] * embedding2[i];
      norm1 += embedding1[i] * embedding1[i];
      norm2 += embedding2[i] * embedding2[i];
    }

    if (norm1 === 0 || norm2 === 0) return 0;

    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
  }

  async processQuestion(question: string): Promise<any> {
    try {
      this.logger.log(`Traitement de la question: "${question}"`);

      // Nettoyer la question pour une meilleure comparaison
      const cleanedQuestion = this.cleanText(question);

      // Chercher directement si une question similaire existe déjà dans la base de connaissances
      const similarQuestion = await this.findSimilarStoredQuestion(
        question,
        cleanedQuestion,
      );

      this.logger.log(
        `Résultat de findSimilarStoredQuestion: ${JSON.stringify(similarQuestion)}`,
      );

      // Si une question similaire est trouvée avec une bonne confiance
      if (similarQuestion.found && similarQuestion.sql) {
        // Calculer un score de confiance basé sur la similarité
        let confidence = similarQuestion.similarity || 0.6;

        // Essayer d'améliorer le score de confiance avec d'autres métriques
        const textualSimilarity = this.calculateSimilarity(
          cleanedQuestion,
          this.cleanText(similarQuestion.description || ''),
        );

        // Sans embeddings, utiliser uniquement la similarité textuelle
        confidence = confidence * 0.7 + textualSimilarity * 0.3;

        this.logger.log(
          `Utilisation d'une requête SQL existante: ${similarQuestion.queryId} (confiance: ${confidence})`,
        );

        // Préparer les paramètres pour la requête SQL
        let finalSql = similarQuestion.sql;
        if (
          similarQuestion.parameters &&
          similarQuestion.parameters.length > 0
        ) {
          const paramMap = {};
          similarQuestion.parameters.forEach((param) => {
            paramMap[param.name] = param.value;
          });

          // Remplacer les paramètres dans la requête SQL
          Object.entries(paramMap).forEach(([key, value]) => {
            // Échapper les valeurs pour éviter les injections SQL
            const escapedValue = this.escapeSqlValue(value as string);
            // Remplacer tous les occurrences de [KEY] par la valeur
            const parameterPattern = new RegExp(`\\[${key}\\]`, 'gi');
            finalSql = finalSql.replace(parameterPattern, escapedValue);
          });
        }

        // Utiliser la requête SQL existante au lieu d'en générer une nouvelle
        return {
          question,
          finalQuery: finalSql,
          originalQuery: similarQuestion.sql,
          fromStoredQuery: true,
          storedQueryId: similarQuestion.queryId,
          similarity: similarQuestion.similarity,
          source: 'rag', // Indiquer que la requête vient du RAG et non de la génération
          confidence: confidence, // Utiliser la similarité comme score de confiance
          parameters: similarQuestion.parameters || [],
          description: similarQuestion.description,
          bestMatch: similarQuestion,
        };
      }

      // Si aucune correspondance n'est trouvée, retourner un résultat par défaut
      this.logger.log(
        'Aucune requête existante trouvée, utilisation de la génération standard',
      );

      // Retourner les informations de base
      return {
        question,
        source: 'rag',
        noMatch: true,
      };
    } catch (error) {
      this.logger.error(
        `Erreur lors du traitement de la question: ${error.message}`,
      );
      throw error;
    }
  }

  // Méthode simple pour échapper les valeurs SQL pour éviter les injections
  private escapeSqlValue(value: string): string {
    if (!value) return '';
    // Simple échappement des apostrophes
    return value.replace(/'/g, "''");
  }

  // Fonction simple pour générer un pseudo-embedding pour une question
  private generateSimpleEmbedding(text: string): number[] {
    // Créer un embedding simple basé sur le texte (pour démonstration)
    const result = new Array(128).fill(0);

    // Remplir le vecteur avec des valeurs dérivées du texte
    const normalizedText = this.cleanText(text);
    for (let i = 0; i < normalizedText.length && i < 128; i++) {
      result[i % 128] = normalizedText.charCodeAt(i) / 255;
    }

    return result;
  }

  /**
   * Récupère l'instance du client ChromaDB
   */
  getChromaClient(): ChromaClient {
    return this.client;
  }
}
