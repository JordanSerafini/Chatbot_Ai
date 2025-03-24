import { registerAs } from '@nestjs/config';
import * as path from 'path';

export default registerAs('app', () => ({
  port: parseInt(process.env.PORT || '3002', 10),
  
  // Configuration ChromaDB
  chroma: {
    url: process.env.CHROMA_URL || 'http://ChromaDB:8000',
    collectionName: process.env.CHROMA_COLLECTION || 'questions_collection',
    sqlCollectionName: process.env.SQL_COLLECTION || 'sql_queries',
    opDelay: parseInt(process.env.CHROMA_OP_DELAY || '1000', 10),
    retryDelay: parseInt(process.env.CHROMA_RETRY_DELAY || '2000', 10),
  },
  
  // Chemins des fichiers
  paths: {
    queryDir: process.env.QUERY_DIR || path.join(process.cwd(), '..', 'chroma_db', 'Query'),
  },
  
  // Paramètres RAG
  rag: {
    similarityThreshold: parseFloat(process.env.SIMILARITY_THRESHOLD || '0.7'),
    maxResults: parseInt(process.env.MAX_RESULTS || '5', 10),
  }
})); 