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
   * Remplace les paramètres nommés au format [PARAM] dans une requête SQL
   * et les convertit en paramètres positionnels $1, $2, etc. pour PostgreSQL
   */
  private replaceNamedParameters(
    sql: string,
    params: Record<string, any>,
  ): { query: string; values: any[] } {
    let modifiedSql = sql;
    const paramValues: any[] = [];
    const paramPattern = /\[([A-Z_]+)\]/g;
    let match;
    let paramCounter = 1;

    // Remplacer tous les paramètres nommés par des paramètres positionnels
    while ((match = paramPattern.exec(sql)) !== null) {
      const fullMatch = match[0]; // Ex: [CITY]
      const paramName = match[1]; // Ex: CITY

      // Vérifier si le paramètre existe dans l'objet params
      if (params && params[paramName] !== undefined) {
        // Remplacer [PARAM] par $n et stocker la valeur
        modifiedSql = modifiedSql.replace(fullMatch, `$${paramCounter}`);
        paramValues.push(params[paramName]);
        this.logger.log(
          `Parameter ${paramName} replaced with value: ${params[paramName]}`,
        );
        paramCounter++;
      } else {
        // Si le paramètre n'est pas fourni, le remplacer par une chaîne vide pour éviter les erreurs SQL
        this.logger.warn(
          `Parameter ${paramName} not provided, using empty string`,
        );
        modifiedSql = modifiedSql.replace(fullMatch, '');
      }
    }

    return { query: modifiedSql, values: paramValues };
  }

  /**
   * Exécute une requête SQL qui contient des paramètres nommés au format [PARAM]
   */
  async executeNamedParamQuery(
    sql: string,
    params: Record<string, any> = {},
  ): Promise<any[]> {
    this.logger.log(`Executing query with named parameters: ${sql}`);
    this.logger.log(`Parameters: ${JSON.stringify(params)}`);

    try {
      // Valider la requête
      this.validateQuery(sql);

      // Remplacer les paramètres nommés
      const { query, values } = this.replaceNamedParameters(sql, params);
      this.logger.log(`Transformed query: ${query}`);
      this.logger.log(`Parameter values: ${JSON.stringify(values)}`);

      // Exécuter la requête avec les paramètres positionnels
      const result = await this.pool.query(query, values);
      this.logger.log(
        `Query executed successfully, ${result.rowCount} rows returned`,
      );

      return result.rows;
    } catch (error) {
      this.logger.error(
        `Error executing named parameter query: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Exécute une requête SQL à partir d'un objet RagQuestion sélectionné par le ModelService
   */
  async executeSelectedQuery(
    sqlQuery: string,
    parameters: Record<string, any> = {},
  ): Promise<{ result: any[]; query: string }> {
    this.logger.log(`Executing selected query from ModelService: ${sqlQuery}`);
    this.logger.log(`Parameters: ${JSON.stringify(parameters)}`);

    try {
      // Valider la requête
      this.validateQuery(sqlQuery);

      // Vérifier si la requête contient des paramètres nommés
      if (sqlQuery.match(/\[[A-Z_]+\]/)) {
        // Utiliser la méthode pour les paramètres nommés
        const { query, values } = this.replaceNamedParameters(
          sqlQuery,
          parameters,
        );
        this.logger.log(`Transformed query with named parameters: ${query}`);

        const result = await this.pool.query(query, values);

        this.logger.log(
          `Named parameter query executed successfully, ${result.rowCount} rows returned`,
        );

        return {
          result: result.rows,
          query: sqlQuery, // Retourner la requête originale pour référence
        };
      } else {
        // Pour les requêtes sans paramètres nommés, utiliser la méthode standard
        const paramArray = Object.values(parameters);
        const result = await this.pool.query(sqlQuery, paramArray);

        this.logger.log(
          `Standard query executed successfully, ${result.rowCount} rows returned`,
        );

        return {
          result: result.rows,
          query: sqlQuery,
        };
      }
    } catch (error) {
      this.logger.error(`Error executing selected query: ${error.message}`);
      throw error;
    }
  }

  /**
   * Exécute une requête SQL complète venant du modèle RAG
   * avec support pour les paramètres nommés au format [PARAM]
   */
  async executeRagQuery(
    sqlQuery: string,
    parameters: Record<string, any> = {},
  ): Promise<any[]> {
    this.logger.log(`Executing RAG query: ${sqlQuery}`);
    this.logger.log(`Parameters: ${JSON.stringify(parameters)}`);

    try {
      // Valider la requête
      this.validateQuery(sqlQuery);

      // Vérifier si la requête contient des paramètres nommés
      if (sqlQuery.match(/\[[A-Z_]+\]/)) {
        // Utiliser la méthode pour les paramètres nommés
        const { query, values } = this.replaceNamedParameters(
          sqlQuery,
          parameters,
        );
        this.logger.log(`Transformed RAG query: ${query}`);

        const result = await this.pool.query(query, values);

        this.logger.log(
          `RAG query with named parameters executed successfully, ${result.rowCount} rows returned`,
        );

        return result.rows;
      } else {
        // Pour les requêtes sans paramètres nommés, exécuter directement
        const result = await this.pool.query(sqlQuery);

        this.logger.log(
          `Standard RAG query executed successfully, ${result.rowCount} rows returned`,
        );

        return result.rows;
      }
    } catch (error) {
      this.logger.error(`Error executing RAG query: ${error.message}`);
      throw error;
    }
  }
}
