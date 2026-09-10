import type { ChatMeta, Project } from './types';

export type ProjectSort = 'recent' | 'manual';
export interface SidebarOrder { sort: ProjectSort; order: string[] }
export function readSidebarOrder(raw: string | null): SidebarOrder {
  try {
    const value = JSON.parse(raw || '{}');
    return {sort:value?.sort === 'manual' ? 'manual' : 'recent',order:Array.isArray(value?.order) ? [...new Set<string>(value.order.filter((id: unknown): id is string=>typeof id === 'string'))].slice(0,10000) : []};
  } catch { return {sort:'recent',order:[]}; }
}
export function recentChats(chats: ChatMeta[]): ChatMeta[] {
  return chats.filter(c=>!c.archived).sort((a,b)=>b.updatedAt-a.updatedAt || a.id.localeCompare(b.id));
}
export function orderedProjects(projects: Project[], prefs: SidebarOrder): Project[] {
  const ranks = new Map(prefs.order.map((id,i)=>[id,i]));
  const activity = (p: Project) => p.chats.reduce((latest,c)=>Math.max(latest,c.updatedAt || 0),p.updatedAt || 0);
  return projects.filter(p=>!p.archived).sort((a,b)=>prefs.sort === 'manual'
    ? (ranks.get(a.id) ?? Infinity)-(ranks.get(b.id) ?? Infinity) || a.createdAt-b.createdAt || a.id.localeCompare(b.id)
    : activity(b)-activity(a) || a.id.localeCompare(b.id));
}
export function moveProject(order: string[], id: string, neighbor: string): string[] {
  const next = [...order]; const from=next.indexOf(id), to=next.indexOf(neighbor);
  if(from<0 || to<0)return next;
  [next[from],next[to]]=[next[to],next[from]];
  return next;
}
