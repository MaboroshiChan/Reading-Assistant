import React, { useCallback, Fragment, type CSSProperties } from "react";
import type { SubSentenceAnalysis, SubUnit } from "../model/structure/SubSentence";
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

    const getRoleStyle = useCallback((unit: SubUnit): CSSProperties => {
        // Determine role from backbone (preferred) or unit property
        let role: string | undefined = (unit)?.role;
        
        if (!role && analysis.backbone) {
            if (analysis.backbone.subjectId === unit.id) role = "subject";
            else if (analysis.backbone.predicateId === unit.id) role = "predicate";
            else if (analysis.backbone.objectId === unit.id) role = "object";
        }

        switch (role) {
            case "subject": return { backgroundColor: "rgba(147, 197, 253, 0.3)", borderRadius: "4px" }; // Blue
            case "predicate": return { backgroundColor: "rgba(252, 211, 77, 0.3)", borderRadius: "4px" }; // Yellow
            case "object": return { backgroundColor: "rgba(110, 231, 183, 0.3)", borderRadius: "4px" }; // Green
            case "subclause": return { backgroundColor: "rgba(167, 139, 250, 0.2)", borderRadius: "4px", border: "1px dashed rgba(167, 139, 250, 0.5)" };
            default: return {};
        }
    }, [analysis.backbone]);

    const renderUnits = useCallback(
        (units: SubUnit[]): React.ReactNode =>
            units.map((unit: SubUnit, index: number) => {
                const isInteractive = Boolean(onFocusChange);
                const isFocused = focusUnitId === unit.id;
                const style = getRoleStyle(unit);
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
                            onMouseEnter={(e) => {
                                e.stopPropagation();
                                handleHover(unit.id);
                            }}
                            onMouseLeave={(e) => {
                                e.stopPropagation();
                                handleHover(null);
                            }}
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
        [focusUnitId, handleHover, onFocusChange, handleKeyDown, getRoleStyle],
    )

    return (
        <span data-subsentence-id={analysis.sentenceId} className="subsentence-container">
            {renderUnits(analysis.units)}
        </span>
    );
};

export default SubSentenceComponent;
