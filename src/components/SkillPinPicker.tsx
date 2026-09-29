import { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import type { SkillManifest, SkillPin } from '../api-contract';
import { useT } from '../i18n';

// Version-pinned Skill invocation from the web composer (#272). The list comes from the same
// portable manifest API a native client reads, and the value sent is the exact version core
// resolves (`skill_<id>@<sha256>`), so web and native invoke one reviewed artifact the same way.
// Choosing a skill selects instructions only; core still picks the tools and asks before writes.

export interface SkillPinOption { value: SkillPin & string; label: string; title: string }

const SHA256 = /^[a-f0-9]{64}$/;

/** Only enabled, reviewed skills that core would resolve as they stand can be pinned. */
export function skillPinOptions(manifests: unknown): SkillPinOption[] {
  if (!Array.isArray(manifests)) return [];
  return (manifests as SkillManifest[])
    .filter(m => m && m.schemaVersion === 1 && m.resolvable === true && m.status === 'enabled'
      && typeof m.id === 'string' && /^skill_[a-f0-9]{32}$/.test(m.id) && SHA256.test(String(m.version)))
    .map(m => ({
      value: `${m.id}@${m.version}` as `skill_${string}@${string}`,
      label: m.versionLabel ? `${m.name} · v${m.versionLabel}` : m.name,
      title: `${m.file} · SHA-256 ${m.version.slice(0, 12)}`,
    }));
}

/** The pinnable skills of a project, re-read whenever `refreshKey` changes (project edits, reply end). */
export function useSkillPinOptions(projectId: string | null, refreshKey: unknown, active: boolean): SkillPinOption[] {
  const [options, setOptions] = useState<SkillPinOption[]>([]);
  useEffect(() => {
    if (!projectId || !active) { setOptions([]); return; }
    let cancelled = false;
    apiFetch(`/api/projects/${encodeURIComponent(projectId)}/instruction-skills/manifests`)
      .then(response => (response.ok ? response.json() : null))
      .then(value => { if (!cancelled) setOptions(value && value.schemaVersion === 1 ? skillPinOptions(value.skills) : []); })
      .catch(() => { if (!cancelled) setOptions([]); });
    return () => { cancelled = true; };
  }, [projectId, refreshKey, active]);
  return options;
}

/** A plain labelled select: "Automatic" keeps the existing automatic matching. Hidden with nothing to pin. */
export function SkillPinSelect({ options, value, onChange, disabled }: {
  options: SkillPinOption[]; value: string; onChange: (value: string) => void; disabled?: boolean;
}) {
  const t = useT();
  if (!options.length) return null;
  return (
    <label className="skill-pin" title={t('skillPin.title')}>
      <span className="skill-pin-label">{t('skillPin.label')}</span>
      <select className="skill-pin-select" aria-label={t('skillPin.aria')} value={value} disabled={disabled}
        onChange={event => onChange(event.target.value)}>
        <option value="">{t('skillPin.automatic')}</option>
        {options.map(option => <option key={option.value} value={option.value} title={option.title}>{option.label}</option>)}
      </select>
    </label>
  );
}
