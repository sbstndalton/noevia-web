import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AuthGate } from './components/AuthGate';
import { startFitToViewport } from './fit-to-viewport';
import './styles/tokens.css';
import './styles/app.css';
import './styles/diary-tab.css';
import './styles/popup.css';
import './styles/shell.css';
import './styles/noevia.css';
import './styles/shell-v2.css';
import './styles/primitives.css';
import './styles/overlays.css';
import './styles/phone.css';
import './styles/materials.css';
import './styles/material3.css';

startFitToViewport();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthGate>
      <App />
    </AuthGate>
  </StrictMode>,
);
