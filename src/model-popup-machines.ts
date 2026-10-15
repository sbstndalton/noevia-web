// #1849/#1855: the Manual list's rows for models on Inference machines. The server decides which names route to a
// machine (GET /api/auto-roles leaves out any name its served catalogue lists), so this shows exactly what it sent:
// no second filter against the installed list. Only a malformed row is dropped, and a name sent twice is shown once.
import type { MachineModel } from './api';

export function machineModelRows(rows: unknown): MachineModel[] {
  const out: MachineModel[] = [];
  if (!Array.isArray(rows)) return out;
  for (const row of rows as MachineModel[]) {
    if (!row || typeof row.model !== 'string' || !row.model.trim() || typeof row.machine?.name !== 'string') continue;
    if (out.some((m) => m.model === row.model)) continue;
    out.push(row);
  }
  return out;
}
