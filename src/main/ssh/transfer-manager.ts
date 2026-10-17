import { promises as fs } from 'node:fs';
import path from 'node:path';
import posix from 'node:path/posix';
import { randomUUID } from 'node:crypto';
import type {
  ConflictResolution,
  TransferDirection,
  TransferProgress,
} from '../../shared/remote';
import {
  RemoteFileError,
  type SftpService,
  type TransferHandle,
} from './sftp-service';

/**
 * A per-connection transfer queue. Transfers run with bounded concurrency so a burst never opens
 * unlimited channels; each reports live progress and speed, can be cancelled (which tears down its
 * streams without touching the shared transport), and can be retried. Directory transfers are
 * expanded into per-file tasks using SFTP directory listings, never a shell archive command.
 */

export type EnqueueSpec = {
  direction: TransferDirection;
  localPath: string;
  remotePath: string;
  /** Known total size in bytes, or null to discover it. */
  size: number | null;
  conflict: ConflictResolution;
};

const DEFAULT_CONCURRENCY = 3;
/** How often, at most, a running transfer's progress is reported. */
const PROGRESS_INTERVAL_MS = 150;

type Task = {
  progress: TransferProgress;
  spec: EnqueueSpec;
  handle: TransferHandle | null;
  lastEmit: number;
  speedBytes: number;
  speedAt: number;
};

export class TransferManager {
  private readonly tasks = new Map<string, Task>();
  private readonly queue: string[] = [];
  private active = 0;
  private disposed = false;

  constructor(
    private readonly connectionId: string,
    private readonly service: SftpService,
    private readonly emit: (progress: TransferProgress) => void,
    private readonly concurrency = DEFAULT_CONCURRENCY,
  ) {}

  /** Expands a directory spec into per-file specs by walking it over SFTP (download) or the local
   *  filesystem (upload). The directory tree itself is created before files are queued. */
  async expand(spec: EnqueueSpec): Promise<EnqueueSpec[]> {
    if (spec.direction === 'download') return this.expandDownload(spec);
    return this.expandUpload(spec);
  }

  private async expandDownload(spec: EnqueueSpec): Promise<EnqueueSpec[]> {
    const stat = await this.service.stat(spec.remotePath).catch(() => null);
    if (!stat || stat.type !== 'directory')
      return [{ ...spec, size: stat?.size ?? spec.size }];
    const out: EnqueueSpec[] = [];
    const walk = async (remoteDir: string, localDir: string): Promise<void> => {
      await fs.mkdir(localDir, { recursive: true });
      const listing = await this.service.list(remoteDir);
      for (const entry of listing.entries) {
        const remoteChild = posix.join(listing.path, entry.name);
        const localChild = path.join(localDir, entry.name);
        if (entry.type === 'directory') await walk(remoteChild, localChild);
        else if (entry.type === 'file')
          out.push({
            direction: 'download',
            remotePath: remoteChild,
            localPath: localChild,
            size: entry.size,
            conflict: spec.conflict,
          });
      }
    };
    await walk(spec.remotePath, spec.localPath);
    return out;
  }

  private async expandUpload(spec: EnqueueSpec): Promise<EnqueueSpec[]> {
    const stat = await fs.stat(spec.localPath).catch(() => null);
    if (!stat || !stat.isDirectory())
      return [{ ...spec, size: stat?.size ?? spec.size }];
    const out: EnqueueSpec[] = [];
    const walk = async (localDir: string, remoteDir: string): Promise<void> => {
      await this.service.mkdir(remoteDir).catch((error) => {
        if (error instanceof RemoteFileError && error.code === 'exists') return;
        if (error instanceof RemoteFileError && error.code === 'io') return;
        throw error;
      });
      const entries = await fs.readdir(localDir, { withFileTypes: true });
      for (const entry of entries) {
        const localChild = path.join(localDir, entry.name);
        const remoteChild = posix.join(remoteDir, entry.name);
        if (entry.isDirectory()) await walk(localChild, remoteChild);
        else if (entry.isFile())
          out.push({
            direction: 'upload',
            localPath: localChild,
            remotePath: remoteChild,
            size: (await fs.stat(localChild)).size,
            conflict: spec.conflict,
          });
      }
    };
    await walk(spec.localPath, spec.remotePath);
    return out;
  }

  enqueue(spec: EnqueueSpec): string {
    const id = randomUUID();
    const now = Date.now();
    const name =
      spec.direction === 'download'
        ? posix.basename(spec.remotePath)
        : path.basename(spec.localPath);
    const task: Task = {
      spec,
      handle: null,
      lastEmit: 0,
      speedBytes: 0,
      speedAt: now,
      progress: {
        id,
        connectionId: this.connectionId,
        direction: spec.direction,
        name,
        source:
          spec.direction === 'download' ? spec.remotePath : spec.localPath,
        destination:
          spec.direction === 'download' ? spec.localPath : spec.remotePath,
        total: spec.size,
        transferred: 0,
        bytesPerSecond: null,
        status: 'queued',
        error: null,
        startedAt: now,
        updatedAt: now,
      },
    };
    this.tasks.set(id, task);
    this.queue.push(id);
    this.emit({ ...task.progress });
    this.pump();
    return id;
  }

  cancel(id: string): void {
    const task = this.tasks.get(id);
    if (!task) return;
    if (task.progress.status === 'transferring' && task.handle) {
      task.handle.cancel();
      return;
    }
    if (task.progress.status === 'queued') {
      const index = this.queue.indexOf(id);
      if (index >= 0) this.queue.splice(index, 1);
      this.update(task, { status: 'cancelled' });
    }
  }

  /** Re-queues a failed or cancelled transfer from the start. */
  retry(id: string): void {
    const task = this.tasks.get(id);
    if (!task) return;
    if (
      task.progress.status !== 'failed' &&
      task.progress.status !== 'cancelled'
    )
      return;
    this.update(task, {
      status: 'queued',
      transferred: 0,
      error: null,
      bytesPerSecond: null,
    });
    task.speedBytes = 0;
    task.speedAt = Date.now();
    this.queue.push(id);
    this.pump();
  }

  dispose(): void {
    this.disposed = true;
    this.queue.length = 0;
    for (const task of this.tasks.values()) task.handle?.cancel();
  }

  private pump(): void {
    while (
      !this.disposed &&
      this.active < this.concurrency &&
      this.queue.length > 0
    ) {
      const id = this.queue.shift()!;
      const task = this.tasks.get(id);
      if (!task || task.progress.status !== 'queued') continue;
      this.active += 1;
      void this.run(task).finally(() => {
        this.active -= 1;
        this.pump();
      });
    }
  }

  private async run(task: Task): Promise<void> {
    const { spec } = task;
    try {
      const destination = await this.resolveDestination(spec);
      if (destination === null) {
        this.update(task, { status: 'skipped', error: null });
        return;
      }
      const overwrite = destination.overwrite;
      const dest = destination.path;
      if (spec.direction === 'download') task.progress.destination = dest;
      else task.progress.destination = dest;

      this.update(task, { status: 'transferring' });
      const onProgress = (transferred: number, total: number | null) =>
        this.onProgress(task, transferred, total);
      task.handle =
        spec.direction === 'download'
          ? this.service.downloadFile(spec.remotePath, dest, spec.size, {
              onProgress,
              overwrite,
            })
          : this.service.uploadFile(spec.localPath, dest, spec.size, {
              onProgress,
              overwrite,
            });
      await task.handle.done;
      this.update(task, {
        status: 'completed',
        transferred: task.progress.total ?? task.progress.transferred,
        bytesPerSecond: null,
      });
    } catch (error) {
      const code = error instanceof RemoteFileError ? error.code : 'io';
      if (code === 'cancelled') {
        this.update(task, { status: 'cancelled', error: null });
        return;
      }
      this.update(task, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      task.handle = null;
    }
  }

  /** Applies the conflict choice. Returns null to skip, or the destination path and overwrite flag. */
  private async resolveDestination(
    spec: EnqueueSpec,
  ): Promise<{ path: string; overwrite: boolean } | null> {
    const dest =
      spec.direction === 'download' ? spec.localPath : spec.remotePath;
    const exists =
      spec.direction === 'download'
        ? await fs
            .access(dest)
            .then(() => true)
            .catch(() => false)
        : await this.service.exists(dest);
    if (!exists) return { path: dest, overwrite: false };
    if (spec.conflict === 'overwrite') return { path: dest, overwrite: true };
    if (spec.conflict === 'skip') return null;
    // rename: find the first free "name (n).ext".
    return {
      path: await this.uniqueName(spec.direction, dest),
      overwrite: false,
    };
  }

  private async uniqueName(
    direction: TransferDirection,
    dest: string,
  ): Promise<string> {
    const lib = direction === 'download' ? path : posix;
    const dir = lib.dirname(dest);
    const ext = lib.extname(dest);
    const base = lib.basename(dest, ext);
    for (let n = 1; n < 1000; n++) {
      const candidate = lib.join(dir, `${base} (${n})${ext}`);
      const taken =
        direction === 'download'
          ? await fs
              .access(candidate)
              .then(() => true)
              .catch(() => false)
          : await this.service.exists(candidate);
      if (!taken) return candidate;
    }
    return lib.join(dir, `${base} (${randomUUID().slice(0, 8)})${ext}`);
  }

  private onProgress(
    task: Task,
    transferred: number,
    total: number | null,
  ): void {
    task.progress.transferred = transferred;
    if (total !== null) task.progress.total = total;
    const now = Date.now();
    const elapsed = (now - task.speedAt) / 1000;
    if (elapsed >= 0.5) {
      task.progress.bytesPerSecond = Math.round(
        (transferred - task.speedBytes) / elapsed,
      );
      task.speedBytes = transferred;
      task.speedAt = now;
    }
    if (now - task.lastEmit >= PROGRESS_INTERVAL_MS) {
      task.lastEmit = now;
      task.progress.updatedAt = now;
      this.emit({ ...task.progress });
    }
  }

  private update(task: Task, patch: Partial<TransferProgress>): void {
    Object.assign(task.progress, patch, { updatedAt: Date.now() });
    this.emit({ ...task.progress });
  }
}
