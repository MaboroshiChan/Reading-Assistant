import React, { useState } from "react";
import type { SemanticNode } from "../analysis/structure/Sentence";
import './css/SemanticSentence.css'

interface SentenceComponentProps {
  node: SemanticNode;
  highlight: boolean;
  onHoverNode?: (id: string) => void;
  onLeaveNode?: (id: string) => void;
}



export const SentenceComponent: React.FC<SentenceComponentProps> = ({
  node,
  highlight,
  onHoverNode,
  onLeaveNode,
}) => {

  const [isHovered, setIsHovered] = useState(highlight);

  const label_type = node.id.split('-').length > 1 ? 'sentence component ' : 'sentence ';
  // we should change the class name here in accordance to component's type
  const className = label_type +  node.label.join(" ") + (isHovered ? " hovered" : ` ${node.id}`);

  const [group, setGroup] = useState<string[]>([]);

  console.log(`id=${node.id} && group=${group}`)

  const renderChildren = (): React.ReactNode => {
    // 如果是文本节点，直接输出文本
    if (node.text) return node.text;

    if (!node.children || node.children.length === 0) return null;

    //console.log(`path = ${hoveredPath}`)

    return node.children.map((child, index) => {
      console.log(`id=${child.id} children in group: ${group}`)
      const spaceBefore =
        index > 0 &&
        !child.noSpaceBefore;
    
      return (
        <React.Fragment key={child.id}>
          {spaceBefore && " "}
          <SentenceComponent
            highlight={group.includes(child.id)}
            node={child}
            onHoverNode={onHoverNode} // here something need to change
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
      onMouseOver={()=>{
        setGroup(node.linkedBy ? node.linkedBy: [])
        setIsHovered(true)
      }}
      onMouseOut={()=>setIsHovered(false)}
    >
      {renderChildren()}
    </span>
  );
};