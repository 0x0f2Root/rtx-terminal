import { promises as fs } from 'node:fs';
import type { IPty } from 'node-pty';
import type { SessionExit, SessionRuntimeInfo } from '../../shared/api';
import type { SessionBackend } from './backend';

export type LocalPtyOptions = {
  shell: string;
  cwd: string;
  cols: number;
  rows: number;
  appVersion: string;
};

/** Environment for the child shell: the user's own, minus what Electron injected for itself. */
function shellEnvironment(appVersion: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (
      key.startsWith('ELECTRON_') ||
      key === 'CHROME_DESKTOP' ||
      key === 'GOOGLE_API_KEY'
    )
      continue;
    env[key] = value;
  }
  // Electron rewrites XDG_CURRENT_DESKTOP on Linux and keeps the original aside; give shells the real one.
  if (env.ORIGINAL_XDG_CURRENT_DESKTOP) {
    env.XDG_CURRENT_DESKTOP = env.ORIGINAL_XDG_CURRENT_DESKTOP;
    delete env.ORIGINAL_XDG_CURRENT_DESKTOP;
  }
  env.TERM = 'xterm-256color';
  env.COLORTERM = 'truecolor';
  env.TERM_PROGRAM = 'rtx-terminal';
  env.TERM_PROGRAM_VERSION = appVersion;
  return env;
}

export class LocalPtyBackend implements SessionBackend {
  readonly kind = 'local' as const;
  private readonly pty: IPty;
  private exited = false;

  private constructor(pty: IPty) {
    this.pty = pty;
    this.pty.onExit(() => {
      this.exited = true;
    });
  }

  /** Loads node-pty lazily so a broken native module surfaces as a session error, not a crash. */
  static async spawn(options: LocalPtyOptions): Promise<LocalPtyBackend> {
    const nodePty = await import('node-pty');
    const pty = nodePty.spawn(options.shell, [], {
      name: 'xterm-256color',
      cols: options.cols,
      rows: options.rows,
      cwd: options.cwd,
      env: shellEnvironment(options.appVersion),
      encoding: 'utf8',
    });
    return new LocalPtyBackend(pty);
  }

  get pid(): number {
    return this.pty.pid;
  }

  write(data: string): void {
    if (!this.exited) this.pty.write(data);
  }

  resize(cols: number, rows: number): void {
    if (this.exited) return;
    try {
      this.pty.resize(cols, rows);
    } catch {
      // The process can exit between the check and the ioctl; nothing to resize then.
    }
  }

  pause(): void {
    if (!this.exited) this.pty.pause();
  }

  resume(): void {
    if (!this.exited) this.pty.resume();
  }

  kill(): void {
    if (this.exited) return;
    try {
      // SIGHUP is what a terminal sends when it closes; shells forward it to their jobs.
      this.pty.kill('SIGHUP');
    } catch {
      // Already gone.
    }
    const pid = this.pty.pid;
    setTimeout(() => {
      if (this.exited) return;
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Already gone.
      }
    }, 3000).unref();
  }

  onData(listener: (data: string) => void): void {
    this.pty.onData(listener);
  }

  onExit(listener: (exit: SessionExit) => void): void {
    this.pty.onExit(({ exitCode, signal }) =>
      listener({ exitCode, signal: signal ?? null }),
    );
  }

  async runtimeInfo(): Promise<SessionRuntimeInfo> {
    if (this.exited) return { cwd: null, foregroundProcess: null };
    const cwd = await fs
      .readlink(`/proc/${this.pty.pid}/cwd`)
      .catch(() => null);
    let foregroundProcess: string | null = null;
    try {
      foregroundProcess = this.pty.process || null;
    } catch {
      foregroundProcess = null;
    }
    return { cwd, foregroundProcess };
  }
}
