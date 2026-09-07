import { ShellIcon } from './ShellIcon';
export function PreviewPanel({ title, description, items=[] }: { title:string; description:string; items?:string[] }) {
  return <section className="preview-panel"><span className="preview-badge">UI preview</span><h1>{title}</h1><p>{description}</p><div className="preview-rows">{items.map(item=><div className="preview-setting-row" key={item}><span>{item}</span><button disabled title="Not implemented yet">Coming later</button></div>)}</div><p className="preview-footnote">These controls are placeholders. No settings are applied and no services are connected.</p></section>;
}
export function ActivityGrid() {
  return <section className="activity-card" aria-label="Activity preview, no data connected"><div className="activity-card-head"><strong>Activity</strong><span className="preview-badge">Preview</span><div className="activity-period"><button disabled>All time</button><button disabled>30 days</button><button disabled>7 days</button></div></div><div className="activity-metrics">{['Sessions','Messages','Tokens','Active days'].map(label=><div key={label}><span>{label}</span><strong>—</strong></div>)}</div><div className="activity-grid" aria-hidden="true">{Array.from({length:182},(_,i)=><span key={i}/>)}</div><div className="activity-caption"><span>Activity will appear when tracking is connected.</span><span>Less <i/> <i/> <i/> More</span></div></section>;
}
export function FeaturePreview({ title }: {title:string}) {
  return <main className="main feature-preview"><ShellIcon name="grid" size={30}/><PreviewPanel title={title} description={`A place for your ${title.toLowerCase()}. This interface is ready for future functionality.`} items={title==='Scheduled'?['Recurring tasks','Reminders','Run history']:title==='Plugins'?['Installed plugins','Discover plugins','Permissions']:['Sites','Artifacts','Skills','Connectors']}/></main>;
}
