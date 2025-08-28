import React, {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
} from "react";

type SpanProps = React.ComponentPropsWithoutRef<"span">;

export interface LongClickSpanProps extends Omit<SpanProps, "onClick"> {
  onLongClick: (e: React.PointerEvent<HTMLSpanElement>) => void;
  onClick?: (e: React.MouseEvent<HTMLSpanElement>) => void; // 保留短点
  delay?: number;                 // 长按判定(ms)，默认600
  cancelOnMove?: boolean;         // 移动取消，默认true
  moveThreshold?: number;         // 移动阈值(px)，默认10
  suppressClickOnLongPress?: boolean; // 长按后是否抑制click，默认true
  preventContextMenu?: boolean;   // 阻止长按菜单，默认true
}

export const LongClickSpan = forwardRef<HTMLSpanElement, LongClickSpanProps>(
  (
    {
      onLongClick,
      onClick,
      delay = 600,
      cancelOnMove = true,
      moveThreshold = 10,
      suppressClickOnLongPress = true,
      preventContextMenu = true,
      style,
      children,
      ...rest
    },
    ref
  ) => {
    const timerRef = useRef<number | null>(null);
    const startPos = useRef<{ x: number; y: number } | null>(null);
    const longFiredRef = useRef(false);     // 是否已触发长按
    const shortHandledRef = useRef(false);  // 是否已手动触发短点(onClick)
    const elRef = useRef<HTMLSpanElement | null>(null);

    const setRef = useCallback(
      (node: HTMLSpanElement | null) => {
        elRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) (ref as React.MutableRefObject<HTMLSpanElement | null>).current = node;
      },
      [ref]
    );

    const clearTimer = useCallback(() => {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }, []);

    const resetFlags = () => {
      longFiredRef.current = false;
      shortHandledRef.current = false;
    };

    const handlePointerDown = (e: React.PointerEvent<HTMLSpanElement>) => {
      resetFlags();
      startPos.current = { x: e.clientX, y: e.clientY };
      // 可选：捕获指针，确保拿到后续事件
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);

      clearTimer();
      timerRef.current = window.setTimeout(() => {
        longFiredRef.current = true;
        onLongClick(e);
        clearTimer();
      }, delay);
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLSpanElement>) => {
      if (!cancelOnMove || !startPos.current) return;
      const dx = e.clientX - startPos.current.x;
      const dy = e.clientY - startPos.current.y;
      if (dx * dx + dy * dy > moveThreshold * moveThreshold) {
        // 移动过大：取消长按
        clearTimer();
      }
    };

    const finishPointer = (e: React.PointerEvent<HTMLSpanElement>) => {
      // 还没触发长按 => 视为短点，手动调用 onClick（若提供）
      if (!longFiredRef.current) {
        clearTimer();
        if (onClick) {
          // 手动触发一次短点
          onClick(e as unknown as React.MouseEvent<HTMLSpanElement>);
          shortHandledRef.current = true;
        }
      } else {
        // 已经长按触发：后续 click 可能会到来，交给 onClickCapture 里抑制
      }
      startPos.current = null;
    };

    const handlePointerUp = finishPointer;
    const handlePointerCancel = () => {
      clearTimer();
      startPos.current = null;
    };
    const handlePointerLeave = () => {
      clearTimer();
      startPos.current = null;
    };

    // 统一在 capture 阶段拦截原生 click，避免重复或长按后的误触
    const handleClickCapture: React.MouseEventHandler<HTMLSpanElement> = (e) => {
      // 如果我们已经手动触发了短点，阻止原生 click 再次冒泡
      if (shortHandledRef.current) {
        e.preventDefault();
        e.stopPropagation();
        shortHandledRef.current = false; // 重置
        return;
      }
      // 如果是长按分支且需要抑制 click
      if (longFiredRef.current && suppressClickOnLongPress) {
        e.preventDefault();
        e.stopPropagation();
        longFiredRef.current = false; // 重置
        return;
      }
      // 其他情况：不拦截，让用户自己绑定的 onClick（若直接透传给 span）生效
    };

    // 可选：阻止移动端长按弹出菜单
    useEffect(() => {
      const el = elRef.current;
      if (!el || !preventContextMenu) return;
      const onCtx = (ev: Event) => ev.preventDefault();
      el.addEventListener("contextmenu", onCtx);
      return () => el.removeEventListener("contextmenu", onCtx);
    }, [preventContextMenu]);

    // 卸载清理
    useEffect(() => clearTimer, [clearTimer]);

    return (
      <span
        ref={setRef}
        style={{
          userSelect: "none",
          touchAction: "manipulation",
          cursor: "pointer",
          ...style,
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onPointerLeave={handlePointerLeave}
        onClickCapture={handleClickCapture}
        {...rest} // 可照常传 onMouseOver、className、data-*、aria-* 等
      >
        {children}
      </span>
    );
  }
);
LongClickSpan.displayName = "LongClickSpan";