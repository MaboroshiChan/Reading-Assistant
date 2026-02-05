import React, { useState, useEffect } from 'react';
import { ParagraphComponent } from './paragraph/Paragraph';
import type Paragraph from '../model/structure/Paragraph';
import { preprocessingFromText } from '../model/structure/Paragraph';
import { streamingMessageService } from '../services/messageService.instance';
import './css/ReaderPage.css';

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

    const handleAnalyze = async () => {
        if (viewMode === 'analyzing') return;

        // 1. Preprocessing
        const skeletons = rawParagraphs.map((text, index) => preprocessingFromText(text, index + 1));
        setAnalyzedData(skeletons);
        setViewMode('analyzing');

        // 2. Streaming Analysis (Chunked)
        const CHUNK_SIZE = 4;
        for (let i = 0; i < skeletons.length; i += CHUNK_SIZE) {
            const chunk = skeletons.slice(i, i + CHUNK_SIZE);
            console.log('Chunk', chunk);
            await Promise.all(chunk.map(async (p) => {
                // Mark as streaming
                setAnalyzedData(prev => prev.map(item => item.id === p.id ? { ...item, status: 'streaming' } : item));

                try {
                    await streamingMessageService.analyzeParagraph(
                        {
                            doc_id: 'extracted-doc',
                            paragraph_id: String(p.id),
                            paragraph_text: p.sentences.map(s => s.text).join(' '),
                            options: {
                                tasks: ['roles', 'rhetoric', 'summary', 'claims']
                            }
                        },
                        { doc: { doc_id: 'extracted-doc', content_hash: 'extracted-hash' } },
                        {
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            onPartial: (partial: any) => {
                                setAnalyzedData(prev => prev.map(item => {
                                    if (item.id !== p.id) return item;

                                    // Immutable update of the paragraph
                                    const updated = { ...item };
                                    if (partial.summary) updated.centralIdea = partial.summary;
                                    if (partial.rhetoric && partial.rhetoric.length > 0) {
                                        updated.structureType = partial.rhetoric[0].label;
                                    }
                                    if (partial.roles && partial.roles.length > 0) {
                                        updated.function = partial.roles[0].role;
                                    }
                                    if (partial.topic_sentence) {
                                        updated.topicSentence = partial.topic_sentence;
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
                                }));
                            }
                        }
                    );

                    // Mark as complete
                    setAnalyzedData(prev => prev.map(item => item.id === p.id ? { ...item, status: 'complete' } : item));
                } catch (err) {
                    console.error(`Analysis failed for paragraph ${p.id}`, err);
                    setAnalyzedData(prev => prev.map(item => item.id === p.id ? { ...item, status: 'error' } : item));
                }
            }));
        }
    };

    return (
        <div className="reader-page">
            <header className="reader-header">
                <div className="reader-meta">
                    {articleData.title && <h1 className="reader-title">{articleData.title}</h1>}
                    {articleData.byline && <p className="reader-byline">{articleData.byline}</p>}
                </div>

                {viewMode === 'reading' && (
                    <button className="analyze-btn" onClick={handleAnalyze}>
                        ✨ Start AI Analysis
                    </button>
                )}
            </header>

            <main className="reader-content">
                {viewMode === 'reading' ? (
                    <div className="text-content">
                        {rawParagraphs.map((text, i) => (
                            <p key={i} className="reader-paragraph">{text}</p>
                        ))}
                    </div>
                ) : (
                    <div className="analysis-content">
                        {analyzedData.map(p => (
                            <ParagraphComponent key={p.id} paragraph={p} />
                        ))}
                    </div>
                )}
            </main>
        </div>
    );
};
