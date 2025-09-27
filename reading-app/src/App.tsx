import './App.css'
import { ExampleArticle } from './components/ArticleSkeleton';
// import {SentenceCardComponent} from './components/InfoComponent';
import { SentenceHoverCard } from './components/SentenceHoverCard';

import { useRef } from "react";

function App() {

  const targetRef = useRef<HTMLSpanElement>(null);

  return (  
   <div className="App">
      <ExampleArticle />

      <p style={{ padding: 24, fontSize: 18, lineHeight: 1.8 }}>
        Quantum theory reshaped our understanding of reality by showing particles can exist in{" "}
        <span ref={targetRef} className="hl">
          superposition
        </span>
        , occupying multiple states until observed...
      </p>

      <SentenceHoverCard
        targetRef={targetRef}
        info={{
          id: "s-001",
          text: "superposition: the linear-combination of basis states.",
          paraphrase: "处于多个可能状态的叠加，直到被观测。",
          roleLabel: "Definition",
          structureLabel: "Noun Phrase",
          mood: "neutral"
        }}
      />
    </div>
  )
}

export default App
