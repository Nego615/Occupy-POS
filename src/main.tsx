import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import { App } from './App';
import { openRepository } from './lib/persist';
import { PosProvider } from './lib/store';

// Saved state is read once, before the first render, so the store starts
// from it rather than flashing seed data and swapping.
openRepository().then(({ repo, snapshot }) => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <PosProvider repo={repo} snapshot={snapshot}>
        <App />
      </PosProvider>
    </StrictMode>,
  );
});
