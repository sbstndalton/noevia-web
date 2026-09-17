import { useCallback, useEffect, useRef, useState } from 'react';
import { TimeChart } from './TimeChart';
import { errorText, gib, mm } from './mm';

type Card = { index: number; name: string; util_pct: number; vram_used_gb: number; vram_total_gb: number; temp_c: number; power_w: number; shared_used_gb: number; shared_total_gb: number; clock_mhz: number; device: string };
type Gpu = { vendor: string; name: string; util_pct: number; vram_used_gb: number; vram_total_gb: number; temp_c: number; power_w: number; gpu_count: number; cards: Card[]; memory_kind: 'dedicated' | 'unified'; shared_used_gb: number; shared_total_gb: number; clock_mhz: number; source: string; measured: boolean };
type Point = { ts: number; gpu_util: number; vram_used_gb: number; cpu_pct: number; mem_used_gb: number; shared_used_gb: number; temp_c: number; power_w: number };
type Backend = { name: string; found: boolean; status: string; image: string; uptime: string; started_at: string; loaded_model: string | null; probe_error: string | null; last_restart_error: string | null;
  stats: { ok: boolean; error: string | null; gpu: Gpu | null; container: { cpu_pct: number; mem_used_gb: number; mem_limit_gb: number } | null }; history: Point[] };
type HostPoint = { ts: number; cpu_pct: number; mem_used_gb: number; mem_total_gb: number; mem_available_gb: number };
type Failure = { model: string; status: number; cause: string; title: string; advice: string; evidence: string[] };
type Prompt = { id: number; name: string; body: string };

export function HardwareTab() {
  const [backends, setBackends] = useState<Backend[] | null>(null);
  const [host, setHost] = useState<HostPoint[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    const tick = () => Promise.all([mm<{ backends: Backend[] }>('backends'), mm<{ history: HostPoint[] }>('host')])
      .then(([b, h]) => { if (live) { setBackends(b.backends); setHost(h.history); setError(''); } })
      .catch(e => { if (live) setError(errorText(e, 'Hardware status is unavailable.')); });
    void tick();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void tick(); }, 2000);
    return () => { live = false; clearInterval(timer); };
  }, []);
  const hostNow = host[host.length - 1];
  return <div className="mm-tab">
    <p className="mm-lede">Live readings from the model server, sampled every 2 seconds and kept for 15 minutes.</p>
    {error && <p role="alert" className="modal-err">{error}</p>}
    {!backends && !error && <p role="status">Reading hardware…</p>}
    {backends && !backends.length && <p role="status">No llama.cpp engine was found. Check that the model server container is running and listed for the model manager.</p>}
    {backends?.map(b => <EngineCard key={b.name} backend={b}/>)}
    <section className="mm-panel" aria-labelledby="mm-host">
      <h3 id="mm-host">This machine</h3>
      <p className="mm-note">Whole-server load, including every other service. On shared-memory GPUs this is the same memory models use.</p>
      <div className="viz-grid-2">
        <TimeChart title="CPU, all cores" unit="%" max={100} digits={0} times={host.map(p => p.ts)} series={[{ label: 'CPU', values: host.map(p => p.cpu_pct) }]}/>
        <TimeChart title={`Memory in use${hostNow ? ` of ${hostNow.mem_total_gb.toFixed(0)} GiB` : ''}`} unit="GiB" max={hostNow?.mem_total_gb || 1} times={host.map(p => p.ts)} series={[{ label: 'Memory in use', values: host.map(p => p.mem_used_gb) }]}/>
      </div>
    </section>
  </div>;
}

function EngineCard({ backend: b }: { backend: Backend }) {
  const gpu = b.stats.gpu, cont = b.stats.container, pts = b.history;
  const times = pts.map(p => p.ts);
  const unified = gpu?.memory_kind === 'unified';
  const memTotal = gpu ? (unified ? gpu.vram_total_gb + gpu.shared_total_gb : gpu.vram_total_gb) : 0;
  const memUsed = gpu ? (unified ? gpu.vram_used_gb + gpu.shared_used_gb : gpu.vram_used_gb) : 0;
  const running = b.status === 'running';
  return <section className="mm-panel" aria-labelledby={`mm-engine-${b.name}`}>
    <header className="mm-panel-head">
      <div><h3 id={`mm-engine-${b.name}`}>{b.name}</h3>
        <p className="mm-note">{b.image}{b.uptime ? ` · up ${b.uptime}` : ''}{b.loaded_model ? ` · serving ${b.loaded_model}` : ' · no model loaded'}</p></div>
      <span className={`mm-pill ${running ? 'is-good' : 'is-bad'}`}>{running ? 'Running' : b.status || 'Unknown'}</span>
    </header>
    {b.last_restart_error && <p role="alert" className="modal-err">Last restart failed: {b.last_restart_error}</p>}
    {!b.stats.ok && <p className="mm-note">Readings unavailable: {b.stats.error}</p>}
    {gpu && <>
      <p className="mm-gpu-name"><strong>{gpu.name}</strong>{gpu.gpu_count > 1 ? ` · ${gpu.gpu_count} GPUs` : ''}</p>
      {unified && <p className="mm-note">Unified memory: this GPU has a small dedicated area ({gib(gpu.vram_total_gb)}, reserved by firmware) and keeps models in memory shared with the system (up to {gib(gpu.shared_total_gb)}). Model memory is counted under shared.</p>}
      {!gpu.measured && <p className="mm-note">No live GPU readings: this llama.cpp image has no GPU monitoring tool and the kernel does not report this GPU. Only the declared memory size ({gib(gpu.vram_total_gb)}) is known, so utilisation charts are hidden.</p>}
      {gpu.measured && <div className="mm-tiles">
        <Tile label="GPU busy" value={`${gpu.util_pct.toFixed(0)}%`}/>
        <Tile label={unified ? 'GPU memory (dedicated + shared)' : 'VRAM in use'} value={`${memUsed.toFixed(1)} of ${memTotal.toFixed(1)} GiB`}/>
        {gpu.temp_c > 0 && <Tile label="Temperature" value={`${gpu.temp_c.toFixed(0)} °C`}/>}
        {gpu.power_w > 0 && <Tile label="Power" value={`${gpu.power_w.toFixed(0)} W`}/>}
        {gpu.clock_mhz > 0 && <Tile label="GPU clock" value={`${gpu.clock_mhz.toFixed(0)} MHz`}/>}
      </div>}
      {gpu.measured && <div className="viz-grid-2">
        <TimeChart title="GPU busy" unit="%" max={100} digits={0} times={times} series={[{ label: 'GPU busy', values: pts.map(p => p.gpu_util) }]}/>
        {unified
          ? <TimeChart title={`GPU memory of ${memTotal.toFixed(1)} GiB`} unit="GiB" max={memTotal} times={times} series={[{ label: 'Shared (model memory)', values: pts.map(p => p.shared_used_gb) }, { label: 'Dedicated', values: pts.map(p => p.vram_used_gb) }]}/>
          : <TimeChart title={`VRAM of ${gpu.vram_total_gb.toFixed(1)} GiB`} unit="GiB" max={gpu.vram_total_gb} times={times} series={[{ label: 'VRAM', values: pts.map(p => p.vram_used_gb) }]}/>}
        {gpu.power_w > 0 && <TimeChart title="GPU power" unit="W" max={Math.max(30, ...pts.map(p => p.power_w)) * 1.1} digits={0} times={times} series={[{ label: 'Power', values: pts.map(p => p.power_w) }]}/>}
        {gpu.temp_c > 0 && <TimeChart title="GPU temperature" unit="°C" max={100} digits={0} times={times} series={[{ label: 'Temperature', values: pts.map(p => p.temp_c) }]}/>}
      </div>}
    </>}
    {cont && <>
      <h4 className="mm-subhead">Engine process</h4>
      <p className="mm-note">The llama.cpp container itself. CPU above 100% means more than one core. {cont.mem_limit_gb ? `Its memory limit is ${gib(cont.mem_limit_gb)}.` : ''}</p>
      <div className="viz-grid-2">
        <TimeChart title="Engine CPU" unit="%" max={Math.max(100, ...pts.map(p => p.cpu_pct))} digits={0} times={times} series={[{ label: 'CPU', values: pts.map(p => p.cpu_pct) }]}/>
        <TimeChart title={`Engine memory${cont.mem_limit_gb ? ` of ${cont.mem_limit_gb.toFixed(0)} GiB limit` : ''}`} unit="GiB" max={cont.mem_limit_gb || Math.max(1, ...pts.map(p => p.mem_used_gb)) * 1.2} times={times} series={[{ label: 'Memory', values: pts.map(p => p.mem_used_gb) }]}/>
      </div>
    </>}
    <Diagnosis name={b.name} startedAt={b.started_at}/>
    <details className="mm-disclosure"><summary>Test with a prompt</summary><TestPrompt name={b.name}/></details>
    <details className="mm-disclosure"><summary>Logs</summary><Logs name={b.name}/></details>
    <Restart name={b.name}/>
  </section>;
}

function Tile({ label, value }: { label: string; value: string }) {
  return <div className="mm-tile"><span>{label}</span><strong>{value}</strong></div>;
}

function Diagnosis({ name, startedAt }: { name: string; startedAt: string }) {
  const [failures, setFailures] = useState<Failure[] | null>(null);
  useEffect(() => { void mm<{ failures: Failure[] }>(`backends/${encodeURIComponent(name)}/diagnose`).then(v => setFailures(v.failures)).catch(() => setFailures([])); }, [name, startedAt]);
  if (!failures?.length) return null;
  return <div className="mm-diagnosis" role="alert">
    {failures.map(f => <div key={f.model}>
      <p><strong>{f.model} failed to load: {f.title}.</strong> {f.advice}</p>
      {f.evidence.length > 0 && <pre>{f.evidence.join('\n')}</pre>}
    </div>)}
  </div>;
}

function TestPrompt({ name }: { name: string }) {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [prompt, setPrompt] = useState('Reply with one short sentence about the weather.');
  const [maxTokens, setMaxTokens] = useState(256);
  const [busy, setBusy] = useState(false), [result, setResult] = useState<Record<string, unknown> | null>(null), [error, setError] = useState('');
  useEffect(() => { void mm<{ prompts: Prompt[] }>('prompts').then(v => setPrompts(v.prompts)).catch(() => {}); }, []);
  const run = async () => {
    setBusy(true); setError(''); setResult(null);
    try { const v = await mm<Record<string, unknown>>(`backends/${encodeURIComponent(name)}/test`, { body: { prompt, maxTokens } }); if (!v.ok) throw Error(String(v.err || 'The test failed.')); setResult(v); }
    catch (e) { setError(errorText(e, 'The test failed.')); } finally { setBusy(false); }
  };
  return <div className="mm-form">
    {prompts.length > 0 && <label>Saved prompt<select value="" onChange={e => { const p = prompts.find(x => String(x.id) === e.target.value); if (p) setPrompt(p.body); }}><option value="">Choose a saved prompt…</option>{prompts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
    <label>Prompt<textarea rows={3} value={prompt} onChange={e => setPrompt(e.target.value)}/></label>
    <label>Maximum tokens<input type="number" min={1} max={4096} value={maxTokens} onChange={e => setMaxTokens(Number(e.target.value) || 256)}/></label>
    <p className="mm-note">Uses whichever model the engine has loaded, and loads one if needed. Chat can wait while it runs.</p>
    <button className="modal-btn secondary" disabled={busy || !prompt.trim()} onClick={() => void run()}>{busy ? 'Running…' : 'Run test'}</button>
    {error && <p role="alert" className="modal-err">{error}</p>}
    {result && <div className="mm-result"><pre>{String(result.reply || '')}</pre>
      <p className="mm-note">{String(result.model)} · {String(result.completion_tokens)} tokens in {String(result.elapsed_s)} s{result.tokens_per_s ? ` · ${String(result.tokens_per_s)} tokens/s` : ''} · prompt {String(result.prompt_tokens)} tokens</p></div>}
  </div>;
}

const LOG_BUFFER = 1000;

// Follow polls the tail every two seconds rather than holding a Docker log stream
// open per viewer through the JSON proxy; the window is bounded either way.
// Lines arrive already scrubbed of secret-shaped strings by the model manager.
function Logs({ name }: { name: string }) {
  const [q, setQ] = useState(''), [level, setLevel] = useState(''), [lines, setLines] = useState<string[] | null>(null), [error, setError] = useState('');
  const [follow, setFollow] = useState(false), [pinned, setPinned] = useState(true);
  const box = useRef<HTMLPreElement>(null);
  const query = useRef({ q, level });
  query.current = { q, level };
  const load = useCallback(async () => {
    try {
      const v = await mm<{ ok: boolean; error?: string; lines: string[] }>(`backends/${encodeURIComponent(name)}/logs?${new URLSearchParams({ ...query.current, tail: String(LOG_BUFFER) })}`);
      if (!v.ok) throw Error(v.error || 'Logs unavailable');
      setLines(v.lines.slice(-LOG_BUFFER)); setError('');
    } catch (e) { setError(errorText(e, 'Logs unavailable')); }
  }, [name]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!follow) return;
    const t = setInterval(() => { if (document.visibilityState !== 'hidden') void load(); }, 2000);
    return () => clearInterval(t);
  }, [follow, load]);
  useEffect(() => { const el = box.current; if (el && pinned) el.scrollTop = el.scrollHeight; }, [lines, pinned]);
  const onScroll = () => { const el = box.current; if (el) setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 24); };
  return <div className="mm-form">
    <div className="mm-row">
      <label>Filter<input value={q} placeholder="Text to find" onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void load(); }}/></label>
      <label>Level<select value={level} onChange={e => { setLevel(e.target.value); query.current = { q, level: e.target.value }; void load(); }}><option value="">All</option><option value="warn">Warnings and errors</option><option value="error">Errors</option></select></label>
      <label className="mm-check"><input type="checkbox" checked={follow} onChange={e => { setFollow(e.target.checked); if (e.target.checked) { setPinned(true); void load(); } }}/>Follow live</label>
      <button className="modal-btn secondary" onClick={() => void load()}>Refresh</button>
    </div>
    {error && <p role="alert" className="modal-err">{error}</p>}
    {lines && <pre ref={box} onScroll={onScroll} className="mm-log" tabIndex={0} aria-label="Engine log">{lines.length ? lines.join('\n') : 'No matching lines.'}</pre>}
    {lines && <p className="mm-note" role="status">{follow ? (pinned ? 'Following · updates every 2 s' : 'Paused while you read') : 'Not following'} · last {Math.min(lines.length, LOG_BUFFER)} lines · secrets are redacted on the server
      {follow && !pinned && <button className="mm-link" onClick={() => setPinned(true)}> Jump to latest</button>}</p>}
  </div>;
}

function Restart({ name }: { name: string }) {
  const [confirming, setConfirming] = useState(false), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const restart = async () => {
    setBusy(true); setMessage('');
    try { const v = await mm<{ ok: boolean; message: string }>(`backends/${encodeURIComponent(name)}/restart`, { body: {} }); setMessage(v.ok ? 'Restarting. Readings return in a few seconds.' : v.message || 'Restart failed.'); }
    catch (e) { setMessage(errorText(e, 'Restart failed.')); } finally { setBusy(false); setConfirming(false); }
  };
  return <div className="mm-actions">
    {confirming ? <>
      <p>Restarting stops the loaded model and interrupts any chat in progress for everyone.</p>
      <button className="modal-btn primary" disabled={busy} onClick={() => void restart()}>{busy ? 'Restarting…' : 'Restart engine'}</button>
      <button className="modal-btn secondary" onClick={() => setConfirming(false)}>Keep running</button>
    </> : <button className="modal-btn secondary" onClick={() => setConfirming(true)}>Restart engine…</button>}
    {message && <p role="status">{message}</p>}
  </div>;
}
