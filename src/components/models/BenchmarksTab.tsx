import { useEffect, useState } from 'react';
import { ShellIcon } from '../ShellIcon';
import { ago, errorText, mm, tokens } from './mm';
import { fetchInstalledModels } from '../../api';
import { splitChatSections } from '../../model-kind';

type Prompt = { id: number; name: string; body: string };
type Job = { run_id: number; status: string; backend: string; total: number; done: number; current: string; error: string; unit: string; lines: string[]; pct: number; elapsed: number; eta: number; active: boolean };
type RunRow = { id: number; backend: string; status: string; started_at: number; finished_at: number | null; reps: number; max_tokens: number; note: string };
type Overview = { sections: string[]; sweepArgs: Record<string, string>; prompts: Prompt[]; backends: string[]; maxTokensDefault: number; maxTokensCeiling: number; job: Job; runs: RunRow[]; categories: { key: string; label: string }[] };
type Result = { id: number; alias: string; prompt_name: string; rep: number; cold: number; contended: number; err: string; ttft_ms: number | null; ttft_answer_ms: number | null; total_ms: number | null; prompt_n: number | null; gen_n: number | null; gen_tps: number | null; draft_acc: number | null; peak_vram_json: string; truncated: number; response_text: string };
type Sweep = { id: number; alias: string; test: string; n_prompt: number; n_gen: number; n_depth: number; avg_ts: number; stddev_ts: number };
type Badge = { alias: string; category: string; rating: number; note: string; run_id: number | null };
type RunDetail = { run: RunRow; variants: { alias: string; load_ms: number | null }[]; results: Result[]; sweeps: Sweep[]; badges: Record<string, Badge[]>;
  charts: { capacity_gb: number; aliases: string[]; gen: { label: string; data: (number | null)[] }[]; ttft: { label: string; data: (number | null)[] }[]; vram_labels: string[]; vram_measured: number[]; vram_predicted: (number | null)[] } };

export function BenchmarksTab() {
  const [data, setData] = useState<Overview | null>(null), [error, setError] = useState(''), [openRun, setOpenRun] = useState<number | null>(null);
  const load = async () => { try { setData(await mm<Overview>('benchmark')); } catch (e) { setError(errorText(e, 'Benchmarks are unavailable.')); } };
  useEffect(() => { void load(); }, []);
  const active = data?.job.active;
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => void mm<{ job: Job }>('benchmark/progress').then(v => { setData(d => d ? { ...d, job: v.job } : d); if (!v.job.active) void load(); }).catch(() => {}), 1500);
    return () => clearInterval(t);
  }, [active]);
  if (!data) return error ? <p role="alert" className="modal-err">{error}</p> : <p role="status">Loading benchmarks…</p>;
  return <div className="mm-tab">
    <p className="mm-lede">Measure how models actually perform on this server. The prompt suite sends real prompts through the running engine; the throughput sweep runs llama.cpp's own llama-bench. Nothing is written to model settings.</p>
    {error && <p role="alert" className="modal-err">{error}</p>}
    {data.job.status !== 'idle' && <JobProgress job={data.job} onCancel={async () => { await mm('benchmark/cancel', { body: {} }); await load(); }}/>}
    {!data.job.active && <>
      <SuiteForm data={data} onStarted={load}/>
      <SweepForm data={data} onStarted={load}/>
    </>}
    <section className="mm-panel" aria-labelledby="mm-runs"><h3 id="mm-runs">Past runs</h3>
      {data.runs.length === 0 ? <p className="mm-note">No runs yet.</p> : <ul className="mm-list">{data.runs.map(r => <li key={r.id}>
        <span>Run {r.id} · {new Date(r.started_at * 1000).toLocaleString()}<small>{r.backend} · {r.status}{r.note ? ` · ${r.note}` : ''}</small></span>
        <button className="modal-btn secondary" aria-expanded={openRun === r.id} onClick={() => setOpenRun(openRun === r.id ? null : r.id)}>{openRun === r.id ? 'Hide' : 'View'}</button>
      </li>)}</ul>}
    </section>
    {openRun != null && <RunView id={openRun} categories={data.categories}/>}
  </div>;
}

function JobProgress({ job, onCancel }: { job: Job; onCancel: () => Promise<void> }) {
  return <section className="mm-panel" aria-live="polite" aria-labelledby="mm-job">
    <header className="mm-panel-head"><h3 id="mm-job">{job.active ? 'Benchmark running' : `Last benchmark: ${job.status}`}</h3>{job.active && <button className="modal-btn secondary" onClick={() => void onCancel()}>Stop after this request</button>}</header>
    <progress max={Math.max(1, job.total)} value={job.done} aria-label="Benchmark progress"/>
    <p className="mm-note">{job.done} of {job.total} {job.unit}{job.current ? ` · ${job.current}` : ''} · {ago(job.elapsed)} elapsed{job.eta ? ` · about ${ago(job.eta)} left` : ''}</p>
    {job.active && <p className="mm-note">Chat may wait or swap models while this runs.</p>}
    {job.error && <p role="alert" className="modal-err">{job.error}</p>}
    {job.lines.length > 0 && <pre className="mm-log">{job.lines.slice(-10).join('\n')}</pre>}
  </section>;
}

function Checklist({ label, items, value, onChange }: { label: string; items: { id: string; label: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  return <fieldset className="mm-checklist"><legend>{label}</legend>{items.map(i => <label key={i.id} className="mm-check"><input type="checkbox" checked={value.includes(i.id)} onChange={e => onChange(e.target.checked ? [...value, i.id] : value.filter(x => x !== i.id))}/>{i.label}</label>)}</fieldset>;
}

function SuiteForm({ data, onStarted }: { data: Overview; onStarted: () => Promise<void> }) {
  const [backend, setBackend] = useState(data.backends[0] || ''), [aliases, setAliases] = useState<string[]>([]), [prompts, setPrompts] = useState<string[]>(data.prompts.slice(0, 3).map(p => String(p.id)));
  const [reps, setReps] = useState(3), [maxTokens, setMaxTokens] = useState(data.maxTokensDefault), [confirmed, setConfirmed] = useState(false), [error, setError] = useState('');
  // The suite's prompts are chat generation; embedding, reranking and routing models cannot answer them (#206).
  const [installed, setInstalled] = useState<{ name: string; labels: string[] }[]>([]);
  useEffect(() => { let live = true; fetchInstalledModels().then((v) => { if (live) setInstalled(v); }).catch(() => {}); return () => { live = false; }; }, []);
  const { chat: chatSections, excluded } = splitChatSections(data.sections, installed);
  const chosen = aliases.filter((a) => chatSections.includes(a));
  const start = async () => { setError(''); try { await mm('benchmark/start', { body: { backend, aliases: chosen, promptIds: prompts.map(Number), reps, maxTokens } }); setConfirmed(false); await onStarted(); } catch (e) { setError(errorText(e, 'Could not start')); } };
  return <details className="mm-disclosure"><summary>Prompt suite</summary><div className="mm-form">
    <label>Engine<select value={backend} onChange={e => setBackend(e.target.value)}>{data.backends.map(b => <option key={b}>{b}</option>)}</select></label>
    <Checklist label="Models" items={chatSections.map(s => ({ id: s, label: s }))} value={chosen} onChange={setAliases}/>
    {excluded.length > 0 && <p className="mm-note">Chat models only. Not listed (embedding, reranking or routing): {excluded.join(', ')}.</p>}
    <Checklist label="Prompts" items={data.prompts.map(p => ({ id: String(p.id), label: p.name }))} value={prompts} onChange={setPrompts}/>
    <div className="mm-row"><label>Repeats<input type="number" min={1} max={10} value={reps} onChange={e => setReps(Number(e.target.value) || 1)}/></label>
      <label>Maximum tokens<input type="number" min={16} max={data.maxTokensCeiling} value={maxTokens} onChange={e => setMaxTokens(Number(e.target.value) || data.maxTokensDefault)}/></label></div>
    <p className="mm-note">{chosen.length * prompts.length * reps} requests. Each model is loaded in turn, replacing whatever is loaded now.</p>
    <label className="mm-check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/>I understand chat pauses while models are swapped and measured.</label>
    <button className="modal-btn primary" disabled={!confirmed || !chosen.length || !prompts.length || !backend} onClick={() => void start()}>Start benchmark</button>
    {error && <p role="alert" className="modal-err">{error}</p>}
  </div></details>;
}

function SweepForm({ data, onStarted }: { data: Overview; onStarted: () => Promise<void> }) {
  const [backend, setBackend] = useState(data.backends[0] || ''), [aliases, setAliases] = useState<string[]>([]), [nPrompt, setNPrompt] = useState(512), [nGen, setNGen] = useState(128), [depths, setDepths] = useState('0,4096,16384'), [reps, setReps] = useState(3);
  const [confirmed, setConfirmed] = useState(false), [error, setError] = useState('');
  const start = async () => { setError(''); try { await mm('benchmark/sweep', { body: { backend, aliases, nPrompt, nGen, depths, reps } }); setConfirmed(false); await onStarted(); } catch (e) { setError(errorText(e, 'Could not start')); } };
  return <details className="mm-disclosure"><summary>Throughput sweep (llama-bench)</summary><div className="mm-form">
    <p className="mm-note">Raw prompt-reading and generation speed at increasing context depth, using each model's saved settings. llama-bench has no speculative decoding, vision or server slots, so its numbers differ from the prompt suite.</p>
    <label>Engine<select value={backend} onChange={e => setBackend(e.target.value)}>{data.backends.map(b => <option key={b}>{b}</option>)}</select></label>
    <Checklist label="Models" items={data.sections.map(s => ({ id: s, label: s }))} value={aliases} onChange={setAliases}/>
    <div className="mm-row">
      <label>Prompt tokens<input type="number" min={64} value={nPrompt} onChange={e => setNPrompt(Number(e.target.value) || 512)}/></label>
      <label>Generated tokens<input type="number" min={16} value={nGen} onChange={e => setNGen(Number(e.target.value) || 128)}/></label>
      <label>Context depths<input value={depths} onChange={e => setDepths(e.target.value)}/></label>
      <label>Repeats<input type="number" min={1} max={10} value={reps} onChange={e => setReps(Number(e.target.value) || 1)}/></label>
    </div>
    <label className="mm-check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/>I understand the loaded model is unloaded while the sweep runs.</label>
    <button className="modal-btn primary" disabled={!confirmed || !aliases.length || !backend} onClick={() => void start()}>Start sweep</button>
    {error && <p role="alert" className="modal-err">{error}</p>}
  </div></details>;
}

function Bars({ title, unit, rows, max }: { title: string; unit: string; rows: { label: string; values: (number | null)[] }[]; max: number }) {
  const series = rows[0]?.values.length || 1;
  return <figure className="viz-bars" aria-label={title}><figcaption>{title}</figcaption>
    <table className="sr-only"><thead><tr><th>Model</th><th>{unit}</th></tr></thead><tbody>{rows.map(r => <tr key={r.label}><td>{r.label}</td><td>{r.values.map(v => v ?? '—').join(' / ')}</td></tr>)}</tbody></table>
    <div aria-hidden="true">{rows.map(r => <div key={r.label} className="viz-bar-row"><span>{r.label}</span><div>{r.values.map((v, i) => <div key={i} className="viz-bar-track">
      {v == null ? <em>no clean data</em> : <><i className={`viz-bar viz-s${series > 1 ? i + 1 : 1}`} style={{ width: `${Math.min(100, (v / (max || 1)) * 100)}%` }}/><b>{v}{unit}</b></>}
    </div>)}</div></div>)}</div>
  </figure>;
}

function RunView({ id, categories }: { id: number; categories: { key: string; label: string }[] }) {
  const [run, setRun] = useState<RunDetail | null>(null), [error, setError] = useState('');
  const load = async () => { try { setRun(await mm<RunDetail>(`benchmark/runs/${id}`)); } catch (e) { setError(errorText(e, 'Run unavailable')); } };
  useEffect(() => { void load(); }, [id]);
  if (!run) return error ? <p role="alert" className="modal-err">{error}</p> : <p role="status">Loading run…</p>;
  const c = run.charts;
  const prompts = c.gen.map(g => g.label);
  const genMax = Math.max(1, ...c.gen.flatMap(g => g.data.filter((x): x is number => x != null)));
  const ttftMax = Math.max(1, ...c.ttft.flatMap(g => g.data.filter((x): x is number => x != null)));
  return <section className="mm-panel" aria-labelledby="mm-run">
    <h3 id="mm-run">Run {id} · {run.run.backend} · {run.run.status}</h3>
    <p className="mm-note">Medians of clean requests. Cold requests (included a model load) and contended ones (another request shared the GPU) are kept in the table but left out of charts.</p>
    {prompts.length > 0 && <div className="viz-grid-2">{prompts.map((p, pi) => <Bars key={p} title={`Generation speed: ${p}`} unit=" tok/s" max={genMax} rows={c.aliases.map((a, ai) => ({ label: a, values: [c.gen[pi].data[ai]] }))}/>)}</div>}
    {prompts.length > 0 && <div className="viz-grid-2">{prompts.map((p, pi) => <Bars key={p} title={`Time to first token: ${p}`} unit=" ms" max={ttftMax} rows={c.aliases.map((a, ai) => ({ label: a, values: [c.ttft[pi].data[ai]] }))}/>)}</div>}
    {c.vram_labels.length > 0 && <>
      <ul className="viz-legend"><li><i className="viz-swatch viz-s1"/>Measured peak</li><li><i className="viz-swatch viz-s2"/>Autoconfig estimate (weights and KV only)</li></ul>
      <Bars title={`GPU memory${c.capacity_gb ? ` against a ${c.capacity_gb} GiB budget` : ''}`} unit=" GiB" max={Math.max(c.capacity_gb, ...c.vram_measured)} rows={c.vram_labels.map((a, i) => ({ label: a, values: [c.vram_measured[i], c.vram_predicted[i]] }))}/>
    </>}
    {run.sweeps.length > 0 && <div className="mm-table-wrap"><table className="mm-table"><caption>llama-bench results</caption>
      <thead><tr><th scope="col">Model</th><th scope="col">Test</th><th scope="col">Depth</th><th scope="col">Speed</th></tr></thead>
      <tbody>{run.sweeps.map(w => <tr key={w.id}><td>{w.alias}</td><td>{w.n_gen ? `generate ${w.n_gen}` : `read ${w.n_prompt}`}</td><td>{tokens(w.n_depth)}</td><td>{w.avg_ts?.toFixed(1)} ± {w.stddev_ts?.toFixed(1)} tok/s</td></tr>)}</tbody></table></div>}
    {run.results.length > 0 && <div className="mm-table-wrap"><table className="mm-table"><caption>Every request</caption>
      <thead><tr><th scope="col">Model</th><th scope="col">Prompt</th><th scope="col">First token</th><th scope="col">Generation</th><th scope="col">Notes</th></tr></thead>
      <tbody>{run.results.map(r => <tr key={r.id}><td>{r.alias}</td><td>{r.prompt_name} #{r.rep}</td><td>{r.ttft_ms != null ? `${Math.round(r.ttft_ms)} ms` : '—'}{r.ttft_answer_ms && r.ttft_answer_ms !== r.ttft_ms ? <small>answer at {Math.round(r.ttft_answer_ms)} ms</small> : null}</td>
        <td>{r.gen_tps != null ? `${r.gen_tps.toFixed(1)} tok/s` : '—'}<small>{tokens(r.gen_n)} tokens{r.draft_acc != null ? ` · ${Math.round(r.draft_acc * 100)}% draft accepted` : ''}</small></td>
        <td>{[r.cold ? 'cold' : '', r.contended ? 'contended' : '', r.truncated ? 'hit token limit' : '', r.err].filter(Boolean).join(' · ') || '—'}
          {r.response_text && <details><summary>Output</summary><pre className="mm-output">{r.response_text}</pre></details>}</td></tr>)}</tbody></table></div>}
    <h4 className="mm-subhead">Ratings</h4>
    <p className="mm-note">Rate what each model is good at, based on the output above. Ratings show in the Library.</p>
    {run.variants.map(v => <RateModel key={v.alias} alias={v.alias} runId={id} categories={categories} badges={run.badges[v.alias] || []} onChange={load}/>)}
  </section>;
}

function RateModel({ alias, runId, categories, badges, onChange }: { alias: string; runId: number; categories: { key: string; label: string }[]; badges: Badge[]; onChange: () => Promise<void> }) {
  const [category, setCategory] = useState(categories[0]?.key || ''), [note, setNote] = useState(''), [error, setError] = useState('');
  const rate = async (rating: number) => { setError(''); try { await mm('badges', { method: 'PUT', body: { alias, category, rating, note, runId } }); setNote(''); await onChange(); } catch (e) { setError(errorText(e, 'Could not save the rating')); } };
  return <div className="mm-rate">
    <strong>{alias}</strong>
    <span className="mm-badges">{badges.length ? badges.map(b => <span key={b.category} className="model-card-tag">{categories.find(c => c.key === b.category)?.label || b.category} {b.rating}/5
      <button className="mm-link" aria-label={`Clear ${b.category} rating`} onClick={() => void mm(`badges?alias=${encodeURIComponent(alias)}&category=${b.category}`, { method: 'DELETE' }).then(onChange)}><ShellIcon name="close" size={14}/></button></span>) : <small>Not rated</small>}</span>
    <div className="mm-row">
      <label>Good at<select value={category} onChange={e => setCategory(e.target.value)}>{categories.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</select></label>
      <label className="mm-grow">Note<input value={note} onChange={e => setNote(e.target.value)} placeholder="Optional"/></label>
      <div className="mm-stars" role="group" aria-label="Rating">{[1, 2, 3, 4, 5].map(n => <button key={n} onClick={() => void rate(n)} aria-label={`${n} of 5`}>{n}</button>)}</div>
    </div>
    {error && <p role="alert" className="modal-err">{error}</p>}
  </div>;
}

export function PromptsTab() {
  const [prompts, setPrompts] = useState<Prompt[] | null>(null), [name, setName] = useState(''), [body, setBody] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState('');
  useEffect(() => { void mm<{ prompts: Prompt[] }>('prompts').then(v => setPrompts(v.prompts)).catch(e => setError(errorText(e, 'Prompts unavailable'))); }, []);
  const add = async () => { setError(''); try { const v = await mm<{ prompts: Prompt[] }>('prompts', { body: { name, body } }); setPrompts(v.prompts); setName(''); setBody(''); } catch (e) { setError(errorText(e, 'Could not save')); } };
  const remove = async (id: number) => { try { setPrompts((await mm<{ prompts: Prompt[] }>(`prompts/${id}`, { method: 'DELETE' })).prompts); } catch (e) { setError(errorText(e, 'Could not delete')); } };
  return <div className="mm-tab">
    <p className="mm-lede">Saved prompts for benchmarks and engine tests.</p>
    {error && <p role="alert" className="modal-err">{error}</p>}
    {message && <p role="status" className="mm-note">{message}</p>}
    <ul className="mm-list">{prompts?.map(p => <li key={p.id}><span>{p.name}<small>{p.body.slice(0, 140)}{p.body.length > 140 ? '…' : ''}</small></span>
      <div className="mm-actions"><button className="modal-btn secondary" onClick={() => void navigator.clipboard?.writeText(p.body).then(() => setMessage(`Copied “${p.name}”.`))}>Copy</button><button className="modal-btn secondary" onClick={() => void remove(p.id)}>Delete</button></div></li>)}</ul>
    <section className="mm-panel"><h3>Add a prompt</h3><div className="mm-form">
      <label>Name<input value={name} onChange={e => setName(e.target.value)}/></label>
      <label>Prompt<textarea rows={5} value={body} onChange={e => setBody(e.target.value)}/></label>
      <button className="modal-btn primary" disabled={!name.trim() || !body.trim()} onClick={() => void add()}>Save prompt</button>
    </div></section>
  </div>;
}
