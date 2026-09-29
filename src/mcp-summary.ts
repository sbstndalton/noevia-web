import type { McpStatus } from './api';
import type { Translate } from './i18n';
import { formatNumber } from './number-format';

export interface McpFooterSummary {
  /** The sidebar footer's one-line status text. */
  label: string;
  /** A tooltip explaining a partial outage, or why the count differs from Plugins → Added; unset otherwise. */
  title?: string;
  degraded: boolean;
  danger: boolean;
}

/** The sidebar footer's MCP line, pulled out of Sidebar.tsx so it can be tested without a render
 *  (#366). `directory` marks a server an administrator added through the MCP directory (Plugins →
 *  Added, PluginsView.tsx); everything else — the internal server or an MCP_SERVERS/
 *  MCP_SERVER_URL entry — is configured for this deployment and was never going to appear there.
 *  The label and tooltip say so, rather than let the two counts look contradictory. Every word and
 *  number goes through the catalogue and the locale's number format (#627). */
export function mcpFooterSummary(mcp: McpStatus, t: Translate): McpFooterSummary {
  // With several servers, one being down is a partial outage, not an outage — say which, rather
  // than reporting the whole integration dead.
  const servers = mcp.servers ?? [];
  const down = servers.filter((sv) => sv.error);
  const degraded = down.length > 0 || (!servers.length && !!mcp.error);
  const allDown = servers.length > 0 && down.length === servers.length;
  const added = servers.filter((sv) => sv.directory).length;
  const num = (n: number) => formatNumber(n, t.locale, 0);
  const serverNote = servers.length > 1
    ? added === 0
      ? ` · ${t('sidebar.mcpServersBuiltIn', { count: num(servers.length) })}`
      : added < servers.length
        ? ` · ${t('sidebar.mcpServersPartlyAdded', { count: num(servers.length), added: num(added) })}`
        : ` · ${t('sidebar.mcpServersAllAdded', { count: num(servers.length) })}`
    : '';
  const discovered = mcp.discovered ?? 0;
  // The plural form follows the number; the digits shown follow the locale.
  const tools = t.plural('sidebar.mcpTools', discovered, { count: num(discovered) });
  const label = !degraded
    ? `MCP · ${tools}${serverNote}`
    : allDown || !servers.length
      ? `MCP · ${t('sidebar.mcpUnavailable')}`
      : `MCP · ${tools} · ${t('sidebar.mcpDown', { ids: down.map((sv) => sv.id).join(', ') })}`;
  const title = down.length
    ? down.map((sv) => `${sv.id}: ${sv.error}`).join('\n')
    : servers.length > 1 && added < servers.length
      ? t('sidebar.mcpBuiltInTooltip')
      : undefined;
  return { label, title, degraded, danger: allDown || (!servers.length && !!mcp.error) };
}
