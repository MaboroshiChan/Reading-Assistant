// SentenceComponent.tsx
import React, { useState, useCallback, type KeyboardEvent, type MouseEvent } from "react";
import type { Sentence } from "../analysis/structure/Sentence";
import "./css/SentenceComponent.css";
import { SentenceHoverCard } from "./SentenceHoverCard"; // 新增：引入悬浮卡片
import type { SubSentenceAnalysis, SubUnit } from "../analysis/structure/SubSentence";
import SubSentenceComponent from "./SubSentenceComponent";

const FREEZE_EVENT = "hovercard:freeze";

interface SentenceComponentProps {
    sentence: Sentence;
    onToggleFocus?: (id: number, isFocused: boolean) => void;
    onHoverChange?: (id: number, isHovered: boolean) => void;
}

// 鼠标坐标类型
type Point = { x: number; y: number };

export const SentenceComponent: React.FC<SentenceComponentProps> = ({
    sentence,
    onToggleFocus,
    onHoverChange,
}) => {
    /**
     * 逻辑：
     * - 悬停：显示悬浮卡片
     * - 点击：切换“聚焦”状态
     * - onMouseMove：捕获鼠标坐标（clientX/Y），用于把卡片定位到鼠标正下方
     */
    const [isClicked, setIsClicked] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
    const [isFrozen, setIsFrozen] = useState(false);
    const [globalFrozenId, setGlobalFrozenId] = useState<number | null>(null);
    const [subSentenceAnalysis, setSubSentenceAnalysis] = useState<SubSentenceAnalysis | null>(null);
    const [isLoadingSubsentence, setIsLoadingSubsentence] = useState(false);
    const [subsentenceError, setSubsentenceError] = useState<string | null>(null);
    const [hoveredSubUnitId, setHoveredSubUnitId] = useState<string | null>(null);

    // 新增：记录鼠标坐标（供 HoverCard 使用）
    const [anchor, setAnchor] = useState<Point | null>(null);

    React.useEffect(() => {
        const onFreeze = (e: Event) => {
            const detail = (e as CustomEvent<number | null>).detail ?? null;
            setGlobalFrozenId(detail);
        };
        window.addEventListener(FREEZE_EVENT, onFreeze as EventListener);
        return () => window.removeEventListener(FREEZE_EVENT, onFreeze as EventListener);
    }, []);


    const handleClick = (e: MouseEvent<HTMLSpanElement>) => {
        e.stopPropagation();
        setIsClicked((prev) => {
            const next = !prev;
            onToggleFocus?.(sentence.id, next);
            return next;
        });
        setIsFrozen(prev => {
            const next = !prev;
            if (next) {
                // 冻住自己，并通知所有句子
                window.dispatchEvent(new CustomEvent<number | null>(FREEZE_EVENT, { detail: sentence.id }));
                setAnchor({ x: e.clientX, y: e.clientY }); // 冻住在点击处
            } else {
                // 解冻，通知所有句子
                window.dispatchEvent(new CustomEvent<number | null>(FREEZE_EVENT, { detail: null }));
            }
            return next;
        });


    };

    const handleKeyDown = (e: KeyboardEvent<HTMLSpanElement>) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setIsClicked((prev) => {
                const next = !prev;
                onToggleFocus?.(sentence.id, next);
                return next;
            });
        }
    };

    const handleMouseEnter = () => {
        // enter
        if (globalFrozenId !== null && globalFrozenId !== sentence.id) return;
        setIsHovered(true);
        onHoverChange?.(sentence.id, true);
    };

    const handleMouseLeave = () => {
        if (!isFrozen) setAnchor(null);
        if (globalFrozenId !== null && globalFrozenId !== sentence.id) return;
        setIsHovered(false);
        onHoverChange?.(sentence.id, false);
        setHoveredSubUnitId(null);
        if (!isFrozen) setAnchor(null);
    };

    // 新增：持续捕获鼠标坐标
    const handleMouseMove = (e: MouseEvent<HTMLSpanElement>) => {
        // move
        if (isFrozen || (globalFrozenId !== null && globalFrozenId !== sentence.id)) return;
        setAnchor({ x: e.clientX, y: e.clientY });

    };

    const blocked = globalFrozenId !== null && globalFrozenId !== sentence.id;

    // use for test
    const handleStartSubsentence = useCallback(async () => {
        if (subSentenceAnalysis) {
            setSubSentenceAnalysis(null);
            setSubsentenceError(null);
            setHoveredSubUnitId(null);
            return;
        }
        if (isLoadingSubsentence) return;
        setIsLoadingSubsentence(true);
        setSubsentenceError(null);
        setHoveredSubUnitId(null);
        try {
            const module = await import("../../examples/subsentence-example.json");
            const analysis = (module.default ?? module) as SubSentenceAnalysis;
            setSubSentenceAnalysis(analysis);
        } catch (error) {
            setSubsentenceError("Failed to load subsentence example.");
            console.error(error);
        } finally {
            setIsLoadingSubsentence(false);
        }
    }, [isLoadingSubsentence, subSentenceAnalysis]);

    // ---- [A] Tag 颜色与映射（内联样式，免改 CSS） ----
    type Variant = "blue" | "green" | "yellow" | "gray";

    const styleFor = (v: Variant) => {
        switch (v) {
            case "blue":
                return { background: "rgba(123,168,255,0.24)", color: "#dde6ff" };
            case "green":
                return { background: "rgba(103,232,185,0.22)", color: "#d2f5ea" };
            case "yellow":
                return { background: "rgba(253,224,138,0.24)", color: "#fef3c7" };
            default:
                return { background: "rgba(226,232,240,0.18)", color: "#e2e8f0" };
        }
    };

    const dotColor = (v: Variant) => {
        switch (v) {
            case "blue":
                return "#84a9ff";
            case "green":
                return "#34d399";
            case "yellow":
                return "#facc15";
            default:
                return "#94a3b8";
        }
    };

    const dotEl = (v: Variant) => (
        <span
            aria-hidden
            style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: dotColor(v),
                display: "inline-block",
                marginRight: 6,
                flex: "0 0 auto",
            }}
        />
    );

    // 简单规则：你可按需扩展
    const fnVariant = (fn: string): Variant => {
        const s = fn.toLowerCase();
        if (/(transition|contrast|example|expansion|elaboration)/.test(s)) return "blue";
        if (/(conclusion|justification|support)/.test(s)) return "green";
        return "gray";
    };
    const typeVariant = (t: string): Variant => (t.toLowerCase().includes("declarative") ? "green" : "gray");
    const moodVariant = (m: string): Variant => (m.toLowerCase().includes("indicative") ? "yellow" : "gray");

    const hoveredSubUnit = React.useMemo<SubUnit | null>(() => {
        if (!subSentenceAnalysis || !hoveredSubUnitId) return null;

        const walk = (units: SubUnit[]): SubUnit | null => {
            for (const unit of units) {
                if (unit.id === hoveredSubUnitId) return unit;
                if (unit.children) {
                    const childHit = walk(unit.children);
                    if (childHit) return childHit;
                }
                if (unit.clause?.units) {
                    const clauseHit = walk(unit.clause.units);
                    if (clauseHit) return clauseHit;
                }
            }
            return null;
        };

        return walk(subSentenceAnalysis.units);
    }, [hoveredSubUnitId, subSentenceAnalysis]);


    const className = [
        "sentence",
        "component",
        isHovered && !blocked ? "hovered" : "",
        isClicked ? "clicked" : "",
    ]
        .filter(Boolean)
        .join(" ");

    return (
        <>
            <span
                role="button"
                tabIndex={0}
                aria-pressed={isClicked}
                onClick={handleClick}
                onKeyDown={handleKeyDown}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                onMouseMove={handleMouseMove}
                className={className}
                data-sentence-id={sentence.id}
            >
                {subSentenceAnalysis ? (
                    <SubSentenceComponent
                        analysis={subSentenceAnalysis}
                        focusUnitId={hoveredSubUnitId ?? undefined}
                        onHoverUnit={setHoveredSubUnitId}
                    />
                ) : (
                    sentence.text
                )}
            </span>

            <SentenceHoverCard
                onStartSubsentence={handleStartSubsentence}
                subsentenceActive={Boolean(subSentenceAnalysis)}
                open={(isHovered || isFrozen) && !(globalFrozenId !== null && globalFrozenId !== sentence.id)}
                anchor={anchor ?? undefined}
            // 可以按需传额外参数：offset、maxWidth 等
            >
                {/* 先放一些可见元数据，等你确认再细化 */}
                <div className="hovercard-content">
                    <div className="tags">
                        {/* Tag 1: function -> 常为蓝/绿/灰 */}
                        {(() => {
                            const v = fnVariant(sentence.function);
                            return (
                                <span className="tag" style={styleFor(v)}>
                                    {dotEl(v)}
                                    {sentence.function}
                                </span>
                            );
                        })()}

                        {/* Tag 2: type + (relation 可拼在同一个 tag 内) -> Declarative 用绿 */}
                        {(() => {
                            const v = typeVariant(sentence.type);
                            const relationPiece = sentence.relation
                                ? ` · ${sentence.relation.type} → #${sentence.relation.targetSentenceId}`
                                : "";
                            return (
                                <span className="tag" style={styleFor(v)}>
                                    {dotEl(v)}
                                    {sentence.type}
                                    {relationPiece}
                                </span>
                            );
                        })()}

                        {/* Tag 3: mood 独立成黄（如 Indicative） */}
                        {(() => {
                            const v = moodVariant(sentence.mood);
                            return (
                                <span className="tag" style={styleFor(v)}>
                                    {dotEl(v)}
                                    {sentence.mood}
                                </span>
                            );
                        })()}
                    </div>

                    <div className="purpose">{sentence.purpose}</div>
                    {isLoadingSubsentence && (
                        <div className="subsentence-status">Loading subsentence analysis...</div>
                    )}
                    {subsentenceError && (
                        <div className="subsentence-status subsentence-status--error">{subsentenceError}</div>
                    )}
                    {subSentenceAnalysis && !hoveredSubUnit && !isLoadingSubsentence && !subsentenceError && (
                        <div className="subsentence-status">Hover highlighted segments to inspect units.</div>
                    )}
                    {hoveredSubUnit && (
                        <div className="subsentence-unit-info">
                            <div className="subsentence-unit-info-title">{hoveredSubUnit.text}</div>
                            <div className="subsentence-unit-info-grid">
                                {hoveredSubUnit.role ? (
                                    <>
                                        <span className="label">Role</span>
                                        <span>{hoveredSubUnit.role}</span>
                                    </>
                                ) : null}
                                {hoveredSubUnit.semantics && hoveredSubUnit.semantics !== "none" ? (
                                    <>
                                        <span className="label">Semantics</span>
                                        <span>{hoveredSubUnit.semantics}</span>
                                    </>
                                ) : null}
                                {hoveredSubUnit.semRole && hoveredSubUnit.semRole !== "None" ? (
                                    <>
                                        <span className="label">Semantic Role</span>
                                        <span>{hoveredSubUnit.semRole}</span>
                                    </>
                                ) : null}
                                {hoveredSubUnit.viewHint?.label ? (
                                    <>
                                        <span className="label">Label</span>
                                        <span>{hoveredSubUnit.viewHint.label}</span>
                                    </>
                                ) : null}
                                {hoveredSubUnit.source ? (
                                    <>
                                        <span className="label">Source</span>
                                        <span>{hoveredSubUnit.source}</span>
                                    </>
                                ) : null}
                                {typeof hoveredSubUnit.confidence === "number" ? (
                                    <>
                                        <span className="label">Confidence</span>
                                        <span>{hoveredSubUnit.confidence.toFixed(2)}</span>
                                    </>
                                ) : null}
                            </div>
                        </div>
                    )}
                </div>
            </SentenceHoverCard>
        </>
    );
};

export default SentenceComponent;
