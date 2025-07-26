import React, { useState, type ReactNode, type CSSProperties } from 'react';
import './css/ArticleSkeleton.css';
import './css/Highlighted.css';
import { Paragraph } from '../analysis/structure/Paragraph';
import type { LLMAnalysis } from '../analysis/structure/Sentence';
import { SemanticParagraph } from './SermanticParagraph';


// eslint-disable-next-line @typescript-eslint/no-unused-vars
const exampleAnalysis: LLMAnalysis = {
  id: 1,
  sentence: "Natural language processing significantly improves human-computer interaction.",
  structure: {
    subject: "Natural language processing",
    predicate: "improves",
    object: "human-computer interaction"
  },
  semantics: {
    semantic_roles: [
      { text_piece: "Natural language processing", type: "entity" },
      { text_piece: "improves", type: "event" },
      { text_piece: "human-computer interaction", type: "concept" },
      { text_piece: "significantly", type: "modifier" }
    ]
  },
  pragmatics: {
    modality: "factual",
    tone: "analytical",
    emphasis: true,
    focus: ["improves", "human-computer interaction"]
  }
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const exampleAnalysis2: LLMAnalysis = {
  id: 2,
  sentence: "The properties of the category would depend on many factors: the role of that node in the given schema, its relationship to other nodes in the schema, the relationship of that schema to other schemas, and the overall interaction of that schema with other aspects of the conceptual system.",
  structure: {
    subject: "The properties of the category",
    predicate: "would depend",
    object: "many factors"
  },
  semantics: {
    semantic_roles: [
      { text_piece: "The properties of the category", type: "entity" },
      { text_piece: "would depend", type: "event" },
      { text_piece: "many factors", type: "concept" },
      { text_piece: "the role of that node in the given schema", type: "concept" },
      { text_piece: "its relationship to other nodes in the schema", type: "concept" },
      { text_piece: "the relationship of that schema to other schemas", type: "concept" },
      { text_piece: "the overall interaction of that schema with other aspects of the conceptual system", type: "concept" }
    ]
  },
  pragmatics: {
    modality: "hypothetical",
    tone: "analytical",
    emphasis: false,
    focus: [
      "would depend",
      "many factors",
      "the role of that node in the given schema",
      "its relationship to other nodes in the schema"
    ]
  }
};

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

const ExampleParagraph: React.FC = () => {
  const [paragraph, setParagraph] = useState<Paragraph | null>(null);

  console.log("testing ")

  React.useEffect(() => {
    const loadParagraph = async () => {
      try {
        const response = await fetch('/prompts/test_paragraph1.txt');
        const text = await response.text();
        setParagraph(new Paragraph(1,text));
      } catch (error) {
        console.error('Failed to load paragraph:', error);
      }
    };

    loadParagraph();
  }, []);

  return (
    <div>
      {paragraph ? <SemanticParagraph paragraph={paragraph} /> : <p>Loading...</p>}
    </div>
  );
}

// Example usage component
const ExampleArticle: React.FC = () => {
  const handleShare = (): void => {
    console.log('Share clicked');
  };

  const handleSave = (): void => {
    console.log('Save clicked');
  };

  const handleLike = (liked: boolean): void => {
    console.log('Like:', liked);
  };

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
      content={<ExampleParagraph />}
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
    />
  );
};

export default ArticleFramework;
export { ExampleArticle };