import './App.css';
import React from 'react';
import { ExampleArticle } from './components/ArticleSkeleton';
import messageService from './services/messageService.instance';
// import {SentenceCardComponent} from './components/InfoComponent';

const App: React.FC = () => {
  const [pingStatus, setPingStatus] = React.useState<'pending' | 'ok' | 'error'>('pending');

  React.useEffect(() => {
    let cancelled = false;

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
      <ExampleArticle />
    </div>
  );
};

export default App;
