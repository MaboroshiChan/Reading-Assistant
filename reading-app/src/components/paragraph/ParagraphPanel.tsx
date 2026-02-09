import React from 'react';
import type { ParagraphViewModel } from '../../model/viewModels/mapParagraphToVM';
import './css/ParagraphPanel.css';

interface ParagraphPanelProps {
    vm: ParagraphViewModel;
}

/**
 * Renders an analysis panel displaying paragraph metadata like central idea and structure.
 *
 * @param props - Component properties containing the paragraph view model.
 */
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
                    <div className="paragraph-section">
                        <span className="paragraph-label">Topic Sentence ({vm.topicSentence.is_implicit ? 'Implicit' : 'Explicit'}):</span>
                        {vm.topicSentence.text}
                    </div>
                )}
                {vm.errorMessage && (
                    <div className="paragraph-section error">
                        <span className="paragraph-label">Error:</span>
                        <span className="error-message">{vm.errorMessage}</span>
                    </div>
                )}
                {!vm.centralIdea && !vm.structureType && !vm.function && !vm.topicSentence && !vm.errorMessage && (
                    <span className="paragraph-label">No analysis data available.</span>
                )}
            </div>
        </div>
    );
};
