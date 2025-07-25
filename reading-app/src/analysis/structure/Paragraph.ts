// src/analysis/structure/Paragraph.ts

import { Sentence } from "../structure/Sentence";
import type { LLMAnalysis } from "../structure/Sentence";

export class Paragraph {
  private sentences: Sentence[];
  private main_idea?: string; // Optional main idea for the paragraph
  private id?: number; // Optional ID for the paragraph
  //TODO: Array of IDs for the paragraphs, useful for tracking or referencing
  private raw_text?: string;
  private analysis: LLMAnalysis[]; // Optional LLM analysis for the paragraph

  constructor(id?: number, text?: string, llmAnalysis?: LLMAnalysis[]) {
    this.id = id;
    this.main_idea = undefined; // Initialize main idea as undefined
    if (text) {
      this.raw_text = text; // Store the raw text of the paragraph
    }
    if (this.raw_text) {
      this.sentences = this.raw_text.split(/(?<=[.!?])\s+/)
      .map((sentenceText, index) => new Sentence(index, sentenceText.trim(), {
        function: "Declarative", // Default function, can be changed later
        type: "Declarative", // Default type, can be changed later
        purpose: "General statement", // Default purpose, can be changed later
        mood: "Indicative" // Default mood, can be changed later
      }));
    }
    else {
      this.sentences = []; // Initialize with an empty array if no text is provided
      this.raw_text = ""; // Initialize raw_text as an empty string if no text is provided
    }
    if(llmAnalysis) {
      this.analysis = llmAnalysis; // Use provided LLM analysis if available
    } else {
      this.analysis = []; // Initialize analysis as an empty array if no LLM analysis is provided
    }
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

  public getLLMAnalysis(): LLMAnalysis[] {
    return this.analysis;
  }

  public getRawText(): string {
    return this.raw_text || ""; // Return raw_text or an empty string if undefined
  }

}