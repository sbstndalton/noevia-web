import { startLogoAppearance } from './logo-appearance';
import './styles/logo-calendar.css';
import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AuthGate } from './components/AuthGate';
import { startFitToViewport } from './fit-to-viewport';
import { checkStaleShell } from './stale-shell-guard';
import { startInterfaceLanguage } from './i18n';
import { startMotion } from './motion';
import './styles/system/fonts.css';
import './styles/system/tokens.css';
import './styles/system/themes.css';
import './styles/system/motion.css';
import './styles/app.css';
import './styles/diary-tab.css';
import './styles/popup.css';
import './styles/shell.css';
import './styles/noevia.css';
import './styles/shell-v2.css';
import './styles/primitives.css';
import './styles/overlays.css';
import './styles/phone.css';
// #951: the design system's component layer; decides how every shared surface looks.
import './styles/system/components.css';
// #510: space-driven declutter tiers (layout only); loads last.
import './styles/space-tiers.css';

startLogoAppearance();
startFitToViewport();
startInterfaceLanguage();
startMotion();
void checkStaleShell();

// #555: /device is where a signed-in person approves a native app's sign-in. It replaces the app
// (still behind AuthGate) and is its own chunk. The server answers /device with 404 while the
// nativeClientAuth feature is off, so this only renders when it is on. The path and code are read
// once here, because AuthGate rewrites the address after a sign-in.
const DeviceApproval = lazy(() => import('./components/device/DeviceApproval'));
const devicePage = /^\/device\/?$/.test(window.location.pathname);
const deviceCode = devicePage ? new URLSearchParams(window.location.search).get('code') ?? '' : '';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthGate>
      {devicePage ? <Suspense fallback={null}><DeviceApproval initialCode={deviceCode} /></Suspense> : <App />}
    </AuthGate>
  </StrictMode>,
);
