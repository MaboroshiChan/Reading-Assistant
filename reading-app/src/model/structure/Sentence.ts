// src/analysis/semantic/Sentence.ts
// src/analysis/semantic/Sentence.ts

/** Defines a logical connection between two sentences. */
interface SentenceRelation {
  type: 'Justification' | 'Rebuttal' | 'Expansion' | 'Conclusion' | 'Elaboration' | 'Contrast';
  targetSentenceId: number; // ID of the related sentence
}

/** Represents a single sentence with its rhetorical and structural metadata. */
export interface Sentence {
  id: number;
  function: string;         // e.g., Premise, Conclusion
  type: string;             // e.g., Declarative, Interrogative
  purpose: string;          // Short natural language explanation
  mood: string;             // e.g., Indicative, Subjunctive 
  relation?: SentenceRelation;
  text: string;
  key_words?: string[];
}

/** 
 * Returns true if the sentence is still waiting for analysis.
 */
export const isPending = (sentence: Sentence): boolean => {
  return sentence.function === 'Pending';
};
