import React, { useState, useEffect, useCallback } from 'react';
import { ParagraphComponent } from './paragraph/Paragraph';
import type Paragraph from '../model/structure/Paragraph';
import { preprocessingFromText } from '../model/structure/Paragraph';
import messageService, { streamingMessageService } from '../services/messageService.instance';
import './css/ReaderPage.css';
import { chunkParagraphsByWordCount, isTitle } from '../utils/textUtils';
import { FloatingMenu } from './FloatingMenu';
import { QuizWindow } from './quiz/QuizWindow';
import { MasteryWindow } from './mastery/MasteryWindow';
import type { QuizQuestion } from '../services/envelopes';
import { useUserProgress } from '../hooks/useUserProgress';

interface ReaderPageProps {
    articleData: {
        title?: string;
        byline?: string;
        content?: string;
        textContent?: string;
        url?: string;
    };
}

export const ReaderPage: React.FC<ReaderPageProps> = ({ articleData }) => {
    const [analyzedData, setAnalyzedData] = useState<Paragraph[]>([]);
    const [viewMode, setViewMode] = useState<'reading' | 'analyzing'>('reading');
    const [rawParagraphs, setRawParagraphs] = useState<string[]>([]);
    // Track if we have restored data to determine button state
    const [hasRestoredData, setHasRestoredData] = useState(false);
    const [isQuizWindowOpen, setIsQuizWindowOpen] = useState(false);
    const [isMasteryWindowOpen, setIsMasteryWindowOpen] = useState(false);
    const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[] | null>(null);
    const [isGeneratingQuiz, setIsGeneratingQuiz] = useState(false);
    
    const { progress: userProgress, handleCorrectAnswer } = useUserProgress();

    // Generate a unique key for storage
    const storageKey = React.useMemo(() => {
        if (articleData.url) return `analysis_${articleData.url}`;
        if (articleData.title) return `analysis_${articleData.title.replace(/\s+/g, '_')}`;
        return null;
    }, [articleData.url, articleData.title]);

    useEffect(() => {
        if (articleData.textContent) {
            const paragraphs = articleData.textContent
                .split(/\n\s*\n/)
                .filter((p) => p.trim().length > 0);
            setRawParagraphs(paragraphs);
        }
    }, [articleData]);

    useEffect(() => {
        if (articleData.title) {
            document.title = articleData.title;
        }
    }, [articleData.title]);

    // Load from storage on mount/key change
    useEffect(() => {
        if (!storageKey || typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;

        chrome.storage.local.get(storageKey, (result) => {
            const data = result[storageKey];
            if (data && Array.isArray(data) && data.length > 0) {
                console.log('Restored analysis data from storage:', storageKey);
                setAnalyzedData(data);
                setViewMode('analyzing');
                setHasRestoredData(true);
            }
        });
    }, [storageKey]);

    // Save to storage
    const persistData = useCallback((data: Paragraph[]) => {
        if (!storageKey || typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
        chrome.storage.local.set({ [storageKey]: data }, () => {
            // console.log('Saved analysis data to storage');
        });
    }, [storageKey]);

    const [showQuizNotification, setShowQuizNotification] = useState(false);
    const [hasQuizError, setHasQuizError] = useState(false);
    const hasRequestedQuiz = React.useRef(false);

    const fetchQuiz = useCallback(async () => {
        if (hasRequestedQuiz.current || rawParagraphs.length === 0) return;
        hasRequestedQuiz.current = true;
        setIsGeneratingQuiz(true);
        setHasQuizError(false);
        
        try {
            const fullText = rawParagraphs.join('\n\n');
            const response = await messageService.analyzeQuiz({
                doc_id: storageKey || `reader-${Date.now()}`,
                article_text: fullText
            });
            
            if (response.status === 'ok' && response.data?.questions && response.data.questions.length > 0) {
                setQuizQuestions(response.data.questions);
                setShowQuizNotification(true);
            } else {
                console.error('Failed to generate quiz:', response.error);
                setHasQuizError(true);
            }
        } catch (err) {
            console.error('Error generating quiz:', err);
            setHasQuizError(true);
        } finally {
            setIsGeneratingQuiz(false);
        }
    }, [rawParagraphs, storageKey]);

    // Quiz will be fetched manually via button click.

    const handleOpenQuiz = () => {
        setIsQuizWindowOpen(true);
        if (!hasRequestedQuiz.current || hasQuizError) {
            if (hasQuizError) hasRequestedQuiz.current = false;
            fetchQuiz();
        }
        setShowQuizNotification(false);
    };

    const handleAnalyze = async () => {
        // If we are in "Refresh" mode (hasRestoredData or viewMode is analyzing but finished), we clear and restart
        if (hasRestoredData || (viewMode === 'analyzing' && analyzedData.length > 0 && analyzedData.every(p => p.status === 'complete' || p.status === 'error'))) {
            setAnalyzedData([]);
            setHasRestoredData(false);
            // Optionally clear storage immediately or just overwrite later
            // chrome.storage.local.remove(storageKey); 
        } else if (viewMode === 'analyzing') {
            return; // Already analyzing and not finished/refreshing
        }

        // 1. Preprocessing
        const skeletons = rawParagraphs
            .map((text, index) => preprocessingFromText(text, index + 1));
        setAnalyzedData(skeletons);
        setViewMode('analyzing');

        // Max total words per concurrent batch of paragraphs
        const WORD_LIMIT = 1500;

        const chunks = chunkParagraphsByWordCount(skeletons, WORD_LIMIT);

        for (const chunk of chunks) {
            await Promise.all(chunk.map(async (p) => {
                // Skip anything that isn't regular text (titles, citations)
                if (p.kind !== 'text') return;

                // Mark as streaming
                setAnalyzedData(prev => prev.map(item => item.id === p.id ? { ...item, status: 'streaming' as const } : item));

                try {
                    await streamingMessageService.analyzeParagraph(
                        {
                            doc_id: 'extracted-doc',
                            paragraph_id: String(p.id),
                            paragraph_text: p.sentences.map(s => s.text).join(' '),
                            options: {
                                tasks: ['roles', 'rhetoric', 'summary', 'claims', 'tags']
                            }
                        },
                        { doc: { doc_id: 'extracted-doc', content_hash: 'extracted-hash' } },
                        {
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            onPartial: (partial: any) => {
                                setAnalyzedData(prev => {
                                    const newData = prev.map(item => {
                                        if (item.id !== p.id) return item;

                                        // Immutable update of the paragraph
                                        const updated = { ...item };
                                        if (partial.rhetoric && partial.rhetoric.length > 0) {
                                            updated.structureType = partial.rhetoric[0].label;
                                        }
                                        if (partial.roles && partial.roles.length > 0) {
                                            updated.function = partial.roles[0].role;
                                        }
                                        if (partial.tags) {
                                            updated.tags = partial.tags;
                                        }
                                        if (partial.sentences && partial.sentences.length > 0) {
                                            updated.sentences = updated.sentences.map((s, i) => {
                                                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                                const incoming = (partial.sentences as any[])[i];
                                                if (incoming) {
                                                    return {
                                                        ...s,
                                                        ...incoming,
                                                        id: s.id, // Ensure original ID is preserved
                                                    };
                                                }
                                                return s;
                                            });
                                        }
                                        return updated;
                                    });
                                    // Note: We don't persist on partial, only on complete
                                    return newData;
                                });
                            }
                        }
                    );

                    // Mark as complete and PERSIST
                    setAnalyzedData(prev => {
                        const newData = prev.map(item => item.id === p.id ? { ...item, status: 'complete' as const } : item);
                        persistData(newData); // Persist updated state
                        return newData;
                    });

                } catch (err) {
                    console.error(`Analysis failed for paragraph ${p.id}`, err);
                    setAnalyzedData(prev => {
                        const newData = prev.map(item => item.id === p.id ? { 
                            ...item, 
                            status: 'error' as const, 
                            errorMessage: (err as Error).message || String(err),
                            sentences: item.sentences.map(s => ({ ...s, function: 'Error' })) // Stop the spinner loop
                        } : item);
                        persistData(newData);
                        return newData;
                    });
                }
            }));
        }

        // Final persist to be sure
        setAnalyzedData(prev => {
            persistData(prev);
            return prev;
        });
    };

    // Determine button label
    const isAnalyzing = viewMode === 'analyzing' && analyzedData.some(p => p.status === 'pending' || p.status === 'streaming');
    const showRefresh = hasRestoredData || (viewMode === 'analyzing' && !isAnalyzing && analyzedData.length > 0);

    return (
        <div className="reader-page">
            <header className="reader-header">
                <div className="reader-meta">
                    {articleData.title && <h1 className="reader-title">{articleData.title}</h1>}
                    {articleData.byline && <p className="reader-byline">{articleData.byline}</p>}
                </div>

                <button
                    className="analyze-btn"
                    onClick={handleAnalyze}
                    disabled={isAnalyzing}
                >
                    {isAnalyzing ? 'Analyzing...' : showRefresh ? 'Refresh' : '✨ Start AI Analysis'}
                </button>
            </header>

            <main className="reader-content">
                {viewMode === 'reading' ? (
                    <div className="text-content">
                        {rawParagraphs.map((text, i) => {
                            if (isTitle(text)) {
                                return (
                                    <h2 key={i} className="reader-section-title">
                                        {text}
                                    </h2>
                                );
                            }
                            return <p key={i} className="reader-paragraph">{text}</p>;
                        })}
                    </div>
                ) : (
                    <div className="analysis-content">
                        {analyzedData.map(p => (
                            <ParagraphComponent key={p.id} paragraph={p} />
                        ))}
                    </div>
                )}
            </main>
            <FloatingMenu 
                onQuizMeClick={handleOpenQuiz} 
                onMasteryClick={() => setIsMasteryWindowOpen(true)}
                showNotification={showQuizNotification} 
                isGenerating={isGeneratingQuiz} 
                hasError={hasQuizError} 
            />
            <QuizWindow 
                isOpen={isQuizWindowOpen} 
                onClose={() => setIsQuizWindowOpen(false)} 
                questions={quizQuestions}
                isLoading={isGeneratingQuiz}
                onCorrectAnswer={handleCorrectAnswer}
            />
            <MasteryWindow
                isOpen={isMasteryWindowOpen}
                onClose={() => setIsMasteryWindowOpen(false)}
                userProgress={userProgress}
            />
        </div>
    );
};
