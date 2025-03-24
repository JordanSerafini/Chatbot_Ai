export interface Parameter {
  name: string;
  description: string;
}

export interface Question {
  id: string;
  question: string;
  sql: string;
  description: string;
  parameters?: Parameter[];
}

export interface QuestionMetadata {
  sql: string;
  description: string;
  parameters?: Parameter[];
}

export interface SimilarQuestion {
  question: string;
  metadata: QuestionMetadata;
  distance: number;
}
