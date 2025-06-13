// src/analysis/structure/Paragraph.ts

import { Sentence } from "../structure/Sentence";

export class Paragraph {
  private sentences: Sentence[];

  constructor() {
    this.sentences = [];
  }

  public addSentence(sentence: Sentence) {
    this.sentences.push(sentence);
  }

  public getSentences(): Sentence[] {
    return this.sentences;
  }
}