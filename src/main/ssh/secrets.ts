import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Passwords and key passphrases saved for SSH hosts. Values are encrypted with Electron's
 * safeStorage, whose key lives in the OS keyring (KWallet or libsecret on Linux). When the only
 * backend is "basic_text" there is no real protection, so saving is refused rather than faked.
 * Secrets never leave the main process.
 */

export type SecretKind = 'password' | 'passphrase';

/** The parts of Electron's safeStorage this store needs; injectable for tests. */
export type Encryptor = {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend?(): string;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
};

type SecretsFile = {
  version: 1;
  entries: Record<string, Partial<Record<SecretKind, string>>>;
};

const HOST_ID = /^[A-Za-z0-9_-]{1,64}$/;

export class SecretStore {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly file: string,
    private readonly encryptor: Encryptor,
  ) {}

  /** Whether secrets can be stored with real encryption, and which keyring backend is used. */
  status(): { available: boolean; backend: string } {
    let backend = 'unknown';
    try {
      backend = this.encryptor.getSelectedStorageBackend?.() ?? 'unknown';
    } catch {
      backend = 'unknown';
    }
    const available =
      this.encryptor.isEncryptionAvailable() && backend !== 'basic_text';
    return { available, backend };
  }

  private async read(): Promise<SecretsFile> {
    try {
      const data: unknown = JSON.parse(await fs.readFile(this.file, 'utf8'));
      if (
        data &&
        typeof data === 'object' &&
        'entries' in data &&
        typeof data.entries === 'object' &&
        data.entries
      ) {
        return { version: 1, entries: data.entries as SecretsFile['entries'] };
      }
    } catch {
      // Missing or unreadable: no saved secrets.
    }
    return { version: 1, entries: {} };
  }

  private write(update: (file: SecretsFile) => void): Promise<void> {
    const next = this.queue.then(async () => {
      const data = await this.read();
      update(data);
      await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
      const tmp = `${this.file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, `${JSON.stringify(data)}\n`, { mode: 0o600 });
      await fs.rename(tmp, this.file);
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  async save(
    hostId: string,
    kind: SecretKind,
    secret: string,
  ): Promise<boolean> {
    if (!HOST_ID.test(hostId) || !this.status().available) return false;
    const encrypted = this.encryptor.encryptString(secret).toString('base64');
    await this.write((data) => {
      data.entries[hostId] = { ...data.entries[hostId], [kind]: encrypted };
    });
    return true;
  }

  async get(hostId: string, kind: SecretKind): Promise<string | null> {
    if (!HOST_ID.test(hostId) || !this.status().available) return null;
    const value = (await this.read()).entries[hostId]?.[kind];
    if (typeof value !== 'string') return null;
    try {
      return this.encryptor.decryptString(Buffer.from(value, 'base64'));
    } catch {
      // The keyring key changed or the value was tampered with; treat it as not saved.
      return null;
    }
  }

  async forget(hostId: string, kind?: SecretKind): Promise<void> {
    if (!HOST_ID.test(hostId)) return;
    await this.write((data) => {
      if (!kind) delete data.entries[hostId];
      else if (data.entries[hostId]) {
        delete data.entries[hostId][kind];
        if (Object.keys(data.entries[hostId]).length === 0)
          delete data.entries[hostId];
      }
    });
  }

  /** Host ids that have something saved, by kind. Never the secrets themselves. */
  async savedFor(): Promise<Record<string, SecretKind[]>> {
    const { entries } = await this.read();
    const out: Record<string, SecretKind[]> = {};
    for (const [hostId, kinds] of Object.entries(entries)) {
      if (!HOST_ID.test(hostId)) continue;
      out[hostId] = (Object.keys(kinds) as SecretKind[]).filter(
        (k) => k === 'password' || k === 'passphrase',
      );
    }
    return out;
  }
}
