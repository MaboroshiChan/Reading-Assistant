import { useState, useCallback, useEffect } from 'react';

export interface UserSkills {
    Facts: number;
    Inference: number;
    Tone: number;
    Argument: number;
}

export interface UserProgress {
    exp: number;
    depthOfUnderstanding: number;
    skills: UserSkills;
    totalAnswers: number;
}

const DEFAULT_PROGRESS: UserProgress = {
    exp: 0,
    depthOfUnderstanding: 0,
    skills: {
        Facts: 0,
        Inference: 0,
        Tone: 0,
        Argument: 0
    },
    totalAnswers: 0
};

export const useUserProgress = () => {
    const [progress, setProgress] = useState<UserProgress>(DEFAULT_PROGRESS);

    // Load from local storage on mount
    useEffect(() => {
        const stored = localStorage.getItem('userProgress');
        if (stored) {
            try {
                setProgress(JSON.parse(stored));
            } catch (e) {
                console.error("Failed to parse stored user progress", e);
            }
        }
    }, []);

    // Save to local storage whenever progress changes
    useEffect(() => {
        localStorage.setItem('userProgress', JSON.stringify(progress));
    }, [progress]);

    const handleCorrectAnswer = useCallback((skillCategory: string) => {
        setProgress(prev => {
            const skill = skillCategory as keyof UserSkills;
            
            // Check if skill exists, otherwise default to Facts
            const validSkill = prev.skills[skill] !== undefined ? skill : 'Facts';

            const newSkills = { ...prev.skills };
            // Increase skill by 10 points per correct answer (cap at 100 for now, or just keep increasing?)
            // The prompt says "Syntax: 80" so it's likely out of 100.
            newSkills[validSkill] = Math.min(100, newSkills[validSkill] + 10);
            
            const newExp = prev.exp + 50;
            const newTotal = prev.totalAnswers + 1;
            
            // Calculate depth of understanding as an average of skills
            const depth = Math.round((newSkills.Facts + newSkills.Inference + newSkills.Tone + newSkills.Argument) / 4);

            return {
                exp: newExp,
                depthOfUnderstanding: depth,
                skills: newSkills,
                totalAnswers: newTotal
            };
        });
    }, []);

    return {
        progress,
        handleCorrectAnswer
    };
};
