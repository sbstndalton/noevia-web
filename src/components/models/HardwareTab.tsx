import { sharedMemoryRisk } from '../../model-guidance';
import { useCallback, useEffect, useRef, useState } from 'react';
import { TimeChart } from './TimeChart';
import { errorText, gib, mm, num } from './mm';
import { useT } from '../../i18n';
import type { MessageKey } from '../../i18n';

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
  const t = useT();
  const tRef = useRef(t); tRef.current = t;
  useEffect(() => {
    let live = true;
    const tick = () => Promise.all([mm<{ backends: Backend[] }>('backends'), mm<{ history: HostPoint[] }>('host')])
      .then(([b, h]) => { if (live) { setBackends(b.backends); setHost(h.history); setError(''); } })
      .catch(e => { if (live) setError(errorText(e, tRef.current('mm.hw.unavailable'))); });
    void tick();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void tick(); }, 2000);
    return () => { live = false; clearInterval(timer); };
  }, []);
  const hostNow = host[host.length - 1];
  return <div className="mm-tab">
    <p className="mm-lede">{t('mm.hw.lede')}</p>
    {error && <p role="alert" className="modal-err">{error}</p>}
    {!backends && !error && <p role="status">{t('mm.hw.reading')}</p>}
    {backends && !backends.length && <p role="status">{t('mm.hw.noEngine')}</p>}
    {backends?.map(b => <EngineCard key={b.name} backend={b} hostTotalGB={hostNow?.mem_total_gb}/>)}
    <section className="mm-panel" aria-labelledby="mm-host">
      <h3 id="mm-host">{t('mm.hw.machine')}</h3>
      <p className="mm-note">{t('mm.hw.machineNote')}</p>
      <div className="viz-grid-2">
        <TimeChart title={t('mm.hw.cpuAll')} unit="%" max={100} digits={0} times={host.map(p => p.ts)} series={[{ label: t('mm.hw.cpu'), values: host.map(p => p.cpu_pct) }]}/>
        <TimeChart title={hostNow ? t('mm.hw.memoryOf', { gib: num(hostNow.mem_total_gb, 0) }) : t('mm.hw.memory')} unit="GiB" max={hostNow?.mem_total_gb || 1} times={host.map(p => p.ts)} series={[{ label: t('mm.hw.memory'), values: host.map(p => p.mem_used_gb) }]}/>
      </div>
    </section>
  </div>;
}

// Docker's container states in the words the rest of the app uses.
const ENGINE_STATUS: Record<string, MessageKey> = { exited: 'mm.hw.status.exited', created: 'mm.hw.status.created', restarting: 'mm.hw.status.restarting', paused: 'mm.hw.status.paused', dead: 'mm.hw.status.dead', removing: 'mm.hw.status.removing' };

function EngineCard({ backend: b, hostTotalGB }: { backend: Backend; hostTotalGB?: number }) {
  const gpu = b.stats.gpu, cont = b.stats.container, pts = b.history;
  const times = pts.map(p => p.ts);
  const unified = gpu?.memory_kind === 'unified';
  const memTotal = gpu ? (unified ? gpu.vram_total_gb + gpu.shared_total_gb : gpu.vram_total_gb) : 0;
  const memUsed = gpu ? (unified ? gpu.vram_used_gb + gpu.shared_used_gb : gpu.vram_used_gb) : 0;
  const running = b.status === 'running';
  const t = useT();
  return <section className="mm-panel" aria-labelledby={`mm-engine-${b.name}`}>
    <header className="mm-panel-head">
      <div><h3 id={`mm-engine-${b.name}`}>{b.name}</h3>
        <p className="mm-note">{b.image}{b.uptime ? ` · ${t('mm.hw.up', { uptime: b.uptime })}` : ''} · {b.loaded_model ? t('mm.hw.serving', { model: b.loaded_model }) : t('mm.hw.noModel')}</p></div>
      <span className={`mm-pill ${running ? 'is-good' : 'is-bad'}`}>{running ? t('mm.hw.status.running') : ENGINE_STATUS[b.status] ? t(ENGINE_STATUS[b.status]) : t('mm.hw.status.unknown')}</span>
    </header>
    {b.last_restart_error && <p role="alert" className="modal-err">{t('mm.hw.restartFailed', { error: b.last_restart_error })}</p>}
    {!b.stats.ok && <p className="mm-note">{t('mm.hw.readingsUnavailable', { error: b.stats.error ?? '' })}</p>}
    {gpu && <>
      <p className="mm-gpu-name"><strong>{gpu.name}</strong>{gpu.gpu_count > 1 ? ` · ${t('mm.hw.gpus', { count: gpu.gpu_count })}` : ''}</p>
      {unified && (() => { const risk = sharedMemoryRisk({ unified, sharedTotalGB: gpu.shared_total_gb, hostTotalGB }); return risk.risky ? <p className="mm-note warn" role="alert">{t('mm.hw.sharedRisk', { borrow: num(risk.borrowGB ?? 0, 0), host: num(risk.hostGB ?? 0, 0), left: num(Math.max(0, risk.leftGB ?? 0)), cap: num(risk.capGB ?? 0, 0) })}</p> : null; })()}
      {unified && <p className="mm-note">{t('mm.hw.unified', { dedicated: gib(gpu.vram_total_gb), shared: gib(gpu.shared_total_gb) })}</p>}
      {!gpu.measured && <p className="mm-note">{t('mm.hw.notMeasured', { size: gib(gpu.vram_total_gb) })}</p>}
      {gpu.measured && <div className="mm-tiles">
        <Tile label={t('mm.hw.busy')} value={`${gpu.util_pct.toFixed(0)}%`}/>
        <Tile label={unified ? t('mm.hw.gpuMemory') : t('mm.hw.vramInUse')} value={t('mm.hw.ofGib', { used: num(memUsed, 1), total: num(memTotal, 1) })}/>
        {gpu.temp_c > 0 && <Tile label={t('mm.hw.temperature')} value={`${gpu.temp_c.toFixed(0)} °C`}/>}
        {gpu.power_w > 0 && <Tile label={t('mm.hw.power')} value={`${gpu.power_w.toFixed(0)} W`}/>}
        {gpu.clock_mhz > 0 && <Tile label={t('mm.hw.clock')} value={`${gpu.clock_mhz.toFixed(0)} MHz`}/>}
      </div>}
      {gpu.measured && <div className="viz-grid-2">
        <TimeChart title={t('mm.hw.busy')} unit="%" max={100} digits={0} times={times} series={[{ label: t('mm.hw.busy'), values: pts.map(p => p.gpu_util) }]}/>
        {unified
          ? <TimeChart title={t('mm.hw.gpuMemoryOf', { gib: num(memTotal, 1) })} unit="GiB" max={memTotal} times={times} series={[{ label: t('mm.hw.shared'), values: pts.map(p => p.shared_used_gb) }, { label: t('mm.hw.dedicated'), values: pts.map(p => p.vram_used_gb) }]}/>
          : <TimeChart title={t('mm.hw.vramOf', { gib: num(gpu.vram_total_gb, 1) })} unit="GiB" max={gpu.vram_total_gb} times={times} series={[{ label: 'VRAM', values: pts.map(p => p.vram_used_gb) }]}/>}
        {gpu.power_w > 0 && <TimeChart title={t('mm.hw.gpuPower')} unit="W" max={Math.max(30, ...pts.map(p => p.power_w)) * 1.1} digits={0} times={times} series={[{ label: t('mm.hw.power'), values: pts.map(p => p.power_w) }]}/>}
        {gpu.temp_c > 0 && <TimeChart title={t('mm.hw.gpuTemperature')} unit="°C" max={100} digits={0} times={times} series={[{ label: t('mm.hw.temperature'), values: pts.map(p => p.temp_c) }]}/>}
      </div>}
    </>}
    {cont && <>
      <h4 className="mm-subhead">{t('mm.hw.process')}</h4>
      <p className="mm-note">{t('mm.hw.processNote')} {cont.mem_limit_gb ? t('mm.hw.memLimit', { limit: gib(cont.mem_limit_gb) }) : ''}</p>
      <div className="viz-grid-2">
        <TimeChart title={t('mm.hw.engineCpu')} unit="%" max={Math.max(100, ...pts.map(p => p.cpu_pct))} digits={0} times={times} series={[{ label: t('mm.hw.cpu'), values: pts.map(p => p.cpu_pct) }]}/>
        <TimeChart title={cont.mem_limit_gb ? t('mm.hw.engineMemoryOf', { gib: num(cont.mem_limit_gb, 0) }) : t('mm.hw.engineMemory')} unit="GiB" max={cont.mem_limit_gb || Math.max(1, ...pts.map(p => p.mem_used_gb)) * 1.2} times={times} series={[{ label: t('mm.hw.memoryShort'), values: pts.map(p => p.mem_used_gb) }]}/>
      </div>
    </>}
    <Diagnosis name={b.name} startedAt={b.started_at}/>
    <details className="mm-disclosure"><summary>{t('mm.test.title')}</summary><TestPrompt name={b.name}/></details>
    <details className="mm-disclosure"><summary>{t('mm.logs.title')}</summary><Logs name={b.name}/></details>
    <Restart name={b.name}/>
  </section>;
}

function Tile({ label, value }: { label: string; value: string }) {
  return <div className="mm-tile"><span>{label}</span><strong>{value}</strong></div>;
}

function Diagnosis({ name, startedAt }: { name: string; startedAt: string }) {
  const [failures, setFailures] = useState<Failure[] | null>(null);
  const t = useT();
  useEffect(() => { void mm<{ failures: Failure[] }>(`backends/${encodeURIComponent(name)}/diagnose`).then(v => setFailures(v.failures)).catch(() => setFailures([])); }, [name, startedAt]);
  if (!failures?.length) return null;
  return <div className="mm-diagnosis" role="alert">
    {failures.map(f => <div key={f.model}>
      <p><strong>{t('mm.hw.failedToLoad', { model: f.model, title: f.title })}</strong> {f.advice}</p>
      {f.evidence.length > 0 && <pre>{f.evidence.join('\n')}</pre>}
    </div>)}
  </div>;
}

function TestPrompt({ name }: { name: string }) {
  const t = useT();
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [prompt, setPrompt] = useState(() => t('mm.test.defaultPrompt'));
  const [maxTokens, setMaxTokens] = useState(256);
  const [busy, setBusy] = useState(false), [result, setResult] = useState<Record<string, unknown> | null>(null), [error, setError] = useState('');
  useEffect(() => { void mm<{ prompts: Prompt[] }>('prompts').then(v => setPrompts(v.prompts)).catch(() => {}); }, []);
  const run = async () => {
    setBusy(true); setError(''); setResult(null);
    try { const v = await mm<Record<string, unknown>>(`backends/${encodeURIComponent(name)}/test`, { body: { prompt, maxTokens } }); if (!v.ok) throw Error(String(v.err || t('mm.test.failed'))); setResult(v); }
    catch (e) { setError(errorText(e, t('mm.test.failed'))); } finally { setBusy(false); }
  };
  return <div className="mm-form">
    {prompts.length > 0 && <label>{t('mm.test.saved')}<select value="" onChange={e => { const p = prompts.find(x => String(x.id) === e.target.value); if (p) setPrompt(p.body); }}><option value="">{t('mm.test.choose')}</option>{prompts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
    <label>{t('mm.test.prompt')}<textarea rows={3} value={prompt} onChange={e => setPrompt(e.target.value)}/></label>
    <label>{t('mm.test.maxTokens')}<input type="number" min={1} max={4096} value={maxTokens} onChange={e => setMaxTokens(Number(e.target.value) || 256)}/></label>
    <p className="mm-note">{t('mm.test.note')}</p>
    <button className="modal-btn secondary" disabled={busy || !prompt.trim()} onClick={() => void run()}>{busy ? t('mm.test.running') : t('mm.test.run')}</button>
    {error && <p role="alert" className="modal-err">{error}</p>}
    {result && <div className="mm-result"><pre>{String(result.reply || '')}</pre>
      <p className="mm-note">{[String(result.model), t('mm.test.tokensIn', { tokens: String(result.completion_tokens), seconds: String(result.elapsed_s) }), ...(result.tokens_per_s ? [t('mm.tokensPerSecond', { rate: String(result.tokens_per_s) })] : []), t('mm.test.promptTokens', { tokens: String(result.prompt_tokens) })].join(' · ')}</p></div>}
  </div>;
}

const LOG_BUFFER = 1000;

// Follow polls the tail every two seconds rather than holding a Docker log stream
// open per viewer through the JSON proxy; the window is bounded either way.
// Lines arrive already scrubbed of secret-shaped strings by the model manager.
function Logs({ name }: { name: string }) {
  const [q, setQ] = useState(''), [level, setLevel] = useState(''), [lines, setLines] = useState<string[] | null>(null), [error, setError] = useState('');
  const [follow, setFollow] = useState(false), [pinned, setPinned] = useState(true);
  const t = useT();
  const tRef = useRef(t); tRef.current = t;
  const box = useRef<HTMLPreElement>(null);
  const query = useRef({ q, level });
  query.current = { q, level };
  const load = useCallback(async () => {
    try {
      const v = await mm<{ ok: boolean; error?: string; lines: string[] }>(`backends/${encodeURIComponent(name)}/logs?${new URLSearchParams({ ...query.current, tail: String(LOG_BUFFER) })}`);
      if (!v.ok) throw Error(v.error || tRef.current('mm.logs.unavailable'));
      setLines(v.lines.slice(-LOG_BUFFER)); setError('');
    } catch (e) { setError(errorText(e, tRef.current('mm.logs.unavailable'))); }
  }, [name]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!follow) return;
    const timer = setInterval(() => { if (document.visibilityState !== 'hidden') void load(); }, 2000);
    return () => clearInterval(timer);
  }, [follow, load]);
  useEffect(() => { const el = box.current; if (el && pinned) el.scrollTop = el.scrollHeight; }, [lines, pinned]);
  const onScroll = () => { const el = box.current; if (el) setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 24); };
  return <div className="mm-form">
    <div className="mm-row">
      <label>{t('mm.logs.filter')}<input value={q} placeholder={t('mm.logs.find')} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void load(); }}/></label>
      <label>{t('mm.logs.level')}<select value={level} onChange={e => { setLevel(e.target.value); query.current = { q, level: e.target.value }; void load(); }}><option value="">{t('mm.logs.all')}</option><option value="warn">{t('mm.logs.warn')}</option><option value="error">{t('mm.logs.errors')}</option></select></label>
      <label className="mm-check"><input type="checkbox" checked={follow} onChange={e => { setFollow(e.target.checked); if (e.target.checked) { setPinned(true); void load(); } }}/>{t('mm.logs.follow')}</label>
      <button className="modal-btn secondary" onClick={() => void load()}>{t('mm.logs.refresh')}</button>
    </div>
    {error && <p role="alert" className="modal-err">{error}</p>}
    {lines && <pre ref={box} onScroll={onScroll} className="mm-log" tabIndex={0} aria-label={t('mm.logs.label')}>{lines.length ? lines.join('\n') : t('mm.logs.none')}</pre>}
    {lines && <p className="mm-note" role="status">{follow ? (pinned ? t('mm.logs.following') : t('mm.logs.paused')) : t('mm.logs.notFollowing')} · {t('mm.logs.last', { count: Math.min(lines.length, LOG_BUFFER) })} · {t('mm.logs.redacted')}
      {follow && !pinned && <button className="mm-link" onClick={() => setPinned(true)}> {t('mm.logs.jump')}</button>}</p>}
  </div>;
}

function Restart({ name }: { name: string }) {
  const [confirming, setConfirming] = useState(false), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const t = useT();
  const restart = async () => {
    setBusy(true); setMessage('');
    try { const v = await mm<{ ok: boolean; message: string }>(`backends/${encodeURIComponent(name)}/restart`, { body: {} }); setMessage(v.ok ? t('mm.restart.started') : v.message || t('mm.restart.failed')); }
    catch (e) { setMessage(errorText(e, t('mm.restart.failed'))); } finally { setBusy(false); setConfirming(false); }
  };
  return <div className="mm-actions">
    {confirming ? <>
      <p>{t('mm.restart.warning')}</p>
      <button className="modal-btn primary" disabled={busy} onClick={() => void restart()}>{busy ? t('mm.restart.restarting') : t('mm.restart.confirm')}</button>
      <button className="modal-btn secondary" onClick={() => setConfirming(false)}>{t('mm.restart.keep')}</button>
    </> : <button className="modal-btn secondary" onClick={() => setConfirming(true)}>{t('mm.restart.ask')}</button>}
    {message && <p role="status">{message}</p>}
  </div>;
}
