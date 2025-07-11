import { render } from '@testing-library/react';
import { SemanticSentence } from '../SemanticSentence';
import { Sentence, type SentenceLabels } from '../../analysis/structure/Sentence';
import example2 from '../../../examples/example2.json';
import type { LLMAnalysis } from '../SentenceLabels';
import {collectHighlightPhrases,
  findHighlightSpans,
  buildHighlightLayers,
  } from '../SentenceLabels';

describe('SemanticSentence', () => {
  it('renders a sentence', () => {
    // mock a Sentence object
    const mockSentence: Sentence = new Sentence(
      1,
      'This is a test sentence.',
      {
        function: 'Premise',
        type: 'Declarative',
        purpose: 'To demonstrate a test case',
        mood: 'Indicative',
        relation: {
          type: 'Justification',
          targetSentenceId: 2, // Assuming there's another sentence with ID 2
        },
      }
    );

    render(<SemanticSentence sentence={mockSentence} />);
  });
  it('makes a sentence with labels', () => {
    const labels: SentenceLabels = example2['sentence_labels'] as SentenceLabels;
    const sentence = Sentence.fromSentenceLabels(labels, {
      id: 1,
      function: 'Premise',
      type: 'Declarative',
      purpose: 'To demonstrate a test case',
      mood: 'Indicative',
      relation: {
        type: 'Justification',
        targetSentenceId: 2, // Assuming there's another sentence with ID 2
      },
    });
    expect(sentence.getRawText()).toBe("What would happen, Finkel and Eastwick wondered, if the instruction was “Women rotate,” if the men waited while the women stood and strode forward?");
  });
});

describe('Highlight module', () => {
  const mockLLMAnalysis: LLMAnalysis = {
    sentence: "Natural language processing significantly improves human-computer interaction.",
    semantics: {
      main_verb: "improves",
      proposition: "improve(nlp, interaction)",
      keywords: [
        { word: "natural language", type: "concept" },
        { word: "language processing", type: "concept" },
        { word: "human-computer interaction", type: "concept" },
        { word: "significantly", type: "concept" }
      ],
      semantic_roles: {
        agent: "natural language processing",
        patient: "human-computer interaction",
        instrument: ""
      }
    },
    pragmatics: {
      modality: "factual",
      tone: "analytical",
      emphasis: true,
      focus: ["processing", "significantly"]
    }
  };

  describe("Highlighter internal functions", () => {
  const sentence = mockLLMAnalysis.sentence;

  test("collectHighlightPhrases should merge keywords and focus", () => {
    const phrases = collectHighlightPhrases(mockLLMAnalysis);
    expect(phrases).toEqual(
      expect.arrayContaining([
        { word: "natural language", source: "keyword" },
        { word: "language processing", source: "keyword" },
        { word: "significantly", source: "keyword" },
        { word: "significantly", source: "focus" },
        { word: "processing", source: "focus" }
      ])
    );
  });

  test("findHighlightSpans should return correct match positions", () => {
    const phrases = collectHighlightPhrases(mockLLMAnalysis);
    const spans = findHighlightSpans(sentence, phrases);

    const naturalLang = sentence.toLowerCase().indexOf("natural language");
    const humanComp = sentence.toLowerCase().indexOf("human-computer interaction");

    expect(spans).toEqual(
      expect.arrayContaining([
        { start: naturalLang, end: naturalLang + 16, label: "keyword" },
        { start: humanComp, end: humanComp + 26, label: "keyword" },
      ])
    );
    
  });

  test("buildHighlightLayers should mark correct characters with labels", () => {
    const phrases = collectHighlightPhrases(mockLLMAnalysis);
    const spans = findHighlightSpans(sentence, phrases);
    const layers = buildHighlightLayers(sentence.length, spans);
    console.log(layers)

    // "processing" 被标记为 keyword 和 focus
    const processingStart = sentence.toLowerCase().indexOf("processing");
    for (let i = processingStart; i < processingStart + "processing".length; i++) {
      expect(layers[i]).toEqual(expect.arrayContaining(["keyword", "focus"]));
    }
  });

  });
});