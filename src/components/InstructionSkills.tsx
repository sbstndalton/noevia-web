import { useEffect, useState } from 'react';
import { apiFetch } from '../api';
type Skill = { file: string; hash: string; content: string; name: string; description: string; version: string; valid: boolean; error: string; status: 'review' | 'updated' | 'enabled' | 'disabled' | 'invalid'; missingTools: string[] };
const labels = { review: 'Review required', updated: 'Updated · review required', enabled: 'Enabled', disabled: 'Disabled', invalid: 'Needs correction' };
export function InstructionSkills({ projectId, updatedAt, onRefresh, onFiles }: { projectId: string; updatedAt: number; onRefresh: () => void | Promise<void>; onFiles: (files: string[]) => void }) {
  const [skills, setSkills] = useState<Skill[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState<string | null>(null);
  const url = `/api/projects/${encodeURIComponent(projectId)}/instruction-skills`;
  useEffect(() => {
    let cancelled = false;
    setError('');
    apiFetch(url).then(async r => { const value = await r.json(); if (!r.ok) throw Error(value.error || 'Could not load instruction skills'); if (!cancelled) { setSkills(value.skills); onFiles(value.skills.map((s: Skill) => s.file)); } })
      .catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [url, updatedAt, onFiles]);
  async function select(skill: Skill, enabled: boolean) {
    if (busy !== null || !skill.valid) return;
    setBusy(skill.file); setError('');
    try {
      const response = await apiFetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file: skill.file, hash: skill.hash, enabled }) });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || 'Could not update instruction skill');
      setSkills(result.skills); await onRefresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not update instruction skill'); }
    finally { setBusy(null); }
  }
  return <section className="instruction-skills" aria-label="Instruction skills">
    <h3 className="rail-label">Instruction skills ({skills.length})</h3>
    <p className="rail-empty">Reusable Markdown instructions for this project. Review and enable each version before use. They do not grant tools or write permissions.</p>
    {skills.some(s => s.status === 'review' || s.status === 'updated') && <p role="status">Some instruction files need review. Their contents are excluded from chats until you enable the current version.</p>}
    {!skills.length && <details><summary>Add an instruction skill</summary><p>Create a Markdown file and upload it using Upload files below. Start it with this restricted frontmatter:</p><pre>{'---\nname: Weekly review\ndescription: Review decisions and next actions\nversion: 1\n---\nRead selected notes and draft a review with source names.'}</pre><p>Optional: requires: core, nextcloud-notes. Requirements never enable tools automatically. Maximum file size: 32 KiB.</p></details>}
    {skills.map(skill => <details key={skill.file} className="instruction-skill">
      <summary>{skill.name || skill.file} · {labels[skill.status]}</summary>
      <p>{skill.description}</p><p className="source-status">{skill.file} · Version {skill.version || 'not specified'}</p>
      {skill.error && <p role="alert">{skill.error}</p>}
      {!!skill.missingTools.length && <p>Required toolboxes not selected: {skill.missingTools.join(', ')}. Select them from the composer’s tools menu to use those steps.</p>}
      <pre aria-label={`Instructions in ${skill.file}`}>{skill.content}</pre>
      <div className="source-actions">
        <button className="btn btn-secondary btn-sm" disabled={!skill.valid} aria-disabled={busy !== null || !skill.valid} onClick={() => void select(skill, skill.status !== 'enabled')}>{skill.status === 'enabled' ? 'Disable' : 'Enable this version'}</button>
      </div>
      <p className="source-status">Reviewed versions apply to new exchanges. Changed or disabled skills cannot be loaded during an active exchange. To update, replace the same file and review it again. Remove the source below to remove this skill.</p>
    </details>)}
    {error && <p className="modal-err" role="alert">{error}</p>}
  </section>;
}
