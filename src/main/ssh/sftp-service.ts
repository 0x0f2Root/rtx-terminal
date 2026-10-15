import { createReadStream, createWriteStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import posix from 'node:path/posix';
import type { SFTPWrapper, Stats } from 'ssh2';
import { utils as sshUtils } from 'ssh2';
import type {
  RemoteDirEntry,
  RemoteFileErrorCode,
  RemoteFileType,
  RemoteListing,
  RemoteStat,
} from '../../shared/remote';
import type { SshConnection } from './ssh-connection';

const { STATUS_CODE } = sshUtils.sftp;

/** A file-manager failure with a stable code and a message safe to show. */
export class RemoteFileError extends Error {
  constructor(
    readonly code: RemoteFileErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RemoteFileError';
  }
}

/** Maps an SFTP/socket error to a stable code. ssh2 sets a numeric `code` for SFTP status errors. */
function mapError(error: unknown, fallback: string): RemoteFileError {
  if (error instanceof RemoteFileError) return error;
  const err = error as { code?: number | string; message?: string } | null;
  const code = err?.code;
  const message = err?.message ?? fallback;
  if (code === STATUS_CODE.NO_SUCH_FILE || code === 'ENOENT')
    return new RemoteFileError('not-found', 'No such file or directory.');
  if (code === STATUS_CODE.PERMISSION_DENIED || code === 'EACCES')
    return new RemoteFileError('permission-denied', 'Permission denied.');
  if (code === STATUS_CODE.OP_UNSUPPORTED)
    return new RemoteFileError(
      'unsupported',
      'The server does not support that operation.',
    );
  if (code === 'ENOSPC')
    return new RemoteFileError('no-space', 'No space left on the device.');
  if (code === 'EEXIST')
    return new RemoteFileError('exists', 'A file with that name exists.');
  if (
    code === STATUS_CODE.NO_CONNECTION ||
    code === STATUS_CODE.CONNECTION_LOST
  )
    return new RemoteFileError('disconnected', 'The connection was lost.');
  return new RemoteFileError('io', message);
}

const PERMISSION_FLAGS = [
  0o400, 0o200, 0o100, 0o040, 0o020, 0o010, 0o004, 0o002, 0o001,
] as const;
const PERMISSION_CHARS = 'rwxrwxrwx';

/** Renders the low 9 permission bits as an ls-style string, e.g. 0o754 -> "rwxr-xr--". */
export function formatPermissions(mode: number): string {
  let out = '';
  for (let i = 0; i < PERMISSION_FLAGS.length; i++)
    out += mode & PERMISSION_FLAGS[i] ? PERMISSION_CHARS[i] : '-';
  return out;
}

function typeOf(stats: Stats): RemoteFileType {
  if (stats.isSymbolicLink()) return 'symlink';
  if (stats.isDirectory()) return 'directory';
  if (stats.isFile()) return 'file';
  return 'other';
}

/** mtime from SFTP is in seconds; convert to epoch milliseconds, or null when absent. */
function mtimeMs(stats: { mtime?: number }): number | null {
  return typeof stats.mtime === 'number' && stats.mtime > 0
    ? stats.mtime * 1000
    : null;
}

export type TransferHandle = {
  /** Resolves when the transfer finishes, rejects with a RemoteFileError otherwise. */
  done: Promise<void>;
  /** Aborts the transfer and cleans up both streams. */
  cancel(): void;
};

export type TransferControls = {
  onProgress?: (transferred: number, total: number | null) => void;
  signal?: AbortSignal;
};

const MAX_LISTING = 50000;
/** How many symlink targets to resolve at once, so a link-heavy directory stays responsive. */
const LINK_RESOLVE_CONCURRENCY = 16;

/**
 * File operations over one SFTP channel on a shared transport. Every path is treated as untrusted
 * data and only ever passed to SFTP methods: nothing here builds or runs a shell command. The
 * channel is opened lazily and reused; closing it never affects the terminal or the monitor.
 */
export class SftpService {
  private sftp: SFTPWrapper | null = null;
  private opening: Promise<SFTPWrapper> | null = null;
  private closed = false;

  constructor(private readonly connection: SshConnection) {}

  private async channel(): Promise<SFTPWrapper> {
    if (this.closed) throw new RemoteFileError('disconnected', 'Closed.');
    if (this.sftp) return this.sftp;
    if (!this.opening) {
      this.opening = this.connection
        .openSftp()
        .then((sftp) => {
          this.sftp = sftp;
          sftp.on('error', () => undefined);
          sftp.on('close', () => {
            this.sftp = null;
            this.opening = null;
          });
          return sftp;
        })
        .catch((error) => {
          this.opening = null;
          throw mapError(error, 'SFTP could not be started.');
        });
    }
    return this.opening;
  }

  /** Resolves a possibly-relative path to an absolute one (also used to find the home directory). */
  async realpath(input: string): Promise<string> {
    const sftp = await this.channel();
    return new Promise((resolve, reject) => {
      sftp.realpath(input, (error, resolved) => {
        if (error || !resolved)
          reject(mapError(error, 'The path could not be resolved.'));
        else resolve(resolved);
      });
    });
  }

  /** The user's home directory, resolved through SFTP rather than assumed. */
  home(): Promise<string> {
    return this.realpath('.');
  }

  async stat(target: string): Promise<RemoteStat> {
    const sftp = await this.channel();
    const stats = await new Promise<Stats>((resolve, reject) => {
      sftp.stat(target, (error, s) =>
        error || !s ? reject(mapError(error, 'stat failed.')) : resolve(s),
      );
    });
    return {
      path: target,
      type: typeOf(stats),
      size: stats.size ?? 0,
      mtime: mtimeMs(stats),
      mode: (stats.mode ?? 0) & 0o7777,
    };
  }

  private lstat(target: string): Promise<Stats> {
    return this.channel().then(
      (sftp) =>
        new Promise<Stats>((resolve, reject) => {
          sftp.lstat(target, (error, s) =>
            error || !s ? reject(mapError(error, 'lstat failed.')) : resolve(s),
          );
        }),
    );
  }

  private readlink(target: string): Promise<string | null> {
    return this.channel().then(
      (sftp) =>
        new Promise<string | null>((resolve) => {
          sftp.readlink(target, (error, link) =>
            resolve(error ? null : (link ?? null)),
          );
        }),
    );
  }

  /** Lists a directory. The returned path is resolved to absolute; symlink targets and their
   *  resolved types are filled in where they can be read, and left null for broken links. */
  async list(input: string): Promise<RemoteListing> {
    const sftp = await this.channel();
    const resolved = await this.realpath(input);
    const list = await new Promise<{ filename: string; attrs: Stats }[]>(
      (resolve, reject) => {
        sftp.readdir(resolved, (error, entries) => {
          if (error)
            reject(mapError(error, 'The directory could not be read.'));
          else resolve(entries.slice(0, MAX_LISTING));
        });
      },
    );

    const entries: RemoteDirEntry[] = list
      .filter((e) => e.filename !== '.' && e.filename !== '..')
      .map((entry) => {
        const stats = entry.attrs;
        return {
          name: entry.filename,
          type: typeOf(stats),
          size: stats.size ?? 0,
          mtime: mtimeMs(stats),
          mode: (stats.mode ?? 0) & 0o7777,
          permissions: formatPermissions(stats.mode ?? 0),
          uid: stats.uid ?? 0,
          gid: stats.gid ?? 0,
          linkTarget: null as string | null,
          resolvedType: null as RemoteFileType | null,
        };
      });

    // Resolve symlinks (target text + the type they point at) with bounded concurrency.
    const links = entries.filter((e) => e.type === 'symlink');
    for (let i = 0; i < links.length; i += LINK_RESOLVE_CONCURRENCY) {
      const batch = links.slice(i, i + LINK_RESOLVE_CONCURRENCY);
      await Promise.all(
        batch.map(async (entry) => {
          const full = posix.join(resolved, entry.name);
          entry.linkTarget = await this.readlink(full);
          entry.resolvedType = await this.stat(full)
            .then((s) => s.type)
            .catch(() => null);
        }),
      );
    }
    return { path: resolved, entries };
  }

  async mkdir(target: string): Promise<void> {
    const sftp = await this.channel();
    await new Promise<void>((resolve, reject) => {
      sftp.mkdir(target, (error) =>
        error
          ? reject(mapError(error, 'The folder could not be created.'))
          : resolve(),
      );
    });
  }

  async rename(from: string, to: string): Promise<void> {
    const sftp = await this.channel();
    await new Promise<void>((resolve, reject) => {
      sftp.rename(from, to, (error) =>
        error
          ? reject(mapError(error, 'The item could not be renamed.'))
          : resolve(),
      );
    });
  }

  async removeFile(target: string): Promise<void> {
    const sftp = await this.channel();
    await new Promise<void>((resolve, reject) => {
      sftp.unlink(target, (error) =>
        error
          ? reject(mapError(error, 'The file could not be deleted.'))
          : resolve(),
      );
    });
  }

  async removeEmptyDir(target: string): Promise<void> {
    const sftp = await this.channel();
    await new Promise<void>((resolve, reject) => {
      sftp.rmdir(target, (error) =>
        error
          ? reject(mapError(error, 'The folder could not be deleted.'))
          : resolve(),
      );
    });
  }

  /** Deletes a directory tree with explicit SFTP traversal (never a shell `rm -rf`). */
  async removeTree(target: string): Promise<void> {
    const listing = await this.list(target).catch((error) => {
      throw mapError(error, 'The folder could not be read for deletion.');
    });
    for (const entry of listing.entries) {
      const child = posix.join(listing.path, entry.name);
      // A symlink is unlinked, never followed, so deletion cannot escape the tree.
      if (entry.type === 'directory') await this.removeTree(child);
      else await this.removeFile(child);
    }
    await this.removeEmptyDir(listing.path);
  }

  /** True when a name already exists at the given path. */
  async exists(target: string): Promise<boolean> {
    return this.lstat(target).then(
      () => true,
      () => false,
    );
  }

  /** Streams a remote file to a local path. Progress is reported per chunk; cancel aborts both
   *  streams. The destination is opened exclusively unless `overwrite` is set. */
  downloadFile(
    remotePath: string,
    localPath: string,
    total: number | null,
    controls: TransferControls & { overwrite?: boolean },
  ): TransferHandle {
    const controller = new AbortController();
    const done = (async () => {
      const sftp = await this.channel();
      let transferred = 0;
      const read = sftp.createReadStream(remotePath);
      const write = createWriteStream(localPath, {
        flags: controls.overwrite ? 'w' : 'wx',
      });
      read.on('data', (chunk: Buffer) => {
        transferred += chunk.length;
        controls.onProgress?.(transferred, total);
      });
      try {
        await pipeline(read, write, {
          signal: linkSignal(controller, controls.signal),
        });
      } catch (error) {
        await fs.rm(localPath, { force: true }).catch(() => undefined);
        throw transferError(error, controller.signal.aborted);
      }
    })();
    return { done, cancel: () => controller.abort() };
  }

  /** Streams a local file to a remote path. The destination is opened exclusively unless
   *  `overwrite` is set, so an existing remote file is never silently replaced. */
  uploadFile(
    localPath: string,
    remotePath: string,
    total: number | null,
    controls: TransferControls & { overwrite?: boolean },
  ): TransferHandle {
    const controller = new AbortController();
    const done = (async () => {
      const sftp = await this.channel();
      let transferred = 0;
      const read = createReadStream(localPath);
      const write = sftp.createWriteStream(remotePath, {
        flags: controls.overwrite ? 'w' : 'wx',
      });
      read.on('data', (chunk: Buffer) => {
        transferred += chunk.length;
        controls.onProgress?.(transferred, total);
      });
      try {
        await pipeline(read, write, {
          signal: linkSignal(controller, controls.signal),
        });
      } catch (error) {
        throw transferError(error, controller.signal.aborted);
      }
    })();
    return { done, cancel: () => controller.abort() };
  }

  close(): void {
    this.closed = true;
    if (this.sftp) {
      try {
        this.sftp.end();
      } catch {
        // Already gone.
      }
      this.sftp = null;
    }
  }
}

/** Combines the internal cancel controller with an optional external signal. */
function linkSignal(
  controller: AbortController,
  external?: AbortSignal,
): AbortSignal {
  if (external) {
    if (external.aborted) controller.abort();
    else
      external.addEventListener('abort', () => controller.abort(), {
        once: true,
      });
  }
  return controller.signal;
}

function transferError(error: unknown, aborted: boolean): RemoteFileError {
  if (aborted || (error as { name?: string })?.name === 'AbortError')
    return new RemoteFileError('cancelled', 'The transfer was cancelled.');
  return mapError(error, 'The transfer failed.');
}
