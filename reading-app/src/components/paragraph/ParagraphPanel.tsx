import React from 'react';
import type { ParagraphViewModel } from '../../model/viewModels/mapParagraphToVM';
import { Tag } from './Tag';
import './css/ParagraphPanel.css';

interface ParagraphPanelProps {
    vm: ParagraphViewModel;
}

/**
 * Renders an analysis panel displaying paragraph metadata like tags and structure.
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
                {vm.tags && vm.tags.length > 0 && (
                    <div className="paragraph-tags-container">
                        {vm.tags.map((tag, idx) => (
                            <Tag key={idx} name={tag.name} type={tag.type} description={tag.description} />
                        ))}
                    </div>
                )}
                {vm.errorMessage && (
                    <div className="paragraph-section error">
                        <span className="paragraph-label">Error:</span>
                        <span className="error-message">{vm.errorMessage}</span>
                    </div>
                )}
                {(!vm.tags || vm.tags.length === 0) && !vm.structureType && !vm.function && !vm.errorMessage && (
                    <span className="paragraph-label">No analysis data available.</span>
                )}
            </div>
        </div>
    );
};
