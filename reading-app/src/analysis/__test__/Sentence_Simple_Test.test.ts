import {Sentence} from '../structure/Sentence';

describe('Sentence tokenizer', () => {
    it('should tokenize a sentence into words', () => {
        const sentence = new Sentence(1, 'This is a test sentence.', {
        function: 'Premise',
        type: 'Declarative',
        purpose: 'To demonstrate a test case',
        mood: 'Indicative',
        relation: {
            type: 'Justification',
            targetSentenceId: 2,
        },
        });
    
        const tokens = sentence.tokenizer();
        expect(tokens.length).toBe(5);
        expect(tokens[0].text).toBe('This');
        expect(tokens[1].text).toBe('is');
        expect(tokens[2].text).toBe('a');
        expect(tokens[3].text).toBe('test');
        expect(tokens[4].text).toBe('sentence');
    });
    
    it('should handle empty sentences', () => {
        const sentence = new Sentence(2, '', {
            function: 'Premise',
            type: 'Declarative',
            purpose: 'To demonstrate an empty case',
            mood: 'Indicative',
            relation: {
                type: 'Justification',
                targetSentenceId: 3,
            },
        });
        const tokens = sentence.tokenizer();
        expect(tokens.length).toBe(1);
    });

    it('should handle sentences with punctuation', () => {
        const sentence = new Sentence(3, 'Hello, world! This is a test.', {
            function: 'Premise',
            type: 'Declarative',
            purpose: 'To demonstrate punctuation handling',
            mood: 'Indicative',
            relation: {
                type: 'Justification',
                targetSentenceId: 4,
            },
        });
        const tokens = sentence.tokenizer();
        expect(tokens.length).toBe(6);
        expect(tokens[0].text).toBe('Hello');
        expect(tokens[1].text).toBe('world');
        expect(tokens[2].text).toBe('This');
        expect(tokens[3].text).toBe('is');
        expect(tokens[4].text).toBe('a');
        expect(tokens[5].text).toBe('test');
    });
});