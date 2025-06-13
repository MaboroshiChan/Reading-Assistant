import { useState } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import './App.css'
import { Sentence } from './analysis/structure/Sentence';
import type { SentenceLabels } from './analysis/structure/Sentence';
import { SemanticSentence } from './components/SemanticSentence'
import example2 from '../examples/example2.json'; // Importing the example JSON file
import { ExampleArticle } from './components/ArticleSkeleton';

function App() {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const sentence: Sentence = Sentence.fromSentenceLabels(
    example2['sentence_labels'] as SentenceLabels,
    {
      id: 1,
      function: "Premise",
      type: "Declarative",
      purpose: "To demonstrate a test case",
      mood: "Indicative",
      relation: {
        type: "Justification",
        targetSentenceId: 2, // Assuming there's another sentence with ID 2
      },
  }
  );
  /** */
  return (
    <ExampleArticle />
  )
}

export default App
