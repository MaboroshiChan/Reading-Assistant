import React, { useState } from "react";
import type { SemanticNode } from "../analysis/structure/Sentence";
import './css/SemanticSentence.css'

interface SentenceComponentProps {
  node: SemanticNode;
  onHoverNode?: (id: string) => void;
  onLeaveNode?: (id: string) => void;
}

export const SentenceComponent: React.FC<SentenceComponentProps> = ({
  node,
  onHoverNode,
  onLeaveNode,
}) => {

  const [isHovered, setIsHovered] = useState(false);

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
      onMouseOver={()=>setIsHovered(true)}
      onMouseOut={()=>setIsHovered(false)}
    >
      {renderChildren()}
    </span>
  );
};