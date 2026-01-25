import type Paragraph from "./Paragraph";

/** Container for a list of paragraphs forming a document. */
export class Document {
  private paragraphs: Paragraph[];
  private title?: string; // Optional title for the document

  constructor() {
    this.title = undefined; // Initialize title as undefined
    this.paragraphs = [];
  }

  /** Adds a paragraph to the end of the document. */
  public addParagraph(paragraph: Paragraph) {
    this.paragraphs.push(paragraph);
  }

  /** Returns all paragraphs in the document. */
  public getParagraphs(): Paragraph[] {
    return this.paragraphs;
  }

  /** Sets the document title. */
  public setTitle(title: string) {
    this.title = title;
  }

  /** Gets the document title if set. */
  public getTitle(): string | undefined {
    return this.title;
  }
}