import { useRef } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Download,
  File as FileIcon,
  FileSymlink,
  Folder,
  FolderSymlink,
  Link2,
  Pencil,
  RotateCw,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from 'cn';
import type { RemoteDirEntry } from '@/shared/remote';
import { formatBytes, formatDateTime } from '../format';
import type { SortDir, SortKey } from './files-helpers';

/** The listing rendered as a dense, accessible table. ReUI's data-grid cannot be installed here
 *  (its registry is unreachable), so this is a semantic table styled with the same design tokens,
 *  not a restyle of an installed component. */

function EntryIcon({ entry }: { entry: RemoteDirEntry }) {
  const className = 'size-4 shrink-0';
  if (entry.type === 'directory')
    return <Folder className={cn(className, 'text-primary')} />;
  if (entry.type === 'symlink') {
    if (entry.resolvedType === 'directory')
      return <FolderSymlink className={cn(className, 'text-primary')} />;
    return <FileSymlink className={cn(className, 'text-muted-foreground')} />;
  }
  return <FileIcon className={cn(className, 'text-muted-foreground')} />;
}

function SortHeader({
  label,
  column,
  sort,
  onSort,
  className,
}: {
  label: string;
  column: SortKey;
  sort: { key: SortKey; dir: SortDir };
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const active = sort.key === column;
  return (
    <th className={cn('px-2 py-1.5 text-left font-medium', className)}>
      <button
        type="button"
        onClick={() => onSort(column)}
        className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
      >
        {label}
        {active &&
          (sort.dir === 'asc' ? (
            <ArrowUp className="size-3" />
          ) : (
            <ArrowDown className="size-3" />
          ))}
      </button>
    </th>
  );
}

export type FileTableProps = {
  path: string;
  entries: RemoteDirEntry[];
  selection: Set<string>;
  sort: { key: SortKey; dir: SortDir };
  loading: boolean;
  error: string | null;
  onSort: (key: SortKey) => void;
  onSelect: (name: string, event: React.MouseEvent) => void;
  onOpen: (entry: RemoteDirEntry) => void;
  onRetry: () => void;
  onDownload: (entry: RemoteDirEntry) => void;
  onRename: (entry: RemoteDirEntry) => void;
  onDelete: (entry: RemoteDirEntry) => void;
  onCopyPath: (entry: RemoteDirEntry) => void;
};

export function FileTable(props: FileTableProps) {
  const { entries, selection, sort, loading, error } = props;
  const bodyRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-auto" ref={bodyRef}>
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-card text-xs">
            <tr className="border-b border-border">
              <SortHeader
                label="Name"
                column="name"
                sort={sort}
                onSort={props.onSort}
              />
              <SortHeader
                label="Size"
                column="size"
                sort={sort}
                onSort={props.onSort}
                className="w-28 text-right"
              />
              <th className="w-28 px-2 py-1.5 text-left font-medium text-muted-foreground">
                Permissions
              </th>
              <th className="w-24 px-2 py-1.5 text-right font-medium text-muted-foreground">
                Owner
              </th>
              <SortHeader
                label="Modified"
                column="mtime"
                sort={sort}
                onSort={props.onSort}
                className="w-40"
              />
            </tr>
          </thead>
          {!loading && !error && entries.length > 0 && (
            <tbody>
              {entries.map((entry) => {
                const selected = selection.has(entry.name);
                return (
                  <ContextMenu key={entry.name}>
                    <ContextMenuTrigger
                      render={
                        <tr
                          tabIndex={0}
                          aria-selected={selected}
                          onClick={(event) => props.onSelect(entry.name, event)}
                          onDoubleClick={() => props.onOpen(entry)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') props.onOpen(entry);
                          }}
                          className={cn(
                            'cursor-default border-b border-border/50 outline-none transition-colors',
                            selected
                              ? 'bg-primary/10'
                              : 'hover:bg-accent focus-visible:bg-accent',
                          )}
                        />
                      }
                    >
                      <td className="max-w-0 px-2 py-1.5">
                        <span className="flex items-center gap-2">
                          <EntryIcon entry={entry} />
                          <span className="truncate" title={entry.name}>
                            {entry.name}
                          </span>
                          {entry.type === 'symlink' && entry.linkTarget && (
                            <span className="flex items-center gap-0.5 truncate text-xs text-muted-foreground">
                              <Link2 className="size-3" />
                              {entry.linkTarget}
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                        {entry.type === 'directory'
                          ? '—'
                          : formatBytes(entry.size)}
                      </td>
                      <td className="px-2 py-1.5 font-mono text-xs text-muted-foreground">
                        {entry.permissions}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-xs text-muted-foreground">
                        {entry.uid}:{entry.gid}
                      </td>
                      <td className="px-2 py-1.5 tabular-nums text-xs text-muted-foreground">
                        {formatDateTime(entry.mtime)}
                      </td>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="w-48">
                      <ContextMenuItem onClick={() => props.onOpen(entry)}>
                        Open
                      </ContextMenuItem>
                      <ContextMenuItem
                        onClick={() => props.onDownload(entry)}
                        disabled={
                          entry.type !== 'file' && entry.resolvedType !== 'file'
                        }
                      >
                        <Download />
                        Download
                      </ContextMenuItem>
                      <ContextMenuItem onClick={() => props.onCopyPath(entry)}>
                        Copy path
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem onClick={() => props.onRename(entry)}>
                        <Pencil />
                        Rename…
                      </ContextMenuItem>
                      <ContextMenuItem
                        variant="destructive"
                        onClick={() => props.onDelete(entry)}
                      >
                        <Trash2 />
                        Delete…
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                );
              })}
            </tbody>
          )}
        </table>

        {loading && (
          <div className="flex flex-col gap-1 p-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-7 w-full" />
            ))}
          </div>
        )}

        {!loading && error && (
          <Empty className="py-12">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <RotateCw />
              </EmptyMedia>
              <EmptyTitle>This folder could not be read</EmptyTitle>
              <EmptyDescription>{error}</EmptyDescription>
            </EmptyHeader>
            <Button size="sm" variant="outline" onClick={props.onRetry}>
              <RotateCw data-icon="inline-start" />
              Retry
            </Button>
          </Empty>
        )}

        {!loading && !error && entries.length === 0 && (
          <Empty className="py-12">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Folder />
              </EmptyMedia>
              <EmptyTitle>This folder is empty</EmptyTitle>
              <EmptyDescription>
                Upload files or create a folder to get started.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </div>
  );
}
