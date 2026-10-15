import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CornerUpRight,
  FolderPlus,
  RotateCw,
  SquareTerminal,
  Unplug,
  Upload,
  Download as DownloadIcon,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/reui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from 'cn';
import type {
  ConflictResolution,
  RemoteDirEntry,
  TransferProgress,
} from '@/shared/remote';
import type { RemoteEndpoint, SshConnectState } from '@/shared/api';
import { appData } from '@/state/app-data';
import { closePane } from '@/features/actions';
import { openTab, useWorkspace } from '@/state/workspace';
import { openRemote } from '../remote-open';
import { FileTable } from './FileTable';
import { TransferPanel } from './TransferPanel';
import { ConflictDialog, PromptDialog } from './file-dialogs';
import {
  breadcrumbs,
  joinPath,
  parentPath,
  sortEntries,
  type SortDir,
  type SortKey,
} from './files-helpers';

type ConnState =
  | { status: 'connecting'; progress: SshConnectState | null }
  | {
      status: 'ready';
      connectionId: string;
      remote: RemoteEndpoint;
      label: string;
    }
  | { status: 'error'; error: string }
  | { status: 'disconnected'; reason: string | null };

type PendingTransfer = {
  direction: 'upload' | 'download';
  sources: string[];
  destinationDir: string;
};

export function FilesPane({ paneId }: { paneId: string; tabActive: boolean }) {
  const hostId = useWorkspace((s) => s.panes[paneId]?.launch.ssh?.hostId);
  const label = useWorkspace((s) => s.panes[paneId]?.launch.label);

  const [conn, setConn] = useState<ConnState>({
    status: 'connecting',
    progress: null,
  });
  const connectionIdRef = useRef<string | null>(null);
  const [path, setPath] = useState('/');
  const [entries, setEntries] = useState<RemoteDirEntry[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: 'name',
    dir: 'asc',
  });
  const [history, setHistory] = useState<{ back: string[]; forward: string[] }>(
    {
      back: [],
      forward: [],
    },
  );
  const [filter, setFilter] = useState('');
  const [transfers, setTransfers] = useState<TransferProgress[]>([]);
  const anchorRef = useRef<string | null>(null);

  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [gotoOpen, setGotoOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<RemoteDirEntry | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RemoteDirEntry | null>(null);
  const [pending, setPending] = useState<PendingTransfer | null>(null);

  // --- connection lifecycle --------------------------------------------------

  useEffect(() => {
    if (!hostId) {
      setConn({ status: 'error', error: 'This view has no host.' });
      return;
    }
    let disposed = false;
    void (async () => {
      const result = await openRemote('files', hostId, {
        onProgress: (progress) =>
          !disposed && setConn({ status: 'connecting', progress }),
        isCancelled: () => disposed,
      });
      if (disposed) {
        if (result.ok) void window.rtx.files.close(result.connectionId);
        return;
      }
      if (!result.ok) {
        setConn({ status: 'error', error: result.error });
        return;
      }
      connectionIdRef.current = result.connectionId;
      setConn({
        status: 'ready',
        connectionId: result.connectionId,
        remote: result.remote,
        label: result.label,
      });
    })();
    return () => {
      disposed = true;
      const id = connectionIdRef.current;
      if (id) void window.rtx.files.close(id);
      connectionIdRef.current = null;
    };
  }, [hostId]);

  // Route transfer progress and transport-close for this connection only.
  useEffect(() => {
    const offTransfer = window.rtx.files.onTransfer((progress) => {
      if (progress.connectionId !== connectionIdRef.current) return;
      setTransfers((prev) => {
        const index = prev.findIndex((t) => t.id === progress.id);
        if (index === -1) return [progress, ...prev];
        const next = [...prev];
        next[index] = progress;
        return next;
      });
    });
    const offClosed = window.rtx.files.onClosed((id, reason) => {
      if (id !== connectionIdRef.current) return;
      setConn({ status: 'disconnected', reason });
    });
    return () => {
      offTransfer();
      offClosed();
    };
  }, []);

  // --- directory loading -----------------------------------------------------

  const load = useCallback(async (target: string): Promise<boolean> => {
    const id = connectionIdRef.current;
    if (!id) return false;
    setListLoading(true);
    setListError(null);
    const result = await window.rtx.files.list(id, target);
    setListLoading(false);
    if (!result.ok) {
      setListError(result.error);
      return false;
    }
    setEntries(result.listing.entries);
    setPath(result.listing.path);
    setSelection(new Set());
    anchorRef.current = null;
    return true;
  }, []);

  // The first listing starts at the resolved home directory, never an assumed path.
  useEffect(() => {
    if (conn.status !== 'ready') return;
    void (async () => {
      const home = await window.rtx.files.home(conn.connectionId);
      await load(home.ok ? home.path : '/');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn.status]);

  const navigate = useCallback(
    async (target: string) => {
      const current = path;
      const ok = await load(target);
      if (ok) setHistory((h) => ({ back: [...h.back, current], forward: [] }));
    },
    [path, load],
  );

  const goBack = useCallback(async () => {
    setHistory((h) => {
      if (h.back.length === 0) return h;
      const target = h.back[h.back.length - 1];
      void load(target);
      return { back: h.back.slice(0, -1), forward: [path, ...h.forward] };
    });
  }, [load, path]);

  const goForward = useCallback(async () => {
    setHistory((h) => {
      if (h.forward.length === 0) return h;
      const [target, ...rest] = h.forward;
      void load(target);
      return { back: [...h.back, path], forward: rest };
    });
  }, [load, path]);

  // --- selection -------------------------------------------------------------

  const visible = useMemo(() => {
    const filtered = filter
      ? entries.filter((e) =>
          e.name.toLowerCase().includes(filter.toLowerCase()),
        )
      : entries;
    return sortEntries(filtered, sort.key, sort.dir);
  }, [entries, filter, sort]);

  const select = useCallback(
    (name: string, event: React.MouseEvent) => {
      setSelection((prev) => {
        if (event.shiftKey && anchorRef.current) {
          const names = visible.map((e) => e.name);
          const from = names.indexOf(anchorRef.current);
          const to = names.indexOf(name);
          if (from !== -1 && to !== -1) {
            const [lo, hi] = from < to ? [from, to] : [to, from];
            return new Set(names.slice(lo, hi + 1));
          }
        }
        if (event.ctrlKey || event.metaKey) {
          const next = new Set(prev);
          if (next.has(name)) next.delete(name);
          else next.add(name);
          anchorRef.current = name;
          return next;
        }
        anchorRef.current = name;
        return new Set([name]);
      });
    },
    [visible],
  );

  const openEntry = useCallback(
    (entry: RemoteDirEntry) => {
      if (
        entry.type === 'directory' ||
        (entry.type === 'symlink' && entry.resolvedType === 'directory')
      )
        void navigate(joinPath(path, entry.name));
    },
    [navigate, path],
  );

  const onSort = useCallback((key: SortKey) => {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' },
    );
  }, []);

  // --- operations ------------------------------------------------------------

  const connectionId = conn.status === 'ready' ? conn.connectionId : null;

  const doMkdir = useCallback(
    async (name: string) => {
      if (!connectionId) return;
      const result = await window.rtx.files.mkdir(connectionId, path, name);
      if (result.ok) void load(path);
      else toast.error(`Could not create folder: ${result.error}`);
    },
    [connectionId, path, load],
  );

  const doRename = useCallback(
    async (name: string) => {
      if (!connectionId || !renameTarget) return;
      const result = await window.rtx.files.rename(
        connectionId,
        joinPath(path, renameTarget.name),
        joinPath(path, name),
      );
      if (result.ok) void load(path);
      else toast.error(`Could not rename: ${result.error}`);
    },
    [connectionId, path, renameTarget, load],
  );

  const doDelete = useCallback(async () => {
    if (!connectionId || !deleteTarget) return;
    const target = joinPath(path, deleteTarget.name);
    const kind = deleteTarget.type === 'directory' ? 'directory' : 'file';
    const result = await window.rtx.files.remove(
      connectionId,
      target,
      kind,
      kind === 'directory',
    );
    setDeleteTarget(null);
    if (result.ok) void load(path);
    else toast.error(`Could not delete: ${result.error}`);
  }, [connectionId, path, deleteTarget, load]);

  const startUpload = useCallback(async () => {
    const files = await window.rtx.system.pickFiles();
    if (files.length === 0) return;
    setPending({ direction: 'upload', sources: files, destinationDir: path });
  }, [path]);

  const startDownload = useCallback(async () => {
    if (selection.size === 0) return;
    const dir = await window.rtx.system.pickDirectory();
    if (!dir) return;
    const sources = [...selection].map((name) => joinPath(path, name));
    setPending({ direction: 'download', sources, destinationDir: dir });
  }, [selection, path]);

  const runTransfer = useCallback(
    async (conflict: ConflictResolution) => {
      if (!connectionId || !pending) return;
      const request = { connectionId, conflict, ...pending };
      const result = await window.rtx.files.transfer(request);
      setPending(null);
      if (!result.ok) toast.error(`Transfer failed: ${result.error}`);
    },
    [connectionId, pending],
  );

  const openTerminalHere = useCallback(() => {
    if (!hostId) return;
    const host = appData.get().profiles.hosts.find((h) => h.id === hostId);
    openTab({ ssh: { hostId }, label: host?.name ?? label ?? 'SSH' });
  }, [hostId, label]);

  const displayName =
    conn.status === 'ready' ? conn.label : (label ?? 'Remote files');
  const selectionCount = selection.size;

  // --- render ----------------------------------------------------------------

  if (conn.status === 'connecting')
    return (
      <PaneShell>
        <div className="flex flex-1 items-center justify-center">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner />
            {conn.progress === 'authenticating'
              ? 'Authenticating…'
              : conn.progress === 'connected'
                ? 'Opening SFTP…'
                : `Connecting to ${displayName}…`}
          </div>
        </div>
      </PaneShell>
    );

  if (conn.status === 'error' || conn.status === 'disconnected') {
    const message =
      conn.status === 'error'
        ? conn.error
        : (conn.reason ?? 'The connection was closed.');
    return (
      <PaneShell>
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Unplug />
            </EmptyMedia>
            <EmptyTitle>
              {conn.status === 'error'
                ? 'Could not open files'
                : 'Disconnected'}
            </EmptyTitle>
            <EmptyDescription>{message}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="items-center">
            <Button
              size="sm"
              variant="outline"
              onClick={() => closePane(paneId)}
            >
              Close
            </Button>
          </EmptyContent>
        </Empty>
      </PaneShell>
    );
  }

  return (
    <PaneShell>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1.5">
        <IconButton
          label="Back"
          onClick={goBack}
          disabled={history.back.length === 0}
        >
          <ArrowLeft />
        </IconButton>
        <IconButton
          label="Forward"
          onClick={goForward}
          disabled={history.forward.length === 0}
        >
          <ArrowRight />
        </IconButton>
        <IconButton
          label="Parent directory"
          onClick={() => void navigate(parentPath(path))}
          disabled={path === '/'}
        >
          <ArrowUp />
        </IconButton>
        <IconButton label="Refresh" onClick={() => void load(path)}>
          <RotateCw />
        </IconButton>
        <IconButton label="Go to path" onClick={() => setGotoOpen(true)}>
          <CornerUpRight />
        </IconButton>
        <div className="mx-1 h-5 w-px bg-border" />
        <IconButton label="New folder" onClick={() => setMkdirOpen(true)}>
          <FolderPlus />
        </IconButton>
        <IconButton label="Upload files" onClick={() => void startUpload()}>
          <Upload />
        </IconButton>
        <IconButton
          label="Download selected"
          onClick={() => void startDownload()}
          disabled={selectionCount === 0}
        >
          <DownloadIcon />
        </IconButton>
        <div className="mx-1 h-5 w-px bg-border" />
        <Input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter…"
          className="h-7 w-40"
        />
        <div className="ml-auto flex items-center gap-2">
          {selectionCount > 0 && (
            <span className="text-xs text-muted-foreground">
              {selectionCount} selected
            </span>
          )}
          <Badge variant="success-light" size="sm">
            {displayName}
          </Badge>
          <IconButton
            label="Open terminal for this host"
            onClick={openTerminalHere}
          >
            <SquareTerminal />
          </IconButton>
          <IconButton label="Close" onClick={() => closePane(paneId)}>
            <X />
          </IconButton>
        </div>
      </div>

      {/* Breadcrumbs */}
      <div className="flex items-center gap-0.5 overflow-x-auto border-b border-border px-2 py-1 text-xs">
        {breadcrumbs(path).map((crumb, index, all) => (
          <span key={crumb.path} className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => void navigate(crumb.path)}
              className={cn(
                'rounded-sm px-1 py-0.5 transition-colors hover:bg-accent',
                index === all.length - 1
                  ? 'font-medium text-foreground'
                  : 'text-muted-foreground',
              )}
            >
              {crumb.name}
            </button>
            {index < all.length - 1 && (
              <span className="text-muted-foreground">/</span>
            )}
          </span>
        ))}
      </div>

      <FileTable
        path={path}
        entries={visible}
        selection={selection}
        sort={sort}
        loading={listLoading}
        error={listError}
        onSort={onSort}
        onSelect={select}
        onOpen={openEntry}
        onRetry={() => void load(path)}
        onDownload={(entry) => {
          setSelection(new Set([entry.name]));
          void startDownload();
        }}
        onRename={(entry) => setRenameTarget(entry)}
        onDelete={(entry) => setDeleteTarget(entry)}
        onCopyPath={(entry) => {
          void window.rtx.system.writeClipboard(joinPath(path, entry.name));
          toast.success('Path copied.');
        }}
      />

      <TransferPanel
        transfers={transfers}
        onCancel={(id) =>
          connectionId && window.rtx.files.cancelTransfer(connectionId, id)
        }
        onRetry={(id) =>
          connectionId && window.rtx.files.retryTransfer(connectionId, id)
        }
        onClear={() =>
          setTransfers((prev) =>
            prev.filter(
              (t) => t.status === 'transferring' || t.status === 'queued',
            ),
          )
        }
      />

      <PromptDialog
        open={mkdirOpen}
        title="New folder"
        label="Folder name"
        initialValue=""
        confirmLabel="Create"
        onConfirm={(name) => void doMkdir(name)}
        onOpenChange={setMkdirOpen}
      />
      <PromptDialog
        open={renameTarget !== null}
        title="Rename"
        label="New name"
        initialValue={renameTarget?.name ?? ''}
        confirmLabel="Rename"
        onConfirm={(name) => void doRename(name)}
        onOpenChange={(open) => !open && setRenameTarget(null)}
      />
      <PromptDialog
        open={gotoOpen}
        title="Go to path"
        label="Absolute path"
        placeholder="/var/log"
        initialValue={path}
        confirmLabel="Go"
        onConfirm={(target) =>
          void navigate(
            target.startsWith('/') ? target : joinPath(path, target),
          )
        }
        onOpenChange={setGotoOpen}
      />
      <ConflictDialog
        open={pending !== null}
        count={pending?.sources.length ?? 0}
        onChoose={(resolution) => void runTransfer(resolution)}
        onOpenChange={(open) => !open && setPending(null)}
      />

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {deleteTarget?.type === 'directory' ? 'folder' : 'file'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget &&
                `This permanently deletes ${joinPath(path, deleteTarget.name)}`}
              {deleteTarget?.type === 'directory'
                ? ' and everything inside it. This cannot be undone.'
                : '. This cannot be undone.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void doDelete()}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PaneShell>
  );
}

function PaneShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-workspace">{children}</div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
