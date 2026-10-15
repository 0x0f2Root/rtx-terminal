import path from 'node:path';
import type { CreateSessionRequest, SshCreateRequest } from '../shared/api';
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
