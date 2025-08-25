import React, { useState } from "react";
import type { SemanticNode } from "../analysis/structure/Sentence";
import './css/SemanticSentence.css'

interface SentenceComponentProps {
  node: SemanticNode;
  highlight: string[];
  getGroup: (group: string[]) => void;
  remove: (group: string[]) => void;
}

export const SentenceComponent: React.FC<SentenceComponentProps> = ({
  node,
  highlight,
  getGroup,
  remove
}) => {

  const [isHovered, setIsHovered] = useState(false); // error

  const label_type = node.id.split('-').length > 1 ? 'sentence component ' : 'sentence ';
  // we should change the class name here in accordance to component's type
  const className = label_type +  node.label.join(" ") + (highlight.includes(node.id) || isHovered ? " hovered" : ` ${node.id}`);

  const renderChildren = (): React.ReactNode => {
    // 问题：这里似乎不受mouseOver的代码
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
            remove={remove}
            getGroup={getGroup} // need to change
            highlight={highlight}
            node={child}
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
        if(node.linkedBy){
            getGroup(node.linkedBy);
        }
        setIsHovered(true)
      }}
      onMouseOut={()=>{
        if(node.linkedBy) {
          remove(node.linkedBy)
        }
        setIsHovered(false)
      }}
    >
      {renderChildren()}
    </span>
  );
};