import {render, screen} from '@testing-library/react';
import {SemanticToken} from '../SemanticToken';
import type { Token } from '../../analysis/structure/Token';

describe('SemanticToken', () => {
  it('renders a token with text and role', () => {
    const mockToken: Token = {
        text: 'test',
        pos: 'NOUN',
        lemma: 'test',
        role: 'Subject',
        subClause: {
            id: 1,
            text: 'This is a sub-clause.',
            function: 'Definition',
            mood: 'Indicative',
            tokens: [
                {text: 'This', pos: 'DET', lemma: 'this'},
                {text: 'is', pos: 'VERB', lemma: 'be'},
                {text: 'a', pos: 'DET', lemma: 'a'},
                {text: 'sub-clause.', pos: 'NOUN', lemma: 'sub-clause'}
            ]
        }
    }
    render(<SemanticToken token={mockToken} />);
    expect(screen.getByText('test')).toBeInTheDocument();
    expect(screen.getByText('test')).toHaveClass('token');
    expect(screen.getByText('test')).toHaveClass('token');
  });
});