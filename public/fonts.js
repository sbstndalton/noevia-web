// Web fonts load after first paint instead of blocking it: a stylesheet added
// from script is not render-blocking, and text shows in the fallback stack until
// Inter/JetBrains Mono arrive (display=swap). Inline onload is barred by the CSP.
(() => {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap';
  document.head.appendChild(link);
})();
