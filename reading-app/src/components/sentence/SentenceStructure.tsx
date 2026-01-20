import React, { useCallback, Fragment, useMemo, useState } from "react";
import type { SentenceStructureAnalysis, StructureUnit } from "../../model/structure/SentenceStructure";
import "./css/SentenceStructure.css";

interface SentenceStructureProps {
    analysis: SentenceStructureAnalysis;
    focusUnitId?: string;
    onFocusChange?: (unitId: string) => void;
    onHoverUnit?: (unitId: string | null) => void;
}

/**
 * Recursively finds the deepest text unit at the end of a branch.
 *
 * @param unit - The unit to search.
 * @returns The text content of the last leaf unit.
 */
const getLastText = (unit: StructureUnit): string => {
    if (unit.children && unit.children.length > 0) {
        return getLastText(unit.children[unit.children.length - 1]);
    }
    return unit.text ?? "";
};

/**
 * Checks if a space should be added after a text fragment.
 *
 * @param text - The text fragment to check.
 * @returns True if a space is appropriate.
 */
const shouldAddSpace = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return false;
    const lastChar = trimmed.slice(-1);
    return !",.;:!?".includes(lastChar);
};

/**
 * Finds the lineage of units leading to a specific unit ID.
 *
 * @param units - The list of units to search.
 * @param id - The target unit ID.
 * @returns An array of units forming the chain.
 */
const findUnitChain = (units: StructureUnit[], id: string): StructureUnit[] => {
    for (const unit of units) {
        if (unit.id === id) return [unit];
        if (unit.children) {
            const chain = findUnitChain(unit.children, id);
            if (chain.length > 0) return [unit, ...chain];
        }
    }
    return [];
};

/**
 * Renders an interactive visualization of a sentence's internal logical structure.
 *
 * @param props - Component properties.
 */
const SentenceStructure: React.FC<SentenceStructureProps> = ({
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

    const getUnitRole = useCallback((unit: StructureUnit): string | undefined => {
        let role: string | undefined = unit?.role;

        if (!role && analysis.backbone) {
            if (analysis.backbone.subjectId === unit.id) role = "subject";
            else if (analysis.backbone.predicateId === unit.id) role = "predicate";
            else if (analysis.backbone.objectId === unit.id) role = "object";
        }
        return role;
    }, [analysis.backbone]);

    const renderUnits = useCallback(
        (units: StructureUnit[]): React.ReactNode =>
            units.map((unit: StructureUnit, index: number) => {
                const isInteractive = Boolean(onFocusChange);
                const isFocused = focusUnitId === unit.id;
                const role = getUnitRole(unit);
                const className = [
                    "sentence-structure-chip",
                    isInteractive ? "sentence-structure-chip--interactive" : "",
                    isFocused ? "sentence-structure-chip--active" : "",
                    unit.children && unit.children.length ? "sentence-structure-chip--has-children" : "",
                    role ? `sentence-structure-chip--role-${role}` : "",
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
                                        <span className="sentence-structure-chip-label">
                                            {unit.viewHint.label}
                                        </span>
                                    )}
                                    <span className="sentence-structure-children">
                                        {renderUnits(unit.children!)}
                                    </span>
                                </>
                            ) : (
                                unit.text
                            )}
                        </span>
                        {addSpace ? <span className="sentence-structure-space"> </span> : null}
                    </Fragment>
                );
            }),
        [focusUnitId, handleHover, onFocusChange, handleKeyDown, getUnitRole, analysis.units],
    );

    return (
        <div className="sentence-structure-analysis">
            <span
                data-sentence-id={analysis.sentenceId}
                className="sentence-structure-container"
                onMouseLeave={() => handleHover(null)}
            >
                {renderUnits(analysis.units)}
            </span>
            <div className="semantic role">
                {displayChain.map((unit, index) => (
                    <div
                        key={unit.id}
                        className="sentence-structure-chain-item"
                        style={{ "--depth": index } as React.CSSProperties}
                    >
                        <div className="sentence-structure-info-panel">
                            <div className="sentence-structure-info-row">
                                <span className="sentence-structure-info-key">Role</span>
                                <span className="sentence-structure-info-value role-value">{unit.role}</span>
                            </div>
                            {(unit).semantics && (
                                <div className="sentence-structure-info-row">
                                    <span className="sentence-structure-info-key">Semantics</span>
                                    <span className="sentence-structure-info-value">{(unit).semantics}</span>
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default SentenceStructure;
