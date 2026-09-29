import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api';
import type { SkillManifest } from '../api-contract';
type Skill = { file: string; hash: string; content: string; name: string; description: string; version: string; valid: boolean; error: string; status: 'review' | 'updated' | 'enabled' | 'disabled' | 'invalid'; missingTools: string[];
  /** #272: provenance and bundled executable files; absent from an older core. */
  origin?: SkillManifest['origin']; scripts?: string[] };
/** Where a skill came from (#272). A published copy names its publisher, path and the day it was copied. */
export function skillOriginText(origin: Skill['origin']): string {
  if (!origin) return '';
  if (origin.kind === 'attached-folder') return 'From an attached folder';
  if (origin.kind !== 'published') return 'Project file';
  const when = origin.retrievedAt && !Number.isNaN(Date.parse(origin.retrievedAt)) ? ` on ${origin.retrievedAt.slice(0, 10)}` : '';
  return `Published by ${origin.publisher || 'an external source'}${origin.sourcePath ? ` (${origin.sourcePath})` : ''}, copied${when}`;
}
const SCRIPTS_STATE = "Can't be used in chat (has scripts)";
const labels = { review: 'Review required', updated: 'Updated · review required', enabled: 'Enabled', disabled: 'Disabled', invalid: 'Needs correction' };
export function InstructionSkills({ projectId, updatedAt, onRefresh, onFiles }: { projectId: string; updatedAt: number; onRefresh: () => void | Promise<void>; onFiles: (files: string[]) => void }) {
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
    if (!response.ok) throw Error(value.error || 'Could not load instruction skills');
    if (!Array.isArray(value.skills)) throw Error('Could not load instruction skills: invalid server response');
    return value.skills;
  }
  async function reloadCurrent(generation: number, conflict: string) {
    const request = ++listRequest.current;
    try {
      const next = await readSkills(await apiFetch(url));
      if (lifecycle.current !== generation || listRequest.current !== request) return;
      setSkills(next); onFiles(next.map(s => s.file));
      setRecoveryNeeded(false); setError(`${conflict} The current version is now shown. Review it before enabling.`);
    } catch (e) {
      if (lifecycle.current !== generation || listRequest.current !== request) return;
      setRecoveryNeeded(true);
      setError(`${conflict} Could not load the current version: ${e instanceof Error ? e.message : 'request failed'}. Reload it before enabling.`);
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
        await reloadCurrent(generation, result.error || 'The file changed.');
        return;
      }
      if (!response.ok) throw Error(result.error || 'Could not update instruction skill');
      if (!Array.isArray(result.skills)) throw Error('Could not update instruction skill: invalid server response');
      ++listRequest.current;
      setSkills(result.skills); onFiles(result.skills.map((s: Skill) => s.file)); await onRefresh();
    } catch (e) { if (lifecycle.current === generation) setError(e instanceof Error ? e.message : 'Could not update instruction skill'); }
    finally { if (lifecycle.current === generation) setBusy(null); }
  }
  async function retryRecovery() {
    if (busy !== null) return;
    const generation = lifecycle.current;
    setBusy('recovery');
    await reloadCurrent(generation, 'The file changed.');
    if (lifecycle.current === generation) setBusy(null);
  }
  return <section className="instruction-skills" aria-label="Instruction skills">
    <h3 className="rail-label">Instruction skills ({skills.length})</h3>
    <p className="rail-empty">Reusable Markdown instructions for this project. Review and enable each version before use. They do not grant tools or write permissions.</p>
    {skills.some(s => s.status === 'review' || s.status === 'updated') && <p role="status">Some instruction files need review. Their contents are excluded from chats until you enable the current version.</p>}
    {!skills.length && <details><summary>Add an instruction skill</summary><p>Create a Markdown file and upload it using Upload files below. Start it with this restricted frontmatter:</p><pre>{'---\nname: Weekly review\ndescription: Review decisions and next actions\nversion: 1\n---\nRead selected notes and draft a review with source names.'}</pre><p>Optional: requires: core, nextcloud-notes. Requirements never enable tools automatically. Maximum file size: 32 KiB.</p></details>}
    {skills.map(skill => <details key={skill.file} className="instruction-skill">
      <summary>{skill.name || skill.file} · {skill.status === 'enabled' && skill.scripts?.length ? SCRIPTS_STATE : labels[skill.status]}</summary>
      <p>{skill.description}</p><p className="source-status">{skill.file} · Version {skill.version || 'not specified'} · SHA-256 {skill.hash.slice(0, 12)}</p>
      {skill.origin && <p className="source-status skill-origin">{skillOriginText(skill.origin)}</p>}
      {!!skill.scripts?.length && <p role="note">Bundled scripts: {skill.scripts.join(', ')}. Chat never runs Skill scripts, so this skill cannot be used in chat while they are here.{skill.status !== 'enabled' && ' It cannot be enabled until they are removed.'}</p>}
      {skill.error && <p role="alert">{skill.error}</p>}
      {!!skill.missingTools.length && <p>Required toolboxes not selected: {skill.missingTools.join(', ')}. Select them from the composer’s tools menu to use those steps.</p>}
      <pre aria-label={`Instructions in ${skill.file}`}>{skill.content}</pre>
      <div className="source-actions">
        <button className="btn btn-secondary btn-sm" disabled={!skill.valid || recoveryNeeded || (skill.status !== 'enabled' && !!skill.scripts?.length)} aria-disabled={busy !== null || !skill.valid || recoveryNeeded} onClick={() => void select(skill, skill.status !== 'enabled')}>{skill.status === 'enabled' ? 'Disable' : 'Enable this version'}</button>
      </div>
      <p className="source-status">Reviewed versions apply to new exchanges. Changed or disabled skills cannot be loaded during an active exchange. To update, replace the same file and review it again. Remove the source below to remove this skill.</p>
    </details>)}
    {error && <p className="modal-err" role="alert">{error}</p>}
    {recoveryNeeded && <button className="btn btn-secondary btn-sm" disabled={busy !== null} onClick={() => void retryRecovery()}>Reload current version</button>}
  </section>;
}
