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

@Injectable()
export class AnalyseService {
  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  private getLmStudioUrl(): string {
    return (
      this.configService.get<string>('LM_STUDIO_URL') || 'http://lm_studio:1234'
    );
  }

  async analyzeQuestion(question: string): Promise<string> {
    const getQuestionList = async () => {
      try {
        const response = await this.httpService.axiosRef.get(
          'http://rag_service:3002/rag/questions',
        );
        return response.data;
      } catch (error) {
        console.error('Erreur lors de la récupération des questions:', error);
        return [];
      }
    };

    const prompt = `Tu es spécialisé dans l'analyse et la reformulation, extraction des idées humaines, tu dois reformuler et comparer la question ${question} avec les questions suivantes et trouvé si une correspond parfaitement ou pas, si oui retourne la question correspondante, si non retourne "pas de similarité trouvée" : `;

    try {
      const questions = await getQuestionList();
      const fullPrompt = prompt + questions.join('\n');

      const response = await this.httpService.axiosRef.post(
        this.getLmStudioUrl() + '/v1/chat/completions',
        {
          messages: [{ role: 'user', content: fullPrompt }],
          temperature: 0.7,
          max_tokens: 1000,
        },
      );

      return response.data.choices[0].message.content;
    } catch (error) {
      console.error("Erreur lors de l'analyse de la question:", error);
      return "Erreur lors de l'analyse de la question";
    }
  }

  private async getSimilarQuestionsFromRag(
    question: string,
  ): Promise<RagQuestion | null> {
    try {
      const response = await this.httpService.axiosRef.get(
        `${this.configService.get('RAG_URL')}/rag/similar`,
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

  private async getQuestionListFromRag(): Promise<RagQuestion[]> {
    const response = await this.httpService.axiosRef.get(
      `${this.configService.get('RAG_URL')}/rag/similar`,
    );
    return response.data;
  }
}
