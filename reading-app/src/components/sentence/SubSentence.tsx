import React, { useCallback, Fragment, useMemo, useState } from "react";
import type { SubSentenceAnalysis, SubUnit } from "../../model/structure/SubSentence";
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

const findUnitChain = (units: SubUnit[], id: string): SubUnit[] => {
    for (const unit of units) {
        if (unit.id === id) return [unit];
        if (unit.children) {
            const chain = findUnitChain(unit.children, id);
            if (chain.length > 0) return [unit, ...chain];
        }
    }
    return [];
};

const SubSentenceComponent: React.FC<SubSentenceComponentProps> = ({
    analysis,
    focusUnitId,
    onFocusChange,
    onHoverUnit,
}) => {
    const [hoveredUnitId, setHoveredUnitId] = useState<string | null>(null);

    const handleHover = useCallback((unitId: string | null) => {
        setHoveredUnitId(unitId);
        onHoverUnit?.(unitId);
    }, [onHoverUnit]);

    const displayChain = useMemo(() => {
        const targetId = hoveredUnitId ?? focusUnitId;
        if (!targetId) return [];
        return findUnitChain(analysis.units, targetId);
    }, [analysis.units, focusUnitId, hoveredUnitId]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent, unitId: string) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            onFocusChange?.(unitId);
        }
    }, [onFocusChange]);

    const getUnitRole = useCallback((unit: SubUnit): string | undefined => {
        let role: string | undefined = unit?.role;

        if (!role && analysis.backbone) {
            if (analysis.backbone.subjectId === unit.id) role = "subject";
            else if (analysis.backbone.predicateId === unit.id) role = "predicate";
            else if (analysis.backbone.objectId === unit.id) role = "object";
        }
        return role;
    }, [analysis.backbone]);

    const renderUnits = useCallback(
        (units: SubUnit[]): React.ReactNode =>
            units.map((unit: SubUnit, index: number) => {
                const isInteractive = Boolean(onFocusChange);
                const isFocused = focusUnitId === unit.id;
                const role = getUnitRole(unit);
                const className = [
                    "subsentence-chip",
                    isInteractive ? "subsentence-chip--interactive" : "",
                    isFocused ? "subsentence-chip--active" : "",
                    unit.children && unit.children.length ? "subsentence-chip--has-children" : "",
                    role ? `subsentence-chip--role-${role}` : "",
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
                            onClick={(e) => {
                                e.stopPropagation();
                                onFocusChange?.(unit.id);
                            }}
                            onKeyDown={(e) => handleKeyDown(e, unit.id)}
                            onMouseOver={(e) => {
                                e.stopPropagation();
                                handleHover(unit.id);
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
        [focusUnitId, handleHover, onFocusChange, handleKeyDown, getUnitRole, analysis.units],
    );

    return (
        <div className="subsentence-analysis">
            <span
                data-subsentence-id={analysis.sentenceId}
                className="subsentence-container"
                onMouseLeave={() => handleHover(null)}
            >
                {renderUnits(analysis.units)}
            </span>
            <div className="semantic role">
                {displayChain.map((unit, index) => (
                    <div
                        key={unit.id}
                        className="subsentence-chain-item"
                        style={{ "--depth": index } as React.CSSProperties}
                    >
                        <div className="subsentence-info-panel">
                            <div className="subsentence-info-row">
                                <span className="subsentence-info-key">Role</span>
                                <span className="subsentence-info-value role-value">{unit.role}</span>
                            </div>
                            {(unit).semantics && (
                                <div className="subsentence-info-row">
                                    <span className="subsentence-info-key">Semantics</span>
                                    <span className="subsentence-info-value">{(unit).semantics}</span>
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default SubSentenceComponent;
