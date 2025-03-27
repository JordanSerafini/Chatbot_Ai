import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';

interface RagQuestion {
  question: string;
  metadata: {
    sql: string;
    description: string;
    parameters?: any[];
  };
  distance?: number;
}

interface AnalyzeResult {
  reformulation: string;
  keywords: string[];
  entities: {
    client?: string;
    chantier?: string;
    planning?: string;
    date?: string;
    [key: string]: string | undefined;
  };
}

@Injectable()
export class AnalyseService {
  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  private getLmStudioUrl(): string {
    return (
      this.configService.get<string>('LM_STUDIO_URL') ||
      'https://34a3-2a01-cb15-4c5-c200-ff2e-b498-e114-f0c2.ngrok-free.app'
    );
  }

  async analyzeQuestion(question: string): Promise<AnalyzeResult> {
    try {
      const reformulation = await this.reformulateQuestion(question);
      const { keywords, entities } =
        await this.extractKeywordsAndEntities(question);

      return {
        reformulation,
        keywords,
        entities,
      };
    } catch (error) {
      console.error("Erreur lors de l'analyse complète de la question:", error);
      throw new Error(
        "Erreur lors de l'analyse de la question: " +
          (error.message || JSON.stringify(error)),
      );
    }
  }

  private async reformulateQuestion(question: string): Promise<string> {
    try {
      // Création du prompt pour l'IA de reformulation
      const prompt = `Tu es un expert en correction orthographique et grammaticale du français.
      
Ta tâche est de reformuler cette question: "${question}"

INSTRUCTIONS IMPORTANTES:
1. Corrige toutes les fautes d'orthographe et de grammaire
2. Utilise un français correct et standard
3. Préserve exactement le sens original de la question
4. Ne change PAS le sujet ou l'intention de la question
5. Retourne UNIQUEMENT la question reformulée, sans aucune explication, réflexion ou texte additionnel
6. N'inclus PAS de balises comme <think> ou des explications sur ton processus de réflexion

Exemple:
Si la question est "kel son le client ke je doi voir demain", tu répondrais simplement:
"Quels sont les clients que je dois voir demain ?"`;

      // Appel à l'IA (LM Studio) pour la reformulation
      const lmStudioUrl = this.getLmStudioUrl();
      const chatEndpoint = lmStudioUrl.endsWith('/v1')
        ? '/chat/completions'
        : '/v1/chat/completions';

      const response = await this.httpService.axiosRef.post(
        lmStudioUrl + chatEndpoint,
        {
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3, // Température plus basse pour plus de précision
          max_tokens: 1000,
        },
      );

      // Vérification de la réponse avant d'y accéder
      if (
        !response.data ||
        !response.data.choices ||
        !response.data.choices[0] ||
        !response.data.choices[0].message
      ) {
        console.error(
          'Format de réponse invalide pour la reformulation:',
          response.data,
        );
        return question; // Retour de la question originale en cas d'erreur
      }

      // Nettoyer la réponse pour enlever d'éventuels artefacts
      let reformulatedQuestion =
        response.data.choices[0].message.content.trim();

      // Supprimer les guillemets si l'IA les a inclus
      if (
        (reformulatedQuestion.startsWith('"') &&
          reformulatedQuestion.endsWith('"')) ||
        (reformulatedQuestion.startsWith('«') &&
          reformulatedQuestion.endsWith('»'))
      ) {
        reformulatedQuestion = reformulatedQuestion
          .substring(1, reformulatedQuestion.length - 1)
          .trim();
      }

      // Suppression de balises éventuelles ou des préfixes/suffixes courants
      reformulatedQuestion = reformulatedQuestion
        .replace(/<think>[\s\S]*<\/think>/g, '')
        .replace(
          /^(la question reformulée est|question reformulée|reformulation|voici la question reformulée)[\s:]*/i,
          '',
        )
        .trim();

      return reformulatedQuestion;
    } catch (error) {
      console.error('Erreur lors de la reformulation de la question:', error);
      return question; // Retour de la question originale en cas d'erreur
    }
  }

  private async extractKeywordsAndEntities(
    question: string,
  ): Promise<{ keywords: string[]; entities: Record<string, string> }> {
    try {
      // Création du prompt pour l'IA d'extraction de mots-clés
      const prompt = `
Tu es un expert en extraction d'informations dans le contexte du BTP (Bâtiment et Travaux Publics).

Analyse cette question: "${question}"

TÂCHE:
1. Extrais une liste de mots-clés pertinents (maximum 5) en lien avec le BTP.
2. Identifie les entités spécifiques dans ces catégories:
   - la table concernée: "clients", "projects", "plannings", "quotations", "invoices"
   - date: dates précises ("10/05/2023", "lundi prochain", "février", "mois", "cette semaine", "aujourd'hui", "en cours")

RÈGLES IMPORTANTES:
- Pour le champ "mois" ou toute autre période dans la question, place-le dans "date"
- Si "moi" est mentionné et fait référence à l'utilisateur, mets-le dans "client" 
- Ne laisse PAS vide le champ "client" s'il est implicitement "moi" ou l'utilisateur
- Utilise uniquement les informations présentes dans la question
- Si une information n'est pas présente, laisse le champ vide ("")
- Réponds UNIQUEMENT au format JSON spécifié ci-dessous

FORMAT DE RÉPONSE:
{
  "keywords": ["mot1", "mot2", "mot3"],
  "entities": {
    "client": "nom du client ou 'moi' si c'est l'utilisateur",
    "chantier": "nom du chantier s'il est mentionné",
    "planning": "référence au planning si mentionnée",
    "date": "date ou période (comme 'mois' ou 'semaine') si mentionnée"
  }
}`;

      // Appel à l'IA (LM Studio) pour l'extraction
      const lmStudioUrl = this.getLmStudioUrl();
      const chatEndpoint = lmStudioUrl.endsWith('/v1')
        ? '/chat/completions'
        : '/v1/chat/completions';

      const response = await this.httpService.axiosRef.post(
        lmStudioUrl + chatEndpoint,
        {
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.2, // Température très basse pour des réponses cohérentes
          max_tokens: 1000,
        },
      );

      // Vérification de la réponse avant d'y accéder
      if (
        !response.data ||
        !response.data.choices ||
        !response.data.choices[0] ||
        !response.data.choices[0].message
      ) {
        console.error(
          "Format de réponse invalide pour l'extraction de mots-clés:",
          response.data,
        );
        return { keywords: [], entities: {} }; // Retour de valeurs vides en cas d'erreur
      }

      const content = response.data.choices[0].message.content;

      try {
        // Extraction du JSON de la réponse (au cas où il y aurait du texte autour)
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        const jsonContent = jsonMatch ? jsonMatch[0] : content;
        const result = JSON.parse(jsonContent);

        // Correction pour "moi" dans le champ client
        if (
          result.entities &&
          (!result.entities.client || result.entities.client === '') &&
          question.toLowerCase().includes('moi')
        ) {
          result.entities.client = 'moi';
        }

        // Correction pour "mois" dans le champ date
        if (
          result.entities &&
          (!result.entities.date || result.entities.date === '') &&
          (question.toLowerCase().includes('moi') ||
            question.toLowerCase().includes('mois'))
        ) {
          result.entities.date = 'mois actuel';
        }

        return {
          keywords: result.keywords || [],
          entities: result.entities || {},
        };
      } catch (parseError) {
        console.error('Erreur lors du parsing JSON de la réponse:', parseError);
        return { keywords: [], entities: {} };
      }
    } catch (error) {
      console.error("Erreur lors de l'extraction de mots-clés:", error);
      return { keywords: [], entities: {} };
    }
  }

  private async getSimilarQuestionsFromRag(
    question: string,
  ): Promise<RagQuestion | null> {
    try {
      const response = await this.httpService.axiosRef.get(
        `${this.configService.get('RAG_SERVICE_URL')}/rag/similar`,
        {
          params: { question },
        },
      );
      return response.data;
    } catch (e) {
      console.log(e);
      return null;
    }
  }
}
