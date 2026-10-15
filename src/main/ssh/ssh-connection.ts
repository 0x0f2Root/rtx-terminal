import {
  Client,
  type ClientChannel,
  type ConnectConfig,
  type SFTPWrapper,
} from 'ssh2';
import {
  checkPrivateKey,
  classify,
  SshConnectError,
  type HostKeyDecision,
  type SshAuth,
  type SshProgress,
} from './ssh-backend';

/**
 * One SSH transport (an ssh2 Client) with no interactive shell, used by the file manager and the
 * resource monitor. Channels are opened on top of it on demand: an SFTP subsystem for file
 * operations and short-lived exec channels for metric collection. Each of those has its own
 * lifecycle, so closing one never disturbs the others or the terminal.
 *
 * Consumers reference the transport by token (acquire/release). The client is ended only when the
 * last consumer releases it, so a single persistent connection is shared rather than reopened per
 * operation or per poll.
 */

export type SshConnectionOptions = {
  host: string;
  port: number;
  username: string;
  auth: SshAuth;
  readyTimeoutMs: number;
  /** 0 turns keepalives off. */
  keepAliveMs: number;
  verifyHostKey: (key: Buffer) => Promise<HostKeyDecision>;
  onProgress?: (state: SshProgress) => void;
  signal?: AbortSignal;
};

export class SshConnection {
  private readonly refs = new Set<string>();
  private closed = false;
  private closeReason: string | null = null;
  private readonly closeListeners = new Set<(reason: string | null) => void>();

  private constructor(
    private readonly client: Client,
    private readonly host: string,
    private readonly port: number,
  ) {
    client.on('error', (error: Error & { level?: string }) => {
      this.closeReason =
        error.level === 'client-timeout' || /keepalive/i.test(error.message)
          ? 'The server stopped responding (keepalive timeout).'
          : `The connection failed: ${error.message}`;
    });
    client.on('close', () => this.markClosed());
    client.on('end', () => this.markClosed());
  }

  static connect(options: SshConnectionOptions): Promise<SshConnection> {
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

      client.on('handshake', () => options.onProgress?.('authenticating'));
      client.on('ready', () => {
        if (settled) return;
        settled = true;
        options.signal?.removeEventListener('abort', onAbort);
        // Keep the long-lived error/close handlers from the constructor; drop the connect ones.
        client.removeAllListeners('ready');
        client.removeAllListeners('handshake');
        client.removeAllListeners('error');
        client.removeAllListeners('close');
        const connection = new SshConnection(client, host, port);
        options.onProgress?.('connected');
        resolve(connection);
      });
      client.on('error', (error: Error & { code?: string; level?: string }) => {
        fail(hostKeyFailure ?? classify(error, host, port));
      });
      client.on('close', () => {
        fail(
          hostKeyFailure ??
            new SshConnectError(
              'network',
              `${host}:${port} closed the connection before it was ready.`,
            ),
        );
      });
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

  acquire(token: string): void {
    this.refs.add(token);
  }

  /** Drops one consumer. When the last one lets go, the transport is closed. */
  release(token: string): void {
    if (!this.refs.delete(token)) return;
    if (this.refs.size === 0) this.end();
  }

  get refCount(): number {
    return this.refs.size;
  }

  get isOpen(): boolean {
    return !this.closed;
  }

  /** Reason the transport closed, once it has; null while open or when it closed cleanly. */
  get reason(): string | null {
    return this.closeReason;
  }

  onClose(listener: (reason: string | null) => void): () => void {
    if (this.closed) {
      listener(this.closeReason);
      return () => undefined;
    }
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  /** Opens an SFTP subsystem on this transport. Each call is an independent channel. */
  openSftp(): Promise<SFTPWrapper> {
    return new Promise((resolve, reject) => {
      if (this.closed) {
        reject(
          new SshConnectError(
            'network',
            this.closeReason ?? 'The connection is closed.',
          ),
        );
        return;
      }
      this.client.sftp((error, sftp) => {
        if (error || !sftp) {
          reject(
            error ??
              new SshConnectError('protocol', 'The server refused SFTP.'),
          );
          return;
        }
        resolve(sftp);
      });
    });
  }

  /** Runs one fixed command on a fresh exec channel. The caller reads stdout/stderr and closes it. */
  exec(command: string): Promise<ClientChannel> {
    return new Promise((resolve, reject) => {
      if (this.closed) {
        reject(
          new SshConnectError(
            'network',
            this.closeReason ?? 'The connection is closed.',
          ),
        );
        return;
      }
      this.client.exec(command, {}, (error, channel) => {
        if (error || !channel) {
          reject(
            error ??
              new SshConnectError('protocol', 'The command could not run.'),
          );
          return;
        }
        resolve(channel);
      });
    });
  }

  /** Ends the transport regardless of reference count; used on shutdown. */
  end(): void {
    if (this.closed) return;
    this.client.end();
    setTimeout(() => {
      if (!this.closed) {
        this.client.destroy();
        this.markClosed();
      }
    }, 2000).unref();
  }

  private markClosed(): void {
    if (this.closed) return;
    this.closed = true;
    this.refs.clear();
    for (const listener of this.closeListeners) listener(this.closeReason);
    this.closeListeners.clear();
  }
}
