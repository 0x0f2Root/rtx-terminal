import posix from 'node:path/posix';
import { randomBytes } from 'node:crypto';
import type { Attributes, FileEntry, SFTPWrapper } from 'ssh2';
import { utils as sshUtils } from 'ssh2';

const { STATUS_CODE } = sshUtils.sftp;

const S_IFDIR = 0o40000;
const S_IFREG = 0o100000;
const S_IFLNK = 0o120000;

type FileNode = {
  type: 'file';
  mode: number;
  data: Buffer;
  mtime: number;
  uid: number;
  gid: number;
};
type DirNode = {
  type: 'dir';
  mode: number;
  children: Map<string, Node>;
  mtime: number;
  uid: number;
  gid: number;
};
type LinkNode = {
  type: 'link';
  mode: number;
  target: string;
  mtime: number;
  uid: number;
  gid: number;
};
type Node = FileNode | DirNode | LinkNode;

class FsError extends Error {
  constructor(readonly status: number) {
    super(`sftp status ${status}`);
  }
}

/**
 * A tiny in-memory POSIX-like filesystem for tests, with files, directories and symlinks. It is
 * driven over a real SFTP channel by {@link serveSftp}, so the client code under test speaks the
 * actual protocol rather than a stub.
 */
export class MemoryFs {
  readonly root: DirNode = {
    type: 'dir',
    mode: S_IFDIR | 0o755,
    children: new Map(),
    mtime: 1_700_000_000,
    uid: 1000,
    gid: 1000,
  };

  /** The directory realpath('.') resolves to, like a server's login home directory. */
  constructor(readonly homeDir = '/home/tester') {
    this.mkdirp(homeDir);
  }

  mkdirp(path: string): DirNode {
    const parts = this.split(path);
    let node: DirNode = this.root;
    for (const part of parts) {
      let child = node.children.get(part);
      if (!child) {
        child = {
          type: 'dir',
          mode: S_IFDIR | 0o755,
          children: new Map(),
          mtime: 1_700_000_000,
          uid: 1000,
          gid: 1000,
        };
        node.children.set(part, child);
      }
      if (child.type !== 'dir') throw new FsError(STATUS_CODE.FAILURE);
      node = child;
    }
    return node;
  }

  writeFile(path: string, data: Buffer | string, mode = 0o644): void {
    const parent = this.mkdirp(posix.dirname(path));
    parent.children.set(posix.basename(path), {
      type: 'file',
      mode: S_IFREG | mode,
      data: Buffer.isBuffer(data) ? data : Buffer.from(data),
      mtime: 1_700_000_000,
      uid: 1000,
      gid: 1000,
    });
  }

  symlink(linkPath: string, target: string): void {
    const parent = this.mkdirp(posix.dirname(linkPath));
    parent.children.set(posix.basename(linkPath), {
      type: 'link',
      mode: S_IFLNK | 0o777,
      target,
      mtime: 1_700_000_000,
      uid: 1000,
      gid: 1000,
    });
  }

  readFileContents(path: string): Buffer {
    const node = this.resolve(path, true);
    if (node.type !== 'file') throw new FsError(STATUS_CODE.FAILURE);
    return node.data;
  }

  private split(path: string): string[] {
    return posix
      .normalize(path)
      .split('/')
      .filter((p) => p && p !== '.');
  }

  private lookup(path: string): { parent: DirNode; name: string } {
    const parts = this.split(path);
    if (parts.length === 0) throw new FsError(STATUS_CODE.FAILURE);
    const name = parts.pop()!;
    let node: DirNode = this.root;
    for (const part of parts) {
      const child = this.followDir(node, part);
      node = child;
    }
    return { parent: node, name };
  }

  private followDir(dir: DirNode, part: string): DirNode {
    const child = dir.children.get(part);
    if (!child) throw new FsError(STATUS_CODE.NO_SUCH_FILE);
    const resolved =
      child.type === 'link' ? this.resolve(child.target, true) : child;
    if (resolved.type !== 'dir') throw new FsError(STATUS_CODE.FAILURE);
    return resolved;
  }

  resolve(path: string, follow: boolean, depth = 0): Node {
    if (depth > 40) throw new FsError(STATUS_CODE.FAILURE);
    const parts = this.split(path);
    let node: Node = this.root;
    for (let i = 0; i < parts.length; i++) {
      if (node.type === 'link')
        node = this.resolve(node.target, true, depth + 1);
      if (node.type !== 'dir') throw new FsError(STATUS_CODE.NO_SUCH_FILE);
      const child = node.children.get(parts[i]);
      if (!child) throw new FsError(STATUS_CODE.NO_SUCH_FILE);
      node = child;
    }
    if (follow && node.type === 'link')
      node = this.resolve(node.target, true, depth + 1);
    return node;
  }

  attrsOf(node: Node): Attributes {
    const size =
      node.type === 'file'
        ? node.data.length
        : node.type === 'link'
          ? node.target.length
          : 4096;
    return {
      mode: node.mode,
      uid: node.uid,
      gid: node.gid,
      size,
      atime: node.mtime,
      mtime: node.mtime,
    };
  }

  // --- operations used by the SFTP handler ----------------------------------

  statPath(path: string, follow: boolean): Attributes {
    return this.attrsOf(this.resolve(path, follow));
  }

  readdir(path: string): FileEntry[] {
    const node = this.resolve(path, true);
    if (node.type !== 'dir') throw new FsError(STATUS_CODE.FAILURE);
    return [...node.children.entries()].map(([name, child]) => ({
      filename: name,
      longname: `${name}`,
      attrs: this.attrsOf(child),
    }));
  }

  readlink(path: string): string {
    const node = this.resolve(path, false);
    if (node.type !== 'link') throw new FsError(STATUS_CODE.FAILURE);
    return node.target;
  }

  mkdir(path: string): void {
    const { parent, name } = this.lookup(path);
    if (parent.children.has(name)) throw new FsError(STATUS_CODE.FAILURE);
    parent.children.set(name, {
      type: 'dir',
      mode: S_IFDIR | 0o755,
      children: new Map(),
      mtime: 1_700_000_000,
      uid: 1000,
      gid: 1000,
    });
  }

  rmdir(path: string): void {
    const { parent, name } = this.lookup(path);
    const node = parent.children.get(name);
    if (!node) throw new FsError(STATUS_CODE.NO_SUCH_FILE);
    if (node.type !== 'dir') throw new FsError(STATUS_CODE.FAILURE);
    if (node.children.size > 0) throw new FsError(STATUS_CODE.FAILURE);
    parent.children.delete(name);
  }

  unlink(path: string): void {
    const { parent, name } = this.lookup(path);
    const node = parent.children.get(name);
    if (!node) throw new FsError(STATUS_CODE.NO_SUCH_FILE);
    if (node.type === 'dir') throw new FsError(STATUS_CODE.FAILURE);
    parent.children.delete(name);
  }

  rename(from: string, to: string): void {
    const src = this.lookup(from);
    const node = src.parent.children.get(src.name);
    if (!node) throw new FsError(STATUS_CODE.NO_SUCH_FILE);
    const dst = this.lookup(to);
    src.parent.children.delete(src.name);
    dst.parent.children.set(dst.name, node);
  }

  openForRead(path: string): Buffer {
    const node = this.resolve(path, true);
    if (node.type !== 'file') throw new FsError(STATUS_CODE.NO_SUCH_FILE);
    return node.data;
  }

  createForWrite(path: string, exclusive: boolean): FileNode {
    const { parent, name } = this.lookup(path);
    const existing = parent.children.get(name);
    if (existing) {
      if (exclusive) throw new FsError(STATUS_CODE.FAILURE);
      if (existing.type !== 'file') throw new FsError(STATUS_CODE.FAILURE);
      existing.data = Buffer.alloc(0);
      return existing;
    }
    const node: FileNode = {
      type: 'file',
      mode: S_IFREG | 0o644,
      data: Buffer.alloc(0),
      mtime: 1_700_000_000,
      uid: 1000,
      gid: 1000,
    };
    parent.children.set(name, node);
    return node;
  }
}

type OpenFile =
  | { kind: 'read'; data: Buffer }
  | { kind: 'write'; node: FileNode };
type OpenDir = { kind: 'dir'; entries: FileEntry[]; sent: boolean };

/** Wires a server-side SFTP channel to a {@link MemoryFs}, implementing the operations the file
 *  service relies on. Unsupported requests answer with OP_UNSUPPORTED. */
export function serveSftp(sftp: SFTPWrapper, fs: MemoryFs): void {
  const handles = new Map<string, OpenFile | OpenDir>();
  const newHandle = (): Buffer => randomBytes(8);
  const key = (handle: Buffer) => handle.toString('hex');

  const guard = (reqId: number, fn: () => void) => {
    try {
      fn();
    } catch (error) {
      sftp.status(
        reqId,
        error instanceof FsError ? error.status : STATUS_CODE.FAILURE,
      );
    }
  };

  const absolute = (p: string) =>
    p.startsWith('/') ? p : posix.join(fs.homeDir, p);

  sftp.on('REALPATH', (reqId, p) =>
    guard(reqId, () => {
      const resolved =
        p === '.' || p === '' ? fs.homeDir : posix.normalize(absolute(p));
      sftp.name(reqId, [
        { filename: resolved, longname: resolved, attrs: {} as Attributes },
      ]);
    }),
  );

  sftp.on('STAT', (reqId, p) =>
    guard(reqId, () => sftp.attrs(reqId, fs.statPath(absolute(p), true))),
  );
  sftp.on('LSTAT', (reqId, p) =>
    guard(reqId, () => sftp.attrs(reqId, fs.statPath(absolute(p), false))),
  );
  sftp.on('READLINK', (reqId, p) =>
    guard(reqId, () => {
      const target = fs.readlink(absolute(p));
      sftp.name(reqId, [
        { filename: target, longname: target, attrs: {} as Attributes },
      ]);
    }),
  );

  sftp.on('OPENDIR', (reqId, p) =>
    guard(reqId, () => {
      const entries = fs.readdir(absolute(p));
      const handle = newHandle();
      handles.set(key(handle), { kind: 'dir', entries, sent: false });
      sftp.handle(reqId, handle);
    }),
  );
  sftp.on('READDIR', (reqId, handle) =>
    guard(reqId, () => {
      const entry = handles.get(key(handle));
      if (!entry || entry.kind !== 'dir')
        return sftp.status(reqId, STATUS_CODE.FAILURE);
      if (entry.sent) return sftp.status(reqId, STATUS_CODE.EOF);
      entry.sent = true;
      sftp.name(reqId, entry.entries);
    }),
  );

  sftp.on('MKDIR', (reqId, p) =>
    guard(reqId, () => {
      fs.mkdir(absolute(p));
      sftp.status(reqId, STATUS_CODE.OK);
    }),
  );
  sftp.on('RMDIR', (reqId, p) =>
    guard(reqId, () => {
      fs.rmdir(absolute(p));
      sftp.status(reqId, STATUS_CODE.OK);
    }),
  );
  sftp.on('REMOVE', (reqId, p) =>
    guard(reqId, () => {
      fs.unlink(absolute(p));
      sftp.status(reqId, STATUS_CODE.OK);
    }),
  );
  sftp.on('RENAME', (reqId, from, to) =>
    guard(reqId, () => {
      fs.rename(absolute(from), absolute(to));
      sftp.status(reqId, STATUS_CODE.OK);
    }),
  );

  sftp.on('OPEN', (reqId, filename, flags) =>
    guard(reqId, () => {
      const read = (flags & 0x1) !== 0; // FXF_READ
      const handle = newHandle();
      if (read) {
        handles.set(key(handle), {
          kind: 'read',
          data: fs.openForRead(absolute(filename)),
        });
      } else {
        const exclusive = (flags & 0x20) !== 0; // FXF_EXCL
        handles.set(key(handle), {
          kind: 'write',
          node: fs.createForWrite(absolute(filename), exclusive),
        });
      }
      sftp.handle(reqId, handle);
    }),
  );
  sftp.on('READ', (reqId, handle, offset, length) =>
    guard(reqId, () => {
      const entry = handles.get(key(handle));
      if (!entry || entry.kind !== 'read')
        return sftp.status(reqId, STATUS_CODE.FAILURE);
      if (offset >= entry.data.length)
        return sftp.status(reqId, STATUS_CODE.EOF);
      sftp.data(reqId, entry.data.subarray(offset, offset + length));
    }),
  );
  sftp.on('WRITE', (reqId, handle, offset, data) =>
    guard(reqId, () => {
      const entry = handles.get(key(handle));
      if (!entry || entry.kind !== 'write')
        return sftp.status(reqId, STATUS_CODE.FAILURE);
      if (offset === entry.node.data.length)
        entry.node.data = Buffer.concat([entry.node.data, data]);
      else {
        const next = Buffer.alloc(
          Math.max(entry.node.data.length, offset + data.length),
        );
        entry.node.data.copy(next);
        data.copy(next, offset);
        entry.node.data = next;
      }
      sftp.status(reqId, STATUS_CODE.OK);
    }),
  );
  sftp.on('FSTAT', (reqId, handle) =>
    guard(reqId, () => {
      const entry = handles.get(key(handle));
      if (!entry || entry.kind === 'dir')
        return sftp.status(reqId, STATUS_CODE.FAILURE);
      const size =
        entry.kind === 'read' ? entry.data.length : entry.node.data.length;
      sftp.attrs(reqId, {
        mode: S_IFREG | 0o644,
        uid: 1000,
        gid: 1000,
        size,
        atime: 0,
        mtime: 0,
      });
    }),
  );
  sftp.on('CLOSE', (reqId, handle) =>
    guard(reqId, () => {
      handles.delete(key(handle));
      sftp.status(reqId, STATUS_CODE.OK);
    }),
  );

  for (const unsupported of ['SETSTAT', 'FSETSTAT', 'SYMLINK'] as const) {
    sftp.on(unsupported, (reqId: number) => sftp.status(reqId, STATUS_CODE.OK));
  }
}
