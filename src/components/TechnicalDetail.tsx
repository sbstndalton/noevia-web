import type { JSX } from 'react';
import { useT } from '../i18n';

/** The operator's technical name for a setting (an environment variable), shown to an administrator
 *  only (#1580 review). The main text stays in plain words for everyone; members render nothing here. */
export function TechnicalDetail({ isAdmin, name, className = '' }: { isAdmin: boolean; name?: string | null; className?: string }): JSX.Element | null {
  const t = useT();
  if (!isAdmin || !name) return null;
  return <p className={className}>{t('common.technicalDetail', { name })}</p>;
}
