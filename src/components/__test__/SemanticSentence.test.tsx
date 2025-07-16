import { render } from '@testing-library/react';
import { SemanticSentence } from '../SemanticSentence';
import { Sentence, type SentenceLabels } from '../../analysis/structure/Sentence';
import example2 from '../../../examples/example2.json';

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