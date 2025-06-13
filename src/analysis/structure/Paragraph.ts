// src/analysis/structure/Paragraph.ts

import { Sentence } from "../structure/Sentence";

export class Paragraph {
  private sentences: Sentence[];
  private main_idea?: string; // Optional main idea for the paragraph
  private id?: number; // Optional ID for the paragraph
  //TODO: Array of IDs for the paragraphs, useful for tracking or referencing

  constructor(id?: number) {
    this.id = id;
    this.main_idea = undefined; // Initialize main idea as undefined
    this.sentences = [];
  }

  public addSentence(sentence: Sentence) {
    this.sentences.push(sentence);
  }

  public getSentences(): Sentence[] {
    return this.sentences;
  }

  public setMainIdea(idea: string) {
    this.main_idea = idea;
  }

  public getMainIdea(): string | undefined {
    return this.main_idea;
  }

  public getId(): number | undefined {
    return this.id;
  }

}