import React from "react";
import type { SemanticNode } from "../analysis/structure/Sentence";
import './css/SemanticSentence.css'
import { OrderedSet } from 'immutable';

interface SentenceComponentProps {
  node: SemanticNode;
  hoveredPath: OrderedSet<string>;
  onHoverNode?: (id: string) => void;
  onLeaveNode?: (id: string) => void;
}

export const SentenceComponent: React.FC<SentenceComponentProps> = ({
  node,
  hoveredPath,
  onHoverNode,
  onLeaveNode,
}) => {
  let isHovered =
    hoveredPath.contains(node.id); // How to switch to another method to determine isHovered.

  for (const each in node.linkedBy) {
    if (hoveredPath.contains(each)) {
        isHovered = true;
    }
  }

  const handleMouseEnter = () => {
    onHoverNode?.(node.id);
  };

  const handleMouseLeave = () => {
    onLeaveNode?.(node.id);
  };

  const className = "sentence " +  node.label.join(" ") + (isHovered ? " hovered" : ` ${node.id}`);

  const renderChildren = (): React.ReactNode => {
    // 如果是文本节点，直接输出文本
    if (node.text) return node.text;

    if (!node.children || node.children.length === 0) return null;

    //console.log(`path = ${hoveredPath}`)

    return node.children.map((child, index) => {
      const spaceBefore =
        index > 0 &&
        !child.noSpaceBefore;
    
      return (
        <React.Fragment key={child.id}>
          {spaceBefore && " "}
          <SentenceComponent
            node={child}
            hoveredPath={hoveredPath}
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
      onMouseOver={handleMouseEnter}
      onMouseOut={handleMouseLeave}
    >
      {renderChildren()}
    </span>
  );
};