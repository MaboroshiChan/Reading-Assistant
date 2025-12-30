import React, { useMemo, useCallback, Fragment, type CSSProperties } from "react";
import type { SubSentenceAnalysis, SubUnit } from "../model/structure/SubSentence";
import { chooseVariant, DefaultVariantPalette } from "../model/structure/SubSentence";
import "./css/SubSentence.css";

interface SubSentenceComponentProps {
    analysis: SubSentenceAnalysis;
    focusUnitId?: string;
    onFocusChange?: (unitId: string) => void;
    onHoverUnit?: (unitId: string | null) => void;
}

const getLastText = (unit: SubUnit): string => {
    if (unit.children && unit.children.length > 0) {
        return getLastText(unit.children[unit.children.length - 1]);
    }
    return unit.text ?? "";
};

const shouldAddSpace = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return false;
    const lastChar = trimmed.slice(-1);
    return !",.;:!?".includes(lastChar);
};

const SubSentenceComponent: React.FC<SubSentenceComponentProps> = ({
    analysis,
    focusUnitId,
    onFocusChange,
    onHoverUnit,
}) => {
    const palette = useMemo(() => ({
        ...DefaultVariantPalette,
        ...(analysis.legend?.variantPalette ?? {}),
    }), [analysis.legend]);

    const handleHover = useCallback((unitId: string | null) => {
        onHoverUnit?.(unitId);
    }, [onHoverUnit]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent, unitId: string) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            onFocusChange?.(unitId);
        }
    }, [onFocusChange]);

    const renderUnits = useCallback(
        (units: SubUnit[]): React.ReactNode =>
            units.map((unit, index) => {
                const variant = chooseVariant(unit, analysis.legend);
                const colors = palette[variant] ?? DefaultVariantPalette.gray;
                const isInteractive = Boolean(onFocusChange);
                const isFocused = focusUnitId === unit.id;
                const style = {
                    "--chip-bg": colors.bg,
                    "--chip-fg": colors.fg,
                    "--chip-dot": colors.dot,
                    "--chip-border": colors.dot,
                } as CSSProperties;
                const className = [
                    "subsentence-chip",
                    isInteractive ? "subsentence-chip--interactive" : "",
                    isFocused ? "subsentence-chip--active" : "",
                    unit.children && unit.children.length ? "subsentence-chip--has-children" : "",
                ]
                    .filter(Boolean)
                    .join(" ");

                const addSpace =
                    index < units.length - 1 && shouldAddSpace(getLastText(unit));

                const hasChildren = !!(unit.children && unit.children.length > 0);

                return (
                    <Fragment key={unit.id}>
                        <span
                            role={isInteractive ? "button" : undefined}
                            tabIndex={isInteractive ? 0 : undefined}
                            className={className}
                            style={style}
                            onClick={(e) => {
                                e.stopPropagation();
                                onFocusChange?.(unit.id);
                            }}
                            onKeyDown={(e) => handleKeyDown(e, unit.id)}
                            onMouseEnter={() => handleHover(unit.id)}
                            onMouseLeave={() => handleHover(null)}
                            onFocus={(e) => {
                                e.stopPropagation();
                                handleHover(unit.id);
                            }}
                            onBlur={() => handleHover(null)}
                        >
                            {hasChildren ? (
                                <>
                                    {unit.viewHint?.label && (
                                        <span className="subsentence-chip-label">
                                            {unit.viewHint.label}
                                        </span>
                                    )}
                                    <span className="subsentence-children">
                                        {renderUnits(unit.children!)}
                                    </span>
                                </>
                            ) : (
                                unit.text
                            )}
                        </span>
                        {addSpace ? <span className="subsentence-space"> </span> : null}
                    </Fragment>
                );
            }),
        [analysis.legend, focusUnitId, handleHover, onFocusChange, palette, handleKeyDown],
    );

    return (
        <span data-subsentence-id={analysis.sentenceId} className="subsentence-container">
            {renderUnits(analysis.units)}
        </span>
    );
};

export default SubSentenceComponent;
