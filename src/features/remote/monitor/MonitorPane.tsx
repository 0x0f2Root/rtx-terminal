import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  CircleAlert,
  Cpu,
  HardDrive,
  ListTree,
  MemoryStick,
  Network,
  Pause,
  Play,
  RotateCw,
  Search,
  SquareTerminal,
  Unplug,
  X,
} from 'lucide-react';
import { IconButton } from '@/components/icon-button';
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from '@/components/reui/alert';
import { Badge } from '@/components/reui/badge';
import { Button } from '@/components/ui/button';
import type { ChartConfig } from '@/components/ui/chart';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import type {
  FilesystemMetric,
  MetricsSample,
  MonitorStatus,
} from '@/shared/remote';
import { MONITOR_INTERVAL } from '@/shared/remote';
import type { RemoteEndpoint, SshConnectState } from '@/shared/api';
import { appData } from '@/state/app-data';
import { closePane } from '@/features/actions';
import { openTab, useWorkspace } from '@/state/workspace';
import { openRemote } from '../remote-open';
import {
  formatBytes,
  formatBytesCompact,
  formatBytesPerSecond,
  formatClock,
  formatDuration,
  formatPercent,
} from '../format';
import { AreaTrend, LineTrend, Sparkline } from './monitor-charts';
import {
  cpuPoints,
  defaultInterface,
  diskIoPoints,
  externalNetworkPoints,
  externalThroughput,
  isStale,
  memoryPoints,
  networkPoints,
  staleAfterMs,
  windowSamples,
  withGaps,
} from './monitor-data';
import { MetricFrame, StatTile } from './monitor-ui';
import { ProcessTable } from './ProcessTable';

/** History kept while the monitor is open: a bounded ring (30 min at the 2 s default). */
const MAX_SAMPLES = 900;

const WINDOWS = [
  { label: 'Last 1 min', ms: 60_000 },
  { label: 'Last 5 min', ms: 300_000 },
  { label: 'Last 15 min', ms: 900_000 },
] as const;

const INTERVALS = [
  { label: 'Every 1s', ms: 1000 },
  { label: 'Every 2s', ms: 2000 },
  { label: 'Every 5s', ms: 5000 },
  { label: 'Every 10s', ms: 10_000 },
] as const;

// Series take the --chart-* slots in fixed order: every chart's first series is --chart-1.
const cpuConfig: ChartConfig = {
  cpu: { label: 'CPU', color: 'var(--chart-1)' },
};
const memConfig: ChartConfig = {
  mem: { label: 'Memory', color: 'var(--chart-1)' },
};
const netTotalConfig: ChartConfig = {
  net: { label: 'Network', color: 'var(--chart-1)' },
};
const netConfig: ChartConfig = {
  rx: { label: 'Receive', color: 'var(--chart-1)' },
  tx: { label: 'Transmit', color: 'var(--chart-2)' },
};
const ioConfig: ChartConfig = {
  read: { label: 'Read', color: 'var(--chart-1)' },
  write: { label: 'Write', color: 'var(--chart-2)' },
};

const percentAxis = (value: number) => `${value}%`;
const percentValue = (value: number) => formatPercent(value, 1);
const rateValue = (value: number) => formatBytesPerSecond(value);

type ConnState =
  | { status: 'connecting'; progress: SshConnectState | null }
  | {
      status: 'open';
      connectionId: string;
      remote: RemoteEndpoint;
      label: string;
    }
  | { status: 'error'; error: string };

/** Re-renders every second while `active`, for the stale-sample check. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
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
  /** Bumped by Reconnect to open a fresh monitor for the same host. */
  const [attempt, setAttempt] = useState(0);
  const connectionIdRef = useRef<string | null>(null);
  const [status, setStatus] = useState<MonitorStatus>('connecting');
  const [statusDetail, setStatusDetail] = useState<string | undefined>();
  const [history, setHistory] = useState<MetricsSample[]>([]);
  const [intervalMs, setIntervalMs] = useState<number>(
    MONITOR_INTERVAL.default,
  );
  const [windowMs, setWindowMs] = useState<number>(WINDOWS[1].ms);
  const [userPaused, setUserPaused] = useState(false);
  const [iface, setIface] = useState<string | null>(null);
  const [device, setDevice] = useState<string | null>(null);
  const [mount, setMount] = useState<string | null>(null);
  const [showVirtual, setShowVirtual] = useState(false);
  const [processFilter, setProcessFilter] = useState('');
  const [selectedPid, setSelectedPid] = useState<number | null>(null);

  const latest = history.length > 0 ? history[history.length - 1] : null;

  // --- connection ------------------------------------------------------------

  useEffect(() => {
    if (!hostId) {
      setConn({ status: 'error', error: 'This view has no host.' });
      return;
    }
    let disposed = false;
    setConn({ status: 'connecting', progress: null });
    setStatus('connecting');
    void (async () => {
      const result = await openRemote('monitor', hostId, {
        intervalMs,
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
      setStatusDetail(undefined);
    })();
    return () => {
      disposed = true;
      const id = connectionIdRef.current;
      if (id) void window.rtx.monitor.stop(id);
      connectionIdRef.current = null;
    };
    // intervalMs is read only to seed a new poller; later changes go through setInterval, so it is
    // deliberately not a dependency (changing it must not reconnect).
  }, [hostId, attempt]);

  useEffect(
    () =>
      window.rtx.monitor.onEvent((event) => {
        if (event.connectionId !== connectionIdRef.current) return;
        if (event.kind === 'sample') {
          setHistory((prev) => {
            const next = [...prev, event.sample];
            return next.length > MAX_SAMPLES ? next.slice(-MAX_SAMPLES) : next;
          });
          setStatus('sampling');
          setStatusDetail(undefined);
        } else {
          setStatus(event.status);
          setStatusDetail(event.detail);
          // A dropped transport ends this monitor; Reconnect opens a new one.
          if (event.status === 'disconnected') connectionIdRef.current = null;
        }
      }),
    [],
  );

  // Sampling runs only while the tab is visible and the user has not paused it.
  const active = tabActive && !userPaused;
  useEffect(() => {
    const id = connectionIdRef.current;
    if (conn.status === 'open' && id) window.rtx.monitor.setActive(id, active);
  }, [active, conn.status]);

  const changeInterval = useCallback((ms: number) => {
    setIntervalMs(ms);
    const id = connectionIdRef.current;
    if (id) window.rtx.monitor.setInterval(id, ms);
  }, []);

  // Keep the interface, device and filesystem selections valid as samples arrive.
  useEffect(() => {
    if (!latest) return;
    if (latest.network.state === 'ok') {
      const names = latest.network.value.map((n) => n.name);
      if (!iface || !names.includes(iface))
        setIface(defaultInterface(latest.network.value));
    }
    if (latest.diskIo.state === 'ok' && latest.diskIo.value.length > 0) {
      const names = latest.diskIo.value.map((d) => d.device);
      if (!device || !names.includes(device)) setDevice(names[0]);
    }
  }, [latest, iface, device]);

  const now = useNow(conn.status === 'open' && status === 'sampling' && active);
  const stale =
    status === 'sampling' &&
    active &&
    isStale(latest?.timestamp ?? null, now, intervalMs);

  // --- chart data ------------------------------------------------------------

  // A gap longer than the stale threshold is a hole in the data, drawn as a break in the line.
  const maxGap = staleAfterMs(intervalMs);
  const windowed = useMemo(
    () => windowSamples(history, windowMs),
    [history, windowMs],
  );
  const cpuData = useMemo(
    () => withGaps(cpuPoints(windowed), maxGap),
    [windowed, maxGap],
  );
  const memData = useMemo(
    () => withGaps(memoryPoints(windowed), maxGap),
    [windowed, maxGap],
  );
  const netTotalData = useMemo(
    () => withGaps(externalNetworkPoints(windowed), maxGap),
    [windowed, maxGap],
  );
  const netData = useMemo(
    () => withGaps(networkPoints(windowed, iface), maxGap),
    [windowed, iface, maxGap],
  );
  const ioData = useMemo(
    () => withGaps(diskIoPoints(windowed, device), maxGap),
    [windowed, device, maxGap],
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
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          {conn.progress === 'authenticating'
            ? 'Authenticating…'
            : `Connecting to ${displayName}…`}
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
          <EmptyContent className="flex-row justify-center">
            <Button onClick={() => setAttempt((n) => n + 1)}>
              <RotateCw data-icon="inline-start" />
              Try again
            </Button>
            <Button variant="outline" onClick={() => closePane(paneId)}>
              Close
            </Button>
          </EmptyContent>
        </Empty>
      </Shell>
    );

  // --- derived view state ----------------------------------------------------

  const net = latest?.network.state === 'ok' ? latest.network.value : [];
  const disks = latest?.diskIo.state === 'ok' ? latest.diskIo.value : [];
  const filesystems =
    latest?.filesystems.state === 'ok' ? latest.filesystems.value : [];
  const physical = filesystems.filter((f) => !f.pseudo);
  const shownFilesystems = showVirtual ? filesystems : physical;
  const chosenFs: FilesystemMetric | undefined =
    filesystems.find((f) => f.mountpoint === mount) ??
    physical.find((f) => f.mountpoint === '/') ??
    physical[0] ??
    filesystems[0];
  const selectedIface = net.find((n) => n.name === iface);
  const cpu = latest?.cpu.state === 'ok' ? latest.cpu.value : null;
  const memory = latest?.memory.state === 'ok' ? latest.memory.value : null;
  const processes =
    latest?.processes.state === 'ok' ? latest.processes.value : [];
  const term = processFilter.trim().toLowerCase();
  const shownProcesses = term
    ? processes.filter(
        (p) =>
          p.name.toLowerCase().includes(term) ||
          p.user.toLowerCase().includes(term) ||
          String(p.pid) === term,
      )
    : processes;
  const selectedProcess = processes.find((p) => p.pid === selectedPid);
  const totalNet = externalThroughput(net);
  const disconnected = status === 'disconnected';

  return (
    <Shell>
      {/* Host header */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b bg-chrome px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <Activity className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-medium">{displayName}</span>
          <StatusBadge
            status={status}
            stale={stale}
            paused={userPaused}
            detail={statusDetail}
          />
        </div>
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span
            className="truncate"
            title={`${conn.remote.username}@${conn.remote.host}:${conn.remote.port}`}
          >
            {conn.remote.username}@{conn.remote.host}
          </span>
          {latest?.facts.os && (
            <span className="hidden truncate lg:inline">
              · {latest.facts.os}
            </span>
          )}
          {latest?.facts.uptimeSeconds != null && (
            <span className="hidden truncate lg:inline">
              · up {formatDuration(latest.facts.uptimeSeconds)}
            </span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {latest && (
            <span className="text-xs text-muted-foreground tabular-nums">
              Updated {formatClock(latest.timestamp)}
            </span>
          )}
          <Select
            value={String(intervalMs)}
            onValueChange={(value) => changeInterval(Number(value))}
          >
            <SelectTrigger size="sm" aria-label="Sampling interval">
              <SelectValue>
                {INTERVALS.find((i) => i.ms === intervalMs)?.label}
              </SelectValue>
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
            onValueChange={(value) => setWindowMs(Number(value))}
          >
            <SelectTrigger size="sm" aria-label="History window">
              <SelectValue>
                {WINDOWS.find((w) => w.ms === windowMs)?.label}
              </SelectValue>
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
            label={userPaused ? 'Resume sampling' : 'Pause sampling'}
            onClick={() => setUserPaused((paused) => !paused)}
            disabled={disconnected}
          >
            {userPaused ? <Play /> : <Pause />}
          </IconButton>
          <IconButton
            label="Open a terminal on this host"
            onClick={openTerminalHere}
          >
            <SquareTerminal />
          </IconButton>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="flex flex-col gap-4 p-4">
          {disconnected || status === 'error' ? (
            <Alert
              variant="destructive"
              className="animate-in duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] fade-in-0"
            >
              <CircleAlert />
              <AlertTitle>
                {disconnected
                  ? 'Monitoring stopped: the connection was lost'
                  : 'The last sample could not be collected'}
              </AlertTitle>
              <AlertDescription>
                {statusDetail ??
                  'Charts keep the samples collected so far; nothing is plotted for the time without data.'}
              </AlertDescription>
              {disconnected && (
                <AlertAction>
                  <Button size="sm" onClick={() => setAttempt((n) => n + 1)}>
                    <RotateCw data-icon="inline-start" />
                    Reconnect
                  </Button>
                </AlertAction>
              )}
            </Alert>
          ) : stale ? (
            <Alert
              variant="warning"
              className="animate-in duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] fade-in-0"
            >
              <CircleAlert />
              <AlertTitle>Samples are late</AlertTitle>
              <AlertDescription>
                No sample has arrived for{' '}
                {formatDuration(
                  Math.round((now - (latest?.timestamp ?? now)) / 1000),
                )}
                . The values below are from{' '}
                {latest && formatClock(latest.timestamp)}.
              </AlertDescription>
            </Alert>
          ) : null}

          {/* Overview */}
          <MetricFrame title="Overview" description="Latest sample">
            <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
              <StatTile
                label="CPU"
                icon={<Cpu />}
                block={latest?.cpu ?? null}
                value={
                  cpu?.utilization != null
                    ? formatPercent(cpu.utilization)
                    : null
                }
                detail={
                  cpu?.loadAverage
                    ? `Load ${cpu.loadAverage.map((n) => n.toFixed(2)).join(' · ')}`
                    : undefined
                }
                trend={
                  <Sparkline
                    data={cpuData}
                    dataKey="cpu"
                    config={cpuConfig}
                    domain={[0, 100]}
                  />
                }
              />
              <StatTile
                label="Memory"
                icon={<MemoryStick />}
                block={latest?.memory ?? null}
                value={memory ? formatPercent(memory.utilization) : null}
                detail={
                  memory &&
                  `${formatBytes(memory.used)} of ${formatBytes(memory.total)}`
                }
                trend={
                  <Sparkline
                    data={memData}
                    dataKey="mem"
                    config={memConfig}
                    domain={[0, 100]}
                  />
                }
              />
              <StatTile
                label="Disk"
                icon={<HardDrive />}
                block={latest?.filesystems ?? null}
                value={chosenFs ? formatPercent(chosenFs.utilization) : null}
                detail={
                  chosenFs &&
                  `${chosenFs.mountpoint} · ${formatBytes(chosenFs.available)} free`
                }
              />
              <StatTile
                label="Network"
                icon={<Network />}
                block={latest?.network ?? null}
                value={
                  totalNet !== null ? formatBytesPerSecond(totalNet) : null
                }
                detail="All interfaces except loopback"
                trend={
                  <Sparkline
                    data={netTotalData}
                    dataKey="net"
                    config={netTotalConfig}
                  />
                }
              />
              <StatTile
                label="Processes"
                icon={<ListTree />}
                block={latest?.processes ?? null}
                value={String(processes.length)}
                detail={`${processes.filter((p) => p.state.startsWith('R')).length} running`}
              />
            </div>
          </MetricFrame>

          {/* CPU and memory */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <MetricFrame
              title="CPU"
              description="Busy time across all cores, percent"
              icon={<Cpu />}
            >
              <ChartRegion
                block={latest?.cpu ?? null}
                has={cpuData.some((p) => p.cpu !== null)}
              >
                <AreaTrend
                  data={cpuData}
                  dataKey="cpu"
                  config={cpuConfig}
                  domain={[0, 100]}
                  axisFormatter={percentAxis}
                  valueFormatter={percentValue}
                  className="aspect-auto h-44 w-full"
                />
              </ChartRegion>
              <Facts>
                {cpu?.breakdown ? (
                  <>
                    <span>User {formatPercent(cpu.breakdown.user)}</span>
                    <span>System {formatPercent(cpu.breakdown.system)}</span>
                    <span>I/O wait {formatPercent(cpu.breakdown.iowait)}</span>
                  </>
                ) : (
                  cpu && <span>Measuring…</span>
                )}
                {cpu?.cores != null && <span>{cpu.cores} cores</span>}
              </Facts>
              {cpu?.perCore && cpu.perCore.length > 1 && (
                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
                  {cpu.perCore.map((value, index) => (
                    <div
                      key={index}
                      className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums"
                    >
                      <span className="w-10 shrink-0">cpu{index}</span>
                      <Progress
                        value={value}
                        aria-label={`Core ${index} busy`}
                        className="min-w-0 flex-1"
                      />
                      <span className="w-9 shrink-0 text-end">
                        {formatPercent(value)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </MetricFrame>

            <MetricFrame
              title="Memory"
              description="In use (total − available), percent"
              icon={<MemoryStick />}
            >
              <ChartRegion
                block={latest?.memory ?? null}
                has={memData.some((p) => p.mem !== null)}
              >
                <AreaTrend
                  data={memData}
                  dataKey="mem"
                  config={memConfig}
                  domain={[0, 100]}
                  axisFormatter={percentAxis}
                  valueFormatter={percentValue}
                  className="aspect-auto h-44 w-full"
                />
              </ChartRegion>
              {memory && (
                <Facts>
                  <span>Used {formatBytes(memory.used)}</span>
                  <span>Available {formatBytes(memory.available)}</span>
                  {memory.cached !== null && (
                    <span>Cache {formatBytes(memory.cached)}</span>
                  )}
                  <span>
                    {memory.swapTotal
                      ? `Swap ${formatBytes(memory.swapUsed)} of ${formatBytes(memory.swapTotal)}`
                      : 'No swap'}
                  </span>
                </Facts>
              )}
            </MetricFrame>
          </div>

          {/* Network and disk I/O */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <MetricFrame
              title="Network"
              description={
                iface ? `Throughput on ${iface}, per second` : 'Throughput'
              }
              icon={<Network />}
              action={
                net.length > 0 && (
                  <Select
                    value={iface ?? ''}
                    onValueChange={(value) => setIface(value)}
                  >
                    <SelectTrigger size="sm" aria-label="Network interface">
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
            >
              <ChartRegion
                block={latest?.network ?? null}
                has={netData.some((p) => p.rx !== null)}
              >
                <LineTrend
                  data={netData}
                  keys={['rx', 'tx']}
                  config={netConfig}
                  axisFormatter={formatBytesCompact}
                  valueFormatter={rateValue}
                  className="aspect-auto h-48 w-full"
                />
              </ChartRegion>
              {selectedIface && (
                <Facts>
                  <span>
                    Received {formatBytes(selectedIface.receiveBytes)} ·{' '}
                    {selectedIface.receivePackets.toLocaleString()} packets
                  </span>
                  <span>
                    Sent {formatBytes(selectedIface.transmitBytes)} ·{' '}
                    {selectedIface.transmitPackets.toLocaleString()} packets
                  </span>
                  <span>
                    Errors{' '}
                    {selectedIface.receiveErrors + selectedIface.transmitErrors}{' '}
                    · Drops{' '}
                    {selectedIface.receiveDrops + selectedIface.transmitDrops}
                  </span>
                </Facts>
              )}
            </MetricFrame>

            <MetricFrame
              title="Disk I/O"
              description={
                device ? `Throughput on ${device}, per second` : 'Throughput'
              }
              icon={<HardDrive />}
              action={
                disks.length > 0 && (
                  <Select
                    value={device ?? ''}
                    onValueChange={(value) => setDevice(value)}
                  >
                    <SelectTrigger size="sm" aria-label="Disk">
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
            >
              <ChartRegion
                block={latest?.diskIo ?? null}
                has={ioData.some((p) => p.read !== null)}
              >
                <LineTrend
                  data={ioData}
                  keys={['read', 'write']}
                  config={ioConfig}
                  axisFormatter={formatBytesCompact}
                  valueFormatter={rateValue}
                  className="aspect-auto h-48 w-full"
                />
              </ChartRegion>
            </MetricFrame>
          </div>

          {/* Filesystem capacity: a different metric from I/O throughput, kept separate. */}
          <MetricFrame
            title="Filesystems"
            description="Capacity used per mount; select one to show it in the overview"
            icon={<HardDrive />}
            action={
              filesystems.length > physical.length && (
                <div className="flex items-center gap-2">
                  <Switch
                    id={`${paneId}-virtual`}
                    size="sm"
                    checked={showVirtual}
                    onCheckedChange={setShowVirtual}
                  />
                  <Label
                    htmlFor={`${paneId}-virtual`}
                    className="text-xs font-normal text-muted-foreground"
                  >
                    Virtual ({filesystems.length - physical.length})
                  </Label>
                </div>
              )
            }
          >
            {latest === null ? (
              <ChartRegion block={null} has={false}>
                {null}
              </ChartRegion>
            ) : latest.filesystems.state === 'unavailable' ? (
              <p className="text-sm text-muted-foreground">
                {latest.filesystems.reason}
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                {shownFilesystems.map((f) => {
                  const chosen = f === chosenFs;
                  return (
                    <button
                      key={`${f.filesystem}:${f.mountpoint}`}
                      type="button"
                      aria-pressed={chosen}
                      onClick={() => setMount(f.mountpoint)}
                      className="flex flex-col gap-1.5 rounded-md px-2 py-1.5 text-start transition-colors hover:bg-accent aria-pressed:bg-accent"
                    >
                      <span className="flex min-w-0 items-center gap-2 text-sm">
                        <span
                          className="truncate font-medium"
                          title={f.mountpoint}
                        >
                          {f.mountpoint}
                        </span>
                        <span
                          className="truncate text-xs text-muted-foreground"
                          title={f.filesystem}
                        >
                          {f.filesystem}
                          {f.type ? ` · ${f.type}` : ''}
                        </span>
                        {f.pseudo && <Badge variant="secondary">Virtual</Badge>}
                        <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
                          {formatBytes(f.used)} of {formatBytes(f.total)} ·{' '}
                          {formatPercent(f.utilization)}
                        </span>
                      </span>
                      <Progress
                        value={Math.min(100, f.utilization)}
                        aria-label={`${f.mountpoint} capacity used`}
                        className={
                          f.utilization >= 90
                            ? '**:data-[slot=progress-indicator]:bg-destructive'
                            : f.utilization >= 75
                              ? '**:data-[slot=progress-indicator]:bg-warning'
                              : undefined
                        }
                      />
                    </button>
                  );
                })}
              </div>
            )}
          </MetricFrame>

          {/* Processes */}
          <MetricFrame
            title="Processes"
            description={
              latest?.processes.state === 'ok'
                ? `${processes.length} on the host${term ? ` · ${shownProcesses.length} shown` : ''}`
                : undefined
            }
            icon={<ListTree />}
            flush
            action={
              <InputGroup className="w-48 bg-background">
                <InputGroupAddon>
                  <Search />
                </InputGroupAddon>
                <InputGroupInput
                  value={processFilter}
                  onChange={(event) => setProcessFilter(event.target.value)}
                  placeholder="Filter processes"
                  aria-label="Filter processes"
                />
                {processFilter && (
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      size="icon-xs"
                      aria-label="Clear filter"
                      onClick={() => setProcessFilter('')}
                    >
                      <X />
                    </InputGroupButton>
                  </InputGroupAddon>
                )}
              </InputGroup>
            }
            footer={
              selectedPid !== null && (
                <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground tabular-nums">
                  {selectedProcess ? (
                    <>
                      <span className="font-medium text-foreground">
                        PID {selectedProcess.pid}
                      </span>
                      <span>Parent {selectedProcess.ppid}</span>
                      <span>User {selectedProcess.user}</span>
                      <span>State {selectedProcess.state}</span>
                      <span>Resident {formatBytes(selectedProcess.rss)}</span>
                      <span>
                        Running {formatDuration(selectedProcess.elapsedSeconds)}
                      </span>
                      <span
                        className="min-w-0 truncate font-mono"
                        title={selectedProcess.name}
                      >
                        {selectedProcess.name}
                      </span>
                    </>
                  ) : (
                    <span>Process {selectedPid} has exited.</span>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto"
                    onClick={() => setSelectedPid(null)}
                  >
                    Clear
                  </Button>
                </div>
              )
            }
          >
            {latest === null ? (
              <div className="p-3">
                <ChartRegion block={null} has={false}>
                  {null}
                </ChartRegion>
              </div>
            ) : latest.processes.state === 'unavailable' ? (
              <p className="p-3 text-sm text-muted-foreground">
                {latest.processes.reason}
              </p>
            ) : (
              <ProcessTable
                processes={shownProcesses}
                selectedPid={selectedPid}
                onSelect={setSelectedPid}
                emptyMessage={
                  <div className="flex flex-col items-center gap-2 py-6 text-sm text-muted-foreground">
                    No processes match “{processFilter.trim()}”.
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setProcessFilter('')}
                    >
                      Clear filter
                    </Button>
                  </div>
                }
              />
            )}
          </MetricFrame>
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

/** A row of secondary facts under a chart. */
function Facts({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 pt-2 text-xs text-muted-foreground tabular-nums">
      {children}
    </div>
  );
}

/**
 * A chart's data region: a skeleton until the first sample, the metric's own reason when the host
 * cannot provide it, "Measuring…" until a rate has two samples, then the chart.
 */
function ChartRegion({
  block,
  has,
  children,
}: {
  block:
    | MetricsSample['cpu']
    | MetricsSample['memory']
    | MetricsSample['network']
    | MetricsSample['diskIo']
    | null;
  has: boolean;
  children: React.ReactNode;
}) {
  if (block === null) return <Skeleton className="h-44 w-full" />;
  if (block.state === 'unavailable')
    return (
      <div className="flex h-44 items-center justify-center px-6 text-center text-sm text-muted-foreground">
        {block.reason}
      </div>
    );
  if (!has)
    return (
      <div className="flex h-44 items-center justify-center text-sm text-muted-foreground">
        Measuring… a rate needs two samples.
      </div>
    );
  return <>{children}</>;
}

function StatusBadge({
  status,
  stale,
  paused,
  detail,
}: {
  status: MonitorStatus;
  stale: boolean;
  paused: boolean;
  detail?: string;
}) {
  if (status === 'disconnected')
    return <Badge variant="destructive-light">Disconnected</Badge>;
  if (status === 'error')
    return (
      <Badge variant="destructive-light" title={detail}>
        Error
      </Badge>
    );
  if (status === 'connecting')
    return <Badge variant="secondary">Connecting</Badge>;
  if (paused) return <Badge variant="secondary">Paused</Badge>;
  if (status === 'idle')
    return <Badge variant="secondary">Paused while hidden</Badge>;
  if (stale) return <Badge variant="warning-light">Stale</Badge>;
  return <Badge variant="success-light">Live</Badge>;
}
