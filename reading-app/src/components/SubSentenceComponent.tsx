import React, { useMemo, useCallback, Fragment, type CSSProperties } from "react";
import type { SubSentenceAnalysis } from "../analysis/structure/SubSentence";
import { chooseVariant, DefaultVariantPalette } from "../analysis/structure/SubSentence";
import "./css/SubSentence.css";

interface SubSentenceComponentProps {
    analysis: SubSentenceAnalysis;
    focusUnitId?: string;
    onFocusChange?: (unitId: string) => void;
    onHoverUnit?: (unitId: string | null) => void;
}

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

    const shouldAddSpace = useCallback((text: string) => {
        const trimmed = text.trim();
        if (!trimmed) return false;
        const lastChar = trimmed.slice(-1);
        return !",.;:!?".includes(lastChar);
    }, []);

    return (
        <span data-subsentence-id={analysis.sentenceId} className="subsentence-container">
            {analysis.units.map((unit, index) => {
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
                ]
                    .filter(Boolean)
                    .join(" ");

                const addSpace = index < analysis.units.length - 1 && shouldAddSpace(unit.text);

                return (
                    <Fragment key={unit.id}>
                        <span
                            role={isInteractive ? "button" : undefined}
                            tabIndex={isInteractive ? 0 : undefined}
                            className={className}
                            style={style}
                            onClick={() => onFocusChange?.(unit.id)}
                            onMouseEnter={() => handleHover(unit.id)}
                            onMouseLeave={() => handleHover(null)}
                            onFocus={() => handleHover(unit.id)}
                            onBlur={() => handleHover(null)}
                        >
                            {unit.text}
                        </span>
                        {addSpace ? <span className="subsentence-space"> </span> : null}
                    </Fragment>
                );
            })}
        </span>
    );
};

export default SubSentenceComponent;
