// Sentence.tsx
import React, { useState, useCallback, type KeyboardEvent, type MouseEvent } from "react";
import type { Sentence } from "../../model/structure/Sentence";
import "./css/Sentence.css";
import { SentenceHoverCard } from "./HoverCard"; // 新增：引入悬浮卡片
// Network 
// import { SentenceCardComponent } from "./InfoComponent";
import mapSentenceToVM, { type SentenceViewModel } from "../../model/viewModels/mapSentenceToVM";
import mapSentenceStructureToVM, { type SentenceStructureVM } from "../../model/viewModels/mapSentenceStructureToVM";
import SentenceStructure from "./SentenceStructure";
import { streamingMessageService } from "../../services/messageService.instance";
import type { AnalyzeSentenceStructureData, StandardContext } from "../../services/envelopes";
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
    bridgeHighlightColor?: string;
    isTopicSentence?: boolean;
}

// 鼠标坐标类型
type Point = { x: number; y: number };

/**
 * Renders a single sentence with interaction support, including hover cards for deep analysis.
 *
 * @param props - Component properties including sentence data and interaction flags.
 */
export const SentenceComponent: React.FC<SentenceComponentProps> = ({
    paragraphId,
    sentence,
    onToggleFocus,
    onHoverChange,
    interactionEnabled = true,
    bridgeHighlightColor,
    isTopicSentence = false,
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
    const sentenceStructureAbortRef = React.useRef<AbortController | null>(null);
    const [isLoadingSentenceStructure, setIsLoadingSentenceStructure] = useState(false);
    const [isStreamingSentenceStructure, setIsStreamingSentenceStructure] = useState(false);
    const [sentenceStructureError, setSentenceStructureError] = useState<string | null>(null);
    const [sentenceStructureVm, setSentenceStructureVm] = useState<SentenceStructureVM | null>(null);
    const [focusedUnitId, setFocusedUnitId] = useState<string | null>(null);
    const [sentenceVm, setSentenceVm] = useState<SentenceViewModel>(() => mapSentenceToVM(sentence));
    const [isSentenceStructureActive, setIsSentenceStructureActive] = useState(false);
    const [isRemoteHovered, setIsRemoteHovered] = useState(false);

    // 新增：记录鼠标坐标（供 HoverCard 使用）
    const [anchor, setAnchor] = useState<Point | null>(null);

    React.useEffect(() => {
        const onFreeze = (e: Event) => {
            const detail = (e as CustomEvent<number | null>).detail ?? null;
            setGlobalFrozenId(detail);
        };
        setGlobalFrozenId(null);
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
        if (sentenceStructureAbortRef.current) {
            sentenceStructureAbortRef.current.abort();
            sentenceStructureAbortRef.current = null;
        }
    }, []);

    React.useEffect(() => {
        setSentenceVm(mapSentenceToVM(sentence));
        setIsSentenceStructureActive(false);
        setSentenceStructureVm(null);
        setFocusedUnitId(null);
        setSentenceStructureError(null);
        setIsLoadingSentenceStructure(false);
        setIsStreamingSentenceStructure(false);
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
            if (isSentenceStructureActive) {
                handleStartSentenceStructure();
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
        setSentenceStructureError(null);
        setIsLoadingSentenceStructure(false);
        setSentenceStructureVm(null);
        setFocusedUnitId(null);
        setIsClicked(false);
        setSentenceVm(mapSentenceToVM(sentence));
        setIsSentenceStructureActive(false);
        setIsStreamingSentenceStructure(false);
        if (sentenceStructureAbortRef.current) {
            sentenceStructureAbortRef.current.abort();
            sentenceStructureAbortRef.current = null;
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

    const handleStartSentenceStructure = useCallback((): void => {
        if (isSentenceStructureActive) {
            if (sentenceStructureAbortRef.current) {
                sentenceStructureAbortRef.current.abort();
                sentenceStructureAbortRef.current = null;
            }
            setSentenceStructureError(null);
            setIsLoadingSentenceStructure(false);
            setIsSentenceStructureActive(false);
            setSentenceStructureVm(null);
            setFocusedUnitId(null);
            setIsStreamingSentenceStructure(false);
            return;
        }

        if (sentenceStructureAbortRef.current) {
            sentenceStructureAbortRef.current.abort();
            sentenceStructureAbortRef.current = null;
        }
        const controller = new AbortController();
        sentenceStructureAbortRef.current = controller;

        console.log("Starting sentence structure analysis for ID:", sentence.id);

        setIsSentenceStructureActive(true);
        setIsLoadingSentenceStructure(true);
        setIsStreamingSentenceStructure(true);
        setSentenceStructureError(null);
        setSentenceStructureVm(null);
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
                const res = await streamingMessageService.analyzeSentenceStructure(
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
                                const vm = mapSentenceStructureToVM(partialData as AnalyzeSentenceStructureData);
                                if (vm) {
                                    setSentenceStructureVm(vm);
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
                    setSentenceStructureError(res.error?.message ?? "Failed to load sentence structure analysis.");
                    setSentenceStructureVm(null);
                    return;
                }
                const vm = mapSentenceStructureToVM(res.data ?? null);
                if (!vm) {
                    setSentenceStructureError("Sentence structure analysis response was empty.");
                    setSentenceStructureVm(null);
                    return;
                }
                setSentenceStructureVm(vm);
                setFocusedUnitId(vm.analysis.backbone?.subjectId ?? vm.analysis.units[0]?.id ?? null);
                setSentenceStructureError(null);
            } catch (error) {
                if (isAbortError(error)) {
                    setSentenceStructureError("Sentence structure analysis was cancelled or timed out.");
                    setSentenceStructureVm(null);
                    return;
                }
                setSentenceStructureError(error instanceof Error ? error.message : "Failed to load sentence structure analysis.");
                setSentenceStructureVm(null);
            } finally {
                if (sentenceStructureAbortRef.current === controller) {
                    sentenceStructureAbortRef.current = null;
                }
                setIsLoadingSentenceStructure(false);
                setIsStreamingSentenceStructure(false);
            }
        };

        void run();
    }, [isSentenceStructureActive, sentence]);

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
        interactionEnabled && !!bridgeHighlightColor ? "bridge-highlighted" : "",
        isTopicSentence ? "topic-sentence-explicit" : "",
    ]
        .filter(Boolean)
        .join(" ");
    const shouldShowSentenceStructure =
        isSentenceStructureActive || isLoadingSentenceStructure || sentenceStructureError !== null || sentenceStructureVm !== null;

    const renderContent = () => {
        const keyWords = sentence.key_words;
        if (!keyWords || keyWords.length === 0) {
            return sentence.text;
        }

        // Escape special chars for regex
        const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // Join all key words with | for regex
        const pattern = new RegExp(`\\b(${keyWords.map(escapeRegExp).join('|')})\\b`, 'g');
        const parts = sentence.text.split(pattern);

        return parts.map((part, index) => {
            if (keyWords.includes(part)) {
                return (
                    <span key={index} className="sentence-key-phrase">
                        {part}
                    </span>
                );
            }
            return <React.Fragment key={index}>{part}</React.Fragment>;
        });
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
                style={{ '--formatted-highlight-color': bridgeHighlightColor } as React.CSSProperties}
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
                onStartSentenceStructure={handleStartSentenceStructure}
                sentenceStructureActive={isSentenceStructureActive}
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
                            "sentence-structure-section",
                            shouldShowSentenceStructure ? "is-open" : "",
                        ]
                            .filter(Boolean)
                            .join(" ")}
                    >
                        {shouldShowSentenceStructure && (
                            <>
                                <div className="sentence-structure-title">Sentence structure analysis</div>
                                {isLoadingSentenceStructure && (
                                    <div className="sentence-structure-status sentence-structure-status--loading">
                                        <Spinner />
                                        <span>
                                            {isStreamingSentenceStructure
                                                ? "Preparing sentence structure analysis..."
                                                : "Loading sentence structure analysis..."}
                                        </span>
                                    </div>
                                )}
                                {sentenceStructureError && (
                                    <div className="sentence-structure-status sentence-structure-status--error">
                                        {sentenceStructureError}
                                    </div>
                                )}
                                {sentenceStructureVm && !isLoadingSentenceStructure && !sentenceStructureError && (
                                    <div className="sentence-structure-wrapper">
                                        <SentenceStructure
                                            analysis={sentenceStructureVm.analysis}
                                            focusUnitId={focusedUnitId ?? undefined}
                                            onFocusChange={(unitId) => setFocusedUnitId(unitId)}
                                        />
                                        {typeof sentenceStructureVm.confidence === "number" && (
                                            <div className="sentence-structure-status">
                                                Confidence: {(sentenceStructureVm.confidence * 100).toFixed(0)}%
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

/** Loading spinner for the sentence indicator. */
const Spinner = () => (
    <svg className="sentence-spinner" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle className="sentence-spinner-circle" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="sentence-spinner-path" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
);

/** Success checkmark for the sentence indicator. */
const CheckMark = () => (
    <svg className="sentence-check" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
);

export default SentenceComponent;