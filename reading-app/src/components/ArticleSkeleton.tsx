import React, { useState, type ReactNode, type CSSProperties, useEffect } from 'react';
import './css/ArticleSkeleton.css';
import './css/Highlighted.css';
import type Paragraph  from '../model/structure/Paragraph';
import { preprocessingFromText } from '../model/structure/Paragraph';
import { ParagraphComponent } from './ParagraphComponent';
import exampleArticle from '../../../resource/examples/example-article.json';
import config from '../services/config';
import { streamingMessageService } from '../services/messageService.instance';


const ExampleParagraph: React.FC = () => {

  const article: Paragraph[] = exampleArticle as Paragraph[];

  return (
    <div>
      {article.map(p => (
        <ParagraphComponent paragraph={p}/>
      ))}
    </div>
  );
};


if(config.renderMode) {
  console.log('render mode on');
}
else {
  console.log('render mode off');
}

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

  // Custom components
  HeaderComponent?: React.ComponentType;
  FooterComponent?: React.ComponentType;
  SidebarComponent?: React.ComponentType;
}

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

  // Custom components
  HeaderComponent,
  FooterComponent,
  SidebarComponent
}) => {
  const [isLiked, setIsLiked] = useState<boolean>(false);
  const [readingProgress] = useState<number>(0);

  const handleLike = (): void => {
    setIsLiked(!isLiked);
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    onLike && onLike(!isLiked);
  };

  // Generate CSS variables for theming
  const cssVars: CSSProperties = {
    '--accent-color': accentColor,
    '--bg-color': theme === 'dark' ? '#1a1a1a' : '#ffffff',
    '--text-color': theme === 'dark' ? '#e0e0e0' : '#333333',
    '--text-secondary': theme === 'dark' ? '#a0a0a0' : '#666666',
    '--border-color': theme === 'dark' ? '#333333' : '#e0e0e0',
    '--font-family': fontFamily === 'serif' ? 'Georgia, serif' : 'Inter, sans-serif'
  } as CSSProperties;

  return (
    <div className={`article-framework ${layout} ${theme}`} style={cssVars}>
      <style>{`
        .progress-bar {
          height: 100%;
          background: var(--accent-color);
          width: ${readingProgress}%;
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
                <span>✨</span>
                <span>AI Analysis</span>
              </button>
            )}
          </div>

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
const ExampleArticle: React.FC = () => {
  const [rawParagraphs, setRawParagraphs] = useState<string[]>([]);
  const [analyzedData, setAnalyzedData] = useState<Paragraph[]>([]);
  const [viewMode, setViewMode] = useState<'raw' | 'analyzing'>('raw');

  useEffect(() => {
    const loadContent = async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const module = await import('../../../resource/examples/TestArticles/example-article.txt?raw');
        const text = module.default;
        const paragraphs = text.split(/\n\s*\n/).filter((p: string) => p.trim().length > 0);
        setRawParagraphs(paragraphs);
      } catch (error) {
        console.error("Failed to load example article text:", error);
      }
    };
    if (config.renderMode) {
      loadContent();
    }
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

  const handleAnalyze = async (): Promise<void> => {
    if (viewMode === 'analyzing') return;

    // 1. Preprocessing: Convert raw text to "Pending" Paragraph skeletons immediately
    const skeletons = rawParagraphs.map((text, index) => preprocessingFromText(text, index + 1));
    setAnalyzedData(skeletons);
    setViewMode('analyzing');

    // 2. Streaming Analysis
    skeletons.forEach(async (p) => {
      // Mark as streaming
      setAnalyzedData(prev => prev.map(item => item.id === p.id ? { ...item, status: 'streaming' } : item));

      try {
        await streamingMessageService.analyzeParagraph(
          {
            doc_id: 'demo-doc',
            paragraph_id: String(p.id),
            paragraph_text: p.sentences.map(s => s.text).join(' '),
            options: {
              tasks: ['roles', 'rhetoric', 'summary','claims']
            }
          },
          { doc: { doc_id: 'demo-doc', content_hash: 'demo-hash' } },
          {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onPartial: (partial: any) => {
               // console.log(`[Stream] Paragraph ${p.id} partial:`, partial);
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
        // console.log(`[Stream] Paragraph ${p.id} complete`);
        setAnalyzedData(prev => prev.map(item => item.id === p.id ? { ...item, status: 'complete' } : item));
      } catch (err) {
        console.error(`Analysis failed for paragraph ${p.id}`, err);
        setAnalyzedData(prev => prev.map(item => item.id === p.id ? { ...item, status: 'error' } : item));
      }
    });
  };

  // Determine content to render
  let contentNode: ReactNode;
  if (!config.renderMode) {
    contentNode = <ExampleParagraph />;
  } else if (viewMode === 'raw') {
    console.log('raw mode');
    contentNode = (
      <div style={{ whiteSpace: 'pre-wrap', textAlign: 'left' }}>
        {rawParagraphs.map((p, i) => <p key={i}>{p}</p>)}
      </div>
    );
  } else {
    contentNode = (
      <div>
        {analyzedData.map(p => <ParagraphComponent key={p.id} paragraph={p} />)}
      </div>
    );
  }

  return (
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
      layout="default"
      theme="light"
      accentColor="#007acc"
      fontFamily="serif"
      showImage={true}
      showMeta={true}
      showProgress={true}
      showSidebar={false}
      onShare={handleShare}
      onSave={handleSave}
      onLike={handleLike}
      onAnalyze={handleAnalyze}
    />
  );
};

export default ArticleFramework;
export { ExampleArticle };