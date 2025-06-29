// src/analysis/semantic/Sentence.ts
// src/analysis/semantic/Sentence.ts
import type { Token } from './Token';

export interface SentenceRelation {
  type: 'Justification' | 'Rebuttal' | 'Expansion' | 'Conclusion' | 'Elaboration' | 'Contrast';
  targetSentenceId: number; // ID of the related sentence
}

export type SentenceLabel =
  | { text: string; label?: string }
  | { nested: SentenceLabel[]; label: string };

export type SentenceLabels = SentenceLabel[];

export class Sentence {
  id: number;
  private rawText: string;
  private tokens: Token[];

  function: string;         // e.g., Premise, Conclusion
  type: string;             // e.g., Declarative, Interrogative
  purpose: string;          // Short natural language explanation
  mood: string;             // e.g., Indicative, Subjunctive
  relation?: SentenceRelation;
  sentence_labels: SentenceLabels; // Optional labels for the sentence

  constructor(
    id: number,
    rawText: string,
    options: {
      function: string;
      type: string;
      purpose: string;
      mood: string;
      relation?: SentenceRelation;
    }
  ) {
    this.id = id;
    this.rawText = rawText;
    this.tokens = this.tokenize(rawText);
    this.function = options.function;
    this.type = options.type;
    this.purpose = options.purpose;
    this.mood = options.mood;
    this.relation = options.relation;
    this.sentence_labels = [{
      text: rawText, // Default label is the raw text of the sentence
      label: options.function // Use function as the default label
    }]; // Initialize with an empty array
  }

  private tokenize(text: string): Token[] {
    // Simple tokenizer — replace with NLP tool later
    // TODO: Need to remove punctuation and handle more complex tokenization

    const punctuationRegex = /[.,!?;:()]/g;

    return text.split(/\s+/).map(word => {
      const cleanWord = word.replace(punctuationRegex, '');
      return {
        text: cleanWord,
        pos: 'NOUN', // Placeholder, should be replaced with actual POS tagging
        lemma: cleanWord.toLowerCase(), // Simple lemmatization
        // role: '', // Role can be assigned later
        // subClause: undefined // Sub-clauses can be added later
      };
    })
  }

  public tokenizer(): Token[] {
    return this.tokenize(this.rawText);
  }

  public assignRoles(roleTagger: (token: Token) => string): void {
    this.tokens = this.tokens.map(token => ({
      ...token,
      role: roleTagger(token),
    }));
  }

  public setRelation(relation: SentenceRelation) {
    this.relation = relation;
  }

  public getTokens(): Token[] {
    return this.tokens;
  }

  public getRawText(): string {
    return this.rawText;
  }

  public getText(): string {
    return this.tokens.map(token => token.text).join(' ');
  }

  /**
   * This static method creates a Sentence instance from an array of tokens.
   * It is useful for reconstructing a Sentence from its tokens, such as when
   * processing or analyzing text that has already been tokenized.
   * For test purposes, it allows for easy creation of Sentence instances
   * without needing to provide the raw text directly.
   * @param tokens token array to create a sentence from
   * @param options options for the sentence
   * @returns a new Sentence instance created from the provided tokens
   */
  public static fromTokens(tokens: Token[], options: {
    id: number;
    function: string;
    type: string;
    purpose: string;
    mood: string;
    relation?: SentenceRelation;
  }): Sentence {
    const rawText = tokens.map(token => token.text).join(' ');
    const sentence = new Sentence(options.id, rawText, options);
    sentence.tokens = tokens; // Set the provided tokens
    return sentence;
  }

  public static fromSentenceLabels(
    sentenceLabels: SentenceLabels,
    options: {
      id: number;
      function: string;
      type: string;
      purpose: string;
      mood: string;
      relation?: SentenceRelation;
    }
  ): Sentence {
    const renderLabels = (labels: SentenceLabels): string => {
      let result = "";

      for (let i = 0; i < labels.length; i++) {
        const label = labels[i];
        let segment = "";

        if ("text" in label) {
          segment = label.text;
        }
        else if ("nested" in label) {
          const inner = renderLabels(label.nested);
          if (label.label === "quote") {
            segment = `“${inner}”`;
            // Look ahead for trailing comma logic?
            if (!/[.,!?]$/.test(inner)) {
              segment = `“${inner},”`; // naïvely assume a comma at end
            }
          }
          else if (label.label === "parenthetical phrase") {
            segment = `, ${inner},`;
          }
          else {
            segment = inner;
          }
        }

        // Add space unless we're before punctuation
        if (result && !segment.startsWith(",") && !segment.startsWith(".") && !segment.startsWith("?")) {
          result += " ";
        }

        result += segment;
      }

      return result;
    };

    let rawText = renderLabels(sentenceLabels);

    // Add terminal punctuation if needed
    if (!/[.?!]$/.test(rawText.trim())) {
      rawText = rawText.trim() + "?"; // assume question for now
    }

    const sentence = new Sentence(options.id, rawText, options);
    sentence.sentence_labels = sentenceLabels;
    return sentence;
  }

  public getSentenceLabels(): SentenceLabels {
    return this.sentence_labels;
  }

}