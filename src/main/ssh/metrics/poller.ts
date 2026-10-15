import type { MetricsSample, MonitorStatus } from '../../../shared/remote';
import { MONITOR_INTERVAL } from '../../../shared/remote';
import type { SshConnection } from '../ssh-connection';
import { MetricsCollector } from './collector';

/**
 * Drives one host's sampling on a single coordinated schedule: one exec per tick, never
 * overlapping, with obsolete results discarded after a stop. Pausing (for a hidden view) keeps the
 * collector's counters so throughput stays correct when it resumes. The poller owns no transport;
 * the connection is shared with the file manager and ended elsewhere by reference count.
 */

export type PollerListeners = {
  onSample(sample: MetricsSample): void;
  onStatus(status: MonitorStatus, detail?: string): void;
};

function clampInterval(ms: number): number {
  if (!Number.isFinite(ms)) return MONITOR_INTERVAL.default;
  return Math.min(MONITOR_INTERVAL.max, Math.max(MONITOR_INTERVAL.min, ms));
}

export class MetricsPoller {
  private readonly collector: MetricsCollector;
  private interval: number;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private inFlight = false;
  private paused = false;
  /** Bumped on stop so a late result from a previous run is ignored. */
  private generation = 0;

  constructor(
    connection: SshConnection,
    private readonly connectionId: string,
    private readonly listeners: PollerListeners,
    intervalMs: number = MONITOR_INTERVAL.default,
  ) {
    this.collector = new MetricsCollector(connection, connectionId);
    this.interval = clampInterval(intervalMs);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.listeners.onStatus('sampling');
    void this.tick();
    this.schedule();
  }

  setInterval(ms: number): void {
    this.interval = clampInterval(ms);
    if (this.running && !this.paused) this.schedule();
  }

  /** Stops issuing new ticks but keeps counters, so resuming does not restart throughput history. */
  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.clearTimer();
    if (this.running) this.listeners.onStatus('idle');
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    if (this.running) {
      this.listeners.onStatus('sampling');
      void this.tick();
      this.schedule();
    }
  }

  stop(): void {
    this.running = false;
    this.generation += 1;
    this.clearTimer();
  }

  get isRunning(): boolean {
    return this.running;
  }

  private schedule(): void {
    this.clearTimer();
    if (!this.running || this.paused) return;
    this.timer = setInterval(() => void this.tick(), this.interval);
    this.timer.unref();
  }

  private clearTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    if (!this.running || this.paused || this.inFlight) return;
    this.inFlight = true;
    const generation = this.generation;
    try {
      const sample = await this.collector.collect({
        timeoutMs: this.interval + 6000,
      });
      // A result that arrives after a stop (or from a superseded run) is dropped.
      if (generation !== this.generation || !this.running) return;
      this.listeners.onSample(sample);
    } catch (error) {
      if (generation !== this.generation || !this.running) return;
      const message = error instanceof Error ? error.message : String(error);
      this.listeners.onStatus(
        /closed|lost|ECONN|timed out/i.test(message) ? 'disconnected' : 'error',
        message,
      );
    } finally {
      this.inFlight = false;
    }
  }
}
