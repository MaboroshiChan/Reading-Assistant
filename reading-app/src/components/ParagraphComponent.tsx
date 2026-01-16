import React, { useCallback, useMemo, useState, type MouseEvent } from "react";
import type Paragraph from "../model/structure/Paragraph";
import "./css/ParagraphComponent.css";
import SentenceComponent from "./SentenceComponent";
import mapParagraphToVM from "../model/viewModels/mapParagraphToVM";

// There is no paragraph hover card

interface ParagraphComponentProps {
  paragraph: Paragraph;
}

export const ParagraphComponent: React.FC<ParagraphComponentProps> = ({ paragraph }) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isClicked, setIsClicked] = useState(false);
  const paragraphVm = useMemo(() => mapParagraphToVM(paragraph), [paragraph]);

  const isInteractive = !paragraph.status || paragraph.status === 'complete';

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleMouseEnter = useCallback((_event: MouseEvent<HTMLDivElement>) => {
    if (isInteractive) setIsHovered(true);
  }, [isInteractive]);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleMouseMove = useCallback((_event: MouseEvent<HTMLDivElement>) => {
    // no-op for now; reserved for future pointer sync
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsHovered(false);
  }, []);

  const [activeBridgeId, setActiveBridgeId] = useState<string | null>(null);

  const handleClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (!isInteractive) return;
    // If clicking paragraph background (not bridge), we might want to reset bridge?
    // Current logic toggles paragraph clicked state. 
    setIsClicked((prev) => {
      const next = !prev;
      if (!next) {
        setIsHovered(false);
        setActiveBridgeId(null); // Clear bridge selection on deselect
      }
      return next;
    });
  }, [isInteractive]);

  const handleBridgeClick = useCallback((bridgeId: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent paragraph click
    setActiveBridgeId(prev => prev === bridgeId ? null : bridgeId);
  }, []);

  const className = [
    "paragraph",
    "component",
    isHovered ? "hovered" : "",
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
      onClick={handleClick}
    >
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
              />
            );
          }
        }

        // Determine if this sentence should be highlighted by a bridge
        // It should be highlighted if the bridge BEFORE it is active OR the bridge AFTER it is active.
        const prevSentence = index > 0 ? paragraph.sentences[index - 1] : null;
        const nextSentence = index < paragraph.sentences.length - 1 ? paragraph.sentences[index + 1] : null;

        const bridgeBeforeId = prevSentence ? `${prevSentence.id}-${sentence.id}` : null;
        // Logic for bridge after: if next sentence points to current
        // We only support 'backward' relations for bridges right now as per logic above
        const relFromNext = nextSentence?.relation && nextSentence.relation.targetSentenceId === sentence.id;
        const bridgeAfterId = relFromNext ? `${sentence.id}-${nextSentence!.id}` : null; // Note: using ! because logical check passed

        const isBridgeHighlighted =
          (bridgeBeforeId !== null && activeBridgeId === bridgeBeforeId) ||
          (bridgeAfterId !== null && activeBridgeId === bridgeAfterId);

        return (
          <React.Fragment key={sentence.id}>
            {bridge}
            <SentenceComponent
              id={sentence.id - paragraph.id}
              paragraphId={paragraph.id}
              sentence={sentence}
              interactionEnabled={isInteractive}
              isBridgeHighlighted={isBridgeHighlighted}
            />
          </React.Fragment>
        );
      })}
    </div>
  );
};

// Import helper to avoid top-level import issues if not yet defined in file
import { SentenceBridge as ImportedSentenceBridge } from "./SentenceBridge";
