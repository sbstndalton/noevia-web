import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { cancelBrowserTask, decideBrowserTask, fetchBrowser, startBrowserTask } from './api';
import type { BrowserState, BrowserTask } from './api';
import { fetchProfile } from '../../api';
import { useT } from '../../i18n';
import { isDecisionStale } from '../code/decision-guard';
import { ConfirmDialog } from '../ContextMenu';
import { EmptyState } from '../EmptyState';
import { ShellIcon } from '../ShellIcon';
import { TechnicalDetail } from '../TechnicalDetail';
import '../code/code.css';

const ACTIVE = new Set(['queued', 'running', 'waiting_approval']);
const STATUS: Record<BrowserTask['status'], string> = {
  queued: 'Queued', running: 'Running', waiting_approval: 'Waiting for you',
  completed: 'Finished', failed: 'Failed', cancelled: 'Cancelled', interrupted: 'Interrupted',
};

/** Browser mode for one project (issue #274, spec-agent-execution §6). Admins with the feature on. */
export function BrowserPanel({ projectId }: { projectId: string }): JSX.Element {
  // Project identity owns every task snapshot, exactly as CodePanel's key does.
  return <ProjectBrowserPanel key={projectId} projectId={projectId}/>;
}

function ProjectBrowserPanel({ projectId }: { projectId: string }): JSX.Element {
  const [state, setState] = useState<BrowserState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [domains, setDomains] = useState('');
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const mounted = useRef(true);
  const requestGeneration = useRef(0);
  const ordinaryRequest = useRef(0);
  const activeMutation = useRef(0);
  const nextMutation = useRef(0);
  const latestState = useRef<BrowserState | null>(null);
  latestState.current = state;

  const load = useCallback(async (mutation = 0) => {
    if (activeMutation.current && mutation !== activeMutation.current) return;
    if (!mutation && ordinaryRequest.current) return;
    const request = ++requestGeneration.current;
    if (!mutation) ordinaryRequest.current = request;
    try {
      const next = await fetchBrowser(projectId);
      if (!mounted.current || request !== requestGeneration.current) return;
      setState(next);
      setError('');
    } catch (e) {
      if (mounted.current && request === requestGeneration.current) setError((e as Error).message);
    } finally {
      if (ordinaryRequest.current === request) ordinaryRequest.current = 0;
    }
  }, [projectId]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      requestGeneration.current++;
      ordinaryRequest.current = 0;
      activeMutation.current = 0;
    };
  }, [load]);
  const running = !!state?.tasks.some(t => ACTIVE.has(t.status));
  useEffect(() => {
    if (!running) return;
    const waiting = state?.tasks.some(t => t.status === 'waiting_approval');
    const timer = window.setInterval(() => { void load(); }, waiting ? 1000 : 2000);
    return () => window.clearInterval(timer);
  }, [running, state, load]);
  // The variable behind the offline note is for an administrator (#1656). The role is fetched only
  // where that note shows, and the profile is cached.
  const [isAdmin, setIsAdmin] = useState(false);
  // A proxy that is configured but not answering is no matter for an administrator's setup (#2242), but an administrator is told what to
  // do when it stays down (#2252), so the role is read for both notes.
  const needsAdmin = !!state && state.network !== true;
  useEffect(() => {
    if (!needsAdmin) return;
    let live = true;
    fetchProfile().then(p => { if (live) setIsAdmin(p?.user?.role === 'admin'); }, () => { if (live) setIsAdmin(false); });
    return () => { live = false; };
  }, [needsAdmin]);

  const act = async (label: string, work: () => Promise<unknown>, onSuccess?: () => void) => {
    if (activeMutation.current) return;
    const mutation = ++nextMutation.current;
    activeMutation.current = mutation;
    requestGeneration.current++;
    ordinaryRequest.current = 0;
    setBusy(label); setError('');
    try {
      await work();
      if (mounted.current && activeMutation.current === mutation) {
        onSuccess?.();
        await load(mutation);
      }
    } catch (e) {
      if (mounted.current && activeMutation.current === mutation && (e as { status?: number }).status === 409) await load(mutation);
      if (mounted.current && activeMutation.current === mutation) setError((e as Error).message);
    } finally {
      if (mounted.current && activeMutation.current === mutation) {
        activeMutation.current = 0;
        setBusy('');
      }
    }
  };

  if (!state) return <div className="code-panel"><p className="code-note">{error || 'Loading Browser mode…'}</p></div>;
  const online = state.network === true;

  const requestCancel = (taskId: string) => setConfirmCancel(taskId);
  const confirmedCancel = () => {
    const taskId = confirmCancel;
    setConfirmCancel(null);
    if (taskId) act(`cancel:${taskId}`, () => cancelBrowserTask(projectId, taskId));
  };

  return <div className="code-panel">
    <section className="code-compose" aria-labelledby="browser-heading">
      <div className="code-heading">
        <h2 id="browser-heading">Browser</h2>
        <p>Opens a Chromium session scoped to the domains below, in its own isolated profile. Anything the
          session submits, sends, deletes or navigates off-site stops here for your answer first.</p>
      </div>
      {error && <p className="code-note is-error" role="alert">{error}</p>}
      {!online && (state.networkState === 'unavailable' ? <EgressTemporaryNote isAdmin={isAdmin}/> : <EgressUnavailableNote isAdmin={isAdmin}/>)}

      <div className="code-field">
        <label htmlFor="browser-domains">Domains it may reach</label>
        <input id="browser-domains" value={domains} disabled={running || !!busy} placeholder="shop.example.com, docs.example.com"
          onChange={e => setDomains(e.target.value)}/>
        <p className="code-note">Comma separated. Everything else is refused at the proxy, not just discouraged.</p>
      </div>

      <div className="code-actions">
        <button type="button" className="btn btn-primary" disabled={!online || !domains.trim() || running || !!busy}
          onClick={() => act('start', () => startBrowserTask(projectId, domains.split(',').map(d => d.trim()).filter(Boolean)), () => setDomains(''))}>
          {busy === 'start' ? 'Opening…' : 'Open browser task'}
        </button>
      </div>
      {running && <p className="code-note" role="status">One browser task runs per project at a time.</p>}
    </section>

    <section className="code-tasks" aria-label="Browser tasks">
      {state.tasks.length === 0
        ? <EmptyState icon="code" title="No browser tasks yet" compact>Open a task above; it holds one Chromium session until it finishes, is cancelled or times out.</EmptyState>
        : state.tasks.map(task => <BrowserTaskCard key={task.id} task={task} busy={busy}
          onDecide={(decision, approvalId) => {
            const live = latestState.current?.tasks.find(t => t.id === task.id)?.approval?.id;
            if (isDecisionStale(live, approvalId)) { setError('That approval already changed — refreshing.'); void load(); return; }
            act(`decide:${task.id}`, () => decideBrowserTask(projectId, task.id, approvalId, decision));
          }}
          onCancel={() => requestCancel(task.id)}/>)}
    </section>
    {confirmCancel && <ConfirmDialog title="Cancel this browser task?"
      body="The session closes immediately. Anything it was in the middle of doing is left as it was; a card still waiting for your answer is refused, not carried out."
      confirmLabel="Cancel task" danger onCancel={() => setConfirmCancel(null)} onConfirm={confirmedCancel}/>}
  </div>;
}

/** No browser task can open: the server runs no egress proxy, or it is temporarily down and the route cannot say which (#1656, #2242).
 *  Plain words for everyone; the
 *  variable name it needs is shown to an administrator only. */
export function EgressUnavailableNote({ isAdmin }: { isAdmin: boolean }): JSX.Element {
  const t = useT();
  return <>
    <p className="code-note is-error" role="status">{t('browser.egressUnavailable')}</p>
    <TechnicalDetail isAdmin={isAdmin} name="CODE_EGRESS_PORT" className="code-note"/>
  </>;
}

/** The proxy is configured but not answering (#2242): usually a restart, nothing for an administrator to set up. An administrator
 *  is also told what to do when it stays down (#2252: "usually a restart" alone read as waiting forever). */
export function EgressTemporaryNote({ isAdmin }: { isAdmin: boolean }): JSX.Element {
  const t = useT();
  return <>
    <p className="code-note is-error" role="status">{t('browser.egressTemporary')}</p>
    {isAdmin && <p className="code-note" data-note="egress-still-down">{t('egress.stillDownAdmin')}</p>}
  </>;
}

function BrowserTaskCard({ task, busy, onDecide, onCancel }: {
  task: BrowserTask; busy: string;
  onDecide: (decision: 'approve' | 'approve_all' | 'deny', approvalId: string) => void; onCancel: () => void;
}): JSX.Element {
  const active = ACTIVE.has(task.status);
  return <article className={`code-task is-${task.status}`} aria-busy={active && !task.approval}>
    <header>
      <h3>{task.domains.join(', ') || 'Browser task'}</h3>
      <span className="code-status">{STATUS[task.status]}</span>
    </header>
    {task.stage && active && !task.approval && <p className="code-stage">{task.stage}</p>}
    {task.error && <p className="code-note is-error">{task.error}</p>}
    {task.approval && <BrowserApprovalCard approval={task.approval} busy={busy.startsWith('decide:')} onDecide={onDecide}/>}
    {active && <div className="code-actions"><button type="button" className="btn btn-secondary" onClick={onCancel} disabled={!!busy}>Cancel task</button></div>}
  </article>;
}

/** The gate, drawn from the same card data as Code mode's: origin, the element as it really is,
 *  the values that would be typed (masked). Only Allow once and Decline — every action is asked
 *  again, so there is no standing "Allow for this task" answer to offer here. */
function BrowserApprovalCard({ approval, busy, onDecide }: {
  approval: BrowserTask['approval']; busy: boolean; onDecide: (decision: 'approve' | 'approve_all' | 'deny', approvalId: string) => void;
}): JSX.Element | null {
  if (!approval) return null;
  const approvalId = approval.id;
  return <div className="code-approval" role="group" aria-label="Approval required">
    <p className="code-approval-title"><ShellIcon name="security" size={16} tone="decorative"/>{approval.action}{approval.origin ? ` — ${approval.origin}` : ''}</p>
    {approval.reason && <p className="code-note">{approval.reason}</p>}
    {approval.element?.text && <pre className="code-approval-args" aria-label="Target">{approval.element.text}</pre>}
    {approval.typed !== null && approval.typed !== undefined && <pre className="code-approval-args" aria-label="Value">{approval.typed}</pre>}
    {approval.url && <pre className="code-approval-args" aria-label="Address">{approval.url}</pre>}
    {approval.file && <p className="code-note">File: {approval.file}</p>}
    {approval.screenshotOmitted
      ? <p className="code-note">{approval.screenshotOmissionReason || 'No screenshot for this action.'}</p>
      : approval.screenshot && <img className="code-approval-args" alt="Page at the moment of this action" src={`data:image/png;base64,${approval.screenshot}`}/>}
    <div className="code-approval-actions">
      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onDecide('approve', approvalId)}>Allow once</button>
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => onDecide('deny', approvalId)}>Decline</button>
    </div>
  </div>;
}
