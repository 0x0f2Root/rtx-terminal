import type { SshHost } from '@/shared/config';
import type { Workspace } from '@/state/workspace';

export type HostStatus = 'connected' | 'connecting' | null;

/** Whether any open pane is connected (or connecting) to this host, read from live pane state. */
export function hostStatus(state: Workspace, hostId: string): HostStatus {
  let connecting = false;
  for (const pane of Object.values(state.panes)) {
    if (pane.launch.ssh?.hostId !== hostId) continue;
    if (pane.status === 'running') return 'connected';
    if (pane.status === 'starting') connecting = true;
  }
  return connecting ? 'connecting' : null;
}

/** `user@host:port` as typed, falling back to the ~/.ssh/config alias when fields are empty. */
export function hostTarget(host: SshHost): string {
  const address = host.host || host.configAlias || '?';
  const user = host.username ? `${host.username}@` : '';
  return `${user}${address}${host.port !== 22 ? `:${host.port}` : ''}`;
}

export function matchesHost(host: SshHost, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    host.name,
    host.host,
    host.username,
    host.configAlias,
    host.group,
    host.notes,
    ...host.tags,
  ].some((field) => field?.toLowerCase().includes(q));
}
