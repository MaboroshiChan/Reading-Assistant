import React, { useState, useEffect } from 'react';
import RefinerSentence from '../components/refiner/RefinerSentence';
import './RefinerPage.css';

/**
 * RefinerPage - Main UI for the prompt refinement human-in-the-loop task.
 */
export const RefinerPage: React.FC = () => {
    const [sentences, setSentences] = useState<string[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [candidates, setCandidates] = useState<string[]>([]);

    const [isGenerating, setIsGenerating] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const [manualKeywords, setManualKeywords] = useState("");
    const [savedCount, setSavedCount] = useState(0);

    // 1. Fetch initial sentences from local python server
    useEffect(() => {
        fetch('http://localhost:8000/sentences')
            .then(res => res.json())
            .then(data => {
                if (data.sentences) {
                    setSentences(data.sentences);
                }
            })
            .catch(err => {
                console.error("Failed to fetch sentences from python backend", err);
            });
    }, []);

    // Force light mode on body
    useEffect(() => {
        document.body.classList.add('force-light-mode');
        return () => {
            document.body.classList.remove('force-light-mode');
        };
    }, []);

    const currentSentence = sentences[currentIndex] || "";

    // 2. Request generations for the current sentence
    const handleGenerate = async () => {
        if (!currentSentence) return;
        setIsGenerating(true);
        setCandidates([]);
        setManualKeywords("");
        try {
            const res = await fetch('http://localhost:8000/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sentence: currentSentence })
            });
            const data = await res.json();
            if (data.candidates) {
                setCandidates(data.candidates);
            }
        } catch (err) {
            console.error(err);
            alert("Failed to generate candidates. Is the python server running?");
        } finally {
            setIsGenerating(false);
        }
    };

    // 3. Save a specific choice
    const handleSave = async (chosenKeywords: string) => {
        if (!chosenKeywords.trim()) {
            alert("Keywords cannot be empty.");
            return;
        }

        setIsSaving(true);
        try {
            const res = await fetch('http://localhost:8000/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sentence: currentSentence,
                    key_words: chosenKeywords
                })
            });
            const data = await res.json();
            if (data.status === 'success') {
                setSavedCount(data.total_examples);
                // Move to next sentence
                setCurrentIndex(prev => prev + 1);
                setCandidates([]);
                setManualKeywords("");
            }
        } catch (err) {
            console.error(err);
            alert("Failed to save to dataset.");
        } finally {
            setIsSaving(false);
        }
    };

    if (sentences.length === 0) {
        return <div className="refiner-page">Loading sentences queue from Python backend... Ensure <code>reading-app-server/prompt-refiner/server.py</code> is running.</div>;
    }

    if (currentIndex >= sentences.length) {
        return (
            <div className="refiner-page done-state">
                <h2>🎉 All Done!</h2>
                <p>You have annotated all sentences in the queue.</p>
                <p>Total examples in Golden Dataset: <strong>{savedCount}</strong></p>
                <button onClick={() => window.location.reload()}>Refresh Queue</button>
            </div>
        );
    }

    return (
        <div className="refiner-page">
            <header className="refiner-header">
                <h1>Prompt Refiner UI</h1>
                <div className="stats">
                    Dataset Size: <span className="badge">{savedCount}</span>
                    | Queue: <span className="badge">{currentIndex + 1} / {sentences.length}</span>
                </div>
            </header>

            <section className="original-section">
                <h3>Original Sentence</h3>
                <blockquote className="sentence-display">{currentSentence}</blockquote>
                <div className="actions">
                    <button
                        className="btn primary"
                        onClick={handleGenerate}
                        disabled={isGenerating}
                    >
                        {isGenerating ? "🤖 Generating variants..." : "✨ Generate Candidates"}
                    </button>
                    <button
                        className="btn secondary"
                        onClick={() => setCurrentIndex(prev => prev + 1)}
                    >
                        Skip Sentence
                    </button>
                </div>
            </section>

            {candidates.length > 0 && (
                <section className="candidates-section">
                    <h3>AI Candidates (Select the best one)</h3>
                    <div className="candidates-grid">
                        {candidates.map((candStr, idx) => (
                            <div key={idx} className="candidate-card">
                                <div className="card-header">Option {idx + 1}</div>
                                <div className="card-body">
                                    <RefinerSentence text={currentSentence} keyWords={candStr} isEditable={false} />
                                    <div className="raw-keywords"><strong>Raw:</strong> {candStr}</div>
                                </div>
                                <button
                                    className="btn success full-width"
                                    disabled={isSaving}
                                    onClick={() => handleSave(candStr)}
                                >
                                    Save this Option
                                </button>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {/* Manual Override Section is always available to build an answer from scratch or tweak */}
            <section className="manual-section">
                <h3>Manual Edit (Click words to toggle)</h3>
                <p className="help-text">Click the words in the sentence below to manually construct your keyword list if the AI failed.</p>
                <div className="manual-arena">
                    <RefinerSentence
                        text={currentSentence}
                        keyWords={manualKeywords}
                        isEditable={true}
                        onKeyWordsChange={setManualKeywords}
                    />
                    <div className="manual-controls">
                        <input
                            type="text"
                            className="keyword-input"
                            value={manualKeywords}
                            onChange={e => setManualKeywords(e.target.value)}
                            placeholder="Or type comma-separated keywords here..."
                        />
                        <button
                            className="btn warning"
                            disabled={isSaving || !manualKeywords.trim()}
                            onClick={() => handleSave(manualKeywords)}
                        >
                            Save Custom Edit
                        </button>
                    </div>
                </div>
            </section>

        </div>
    );
};

export default RefinerPage;
