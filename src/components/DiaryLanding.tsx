import type { ReactNode } from 'react';
import { dayLabel, monthLabel } from '../diary-data';
import type { FileEntry } from '../diary-workspace';

type Props = {
  ready: boolean; failed: boolean; empty: boolean; composer: ReactNode; months: string[];
  recentDays: string[]; memory: FileEntry[]; sources: FileEntry[]; busy: boolean;
  navigate: (month: string, day?: string) => void; openFile: (path: string) => void;
};
export function DiaryLanding({ ready, failed, empty, composer, months, recentDays, memory, sources, busy, navigate, openFile }: Props) {
  return <>
    <div className={`diary-landing${empty ? ' diary-empty' : ''}`}>
      {!empty && <><h1>How has your day been?</h1><p className="diary-intro">A moment, a thought, a question. Start wherever you are.</p></>}
      {composer}
      {empty && <p className="diary-context-note">Your first saved entry creates folders for entries, memory and original sources.</p>}
      {!ready && !failed && <p role="status">Loading diary…</p>}
    </div>
    {ready && !empty && <>
      <div className="diary-overview">
        <FilePanel title="Memory" files={memory} busy={busy} openFile={openFile} empty="No memory files yet. Add a note from the file browser." />
        <section><h2>Entries</h2><div className="diary-file-list">
          {recentDays.map(day => <button key={day} disabled={busy} onClick={() => navigate(day.slice(0,7), day)}>{dayLabel(day)}</button>)}
          {!recentDays.length && <p className="diary-context-note">No entries in the latest loaded months.</p>}
        </div></section>
        <FilePanel title="Other sources" files={sources} busy={busy} openFile={openFile} empty="No Markdown reference files in Raw Sources yet." />
      </div>
      {!!months.length && <section className="diary-months"><h2>Past entries</h2><div className="diary-month-grid">
        {months.map(month => <button key={month} className="month-card" disabled={busy} onClick={() => navigate(month)}><span className="month-card-name">{monthLabel(month)}</span><span className="month-card-meta">Open calendar <span aria-hidden="true">↗</span></span></button>)}
      </div></section>}
    </>}
  </>;
}
function FilePanel({ title, files, busy, openFile, empty }: { title: string; files: FileEntry[]; busy: boolean; openFile: (path: string) => void; empty: string }) {
  return <section><h2>{title}</h2><div className="diary-file-list">
    {files.map(file => <button key={file.path} disabled={busy} title={file.path} onClick={() => openFile(file.path)}>{file.name}</button>)}
    {!files.length && <p className="diary-context-note">{empty}</p>}
  </div></section>;
}
