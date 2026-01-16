// Sentence.tsx
import React, { useState, useCallback, type KeyboardEvent, type MouseEvent } from "react";
import type { Sentence } from "../../model/structure/Sentence";
import "./css/Sentence.css";
import { SentenceHoverCard } from "./HoverCard"; // 新增：引入悬浮卡片
// Network 
// import { SentenceCardComponent } from "./InfoComponent";
import mapSentenceToVM, { type SentenceViewModel } from "../../model/viewModels/mapSentenceToVM";
import mapSubSentenceToVM, { type SubsentenceVM } from "../../model/viewModels/mapSubSentenceToVM";
import SubSentenceComponent from "./SubSentence";
import { streamingMessageService } from "../../services/messageService.instance";
import type { AnalyzeSubSentenceData, StandardContext } from "../../services/envelopes";
import SentenceRelationship from "./RelationshipMap";

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
    paragraphId: number;
    sentence: Sentence;
    onToggleFocus?: (id: number, isFocused: boolean) => void;
    onHoverChange?: (id: number, isHovered: boolean) => void;
    interactionEnabled?: boolean;
    isBridgeHighlighted?: boolean;
}

// 鼠标坐标类型
type Point = { x: number; y: number };

export const SentenceComponent: React.FC<SentenceComponentProps> = ({
    paragraphId,
    sentence,
    onToggleFocus,
    onHoverChange,
    interactionEnabled = true,
    isBridgeHighlighted = false,
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
            const detail = (e as CustomEvent<{ pId: number; sId: number } | null>).detail ?? null;
            setIsRemoteHovered(detail?.pId === paragraphId && detail?.sId === sentence.id);
        };
        window.addEventListener(HIGHLIGHT_EVENT, onHighlight as EventListener);
        return () => window.removeEventListener(HIGHLIGHT_EVENT, onHighlight as EventListener);
    }, [sentence.id, paragraphId]);

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
    }, [sentence.id, sentence.text, sentence.function, sentence.type, sentence.mood, sentence]);

    const isPending = sentence.function === 'Pending';
    const [showSuccess, setShowSuccess] = useState(false);
    const prevPending = React.useRef(isPending);

    React.useEffect(() => {
        if (prevPending.current && !isPending) {
            setShowSuccess(true);
            const timer = setTimeout(() => setShowSuccess(false), 2000);
            return () => clearTimeout(timer);
        }
        prevPending.current = isPending;
    }, [isPending]);

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
        if (!isFrozen) {
            setAnchor(null);
            if (isSubsentenceActive) {
                handleStartSubsentence();
            }
        }
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
    }, [interactionEnabled, sentence]);

    const handleRelationshipHover = useCallback((targetId: number | null) => {
        const detail = targetId === null ? null : { pId: paragraphId, sId: targetId };
        window.dispatchEvent(new CustomEvent(HIGHLIGHT_EVENT, { detail }));
    }, [paragraphId]);

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

        console.log("Starting subsentence analysis for ID:", sentence.id);

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
                            // Ensure we map whatever partial data we have so far
                            if (partialData && typeof partialData === 'object') {
                                const vm = mapSubSentenceToVM(partialData as AnalyzeSubSentenceData);
                                if (vm) {
                                    setSubsentenceVm(vm);
                                    // Auto-focus the first unit if not already set, to give user context
                                    setFocusedUnitId(prev => prev ?? vm.analysis.units[0]?.id ?? null);
                                }
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

    type Variant = "blue" | "green" | "yellow" | "gray";

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
        isPending ? "pending" : "",
        interactionEnabled && (isRemoteHovered || (isHovered && !blocked)) ? "hovered" : "",
        interactionEnabled && isClicked ? "clicked" : "",
        interactionEnabled && isBridgeHighlighted ? "bridge-highlighted" : "",
    ]
        .filter(Boolean)
        .join(" ");
    const shouldShowSubsentence =
        isSubsentenceActive || isLoadingSubsentence || subsentenceError !== null || subsentenceVm !== null;

    const renderContent = () => {
        const keyPhrase = sentence.key_phrase;
        if (!keyPhrase || typeof keyPhrase !== "string" || !sentence.text.includes(keyPhrase)) {
            return sentence.text;
        }
        const parts = sentence.text.split(keyPhrase);
        return parts.map((part, index) => (
            <React.Fragment key={index}>
                {part}
                {index < parts.length - 1 && (
                    <span className="sentence-key-phrase">{keyPhrase}</span>
                )}
            </React.Fragment>
        ));
    };

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
                <span className="sentence-indicator" contentEditable={false}>
                    {isPending ? (
                        <Spinner />
                    ) : showSuccess ? (
                        <CheckMark />
                    ) : (
                        <span className="sentence-id">{sentence.id}</span>
                    )}
                </span>
                {renderContent()}
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
                            const v = fnVariant(roleLabel);
                            return (
                                <span className={`tag variant-${v}`}>
                                    <span className={`tag-dot variant-${v}`} aria-hidden />
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
                                <span className={`tag variant-${v}`}>
                                    <span className={`tag-dot variant-${v}`} aria-hidden />
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
                                <span className={`tag variant-${v}`}>
                                    <span className={`tag-dot variant-${v}`} aria-hidden />
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

const Spinner = () => (
    <svg className="sentence-spinner" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle className="sentence-spinner-circle" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="sentence-spinner-path" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
);

const CheckMark = () => (
    <svg className="sentence-check" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
);

export default SentenceComponent;