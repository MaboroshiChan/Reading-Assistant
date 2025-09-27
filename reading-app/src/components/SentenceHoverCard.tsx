// SentenceHoverCard.tsx
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SentenceCardComponent } from './InfoComponent';
import type { SentenceViewModel } from "../analysis/viewModels/mapSentenceToVM";
import './css/Info.css';

type Props = {
  targetRef: React.RefObject<HTMLElement | null>;   // 被高亮的词/句
  info: SentenceViewModel;                   // 要展示的语义信息
  open?: boolean;                            // 也可受控
  offset?: number;                           // 与目标的间距
  enterDelayMs?: number;
  leaveDelayMs?: number;
};

export const SentenceHoverCard: React.FC<Props> = ({
  targetRef,
  info,
  open,
  offset = 8,
  enterDelayMs = 60,
  leaveDelayMs = 120
}) => {
  const [internalOpen, setInternalOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const enterTimer = useRef<number | null>(null);
  const leaveTimer = useRef<number | null>(null);

  const isOpen = open ?? internalOpen;

  // 计算并更新位置
  const updatePosition = () => {
    const el = targetRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const cardWidth = 448; // 28rem ≈ 448px（与 .card 宽度保持一致）
    const desiredLeft = Math.max(12, Math.min(rect.left + rect.width / 2 - cardWidth / 2, vw - cardWidth - 12));

    // 尝试显示在目标上方，不够空间就放下面
    const spaceTop = rect.top;
    const spaceBottom = vh - rect.bottom;
    const preferTop = spaceTop > spaceBottom;

    const top = preferTop ? rect.top - offset : rect.bottom + offset;

    setPos({
      top: Math.max(12, Math.min(top, vh - 12)),
      left: desiredLeft
    });
  };

  useLayoutEffect(() => {
    if (isOpen) updatePosition();
    // 监听窗口变化，保持跟随
    const onScrollOrResize = () => isOpen && updatePosition();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize, true);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize, true);
    };
  }, [isOpen]);

  // 目标元素 hover 事件
  useEffect(() => {
    const el = targetRef.current;
    if (!el || open !== undefined) return; // 受控时不绑定
    const onEnter = () => {
      if (leaveTimer.current) window.clearTimeout(leaveTimer.current);
      enterTimer.current = window.setTimeout(() => {
        setInternalOpen(true);
        updatePosition();
      }, enterDelayMs);
    };
    const onLeave = () => {
      if (enterTimer.current) window.clearTimeout(enterTimer.current);
      leaveTimer.current = window.setTimeout(() => setInternalOpen(false), leaveDelayMs);
    };
    el.addEventListener("mouseenter", onEnter);
    el.addEventListener("mouseleave", onLeave);
    return () => {
      el.removeEventListener("mouseenter", onEnter);
      el.removeEventListener("mouseleave", onLeave);
    };
  }, [targetRef, open, enterDelayMs, leaveDelayMs]);

  if (!isOpen || !pos) return null;

  // 通过 inline style 控制定位；样式外观仍由 .card 等类负责
  return createPortal(
    <div style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 1000 }}>
      <SentenceCardComponent info={info} />
    </div>,
    document.body
  );
};