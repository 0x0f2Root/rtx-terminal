import type { HostKeyPrompt, SecretState } from '@/shared/api';
import { createStore, useStore } from '@/lib/create-store';

/**
 * Questions an SSH connection needs answered: host keys (asked by the main process) and
 * passwords or passphrases (asked by a pane before it retries). Typed secrets are handed straight
 * to one connection attempt and are not kept here. Secret state lists only which hosts have
 * something saved in the keyring, never the values.
 */

export type CredentialRequest = {
  kind: 'password' | 'passphrase';
  hostLabel: string;
  target: string;
  /** Why we are asking again, for example after the server rejected a password. */
  message: string | null;
};

export type CredentialAnswer = { secret: string; save: boolean } | null;

type PendingCredential = CredentialRequest & {
  id: number;
  resolve: (answer: CredentialAnswer) => void;
};

type SshPromptState = {
  hostKeys: HostKeyPrompt[];
  credentials: PendingCredential[];
  secrets: SecretState;
};

export const sshPrompts = createStore<SshPromptState>({
  hostKeys: [],
  credentials: [],
  secrets: { available: false, backend: 'unknown', saved: {} },
});

export function useSshPrompts<S>(selector: (state: SshPromptState) => S): S {
  return useStore(sshPrompts, selector);
}

let nextId = 1;

/** Asks the user for a password or passphrase; resolves null when they cancel. */
export function askCredential(
  request: CredentialRequest,
): Promise<CredentialAnswer> {
  return new Promise((resolve) => {
    const pending: PendingCredential = { ...request, id: nextId++, resolve };
    sshPrompts.set((state) => ({
      ...state,
      credentials: [...state.credentials, pending],
    }));
  });
}

export function answerCredential(id: number, answer: CredentialAnswer): void {
  const pending = sshPrompts.get().credentials.find((c) => c.id === id);
  sshPrompts.set((state) => ({
    ...state,
    credentials: state.credentials.filter((c) => c.id !== id),
  }));
  pending?.resolve(answer);
}

export function answerHostKey(promptId: string, trust: boolean): void {
  sshPrompts.set((state) => ({
    ...state,
    hostKeys: state.hostKeys.filter((p) => p.promptId !== promptId),
  }));
  void window.rtx.ssh.answerHostKey(promptId, trust);
}

/** Drops questions for an attempt that was cancelled; the main process rejects them itself. */
export function dropPromptsFor(requestId: string): void {
  sshPrompts.set((state) => ({
    ...state,
    hostKeys: state.hostKeys.filter((p) => p.requestId !== requestId),
  }));
}

export async function refreshSecretState(): Promise<void> {
  try {
    const secrets = await window.rtx.ssh.secretState();
    sshPrompts.set((state) => ({ ...state, secrets }));
  } catch {
    // Keep the last known state; saving will simply be unavailable.
  }
}

export function installSshListeners(): () => void {
  const off = window.rtx.ssh.onHostKeyPrompt((prompt) => {
    sshPrompts.set((state) => ({
      ...state,
      hostKeys: [...state.hostKeys, prompt],
    }));
  });
  void refreshSecretState();
  return off;
}
