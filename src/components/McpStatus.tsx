import { appLocale } from '../user-preferences';
import { useEffect, useState } from 'react';
import { fetchToolboxes } from '../api';
import type { McpStatus as Status } from '../api';
import { useT } from '../i18n';

export function McpStatus() {
  const [status,setStatus]=useState<Status|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  const t=useT();
  useEffect(()=>{
    let stopped=false;setError('');setStatus(null);
    void fetchToolboxes().then(result=>{if(!stopped)setStatus(result.mcp);}).catch(()=>{if(!stopped)setError('failed');});
    return()=>{stopped=true;};
  },[attempt]);
  const servers=status?.servers||[],failed=servers.filter(server=>!!server.error).length;
  const unconfigured=!!status&&!status.configured;
  const state=!status?t('serviceStatus.mcp.checking'):unconfigured?t('serviceStatus.mcp.notConfigured'):failed===servers.length&&failed?t('serviceStatus.mcp.unavailable'):failed||servers.some(server=>server.missingCurated)?t('serviceStatus.mcp.degraded'):t('serviceStatus.mcp.available');
  return <section><div className="settings-section-heading"><h2>{t('serviceStatus.mcp.heading', { state: error?t('serviceStatus.mcp.unknown'):state })}</h2><button className="popup-tab" onClick={()=>setAttempt(value=>value+1)}>{t('serviceStatus.mcp.reload')}</button></div>
    {error&&<p className="route-note" role="alert">{t('serviceStatus.mcp.loadError')}</p>}
    {unconfigured&&<p className="route-note">{t('serviceStatus.mcp.unconfigured1')}<code>core</code>{t('serviceStatus.mcp.unconfigured2')}<code>MCP_SERVERS</code>{t('serviceStatus.mcp.unconfigured3')}<code>id|url|auth</code>{t('serviceStatus.mcp.unconfigured4')}</p>}
    {!!servers.length&&<div className="card-list">{servers.map(server=><div className="model-row" key={server.id}>
      <span className={`model-dot${server.error||server.missingCurated?' down':''}`} />
      <div className="model-name-group"><span className="model-name">{server.id}<span className="model-role"> · {server.directory?t('serviceStatus.mcp.added'):t('serviceStatus.mcp.builtIn')}</span></span><span className="model-quant">{server.error?t('serviceStatus.mcp.catalogueUnavailable'):`${t.plural('serviceStatus.mcp.discovered',server.discovered)}${server.missingCurated?` · ${t.plural('serviceStatus.mcp.missing',server.missingCurated)}`:''}`}{server.checkedAt?` · ${t('serviceStatus.mcp.checked',{ time: new Date(server.checkedAt).toLocaleTimeString(appLocale()) })}`:''}</span></div>
    </div>)}</div>}
    <p className="route-note">{t('serviceStatus.mcp.cacheNote')}</p>
  </section>;
}
