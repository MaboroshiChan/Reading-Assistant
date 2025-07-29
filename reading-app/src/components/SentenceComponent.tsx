import React from "react";
import type { SemanticNode } from "../analysis/structure/Sentence";
import './css/SemanticSentence.css'

interface SentenceComponentProps {
  node: SemanticNode;
  hoveredId: string | null;
  onHoverNode?: (id: string) => void;
  onLeaveNode?: () => void;
}

export const SentenceComponent: React.FC<SentenceComponentProps> = ({
  node,
  hoveredId,
  onHoverNode,
  onLeaveNode,
}) => {
  const isHovered =
    node.id === hoveredId || node.linkedBy?.includes(hoveredId ?? ""); // How to switch to another method to determine isHovered.

  const handleMouseEnter = () => {
    onHoverNode?.(node.id);
  };

  const handleMouseLeave = () => {
    onLeaveNode?.();
  };

  const className = "sentence " +  node.label.join(" ") + (isHovered ? " hovered" : ` ${node.id}`);

  const renderChildren = (): React.ReactNode => {
    // 如果是文本节点，直接输出文本
    if (node.text) return node.text;

    if (!node.children || node.children.length === 0) return null;

    return node.children.map((child, index) => {
      const spaceBefore =
        index > 0 &&
        !child.noSpaceBefore;

      return (
        <React.Fragment key={child.id}>
          {spaceBefore && " "}
          <SentenceComponent
            node={child}
            hoveredId={hoveredId}
            onHoverNode={onHoverNode}
            onLeaveNode={onLeaveNode}
          />
          {child.text && child.text === '.' && " "}
        </React.Fragment>
      );
    });
  };

  return (
    <span
      className={className}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {renderChildren()}
    </span>
  );
};