import { useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { ChatMeta } from '../types';
import { backlinks, chatGraph, outgoingLinks, TAG_NODE_PREFIX } from '../chat-organise';
import { GraphFigure } from './diary-graph/LocalGraph';
import { ShellIcon } from './ShellIcon';
import { useT } from '../i18n';

/**
 * #741: the chat header's "Links" control. The count is how many chats link here; opening it shows
 * "Linked from", "Links to" and the one-hop graph with a hub per tag. Everything is computed from
 * the person's own chat lists (the workspace App already holds), so nothing is fetched and no other
 * account's chats can appear. A tag hub filters the sidebar by that tag.
 */
export function ChatLinks({ chatId, chats, onOpenChat }: {
  chatId: string;
  chats: readonly ChatMeta[];
  onOpenChat: (chatId: string, projectId: string | null) => void;
}): JSX.Element | null {
  const t = useT();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const chat = chats.find((c) => c.id === chatId);
  const linkedFrom = useMemo(() => backlinks(chatId, chats), [chatId, chats]);
  const linksTo = useMemo(() => outgoingLinks(chat, chats), [chat, chats]);
  const untitled = t('common.newChat');
  const graph = useMemo(() => (chat ? chatGraph(chat, chats, untitled) : null), [chat, chats, untitled]);
  useEffect(() => { setOpen(false); }, [chatId]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);
  const byId = new Map(chats.map((c) => [c.id, c]));
  const go = (id: string) => {
    if (id.startsWith(TAG_NODE_PREFIX)) { window.dispatchEvent(new CustomEvent('noevia:filter-tag', { detail: { tag: id.slice(TAG_NODE_PREFIX.length) } })); setOpen(false); return; }
    const target = byId.get(id);
    if (target) { setOpen(false); onOpenChat(target.id, target.projectId ?? null); }
  };
  const list = (items: ChatMeta[]) => <ul className="chat-links-list">
    {items.map((c) => <li key={c.id}><button type="button" className="chat-links-item" onClick={() => go(c.id)} title={c.title}>
      <ShellIcon name="chat" size={15}/><span>{c.title || untitled}</span>
    </button></li>)}
  </ul>;
  return (
    <div className="chat-links" ref={box} onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.preventDefault(); setOpen(false); trigger.current?.focus(); } }}>
      <button ref={trigger} type="button" className="icon-btn chat-links-trigger" aria-expanded={open} aria-controls={`chat-links-${chatId}`}
        aria-label={t('chat.links.open')} title={t('chat.links.open')} onClick={() => setOpen((v) => !v)}>
        <span aria-hidden="true">[[ ]]</span>{linkedFrom.length > 0 && <span className="chat-links-count">{linkedFrom.length}</span>}
      </button>
      {open && <section id={`chat-links-${chatId}`} className="chat-links-panel overlay" aria-label={t('chat.links.title')}>
        <h3>{t('chat.links.linkedFrom')}</h3>
        {linkedFrom.length ? list(linkedFrom) : <p className="chat-links-empty">{t('chat.links.none')}</p>}
        {linksTo.length > 0 && <><h3>{t('chat.links.linksTo')}</h3>{list(linksTo)}</>}
        {graph && graph.nodes.length > 1 && <figure className="chat-links-graph">
          <GraphFigure graph={graph} busy={false} labelled={graph.nodes.length <= 9} ariaLabel={t('chat.links.graph', { name: graph.nodes[0].label })}
            nodeLabel={(n) => n.relation === 'tag' ? t('chat.links.filterTag', { tag: n.label }) : t('chat.links.openChat', { name: n.label })}
            nodeTitle={(n) => n.label} onOpen={go} />
          {graph.hidden > 0 && <figcaption>{t('chat.links.moreNotShown', { count: graph.hidden })}</figcaption>}
        </figure>}
      </section>}
    </div>
  );
}
