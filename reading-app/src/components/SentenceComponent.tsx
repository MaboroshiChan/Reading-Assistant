// SentenceComponent.tsx
import React, { useState, useCallback, type KeyboardEvent, type MouseEvent } from "react";
import type { Sentence } from "../model/structure/Sentence";
import "./css/SentenceComponent.css";
import { SentenceHoverCard } from "./SentenceHoverCard"; // 新增：引入悬浮卡片
// Network 
// import { SentenceCardComponent } from "./InfoComponent";
import mapSentenceToVM, { type SentenceViewModel } from "../model/viewModels/mapSentenceToVM";
import mapSubSentenceToVM, { type SubsentenceVM } from "../model/viewModels/mapSubSentenceToVM";
import SubSentenceComponent from "./SubSentenceComponent";
import { streamingMessageService } from "../services/messageService.instance";
import type { AnalyzeSubSentenceData, StandardContext } from "../services/envelopes";
import SentenceRelationship from "./SentenceRelationship";

const FREEZE_EVENT = "hovercard:freeze";
const HIGHLIGHT_EVENT = "sentence:highlight";
const DEFAULT_DOC_CONTEXT: StandardContext["doc"] = {
    doc_id: "example-article",
    content_hash: "example-article#dev",
};
const isAbortError = (error: unknown): boolean =>
    error instanceof DOMException
        ? error.name === "AbortError"
        : error instanceof Error && error.name === "AbortError";

interface SentenceComponentProps {
    id: number;
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
    const subsentenceAbortRef = React.useRef<AbortController | null>(null);
    const [isLoadingSubsentence, setIsLoadingSubsentence] = useState(false);
    const [isStreamingSubsentence, setIsStreamingSubsentence] = useState(false);
    const [subsentenceError, setSubsentenceError] = useState<string | null>(null);
    const [subsentenceVm, setSubsentenceVm] = useState<SubsentenceVM | null>(null);
    const [focusedUnitId, setFocusedUnitId] = useState<string | null>(null);
    const [sentenceVm, setSentenceVm] = useState<SentenceViewModel>(() => mapSentenceToVM(sentence));
    const [isSubsentenceActive, setIsSubsentenceActive] = useState(false);
    const [isRemoteHovered, setIsRemoteHovered] = useState(false);

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

    React.useEffect(() => {
        const onHighlight = (e: Event) => {
            const detail = (e as CustomEvent<number | null>).detail ?? null;
            setIsRemoteHovered(detail === sentence.id);
        };
        window.addEventListener(HIGHLIGHT_EVENT, onHighlight as EventListener);
        return () => window.removeEventListener(HIGHLIGHT_EVENT, onHighlight as EventListener);
    }, [sentence.id]);

    React.useEffect(() => () => {
        if (subsentenceAbortRef.current) {
            subsentenceAbortRef.current.abort();
            subsentenceAbortRef.current = null;
        }
    }, []);

    React.useEffect(() => {
        setSentenceVm(mapSentenceToVM(sentence));
        setIsSubsentenceActive(false);
        setSubsentenceVm(null);
        setFocusedUnitId(null);
        setSubsentenceError(null);
        setIsLoadingSubsentence(false);
        setIsStreamingSubsentence(false);
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
    };

    const handleMouseLeave = () => {
        if (!isFrozen) setAnchor(null);
        if (!interactionEnabled) return;
        if (globalFrozenId !== null && globalFrozenId !== sentence.id) return;
        setIsHovered(false);
        onHoverChange?.(sentence.id, false);
        if (!isFrozen) setAnchor(null);
    };

    // 新增：持续捕获鼠标坐标
    const handleMouseMove = (e: MouseEvent<HTMLSpanElement>) => {
        // move
        if (!interactionEnabled) return;
        if (isFrozen || (globalFrozenId !== null && globalFrozenId !== sentence.id)) return;
        setAnchor({ x: e.clientX, y: e.clientY });
    };

    const blocked = globalFrozenId !== null && globalFrozenId !== sentence.id;

    React.useEffect(() => {
        if (interactionEnabled) return;
        setIsHovered(false);
        setAnchor(null);
        setSubsentenceError(null);
        setIsLoadingSubsentence(false);
        setSubsentenceVm(null);
        setFocusedUnitId(null);
        setIsClicked(false);
        setSentenceVm(mapSentenceToVM(sentence));
        setIsSubsentenceActive(false);
        setIsStreamingSubsentence(false);
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

    const handleRelationshipHover = useCallback((id: number | null) => {
        window.dispatchEvent(new CustomEvent(HIGHLIGHT_EVENT, { detail: id }));
    }, []);

    const handleStartSubsentence = useCallback((): void => {
        if (isSubsentenceActive) {
            if (subsentenceAbortRef.current) {
                subsentenceAbortRef.current.abort();
                subsentenceAbortRef.current = null;
            }
            setSubsentenceError(null);
            setIsLoadingSubsentence(false);
            setIsSubsentenceActive(false);
            setSubsentenceVm(null);
            setFocusedUnitId(null);
            setIsStreamingSubsentence(false);
            return;
        }

        if (subsentenceAbortRef.current) {
            subsentenceAbortRef.current.abort();
            subsentenceAbortRef.current = null;
        }
        const controller = new AbortController();
        subsentenceAbortRef.current = controller;

        setIsSubsentenceActive(true);
        setIsLoadingSubsentence(true);
        setIsStreamingSubsentence(true);
        setSubsentenceError(null);
        setSubsentenceVm(null);
        setFocusedUnitId(null);

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
                const meta = {
                    sentence_text: sentence.text,
                    fragment_text: sentence.text.slice(payload.span.start, payload.span.end),
                };
                const res = await streamingMessageService.analyzeSubSentence(
                    payload,
                    ctx,
                    meta,
                    {
                        signal: controller.signal,
                        timeoutMs: 60_000,
                        onPartial: (partialData) => {
                            if (controller.signal.aborted) return;
                            if (partialData.analysis) {
                                const vm = mapSubSentenceToVM(partialData as AnalyzeSubSentenceData);
                                if (vm) setSubsentenceVm(vm);
                            }
                        }
                    },
                );
                console.log("received from LLM")
                if (controller.signal.aborted) return;

                if (res.status === "error") {
                    setSubsentenceError(res.error?.message ?? "Failed to load subsentence analysis.");
                    setSubsentenceVm(null);
                    return;
                }
                const vm = mapSubSentenceToVM(res.data ?? null);
                if (!vm) {
                    setSubsentenceError("Subsentence analysis response was empty.");
                    setSubsentenceVm(null);
                    return;
                }
                setSubsentenceVm(vm);
                setFocusedUnitId(vm.analysis.backbone?.subjectId ?? vm.analysis.units[0]?.id ?? null);
                setSubsentenceError(null);
            } catch (error) {
                if (isAbortError(error)) {
                    setSubsentenceError("Subsentence analysis was cancelled or timed out.");
                    setSubsentenceVm(null);
                    return;
                }
                setSubsentenceError(error instanceof Error ? error.message : "Failed to load subsentence analysis.");
                setSubsentenceVm(null);
            } finally {
                if (subsentenceAbortRef.current === controller) {
                    subsentenceAbortRef.current = null;
                }
                setIsLoadingSubsentence(false);
                setIsStreamingSubsentence(false);
            }
        };

        void run();
    }, [isSubsentenceActive, sentence]);

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

    const className = [
        "sentence",
        "component",
        interactionEnabled && (isRemoteHovered || (isHovered && !blocked)) ? "hovered" : "",
        interactionEnabled && isClicked ? "clicked" : "",
    ]
        .filter(Boolean)
        .join(" ");
    const shouldShowSubsentence =
        isSubsentenceActive || isLoadingSubsentence || subsentenceError !== null || subsentenceVm !== null;

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
                <span style={{
                    fontSize: "0.75em",
                    color: interactionEnabled && isHovered && !blocked ? "#e2e8f0" : "#9ca3af",
                    marginRight: "0.3em",
                    userSelect: "none"
                }}>
                    {sentence.id}
                </span>
                {sentence.text}
            </span>

            <SentenceHoverCard
                onStartSubSentence={handleStartSubsentence}
                subSentenceActive={isSubsentenceActive}
                open={
                    interactionEnabled &&
                    (isHovered || isFrozen) &&
                    !(globalFrozenId !== null && globalFrozenId !== sentence.id)
                }
                anchor={interactionEnabled ? anchor ?? undefined : undefined}
                maxWidth={520}
            // 可以按需传额外参数：offset、maxWidth 等
            >
                <div className="hovercard-content">
                    <div
                        className={[
                            "subsentence-section",
                            shouldShowSubsentence ? "is-open" : "",
                        ]
                            .filter(Boolean)
                            .join(" ")}
                    >
                        {shouldShowSubsentence && (
                            <>
                                <div className="subsentence-title">Subsentence analysis</div>
                                {isLoadingSubsentence && (
                                    <div
                                        className={[
                                            "subsentence-status",
                                            isStreamingSubsentence ? "subsentence-status--progress" : "",
                                        ]
                                            .filter(Boolean)
                                            .join(" ")}
                                    >
                                        {isStreamingSubsentence
                                            ? "Preparing subsentence analysis..."
                                            : "Loading subsentence analysis..."}
                                    </div>
                                )}
                                {subsentenceError && (
                                    <div className="subsentence-status subsentence-status--error">
                                        {subsentenceError}
                                    </div>
                                )}
                                {subsentenceVm && !isLoadingSubsentence && !subsentenceError && (
                                    <div className="subsentence-wrapper">
                                        <SubSentenceComponent
                                            analysis={subsentenceVm.analysis}
                                            focusUnitId={focusedUnitId ?? undefined}
                                            onFocusChange={(unitId) => setFocusedUnitId(unitId)}
                                        />
                                        {typeof subsentenceVm.confidence === "number" && (
                                            <div className="subsentence-status">
                                                Confidence: {(subsentenceVm.confidence * 100).toFixed(0)}%
                                            </div>
                                        )}
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    <div className="tags">
                        {/* Tag 1: function -> 常为蓝/绿/灰 */}
                        {(() => {
                            const roleLabel = sentenceVm.roleLabel ?? sentence.function;
                            const v = fnVariant (roleLabel);
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

                    <div className="purpose">
                        Explanation:
                        <br />
                            {sentence.purpose}
                    </div>
                    <SentenceRelationship
                        current_id={sentence.id}
                        prev_id={sentence.relation?.targetSentenceId !== undefined && sentence.relation.targetSentenceId < sentence.id ? sentence.relation.targetSentenceId : sentence.id - 1}
                        next_id={sentence.relation?.targetSentenceId !== undefined && sentence.relation.targetSentenceId > sentence.id ? sentence.relation.targetSentenceId : sentence.id + 1}
                        prev={sentence.relation?.targetSentenceId !== undefined && sentence.relation.targetSentenceId < sentence.id ? sentence.relation.type : ""}
                        next={sentence.relation?.targetSentenceId !== undefined && sentence.relation.targetSentenceId > sentence.id ? sentence.relation.type : ""}
                        onHoverSentence={handleRelationshipHover}
                    />
                </div>
            </SentenceHoverCard>
        </>
    );
};

export default SentenceComponent;