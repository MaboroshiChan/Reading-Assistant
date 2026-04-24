# Reading Assistant iOS Implementation Specifications

This document outlines the architecture, data models, state management, and user interface features required to port the existing React-based Reading Assistant frontend to a native iOS application.

## 1. Overview
The iOS app will mirror the structural analysis, reading comprehension, and mastery tracking features of the web application. A key enhancement in the iOS version is native support for processing `.epub` files. The core user flow involves importing `.epub` books, reading chapter-segmented paragraphs, viewing AI-analyzed sentences and rhetoric relationships, taking quizzes on the text, and tracking learning progress.

## 2. Core Data Models

These models represent the core structural data of the text being analyzed, equivalent to the TypeScript models found in `src/model/structure/`.

### `Document` (EPUB Support)
Unlike the web version which processes flat text, the iOS app supports `.epub` file processing. Therefore, the `Document` model accounts for book structure (e.g., chapters or sections).

```swift
struct Chapter: Identifiable {
    let id: UUID
    var title: String?
    var paragraphs: [Paragraph]
}

struct Document {
    var id: UUID
    var title: String?
    var author: String?
    var coverImageURL: URL?
    var chapters: [Chapter]
}
```

### `Paragraph`
Represents a block of text, which is segmented into sentences and categorized by its purpose.
```swift
struct Paragraph: Identifiable {
    let id: Int
    var sentences: [Sentence]
    
    // Status of AI Analysis
    enum Status: String {
        case pending, streaming, complete, error
    }
    var status: Status?
    var errorMessage: String?
    
    // Classification of the paragraph content
    enum Kind: String {
        case text, title, citation, short
    }
    var kind: Kind?
    
    struct Tag {
        let name: String
        let type: String // "logic" | "concept"
        let description: String?
    }
    var tags: [Tag]?
    
    // Derived from analysis
    var structureType: String? // e.g., "Contrast", "Progression"
    var function: String?      // e.g., "Introduction", "Conclusion"
    
    struct TopicSentence {
        var isImplicit: Bool?
        var text: String?
        var id: String?
    }
    var topicSentence: TopicSentence?
}
```

### `Sentence`
The granular unit of text that contains rhetorical breakdowns and keyword highlights.
```swift
struct SentenceRelation {
    let type: String // e.g., "Justification", "Conclusion", "Contrast"
    let targetSentenceId: Int
}

struct Keyword {
    let word: String
    let color: String // e.g., "red", "green"
}

struct Sentence: Identifiable {
    let id: Int
    let text: String
    
    var function: String
    var type: String
    var purpose: String
    var mood: String
    
    var relation: SentenceRelation?
    var keyWords: [Keyword]?
}
```

## 3. State Management (Mastery & Progress tracking)

The web app uses a custom hook `useUserProgress` that relies on `localStorage`. For iOS, this translates perfectly to `@AppStorage` (for simple persistence) or SwiftData/CoreData if a deeper relational history is planned later. 

### Mastery Tracker state
```swift
struct UserSkills: Codable {
    var facts: Int
    var inference: Int
    var tone: Int
    var argument: Int
}

struct UserProgress: Codable {
    var exp: Int
    var depthOfUnderstanding: Int
    var skills: UserSkills
    var totalAnswers: Int
}
```
**Core Logic Rules**:
- Whenever a user answers a Quiz question correctly, they receive `+10` points to the specific skill (Fact, Inference, Tone, or Argument) up to a max cap of `100`.
- The user gains `+50` XP for a correct answer.
- The `depthOfUnderstanding` is mathematically calculated as the average of the 4 skill scores.

## 4. Key UI Components & Interactions

### The Reader View Core
- **Top Level View**: Displays a table of contents or lists the `.epub` chapters natively. Selecting a chapter brings up its `paragraphs`.
- **AI Analysis Initialization**: Contains a primary Action Button (✨ Start AI Analysis) that loops through `paragraphs` of the active chapter and triggers API backend calls on chunks of text (chunk word limits apply).
- **Paragraph Status**: While analyzing, paragraphs visually show as "loading" or disabled. `pending` paragraphs are greyed out, while `complete` paragraphs gain interactivity.

### Sentence Interactions (`Sentence.tsx` analogue)
- **Inline Text**: Sentences are rendered sequentially. Keywords (if any) are highlighted inline using varied colors (`red`, `green`).
- **Hover/Tap Action**: Tapping a sentence brings up a Context Menu or a Bottom Sheet (`HoverCard.tsx`) displaying:
  - Tags for: `Sentence Function` (support, contrast), `Sentence Type` (declarative), and `Sentence Mood` (indicative).
  - A short `Explanation/Purpose`.
  - An inline Relationship diagram showing logical bridges to previous or next sentences.
  - An option for deep **Sentence Structure Analysis** that is fetched on demand.

### Paragraph UI and Reanalysis (`Paragraph.tsx` analogue)
- Paragraphs display colored gutters along the side to indicate logic progression.
- Logical "Bridges" connect related sentences within a single paragraph. These bridges can be tapped to highlight both sentences involved.
- **Reanalysis Button**: Needs to be present on each analyzed paragraph to allow the user to specifically request a fresh breakdown for that block of text.

### Quizzes (`QuizWindow.tsx` analogue)
- Provides ETS-style questions about the whole document.
- **Interactions**:
  - Requires a "Quiz me!" floating action button.
  - Presents questions one by one natively.
  - Reveals answers on selection with an explicit explanation block (✅ Correct / ❌ Incorrect + why).
  - Updates the `UserProgress` state (Mastery points) locally upon choosing the correct option.
