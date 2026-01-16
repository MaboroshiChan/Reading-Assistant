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
        color: 'var(--relation-contrast-color, #ef4444)',
        description: 'Introduces an opposing idea'
    },
    'rebuttal': {
        label: 'Rebuttal',
        icon: Icons.Contrast,
        color: 'var(--relation-rebuttal-color, #ef4444)',
        description: 'Rejects or counter-argues a claim'
    },
    'conclusion': {
        label: 'Conclusion',
        icon: Icons.Conclusion,
        color: 'var(--relation-conclusion-color, #22c55e)',
        description: 'Summarizes or concludes the thought'
    },
    'justification': {
        label: 'Justification',
        icon: Icons.Justification,
        color: 'var(--relation-justification-color, #3b82f6)',
        description: 'Provides reason or support'
    },
    'elaboration': {
        label: 'Elaboration',
        icon: Icons.Expansion,
        color: 'var(--relation-elaboration-color, #8b5cf6)',
        description: 'Expands on details'
    },
    'expansion': {
        label: 'Expansion',
        icon: Icons.Expansion,
        color: 'var(--relation-expansion-color, #8b5cf6)',
        description: 'Adds more information'
    }
};

export const getRelationConfig = (type: string): RelationConfig => {
    const key = type.toLowerCase();
    return RELATION_CONFIG[key] ?? {
        label: type,
        icon: Icons.Default,
        color: 'var(--relation-default-color, #9ca3af)',
        description: 'Related idea'
    };
};
