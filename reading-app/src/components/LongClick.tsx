import { useRef } from "react";

type ClickHandlers = {
  onClick?: () => void;
  onDoubleClick?: () => void;
  delay?: number; // 单击和双击的判定间隔，默认 250ms
};

/**
 * Hook to distinguish between single and double clicks on the same element.
 *
 * @param props - Click handlers and optional delay.
 * @returns A click handler to attach to the element.
 */
export function useSingleOrDoubleClick({
  onClick,
  onDoubleClick,
  delay = 250,
}: ClickHandlers) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleClick() {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
      onDoubleClick?.(); // 触发双击
    } else {
      timer.current = setTimeout(() => {
        onClick?.(); // 触发单击
        timer.current = null;
      }, delay);
    }
  }

  return handleClick;
}