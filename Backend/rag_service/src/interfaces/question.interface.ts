export interface Question {
  id: string;
  question: string;
  sql: string;
  description: string;
}

export interface QuestionMetadata {
  sql: string;
  description: string;
}

export interface SimilarQuestion {
  question: string;
  metadata: QuestionMetadata;
  distance: number;
}
