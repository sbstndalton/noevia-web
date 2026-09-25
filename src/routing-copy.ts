// One vocabulary for Auto routing wherever it appears. Mirrors server
// classifyFastOrSmart / heuristicWantsSmart; update both together. The role names and the
// explanation are message keys (routing.* in the base catalogue for the summary the chat's model
// picker shows; mm.route.* in the model manager segment for its Routing panel).
import type { MessageKey, Params } from './i18n/core';

type T = (key: MessageKey, params?: Params) => string;

/** "Fast: a · Smart: b", in the interface language through the caller's translate function. */
export function roleSummary(roles: { fast?: string; smart?: string; vision?: string; code?: string } | null | undefined, t: T): string {
  if (!roles) return t('routing.notConfigured');
  const notSet = t('routing.notSet');
  return [t('routing.fast', { model: roles.fast || notSet }), t('routing.smart', { model: roles.smart || notSet }),
    ...(roles.vision ? [t('routing.vision', { model: roles.vision })] : []), ...(roles.code ? [t('routing.code', { model: roles.code })] : [])].join(' · ');
}
