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
  onStartSentenceStructure?: (path?: string) => void; // 点击按钮时触发，交给外层处理
  showSentenceStructureButton?: boolean; // 是否显示按钮，默认 true
  sentenceStructureActive?: boolean;     // 是否已显示子句分析，用于切换按钮文案
}


/**
 * A floating card that displays sentence analysis.
 * Automatically positions itself relative to the mouse or fingerprint.
 *
 * @param props - Component properties including anchor point and visibility.
 */
export const SentenceHoverCard: React.FC<SentenceHoverCardProps> = ({
  open,
  anchor,
  offset = 12,
  maxWidth = 420,
  children,
  onStartSentenceStructure,
  showSentenceStructureButton = true,
  sentenceStructureActive = false,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; isFlipped: boolean }>({
    left: 0,
    top: 0,
    isFlipped: false,
  });

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
    let top = anchor.y + offset; // 垂直放到鼠标正下方
    let isFlipped = false;

    // Check availability
    const spaceBelow = vh - top - margin;
    const spaceAbove = anchor.y - offset - margin;

    // If card is taller than space below, and we have more space above...
    if (height > spaceBelow && spaceAbove > spaceBelow) {
      isFlipped = true;
      top = anchor.y - offset - height;
    }

    // 夹紧，避免出屏
    left = Math.max(margin, Math.min(left, vw - width - margin));
    top = Math.max(margin, Math.min(top, vh - height - margin));

    setPos({ left, top, isFlipped });
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
        <div className={`hovercard-caret ${pos.isFlipped ? "flipped" : ""}`} aria-hidden />
        {children}
        {showSentenceStructureButton && (
          <div className="hovercard-footer">
            <button
              type="button"
              className={`hovercard-btn-action ${sentenceStructureActive ? "active" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                onStartSentenceStructure?.();
              }}
            >
              {sentenceStructureActive ? (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                  <span>关闭子结构分析</span>
                </>
              ) : (
                <>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2L14.4 9.6L22 12L14.4 14.4L12 22L9.6 14.4L2 12L9.6 9.6L12 2Z" />
                    <path d="M19 1L20.2 3.8L23 5L20.2 6.2L19 9L17.8 6.2L15 5L17.8 3.8L19 1Z" opacity="0.8" />
                  </svg>
                  <span>启动子结构分析</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default SentenceHoverCard;
