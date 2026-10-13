import { appLocale } from '../user-preferences';
import { useEffect, useState } from 'react';
import { fetchProfile, fetchToolboxes } from '../api';
import { TechnicalDetail } from './TechnicalDetail';
import type { McpStatus as Status } from '../api';
import { useT } from '../i18n';

export function McpStatus() {
  const [status,setStatus]=useState<Status|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  const [isAdmin,setIsAdmin]=useState(false);
  const t=useT();
  // The variable behind an unconfigured note is for an administrator (#1580 review); the profile is cached.
  useEffect(()=>{let live=true;fetchProfile().then(p=>{if(live)setIsAdmin(p?.user?.role==='admin');},()=>{if(live)setIsAdmin(false);});return()=>{live=false;};},[]);
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
    {unconfigured&&<><p className="route-note">{t('serviceStatus.mcp.unconfigured1')}<code>core</code>{t('serviceStatus.mcp.unconfigured2')}</p><TechnicalDetail isAdmin={isAdmin} name="MCP_SERVERS" className="route-note"/></>}
    {!!servers.length&&<div className="card-list">{servers.map(server=><div className="model-row" key={server.id}>
      <span className={`model-dot${server.error||server.missingCurated?' down':''}`} />
      <div className="model-name-group"><span className="model-name">{server.id}<span className="model-role"> · {server.directory?t('serviceStatus.mcp.added'):t('serviceStatus.mcp.builtIn')}</span></span><span className="model-quant">{server.error?t('serviceStatus.mcp.catalogueUnavailable'):`${t.plural('serviceStatus.mcp.discovered',server.discovered)}${server.missingCurated?` · ${t.plural('serviceStatus.mcp.missing',server.missingCurated)}`:''}`}{server.checkedAt?` · ${t('serviceStatus.mcp.checked',{ time: new Date(server.checkedAt).toLocaleTimeString(appLocale()) })}`:''}</span></div>
    </div>)}</div>}
    <p className="route-note">{t('serviceStatus.mcp.cacheNote')}</p>
  </section>;
}
