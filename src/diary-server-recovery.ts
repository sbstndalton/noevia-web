import type { DiaryTurn } from './diary-conversation';
import type { ToolCallView } from './types';
export interface DiaryRecord {
  id: string; kind?: 'capture' | 'preparation'; preparationId?: string;
  message: string; content: string; reasoning: string; startedAt: number;
  activity: string[]; state: string; decision?: string; truncated?: boolean;
  tools?: ToolCallView[];
}
/** Recovered tools are display history, never live approval controls or replay instructions. */
export function recoverDiaryTurns(records: DiaryRecord[]): DiaryTurn[] {
  const byId = new Map(records.map(record => [record.id, record]));
  const linked = new Set(records.filter(record => record.kind !== 'preparation').map(record => record.preparationId));
  return records.filter(record => record.kind !== 'preparation' || !linked.has(record.id)).flatMap(record => {
    const prior = record.preparationId ? byId.get(record.preparationId) : undefined;
    const prep = record.kind === 'preparation' ? record : prior?.kind === 'preparation' ? prior : undefined;
    const tools = (prep?.tools || []).filter(Boolean).map(tool => ({name:tool.name,args:tool.args,status:tool.status==='done'?'done':'denied'} as ToolCallView));
    const preparationOnly = record.kind === 'preparation';
    const notice = preparationOnly
      ? record.state === 'running' ? 'Optional preparation is still active. No diary entry has been sent.'
        : 'Optional preparation history only. No diary entry was sent; tools are not replayed.'
      : record.state === 'running' ? 'Still processing on the server.'
        : record.state === 'uncertain' ? 'Save outcome is uncertain. Check the saved diary before sending again.'
          : record.decision === 'logged' || record.decision === 'ok' ? 'Diary entry saved.' : 'Conversation complete · no entry saved.';
    return [
      {role:'user',content:record.message},
      {role:'assistant',content:preparationOnly?'':record.content,
       reasoning:[prep?.reasoning,preparationOnly?'':record.reasoning].filter(Boolean).join('\n\n'),
       startedAt:prep?.startedAt || record.startedAt,tools,
       activity:[...(prep && !preparationOnly ? prep.activity : []),...record.activity,...(prep?.state==='uncertain' ? ['Interrupted external tool outcomes may be unknown. Check before repeating a write.'] : []),...(prep?.content ? ['Optional reference material (not a companion answer): '+prep.content.slice(0,12000)] : []),notice,...(prep?.truncated||record.truncated?['Recovered transcript was truncated.']:[])]},
    ] as DiaryTurn[];
  });
}
