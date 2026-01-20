import React from 'react';

export interface RelationConfig {
    label: string;
    icon: React.ReactNode;
    color: string; // CSS variable or color string
    description?: string;
}

// Reusable SVG definitions or components
const Icons = {
    Contrast: (
        <path d="M7 16V4M7 4L3 8M7 4L11 8M17 8v12M17 20l-4-4M17 20l4-4" strokeLinecap="round" strokeLinejoin="round" />
    ),
    Conclusion: (
        <>
            <circle cx="12" cy="7" r="2" fill="currentColor" stroke="none" />
            <circle cx="7" cy="17" r="2" fill="currentColor" stroke="none" />
            <circle cx="17" cy="17" r="2" fill="currentColor" stroke="none" />
        </>
    ),
    Justification: (
        <>
            <circle cx="7" cy="7" r="2" fill="currentColor" stroke="none" />
            <circle cx="17" cy="7" r="2" fill="currentColor" stroke="none" />
            <circle cx="12" cy="17" r="2" fill="currentColor" stroke="none" />
        </>
    ),
    Expansion: (
        <path d="M12 5v14M5 12h14" strokeLinecap="round" strokeLinejoin="round" />
    ),
    Default: (
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" strokeLinecap="round" strokeLinejoin="round" />
    )
};

export const RELATION_CONFIG: Record<string, RelationConfig> = {
    'contrast': {
        label: 'Contrast',
        icon: Icons.Contrast,
        color: 'var(--color-status-red)',
        description: 'Introduces an opposing idea'
    },
    'rebuttal': {
        label: 'Rebuttal',
        icon: Icons.Contrast,
        color: 'var(--color-status-red)',
        description: 'Rejects or counter-argues a claim'
    },
    'conclusion': {
        label: 'Conclusion',
        icon: Icons.Conclusion,
        color: 'var(--color-status-green)',
        description: 'Summarizes or concludes the thought'
    },
    'justification': {
        label: 'Justification',
        icon: Icons.Justification,
        color: 'var(--color-status-blue)', // Using Blue for "Support/Reason"
        description: 'Provides reason or support'
    },
    'elaboration': {
        label: 'Elaboration',
        icon: Icons.Expansion,
        color: 'var(--color-primary)', // Using Primary (Violet)
        description: 'Expands on details'
    },
    'expansion': {
        label: 'Expansion',
        icon: Icons.Expansion,
        color: 'var(--color-primary)',
        description: 'Adds more information'
    }
};

/**
 * Retrieves the configuration for a specific sentence-to-sentence relation type.
 *
 * @param type - The relation type string.
 * @returns The configuration object.
 */
export const getRelationConfig = (type: string): RelationConfig => {
    const key = type.toLowerCase();
    return RELATION_CONFIG[key] ?? {
        label: type,
        icon: Icons.Default,
        color: 'var(--color-text-secondary)',
        description: 'Related idea'
    };
};
