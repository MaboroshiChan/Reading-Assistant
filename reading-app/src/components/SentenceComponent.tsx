import React from "react";
import type { SemanticNode } from "../analysis/structure/Sentence";

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
    node.id === hoveredId || node.linkedBy?.includes(hoveredId ?? "");

  const handleMouseEnter = () => {
    onHoverNode?.(node.id);
  };

  const handleMouseLeave = () => {
    onLeaveNode?.();
  };

  const className = node.label.join(" ") + (isHovered ? " hovered" : "");

  const renderChildren = (): React.ReactNode => {
    // 如果是文本节点，直接输出文本
    if (node.text) return node.text;

    if (!node.children || node.children.length === 0) return null;

    return node.children.map((child, index) => {
      const prev = node.children[index - 1];
      const spaceBefore =
        index > 0 &&
        !child.noSpaceBefore &&
        !prev?.noSpaceAfter;

      return (
        <React.Fragment key={child.id}>
          {spaceBefore && " "}
          <SentenceComponent
            node={child}
            hoveredId={hoveredId}
            onHoverNode={onHoverNode}
            onLeaveNode={onLeaveNode}
          />
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