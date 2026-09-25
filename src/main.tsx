import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AuthGate } from './components/AuthGate';
import { startFitToViewport } from './fit-to-viewport';
import { checkStaleShell } from './stale-shell-guard';
import { startInterfaceLanguage } from './i18n';
import { startHoverPull } from './hover-pull';
import './styles/tokens.css';
import './styles/themes.css';
import './styles/motion.css';
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
import './styles/theme-contemporary.css';
import './styles/system.css';
import './styles/families.css';

startFitToViewport();
startInterfaceLanguage();
startHoverPull();
void checkStaleShell();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthGate>
      <App />
    </AuthGate>
  </StrictMode>,
);
