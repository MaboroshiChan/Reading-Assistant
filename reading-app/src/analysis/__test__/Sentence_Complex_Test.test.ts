import { Sentence } from "../structure/Sentence";
import type { Token } from "../structure/Token";

it("Construct a sentence from tokens", () => {
    // Example sentence: "This is a test sentence."
    const tokens: Token[] = [
        { text: "This", pos: "DET", lemma: "this" },
        { text: "is", pos: "VERB", lemma: "be" },
        { text: "a", pos: "DET", lemma: "a" },
        { text: "test", pos: "NOUN", lemma: "test" },
        { text: "sentence", pos: "NOUN", lemma: "sentence" }
        // Add more tokens as needed
    ];
    const sentence = Sentence.fromTokens(tokens, {
        function: "Premise",
        type: "Declarative",
        purpose: "To demonstrate a test case",
        mood: "Indicative",
        relation: {
            type: "Justification",
            targetSentenceId: 2,
        },
        id: 0
    });

    
    expect(sentence.id).toBe(0);
    expect(sentence.getRawText()).toBe("This is a test sentence."); // TODO: Finish implementation of getRawText
})