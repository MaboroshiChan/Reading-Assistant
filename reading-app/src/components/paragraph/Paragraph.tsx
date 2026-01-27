import React, { useCallback, useMemo, useState, type MouseEvent } from "react";
import type Paragraph from "../../model/structure/Paragraph";
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
}

/**
 * Renders a full paragraph with its gutter, analysis panel, and constituent sentences.
 *
 * @param props - Component properties containing the paragraph data.
 */
export const ParagraphComponent: React.FC<ParagraphComponentProps> = ({ paragraph }) => {

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

  const isInteractive = !paragraph.status || paragraph.status === 'complete';

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

      <div className="paragraph-content-wrapper" style={{ flex: 1 }}>
        {isClicked && <ParagraphPanel vm={paragraphVm} />}

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

              const isPrevReady = prevSentence.function !== 'Pending';
              const isCurrReady = sentence.function !== 'Pending';

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
            const isTopicSentence = !paragraphVm.topicSentence?.is_implicit &&
              paragraphVm.topicSentence?.text &&
              normalize(sentence.text).includes(normalize(paragraphVm.topicSentence.text));

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
