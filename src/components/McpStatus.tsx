import { appLocale } from '../user-preferences';
import { useEffect, useState } from 'react';
import { fetchToolboxes } from '../api';
import type { McpStatus as Status } from '../api';

export function McpStatus() {
  const [status,setStatus]=useState<Status|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  useEffect(()=>{
    let stopped=false;setError('');setStatus(null);
    void fetchToolboxes().then(result=>{if(!stopped)setStatus(result.mcp);}).catch(()=>{if(!stopped)setError('Connected-tool status could not be loaded.');});
    return()=>{stopped=true;};
  },[attempt]);
  const servers=status?.servers||[],failed=servers.filter(server=>!!server.error).length;
  const unconfigured=!!status&&!status.configured;
  const state=!status?'Checking…':unconfigured?'Not configured — set MCP_SERVERS':failed===servers.length&&failed?'Unavailable':failed||servers.some(server=>server.missingCurated)?'Degraded':'Available';
  return <section><div className="settings-section-heading"><h2>Connected tools · {error?'Unknown':state}</h2><button className="popup-tab" onClick={()=>setAttempt(value=>value+1)}>Reload status</button></div>
    {error&&<p className="route-note" role="alert">{error}</p>}
    {unconfigured&&<p className="route-note">No MCP server is configured, so only the built-in <code>core</code> toolbox is offered. Set <code>MCP_SERVERS</code> in this deployment's environment to <code>id|url|auth</code> entries. If connected tools used to appear here, the deployment's Compose file has most likely lost that variable.</p>}
    {!!servers.length&&<div className="card-list">{servers.map(server=><div className="model-row" key={server.id}>
      <span className={`model-dot${server.error||server.missingCurated?' down':''}`} />
      <div className="model-name-group"><span className="model-name">{server.id}{server.auth==='internal'&&<span className="model-role"> · built-in</span>}</span><span className="model-quant">{server.error?'Catalogue unavailable':`${server.discovered} tools discovered${server.missingCurated?` · ${server.missingCurated} curated tools missing`:''}`}{server.checkedAt?` · Checked ${new Date(server.checkedAt).toLocaleTimeString(appLocale())}`:''}</span></div>
    </div>)}</div>}
    <p className="route-note">Catalogue checks are cached for up to ten minutes. A listed tool can still fail if its credentials or permissions change. Your selected toolboxes and write approvals still control execution.</p>
  </section>;
}
