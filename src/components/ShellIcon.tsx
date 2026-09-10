export function ShellIcon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, string> = {
    archive: 'M3 4h18v4H3zM5 8v12h14V8M10 12h4',
    compose: 'M12 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-7M16 3l5 5-10 10H6v-5z',
    file: 'M5 3h9l5 5v13H5zM14 3v5h5M8 12h8M8 16h6',
    edit: 'm4 15 12-12 5 5-12 12-6 1zM13 6l5 5',
    book: 'M4 3h16v18H4V3zm4 0v18M12 7h4M12 11h4',
    pin: 'm9 3 6 0v5l3 4v2H6v-2l3-4V3zm3 11v7',
    chat: 'M4 4h16v12H9l-5 4V4z', code: 'm8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18',
    new: 'M12 5v14M5 12h14', search: 'M16 16l5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
    clock: 'M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
    plugins: 'M8 3v4H4v5h4v4h5v-4h4V7h-4V3H8z', explore: 'M5 12h.01M12 12h.01M19 12h.01',
    settings: 'M4 7h16M4 17h16M8 4v6M16 14v6', folder: 'M3 5h7l2 3h9v12H3V5z',
    arrow: 'm10 5-7 7 7 7M3 12h18', close: 'm6 6 12 12M6 18 12 6',
    grid: 'M3 3h7v7H3V3zm11 0h7v7h-7V3zM3 14h7v7H3v-7zm11 0h7v7h-7v-7z',
    git: 'M7 5v14m10-14v6c0 3-10 1-10 5M9 4a2 2 0 1 1-4 0 2 2 0 0 1 4 0m10 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0M9 20a2 2 0 1 1-4 0 2 2 0 0 1 4 0',
    panel: 'M3 4h18v16H3V4zm6 0v16', user:'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M4 21v-3c0-6 16-6 16 0v3',
    down:'m6 9 6 6 6-6', sun:'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0',
  };
  if (name === 'more') return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">{[5,12,19].map(x=><circle key={x} cx={x} cy="12" r="1.8"/>)}</svg>;
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.settings} /></svg>;
}
