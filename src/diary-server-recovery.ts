import type { DiaryTurn } from './diary-conversation';
import type { ToolCallView } from './types';
export interface DiaryRecord {
  id: string; kind?: 'capture' | 'preparation'; preparationId?: string;
  message: string; content: string; reasoning: string; startedAt: number;
  activity: string[]; state: string; decision?: string; truncated?: boolean;
  tools?: ToolCallView[];
  /** #1422: why a `failed` exchange failed (the server's wording) and when the person marked it reviewed.
   *  #96: `code` and `reason` are the same fields the live stream error carried (`reason` only on `modelFailed`). */
  error?: string; code?: string; reason?: string; acknowledgedAt?: number;
}
/** A recovered failed exchange in the shape of the live stream error, for the `diary-errors.ts` mapping. */
export type RecoveredFailure = { message: string; code: string; reason?: string; saved: false };
/** Codes whose live sentence needs a detail the stored row does not keep (the model's name): the row's own text stays. */
const NEEDS_LIVE_DETAIL = new Set(['modelNotServed']);
/** #96: a failed row that has a `code` is worded by the same mapping as the live error (a reloaded `chat_timeout` or
 *  `length_cap` reads like the live one). A row without a code, an unmapped code or no mapping keeps the server's text. */
function failedNotice(record: DiaryRecord, failureText?: (failure: RecoveredFailure) => string): string {
  const own = record.error || 'Nothing was saved. You can resend.';
  // Mapping replaces the stored text with a fixed sentence for the code. A future producer that stores an error text
  // more specific than that generic sentence must add its code to NEEDS_LIVE_DETAIL, or the detail is hidden.
  if (!failureText || typeof record.code !== 'string' || !record.code || NEEDS_LIVE_DETAIL.has(record.code)) return own;
  return failureText({ message: own, code: record.code, ...(typeof record.reason === 'string' ? { reason: record.reason } : {}), saved: false }) || own;
}
/** Recovered tools are display history, never live approval controls or replay instructions. */
export function recoverDiaryTurns(records: DiaryRecord[], failureText?: (failure: RecoveredFailure) => string): DiaryTurn[] {
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
        : failed ? failedNotice(record, failureText)
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
