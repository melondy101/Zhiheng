export * from './types';
export * from './data';
export * from './provider';

import { InMemoryKnowledgeBaseProvider } from './provider';
export const defaultKnowledgeBaseProvider = new InMemoryKnowledgeBaseProvider();
