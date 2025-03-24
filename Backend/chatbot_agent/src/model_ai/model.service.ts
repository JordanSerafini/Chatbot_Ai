import { HfInference } from '@huggingface/inference';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ModelService {
  private model: HfInference;
  private readonly modelName = 'mistralai/Mistral-7B-Instruct-v0.2';
  private readonly modelConfig = {
    inputs: 'text',
    parameters: {
      max_new_tokens: 1000,
      temperature: 0.2,
      repetition_penalty: 1.1,
      top_k: 50,
      top_p: 0.9,
    },
  };

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    const token = this.configService.get<string>('HUGGINGFACE_TOKEN');
    if (!token) {
      throw new Error('HUGGINGFACE_TOKEN is not set');
    }
    this.model = new HfInference(token);
  }

  private formatPrompt(context: string, userInput: string): string {
    return `<s>[INST] ${context}

${userInput} [/INST]</s>`;
  }

  async generateResponse(context: string, userInput: string): Promise<string> {
    try {
      const formattedPrompt = this.formatPrompt(context, userInput);
      const response = await this.model.textGeneration({
        model: this.modelName,
        inputs: formattedPrompt,
        parameters: this.modelConfig.parameters,
      });

      return response.generated_text;
    } catch (error) {
      throw new Error(`Failed to generate response: ${error.message}`);
    }
  }
}
