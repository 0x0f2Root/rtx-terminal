import type { RemoteOpenResult, SshConnectState } from '@/shared/api';
import { appData } from '@/state/app-data';
import { newId } from '@/lib/ids';
import {
  askCredential,
  dropPromptsFor,
  refreshSecretState,
} from '@/features/ssh/ssh-prompts';

/**
 * Opens a file manager or resource monitor over a saved SSH host, reusing the terminal's
 * credential and host-key machinery: host-key questions are handled by the global SSH listeners,
 * and a missing or rejected password or passphrase asks the user and retries. Connection progress
 * is reported through the same channel the terminal uses, filtered to this attempt.
 */

export type RemoteKind = 'files' | 'monitor';

export type OpenRemoteOptions = {
  onProgress?: (state: SshConnectState) => void;
  /** Initial polling interval for a monitor; ignored for a file view. */
  intervalMs?: number;
  /** When it returns true the attempt is abandoned and any opened connection is closed. */
  isCancelled?: () => boolean;
};

export async function openRemote(
  kind: RemoteKind,
  hostId: string,
  options: OpenRemoteOptions = {},
): Promise<RemoteOpenResult> {
  let password: string | undefined;
  let passphrase: string | undefined;
  let saveSecret = false;

  for (let attempt = 0; attempt < 5; attempt++) {
    if (options.isCancelled?.())
      return { ok: false, error: 'Cancelled.', code: 'cancelled' };
    const requestId = newId('ssh');
    const offProgress = options.onProgress
      ? window.rtx.ssh.onProgress((id, state) => {
          if (id === requestId) options.onProgress?.(state);
        })
      : null;

    let result: RemoteOpenResult;
    try {
      const request = {
        hostId,
        requestId,
        ...(password ? { password } : {}),
        ...(passphrase ? { passphrase } : {}),
        ...(saveSecret ? { saveSecret: true } : {}),
        ...(kind === 'monitor' && options.intervalMs
          ? { intervalMs: options.intervalMs }
          : {}),
      };
      result =
        kind === 'files'
          ? await window.rtx.files.open(request)
          : await window.rtx.monitor.start(request);
    } catch (error) {
      result = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      offProgress?.();
    }

    if (result.ok) {
      if (saveSecret) void refreshSecretState();
      if (options.isCancelled?.()) {
        if (kind === 'files') void window.rtx.files.close(result.connectionId);
        else void window.rtx.monitor.stop(result.connectionId);
        return { ok: false, error: 'Cancelled.', code: 'cancelled' };
      }
      return result;
    }

    const host = appData.get().profiles.hosts.find((h) => h.id === hostId);
    const code = result.code;
    const credentialKind =
      code === 'password-required' ||
      (code === 'auth' && host?.auth === 'password')
        ? 'password'
        : code === 'passphrase-required' || code === 'passphrase-wrong'
          ? 'passphrase'
          : null;
    if (credentialKind && host) {
      dropPromptsFor(requestId);
      const answer = await askCredential({
        kind: credentialKind,
        hostLabel: host.name,
        target: `${host.username || '…'}@${host.host || host.configAlias || '…'}${
          host.port !== 22 ? `:${host.port}` : ''
        }`,
        message:
          code === 'auth'
            ? 'The server rejected the password.'
            : code === 'passphrase-wrong'
              ? 'That passphrase is not correct.'
              : null,
      });
      if (!answer) return { ok: false, error: 'Cancelled.', code: 'cancelled' };
      if (credentialKind === 'password') password = answer.secret;
      else passphrase = answer.secret;
      saveSecret = answer.save;
      continue;
    }
    return result;
  }
  return { ok: false, error: 'Could not sign in.', code: 'auth' };
}
