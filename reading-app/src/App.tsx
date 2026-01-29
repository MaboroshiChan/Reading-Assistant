import './App.css';
import React from 'react';

import { ReaderPage } from './components/ReaderPage';
import { ExampleArticle } from './components/Demo';
import messageService from './services/messageService.instance';

/**
 * Main application entry point component.
 * Performs server health check and renders the main article view.
 */
const App: React.FC = () => {
  const [pingStatus, setPingStatus] = React.useState<'pending' | 'ok' | 'error'>('pending');

  React.useEffect(() => {
    let cancelled = false;

    console.log(`ping`);

    const runPing = async () => {
      try {
        await messageService.ping();
        if (!cancelled) setPingStatus('ok');
      } catch (error) {
        console.error('Server ping failed', error);
        if (!cancelled) setPingStatus('error');
      }
    };

    void runPing();

    return () => {
      cancelled = true;
    };
  }, []);

  const [extractedData, setExtractedData] = React.useState<any>(null);

  React.useEffect(() => {
    // Check for extension data
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get("latestArticle", (result: { latestArticle?: any }) => {
        if (result.latestArticle) {
          console.log("Found extracted article:", result.latestArticle.title);
          setExtractedData(result.latestArticle);
          // Optional: Clear after reading?
          // chrome.storage.local.remove("latestArticle"); 
        }
      });
    }
  }, []);

  return (
    <div className="App">
      <div
        className={`connection-banner connection-banner--${pingStatus}`}
        role="status"
        aria-live="polite"
      >
        {pingStatus === 'pending' && 'Checking server…'}
        {pingStatus === 'ok' && 'Connected to analysis server.'}
        {pingStatus === 'error' && 'Unable to reach analysis server.'}
      </div>
      {extractedData ? (
        <ReaderPage articleData={extractedData} />
      ) : import.meta.env.DEV ? (
        <ExampleArticle />
      ) : (
        <div className="empty-state">
          <h2>Reading Assistant</h2>
          <p>No article loaded.</p>
          <p>Navigate to an article and click "✨ Analyze" to start.</p>
        </div>
      )}
    </div>
  );
};

export default App;
