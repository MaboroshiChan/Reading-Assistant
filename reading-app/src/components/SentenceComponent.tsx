// SentenceComponent.tsx
import React, { useState, useCallback, type KeyboardEvent, type MouseEvent } from "react";
import type { Sentence } from "../model/structure/Sentence";
import "./css/SentenceComponent.css";
import { SentenceHoverCard } from "./SentenceHoverCard"; // 新增：引入悬浮卡片
import type { SubSentenceAnalysis, SubUnit } from "../model/structure/SubSentence";
import SubSentenceComponent from "./SubSentenceComponent";
// Network 
import { SentenceCardComponent } from "./InfoComponent";
import mapSentenceToVM, { type SentenceViewModel } from "../model/viewModels/mapSentenceToVM";
import mapSubSentenceToAnalysis from "../model/viewModels/mapSubSentenceToVM";
import messageService from "../services/messageService.instance";
import type { StandardContext } from "../services/envelopes";

const FREEZE_EVENT = "hovercard:freeze";
const DEFAULT_DOC_CONTEXT: StandardContext["doc"] = {
    doc_id: "example-article",
    content_hash: "example-article#dev",
};
const isAbortError = (error: unknown): boolean =>
    error instanceof DOMException
        ? error.name === "AbortError"
        : error instanceof Error && error.name === "AbortError";

interface SentenceComponentProps {
    sentence: Sentence;
    onToggleFocus?: (id: number, isFocused: boolean) => void;
    onHoverChange?: (id: number, isHovered: boolean) => void;
    interactionEnabled?: boolean;
}

// 鼠标坐标类型
type Point = { x: number; y: number };

export const SentenceComponent: React.FC<SentenceComponentProps> = ({
    sentence,
    onToggleFocus,
    onHoverChange,
    interactionEnabled = true,
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
    const [lastSubSentenceAnalysis, setLastSubSentenceAnalysis] = useState<SubSentenceAnalysis | null>(null);
    const [showSubUI, setShowSubUI] = useState(false);
    const [closingSubUI, setClosingSubUI] = useState(false);
    const closeTimerRef = React.useRef<number | null>(null);
    const subsentenceAbortRef = React.useRef<AbortController | null>(null);
    const [isLoadingSubsentence, setIsLoadingSubsentence] = useState(false);
    const [subsentenceError, setSubsentenceError] = useState<string | null>(null);
    const [hoveredSubUnitId, setHoveredSubUnitId] = useState<string | null>(null);
    const [sentenceVm, setSentenceVm] = useState<SentenceViewModel>(() => mapSentenceToVM(sentence));
    const [analysisStatus, setAnalysisStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
    const [analysisError, setAnalysisError] = useState<string | null>(null);
    const [analysisRequested, setAnalysisRequested] = useState(false);

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

    React.useEffect(() => () => {
        if (subsentenceAbortRef.current) {
            subsentenceAbortRef.current.abort();
            subsentenceAbortRef.current = null;
        }
    }, []);

    React.useEffect(() => {
        setSentenceVm(mapSentenceToVM(sentence));
        setAnalysisStatus("idle");
        setAnalysisError(null);
        setAnalysisRequested(false);
    }, [sentence.id, sentence.text, sentence.function, sentence.type, sentence.mood]);


    const handleClick = (e: MouseEvent<HTMLSpanElement>) => {
        if (!interactionEnabled) return;
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
        if (!interactionEnabled) return;
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
        if (!interactionEnabled) return;
        // enter
        if (globalFrozenId !== null && globalFrozenId !== sentence.id) return;
        setIsHovered(true);
        onHoverChange?.(sentence.id, true);
        if (analysisStatus === "error") {
            setAnalysisStatus("idle");
        }
    };

    const handleMouseLeave = () => {
        if (!isFrozen) setAnchor(null);
        if (!interactionEnabled) return;
        if (globalFrozenId !== null && globalFrozenId !== sentence.id) return;
        setIsHovered(false);
        onHoverChange?.(sentence.id, false);
        setHoveredSubUnitId(null);
        if (!isFrozen) setAnchor(null);
    };

    // 新增：持续捕获鼠标坐标
    const handleMouseMove = (e: MouseEvent<HTMLSpanElement>) => {
        // move
        if (!interactionEnabled) return;
        if (isFrozen || (globalFrozenId !== null && globalFrozenId !== sentence.id)) return;
        setAnchor({ x: e.clientX, y: e.clientY });

    };

    React.useEffect(() => {
        if (!interactionEnabled) return;
        if (!analysisRequested) return;

        const controller = new AbortController();
        setAnalysisStatus("loading");
        setAnalysisError(null);

        const payload = {
            doc_id: DEFAULT_DOC_CONTEXT.doc_id,
            sentence_id: String(sentence.id),
            sentence_text: sentence.text,
        };
        const ctx: Partial<StandardContext> & { doc: StandardContext["doc"] } = {
            doc: DEFAULT_DOC_CONTEXT,
        };

        (async () => {
            try {
                const res = await messageService.analyzeSentence(payload, ctx, { signal: controller.signal });
                if (controller.signal.aborted) return;

                if (res.status === "error") {
                    setSentenceVm(mapSentenceToVM(sentence));
                    setAnalysisError(res.error?.message ?? "Sentence analysis failed.");
                    setAnalysisStatus("error");
                    return;
                }
                setSentenceVm(mapSentenceToVM(sentence, res.data ?? null));
                setAnalysisError(null);
                setAnalysisStatus("ready");
            } catch (error) {
                if (isAbortError(error)) return;
                setSentenceVm(mapSentenceToVM(sentence));
                setAnalysisError(error instanceof Error ? error.message : "Sentence analysis failed.");
                setAnalysisStatus("error");
            }
        })();

        return () => {
            controller.abort();
        };
    }, [analysisRequested, interactionEnabled, sentence.id, sentence.text, sentence.function, sentence.type, sentence.mood, sentence]);

    const blocked = globalFrozenId !== null && globalFrozenId !== sentence.id;

    React.useEffect(() => {
        if (interactionEnabled) return;
        setIsHovered(false);
        setAnchor(null);
        setHoveredSubUnitId(null);
        setSubSentenceAnalysis(null);
        setSubsentenceError(null);
        setIsLoadingSubsentence(false);
        setIsClicked(false);
        setSentenceVm(mapSentenceToVM(sentence));
        setAnalysisStatus("idle");
        setAnalysisError(null);
        setAnalysisRequested(false);
        if (subsentenceAbortRef.current) {
            subsentenceAbortRef.current.abort();
            subsentenceAbortRef.current = null;
        }
        setIsFrozen(prev => {
            if (prev) {
                window.dispatchEvent(new CustomEvent<number | null>(FREEZE_EVENT, { detail: null }));
            }
            return false;
        });
    }, [interactionEnabled]);

    // use for test
    const handleStartSubsentence = useCallback((): void => {
        if (subSentenceAnalysis) {
            if (subsentenceAbortRef.current) {
                subsentenceAbortRef.current.abort();
                subsentenceAbortRef.current = null;
            }
            setSubSentenceAnalysis(null);
            setSubsentenceError(null);
            setHoveredSubUnitId(null);
            setAnalysisRequested(false);
            setSentenceVm(mapSentenceToVM(sentence));
            setAnalysisStatus("idle");
            setAnalysisError(null);
            return;
        }
        if (isLoadingSubsentence) return;

        if (subsentenceAbortRef.current) {
            subsentenceAbortRef.current.abort();
        }
        const controller = new AbortController();
        subsentenceAbortRef.current = controller;

        setAnalysisRequested(true);
        setAnalysisStatus("idle");
        setAnalysisError(null);
        setIsLoadingSubsentence(true);
        setSubsentenceError(null);
        setHoveredSubUnitId(null);

        const tasks: Array<'micro_roles' | 'cue_interaction' | 'contrast_resolution'> = [
            "micro_roles",
            "cue_interaction",
            "contrast_resolution",
        ];
        const payload = {
            doc_id: DEFAULT_DOC_CONTEXT.doc_id,
            sentence_id: String(sentence.id),
            span: { start: 0, end: sentence.text.length },
            options: { tasks },
        };
        const ctx: Partial<StandardContext> & { doc: StandardContext["doc"] } = {
            doc: DEFAULT_DOC_CONTEXT,
        };

        const run = async () => {
            try {
                const res = await messageService.analyzeSubSentence(payload, ctx, { signal: controller.signal });
                if (controller.signal.aborted) return;

                if (res.status === "error") {
                    setSubsentenceError(res.error?.message ?? "Failed to load subsentence analysis.");
                    setSubSentenceAnalysis(null);
                    return;
                }
                const mapped = mapSubSentenceToAnalysis(sentence, res.data ?? null);
                setSubSentenceAnalysis(mapped);
                setSubsentenceError(null);
            } catch (error) {
                if (isAbortError(error)) return;
                setSubsentenceError(error instanceof Error ? error.message : "Failed to load subsentence analysis.");
                setSubSentenceAnalysis(null);
            } finally {
                if (subsentenceAbortRef.current === controller) {
                    subsentenceAbortRef.current = null;
                }
                setIsLoadingSubsentence(false);
            }
        };

        void run();
    }, [isLoadingSubsentence, sentence, subSentenceAnalysis]);

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
        interactionEnabled && isHovered && !blocked ? "hovered" : "",
        interactionEnabled && isClicked ? "clicked" : "",
    ]
        .filter(Boolean)
        .join(" ");

    // Animate mount/unmount of SubSentenceComponent inside hover card
    React.useEffect(() => {
        // Clear any pending timer when state changes
        if (closeTimerRef.current) {
            window.clearTimeout(closeTimerRef.current);
            closeTimerRef.current = null;
        }
        if (subSentenceAnalysis) {
            setLastSubSentenceAnalysis(subSentenceAnalysis);
            setShowSubUI(true);
            setClosingSubUI(false);
        } else if (showSubUI) {
            setClosingSubUI(true);
            closeTimerRef.current = window.setTimeout(() => {
                setShowSubUI(false);
                setClosingSubUI(false);
                setLastSubSentenceAnalysis(null);
                closeTimerRef.current = null;
            }, 260); // keep in sync with CSS transition duration
        }
        // Cleanup on unmount
        return () => {
            if (closeTimerRef.current) {
                window.clearTimeout(closeTimerRef.current);
                closeTimerRef.current = null;
            }
        };
    }, [subSentenceAnalysis, showSubUI]);

    return (
        <>
            <span
                role={interactionEnabled ? "button" : undefined}
                tabIndex={interactionEnabled ? 0 : undefined}
                aria-pressed={isClicked}
                onClick={handleClick}
                onKeyDown={handleKeyDown}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                onMouseMove={handleMouseMove}
                className={className}
                data-sentence-id={sentence.id}
            >
                {sentence.text}
            </span>

            <SentenceHoverCard
                onStartSubSentence={handleStartSubsentence}
                subSentenceActive={Boolean(subSentenceAnalysis)}
                open={
                    interactionEnabled &&
                    (isHovered || isFrozen) &&
                    !(globalFrozenId !== null && globalFrozenId !== sentence.id)
                }
                anchor={interactionEnabled ? anchor ?? undefined : undefined}
                maxWidth={showSubUI ? 820 : 520}
            // 可以按需传额外参数：offset、maxWidth 等
            >
                <div className="hovercard-content">
                    {analysisRequested ? (
                        <>
                            {analysisStatus === "loading" && (
                                <div className="subsentence-status">Analyzing sentence...</div>
                            )}
                            {analysisStatus === "error" && analysisError && (
                                <div className="subsentence-status subsentence-status--error">{analysisError}</div>
                            )}
                            {analysisStatus === "ready" && (
                                <SentenceCardComponent info={sentenceVm} />
                            )}
                            {showSubUI ? (
                                <div className={`subsentence-wrapper${closingSubUI ? " is-closing" : ""}`}>
                                    {(subSentenceAnalysis ?? lastSubSentenceAnalysis) ? (
                                        <SubSentenceComponent
                                            analysis={(subSentenceAnalysis ?? lastSubSentenceAnalysis)!}
                                            focusUnitId={hoveredSubUnitId ?? undefined}
                                            onHoverUnit={setHoveredSubUnitId}
                                        />
                                    ) : null}
                                </div>
                            ) : null}
                        </>
                    ) : null}

                    <div className="tags">
                        {/* Tag 1: function -> 常为蓝/绿/灰 */}
                        {(() => {
                            const roleLabel = sentenceVm.roleLabel ?? sentence.function;
                            const v = fnVariant(roleLabel);
                            return (
                                <span className="tag" style={styleFor(v)}>
                                    {dotEl(v)}
                                    {roleLabel}
                                </span>
                            );
                        })()}

                        {/* Tag 2: type + (relation 可拼在同一个 tag 内) -> Declarative 用绿 */}
                        {(() => {
                            const structureLabel = sentenceVm.structureLabel ?? sentence.type;
                            const v = typeVariant(structureLabel);
                            const relationPiece = sentence.relation
                                ? ` · ${sentence.relation.type} → #${sentence.relation.targetSentenceId}`
                                : "";
                            return (
                                <span className="tag" style={styleFor(v)}>
                                    {dotEl(v)}
                                    {structureLabel}
                                    {relationPiece}
                                </span>
                            );
                        })()}

                        {/* Tag 3: mood 独立成黄（如 Indicative） */}
                        {(() => {
                            const moodLabel = sentenceVm.mood ?? sentence.mood;
                            const v = moodVariant(moodLabel);
                            return (
                                <span className="tag" style={styleFor(v)}>
                                    {dotEl(v)}
                                    {moodLabel}
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
