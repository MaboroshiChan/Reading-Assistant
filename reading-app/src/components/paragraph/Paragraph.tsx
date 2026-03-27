import React, { useCallback, useMemo, useState, type MouseEvent } from "react";
import type Paragraph from "../../model/structure/Paragraph";
import { isPending } from "../../model/structure/Sentence";
import "./css/Paragraph.css";
import SentenceComponent from "../sentence/Sentence";
import mapParagraphToVM from "../../model/viewModels/mapParagraphToVM";
import { ParagraphGutter } from "./ParagraphGutter";
import { ParagraphPanel } from "./ParagraphPanel";
import { getRelationConfig } from "../sentence/Relations";

// Import helper to avoid top-level import issues if not yet defined in file
import { SentenceBridge as ImportedSentenceBridge } from "../sentence/Bridge";

interface ParagraphComponentProps {
  paragraph: Paragraph;
  onReanalyze?: (id: number) => void;
}

/**
 * Renders a full paragraph with its gutter, analysis panel, and constituent sentences.
 *
 * @param props - Component properties containing the paragraph data.
 */
export const ParagraphComponent: React.FC<ParagraphComponentProps> = ({ paragraph, onReanalyze }) => {
  // Special rendering for titles
  if (paragraph.kind === 'title') {
    return (
      <div className="paragraph-title-container" style={{ margin: '2rem 0 1rem 0' }}>
        <h2 className="paragraph-title" style={{
          fontSize: '1.5rem',
          fontWeight: 'bold',
          color: 'var(--color-text-main)',
          lineHeight: '1.3'
        }}>
          {paragraph.sentences.map(s => s.text).join(' ')}
        </h2>
      </div>
    );
  }

  // Special rendering for citations/notes
  if (paragraph.kind === 'citation') {
    return (
      <div className="paragraph-citation-container" style={{ margin: '1rem 0', opacity: 0.8 }}>
        <p className="paragraph-citation" style={{
          fontSize: '1rem',
          color: 'var(--color-text-secondary)',
          lineHeight: '1.5'
        }}>
          {paragraph.sentences.map(s => s.text).join(' ')}
        </p>
      </div>
    );
  }

  // Special rendering for short paragraphs that don't warrant analysis
  if (paragraph.kind === 'short') {
    return (
      <div className="paragraph-short-container" style={{ margin: '0.75rem 0', display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
        <p className="paragraph-short" style={{
          fontSize: '1rem',
          color: 'var(--color-text-main)',
          fontStyle: 'italic',
          lineHeight: '1.6',
          margin: 0,
        }}>
          {paragraph.sentences.map(s => s.text).join(' ')}
        </p>
      </div>
    );
  }

  // isClicked now serves as "isActive" for showing the panel
  const [isClicked, setIsClicked] = useState(false);
  const [hoveredBridgeId, setHoveredBridgeId] = useState<string | null>(null);
  const paragraphVm = useMemo(() => mapParagraphToVM(paragraph), [paragraph]);

  // Debugging Topic Sentence Data
  React.useEffect(() => {
    if (paragraph.status === 'complete') {
      console.log(`[Paragraph ${paragraph.id}] VM Data:`, paragraphVm);
    }
  }, [paragraph.status, paragraph.id, paragraphVm]);

  const isInteractive = paragraph.status === 'complete' || paragraph.status === 'error' || paragraph.status === 'streaming';

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleMouseEnter = useCallback((_event: MouseEvent<HTMLDivElement>) => {
    // Hover logic handled by gutter now
    // if (isInteractive) setIsHovered(true);
  }, [isInteractive]);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleMouseMove = useCallback((_event: MouseEvent<HTMLDivElement>) => {
    // no-op for now; reserved for future pointer sync
  }, []);

  const handleMouseLeave = useCallback(() => {
    // setIsHovered(false);
  }, []);

  const [activeBridgeId, setActiveBridgeId] = useState<string | null>(null);

  const handleClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (!isInteractive) return;

    // Toggle active state for panel
    setIsClicked((prev) => {
      const next = !prev;
      if (!next) {
        // setIsHovered(false);
        setActiveBridgeId(null);
      }
      return next;
    });
  }, [isInteractive]);

  const handleBridgeClick = useCallback((bridgeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveBridgeId(prev => prev === bridgeId ? null : bridgeId);
  }, []);

  const handleBridgeMouseEnter = useCallback((bridgeId: string) => {
    setHoveredBridgeId(bridgeId);
  }, []);

  const handleBridgeMouseLeave = useCallback(() => {
    setHoveredBridgeId(null);
  }, []);

  const className = [
    "paragraph",
    "component",
    // isHovered ? "hovered" : "", // Removed hovered class from container to reduce noise, gutter handles it
    isClicked ? "clicked" : "",
    paragraph.status ? `status-${paragraph.status}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  // Visual feedback for pending state (Gray)
  const style: React.CSSProperties = {
    transition: "all 0.5s ease",
    ...(paragraph.status === "pending"
      ? { opacity: 0.6, filter: "grayscale(100%)" }
      : {}),
    // Disable interactions (including CSS :hover) until analysis is complete
    ...(!isInteractive ? { pointerEvents: "none" } : {}),
  };

  return (
    <div
      className={className}
      data-paragraph-id={paragraphVm.id}
      style={style}
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <ParagraphGutter
        id={paragraph.id}
        status={paragraph.status}
        structureType={paragraphVm.structureType}
        isActive={isClicked}
        onClick={(e) => {
          e.stopPropagation();
          handleClick(e as any);
        }}
      />

      <div className="paragraph-content-wrapper" style={{ flex: 1, position: 'relative' }}>
        {isClicked && <ParagraphPanel vm={paragraphVm} />}
        {onReanalyze && isInteractive && (
          <button 
            className="paragraph-reanalyze-btn" 
            onClick={(e) => { e.stopPropagation(); onReanalyze(paragraph.id); }}
            title="Reanalyze Paragraph"
            type="button"
          >
            🔄
          </button>
        )}

        <div className="paragraph-content" onClick={handleClick}>
          {paragraph.sentences.map((sentence, index) => {
            // Logic to determine if a bridge is needed before this sentence
            let bridge = null;
            if (index > 0) {
              const prevSentence = paragraph.sentences[index - 1];
              // Check if current sentence has a relation pointing to previous (normal backward flow)
              const relToPrev = sentence.relation && sentence.relation.targetSentenceId === prevSentence.id
                ? sentence.relation
                : null;

              const isPrevReady = !isPending(prevSentence);
              const isCurrReady = !isPending(sentence);

              if (relToPrev && isPrevReady && isCurrReady) {
                const bridgeId = `${prevSentence.id}-${sentence.id}`;
                const isActive = activeBridgeId === bridgeId;

                bridge = (
                  <ImportedSentenceBridge
                    key={`bridge-${bridgeId}`}
                    type={relToPrev.type}
                    isActive={isActive}
                    onClick={(e) => handleBridgeClick(bridgeId, e)}
                    onMouseEnter={() => handleBridgeMouseEnter(bridgeId)}
                    onMouseLeave={handleBridgeMouseLeave}
                  />
                );
              }
            }

            // Determine if this sentence should be highlighted by a bridge
            const prevSentence = index > 0 ? paragraph.sentences[index - 1] : null;
            const nextSentence = index < paragraph.sentences.length - 1 ? paragraph.sentences[index + 1] : null;

            const bridgeBeforeId = prevSentence ? `${prevSentence.id}-${sentence.id}` : null;
            const relFromNext = nextSentence?.relation && nextSentence.relation.targetSentenceId === sentence.id;
            const bridgeAfterId = relFromNext ? `${sentence.id}-${nextSentence!.id}` : null;

            const effectiveBridgeId = activeBridgeId || hoveredBridgeId;

            let bridgeHighlightColor: string | undefined;

            if (effectiveBridgeId) {
              if (bridgeBeforeId === effectiveBridgeId && sentence.relation) {
                // Highlighting caused by the bridge BEFORE this sentence (relation from this -> prev)
                // This sentence is the "second" part of the relation
                bridgeHighlightColor = getRelationConfig(sentence.relation.type).colors.sentence_second;
              } else if (bridgeAfterId === effectiveBridgeId && nextSentence?.relation) {
                // Highlighting caused by the bridge AFTER this sentence (relation from next -> this)
                // This sentence is the "first" part of the relation
                bridgeHighlightColor = getRelationConfig(nextSentence.relation.type).colors.sentence_first;
              }
            }

            // Check for explicit topic sentence
            const normalize = (s: string) => s.trim().toLowerCase().replace(/[^\w\s]|_/g, "").replace(/\s+/g, " ");
            const isTopicSentence = (() => {
              if (paragraphVm.topicSentence?.is_implicit) return false;
              const topic = paragraphVm.topicSentence;
              if (!topic) return false;

              const topicText = topic.text;
              const textMatch = topicText && normalize(sentence.text).includes(normalize(topicText));
              if (textMatch) return true;

              // Fallback to ID matching
              if (topic.id && String(index + 1) === String(topic.id)) {
                return true;
              }

              return false;
            })();

            return (
              <React.Fragment key={sentence.id}>
                {bridge}
                <SentenceComponent
                  id={sentence.id - paragraph.id}
                  paragraphId={paragraph.id}
                  sentence={sentence}
                  interactionEnabled={isInteractive}
                  bridgeHighlightColor={bridgeHighlightColor}
                  isTopicSentence={!!isTopicSentence}
                />
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
};
