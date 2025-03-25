import { Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class QuerierService {
  private readonly logger = new Logger(QuerierService.name);
  private pool: Pool;

  constructor(private configService: ConfigService) {
    // Initialiser la connexion à PostgreSQL
    this.pool = new Pool({
      host: this.configService.get('POSTGRES_HOST') || 'postgres',
      port: parseInt(this.configService.get('POSTGRES_PORT') || '5432', 10),
      user: this.configService.get('POSTGRES_USER') || 'postgres',
      password: this.configService.get('POSTGRES_PASSWORD') || 'postgres',
      database: this.configService.get('POSTGRES_DB') || 'postgres',
    });

    this.logger.log('QuerierService initialized with PostgreSQL connection');
  }

  /**
   * Exécute une requête SQL avec des paramètres optionnels
   */
  async executeQuery(query: string, params: any[] = []): Promise<any[]> {
    this.logger.log(`Executing query: ${query}`);
    try {
      // Valider la requête (SELECT uniquement pour la sécurité)
      this.validateQuery(query);

      // Exécuter la requête
      const result = await this.pool.query(query, params);
      this.logger.log(
        `Query executed successfully, ${result.rowCount} rows returned`,
      );

      return result.rows;
    } catch (error) {
      this.logger.error(`Error executing query: ${error.message}`);
      throw error;
    }
  }

  /**
   * Valide la requête SQL pour s'assurer qu'elle est sécurisée
   */
  private validateQuery(query: string): void {
    // Normaliser la requête pour la validation
    const normalizedQuery = query.trim().toLowerCase();

    // Vérifier que c'est une requête SELECT uniquement
    if (!normalizedQuery.startsWith('select')) {
      throw new Error('Only SELECT queries are allowed for security reasons');
    }

    // Vérifier si la requête contient des instructions dangereuses
    const dangerousPatterns = [
      /;.*/, // Plusieurs instructions
      /union\s+all/, // UNION ALL
      /union\s+select/, // UNION SELECT
      /into\s+outfile/, // INTO OUTFILE
      /into\s+dumpfile/, // INTO DUMPFILE
      /load_file/, // LOAD_FILE
      /\/\*.*\*\//, // Commentaires SQL qui peuvent cacher du code
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(normalizedQuery)) {
        throw new Error('Query contains potentially unsafe patterns');
      }
    }
  }

  /**
   * Exécute une requête SQL à partir d'un objet RagQuestion sélectionné par le ModelService
   */
  async executeSelectedQuery(
    sqlQuery: string,
    parameters: any[] = [],
  ): Promise<{ result: any[]; query: string }> {
    this.logger.log(`Executing selected query from ModelService: ${sqlQuery}`);

    try {
      // Valider et exécuter la requête
      this.validateQuery(sqlQuery);
      const result = await this.pool.query(sqlQuery, parameters);

      this.logger.log(
        `Selected query executed successfully, ${result.rowCount} rows returned`,
      );

      // Retourner le résultat et la requête exécutée
      return {
        result: result.rows,
        query: sqlQuery,
      };
    } catch (error) {
      this.logger.error(`Error executing selected query: ${error.message}`);
      throw error;
    }
  }

  /**
   * Exécute une requête SQL complète venant du modèle RAG
   */
  async executeRagQuery(sqlQuery: string): Promise<any[]> {
    this.logger.log(`Executing RAG query: ${sqlQuery}`);

    try {
      // Valider et exécuter la requête
      this.validateQuery(sqlQuery);
      const result = await this.pool.query(sqlQuery);

      this.logger.log(
        `RAG query executed successfully, ${result.rowCount} rows returned`,
      );

      // Retourner seulement les résultats
      return result.rows;
    } catch (error) {
      this.logger.error(`Error executing RAG query: ${error.message}`);
      throw error;
    }
  }
}
