import { Injectable, Logger } from '@nestjs/common';

interface GenerateTextOptions {
  useAI?: boolean;
  formatDates?: boolean;
  includeDetails?: boolean;
}

@Injectable()
export class TextProcessorService {
  private readonly logger = new Logger(TextProcessorService.name);

  constructor() {
    this.logger.log('TextProcessorService initialized');
  }

  /**
   * Génère une réponse textuelle basée sur les résultats d'une requête SQL
   * @param description Description de la requête SQL exécutée
   * @param data Données résultant de l'exécution de la requête SQL
   * @param question Question originale de l'utilisateur
   * @param options Options de génération du texte
   * @returns Une chaîne de texte formatée pour l'utilisateur
   */
  generateTextResponse(
    description: string,
    data: any[],
    question: string,
    options: GenerateTextOptions = { formatDates: true, includeDetails: true },
  ): string {
    this.logger.log(`Generating text response for query: "${question}"`);

    // Si aucun résultat, renvoyer un message adapté
    if (!data || data.length === 0) {
      return `Je n'ai trouvé aucun résultat pour votre question "${question}".`;
    }

    // Déterminer le type de réponse basé sur la description
    const responseType = this.determineResponseType(description);

    // Construction d'une réponse basée sur la description et les données
    let response = this.generateIntroduction(
      description,
      data.length,
      responseType,
    );

    // Ajouter les détails si demandé
    if (options.includeDetails) {
      response += this.generateDetailsSection(
        data,
        responseType,
        options.formatDates,
      );
    }

    // Ajouter une conclusion
    response += this.generateConclusion(data.length, responseType);

    return response;
  }

  /**
   * Détermine le type de réponse à générer en fonction de la description
   */
  private determineResponseType(description: string): string {
    const lowerDesc = description.toLowerCase();

    if (lowerDesc.includes('projets') && lowerDesc.includes('mois courant')) {
      return 'projects_current_month';
    } else if (lowerDesc.includes('projets') && lowerDesc.includes('demain')) {
      return 'projects_tomorrow';
    } else if (lowerDesc.includes('projets') && lowerDesc.includes('année')) {
      return 'projects_current_year';
    } else if (lowerDesc.includes('clients')) {
      return 'clients';
    } else {
      return 'generic';
    }
  }

  /**
   * Génère l'introduction de la réponse
   */
  private generateIntroduction(
    description: string,
    count: number,
    type: string,
  ): string {
    switch (type) {
      case 'projects_current_month':
        return `Voici la liste des projets du mois courant (${count} projet${count > 1 ? 's' : ''}) :\n\n`;
      case 'projects_tomorrow':
        return `Voici la liste des projets débutant demain (${count} projet${count > 1 ? 's' : ''}) :\n\n`;
      case 'projects_current_year':
        return `Voici la liste des projets de cette année (${count} projet${count > 1 ? 's' : ''}) :\n\n`;
      case 'clients':
        return `Voici la liste des clients (${count} client${count > 1 ? 's' : ''}) :\n\n`;
      default:
        return `J'ai trouvé ${count} résultat${count > 1 ? 's' : ''} correspondant à votre recherche :\n\n`;
    }
  }

  /**
   * Génère la section détaillée pour chaque élément des résultats
   */
  private generateDetailsSection(
    data: any[],
    type: string,
    formatDates: boolean | undefined,
  ): string {
    // Convertir formatDates en boolean strict
    const shouldFormatDates = formatDates !== false;

    let details = '';

    switch (type) {
      case 'projects_current_month':
      case 'projects_tomorrow':
      case 'projects_current_year':
        // Format spécifique pour les projets
        data.forEach((project, index) => {
          const date =
            shouldFormatDates && project.start_date
              ? new Date(project.start_date).toLocaleDateString('fr-FR', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })
              : project.start_date;

          details += `${index + 1}. "${project.name}" à ${project.city || 'N/A'}`;

          if (date) {
            details += `, débutant le ${date}`;
          }

          if (project.client_name) {
            details += `, client: ${project.client_name}`;
          }

          if (project.status) {
            details += `, statut: ${project.status}`;
          }

          details += '\n';
        });
        break;

      default:
        // Format générique pour les autres types de données
        data.forEach((item, index) => {
          details += `${index + 1}. `;
          const keys = Object.keys(item);

          keys.forEach((key) => {
            if (item[key] !== null && item[key] !== undefined) {
              // Formater les dates si nécessaire
              let value = item[key];
              if (
                shouldFormatDates &&
                (value instanceof Date ||
                  (typeof value === 'string' &&
                    value.match(/^\d{4}-\d{2}-\d{2}/)))
              ) {
                value = new Date(value).toLocaleDateString('fr-FR');
              }
              details += `${key}: ${value}, `;
            }
          });

          details = details.slice(0, -2) + '\n'; // Supprimer la dernière virgule et espace
        });
    }

    return details;
  }

  /**
   * Génère une conclusion pour la réponse
   */
  private generateConclusion(count: number, type: string): string {
    if (count > 5) {
      switch (type) {
        case 'projects_current_month':
          return `\nCe mois-ci est particulièrement chargé avec ${count} projets.`;
        case 'projects_current_year':
          return `\nL'année comprend un total de ${count} projets.`;
        default:
          return '';
      }
    }
    return '';
  }
}
