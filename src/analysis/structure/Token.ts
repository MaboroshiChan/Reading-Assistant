export interface Token {
  text: string;
  pos: string;           // Part-of-Speech
  lemma: string;         // Base form
  role?: string;         // Semantic role
  subClause?: SubClause; // Optional attached sub-clause
}

export interface SubClause {
    id: number;
    text: string;
    function: string;      // e.g., Definition, Elaboration, Restriction
    mood: string;          // e.g., Indicative
    tokens: Token[];       // Tokens within the sub-clause
}