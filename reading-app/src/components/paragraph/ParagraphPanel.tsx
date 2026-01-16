import React from 'react';
import type { ParagraphViewModel } from '../../model/viewModels/mapParagraphToVM';
import './css/ParagraphPanel.css';

interface ParagraphPanelProps {
    vm: ParagraphViewModel;
}

export const ParagraphPanel: React.FC<ParagraphPanelProps> = ({ vm }) => {
    return (
        <div className="paragraph-panel">
            <div className="paragraph-panel-header">
                {vm.structureType && (
                    <span className="paragraph-tag structure">{vm.structureType}</span>
                )}
                {vm.function && (
                    <span className="paragraph-tag function">{vm.function}</span>
                )}
            </div>
            <div className="paragraph-panel-body">
                {vm.centralIdea && (
                    <div>
                        <span className="paragraph-label">Central Idea:</span>
                        {vm.centralIdea}
                    </div>
                )}
                {vm.topicSentence && (
                    <div style={{ marginTop: '8px' }}>
                        <span className="paragraph-label">Topic Sentence ({vm.topicSentence.is_implicit ? 'Implicit' : 'Explicit'}):</span>
                        {vm.topicSentence.text}
                    </div>
                )}
                {!vm.centralIdea && !vm.structureType && !vm.function && !vm.topicSentence && (
                    <span className="paragraph-label">No analysis data available.</span>
                )}
            </div>
        </div>
    );
};
