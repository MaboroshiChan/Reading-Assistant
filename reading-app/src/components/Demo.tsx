import React, { useState, type ReactNode, type CSSProperties, useEffect, useMemo, useCallback } from 'react';
import './css/Demo.css';
// import './css/Highlighted.css';
import type Paragraph from '../model/structure/Paragraph';
import { preprocessingFromText } from '../model/structure/Paragraph';
import { ParagraphComponent } from './paragraph/Paragraph';
import { chunkParagraphsByWordCount } from '../utils/textUtils';
import { isPending } from '../model/structure/Sentence';
import { FloatingMenu } from './FloatingMenu';
import { QuizWindow } from './quiz/QuizWindow';
import type { QuizQuestion } from '../services/envelopes';
import { useUserProgress } from '../hooks/useUserProgress';

import messageService, { streamingMessageService } from '../services/messageService.instance';

// Type definitions
export interface ArticleFrameworkProps {
  // Core content props
  title?: string;
  subtitle?: string;
  author?: string;
  date?: string;
  category?: string;
  tags?: string[];
  readTime?: string;
  image?: string;
  imageAlt?: string;
  content?: string | ReactNode;

  // Layout options
  layout?: 'default' | 'wide' | 'minimal';
  showImage?: boolean;
  showMeta?: boolean;
  showProgress?: boolean;
  progress?: number;
  showSidebar?: boolean;

  // Styling options
  theme?: 'light' | 'dark';
  accentColor?: string;
  fontFamily?: 'serif' | 'sans-serif';

  // Interactive features
  onShare?: () => void;
  onSave?: () => void;
  onLike?: (liked: boolean) => void;
  onAnalyze?: () => void;
  onReanalyzeAll?: () => void;
  isAnalyzing?: boolean;

  // Custom components
  HeaderComponent?: React.ComponentType;
  FooterComponent?: React.ComponentType;
  SidebarComponent?: React.ComponentType;
}

/**
 * Fetches article content from a file path.
 *
 * @param filePath - The path to the article file.
 * @returns A promise resolving to the article text or an error message.
 */
export const loadArticleFromFile = async (filePath: string): Promise<string> => {
  try {
    const response = await fetch(filePath);
    if (!response.ok) {
      throw new Error(`Failed to load article from ${filePath}`);
    }
    return await response.text();
  }
  catch (error) {
    console.error(error);
    return '<p>Error loading article content.</p>';
  }
}

// Article Framework/Skeleton Component
/**
 * The core layout component for the reading assistant.
 * Provides a structured container for titles, metadata, and content.
 *
 * @param props - Layout and content configuration.
 */
const ArticleFramework: React.FC<ArticleFrameworkProps> = ({
  // Core content props
  title,
  subtitle,
  author,
  date,
  category,
  tags = [],
  readTime,
  image,
  imageAlt,
  content,
  progress = 0,

  // Layout options
  layout = 'default',
  showImage = true,
  showMeta = true,
  showProgress = true,
  showSidebar = false,

  // Styling options
  theme = 'light',
  accentColor = '#007acc',
  fontFamily = 'serif',

  // Interactive features
  onShare,
  onSave,
  onLike,
  onAnalyze,
  onReanalyzeAll,
  isAnalyzing,

  // Custom components
  HeaderComponent,
  FooterComponent,
  SidebarComponent
}) => {
  const [isLiked, setIsLiked] = useState<boolean>(false);

  const handleLike = (): void => {
    setIsLiked(!isLiked);
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    onLike && onLike(!isLiked);
  };

  // Generate CSS variables for theming which might override or complement global theme
  const cssVars: CSSProperties = {
    '--accent-color': accentColor,
    '--bg-color': 'var(--color-bg-base)',
    '--text-color': 'var(--color-text-main)',
    '--text-secondary': 'var(--color-text-secondary)',
    '--border-color': 'var(--color-surface-border)',
    '--font-family': fontFamily === 'serif' ? 'Georgia, serif' : 'var(--font-base)'
  } as CSSProperties;

  return (
    <div className={`article-framework ${layout} ${theme}`} style={cssVars}>
      <style>{`
        .progress-bar {
          height: 100%;
          background: var(--accent-color);
          width: ${progress}%;
          transition: width 0.3s ease;
        }
      `}</style>

      {/* Reading Progress */}
      {showProgress && (
        <div className="progress-bar-container">
          <div className="progress-bar"></div>
        </div>
      )}

      <div className={showSidebar ? 'article-with-sidebar' : ''}>
        <main className="article-main">
          {/* Custom Header Component */}
          {HeaderComponent && (
            <div className="custom-header">
              <HeaderComponent />
            </div>
          )}

          {/* Article Header */}
          <header className="article-header">
            {category && <span className="article-category">{category}</span>}

            {title && <h1 className="article-title">{title}</h1>}

            {subtitle && <p className="article-subtitle">{subtitle}</p>}

            {tags.length > 0 && (
              <div className="tags">
                {tags.map((tag: string, index: number) => (
                  <span key={index} className="tag">#{tag}</span>
                ))}
              </div>
            )}

            {showMeta && (author || date || readTime) && (
              <div className="article-meta">
                {author && (
                  <div className="author-info">
                    <div className="author-avatar">
                      {author.split(' ').map((n: string) => n[0]).join('')}
                    </div>
                    <span>By {author}</span>
                  </div>
                )}
                {date && (
                  <div className="meta-item">
                    <span>📅</span>
                    <span>{date}</span>
                  </div>
                )}
                {readTime && (
                  <div className="meta-item">
                    <span>⏱️</span>
                    <span>{readTime}</span>
                  </div>
                )}
              </div>
            )}
          </header>

          {/* Article Image */}
          {showImage && image && (
            <div className="article-image-container">
              <img
                src={image}
                alt={imageAlt || title || 'Article image'}
                className="article-image"
              />
            </div>
          )}

          {/* Interactive Actions */}
          <div className="article-actions">
            <button
              className={`action-btn ${isLiked ? 'liked' : ''}`}
              onClick={handleLike}
              type="button"
            >
              <span>{isLiked ? '❤️' : '🤍'}</span>
              <span>{isLiked ? 'Liked' : 'Like'}</span>
            </button>

            {onShare && (
              <button className="action-btn" onClick={onShare} type="button">
                <span>📤</span>
                <span>Share</span>
              </button>
            )}

            {onSave && (
              <button className="action-btn" onClick={onSave} type="button">
                <span>🔖</span>
                <span>Save</span>
              </button>
            )}

            {onAnalyze && (
              <button className="action-btn" onClick={onAnalyze} type="button">
                <span>{isAnalyzing ? '📖' : '✨'}</span>
                <span>{isAnalyzing ? 'Show Origin' : 'AI Analysis'}</span>
              </button>
            )}

            {isAnalyzing && onReanalyzeAll && (
              <button className="action-btn" onClick={onReanalyzeAll} type="button">
                <span>🔄</span>
                <span>Reanalyze</span>
              </button>
            )}
          </div>

          {/* Article Content */}
          {content && (
            <div className="article-content">
              {typeof content === 'string' ? (
                <div dangerouslySetInnerHTML={{ __html: content }} />
              ) : (
                content
              )}
            </div>
          )}

          {/* Custom Footer Component */}
          {FooterComponent && (
            <div className="custom-footer">
              <FooterComponent />
            </div>
          )}
        </main>

        {/* Sidebar */}
        {showSidebar && (
          <aside className="sidebar">
            {SidebarComponent ? (
              <div className="custom-sidebar">
                <SidebarComponent />
              </div>
            ) : (
              <div>
                <h3>About the Author</h3>
                <p>Default sidebar content. Pass a SidebarComponent prop to customize.</p>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
};

// Additional type exports for convenience
export type LayoutType = 'default' | 'wide' | 'minimal';
export type ThemeType = 'light' | 'dark';
export type FontFamilyType = 'serif' | 'sans-serif';


// Example usage component
/**
 * A full-page example component demonstrating the ArticleFramework with streaming analysis.
 */
const ExampleArticle: React.FC = () => {
  const [rawParagraphs, setRawParagraphs] = useState<string[]>([]);
  const [analyzedData, setAnalyzedData] = useState<Paragraph[]>([]);
  const [viewMode, setViewMode] = useState<'raw' | 'analyzing'>('raw');
  const [isQuizWindowOpen, setIsQuizWindowOpen] = useState(false);
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[] | null>(null);
  const [isGeneratingQuiz, setIsGeneratingQuiz] = useState(false);
  const { progress: userProgress, handleCorrectAnswer } = useUserProgress();

  useEffect(() => {
    const loadContent = async () => {
      try {
        // This is the example article for the demo
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const module = await import('../../../resource/examples/TestArticles/gre-article.txt?raw');
        const text = module.default;
        const paragraphs = text.split(/\n\s*\n/).filter((p: string) => p.trim().length > 0);
        setRawParagraphs(paragraphs);
      } catch (error) {
        console.error("Failed to load example article text:", error);
      }
    };
    loadContent();
  }, []);

  const handleShare = (): void => {
    console.log('Share clicked');
  };

  const handleSave = (): void => {
    console.log('Save clicked');
  };

  const handleLike = (liked: boolean): void => {
    console.log('Like:', liked);
  };

  const runAnalysis = async () => {
    // 1. Preprocessing: Convert raw text to "Pending" Paragraph skeletons immediately
    const skeletons = rawParagraphs
      .map((text, index) => preprocessingFromText(text, index + 1));
    setAnalyzedData(skeletons);
    setViewMode('analyzing');

    // 2. Streaming Analysis (Chunked)
    const WORD_LIMIT = 400; // Max total words per concurrent batch of paragraphs
    const sessionId = `demo-${Date.now()}`;
    const chunks = chunkParagraphsByWordCount(skeletons, WORD_LIMIT);

    for (const chunk of chunks) {
      await Promise.all(chunk.map(async (p) => {
        if (p.kind !== 'text') return;
        setAnalyzedData(prev => prev.map(item => item.id === p.id ? { ...item, status: 'streaming' } : item));
        let hasSentenceData = false;
        try {
          await streamingMessageService.analyzeParagraph(
            {
              doc_id: sessionId,
              paragraph_id: String(p.id),
              paragraph_text: p.sentences.map(s => s.text).join(' '),
              options: { tasks: ['roles', 'rhetoric', 'summary', 'claims', 'tags'] }
            },
            { doc: { doc_id: sessionId, content_hash: 'demo-hash' } },
            {
              onPartial: (partial: any) => {
                if (partial.sentences && Array.isArray(partial.sentences) && partial.sentences.length > 0) {
                  hasSentenceData = true;
                }
                setAnalyzedData(prev => prev.map(item => {
                  if (item.id !== p.id) return item;
                  const updated = { ...item };
                  if (partial.rhetoric && partial.rhetoric.length > 0) updated.structureType = partial.rhetoric[0].label;
                  if (partial.roles && partial.roles.length > 0) updated.function = partial.roles[0].role;
                  if (partial.tags) updated.tags = partial.tags;
                  if (partial.sentences && partial.sentences.length > 0) {
                    updated.sentences = updated.sentences.map((s, i) => {
                      const incoming = (partial.sentences as any[])[i];
                      if (incoming) return { ...s, ...incoming, id: s.id };
                      return s;
                    });
                  }
                  return updated;
                }));
              }
            }
          );
          if (hasSentenceData) {
            setAnalyzedData(prev => prev.map(item => item.id === p.id ? { ...item, status: 'complete' } : item));
          } else {
            setAnalyzedData(prev => prev.map(item => {
              if (item.id !== p.id) return item;
              return { ...item, status: 'error', sentences: item.sentences.map(s => isPending(s) ? { ...s, function: 'Analysis Failed' } : s) };
            }));
          }
        } catch (err) {
          setAnalyzedData(prev => prev.map(item => {
            if (item.id !== p.id) return item;
            return { ...item, status: 'error', sentences: item.sentences.map(s => isPending(s) ? { ...s, function: 'Analysis Failed' } : s) };
          }));
        }
      }));
    }
  };

  const handleAnalyze = async (): Promise<void> => {
    if (viewMode === 'analyzing') {
      setViewMode('raw');
      return;
    }
    await runAnalysis();
  };

  const handleReanalyzeAll = async (): Promise<void> => {
    if (viewMode !== 'analyzing') {
      setViewMode('analyzing');
    }
    await runAnalysis();
  };

  const handleReanalyze = async (paragraphId: number): Promise<void> => {
    const rawIndex = paragraphId - 1;
    if (rawIndex < 0 || rawIndex >= rawParagraphs.length) return;
    
    // Use the raw text to create a fresh skeleton
    const text = rawParagraphs[rawIndex];
    const skeleton = preprocessingFromText(text, paragraphId);
    
    // Set exactly this paragraph to streaming skeleton state
    setAnalyzedData(prev => prev.map(item => item.id === paragraphId ? { ...skeleton, status: 'streaming' } : item));
    
    const sessionId = `demo-reanalyze-${Date.now()}`;
    let hasSentenceData = false;
    
    try {
      await streamingMessageService.analyzeParagraph(
        {
          doc_id: sessionId,
          paragraph_id: String(skeleton.id),
          paragraph_text: skeleton.sentences.map(s => s.text).join(' '),
          options: {
            tasks: ['roles', 'rhetoric', 'summary', 'claims', 'tags']
          }
        },
        { doc: { doc_id: sessionId, content_hash: 'demo-hash' } },
        {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onPartial: (partial: any) => {
            if (partial.sentences && Array.isArray(partial.sentences) && partial.sentences.length > 0) {
              hasSentenceData = true;
            }

            setAnalyzedData(prev => prev.map(item => {
              if (item.id !== skeleton.id) return item;

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
            }));
          }
        }
      );

      if (hasSentenceData) {
        setAnalyzedData(prev => prev.map(item => item.id === skeleton.id ? { ...item, status: 'complete' } : item));
      } else {
        console.warn(`[Stream] Reanalyze Paragraph ${skeleton.id} finished but missing sentence data.`);
        setAnalyzedData(prev => prev.map(item => {
          if (item.id !== skeleton.id) return item;
          return {
            ...item,
            status: 'error',
            sentences: item.sentences.map(s => isPending(s) ? { ...s, function: 'Analysis Failed' } : s)
          };
        }));
      }
    } catch (err) {
      console.error(`Reanalysis failed for paragraph ${skeleton.id}`, err);
      setAnalyzedData(prev => prev.map(item => {
        if (item.id !== skeleton.id) return item;
        return {
          ...item,
          status: 'error',
          sentences: item.sentences.map(s => isPending(s) ? { ...s, function: 'Analysis Failed' } : s)
        };
      }));
    }
  };

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
        doc_id: `demo-${Date.now()}`,
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
  }, [rawParagraphs]);

  // Quiz will be fetched manually via button click.

  const handleOpenQuiz = (): void => {
    setIsQuizWindowOpen(true);
    if (!hasRequestedQuiz.current || hasQuizError) {
      if (hasQuizError) hasRequestedQuiz.current = false;
      fetchQuiz();
    }
    setShowQuizNotification(false);
  };

  // Determine content to render
  let contentNode: ReactNode;
  if (viewMode === 'raw') {
    console.log('raw mode');
    contentNode = (
      <div style={{ whiteSpace: 'pre-wrap', textAlign: 'left' }}>
        {rawParagraphs.map((p, i) => <p key={i}>{p}</p>)}
      </div>
    );
  } else {
    contentNode = (
      <div>
        {analyzedData.map(p => <ParagraphComponent key={p.id} paragraph={p} onReanalyze={handleReanalyze} />)}
      </div>
    );
  }

  // Calculate analysis progress
  const progress = useMemo(() => {
    if (viewMode === 'raw' || analyzedData.length === 0) return 0;
    const totalSentences = analyzedData.reduce((acc, p) => acc + p.sentences.length, 0);
    if (totalSentences === 0) return 0;
    const completedSentences = analyzedData.reduce((acc, p) =>
      acc + p.sentences.filter(s => !isPending(s)).length, 0
    );
    return Math.round((completedSentences / totalSentences) * 100);
  }, [analyzedData, viewMode]);

  return (
    <>
    <ArticleFramework
      title="Your Article Title Here"
      subtitle="An engaging subtitle that draws readers in"
      author="Your Name"
      date="June 13, 2025"
      category="Technology"
      tags={['React', 'TypeScript', 'Web Development', 'CSS']}
      readTime="5 min read"
      image="https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=800&h=400&fit=crop"
      imageAlt="Article header image"
      content={contentNode}
      progress={progress}
      layout="default"
      theme="light"
      accentColor="#007acc"
      fontFamily="serif"
      showImage={true}
      showMeta={true}
      showProgress={true}
      showSidebar={false}
      isAnalyzing={viewMode === 'analyzing'}
      onShare={handleShare}
      onSave={handleSave}
      onLike={handleLike}
      onAnalyze={handleAnalyze}
      onReanalyzeAll={handleReanalyzeAll}
    />
    <FloatingMenu 
      onQuizMeClick={handleOpenQuiz} 
      showNotification={showQuizNotification} 
      isGenerating={isGeneratingQuiz} 
      hasError={hasQuizError} 
      userProgress={userProgress}
    />
    <QuizWindow 
      isOpen={isQuizWindowOpen} 
      onClose={() => setIsQuizWindowOpen(false)} 
      questions={quizQuestions}
      isLoading={isGeneratingQuiz}
      onCorrectAnswer={handleCorrectAnswer}
    />
    </>
  );
};

export default ArticleFramework;
export { ExampleArticle };