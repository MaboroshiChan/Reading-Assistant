// SentenceHoverCard.tsx
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import "./css/Info.css";

type Point = { x: number; y: number };

interface SentenceHoverCardProps {
  open: boolean;
  anchor?: Point;      // 鼠标坐标（来自 SentenceComponent 的 onMouseMove）
  offset?: number;     // 鼠标到卡片的垂直间距，默认 12px
  maxWidth?: number;   // 可选最大宽度，默认 420
  children: React.ReactNode;
  onStartSubSentence?: (path?: string) => void; // 点击按钮时触发，交给外层处理
  showSubSentenceButton?: boolean; // 是否显示按钮，默认 true
  subSentenceActive?: boolean;     // 是否已显示子句分析，用于切换按钮文案
}


export const SentenceHoverCard: React.FC<SentenceHoverCardProps> = ({
  open,
  anchor,
  offset = 12,
  maxWidth = 420,
  children,
  onStartSubSentence: onStartSubSentence,
  showSubSentenceButton: showSubSentenceButton = true,
  subSentenceActive: subSentenceActive = false,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });

  // 根据实际尺寸把卡片放到鼠标正下方，并防止越界
  useLayoutEffect(() => {
    if (!open || !anchor) return;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 8;

    // 先给一个兜底尺寸，随后用真实尺寸再校正
    let width = Math.min(maxWidth, 420);
    let height = 160;

    const el = cardRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      if (rect.width) width = Math.min(maxWidth, rect.width);
      if (rect.height) height = rect.height;
    }

    let left = anchor.x - width / 2; // 水平以鼠标为中心
    let top = anchor.y + offset;     // 垂直放到鼠标正下方

    // 夹紧，避免出屏
    left = Math.max(margin, Math.min(left, vw - width - margin));
    top = Math.max(margin, Math.min(top, vh - height - margin));

    setPos({ left, top });
  }, [open, anchor, offset, maxWidth]);

  // 当窗口尺寸变化时，重新计算一次（避免缩放错位）
  useEffect(() => {
    const onResize = () => {
      if (!open || !anchor) return;
      // 触发上面的 useLayoutEffect
      setPos((p) => ({ ...p }));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open, anchor]);

  if (!open || !anchor) return null;

  return (
    <div
      className="hovercard"              // 外层容器：负责 fixed 定位与层级
      style={{
        position: "fixed",
        left: pos.left,
        top: pos.top,
        zIndex: 9999,
        maxWidth,
      }}
      aria-hidden={false}
    >
      <div ref={cardRef} className="hovercard-inner" style={{ maxWidth }}>
        {/* 顶部小三角：稍后在 Info.css 里让它 left:50% + translateX(-50%) 水平居中 */}
        <div className="hovercard-caret" aria-hidden />
        {children}
        {showSubSentenceButton && ( /* ← 新增开始 */
          <div className="hovercard-footer">
            <button
              type="button"
              onClick={(e)=>{ e.stopPropagation(); onStartSubSentence?.(); }}
            >
              {subSentenceActive ? "关闭子结构分析" : "启动子结构分析"}
            </button>
          </div>
        )}  
      </div>
    </div>
  );
};

export default SentenceHoverCard;
