import type { Paragraph } from "./Paragraph";

export class Document {
  private paragraphs: Paragraph[];
  private title?: string; // Optional title for the document

  constructor() {
    this.title = undefined; // Initialize title as undefined
    this.paragraphs = [];
  }

  public addParagraph(paragraph: Paragraph) {
    this.paragraphs.push(paragraph);
  }

  public getParagraphs(): Paragraph[] {
    return this.paragraphs;
  }

  public setTitle(title: string) {
    this.title = title;
  }

  public getTitle(): string | undefined {
    return this.title;
  }
}