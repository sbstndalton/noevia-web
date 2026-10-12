import type { DiaryTurn } from './diary-conversation';
import type { ToolCallView } from './types';
export interface DiaryRecord {
  id: string; kind?: 'capture' | 'preparation'; preparationId?: string;
  message: string; content: string; reasoning: string; startedAt: number;
  activity: string[]; state: string; decision?: string; truncated?: boolean;
  tools?: ToolCallView[];
  /** #1422: why a `failed` exchange failed (the server's wording) and when the person marked it reviewed. */
  error?: string; code?: string; acknowledgedAt?: number;
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
    // #1422: `failed` is a failure the server knows left nothing saved; `uncertain` is one it cannot vouch for.
    const failed = !preparationOnly && record.state === 'failed';
    // #1505: an uncertain exchange (dismissed or not) and a running one are not completed answers, so both turns
    // are marked and diaryHistory leaves them out.
    const held = { ...(!preparationOnly && record.state === 'uncertain' ? { uncertain: true } : {}), ...(!preparationOnly && record.state === 'running' ? { running: true } : {}) };
    const notice = preparationOnly
      ? record.state === 'running' ? 'Optional preparation is still active. No diary entry has been sent.'
        : 'Optional preparation history only. No diary entry was sent; tools are not replayed.'
      : record.state === 'running' ? 'Still processing on the server.'
        : failed ? record.error || 'Nothing was saved. You can resend.'
        : record.state === 'uncertain' ? record.acknowledgedAt ? 'Marked as reviewed. The save outcome was never confirmed.' : 'Save outcome is uncertain. Check the saved diary before sending again.'
          : record.decision === 'logged' || record.decision === 'ok' ? 'Diary entry saved.' : 'Conversation complete · no entry saved.';
    return [
      {role:'user',content:record.message,exchangeId:record.id,...(failed?{failed:true}:{}),...held},
      {role:'assistant',content:preparationOnly?'':record.content,...(failed?{failed:true}:{}),...held,
       reasoning:[prep?.reasoning,preparationOnly?'':record.reasoning].filter(Boolean).join('\n\n'),
       startedAt:prep?.startedAt || record.startedAt,tools,
       activity:[...(prep && !preparationOnly ? prep.activity : []),...record.activity,...(prep?.state==='uncertain' ? ['Interrupted external tool outcomes may be unknown. Check before repeating a write.'] : []),...(prep?.content ? ['Optional reference material (not a companion answer): '+prep.content.slice(0,12000)] : []),notice,...(prep?.truncated||record.truncated?['Recovered transcript was truncated.']:[])]},
    ] as DiaryTurn[];
  });
}
