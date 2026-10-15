import type {
  SessionExit,
  SessionKind,
  SessionRuntimeInfo,
} from '../../shared/api';

/**
 * One running terminal session, independent of where its process lives. The local PTY backend is
 * the only implementation today; an SSH backend will implement the same contract so the session
 * manager, IPC and renderer stay unchanged.
 */
export interface SessionBackend {
  readonly kind: SessionKind;
  readonly pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  /** Stops reading output until resume(); used for flow control when the renderer falls behind. */
  pause(): void;
  resume(): void;
  /** Ends the session. Safe to call more than once. */
  kill(): void;
  onData(listener: (data: string) => void): void;
  onExit(listener: (exit: SessionExit) => void): void;
  runtimeInfo(): Promise<SessionRuntimeInfo>;
}
