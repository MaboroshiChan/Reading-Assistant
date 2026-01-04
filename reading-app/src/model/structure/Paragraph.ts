import type { Sentence } from "./Sentence";

export interface Paragraph {
  id: number;
  sentences: Sentence[];

  /** 段落的中心思想，可由 LLM 提炼或用户指定 */
  centralIdea?: string;

  /** 可选：结构类型，如“并列”、“对比”、“递进”、“因果”等 */
  structureType?: 'Parallel' | 'Contrast' | 'Progression' | 'Causal' | 'Narrative' | string;

  /** 可选：段落整体功能，如“引入”、“论证”、“结论”等 */
  function?: 'Introduction' | 'Premise' | 'Conclusion' | 'Evidence' | string;
}