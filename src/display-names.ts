// Names the server or an earlier session stored in English, shown in the viewer's language.
// Only the two shapes the app itself writes are translated; anything else is the user's own text.
import type { MessageKey, Params } from './i18n';

type Translator = (key: MessageKey, params?: Params) => string;

/** The provider label the server uses for the built-in local engine when the operator sets none
 *  (DEFAULT_PROVIDER_LABEL's default). An operator's own label is always shown as typed. */
export const DEFAULT_PROVIDER_LABEL_EN = 'Local inference';

/** A passkey's stored name. The client names new passkeys "Passkey N" in the interface language
 *  at the time, so one made while the interface was English is stored as "Passkey 1" (#1491). */
export function passkeyDisplayName(name: string, t: Translator): string {
  const numbered = /^Passkey (\d{1,4})$/.exec(name);
  return numbered ? t('security.passkeyName', { number: numbered[1] }) : name;
}

/** A model provider's label: the built-in local engine's default name is translated. */
export function providerDisplayName(provider: { label: string }, t: Translator): string {
  return provider.label === DEFAULT_PROVIDER_LABEL_EN ? t('providers.localInference') : provider.label;
}
