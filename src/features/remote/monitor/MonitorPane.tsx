import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Cpu,
  HardDrive,
  MemoryStick,
  Network,
  SquareTerminal,
  Unplug,
  X,
} from 'lucide-react';
import { Badge } from '@/components/reui/badge';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from 'cn';
import type { ChartConfig } from '@/components/ui/chart';
import type {
  MetricsSample,
  MonitorStatus,
  NetworkInterfaceMetric,
} from '@/shared/remote';
import { MONITOR_INTERVAL } from '@/shared/remote';
import type { RemoteEndpoint, SshConnectState } from '@/shared/api';
import { appData } from '@/state/app-data';
import { closePane } from '@/features/actions';
import { openTab, useWorkspace } from '@/state/workspace';
import { openRemote } from '../remote-open';
import {
  formatBytes,
  formatBytesPerSecond,
  formatClock,
  formatDuration,
  formatPercent,
} from '../format';
import { AreaTrend, DualLineTrend, type ChartPoint } from './monitor-charts';
import { MetricCard, Panel, PanelHeader } from './monitor-ui';
import { ProcessTable } from './ProcessTable';

/** History kept in memory while the monitor is open (30 min at the 2 s default) — a bounded ring. */
const MAX_SAMPLES = 900;

const WINDOWS = [
  { label: 'Last 1 min', ms: 60_000 },
  { label: 'Last 5 min', ms: 300_000 },
  { label: 'Last 15 min', ms: 900_000 },
] as const;

const INTERVALS = [
  { label: '1s', ms: 1000 },
  { label: '2s', ms: 2000 },
  { label: '5s', ms: 5000 },
  { label: '10s', ms: 10000 },
] as const;

const cpuConfig: ChartConfig = {
  cpu: { label: 'CPU %', color: 'var(--chart-1)' },
};
const memConfig: ChartConfig = {
  mem: { label: 'Memory %', color: 'var(--chart-2)' },
};
const netConfig: ChartConfig = {
  rx: { label: 'Receive', color: 'var(--chart-1)' },
  tx: { label: 'Transmit', color: 'var(--chart-4)' },
};
const ioConfig: ChartConfig = {
  read: { label: 'Read', color: 'var(--chart-3)' },
  write: { label: 'Write', color: 'var(--chart-5)' },
};

type ConnState =
  | { status: 'connecting'; progress: SshConnectState | null }
  | {
      status: 'open';
      connectionId: string;
      remote: RemoteEndpoint;
      label: string;
    }
  | { status: 'error'; error: string };

function pickDefaultInterface(
  interfaces: NetworkInterfaceMetric[],
): string | null {
  const real = interfaces.find((i) => i.name !== 'lo');
  return (real ?? interfaces[0])?.name ?? null;
}

export function MonitorPane({
  paneId,
  tabActive,
}: {
  paneId: string;
  tabActive: boolean;
}) {
  const hostId = useWorkspace((s) => s.panes[paneId]?.launch.ssh?.hostId);
  const label = useWorkspace((s) => s.panes[paneId]?.launch.label);

  const [conn, setConn] = useState<ConnState>({
    status: 'connecting',
    progress: null,
  });
  const connectionIdRef = useRef<string | null>(null);
  const [status, setStatus] = useState<MonitorStatus>('connecting');
  const [statusDetail, setStatusDetail] = useState<string | undefined>();
  const [history, setHistory] = useState<MetricsSample[]>([]);
  const [intervalMs, setIntervalMs] = useState<number>(
    MONITOR_INTERVAL.default,
  );
  const [windowMs, setWindowMs] = useState<number>(WINDOWS[1].ms);
  const [iface, setIface] = useState<string | null>(null);
  const [device, setDevice] = useState<string | null>(null);

  const latest = history.length > 0 ? history[history.length - 1] : null;

  // --- connection ------------------------------------------------------------

  useEffect(() => {
    if (!hostId) {
      setConn({ status: 'error', error: 'This view has no host.' });
      return;
    }
    let disposed = false;
    void (async () => {
      const result = await openRemote('monitor', hostId, {
        intervalMs: MONITOR_INTERVAL.default,
        onProgress: (progress) =>
          !disposed && setConn({ status: 'connecting', progress }),
        isCancelled: () => disposed,
      });
      if (disposed) {
        if (result.ok) void window.rtx.monitor.stop(result.connectionId);
        return;
      }
      if (!result.ok) {
        setConn({ status: 'error', error: result.error });
        setStatus('error');
        return;
      }
      connectionIdRef.current = result.connectionId;
      setConn({
        status: 'open',
        connectionId: result.connectionId,
        remote: result.remote,
        label: result.label,
      });
      setStatus('sampling');
    })();
    return () => {
      disposed = true;
      const id = connectionIdRef.current;
      if (id) void window.rtx.monitor.stop(id);
      connectionIdRef.current = null;
    };
  }, [hostId]);

  useEffect(() => {
    const off = window.rtx.monitor.onEvent((event) => {
      if (event.connectionId !== connectionIdRef.current) return;
      if (event.kind === 'sample') {
        setHistory((prev) => {
          const next = [...prev, event.sample];
          return next.length > MAX_SAMPLES ? next.slice(-MAX_SAMPLES) : next;
        });
        setStatus('sampling');
      } else {
        setStatus(event.status);
        setStatusDetail(event.detail);
      }
    });
    return off;
  }, []);

  // Pause sampling while the tab is hidden; resume when shown again.
  useEffect(() => {
    const id = connectionIdRef.current;
    if (conn.status !== 'open' || !id) return;
    window.rtx.monitor.setActive(id, tabActive);
  }, [tabActive, conn.status]);

  const changeInterval = useCallback((ms: number) => {
    setIntervalMs(ms);
    const id = connectionIdRef.current;
    if (id) window.rtx.monitor.setInterval(id, ms);
  }, []);

  // Keep interface/device selections valid as samples arrive.
  useEffect(() => {
    if (!latest) return;
    if (latest.network.state === 'ok') {
      const names = latest.network.value.map((n) => n.name);
      if (!iface || !names.includes(iface))
        setIface(pickDefaultInterface(latest.network.value));
    }
    if (latest.diskIo.state === 'ok' && latest.diskIo.value.length > 0) {
      const names = latest.diskIo.value.map((d) => d.device);
      if (!device || !names.includes(device)) setDevice(names[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest]);

  // --- chart data ------------------------------------------------------------

  const windowed = useMemo(() => {
    if (history.length === 0) return [];
    const cutoff = history[history.length - 1].timestamp - windowMs;
    return history.filter((s) => s.timestamp >= cutoff);
  }, [history, windowMs]);

  const cpuData = useMemo<ChartPoint[]>(
    () =>
      windowed.map((s) => ({
        t: s.timestamp,
        cpu:
          s.cpu.state === 'ok'
            ? Number(s.cpu.value.utilization.toFixed(1))
            : null,
      })),
    [windowed],
  );
  const memData = useMemo<ChartPoint[]>(
    () =>
      windowed.map((s) => ({
        t: s.timestamp,
        mem:
          s.memory.state === 'ok'
            ? Number(s.memory.value.utilization.toFixed(1))
            : null,
      })),
    [windowed],
  );
  const netData = useMemo<ChartPoint[]>(
    () =>
      windowed.map((s) => {
        const found =
          s.network.state === 'ok'
            ? s.network.value.find((n) => n.name === iface)
            : undefined;
        return {
          t: s.timestamp,
          rx: found ? Math.round(found.receiveBytesPerSecond) : null,
          tx: found ? Math.round(found.transmitBytesPerSecond) : null,
        };
      }),
    [windowed, iface],
  );
  const ioData = useMemo<ChartPoint[]>(
    () =>
      windowed.map((s) => {
        const found =
          s.diskIo.state === 'ok'
            ? s.diskIo.value.find((d) => d.device === device)
            : undefined;
        return {
          t: s.timestamp,
          read: found ? Math.round(found.readBytesPerSecond) : null,
          write: found ? Math.round(found.writeBytesPerSecond) : null,
        };
      }),
    [windowed, device],
  );

  const openTerminalHere = useCallback(() => {
    if (!hostId) return;
    const host = appData.get().profiles.hosts.find((h) => h.id === hostId);
    openTab({ ssh: { hostId }, label: host?.name ?? label ?? 'SSH' });
  }, [hostId, label]);

  const displayName =
    conn.status === 'open' ? conn.label : (label ?? 'Monitor');

  // --- early states ----------------------------------------------------------

  if (conn.status === 'connecting')
    return (
      <Shell>
        <div className="flex flex-1 items-center justify-center">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner />
            {conn.progress === 'authenticating'
              ? 'Authenticating…'
              : `Connecting to ${displayName}…`}
          </div>
        </div>
      </Shell>
    );

  if (conn.status === 'error')
    return (
      <Shell>
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Unplug />
            </EmptyMedia>
            <EmptyTitle>Could not start monitoring</EmptyTitle>
            <EmptyDescription>{conn.error}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="items-center">
            <Button
              size="sm"
              variant="outline"
              onClick={() => closePane(paneId)}
            >
              Close
            </Button>
          </EmptyContent>
        </Empty>
      </Shell>
    );

  const net = latest?.network.state === 'ok' ? latest.network.value : [];
  const disks = latest?.diskIo.state === 'ok' ? latest.diskIo.value : [];
  const rootFs =
    latest?.filesystems.state === 'ok'
      ? (latest.filesystems.value.find((f) => f.mountpoint === '/') ??
        latest.filesystems.value[0])
      : undefined;
  const selectedIface = net.find((n) => n.name === iface);
  const totalRate = net.reduce(
    (sum, n) => sum + n.receiveBytesPerSecond + n.transmitBytesPerSecond,
    0,
  );

  return (
    <Shell>
      {/* Host header */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Activity className="size-4 text-primary" />
        <span className="text-sm font-medium tracking-tight">
          {displayName}
        </span>
        <StatusBadge status={status} detail={statusDetail} />
        {latest?.facts.os && (
          <span className="text-xs text-muted-foreground">
            {latest.facts.os}
          </span>
        )}
        {latest?.facts.uptimeSeconds !== null &&
          latest?.facts.uptimeSeconds !== undefined && (
            <span className="text-xs text-muted-foreground">
              up {formatDuration(latest.facts.uptimeSeconds)}
            </span>
          )}
        <div className="ml-auto flex items-center gap-2">
          {latest && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatClock(latest.timestamp)}
            </span>
          )}
          <Select
            value={String(intervalMs)}
            onValueChange={(v) => changeInterval(Number(v))}
          >
            <SelectTrigger size="sm" className="w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INTERVALS.map((i) => (
                <SelectItem key={i.ms} value={String(i.ms)}>
                  {i.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={String(windowMs)}
            onValueChange={(v) => setWindowMs(Number(v))}
          >
            <SelectTrigger size="sm" className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WINDOWS.map((w) => (
                <SelectItem key={w.ms} value={String(w.ms)}>
                  {w.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <IconButton
            label="Open terminal for this host"
            onClick={openTerminalHere}
          >
            <SquareTerminal />
          </IconButton>
          <IconButton label="Close" onClick={() => closePane(paneId)}>
            <X />
          </IconButton>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        <div className="flex flex-col gap-3">
          {/* Overview cards */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <MetricCard
              title="CPU"
              icon={<Cpu className="size-3.5" />}
              block={latest?.cpu ?? null}
              render={() => {
                const cpu = latest!.cpu as {
                  state: 'ok';
                  value: {
                    utilization: number;
                    loadAverage: [number, number, number] | null;
                  };
                };
                return {
                  value: formatPercent(cpu.value.utilization),
                  sub: cpu.value.loadAverage
                    ? `load ${cpu.value.loadAverage.map((n) => n.toFixed(2)).join(' ')}`
                    : undefined,
                };
              }}
            />
            <MetricCard
              title="Memory"
              icon={<MemoryStick className="size-3.5" />}
              block={latest?.memory ?? null}
              render={() => {
                const m = latest!.memory as {
                  state: 'ok';
                  value: { utilization: number; used: number; total: number };
                };
                return {
                  value: formatPercent(m.value.utilization),
                  sub: `${formatBytes(m.value.used)} / ${formatBytes(m.value.total)}`,
                };
              }}
            />
            <MetricCard
              title="Disk"
              icon={<HardDrive className="size-3.5" />}
              block={latest?.filesystems ?? null}
              render={() =>
                rootFs
                  ? {
                      value: formatPercent(rootFs.utilization),
                      sub: `${rootFs.mountpoint} · ${formatBytes(rootFs.available)} free`,
                    }
                  : { value: '—' }
              }
            />
            <MetricCard
              title="Network"
              icon={<Network className="size-3.5" />}
              block={latest?.network ?? null}
              render={() => ({
                value: formatBytesPerSecond(totalRate),
                sub: `${net.length} interface${net.length === 1 ? '' : 's'}`,
              })}
            />
            <MetricCard
              title="Processes"
              icon={<Activity className="size-3.5" />}
              block={latest?.processes ?? null}
              render={() => ({
                value: String(
                  latest!.processes.state === 'ok'
                    ? latest!.processes.value.length
                    : 0,
                ),
                unit: 'running',
              })}
            />
          </div>

          {/* CPU + Memory */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Panel>
              <PanelHeader
                title="CPU utilization"
                icon={<Cpu className="size-4" />}
              />
              <div className="p-2">
                <ChartOrEmpty has={cpuData.some((p) => p.cpu !== null)}>
                  <AreaTrend
                    data={cpuData}
                    dataKey="cpu"
                    config={cpuConfig}
                    domain={[0, 100]}
                    valueFormatter={(v) => `${v}%`}
                    className="h-44 w-full"
                  />
                </ChartOrEmpty>
                {latest?.cpu.state === 'ok' && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 px-1 pt-2 text-xs text-muted-foreground tabular-nums">
                    <span>
                      user {formatPercent(latest.cpu.value.breakdown.user)}
                    </span>
                    <span>
                      sys {formatPercent(latest.cpu.value.breakdown.system)}
                    </span>
                    <span>
                      iowait {formatPercent(latest.cpu.value.breakdown.iowait)}
                    </span>
                    {latest.cpu.value.cores !== null && (
                      <span>{latest.cpu.value.cores} cores</span>
                    )}
                  </div>
                )}
              </div>
            </Panel>
            <Panel>
              <PanelHeader
                title="Memory"
                icon={<MemoryStick className="size-4" />}
              />
              <div className="p-2">
                <ChartOrEmpty has={memData.some((p) => p.mem !== null)}>
                  <AreaTrend
                    data={memData}
                    dataKey="mem"
                    config={memConfig}
                    domain={[0, 100]}
                    valueFormatter={(v) => `${v}%`}
                    className="h-44 w-full"
                  />
                </ChartOrEmpty>
                {latest?.memory.state === 'ok' && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 px-1 pt-2 text-xs text-muted-foreground tabular-nums">
                    <span>used {formatBytes(latest.memory.value.used)}</span>
                    <span>
                      avail {formatBytes(latest.memory.value.available)}
                    </span>
                    {latest.memory.value.cached !== null && (
                      <span>
                        cache {formatBytes(latest.memory.value.cached)}
                      </span>
                    )}
                    {latest.memory.value.swapTotal ? (
                      <span>
                        swap {formatBytes(latest.memory.value.swapUsed)} /{' '}
                        {formatBytes(latest.memory.value.swapTotal)}
                      </span>
                    ) : null}
                  </div>
                )}
              </div>
            </Panel>
          </div>

          {/* Network + Disk I/O */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Panel>
              <PanelHeader
                title="Network"
                icon={<Network className="size-4" />}
                action={
                  net.length > 0 && (
                    <Select value={iface ?? ''} onValueChange={setIface}>
                      <SelectTrigger size="sm" className="w-28">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {net.map((n) => (
                          <SelectItem key={n.name} value={n.name}>
                            {n.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )
                }
              />
              <div className="p-2">
                <ChartOrEmpty has={netData.some((p) => p.rx !== null)}>
                  <DualLineTrend
                    data={netData}
                    keys={['rx', 'tx']}
                    config={netConfig}
                    valueFormatter={(v) => formatBytesPerSecond(v)}
                    className="h-44 w-full"
                  />
                </ChartOrEmpty>
                {selectedIface && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 px-1 pt-2 text-xs text-muted-foreground tabular-nums">
                    <span>
                      ↓{' '}
                      {formatBytesPerSecond(
                        selectedIface.receiveBytesPerSecond,
                      )}
                    </span>
                    <span>
                      ↑{' '}
                      {formatBytesPerSecond(
                        selectedIface.transmitBytesPerSecond,
                      )}
                    </span>
                    <span>rx {formatBytes(selectedIface.receiveBytes)}</span>
                    <span>tx {formatBytes(selectedIface.transmitBytes)}</span>
                    {(selectedIface.receiveErrors > 0 ||
                      selectedIface.transmitErrors > 0) && (
                      <span className="text-warning-foreground">
                        errs{' '}
                        {selectedIface.receiveErrors +
                          selectedIface.transmitErrors}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </Panel>
            <Panel>
              <PanelHeader
                title="Disk I/O"
                icon={<HardDrive className="size-4" />}
                action={
                  disks.length > 0 && (
                    <Select value={device ?? ''} onValueChange={setDevice}>
                      <SelectTrigger size="sm" className="w-28">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {disks.map((d) => (
                          <SelectItem key={d.device} value={d.device}>
                            {d.device}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )
                }
              />
              <div className="p-2">
                <ChartOrEmpty
                  has={ioData.some((p) => p.read !== null)}
                  emptyLabel={
                    latest?.diskIo.state === 'unavailable'
                      ? latest.diskIo.reason
                      : 'Waiting for disk activity…'
                  }
                >
                  <DualLineTrend
                    data={ioData}
                    keys={['read', 'write']}
                    config={ioConfig}
                    valueFormatter={(v) => formatBytesPerSecond(v)}
                    className="h-44 w-full"
                  />
                </ChartOrEmpty>
              </div>
            </Panel>
          </div>

          {/* Filesystems */}
          {latest?.filesystems.state === 'ok' && (
            <Panel>
              <PanelHeader
                title="Filesystems"
                icon={<HardDrive className="size-4" />}
              />
              <div className="flex flex-col gap-2 p-3">
                {latest.filesystems.value
                  .filter((f) => !f.pseudo)
                  .map((f) => (
                    <div
                      key={`${f.filesystem}-${f.mountpoint}`}
                      className="flex flex-col gap-1"
                    >
                      <div className="flex items-center gap-2 text-xs tabular-nums">
                        <span className="font-medium">{f.mountpoint}</span>
                        <span className="text-muted-foreground">
                          {f.filesystem}
                          {f.type ? ` · ${f.type}` : ''}
                        </span>
                        <span className="ml-auto text-muted-foreground">
                          {formatBytes(f.used)} / {formatBytes(f.total)} ·{' '}
                          {formatPercent(f.utilization)}
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn(
                            'h-full rounded-full',
                            f.utilization > 90
                              ? 'bg-destructive'
                              : f.utilization > 75
                                ? 'bg-warning'
                                : 'bg-primary',
                          )}
                          style={{ width: `${Math.min(100, f.utilization)}%` }}
                        />
                      </div>
                    </div>
                  ))}
              </div>
            </Panel>
          )}

          {/* Processes */}
          <Panel className="min-h-80">
            <PanelHeader
              title="Processes"
              icon={<Activity className="size-4" />}
            />
            {latest?.processes.state === 'ok' ? (
              <ProcessTable processes={latest.processes.value} />
            ) : (
              <div className="p-6 text-center text-sm text-muted-foreground">
                {latest?.processes.state === 'unavailable'
                  ? latest.processes.reason
                  : 'Waiting for the first sample…'}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-workspace">{children}</div>
  );
}

function StatusBadge({
  status,
  detail,
}: {
  status: MonitorStatus;
  detail?: string;
}) {
  if (status === 'disconnected' || status === 'error')
    return (
      <Tooltip>
        <TooltipTrigger
          render={<Badge variant="destructive-light" size="sm" />}
        >
          {status === 'disconnected' ? 'Disconnected' : 'Error'}
        </TooltipTrigger>
        {detail && <TooltipContent>{detail}</TooltipContent>}
      </Tooltip>
    );
  if (status === 'idle')
    return (
      <Badge variant="secondary" size="sm">
        Paused
      </Badge>
    );
  return (
    <Badge variant="success-light" size="sm">
      Live
    </Badge>
  );
}

function ChartOrEmpty({
  has,
  emptyLabel = 'Collecting samples…',
  children,
}: {
  has: boolean;
  emptyLabel?: string;
  children: React.ReactNode;
}) {
  if (has) return <>{children}</>;
  return (
    <div className="flex h-44 items-center justify-center text-xs text-muted-foreground">
      {emptyLabel}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            onClick={onClick}
            aria-label={label}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
