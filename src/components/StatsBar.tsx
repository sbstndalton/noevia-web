import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { LiveStats } from '../types';
import { fetchStats } from '../api';

interface StatsBarProps {
  refreshMs?: number;
}

function fmt(n: number | null, digits = 1, suffix = ''): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n.toFixed(digits)}${suffix}`;
}

function fmtCount(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

/** Slim live readout docked at the bottom of the chat column.
 *  Polls the proxy's /api/stats (Lemonade /v1/stats + /v1/system-stats). */
export function StatsBar({ refreshMs = 2500 }: StatsBarProps): JSX.Element {
  const [stats, setStats] = useState<LiveStats | null>(null);
  const [flash, setFlash] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = () => {
      fetchStats()
        .then((s) => {
          if (!alive) return;
          setStats((prev) => {
            if (prev && s.tokensPerSecond != null && s.tokensPerSecond !== prev.tokensPerSecond) {
              setFlash(true);
              setTimeout(() => setFlash(false), 450);
            }
            return s;
          });
        })
        .catch(() => {
          if (alive) setStats((prev) => (prev ? { ...prev, up: false } : prev));
        });
    };
    tick();
    timer.current = setInterval(tick, refreshMs);
    return () => {
      alive = false;
      if (timer.current) clearInterval(timer.current);
    };
  }, [refreshMs]);

  return (
    <div className={`stats-bar${flash ? ' is-flash' : ''}`}>
      <span className={`stats-live-dot${stats?.up ? '' : ' down'}`} />
      <span className="stats-item">
        <span className="stats-label">tok/s</span>
        <span className="stats-value">{fmt(stats?.tokensPerSecond ?? null)}</span>
      </span>
      <span className="stats-item">
        <span className="stats-label">TTFT</span>
        <span className="stats-value">{fmt(stats?.timeToFirstToken ?? null, 2, 's')}</span>
      </span>
      <span className="stats-sep" />
      <span className="stats-item">
        <span className="stats-label">in</span>
        <span className="stats-value">
          {fmtCount(stats?.inputTokens ?? null)}
          <span className="stats-dim"> / {fmtCount(stats?.inputTokensTotal ?? null)}</span>
        </span>
      </span>
      <span className="stats-item">
        <span className="stats-label">out</span>
        <span className="stats-value">
          {fmtCount(stats?.outputTokens ?? null)}
          <span className="stats-dim"> / {fmtCount(stats?.outputTokensTotal ?? null)}</span>
        </span>
      </span>
      <span className="stats-item">
        <span className="stats-label">reqs</span>
        <span className="stats-value">{fmtCount(stats?.requestCount ?? null)}</span>
      </span>
      <span className="stats-sep" />
      <span className="stats-item">
        <span className="stats-label">GPU</span>
        <span className="stats-value">{fmt(stats?.gpuPercent ?? null, 0, '%')}</span>
      </span>
      <span className="stats-item">
        <span className="stats-label">VRAM</span>
        <span className="stats-value">{fmt(stats?.vramGb ?? null, 1, ' GB')}</span>
      </span>
      <span className="stats-grow" />
      <span className="stats-src">Lemonade</span>
    </div>
  );
}
