import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api';
import { t as tNow, useT } from '../i18n';
import type { MessageKey } from '../i18n';
import type { SkillManifest } from '../api-contract';
import { formatBinaryUnit } from '../number-format';

/** The server's per-file limit for an instruction skill (server/instruction-skills.cjs MAX_BODY, 32768 bytes). */
const SKILL_LIMIT_KIB = 32;
type Skill = { file: string; hash: string; content: string; name: string; description: string; version: string; valid: boolean; error: string; status: 'review' | 'updated' | 'enabled' | 'disabled' | 'invalid'; missingTools: string[];
  /** #272: provenance and bundled executable files; absent from an older core. */
  origin?: SkillManifest['origin']; scripts?: string[] };
/** Where a skill came from (#272). A published copy names its publisher, path and the day it was copied. */
export function skillOriginText(origin: Skill['origin'], t: (key: MessageKey, params?: Record<string, string | number>) => string = tNow): string {
  if (!origin) return '';
  if (origin.kind === 'attached-folder') return t('projects.skills.origin.folder');
  if (origin.kind !== 'published') return t('projects.skills.origin.uploaded');
  const publisher = origin.publisher || t('projects.skills.origin.external');
  const path = origin.sourcePath ? ` (${origin.sourcePath})` : '';
  return origin.retrievedAt && !Number.isNaN(Date.parse(origin.retrievedAt))
    ? t('projects.skills.origin.publishedOn', { publisher, path, date: origin.retrievedAt.slice(0, 10) })
    : t('projects.skills.origin.published', { publisher, path });
}
const STATUS_KEY = { review: 'projects.skills.status.review', updated: 'projects.skills.status.updated', enabled: 'projects.skills.status.enabled', disabled: 'projects.skills.status.disabled', invalid: 'projects.skills.status.invalid' } as const;
export function InstructionSkills({ projectId, updatedAt, onRefresh, onFiles }: { projectId: string; updatedAt: number; onRefresh: () => void | Promise<void>; onFiles: (files: string[]) => void }) {
  const t = useT();
  const [skills, setSkills] = useState<Skill[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState<string | null>(null);
  const [recoveryNeeded, setRecoveryNeeded] = useState(false);
  const lifecycle = useRef(0);
  const listRequest = useRef(0);
  const url = `/api/projects/${encodeURIComponent(projectId)}/instruction-skills`;
  useEffect(() => {
    let cancelled = false;
    const generation = ++lifecycle.current;
    const request = ++listRequest.current;
    setError(''); setRecoveryNeeded(false); setBusy(null);
    apiFetch(url).then(readSkills)
      .then(next => { if (!cancelled && listRequest.current === request) { setSkills(next); onFiles(next.map(s => s.file)); } })
      .catch(e => { if (!cancelled && listRequest.current === request) setError(e.message); });
    return () => { cancelled = true; if (lifecycle.current === generation) lifecycle.current++; };
  }, [url, updatedAt, onFiles]);
  async function readSkills(response: Response): Promise<Skill[]> {
    const value = await response.json();
    if (!response.ok) throw Error(value.error || t('projects.skills.loadFailed'));
    if (!Array.isArray(value.skills)) throw Error(t('projects.skills.loadInvalid'));
    return value.skills;
  }
  async function reloadCurrent(generation: number, conflict: string) {
    const request = ++listRequest.current;
    try {
      const next = await readSkills(await apiFetch(url));
      if (lifecycle.current !== generation || listRequest.current !== request) return;
      setSkills(next); onFiles(next.map(s => s.file));
      setRecoveryNeeded(false); setError(t('projects.skills.conflictShown', { conflict }));
    } catch (e) {
      if (lifecycle.current !== generation || listRequest.current !== request) return;
      setRecoveryNeeded(true);
      setError(t('projects.skills.conflictReloadFailed', { conflict, reason: e instanceof Error ? e.message : t('projects.skills.requestFailed') }));
    }
  }
  async function select(skill: Skill, enabled: boolean) {
    if (busy !== null || recoveryNeeded || !skill.valid) return;
    const generation = lifecycle.current;
    setBusy(skill.file); setError('');
    try {
      const response = await apiFetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file: skill.file, hash: skill.hash, enabled }) });
      const result = await response.json();
      if (lifecycle.current !== generation) return;
      if (response.status === 409) {
        setRecoveryNeeded(true);
        await reloadCurrent(generation, result.error || t('projects.skills.fileChanged'));
        return;
      }
      if (!response.ok) throw Error(result.error || t('projects.skills.updateFailed'));
      if (!Array.isArray(result.skills)) throw Error(t('projects.skills.updateInvalid'));
      ++listRequest.current;
      setSkills(result.skills); onFiles(result.skills.map((s: Skill) => s.file)); await onRefresh();
    } catch (e) { if (lifecycle.current === generation) setError(e instanceof Error ? e.message : t('projects.skills.updateFailed')); }
    finally { if (lifecycle.current === generation) setBusy(null); }
  }
  async function retryRecovery() {
    if (busy !== null) return;
    const generation = lifecycle.current;
    setBusy('recovery');
    await reloadCurrent(generation, t('projects.skills.fileChanged'));
    if (lifecycle.current === generation) setBusy(null);
  }
  return <section className="instruction-skills" aria-label={t('projects.skills.label')}>
    <h3 className="rail-label">{t('projects.skills.heading', { count: skills.length })}</h3>
    <p className="rail-empty">{t('projects.skills.intro')}</p>
    {skills.some(s => s.status === 'review' || s.status === 'updated') && <p role="status">{t('projects.skills.needsReview')}</p>}
    {!skills.length && <details><summary>{t('projects.skills.addSummary')}</summary><p>{t('projects.skills.addBody')}</p><pre>{'---\nname: Weekly review\ndescription: Review decisions and next actions\nversion: 1\n---\nRead selected notes and draft a review with source names.'}</pre><p>{t('projects.skills.addOptional', { limit: formatBinaryUnit(SKILL_LIMIT_KIB, 'KiB', t.locale, 0) })}</p></details>}
    {skills.map(skill => <details key={skill.file} className="instruction-skill">
      <summary>{skill.name || skill.file} · {skill.status === 'enabled' && skill.scripts?.length ? t('projects.skills.scriptsState') : t(STATUS_KEY[skill.status])}</summary>
      <p>{skill.description}</p><p className="source-status">{skill.file} · {t('projects.skills.version', { version: skill.version || t('projects.skills.versionUnspecified') })} · SHA-256 {skill.hash.slice(0, 12)}</p>
      {skill.origin && <p className="source-status skill-origin">{skillOriginText(skill.origin, t)}</p>}
      {!!skill.scripts?.length && <p role="note">{t('projects.skills.scripts', { scripts: skill.scripts.join(', ') })}{skill.status !== 'enabled' && ` ${t('projects.skills.scriptsBlocked')}`}</p>}
      {skill.error && <p role="alert">{skill.error}</p>}
      {!!skill.missingTools.length && <p>{t('projects.skills.missingTools', { tools: skill.missingTools.join(', ') })}</p>}
      <pre aria-label={t('projects.skills.instructionsIn', { file: skill.file })}>{skill.content}</pre>
      <div className="source-actions">
        <button className="btn btn-secondary btn-sm" disabled={!skill.valid || recoveryNeeded || (skill.status !== 'enabled' && !!skill.scripts?.length)} aria-disabled={busy !== null || !skill.valid || recoveryNeeded} onClick={() => void select(skill, skill.status !== 'enabled')}>{skill.status === 'enabled' ? t('projects.skills.disable') : t('projects.skills.enable')}</button>
      </div>
      <p className="source-status">{t('projects.skills.footnote')}</p>
    </details>)}
    {error && <p className="modal-err" role="alert">{error}</p>}
    {recoveryNeeded && <button className="btn btn-secondary btn-sm" disabled={busy !== null} onClick={() => void retryRecovery()}>{t('projects.skills.reload')}</button>}
  </section>;
}
