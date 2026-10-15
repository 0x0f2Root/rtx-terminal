import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  IPC,
  type RemoteEndpoint,
  type RemoteOpenRequest,
  type RemoteOpenResult,
  type TransferRequest,
} from '../../shared/api';
import type {
  ConflictResolution,
  MonitorEvent,
  RemoteListing,
  RemoteResult,
  RemoteStat,
  TransferProgress,
} from '../../shared/remote';
import type { SessionOwner } from '../sessions/session-manager';
import { SshConnectError } from './ssh-backend';
import type { SshConnection } from './ssh-connection';
import {
  openSshConnection,
  type HostKeyPrompts,
  type SshEnvironment,
} from './ssh-sessions';
import { RemoteFileError, SftpService } from './sftp-service';
import { TransferManager } from './transfer-manager';
import { MetricsPoller } from './metrics/poller';

/**
 * Owns the file manager and resource monitor side of SSH. A transport is shared per window+host and
 * reference counted; each file view or monitor is a logical connection on top of it with its own
 * SFTP channel or poller, so their lifecycles are independent of one another and of the terminal.
 * Closing the last consumer ends the transport. A dropped transport is reported to every consumer.
 */

const MAX_CONNECTIONS_PER_WINDOW = 32;

type Transport = {
  key: string;
  ownerId: number;
  connection: SshConnection;
  remote: RemoteEndpoint;
  label: string;
  consumers: Set<string>;
  offClose: () => void;
};

type FileConnection = {
  kind: 'files';
  id: string;
  ownerId: number;
  transportKey: string;
  owner: SessionOwner;
  sftp: SftpService;
  transfers: TransferManager;
};

type MonitorConnection = {
  kind: 'monitor';
  id: string;
  ownerId: number;
  transportKey: string;
  owner: SessionOwner;
  poller: MetricsPoller;
};

type Connection = FileConnection | MonitorConnection;

export type RemoteSupport = { env: SshEnvironment; prompts: HostKeyPrompts };

export class RemoteManager {
  private readonly transports = new Map<string, Transport>();
  private readonly connectingTransport = new Map<string, Promise<Transport>>();
  private readonly connections = new Map<string, Connection>();
  private readonly trackedOwners = new Set<number>();
  private readonly aborters = new Map<string, AbortController>();

  constructor(private readonly support: RemoteSupport) {}

  // --- opening ----------------------------------------------------------------------------

  async openFiles(
    owner: SessionOwner,
    request: RemoteOpenRequest,
  ): Promise<RemoteOpenResult> {
    return this.open(owner, request, (transport, id) => {
      const sftp = new SftpService(transport.connection);
      const transfers = new TransferManager(id, sftp, (progress) =>
        this.sendTransfer(owner, progress),
      );
      const connection: FileConnection = {
        kind: 'files',
        id,
        ownerId: owner.id,
        transportKey: transport.key,
        owner,
        sftp,
        transfers,
      };
      return connection;
    });
  }

  async openMonitor(
    owner: SessionOwner,
    request: RemoteOpenRequest,
  ): Promise<RemoteOpenResult> {
    return this.open(owner, request, (transport, id) => {
      const poller = new MetricsPoller(
        transport.connection,
        id,
        {
          onSample: (sample) =>
            this.sendMonitor(owner, {
              connectionId: id,
              kind: 'sample',
              sample,
            }),
          onStatus: (status, detail) =>
            this.sendMonitor(owner, {
              connectionId: id,
              kind: 'status',
              status,
              ...(detail ? { detail } : {}),
            }),
        },
        request.intervalMs,
      );
      const connection: MonitorConnection = {
        kind: 'monitor',
        id,
        ownerId: owner.id,
        transportKey: transport.key,
        owner,
        poller,
      };
      poller.start();
      return connection;
    });
  }

  private async open(
    owner: SessionOwner,
    request: RemoteOpenRequest,
    build: (transport: Transport, id: string) => Connection,
  ): Promise<RemoteOpenResult> {
    if (this.countFor(owner.id) >= MAX_CONNECTIONS_PER_WINDOW)
      return { ok: false, error: 'Too many remote connections are open.' };
    this.trackOwner(owner);
    try {
      const transport = await this.ensureTransport(owner, request);
      if (owner.isDestroyed()) {
        this.releaseTransport(transport, 'pending');
        return {
          ok: false,
          error: 'The window was closed.',
          code: 'cancelled',
        };
      }
      const id = randomUUID();
      transport.connection.acquire(id);
      transport.consumers.add(id);
      this.connections.set(id, build(transport, id));
      return {
        ok: true,
        connectionId: id,
        remote: transport.remote,
        label: transport.label,
      };
    } catch (error) {
      if (error instanceof SshConnectError)
        return { ok: false, error: error.message, code: error.code };
      return {
        ok: false,
        error: 'The connection could not be opened.',
        code: 'protocol',
      };
    }
  }

  /** Reuses a live transport for this window+host, or opens one. Concurrent opens share the attempt. */
  private async ensureTransport(
    owner: SessionOwner,
    request: RemoteOpenRequest,
  ): Promise<Transport> {
    const key = `${owner.id}:${request.hostId}`;
    const existing = this.transports.get(key);
    if (existing && existing.connection.isOpen) return existing;
    const pending = this.connectingTransport.get(key);
    if (pending) return pending;

    const controller = new AbortController();
    this.aborters.set(key, controller);
    const attempt = openSshConnection(
      {
        hostId: request.hostId,
        requestId: request.requestId,
        password: request.password,
        passphrase: request.passphrase,
        saveSecret: request.saveSecret,
      },
      this.support.env,
      {
        signal: controller.signal,
        askHostKey: (prompt) =>
          this.support.prompts.ask(owner, IPC.sshHostKeyPrompt, prompt),
        onProgress: (state) => {
          if (!owner.isDestroyed())
            owner.send(IPC.sshProgress, request.requestId, state);
        },
      },
    )
      .then((opened): Transport => {
        const transport: Transport = {
          key,
          ownerId: owner.id,
          connection: opened.connection,
          remote: opened.remote,
          label: opened.label,
          consumers: new Set(),
          offClose: () => undefined,
        };
        transport.offClose = opened.connection.onClose((reason) =>
          this.onTransportClosed(transport, reason),
        );
        this.transports.set(key, transport);
        return transport;
      })
      .finally(() => {
        this.connectingTransport.delete(key);
        this.aborters.delete(key);
      });
    this.connectingTransport.set(key, attempt);
    return attempt;
  }

  // --- file operations --------------------------------------------------------------------

  async home(
    owner: SessionOwner,
    connectionId: string,
  ): Promise<RemoteResult<{ path: string }>> {
    return this.fileOp(owner, connectionId, async (c) => ({
      path: await c.sftp.home(),
    }));
  }

  async list(
    owner: SessionOwner,
    connectionId: string,
    path: string,
  ): Promise<RemoteResult<{ listing: RemoteListing }>> {
    return this.fileOp(owner, connectionId, async (c) => ({
      listing: await c.sftp.list(path),
    }));
  }

  async stat(
    owner: SessionOwner,
    connectionId: string,
    path: string,
  ): Promise<RemoteResult<{ stat: RemoteStat }>> {
    return this.fileOp(owner, connectionId, async (c) => ({
      stat: await c.sftp.stat(path),
    }));
  }

  async mkdir(
    owner: SessionOwner,
    connectionId: string,
    parent: string,
    name: string,
  ): Promise<RemoteResult<{ path: string }>> {
    return this.fileOp(owner, connectionId, async (c) => {
      const target = joinRemote(parent, name);
      await c.sftp.mkdir(target);
      return { path: target };
    });
  }

  async rename(
    owner: SessionOwner,
    connectionId: string,
    from: string,
    to: string,
  ): Promise<RemoteResult<{ path: string }>> {
    return this.fileOp(owner, connectionId, async (c) => {
      await c.sftp.rename(from, to);
      return { path: to };
    });
  }

  async remove(
    owner: SessionOwner,
    connectionId: string,
    path: string,
    kind: 'file' | 'directory',
    recursive: boolean,
  ): Promise<RemoteResult<{ removed: true }>> {
    return this.fileOp(owner, connectionId, async (c) => {
      if (kind === 'file') await c.sftp.removeFile(path);
      else if (recursive) await c.sftp.removeTree(path);
      else await c.sftp.removeEmptyDir(path);
      return { removed: true as const };
    });
  }

  async transfer(
    owner: SessionOwner,
    request: TransferRequest,
    direction: 'upload' | 'download',
  ): Promise<RemoteResult<{ ids: string[] }>> {
    return this.fileOp(owner, request.connectionId, async (c) => {
      const ids: string[] = [];
      for (const source of request.sources) {
        const name =
          direction === 'download' ? baseName(source) : localBaseName(source);
        const spec = {
          direction,
          localPath:
            direction === 'download'
              ? joinLocal(request.destinationDir, name)
              : source,
          remotePath:
            direction === 'download'
              ? source
              : joinRemote(request.destinationDir, name),
          size: null,
          conflict: request.conflict as ConflictResolution,
        };
        const expanded = await c.transfers.expand(spec);
        for (const item of expanded) ids.push(c.transfers.enqueue(item));
      }
      return { ids };
    });
  }

  cancelTransfer(
    owner: SessionOwner,
    connectionId: string,
    transferId: string,
  ): void {
    const c = this.fileConnection(owner, connectionId);
    c?.transfers.cancel(transferId);
  }

  retryTransfer(
    owner: SessionOwner,
    connectionId: string,
    transferId: string,
  ): void {
    const c = this.fileConnection(owner, connectionId);
    c?.transfers.retry(transferId);
  }

  // --- monitor controls -------------------------------------------------------------------

  setMonitorInterval(
    owner: SessionOwner,
    connectionId: string,
    ms: number,
  ): void {
    const c = this.monitorConnection(owner, connectionId);
    c?.poller.setInterval(ms);
  }

  setMonitorActive(
    owner: SessionOwner,
    connectionId: string,
    active: boolean,
  ): void {
    const c = this.monitorConnection(owner, connectionId);
    if (!c) return;
    if (active) c.poller.resume();
    else c.poller.pause();
  }

  // --- closing + cleanup ------------------------------------------------------------------

  close(owner: SessionOwner, connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (!connection || connection.ownerId !== owner.id) return;
    this.teardownConnection(connection);
  }

  get size(): number {
    return this.connections.size;
  }

  private teardownConnection(connection: Connection): void {
    if (connection.kind === 'files') {
      connection.transfers.dispose();
      connection.sftp.close();
    } else {
      connection.poller.stop();
    }
    this.connections.delete(connection.id);
    const transport = this.transports.get(connection.transportKey);
    if (transport) {
      transport.consumers.delete(connection.id);
      transport.connection.release(connection.id);
      if (transport.consumers.size === 0) {
        transport.offClose();
        this.transports.delete(transport.key);
      }
    }
  }

  private releaseTransport(transport: Transport, token: string): void {
    transport.connection.release(token);
    if (transport.consumers.size === 0) {
      transport.offClose();
      this.transports.delete(transport.key);
    }
  }

  private onTransportClosed(transport: Transport, reason: string | null): void {
    this.transports.delete(transport.key);
    const affected = Array.from(this.connections.values());
    for (const connection of affected) {
      if (connection.transportKey !== transport.key) continue;
      if (connection.kind === 'files') {
        connection.transfers.dispose();
        connection.sftp.close();
        this.sendClosed(connection.owner, connection.id, reason);
      } else {
        connection.poller.stop();
        this.sendMonitor(connection.owner, {
          connectionId: connection.id,
          kind: 'status',
          status: 'disconnected',
          ...(reason ? { detail: reason } : {}),
        });
      }
      this.connections.delete(connection.id);
    }
  }

  private async fileOp<T>(
    owner: SessionOwner,
    connectionId: string,
    run: (connection: FileConnection) => Promise<T>,
  ): Promise<RemoteResult<T>> {
    const connection = this.fileConnection(owner, connectionId);
    if (!connection)
      return {
        ok: false,
        code: 'disconnected',
        error: 'This file view is closed.',
      };
    try {
      const value = await run(connection);
      return { ok: true, ...value };
    } catch (error) {
      if (error instanceof RemoteFileError)
        return { ok: false, code: error.code, error: error.message };
      return {
        ok: false,
        code: 'io',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private fileConnection(
    owner: SessionOwner,
    connectionId: string,
  ): FileConnection | null {
    const connection = this.connections.get(connectionId);
    return connection &&
      connection.kind === 'files' &&
      connection.ownerId === owner.id
      ? connection
      : null;
  }

  private monitorConnection(
    owner: SessionOwner,
    connectionId: string,
  ): MonitorConnection | null {
    const connection = this.connections.get(connectionId);
    return connection &&
      connection.kind === 'monitor' &&
      connection.ownerId === owner.id
      ? connection
      : null;
  }

  private countFor(ownerId: number): number {
    let count = 0;
    for (const connection of this.connections.values())
      if (connection.ownerId === ownerId) count++;
    return count;
  }

  private sendTransfer(owner: SessionOwner, progress: TransferProgress): void {
    if (!owner.isDestroyed()) owner.send(IPC.filesTransferProgress, progress);
  }

  private sendClosed(
    owner: SessionOwner,
    connectionId: string,
    reason: string | null,
  ): void {
    if (!owner.isDestroyed()) owner.send(IPC.filesClosed, connectionId, reason);
  }

  private sendMonitor(owner: SessionOwner, event: MonitorEvent): void {
    if (!owner.isDestroyed()) owner.send(IPC.monitorEvent, event);
  }

  private trackOwner(owner: SessionOwner): void {
    if (this.trackedOwners.has(owner.id)) return;
    this.trackedOwners.add(owner.id);
    const ownerId = owner.id;
    const release = () => {
      for (const controller of this.aborters.values()) controller.abort();
      const connections = Array.from(this.connections.values());
      for (const connection of connections)
        if (connection.ownerId === ownerId) this.teardownConnection(connection);
      const transports = Array.from(this.transports.values());
      for (const transport of transports)
        if (transport.ownerId === ownerId) {
          transport.offClose();
          transport.connection.end();
          this.transports.delete(transport.key);
        }
    };
    owner.once('destroyed', () => {
      this.trackedOwners.delete(ownerId);
      release();
    });
    owner.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) release();
    });
  }
}

// --- path helpers (remote paths are always POSIX) ---------------------------------------------

function joinRemote(dir: string, name: string): string {
  return dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`;
}

function baseName(remotePath: string): string {
  const parts = remotePath.split('/').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : remotePath;
}

function joinLocal(dir: string, name: string): string {
  return path.join(dir, name);
}

function localBaseName(localPath: string): string {
  return path.basename(localPath);
}
