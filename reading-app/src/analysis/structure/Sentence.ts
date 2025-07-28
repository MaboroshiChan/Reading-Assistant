// src/analysis/semantic/Sentence.ts
// src/analysis/semantic/Sentence.ts

interface SentenceRelation {
  type: 'Justification' | 'Rebuttal' | 'Expansion' | 'Conclusion' | 'Elaboration' | 'Contrast';
  targetSentenceId: number; // ID of the related sentence
}

export interface SemanticNode {
  id: string;                        // 唯一标识（用于联动）
  label: string[];                  // 支持多个标签：["semantic-concept", "structure-subject"]
  text?: string;                    // 叶子节点（原始文本）
  children: SemanticNode[];        // 嵌套结构
  linkedBy?: string[];              // 被哪些 id 联动

  noSpaceBefore?: boolean;
  noSpaceAfter?: boolean;
}

export interface Sentence {
  id: number;
  function: string;         // e.g., Premise, Conclusion
  type: string;             // e.g., Declarative, Interrogative
  purpose: string;          // Short natural language explanation
  mood: string;             // e.g., Indicative, Subjunctive
  relation?: SentenceRelation;
  semanticTree: SemanticNode
}