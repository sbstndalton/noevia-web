import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { createProvider, testProvider } from '../api';
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
};

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
}

/** Add-a-provider form (label / base URL / API key / default model), shared by
 *  the setup wizard (step 2) and Settings → Providers. Tests the connection
 *  first, then saves. */
export function ProviderForm({
  onConnected,
  onCancel,
  cancelLabel,
  allowShared = false,
  submitLabel,
  autoFocus = false,
}: ProviderFormProps): JSX.Element {
  const t = useT();
  const [label, setLabel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [defaultModel, setDefaultModel] = useState('');
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setErr(null);
  }, [baseUrl]);

  const submit = async () => {
    if (!label.trim() || !baseUrl.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await testProvider({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim() || undefined });
      const provider = await createProvider({
        label: label.trim(),
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim() || undefined,
        defaultModel: defaultModel.trim() || undefined,
        shared: allowShared && shared,
      });
      onConnected?.(provider);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('providers.form.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <select
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
      </select>
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
        placeholder={t('providers.form.apiKeyPlaceholder')}
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
      {allowShared && (
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
          {busy ? t('providers.form.connecting') : submitLabel ?? t('providers.form.submit')}
        </button>
      </div>
    </div>
  );
}
