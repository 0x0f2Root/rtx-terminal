import { StringDecoder } from 'node:string_decoder';
import { Client, utils, type ClientChannel, type ConnectConfig } from 'ssh2';
import type {
  SessionExit,
  SessionRuntimeInfo,
  SshErrorCode,
} from '../../shared/api';

export type { SshErrorCode };
import type { SessionBackend } from '../sessions/backend';

export type SshProgress = 'connecting' | 'authenticating' | 'connected';

/** A connection failure with a stable code the UI can act on and a message safe to show. */
export class SshConnectError extends Error {
  constructor(
    readonly code: SshErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SshConnectError';
  }
}

export type SshAuth =
  | { kind: 'agent'; socket: string }
  | { kind: 'key'; privateKey: Buffer; passphrase?: string }
  | { kind: 'password'; password: string };

export type HostKeyDecision =
  | { ok: true }
  | {
      ok: false;
      code: 'host-key-rejected' | 'host-key-changed' | 'host-key-revoked';
      message: string;
    };

export type SshConnectOptions = {
  host: string;
  port: number;
  username: string;
  auth: SshAuth;
  cols: number;
  rows: number;
  readyTimeoutMs: number;
  /** 0 turns keepalives off. */
  keepAliveMs: number;
  /** Decides whether the server's host key may be trusted. Called once per connection. */
  verifyHostKey: (key: Buffer) => Promise<HostKeyDecision>;
  onProgress?: (state: SshProgress) => void;
  signal?: AbortSignal;
};

const TERM = 'xterm-256color';

/** Checks a private key before connecting, so a wrong or missing passphrase gets its own answer. */
export function checkPrivateKey(privateKey: Buffer, passphrase?: string): void {
  const parsed = utils.parseKey(privateKey, passphrase);
  if (!(parsed instanceof Error)) return;
  const message = parsed.message;
  if (/no passphrase given/i.test(message)) {
    throw new SshConnectError(
      'passphrase-required',
      'This private key is encrypted. Enter its passphrase.',
    );
  }
  if (/bad passphrase/i.test(message)) {
    throw new SshConnectError(
      'passphrase-wrong',
      'The passphrase for this private key is not correct.',
    );
  }
  throw new SshConnectError(
    'key-file',
    'The private key file could not be used. It may be in an unsupported format.',
  );
}

function classify(
  error: Error & { code?: string; level?: string },
  host: string,
  port: number,
): SshConnectError {
  const where = `${host}:${port}`;
  switch (error.code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return new SshConnectError(
        'dns',
        `The host name "${host}" could not be resolved.`,
      );
    case 'ECONNREFUSED':
      return new SshConnectError(
        'refused',
        `${where} refused the connection. Is an SSH server running there?`,
      );
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return new SshConnectError(
        'unreachable',
        `${where} is not reachable from this network.`,
      );
    case 'ETIMEDOUT':
      return new SshConnectError(
        'timeout',
        `Connecting to ${where} timed out.`,
      );
    case 'ECONNRESET':
      return new SshConnectError(
        'network',
        `${where} closed the connection unexpectedly.`,
      );
  }
  if (error.level === 'client-timeout') {
    return new SshConnectError(
      'timeout',
      `${where} did not finish connecting in time.`,
    );
  }
  if (error.level === 'client-authentication') {
    return new SshConnectError(
      'auth',
      'Authentication failed. The server rejected the provided credentials.',
    );
  }
  if (/agent/i.test(error.message)) {
    return new SshConnectError(
      'agent',
      'The SSH agent could not be used. Check that it is running and holds a key.',
    );
  }
  return new SshConnectError(
    'protocol',
    `The SSH connection failed: ${error.message}`,
  );
}

/**
 * One SSH session: a transport plus an interactive shell channel with a PTY. Created only by
 * SshBackend.connect, which resolves once the remote shell is ready.
 */
export class SshBackend implements SessionBackend {
  readonly kind = 'ssh' as const;
  readonly pid = 0;
  private readonly decoder = new StringDecoder('utf8');
  private dataListeners: ((data: string) => void)[] = [];
  private exitListeners: ((exit: SessionExit) => void)[] = [];
  /** Output that arrived before the session manager subscribed. */
  private pending: string[] = [];
  private exitStatus: { code: number | null; signal: string | null } = {
    code: null,
    signal: null,
  };
  private failure: string | null = null;
  private closing = false;
  private finished: SessionExit | null = null;

  private constructor(
    private readonly client: Client,
    private readonly stream: ClientChannel,
  ) {
    const onData = (chunk: Buffer) => this.emitData(this.decoder.write(chunk));
    stream.on('data', onData);
    stream.stderr.on('data', onData);
    stream.on('exit', (code: number | null, signal?: string) => {
      this.exitStatus = {
        code: typeof code === 'number' ? code : null,
        signal: signal ?? null,
      };
    });
    stream.on('close', () => this.finish());
    client.on('error', (error: Error & { level?: string }) => {
      this.failure =
        error.level === 'client-timeout' || /keepalive/i.test(error.message)
          ? 'The server stopped responding (keepalive timeout).'
          : `Connection error: ${error.message}`;
    });
    client.on('close', () => this.finish());
  }

  static connect(options: SshConnectOptions): Promise<SshBackend> {
    const { host, port, username, auth } = options;
    if (auth.kind === 'key') checkPrivateKey(auth.privateKey, auth.passphrase);

    return new Promise((resolve, reject) => {
      const client = new Client();
      let settled = false;
      let hostKeyFailure: SshConnectError | null = null;

      const fail = (error: SshConnectError) => {
        if (settled) return;
        settled = true;
        options.signal?.removeEventListener('abort', onAbort);
        client.removeAllListeners();
        client.on('error', () => undefined);
        client.end();
        setTimeout(() => client.destroy(), 2000).unref();
        reject(error);
      };
      const onAbort = () =>
        fail(new SshConnectError('cancelled', 'The connection was cancelled.'));
      if (options.signal?.aborted) {
        reject(
          new SshConnectError('cancelled', 'The connection was cancelled.'),
        );
        return;
      }
      options.signal?.addEventListener('abort', onAbort, { once: true });

      // The handshake event fires once the host key was accepted and key exchange finished.
      client.on('handshake', () => options.onProgress?.('authenticating'));
      client.on('ready', () => {
        client.shell(
          { term: TERM, cols: options.cols, rows: options.rows },
          (error, stream) => {
            if (settled) {
              stream?.close();
              return;
            }
            if (error) {
              fail(
                new SshConnectError(
                  'protocol',
                  `The server refused to open a shell: ${error.message}`,
                ),
              );
              return;
            }
            settled = true;
            options.signal?.removeEventListener('abort', onAbort);
            client.removeAllListeners('error');
            client.removeAllListeners('close');
            options.onProgress?.('connected');
            resolve(new SshBackend(client, stream));
          },
        );
      });
      client.on('error', (error: Error & { code?: string; level?: string }) => {
        fail(hostKeyFailure ?? classify(error, host, port));
      });
      client.on('close', () => {
        fail(
          hostKeyFailure ??
            new SshConnectError(
              'network',
              `${host}:${port} closed the connection before the session started.`,
            ),
        );
      });
      // Servers that offer password login through keyboard-interactive (PAM) get the same password.
      client.on(
        'keyboard-interactive',
        (_name, _instructions, _lang, prompts, finish) => {
          finish(
            prompts.map(() => (auth.kind === 'password' ? auth.password : '')),
          );
        },
      );

      const config: ConnectConfig = {
        host,
        port,
        username,
        readyTimeout: options.readyTimeoutMs,
        keepaliveInterval: options.keepAliveMs,
        keepaliveCountMax: 3,
        hostVerifier: (key: Buffer, verify: (valid: boolean) => void) => {
          options.verifyHostKey(key).then(
            (decision) => {
              if (!decision.ok)
                hostKeyFailure = new SshConnectError(
                  decision.code,
                  decision.message,
                );
              verify(decision.ok);
            },
            () => {
              hostKeyFailure = new SshConnectError(
                'host-key-rejected',
                'The host key could not be verified.',
              );
              verify(false);
            },
          );
        },
      };
      if (auth.kind === 'agent') config.agent = auth.socket;
      else if (auth.kind === 'key') {
        config.privateKey = auth.privateKey;
        if (auth.passphrase) config.passphrase = auth.passphrase;
      } else {
        config.password = auth.password;
        config.tryKeyboard = true;
      }
      options.onProgress?.('connecting');
      try {
        client.connect(config);
      } catch (error) {
        fail(classify(error as Error, host, port));
      }
    });
  }

  private emitData(text: string): void {
    if (!text) return;
    if (this.dataListeners.length === 0) this.pending.push(text);
    else for (const listener of this.dataListeners) listener(text);
  }

  private finish(): void {
    if (this.finished) return;
    const rest = this.decoder.end();
    if (rest) this.emitData(rest);
    const { code, signal } = this.exitStatus;
    let reason: string;
    if (this.closing) reason = 'Disconnected.';
    else if (code !== null)
      reason = `The remote shell exited with status ${code}.`;
    else if (signal) reason = `The remote shell was ended by signal ${signal}.`;
    else
      reason =
        this.failure ??
        'The connection was closed by the server or the network.';
    this.finished = { exitCode: code ?? -1, signal: null, reason };
    for (const listener of this.exitListeners) listener(this.finished);
    this.client.end();
  }

  write(data: string): void {
    if (!this.finished) this.stream.write(data);
  }

  resize(cols: number, rows: number): void {
    if (!this.finished) this.stream.setWindow(rows, cols, 0, 0);
  }

  pause(): void {
    if (!this.finished) this.stream.pause();
  }

  resume(): void {
    if (!this.finished) this.stream.resume();
  }

  kill(): void {
    if (this.finished || this.closing) return;
    this.closing = true;
    this.stream.close();
    this.client.end();
    // If the server never acknowledges, drop the socket so nothing outlives the session.
    setTimeout(() => {
      if (!this.finished) {
        this.client.destroy();
        this.finish();
      }
    }, 3000).unref();
  }

  onData(listener: (data: string) => void): void {
    this.dataListeners.push(listener);
    const queued = this.pending;
    this.pending = [];
    for (const text of queued) listener(text);
  }

  onExit(listener: (exit: SessionExit) => void): void {
    this.exitListeners.push(listener);
    if (this.finished) listener(this.finished);
  }

  async runtimeInfo(): Promise<SessionRuntimeInfo> {
    // A remote shell's directory and foreground process are not observable over SSH.
    return { cwd: null, foregroundProcess: null };
  }
}

export const SSH_TERM = TERM;
