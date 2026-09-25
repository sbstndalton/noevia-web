import { useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n';
import { num } from './mm';

export type Series = { label: string; values: (number | null)[] };

// Time-series line chart: one y-axis with a fixed scale (0..max), so a flat busy line
// never rescales into apparent swings; a crosshair tooltip; a legend for two or more
// series. Colours come from --viz-1..3 (validated categorical order, light and dark).
export function TimeChart({ title, series, times, max, unit, digits = 1, height = 132, empty }: {
  title: string; series: Series[]; times: number[]; max: number; unit: string; digits?: number; height?: number; empty?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  const [hover, setHover] = useState<number | null>(null);
  const t = useT();
  useEffect(() => {
    const node = box.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(200, Math.floor(entry.contentRect.width))));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const pad = { l: 44, r: 8, t: 8, b: 20 };
  const w = width - pad.l - pad.r, h = height - pad.t - pad.b;
  const n = times.length;
  const top = max > 0 ? max : 1;
  const x = (i: number) => pad.l + (n > 1 ? (i / (n - 1)) * w : w);
  const y = (v: number) => pad.t + h - Math.min(1, Math.max(0, v / top)) * h;
  const fmt = (v: number | null | undefined) => (v == null ? '—' : `${num(v, digits)}${unit === '%' ? '%' : ` ${unit}`}`);
  const path = (values: (number | null)[]) => values.reduce((d, v, i) => (v == null ? d : `${d}${d && values[i - 1] != null ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`), '');
  const span = n > 1 ? (times[n - 1] - times[0]) : 0;
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left - pad.l;
    setHover(n > 1 ? Math.round(Math.min(1, Math.max(0, px / w)) * (n - 1)) : n ? 0 : null);
  };
  const latest = series.map(s => s.values[s.values.length - 1] ?? null);
  return <figure className="viz-chart" aria-label={title}>
    <figcaption><span>{title}</span>{series.length === 1 && <strong>{fmt(latest[0])}</strong>}</figcaption>
    {series.length > 1 && <ul className="viz-legend">{series.map((s, i) => <li key={s.label}><i className={`viz-swatch viz-s${i + 1}`}/>{s.label}<strong>{fmt(latest[i])}</strong></li>)}</ul>}
    <div ref={box} className="viz-plot">
      {n < 2 ? <p className="viz-empty">{empty || t('mm.chart.collecting')}</p> : <>
        <svg width={width} height={height} role="img" aria-label={t('mm.chart.label', { title, minutes: Math.round(span / 60) })} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          {[0, 0.5, 1].map(f => <g key={f}>
            <line className="viz-grid" x1={pad.l} x2={pad.l + w} y1={y(top * f)} y2={y(top * f)}/>
            <text className="viz-axis" x={pad.l - 6} y={y(top * f) + 3} textAnchor="end">{(top * f).toFixed(unit === '%' || top * f >= 100 ? 0 : 1).replace(/\.0$/, '')}{unit === '%' ? '%' : ''}</text>
          </g>)}
          <text className="viz-axis" x={pad.l} y={height - 4}>{t('mm.chart.minAgo', { minutes: Math.round(span / 60) })}</text>
          <text className="viz-axis" x={pad.l + w} y={height - 4} textAnchor="end">{t('mm.chart.now')}</text>
          {series.map((s, i) => <path key={s.label} className={`viz-line viz-s${i + 1}`} d={path(s.values)}/>)}
          {hover != null && <g>
            <line className="viz-cross" x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + h}/>
            {series.map((s, i) => s.values[hover] != null && <circle key={s.label} className={`viz-dot viz-s${i + 1}`} cx={x(hover)} cy={y(s.values[hover] as number)} r={4}/>)}
          </g>}
        </svg>
        {hover != null && <div className="viz-tip" style={{ left: Math.min(width - 150, Math.max(0, x(hover) - 70)) }}>
          <span>{t('mm.chart.secondsAgo', { seconds: Math.round(times[n - 1] - times[hover]) })}</span>
          {series.map((s, i) => <span key={s.label}><i className={`viz-swatch viz-s${i + 1}`}/>{s.label}: <strong>{fmt(s.values[hover])}</strong></span>)}
        </div>}
      </>}
    </div>
  </figure>;
}
