import path from 'node:path';
import type {
  CreateSessionRequest,
  RemoteOpenRequest,
  SshCreateRequest,
  TransferRequest,
} from '../shared/api';
import type { ConflictResolution, TransferDirection } from '../shared/remote';
import { isRecord, isValidId, LIMITS } from '../shared/config';

/**
 * Argument validation for IPC handlers. Kept free of Electron imports so it can be tested on its
 * own. Every function either returns a clean value or throws IpcValidationError.
 */

export class IpcValidationError extends Error {}

export function fail(message: string): never {
  throw new IpcValidationError(message);
}

const SESSION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_SECRET = 1024;

export function sessionId(value: unknown): string {
  return typeof value === 'string' && SESSION_ID.test(value)
    ? value
    : fail('Invalid session id.');
}

/** Host-key prompt ids are UUIDs minted by the main process. */
export function promptId(value: unknown): string {
  return typeof value === 'string' && SESSION_ID.test(value)
    ? value
    : fail('Invalid prompt id.');
}

export function requestId(value: unknown): string {
  return typeof value === 'string' && REQUEST_ID.test(value)
    ? value
    : fail('Invalid request id.');
}

export function hostId(value: unknown): string {
  return isValidId(value) ? value : fail('Invalid host id.');
}

export function dimension(value: unknown, max: number): number {
  return Number.isInteger(value) &&
    (value as number) >= 1 &&
    (value as number) <= max
    ? (value as number)
    : fail('Invalid terminal size.');
}

export function absolutePath(value: unknown): string {
  return typeof value === 'string' &&
    value.length <= LIMITS.path &&
    path.isAbsolute(value) &&
    !value.includes('\0')
    ? path.normalize(value)
    : fail('Invalid path.');
}

function secret(value: unknown): string {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_SECRET &&
    !value.includes('\0')
    ? value
    : fail('Invalid credential.');
}

export function sshRequest(value: unknown): SshCreateRequest {
  if (!isRecord(value)) fail('Invalid SSH request.');
  const request: SshCreateRequest = {
    hostId: hostId(value.hostId),
    requestId: requestId(value.requestId),
  };
  if (value.password !== undefined) request.password = secret(value.password);
  if (value.passphrase !== undefined)
    request.passphrase = secret(value.passphrase);
  if (value.saveSecret !== undefined) {
    if (typeof value.saveSecret !== 'boolean') fail('Invalid SSH request.');
    request.saveSecret = value.saveSecret;
  }
  return request;
}

export function createRequest(value: unknown): CreateSessionRequest {
  if (!isRecord(value)) fail('Invalid session request.');
  const request: CreateSessionRequest = {
    cols: dimension(value.cols, 1000),
    rows: dimension(value.rows, 500),
  };
  if (value.ssh !== undefined) {
    request.ssh = sshRequest(value.ssh);
    return request;
  }
  if (value.shell !== undefined) request.shell = absolutePath(value.shell);
  if (value.cwd !== undefined) request.cwd = absolutePath(value.cwd);
  return request;
}

// --- remote file manager and monitor ----------------------------------------

/** A logical connection id minted by the main process; shaped like a session id (UUID). */
export function connectionId(value: unknown): string {
  return typeof value === 'string' && SESSION_ID.test(value)
    ? value
    : fail('Invalid connection id.');
}

/** A remote path is untrusted text passed only to SFTP; it just has to be a bounded, NUL-free,
 *  absolute POSIX path. It is never interpolated into a shell command. */
export function remotePath(value: unknown): string {
  return typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= LIMITS.path &&
    value.startsWith('/') &&
    !value.includes('\0')
    ? value
    : fail('Invalid remote path.');
}

/** A single path component for mkdir/rename: no separators, no NUL, not "." or "..". */
export function remoteName(value: unknown): string {
  return typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 255 &&
    !value.includes('/') &&
    !value.includes('\0') &&
    value !== '.' &&
    value !== '..'
    ? value
    : fail('Invalid name.');
}

export function conflictResolution(value: unknown): ConflictResolution {
  return value === 'overwrite' || value === 'rename' || value === 'skip'
    ? value
    : fail('Invalid conflict resolution.');
}

export function remoteOpenRequest(value: unknown): RemoteOpenRequest {
  if (!isRecord(value)) fail('Invalid open request.');
  const request: RemoteOpenRequest = {
    hostId: hostId(value.hostId),
    requestId: requestId(value.requestId),
  };
  if (value.password !== undefined) request.password = secret(value.password);
  if (value.passphrase !== undefined)
    request.passphrase = secret(value.passphrase);
  if (value.saveSecret !== undefined) {
    if (typeof value.saveSecret !== 'boolean') fail('Invalid open request.');
    request.saveSecret = value.saveSecret;
  }
  if (value.intervalMs !== undefined) {
    if (!Number.isFinite(value.intervalMs)) fail('Invalid interval.');
    request.intervalMs = value.intervalMs as number;
  }
  return request;
}

const MAX_TRANSFER_SOURCES = 2000;

export function transferRequest(value: unknown): TransferRequest {
  if (!isRecord(value)) fail('Invalid transfer request.');
  const direction: TransferDirection =
    value.direction === 'upload' || value.direction === 'download'
      ? value.direction
      : fail('Invalid transfer direction.');
  if (!Array.isArray(value.sources) || value.sources.length === 0)
    fail('No files to transfer.');
  if (value.sources.length > MAX_TRANSFER_SOURCES) fail('Too many files.');
  // Upload reads local (absolute) sources into a remote directory; download is the mirror image.
  const sources = value.sources.map((source) =>
    direction === 'upload' ? absolutePath(source) : remotePath(source),
  );
  const destinationDir =
    direction === 'upload'
      ? remotePath(value.destinationDir)
      : absolutePath(value.destinationDir);
  return {
    connectionId: connectionId(value.connectionId),
    direction,
    sources,
    destinationDir,
    conflict: conflictResolution(value.conflict),
  };
}
