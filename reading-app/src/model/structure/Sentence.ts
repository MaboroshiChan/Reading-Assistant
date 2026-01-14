// src/analysis/semantic/Sentence.ts
// src/analysis/semantic/Sentence.ts

interface SentenceRelation {
  type: 'Justification' | 'Rebuttal' | 'Expansion' | 'Conclusion' | 'Elaboration' | 'Contrast';
  targetSentenceId: number; // ID of the related sentence
}

export interface Sentence {
  id: number;
  function: string;         // e.g., Premise, Conclusion
  type: string;             // e.g., Declarative, Interrogative
  purpose: string;          // Short natural language explanation
  mood: string;             // e.g., Indicative, Subjunctive 
  relation?: SentenceRelation;
  text: string
}
