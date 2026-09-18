import { useRef, useState } from 'react';
import type { JSX } from 'react';

export interface ConnectInfo { sshHost: string | null; script: string; keyFile: string; rcloneConfig: string }

/** How the admin reaches the server over SSH. Unraid logs in as root; a configured alias wins. */
export const sshTarget = (c: ConnectInfo) => c.sshHost || `root@${window.location.hostname}`;

/**
 * The one-time Google sign-in, as a single paste for a Mac or Linux terminal.
 *
 * It runs on the admin's own computer because Google sends the browser back to localhost:53682
 * there. The token goes straight into the server's rclone config over SSH — never on screen,
 * never in shell history, and never through noevia (D23). It creates the `gdrive` remote if it
 * is missing, then runs the first copy so the page can confirm it worked.
 */
export function connectCommand(c: ConnectInfo): string {
  const host = sshTarget(c);
  const unwrap = `import sys,json,base64;t=open(sys.argv[1]).read();b=t.split('--->')[-1].split('<---')[0].strip();d=None if b.startswith('{') else json.loads(base64.urlsafe_b64decode(b+'='*(-len(b)%4)));tok=b if d is None else d.get('token',d);tok=tok if isinstance(tok,str) else json.dumps(tok);json.loads(tok)['access_token'];print(tok)`;
  const remote = `export RCLONE_CONFIG=${c.rcloneConfig}; mkdir -p \\$(dirname \\$RCLONE_CONFIG); rclone listremotes 2>/dev/null | grep -qx gdrive: || rclone config create gdrive drive scope=drive.file --non-interactive >/dev/null; rclone config update gdrive token '$TOKEN' config_refresh_token=false --non-interactive >/dev/null && bash ${c.script}`;
  return `command -v rclone >/dev/null || brew install rclone; F=$(mktemp); rclone authorize "drive" "eyJzY29wZSI6ImRyaXZlLmZpbGUifQ" >"$F"; TOKEN=$(python3 -c "${unwrap}" "$F" 2>/dev/null); if [ -n "$TOKEN" ]; then ssh ${host} "${remote}"; else echo "Could not read the token. Close any ssh -L tunnel on port 53682 and try again."; fi; rm -f "$F"; unset TOKEN F`;
}

export const keyCommand = (c: ConnectInfo) => `ssh ${sshTarget(c)} cat ${c.keyFile}`;

/** Steps to connect Google Drive. Shared by the setup wizard and Settings → Backups. */
export function GoogleDriveSetup({ connect, onCheck, checking }: { connect: ConnectInfo; onCheck: () => void; checking?: boolean }): JSX.Element {
  return <div className="gdrive-setup">
    <ol>
      <li>
        <strong>Save your backup key.</strong> Without it, the copy on Google Drive can never be opened, not even by you.
        Run this in Terminal on your Mac and put the line it prints into your password manager, then clear the terminal.
        <Command text={keyCommand(connect)} label="Command to show the backup key"/>
      </li>
      <li>
        <strong>Sign in to Google.</strong> Paste this into Terminal on your Mac (not in an SSH session). Your browser opens; choose your account and click Allow.
        noevia only gets access to the files it creates, and never sees your password.
        <Command text={connectCommand(connect)} label="Command to connect Google Drive"/>
      </li>
      <li>
        <strong>Check it worked.</strong> When the terminal says <code>OK mirrored</code>, check here.
        <div><button type="button" className="btn btn-secondary" disabled={checking} onClick={onCheck}>{checking ? 'Checking…' : 'Check connection'}</button></div>
      </li>
    </ol>
  </div>;
}

function Command({ text, label }: { text: string; label: string }): JSX.Element {
  const box = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState('');
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied('Copied'); }
    catch { box.current?.select(); setCopied('Selected — press ⌘C'); }
    window.setTimeout(() => setCopied(''), 2500);
  };
  return <div className="gdrive-command">
    <textarea ref={box} readOnly aria-label={label} value={text} rows={text.length > 120 ? 4 : 1} spellCheck={false} onFocus={(e) => e.currentTarget.select()}/>
    <button type="button" className="btn btn-secondary" onClick={() => void copy()}>{copied || 'Copy'}</button>
  </div>;
}
