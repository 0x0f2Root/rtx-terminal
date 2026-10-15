import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import type { WebContents } from 'electron';
import {
  IPC,
  type CreateSessionRequest,
  type CreateSessionResult,
  type SessionInfo,
  type SessionRuntimeInfo,
  type SshCreateRequest,
} from '../../shared/api';
import { isDirectory, resolveShell } from '../shells';
import { SshConnectError } from '../ssh/ssh-backend';
import {
  openSshSession,
  type HostKeyPrompts,
  type SshEnvironment,
} from '../ssh/ssh-sessions';
import type { SessionBackend } from './backend';
import { LocalPtyBackend } from './local-pty';

/** Output is coalesced for this long before one IPC message carries it to the renderer. */
const FLUSH_INTERVAL_MS = 5;
const FLUSH_SIZE = 64 * 1024;
/** Flow control: pause the process when this much output is unacknowledged, resume below LOW. */
const HIGH_WATERMARK = 512 * 1024;
const LOW_WATERMARK = 128 * 1024;
const MAX_SESSIONS_PER_WINDOW = 64;

/** The parts of a WebContents the manager uses; tests pass a stand-in. */
export type SessionOwner = Pick<
  WebContents,
  'id' | 'send' | 'isDestroyed' | 'once' | 'on'
>;

type Session = {
  info: SessionInfo;
  backend: SessionBackend;
  owner: SessionOwner;
  buffer: string;
  flushTimer: NodeJS.Timeout | null;
  unacked: number;
  paused: boolean;
  exited: Promise<void>;
};

type PendingConnect = { ownerId: number; controller: AbortController };

export type SshSupport = { env: SshEnvironment; prompts: HostKeyPrompts };

export class SessionManager {
  private readonly sessions = new Map<string, Session>();
  private readonly trackedOwners = new Set<number>();
  /** SSH connection attempts in flight, by the renderer's request id. */
  private readonly connecting = new Map<string, PendingConnect>();

  constructor(
    private readonly appVersion: string,
    private readonly ssh: SshSupport | null = null,
  ) {}

  async create(
    owner: SessionOwner,
    request: CreateSessionRequest,
    configuredShell: string | null,
  ): Promise<CreateSessionResult> {
    if (
      this.countFor(owner) + this.connectingFor(owner) >=
      MAX_SESSIONS_PER_WINDOW
    ) {
      return {
        ok: false,
        error: `This window already has ${MAX_SESSIONS_PER_WINDOW} sessions open.`,
      };
    }
    if (request.ssh)
      return this.createSsh(owner, request.ssh, request.cols, request.rows);

    const shell = await resolveShell(request.shell ?? null, configuredShell);
    if (!shell.ok) return shell;

    const home = os.homedir();
    let cwd = home;
    if (request.cwd) {
      if (!(await isDirectory(request.cwd))) {
        return {
          ok: false,
          error: `Working directory "${request.cwd}" does not exist.`,
        };
      }
      cwd = request.cwd;
    }

    let backend: SessionBackend;
    try {
      backend = await LocalPtyBackend.spawn({
        shell: shell.shell,
        cwd,
        cols: request.cols,
        rows: request.rows,
        appVersion: this.appVersion,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { ok: false, error: `Could not start ${shell.shell}: ${reason}` };
    }

    return {
      ok: true,
      session: this.register(owner, backend, {
        id: randomUUID(),
        kind: backend.kind,
        shell: shell.shell,
        shellName: path.basename(shell.shell),
        cwd,
        pid: backend.pid,
      }),
    };
  }

  private async createSsh(
    owner: SessionOwner,
    request: SshCreateRequest,
    cols: number,
    rows: number,
  ): Promise<CreateSessionResult> {
    if (!this.ssh)
      return { ok: false, error: 'SSH is not available.', code: 'protocol' };
    // One attempt per request id: repeated clicks or a double submit cannot open two transports.
    if (this.connecting.has(request.requestId)) {
      return {
        ok: false,
        error: 'This connection is already being opened.',
        code: 'cancelled',
      };
    }
    const controller = new AbortController();
    this.connecting.set(request.requestId, { ownerId: owner.id, controller });
    this.trackOwner(owner);
    const { env, prompts } = this.ssh;
    try {
      const opened = await openSshSession(request, cols, rows, env, {
        signal: controller.signal,
        askHostKey: (prompt) =>
          prompts.ask(owner, IPC.sshHostKeyPrompt, prompt),
        onProgress: (state) => {
          if (!owner.isDestroyed())
            owner.send(IPC.sshProgress, request.requestId, state);
        },
      });
      if (controller.signal.aborted || owner.isDestroyed()) {
        opened.backend.kill();
        return {
          ok: false,
          error: 'The connection was cancelled.',
          code: 'cancelled',
        };
      }
      const { remote } = opened;
      return {
        ok: true,
        session: this.register(owner, opened.backend, {
          id: randomUUID(),
          kind: 'ssh',
          shell: 'ssh',
          shellName: opened.label,
          cwd: '',
          pid: 0,
          remote,
        }),
      };
    } catch (error) {
      if (error instanceof SshConnectError)
        return { ok: false, error: error.message, code: error.code };
      // Unexpected failures are reported without their internals, which may include paths.
      return {
        ok: false,
        error: 'The SSH connection could not be opened.',
        code: 'protocol',
      };
    } finally {
      this.connecting.delete(request.requestId);
    }
  }

  /** Aborts an SSH attempt that has not finished; only the window that started it may. */
  cancel(owner: SessionOwner, requestId: string): void {
    const pending = this.connecting.get(requestId);
    if (pending && pending.ownerId === owner.id) pending.controller.abort();
  }

  private register(
    owner: SessionOwner,
    backend: SessionBackend,
    info: SessionInfo,
  ): SessionInfo {
    let resolveExited: () => void = () => undefined;
    const session: Session = {
      info,
      backend,
      owner,
      buffer: '',
      flushTimer: null,
      unacked: 0,
      paused: false,
      exited: new Promise((resolve) => {
        resolveExited = resolve;
      }),
    };
    this.sessions.set(info.id, session);
    this.trackOwner(owner);

    backend.onData((data) => this.enqueue(session, data));
    backend.onExit((exit) => {
      this.flush(session);
      this.send(session, IPC.terminalExit, info.id, exit);
      this.sessions.delete(info.id);
      resolveExited();
    });
    return info;
  }

  write(owner: SessionOwner, id: string, data: string): void {
    this.owned(owner, id)?.backend.write(data);
  }

  resize(owner: SessionOwner, id: string, cols: number, rows: number): void {
    this.owned(owner, id)?.backend.resize(cols, rows);
  }

  ack(owner: SessionOwner, id: string, bytes: number): void {
    const session = this.owned(owner, id);
    if (!session) return;
    session.unacked = Math.max(0, session.unacked - bytes);
    if (session.paused && session.unacked < LOW_WATERMARK) {
      session.paused = false;
      session.backend.resume();
    }
  }

  async close(owner: SessionOwner, id: string): Promise<void> {
    const session = this.owned(owner, id);
    if (!session) return;
    session.backend.kill();
    await session.exited;
  }

  async runtimeInfo(
    owner: SessionOwner,
    id: string,
  ): Promise<SessionRuntimeInfo | null> {
    const session = this.owned(owner, id);
    return session ? session.backend.runtimeInfo() : null;
  }

  /** Ends every session and pending connection, waiting up to `timeoutMs` for them to close. */
  async closeAll(timeoutMs = 2000): Promise<void> {
    for (const pending of this.connecting.values()) pending.controller.abort();
    const all = [...this.sessions.values()];
    for (const session of all) session.backend.kill();
    await Promise.race([
      Promise.all(all.map((s) => s.exited)),
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
    // A local shell still alive ignored SIGHUP; do not leave it behind. SSH sessions have no
    // local process (pid 0), and process.kill(0) would signal this app's whole process group.
    for (const session of this.sessions.values()) {
      if (session.info.kind !== 'local' || session.info.pid <= 0) continue;
      try {
        process.kill(session.info.pid, 'SIGKILL');
      } catch {
        // Already gone.
      }
    }
  }

  get size(): number {
    return this.sessions.size + this.connecting.size;
  }

  /** Sessions are only reachable from the window that created them. */
  private owned(owner: SessionOwner, id: string): Session | undefined {
    const session = this.sessions.get(id);
    return session && session.owner.id === owner.id ? session : undefined;
  }

  private countFor(owner: SessionOwner): number {
    let count = 0;
    for (const session of this.sessions.values())
      if (session.owner.id === owner.id) count++;
    return count;
  }

  private connectingFor(owner: SessionOwner): number {
    let count = 0;
    for (const pending of this.connecting.values())
      if (pending.ownerId === owner.id) count++;
    return count;
  }

  private trackOwner(owner: SessionOwner): void {
    if (this.trackedOwners.has(owner.id)) return;
    this.trackedOwners.add(owner.id);
    const ownerId = owner.id;
    const release = () => {
      for (const pending of this.connecting.values()) {
        if (pending.ownerId === ownerId) pending.controller.abort();
      }
      this.ssh?.prompts.rejectAllFor(ownerId);
      for (const session of this.sessions.values()) {
        if (session.owner.id === ownerId) session.backend.kill();
      }
    };
    owner.once('destroyed', () => {
      this.trackedOwners.delete(ownerId);
      release();
    });
    // A reload starts a fresh renderer that cannot reach the old sessions, so end them.
    owner.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) release();
    });
  }

  private enqueue(session: Session, data: string): void {
    session.buffer += data;
    session.unacked += data.length;
    if (!session.paused && session.unacked > HIGH_WATERMARK) {
      session.paused = true;
      session.backend.pause();
    }
    if (session.buffer.length >= FLUSH_SIZE) {
      this.flush(session);
    } else if (!session.flushTimer) {
      session.flushTimer = setTimeout(
        () => this.flush(session),
        FLUSH_INTERVAL_MS,
      );
    }
  }

  private flush(session: Session): void {
    if (session.flushTimer) {
      clearTimeout(session.flushTimer);
      session.flushTimer = null;
    }
    if (!session.buffer) return;
    const chunk = session.buffer;
    session.buffer = '';
    this.send(session, IPC.terminalData, session.info.id, chunk);
  }

  private send(session: Session, channel: string, ...args: unknown[]): void {
    if (!session.owner.isDestroyed()) session.owner.send(channel, ...args);
  }
}
