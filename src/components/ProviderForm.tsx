import { useEffect, useId, useState } from 'react';
import type { JSX } from 'react';
import { createProvider, testProvider, updateProvider } from '../api';
import type { Provider } from '../types';
import { useT } from '../i18n';
// The setup wizard uses this form too, so it registers the Settings strings for its own chunk.
import '../i18n/settings';

const PRESETS: Record<string, { label: string; url: string }> = {
  custom: { label: '', url: '' },
  openai: { label: 'OpenAI', url: 'https://api.openai.com/v1' },
  openrouter: { label: 'OpenRouter', url: 'https://openrouter.ai/api/v1' },
  ollama: { label: 'Ollama', url: 'http://host.docker.internal:11434/v1' },
  lmstudio: { label: 'LM Studio', url: 'http://host.docker.internal:1234/v1' },
  lemonade: { label: 'Lemonade', url: 'http://host.docker.internal:13305/v1' },
  nvidia: { label: 'NVIDIA Build (free trial)', url: 'https://integrate.api.nvidia.com/v1' },
};

/** Mirrors the server's trial-terms host rule (provider-egress.cjs): nvidia.com or any subdomain. */
function isNvidiaHost(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl.trim()).hostname.toLowerCase().replace(/\.+$/, '');
    return host === 'nvidia.com' || host.endsWith('.nvidia.com');
  } catch {
    return false;
  }
}

/** scheme://host:port, or null for an unparseable URL. The server's rule: a stored key never follows
 *  a provider to another origin (routes/providers.cjs). */
function originOf(url: string): string | null {
  try { return new URL(url.trim()).origin; } catch { return null; }
}

// Mirrors the server bounds (providers.cjs parseContextTokens).
const CONTEXT_MIN = 2048;
const CONTEXT_MAX = 2000000;
/** '' -> null (use the default); digits with optional thousands separators -> number; else 'invalid'. */
function parseContextInput(raw: string): number | null | 'invalid' {
  const text = raw.replace(/[\s,'\u00a0\u202f]/g, '');
  if (!text) return null;
  if (!/^\d+$/.test(text)) return 'invalid';
  const n = Number(text);
  return n >= CONTEXT_MIN && n <= CONTEXT_MAX ? n : 'invalid';
}

export interface ProviderFormProps {
  /** Called after the provider is created. Receives the created provider. */
  onConnected?: (provider: Provider) => void;
  /** Cancel/back — the wizard uses Skip. */
  onCancel?: () => void;
  /** Label for the cancel button (hidden entirely when onCancel is absent). */
  cancelLabel?: string;
  /** Show the administrator shared-provider checkbox. */
  allowShared?: boolean;
  submitLabel?: string;
  autoFocus?: boolean;
  /** Edit mode (#535): the row to change in place. Fields start prefilled, the key starts blank
   *  (blank keeps the stored key), and the preset picker and share checkbox are not shown. */
  provider?: Provider;
  /** Edit mode: called with the saved row. */
  onSaved?: (provider: Provider) => void;
}

/** Add-a-provider form (label / base URL / API key / default model / context size), shared by
 *  the setup wizard (step 2) and Settings → Providers. Tests the connection first, then saves.
 *  With `provider` it edits that row in place and re-tests only when the address or key changed. */
export function ProviderForm({
  onConnected,
  onCancel,
  cancelLabel,
  allowShared = false,
  submitLabel,
  autoFocus = false,
  provider,
  onSaved,
}: ProviderFormProps): JSX.Element {
  const t = useT();
  const editing = !!provider;
  const [label, setLabel] = useState(provider?.label ?? '');
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? '');
  const [apiKey, setApiKey] = useState('');
  const [defaultModel, setDefaultModel] = useState(provider?.defaultModel ?? '');
  const [contextTokens, setContextTokens] = useState(provider?.contextTokens ? String(provider.contextTokens) : '');
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const contextHintId = useId();
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setErr(null);
  }, [baseUrl]);

  const submit = async () => {
    if (!label.trim() || !baseUrl.trim() || busy) return;
    const context = parseContextInput(contextTokens);
    if (context === 'invalid') {
      setErr(t('providers.form.contextTokensInvalid'));
      return;
    }
    const url = baseUrl.trim();
    const key = apiKey.trim();
    if (provider) {
      const urlChanged = url.replace(/\/+$/, '') !== provider.baseUrl;
      // The server refuses this too; saying so before the probe gives the real reason, not a 401.
      if (urlChanged && !key && provider.apiKeyMasked && originOf(url) !== originOf(provider.baseUrl)) {
        setErr(t('providers.form.keyRequiredForMove'));
        return;
      }
      setBusy(true);
      setErr(null);
      try {
        // Only a new address or a new key can break the connection, so only then is it re-tested.
        if (urlChanged || key) await testProvider({ baseUrl: url, apiKey: key || undefined, providerId: provider.id });
        const saved = await updateProvider(provider.id, {
          label: label.trim(),
          baseUrl: url,
          ...(key ? { apiKey: key } : {}),
          defaultModel: defaultModel.trim(),
          contextTokens: context,
        });
        onSaved?.(saved);
      } catch (e) {
        setErr(e instanceof Error ? e.message : t('providers.form.saveFailed'));
      } finally {
        setBusy(false);
      }
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await testProvider({ baseUrl: url, apiKey: key || undefined });
      const created = await createProvider({
        label: label.trim(),
        baseUrl: url,
        apiKey: key || undefined,
        defaultModel: defaultModel.trim() || undefined,
        shared: allowShared && shared,
        ...(context ? { contextTokens: context } : {}),
      });
      onConnected?.(created);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('providers.form.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="provider-form" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {!editing && <select
        className="modal-input"
        aria-label={t('providers.form.type')}
        defaultValue="custom"
        onChange={(e) => {
          const p = PRESETS[e.target.value];
          setLabel(p.label);
          setBaseUrl(p.url);
        }}
      >
        <option value="custom">{t('providers.form.custom')}</option>
        <option value="openai">OpenAI</option>
        <option value="openrouter">OpenRouter</option>
        <option value="ollama">Ollama</option>
        <option value="lmstudio">LM Studio</option>
        <option value="lemonade">Lemonade</option>
        <option value="nvidia">NVIDIA Build (free trial)</option>
      </select>}
      <input
        className="modal-input"
        aria-label={t('providers.form.name')}
        placeholder={t('providers.form.namePlaceholder')}
        value={label}
        autoFocus={autoFocus}
        onChange={(e) => setLabel(e.target.value)}
      />
      <input
        className="modal-input"
        aria-label={t('providers.form.baseUrl')}
        placeholder={t('providers.form.baseUrlPlaceholder')}
        value={baseUrl}
        onChange={(e) => setBaseUrl(e.target.value)}
      />
      <input
        className="modal-input"
        type="password"
        aria-label={t('providers.form.apiKey')}
        placeholder={editing && provider?.apiKeyMasked ? t('providers.form.apiKeyKeep') : t('providers.form.apiKeyPlaceholder')}
        autoComplete="new-password"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
      />
      <input
        className="modal-input"
        aria-label={t('providers.form.defaultModel')}
        placeholder={t('providers.form.defaultModelPlaceholder')}
        value={defaultModel}
        onChange={(e) => setDefaultModel(e.target.value)}
      />
      <input
        className="modal-input"
        inputMode="numeric"
        aria-label={t('providers.form.contextTokens')}
        aria-describedby={contextHintId}
        placeholder={t('providers.form.contextTokensPlaceholder')}
        value={contextTokens}
        onChange={(e) => { setContextTokens(e.target.value); setErr(null); }}
      />
      <p className="route-note" id={contextHintId}>{t('providers.form.contextTokensHint')}</p>
      {isNvidiaHost(baseUrl) && <p className="route-note">{t('providers.form.nvidiaNote')}</p>}
      {allowShared && !editing && (
        <label className="route-note">
          <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> {t('providers.form.shared')}
        </label>
      )}
      {err && <p className="modal-err">{err}</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 8 }}>
        {onCancel && (
          <button type="button" className="modal-btn secondary" onClick={onCancel}>
            {cancelLabel ?? t('providers.form.skip')}
          </button>
        )}
        <button
          type="button"
          className="modal-btn primary"
          disabled={!label.trim() || !baseUrl.trim() || busy}
          onClick={() => void submit()}
        >
          {editing
            ? (busy ? t('providers.form.saving') : submitLabel ?? t('providers.form.save'))
            : (busy ? t('providers.form.connecting') : submitLabel ?? t('providers.form.submit'))}
        </button>
      </div>
    </div>
  );
}
