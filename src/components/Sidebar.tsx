import { SidebarLabel } from './SidebarLabel';
import { orderedProjects, recentChats, readSidebarOrder, moveProject } from '../sidebar-order';
import { normalizeRenameDraft } from '../rename-draft';
import { ProjectIcon } from './ProjectIdentity';
import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { AccountMenu } from './AccountMenu';
import { ModeSwitch } from './ModeSwitch';
import { ContextMenu, ConfirmDialog } from './ContextMenu';
import type { MenuItem } from './ContextMenu';
import { fetchToolboxes, fetchProfile } from '../api';
import type { McpStatus } from '../api';
import { notifyWorkspaceChanged } from './data/workspace-changed';
import { mcpFooterSummary } from '../mcp-summary';
import { ShellIcon } from './ShellIcon';
import type { ChatMeta, HealthState, Project } from '../types';
import { Logo } from './Icons';
import { useT } from '../i18n';
import type { MessageKey } from '../i18n';

// Code-mode destinations: the English name is the page's identity (onCodePage), the key its label.
const CODE_PAGES: [page: string, icon: string, key: MessageKey][] = [['Pull requests', 'git', 'sidebar.code.pullRequests'], ['Scheduled', 'clock', 'sidebar.code.scheduled'], ['Plugins', 'plugins', 'sidebar.code.plugins'], ['Explore', 'explore', 'sidebar.code.explore']];

interface SidebarProps {
  projects: Project[];
  chats: ChatMeta[];
  activeView: 'diary' | 'settings' | 'projects' | 'project' | 'chat' | 'preview' | 'models' | 'plugins' | 'archived';
  /** Archived chats (#232): the management view outside Settings. */
  onOpenArchived?: () => void;
  /** Code mode reuses this sidebar with the coding destinations in place of the chat lists. */
  mode?: 'chat' | 'code';
  codePage?: string;
  onCodePage?: (page: string) => void;
  onEnterChat?: () => void;
  onOpenPlugins: () => void;
  activeProjectId: string | null;
  activeChatId: string | null;
  onNewChat: () => void;
  onNewProjectChat: (projectId: string) => void;
  onEnterCode: () => void;
  onPreview?: (title: string) => void;
  /** features.previews: show the unbuilt Scheduled/Plugins/Explore and Code surfaces. */
  showPreviews?: boolean;
  onOpenProjects: () => void;
  onOpenProject: (id: string) => void;
  onOpenChat: (chatId: string, projectId: string | null) => void;
  onDeleteChat: (projectId: string | null, chatId: string) => void;
  onPatchChat: (projectId: string | null, chatId: string, patch: Partial<ChatMeta>) => void;
  /** Chats generating right now, so work continuing elsewhere stays visible. */
  streamingChats: Record<string, true>;
  onPatchProject: (id: string, patch: Partial<Project>) => void;
  onEditProject: (id: string) => void;
  onDeleteProject: (id: string) => void;
  onOpenDiary: () => void;
  diaryEnabled: boolean;
  onOpenSettings: (section?: 'general'|'usage'|'connectors', opener?: HTMLElement | null) => void;
  health: HealthState;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

// Scheduled, Plugins and Explore all route to PreviewPanel and do nothing.
// Advertising three features that dead-end is itself what makes the product
// feel unfinished, so they stay hidden unless an admin turns on features.previews
// (D5). The Code mode switch is gated the same way.


const RECENT_LIMIT = 15;

export function Sidebar({
  projects,
  chats,
  activeView,
  activeProjectId,
  activeChatId,
  onNewChat,
  onNewProjectChat,
  onEnterCode,
  mode = 'chat',
  codePage = 'New task',
  onCodePage,
  onEnterChat,
  onOpenPlugins,
  onOpenArchived,
  showPreviews = false,
  onOpenProjects,
  onOpenProject,
  onOpenChat,
  onDeleteChat,
  onPatchChat,
  streamingChats,
  onPatchProject,
  onEditProject,
  onDeleteProject,
  onOpenDiary,
  diaryEnabled,
  onOpenSettings,
  theme,
  onToggleTheme,
}: SidebarProps): JSX.Element {
  const t = useT();
  const [orderKey,setOrderKey]=useState<string | null>(null);
  const [order,setOrder]=useState(()=>readSidebarOrder(null));
  const [sorting,setSorting]=useState<{x:number;y:number} | null>(null);
  useEffect(()=>{
    let active=true;
    void fetchProfile().then(({user})=>{
      if(!active)return;
      const key=`cowork-sidebar-order:${user.id}`;
      try { setOrder(readSidebarOrder(localStorage.getItem(key))); } catch { /* Storage can be disabled. */ }
      setOrderKey(key);
    }).catch(()=>undefined);
    return ()=>{active=false;};
  },[]);
  useEffect(()=>{if(orderKey)try{localStorage.setItem(orderKey,JSON.stringify(order));}catch{/* Keep working without persistence. */}},[order,orderKey]);
  // Remembered on this device, as ChatGPT does: a reload keeps the rail collapsed.
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('noevia:sidebar-collapsed') === '1'; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem('noevia:sidebar-collapsed', collapsed ? '1' : '0'); } catch { /* per-device convenience only */ } }, [collapsed]);
  const [closedGroups, setClosedGroups] = useState<Record<string, boolean>>({});
  const [openProjects, setOpenProjects] = useState<Record<string, boolean>>({});
  const [searching, setSearching] = useState(false);
  // Recents stay bounded so a long history never pushes everything else away (#239).
  const [allRecents, setAllRecents] = useState(false);
  // ⌘K / Ctrl+K from anywhere (components/shortcuts): open the rail and its search field.
  useEffect(() => { const open = () => { setCollapsed(false); setExpanded(true); setSearching(true); }; window.addEventListener('noevia:open-search', open); return () => window.removeEventListener('noevia:open-search', open); }, []);
  // Below 600px the sidebar is gone entirely and opens as a drawer from one
  // toggle; `expanded` is that drawer. Focus is trapped while it is open and
  // handed back to the toggle when it closes.
  const [expanded, setExpanded] = useState(false);
  // layout-mode.js narrows a forced "mobile" preview by capping #root's width (noevia.css), not
  // the CSS viewport a desktop browser reports, so matchMedia alone misses it. Honour the forced
  // layout the same way the stylesheet does.
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && (window.matchMedia('(max-width: 519px)').matches || document.documentElement.dataset.layout === 'mobile'));
  const drawer = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const footer = useRef<HTMLDivElement>(null);
  // On a phone Diary sticks exactly one footer above the bottom edge. The footer's height
  // depends on what it holds (the MCP line, the account row), so measure it, not assume it.
  useEffect(() => {
    const el = footer.current, side = drawer.current;
    if (!el || !side || typeof ResizeObserver === 'undefined') return;
    // A closed drawer is display:none and measures 0; keep the last real height instead.
    const sync = () => { const h = Math.ceil(el.getBoundingClientRect().height); if (h > 0) side.style.setProperty('--side-foot-h', `${h}px`); };
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    sync();
    return () => observer.disconnect();
  }, [expanded]);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 519px)');
    const change = () => { const narrow = query.matches || document.documentElement.dataset.layout === 'mobile'; setMobile(narrow); if (!narrow) setExpanded(false); };
    query.addEventListener('change', change);
    window.addEventListener('noevia-layout-change', change);
    return () => { query.removeEventListener('change', change); window.removeEventListener('noevia-layout-change', change); };
  }, []);
  useEffect(() => {
    if (!mobile) { wasOpen.current = false; return; }
    if (expanded) {
      wasOpen.current = true;
      drawer.current?.querySelector<HTMLElement>('.side-expand')?.focus();
    } else if (wasOpen.current) {
      wasOpen.current = false;
      toggle.current?.focus();
    }
  }, [expanded, mobile]);
  // A software keyboard shrinks only the visual viewport; size the drawer to it so
  // nothing in it ends up behind the keyboard.
  useEffect(() => {
    const viewport = window.visualViewport, el = drawer.current;
    if (!mobile || !expanded || !viewport || !el) return;
    const fit = () => el.style.setProperty('--drawer-height', `${viewport.height}px`);
    fit(); viewport.addEventListener('resize', fit);
    return () => { viewport.removeEventListener('resize', fit); el.style.removeProperty('--drawer-height'); };
  }, [expanded, mobile]);
  // Any navigation, including views opened from outside the sidebar (Settings →
  // model manager), closes the drawer so it never covers what just opened.
  useEffect(() => { setExpanded(false); }, [activeView, activeChatId, activeProjectId, mode, codePage]);
  // A collapsed desktop rail names what is under the pointer, as ChatGPT's does: projects,
  // chats and destinations alike. One tooltip for the whole rail, placed beside the row.
  const [tip, setTip] = useState<{ text: string; x: number; y: number; warm?: boolean } | null>(null);
  useEffect(() => { if (!collapsed || mobile) setTip(null); }, [collapsed, mobile]);
  const showTip = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!collapsed || mobile) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>('button, a');
    if (!el || !drawer.current?.contains(el)) { setTip(null); return; }
    const text = el.dataset.tip || el.getAttribute('aria-label') || el.title || el.textContent?.trim() || '';
    if (!text) { setTip(null); return; }
    const r = el.getBoundingClientRect();
    setTip(prev => ({ text, x: r.right + 10, y: r.top + r.height / 2, warm: !!prev }));
  };
  const openSettings = (section?: 'general' | 'usage' | 'connectors', opener?: HTMLElement | null) => { setExpanded(false); onOpenSettings(section, opener); };
  const trapDrawer = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!mobile || !expanded) return;
    if (e.key === 'Escape' && !e.defaultPrevented) {
      if ((e.target as HTMLElement).closest('input, [role="menu"], dialog')) return;
      e.preventDefault(); setExpanded(false); return;
    }
    if (e.key !== 'Tab' || !drawer.current) return;
    const items = [...drawer.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(el => !el.hasAttribute('disabled') && el.getClientRects().length);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  const [query, setQuery] = useState('');
  const code = mode === 'code';
  // One menu model for both entity types, opened from a right-click or the
  // hamburger. Destructive choices route through `confirm` rather than an
  // inline two-step arm, so the subject is named before anything happens.
  const [menu, setMenu] = useState<
    { source?: 'nested' | 'list'; kind: 'project' | 'chat'; id: string; projectId: string | null; at: { x: number; y: number } } | null
  >(null);
  const [confirm, setConfirm] = useState<
    { title: string; body: string; confirmLabel: string; danger?: boolean; run: () => void } | null
  >(null);
  const [renameSource,setRenameSource]=useState<'nested' | 'list'>('list');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  // Where keyboard focus goes back to once a transient control (search, rename, the
  // options menu) closes, instead of falling to <body> (#355). Keyed by row id so more
  // than one row's Options button can be tracked at once; the search rail button is the
  // sensible default when search was opened from the ⌘K shortcut rather than a click.
  const optionsTriggers = useRef<Map<string, HTMLButtonElement>>(new Map());
  const railSearchButton = useRef<HTMLButtonElement>(null);
  const searchTrigger = useRef<HTMLButtonElement | null>(null);
  // Deferred to the next frame: the rename input still has an onBlur that commits, and
  // calling .focus() on another element synchronously would blur it (and thus commit)
  // before the input has actually unmounted — wrong for Escape, and a double commit for
  // Enter. By the next frame the row has already re-rendered without the input.
  const returnFocusToRow = (id: string) => {
    requestAnimationFrame(() => {
      const el = optionsTriggers.current.get(id);
      if (!el) return;
      // The row's own Options button is hidden (`display:none`, phone.css `@media(hover:hover)`)
      // until the row is hovered or something inside it is `:focus-visible` — by the time this
      // runs, the row is neither (the mouse is elsewhere and the rename input just unmounted), so
      // a genuinely display:none element cannot take DOM focus and `.focus()` silently no-ops,
      // dropping focus to <body> (#355, reopened: the rename Escape/Enter paths hit this exact
      // trap that the sidebar-search trigger — never inside a hover-hidden container — does not).
      // Force it visible for the single frame it takes to land focus; once focused, the CSS's own
      // `:has(:focus-visible)` rule keeps it visible for as long as it has focus, so the inline
      // override can be removed immediately after.
      const actions = el.closest<HTMLElement>('.row-actions');
      const restore = actions?.style.display;
      if (actions) actions.style.display = 'flex';
      el.focus();
      if (actions) { if (restore) actions.style.display = restore; else actions.style.removeProperty('display'); }
    });
  };
  // Quick-archive from the row action has no confirmation, so it needs a way back (#362):
  // an undo toast, matching the shape of the app's existing save-error toast.
  const [archiveUndo, setArchiveUndo] = useState<{ chat: ChatMeta; projectId: string | null; keyboardInitiated: boolean } | null>(null);
  const archiveUndoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => () => { if (archiveUndoTimer.current) clearTimeout(archiveUndoTimer.current); }, []);
  const armAutoDismiss = () => {
    if (archiveUndoTimer.current) clearTimeout(archiveUndoTimer.current);
    archiveUndoTimer.current = setTimeout(() => setArchiveUndo(null), 6000);
  };
  // #362 (reopened again, keyboard-specific): the toast used to rely on the ordinary forward-Tab
  // order to reach Undo, but it renders near the bottom of the sidebar, just above the footer —
  // and the archived row itself (where focus was, for a keyboard activation) is removed from the
  // DOM in that same instant, dropping focus to <body>. The next Tab press then restarts from the
  // top of the sidebar, nowhere near Undo, well before the 6s window runs out. For a
  // keyboard-initiated archive, put focus on Undo directly the moment the toast appears — the
  // next frame, matching this file's own returnFocusToRow idiom, so the just-removed row has
  // actually unmounted first — and pause the auto-dismiss for as long as the toast holds focus,
  // so a user who is still deciding is never timed out from under them.
  useEffect(() => {
    if (!archiveUndo?.keyboardInitiated) return;
    const frame = requestAnimationFrame(() => undoButtonRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [archiveUndo]);
  // onPatchChat (App.tsx) saves and updates this component's own `chats` prop once the save
  // lands, but it does not broadcast noevia:workspace-changed the way the Archived page's
  // Restore does — so a second, already-mounted workspace reader (Settings → Your data &
  // privacy's archived count, or the Archived page in another tab) never learns the toast's
  // Undo happened (#362, reopened). Watch `chats` for the patch actually landing (not merely
  // requested) and notify then, once, so nothing races ahead of the save it is reporting.
  const pendingNotify = useRef<{ id: string; archived: boolean } | null>(null);
  useEffect(() => {
    const pending = pendingNotify.current;
    if (!pending) return;
    const chat = chats.find((c) => c.id === pending.id);
    if (chat && !!chat.archived === pending.archived) {
      pendingNotify.current = null;
      notifyWorkspaceChanged();
    }
  }, [chats]);
  const archiveChat = (c: ChatMeta, projectId: string | null, keyboardInitiated: boolean) => {
    pendingNotify.current = { id: c.id, archived: true };
    onPatchChat(projectId, c.id, { archived: true });
    setArchiveUndo({ chat: c, projectId, keyboardInitiated });
    armAutoDismiss();
  };
  const undoArchive = () => {
    if (!archiveUndo) return;
    if (archiveUndoTimer.current) clearTimeout(archiveUndoTimer.current);
    pendingNotify.current = { id: archiveUndo.chat.id, archived: false };
    onPatchChat(archiveUndo.projectId, archiveUndo.chat.id, { archived: false });
    setArchiveUndo(null);
  };
  // The hover card lives in .spaces, which is overflow-y:auto — an absolutely
  // positioned card is clipped by it, which made the card useless. Render it
  // fixed at a measured point instead, after a delay so it does not flash
  // while the pointer is only passing over the row.
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openHover = (id: string, el: HTMLElement) => {
    if (collapsed) return;
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => {
      const r = el.getBoundingClientRect();
      setHover({ id, x: r.right + 10, y: r.top });
    }, 450);
  };
  const closeHover = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setHover(null);
  };
  useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }, []);
  // MCP reachability. Nothing surfaced this before; a configured server that
  // has failed to discover its tools should say so rather than look healthy.
  const [mcp, setMcp] = useState<McpStatus | null>(null);

  useEffect(() => {
    void fetchToolboxes().then((r) => setMcp(r.mcp ?? null)).catch(() => undefined);
  }, []);

  const startRename = (id: string, current: string, source: 'nested' | 'list' = 'list') => {
    setRenameSource(source);
    setRenamingId(id);
    // A title can carry embedded newlines (from the first line of a multi-line message); the
    // single-line input drops them silently, gluing the words on either side together (#360).
    setRenameDraft(normalizeRenameDraft(current));
  };

  const commitRename = (projectId: string | null, isChat: boolean) => {
    const name = renameDraft.trim();
    if (renamingId && name) {
      if (isChat) onPatchChat(projectId, renamingId, { title: name });
      else onPatchProject(renamingId, { name });
    }
    setRenamingId(null);
  };

  const sortedProjects = orderedProjects(projects,order);
  // The chat sidebar lists projects enabled for Chat; the Projects page lists all of them.
  const visibleProjects = sortedProjects.filter(p=>(!p.modes?.length || p.modes.includes('chat')) && p.name.toLowerCase().includes(query.toLowerCase()));
  const visibleChats = recentChats(chats).filter(c=>(c.title || '').toLowerCase().includes(query.toLowerCase()));
  const manualItems = (p: Project): MenuItem[] => {
    if(order.sort!=='manual')return [];
    const peers=sortedProjects.filter(x=>!!x.pinned===!!p.pinned);
    const index=peers.findIndex(x=>x.id===p.id);
    return [-1,1].flatMap(direction=>{
      const neighbor=peers[index+direction];
      return neighbor ? [{label:direction<0?t('sidebar.moveUp'):t('sidebar.moveDown'),icon:<ShellIcon name={direction<0?'arrow-up':'arrow-down'}/>,onSelect:()=>setOrder(prev=>({...prev,order:moveProject(sortedProjects.map(x=>x.id),p.id,neighbor.id)}))}] : [];
    });
  };

  const projectMenu = (p: Project): MenuItem[] => [
    ...manualItems(p),
    { label: t('sidebar.rename'), icon:<ShellIcon name="edit"/>, onSelect: () => startRename(p.id, p.name) },
    { label: t('sidebar.projectSettings'), icon:<ShellIcon name="settings"/>, onSelect: () => onEditProject(p.id) },
    { icon:<ShellIcon name="pin"/>, separator:true, label: p.pinned ? t('sidebar.unpin') : t('sidebar.pin'), onSelect: () => onPatchProject(p.id, { pinned: !p.pinned }) },
    {
      label: t('sidebar.archive'),
      icon:<ShellIcon name="archive"/>,
      onSelect: () =>
        setConfirm({
          title: t('sidebar.confirmArchiveProjectTitle', { name: p.name }),
          body: t('sidebar.confirmArchiveProjectBody'),
          confirmLabel: t('sidebar.archive'),
          run: () => onPatchProject(p.id, { archived: true }),
        }),
    },
    {
      label: t('sidebar.deleteProject'),
      icon:<ShellIcon name="trash"/>,
      danger: true,
      onSelect: () =>
        setConfirm({
          title: t('sidebar.confirmDeleteProjectTitle', { name: p.name }),
          body: t('sidebar.confirmDeleteProjectBody', { chats: t.plural('sidebar.count.chats', (p.chats || []).length), files: t.plural('sidebar.count.files', (p.files || []).length) }),
          confirmLabel: t('sidebar.deleteProject'),
          danger: true,
          run: () => onDeleteProject(p.id),
        }),
    },
  ];

  const chatMenu = (c: ChatMeta): MenuItem[] => [
    { label: c.pinned ? t('sidebar.unpin') : t('sidebar.pin'), icon:<ShellIcon name="pin"/>, onSelect: () => onPatchChat(c.projectId ?? null, c.id, { pinned: !c.pinned }) },
    { label: t('sidebar.rename'), icon:<ShellIcon name="edit"/>, onSelect: () => startRename(c.id, c.title || '', menu?.source) },
    {
      label: t('sidebar.archive'),
      icon:<ShellIcon name="archive"/>,
      onSelect: () => onPatchChat(c.projectId ?? null, c.id, { archived: true }),
    },
    {
      label: t('sidebar.deleteChat'),
      icon:<ShellIcon name="trash"/>,
      danger: true,
      onSelect: () =>
        setConfirm({
          title: t('sidebar.confirmDeleteChatTitle', { name: c.title || t('sidebar.thisChat') }),
          body: t('sidebar.confirmDeleteChatBody'),
          confirmLabel: t('sidebar.deleteChat'),
          danger: true,
          run: () => onDeleteChat(c.projectId ?? null, c.id),
        }),
    },
  ];
  const chatActions = (c: ChatMeta, projectId: string | null, source: 'nested' | 'list' = 'list') => <div className="row-actions">
    <button className="row-action" aria-label={t(c.pinned ? 'sidebar.unpinNamed' : 'sidebar.pinNamed', { name: c.title || t('sidebar.chatFallback') })} title={c.pinned ? t('sidebar.unpinChat') : t('sidebar.pinChat')} aria-pressed={!!c.pinned} onClick={()=>onPatchChat(projectId,c.id,{pinned:!c.pinned})}><ShellIcon name="pin" size={18}/></button>
    <button className="row-action" aria-label={t('sidebar.archiveNamed', { name: c.title || t('sidebar.chatFallback') })} title={t('sidebar.archiveChat')} onClick={(e)=>archiveChat(c,projectId,e.detail===0)}><ShellIcon name="archive" size={18}/></button>
    <button ref={el=>{if(el)optionsTriggers.current.set(c.id,el);else optionsTriggers.current.delete(c.id);}} className="row-action" aria-label={t('sidebar.optionsFor', { name: c.title || t('sidebar.chatFallback') })} aria-haspopup="menu" aria-expanded={menu?.kind==='chat' && menu.id===c.id} onClick={e=>{const r=e.currentTarget.getBoundingClientRect();setMenu({kind:'chat',id:c.id,projectId,source,at:{x:r.left,y:r.bottom+4}});}}><ShellIcon name="more" size={20}/></button>
  </div>;
  const projectNames = new Map(projects.map((p) => [p.id, p.name]));
  const renderChat = (c: ChatMeta) => (
              <div
                key={c.id}
                className={`chat-row${activeChatId === c.id && activeView === 'chat' ? ' is-active' : ''}`}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ kind: 'chat', id: c.id, projectId: c.projectId ?? null, at: { x: e.clientX, y: e.clientY } });
                }}
              >
                {renamingId === c.id && renameSource==='list' ? (
                  <input
                    className="proj-rename-input"
                    aria-label={t('sidebar.renameChatLabel')}
                    value={renameDraft}
                    autoFocus
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onBlur={() => commitRename(c.projectId ?? null, true)}
                    onKeyDown={(e) => {
                      // Enter/Escape are keyboard-driven, so the row's Options button (the
                      // trigger that opened Rename) is the sensible place for focus to land
                      // (#355); a blur from clicking elsewhere leaves focus where the click put it.
                      if (e.key === 'Enter') { commitRename(c.projectId ?? null, true); returnFocusToRow(c.id); }
                      if (e.key === 'Escape') { setRenamingId(null); returnFocusToRow(c.id); }
                    }}
                  />
                ) : (
                  <button
                    className="nav-item"
                    onClick={() => onOpenChat(c.id, c.projectId ?? null)}
                    title={c.title}
                    data-tip={c.title || t('common.newChat')}
                  >
                    <ShellIcon name={c.pinned ? 'pin' : 'chat'} size={17}/>
                    <SidebarLabel text={c.title || t('common.newChat')}/>
                    {/* Project context tells identically titled chats apart (#239). */}
                    {c.projectId && projectNames.get(c.projectId) && <span className="chat-row-context">{projectNames.get(c.projectId)}</span>}
                    {streamingChats[c.id] && (
                      <span className="chat-working" aria-label={t('sidebar.stillGenerating')}><i /><i /><i /></span>
                    )}
                  </button>
                )}
                {chatActions(c,c.projectId ?? null)}
              </div>
  );
  return (<>
    <button ref={toggle} className="shell-icon-button nav-drawer-toggle" aria-label={t('sidebar.openNavigation')} aria-expanded={expanded} aria-controls="app-navigation" onClick={() => setExpanded(true)}><ShellIcon name="panel"/></button>
    {mobile && expanded && <div className="nav-drawer-backdrop" aria-hidden="true" onClick={() => setExpanded(false)}/>}
    <div
      ref={drawer}
      id="app-navigation"
      role={mobile && expanded ? 'dialog' : undefined}
      aria-modal={mobile && expanded ? true : undefined}
      aria-label={mobile && expanded ? t('sidebar.navigation') : undefined}
      onKeyDown={trapDrawer}
      onMouseOver={showTip}
      onMouseLeave={() => setTip(null)}
      data-mode={mode}
      className={`sidebar pane${activeView === 'diary' ? ' diary-sidebar' : ''}${expanded ? ' is-expanded' : ''}${collapsed ? ' is-collapsed' : ''}`}
      onClick={(e) => {
        // Any navigation collapses the rail again, so the overlay never
        // stays over the thing it just navigated to.
        if (expanded && (e.target as HTMLElement).closest('.nav-item')) setExpanded(false);
        // As in ChatGPT, the empty part of the collapsed rail is itself the expand target.
        if (collapsed && !mobile && !(e.target as HTMLElement).closest('button, a, input')) setCollapsed(false);
      }}
    >
      <div className="shell-sidebar-head"><div className="side-logo"><Logo/><span>noevia</span></div><div className="side-head-actions"><button className="shell-icon-button side-expand" aria-label={mobile ? t('sidebar.closeNavigation') : collapsed ? t('sidebar.expandNavigation') : t('sidebar.collapseNavigation')} aria-expanded={mobile ? expanded : !collapsed} onClick={() => {if(mobile)setExpanded(false);else setCollapsed(!collapsed);}}><ShellIcon name={mobile ? "close" : "panel"}/></button></div>{/* Like Claude's: a small icon-only Chat/Code switch at the end of the header row. Switching
          closes the phone drawer, so the new mode is what you see. */}{showPreviews && <ModeSwitch compact mode={mode} onCode={() => { setExpanded(false); onEnterCode(); }} onChat={() => { setExpanded(false); onEnterChat?.(); }}/>}</div>
      {/* On a phone the drawer always shows the search field under its header, as Claude's does. */}{(searching || (mobile && expanded))&&<input className="shell-search" autoFocus={searching} aria-label={t('sidebar.search')} placeholder={t('sidebar.searchPlaceholder')} value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Escape'){setSearching(false);setQuery('');(searchTrigger.current||railSearchButton.current)?.focus();}}}/>}

      {/* Floats over the list as it scrolls, as ChatGPT's New chat does. */}
      <div className="side-new">
      <button className="new-chat-btn glass" onClick={()=>{if(code)onCodePage?.('New task');else onNewChat();setExpanded(false);}} title={code?t('sidebar.newTask'):t('common.newChat')} data-tip={code?t('sidebar.newTask'):t('common.newChat')}>
        <ShellIcon name="compose" size={17}/>
        <span>{code?t('sidebar.newTask'):t('common.newChat')}</span>
      </button>
      </div>

      {code ? <nav className="side-nav" aria-label={t('sidebar.codingNavigation')}>
        {CODE_PAGES.map(([page,icon,key])=><button key={page} className={`nav-item${codePage===page?' is-active':''}`} aria-label={t(key)} aria-current={codePage===page?'page':undefined} onClick={()=>onCodePage?.(page)}>
          <ShellIcon name={icon} size={17}/>
          <span className="nav-name">{t(key)}</span>
        </button>)}
      </nav> : <nav className="side-nav" aria-label={t('sidebar.primary')}>
        <button
          className={`nav-item${activeView === 'projects' ? ' is-active' : ''}`}
          aria-label={t('sidebar.projects')}
          aria-current={activeView === 'projects' ? 'page' : undefined}
          onClick={onOpenProjects}
        >
          <ShellIcon name="folder" size={17}/>
          <span className="nav-name">{t('sidebar.projects')}</span>
        </button>
        {/* Customise (formerly Plugins, #238) stays with the destinations. Diary is a permanent space, so it lives in the
            bottom bar beside Search: always one tap away, never in the way (user review). */}
        <button className={`nav-item${activeView === 'plugins' ? ' is-active' : ''}`} aria-label={t('sidebar.customise')} aria-current={activeView === 'plugins' ? 'page' : undefined} onClick={onOpenPlugins}>
          <ShellIcon name="plugins" size={17}/>
          <span className="nav-name">{t('sidebar.customise')}</span>
        </button>
      </nav>}

      <div className="rail-tools"><button ref={railSearchButton} className="shell-icon-button" aria-label={t('sidebar.search')} onClick={e=>{setCollapsed(false);setExpanded(true);setSearching(true);searchTrigger.current=e.currentTarget;}}><ShellIcon name="search"/></button><button className="shell-icon-button" aria-label={t('sidebar.showPinned')} onClick={()=>{setCollapsed(false);setExpanded(true);setClosedGroups(g=>({...g,Pinned:false}));}}><ShellIcon name="pin"/></button></div>
      {code ? <div className="sidebar-history coding-history">
        <div className="spaces side-scroll"><div className="sidebar-section-head"><span className="section-label">{t('sidebar.codingProjects')}</span></div><p className="side-hint">{t('sidebar.codingProjectsEmpty')}</p></div>
        <div className="spaces side-scroll"><div className="sidebar-section-head"><span className="section-label">{t('sidebar.tasks')}</span></div><p className="side-hint">{t('sidebar.tasksEmpty')}</p></div>
      </div> : <div className="sidebar-history">
      {['Pinned','Projects'].map(group => {
        const entries = visibleProjects.filter(p=>group==='Pinned'?p.pinned:!p.pinned);
        if(group==='Pinned' && !entries.length && !visibleChats.some(c=>c.pinned))return null;
        return <div className={`spaces side-scroll side-scroll-${group.toLowerCase()}`} key={group}>
          <div className="sidebar-section-head"><button className="section-label section-toggle" aria-label={t('sidebar.sectionNamed', { name: group==='Projects' ? t('sidebar.projects') : t('sidebar.pinned') })} aria-expanded={!closedGroups[group]} onClick={()=>setClosedGroups(g=>({...g,[group]:!g[group]}))}>{group==='Projects' ? t('sidebar.yourProjects') : t('sidebar.pinned')}</button>{group==='Projects' && <button className="row-action section-options" aria-label={t('sidebar.projectOrdering')} aria-haspopup="menu" aria-expanded={!!sorting} onClick={e=>{const r=e.currentTarget.getBoundingClientRect();setSorting({x:r.left,y:r.bottom+4});}}><ShellIcon name="more" size={20}/></button>}</div>
          {group==='Pinned' && (!closedGroups[group] || query) && visibleChats.filter(c=>c.pinned).map(renderChat)}
          {(!closedGroups[group] || query) && entries.map(p=><div className="project-branch" key={p.id}>
            <div className={`proj-row${activeProjectId===p.id && activeView!=='projects'?' is-active':''}`} onContextMenu={e=>{e.preventDefault();setMenu({kind:'project',id:p.id,projectId:null,at:{x:e.clientX,y:e.clientY}});}}>
              {renamingId===p.id ? <input className="proj-rename-input" aria-label={t('sidebar.projectName')} value={renameDraft} autoFocus onFocus={e=>e.currentTarget.select()} onChange={e=>setRenameDraft(e.target.value)} onBlur={()=>commitRename(null,false)} onKeyDown={e=>{if(e.key==='Enter'){commitRename(null,false);returnFocusToRow(p.id);}if(e.key==='Escape'){setRenamingId(null);returnFocusToRow(p.id);}}}/> : <><button className="project-expand" data-tip={p.name} aria-label={t(openProjects[p.id]?'sidebar.collapseChatsIn':'sidebar.expandChatsIn', { name: p.name })} aria-expanded={!!openProjects[p.id]} onClick={()=>{closeHover();setOpenProjects(prev=>({...prev,[p.id]:!prev[p.id]}));}}><ProjectIcon project={p} size={18}/></button><button className="project-disclosure" aria-label={t('sidebar.openNamed', { name: p.name })} onMouseEnter={e=>openHover(p.id,e.currentTarget)} onMouseLeave={closeHover} onClick={()=>{closeHover();setOpenProjects(prev=>({...prev,[p.id]:true}));onOpenProject(p.id);setExpanded(false);}}><SidebarLabel text={p.name}/></button></>}

              <div className="row-actions">
                <button ref={el=>{if(el)optionsTriggers.current.set(p.id,el);else optionsTriggers.current.delete(p.id);}} className="row-action" aria-label={t('sidebar.optionsFor', { name: p.name })} aria-haspopup="menu" aria-expanded={menu?.kind==='project' && menu.id===p.id} onClick={e=>{closeHover();const r=e.currentTarget.getBoundingClientRect();setMenu({kind:'project',id:p.id,projectId:null,at:{x:r.left,y:r.bottom+4}});}}><ShellIcon name="more" size={22}/></button>
                <button className="row-action" aria-label={t('sidebar.newChatIn', { name: p.name })} title={t('sidebar.newChatInProject')} onClick={()=>{onNewProjectChat(p.id);setExpanded(false);}}><ShellIcon name="compose" size={20}/></button>
              </div>
            </div>
            {openProjects[p.id] && <div className="project-children">
              {(p.chats || []).filter(c=>!c.archived && !c.pinned).sort((a,b)=>b.updatedAt-a.updatedAt).map(c=><div className="chat-row" key={c.id}>
                {renamingId===c.id && renameSource==='nested' ? <input className="proj-rename-input" aria-label={t('sidebar.renameChatLabel')} value={renameDraft} autoFocus onChange={e=>setRenameDraft(e.target.value)} onBlur={()=>commitRename(p.id,true)} onKeyDown={e=>{if(e.key==='Enter'){commitRename(p.id,true);returnFocusToRow(c.id);}if(e.key==='Escape'){setRenamingId(null);returnFocusToRow(c.id);}}}/> : <button className={`nested-chat-title${activeChatId===c.id?' is-active':''}`} onClick={()=>{onOpenChat(c.id,p.id);setExpanded(false);}}><SidebarLabel text={c.title || t('common.newChat')}/>{streamingChats[c.id] && <span aria-label={t('sidebar.stillGenerating')}> ···</span>}</button>}
                {chatActions(c,p.id,'nested')}
              </div>)}
              {!p.chats?.some(c=>!c.archived && !c.pinned) && <p>{p.chats?.some(c=>!c.archived && c.pinned)?t('sidebar.chatsPinnedAbove'):t('sidebar.noChatsYet')}</p>}
            </div>}
          </div>)}
          {!entries.length && group==='Projects' && <p className="side-hint">{query?t('sidebar.noMatchingProjects'):t('sidebar.createProjectHint')}</p>}
        </div>;
      })}

      {visibleChats.some(c=>!c.pinned) && (
        <>
          <div className="divider" />
          <div className="spaces side-scroll side-scroll-chats">
            <button className="section-label section-toggle" aria-expanded={!closedGroups.Chats} onClick={()=>setClosedGroups(g=>({...g,Chats:!g.Chats}))}>{t('sidebar.recentChats')}</button>
            {(!closedGroups.Chats || query) && (() => {
              const recent = visibleChats.filter(c=>!c.pinned);
              const bounded = query || allRecents ? recent : recent.slice(0, RECENT_LIMIT);
              return <div className="recent-children">{bounded.map(renderChat)}
                {!query && recent.length > RECENT_LIMIT && <button className="side-more" aria-expanded={allRecents} onClick={()=>setAllRecents(v=>!v)}>{allRecents ? t('sidebar.showFewer') : t('sidebar.viewAll', { count: recent.length })}</button>}
              </div>;
            })()}

          </div>
        </>
      )}

      {onOpenArchived && <button className={`side-more side-archived${activeView === 'archived' ? ' is-active' : ''}`} aria-current={activeView === 'archived' ? 'page' : undefined} onClick={()=>{onOpenArchived();setExpanded(false);}}><ShellIcon name="archive" size={16}/><span>{t('sidebar.archivedChats')}</span></button>}
      </div>}

      {tip && <div className={`rail-tip${tip.warm ? ' is-warm' : ''}`} role="tooltip" style={{ top: tip.y, left: tip.x }}>{tip.text}</div>}
      {hover && (() => {
        const p = projects.find((x) => x.id === hover.id);
        if (!p) return null;
        const files = p.files || [];
        return (
          <div className="row-card" role="tooltip" style={{ top: hover.y, left: hover.x }}>
            <strong>{p.name}</strong>
            {p.goal && <em>{p.goal}</em>}
            <span>{t.plural('sidebar.count.chats', (p.chats || []).length)} · {t.plural('sidebar.count.sources', files.length)}</span>
            {files.slice(0, 4).map((f) => <span key={f.name} className="row-card-src">{f.name}</span>)}
            {files.length > 4 && <span className="row-card-src">{t('sidebar.moreSources', { count: files.length - 4 })}</span>}
            {files.length === 0 && <span className="row-card-src">{t('sidebar.noSources')}</span>}
          </div>
        );
      })()}
      {sorting && <ContextMenu at={sorting} onClose={()=>setSorting(null)} items={[
        {label:t('sidebar.lastUsed'),selected:order.sort==='recent',onSelect:()=>setOrder(prev=>({...prev,sort:'recent'}))},
        {label:t('sidebar.manualOrder'),selected:order.sort==='manual',onSelect:()=>setOrder(prev=>({...prev,sort:'manual',order:prev.order.length ? prev.order : sortedProjects.map(p=>p.id)}))},
      ]}/>}
      {menu && (
        <ContextMenu
          at={menu.at}
          onClose={() => setMenu(null)}
          items={
            menu.kind === 'project'
              ? (() => { const p = projects.find((x) => x.id === menu.id); return p ? projectMenu(p) : []; })()
              : (() => { const c = chats.find((x) => x.id === menu.id) || projects.find(p=>p.id===menu.projectId)?.chats.find(c=>c.id===menu.id); return c ? chatMenu({...c,projectId:menu.projectId}) : []; })()
          }
        />
      )}
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          body={confirm.body}
          confirmLabel={confirm.confirmLabel}
          danger={confirm.danger}
          onCancel={() => setConfirm(null)}
          onConfirm={() => { const run = confirm.run; setConfirm(null); run(); }}
        />
      )}

      {/* Quick-archive has no confirmation, so it needs a way back (#362): a reversible-action
          toast, not an alert — same shape as the app's save-error toast. */}
      {archiveUndo && (
        <div className="save-error is-notice" role="status"
          onFocus={() => { if (archiveUndoTimer.current) { clearTimeout(archiveUndoTimer.current); archiveUndoTimer.current = null; } }}
          onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) armAutoDismiss(); }}>
          <span>{t('sidebar.chatArchivedToast')}</span>
          <button ref={undoButtonRef} className="btn btn-secondary" onClick={undoArchive}>{t('common.undo')}</button>
          <button onClick={() => setArchiveUndo(null)} aria-label={t('common.dismiss')}><ShellIcon name="close" size={16}/></button>
        </div>
      )}

      <div className="side-footer" ref={footer}>{mcp?.configured && (() => {
        const summary = mcpFooterSummary(mcp, t);
        return (
          <div
            className={`mcp-row${summary.degraded ? ' is-degraded' : ''}`}
            title={summary.title}
          >
            <span className="status-dot" style={{ background: summary.danger ? 'var(--status-danger)' : summary.degraded ? 'var(--status-warning)' : 'var(--status-good)' }} />
            <span className="status-text">{summary.label}</span>
          </div>
        );
      })()}{/* Inference status lives in the workspace status pill and the chat banner; one place is enough. */}<div className="side-footer-row"><AccountMenu onSettings={openSettings} theme={theme} onToggleTheme={onToggleTheme}/>{diaryEnabled && <button className={`shell-icon-button side-footer-diary${activeView === 'diary' ? ' is-active' : ''}`} aria-label={t('sidebar.diary')} title={t('sidebar.diary')} aria-current={activeView === 'diary' ? 'page' : undefined} onClick={() => { onOpenDiary(); setExpanded(false); }}><ShellIcon name="diary"/></button>}{/* Search sits beside the account, as in Claude. */}<button className="shell-icon-button side-footer-search" aria-label={t('sidebar.search')} aria-expanded={searching} onClick={e=>{setCollapsed(false);setExpanded(true);setSearching(!searching);if(searching){setQuery('');}else{searchTrigger.current=e.currentTarget;}}}><ShellIcon name="search"/></button></div></div>
    </div>
  </>);
}
