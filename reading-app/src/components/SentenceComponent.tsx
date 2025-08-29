import React, { useState } from "react";
import type { SemanticNode } from "../analysis/structure/Sentence";
import './css/SemanticSentence.css';
import { useSingleOrDoubleClick } from "./LongClick";

interface SentenceComponentProps {
  node: SemanticNode;
  highlight: string[];
  highlightable: boolean; // highlightable sub-component
  getGroup: (group: string[]) => void;
  remove: (group: string[]) => void;
  sendClicked: (id: string | null) => void;
  increase: () => void;
  decrease: () => void;
}

export const SentenceComponent: React.FC<SentenceComponentProps> = ({
  node,
  highlight,
  getGroup,
  remove,
  sendClicked,
  highlightable,
  increase,
  decrease
}) => {

  const [isClicked, setIsClicked] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [subNodeCount, setSubNodeCount] = useState(0); //层层上报
  const label_type = node.id.split('-').length > 1 ? 'sentence component ' : 'sentence ';

  const className = label_type + node.label.join(" ") +
    //(highlight.includes(node.id) || 
    (isHovered ? " hovered" : ` ${node.id}`);


  const increaseCount = () => {
    setSubNodeCount(n => n + 1);
  }

  const decreaseCount = () => {
    setSubNodeCount(n => n - 1)
  }

  /**
   * 如果mouse out了是否需要取消？
   * 如果mouse click了其他component，要怎么办？
   * click兄弟节点怎么办? potential response: 其他节点unhover
   * 
   */
  const mouseOver = () => {
    if (highlightable) {
      if (node.linkedBy) {
        getGroup(node.linkedBy);
      }
      setIsHovered(true)
    }
  }

  const mouseOut = () => {
    if (node.linkedBy) {
      remove(node.linkedBy)
    }
    if (!isClicked) {
      setIsHovered(false);
    }
  }

  const handleClick = useSingleOrDoubleClick({
    onClick: () => {
        console.warn(`id = ${node.id}, isClick=${isClicked}, subNode=${subNodeCount}`)
        if (isClicked && subNodeCount === 0) { 
          setIsClicked(() => false); 
          setIsHovered(false);
          sendClicked(null);
          decrease();
        }
      },
    onDoubleClick: () => {
        if (highlightable && !isClicked) {
          setIsClicked(() => true); 
          increase();
          sendClicked(node.id);
          setIsHovered(true);
        }
      }
  });

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
            highlightable={isClicked} // if one-layer below subnodes are highlightable, BUG detected.
            sendClicked={() => {}}
            node={child}
            increase={increaseCount}
            decrease={decreaseCount}
          />
          {child.text && child.text === '.' && " "}
        </React.Fragment>
      );
    });
  };

  console.log(`id = ${node.id}, sub nodes number = ${subNodeCount}, isClicked = ${isClicked}`)

  return (
    <span
      className={className}
      onMouseOver={mouseOver}
      onMouseOut={mouseOut}
      onClick={handleClick} 
    >
      {renderChildren()}
    </span>
  );
};