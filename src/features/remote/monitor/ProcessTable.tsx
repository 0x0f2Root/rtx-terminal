import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from 'cn';
import type { ProcessMetric } from '@/shared/remote';
import { formatBytes, formatDuration } from '../format';

type Key = 'pid' | 'name' | 'user' | 'cpu' | 'memoryPercent' | 'rss';

/** How many rows to render at once; sorting makes the top of the list the interesting part, so a
 *  bounded render keeps a multi-thousand-process host responsive without a virtualization library. */
const MAX_ROWS = 250;

export function ProcessTable({ processes }: { processes: ProcessMetric[] }) {
  const [sortKey, setSortKey] = useState<Key>('cpu');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [filter, setFilter] = useState('');

  const rows = useMemo(() => {
    const term = filter.trim().toLowerCase();
    const filtered = term
      ? processes.filter(
          (p) =>
            p.name.toLowerCase().includes(term) ||
            p.user.toLowerCase().includes(term) ||
            String(p.pid).includes(term),
        )
      : processes;
    const factor = dir === 'asc' ? 1 : -1;
    const sorted = [...filtered].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const delta =
        typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv));
      return delta * factor;
    });
    return sorted.slice(0, MAX_ROWS);
  }, [processes, sortKey, dir, filter]);

  const onSort = (key: Key) => {
    if (key === sortKey) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setDir(key === 'name' || key === 'user' ? 'asc' : 'desc');
    }
  };

  const Head = ({
    label,
    column,
    className,
  }: {
    label: string;
    column: Key;
    className?: string;
  }) => (
    <th className={cn('px-2 py-1.5 font-medium', className)}>
      <button
        type="button"
        onClick={() => onSort(column)}
        className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
      >
        {label}
        {sortKey === column &&
          (dir === 'asc' ? (
            <ArrowUp className="size-3" />
          ) : (
            <ArrowDown className="size-3" />
          ))}
      </button>
    </th>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-3 py-2">
        <Input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter processes…"
          className="h-7 w-56"
        />
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {processes.length} processes
          {rows.length < processes.length ? ` · showing ${rows.length}` : ''}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-card text-xs">
            <tr className="border-b border-border">
              <Head label="PID" column="pid" className="w-16 text-right" />
              <Head label="User" column="user" className="w-24 text-left" />
              <Head label="CPU %" column="cpu" className="w-20 text-right" />
              <Head
                label="Mem %"
                column="memoryPercent"
                className="w-20 text-right"
              />
              <Head label="RSS" column="rss" className="w-24 text-right" />
              <th className="w-12 px-2 py-1.5 text-left font-medium text-muted-foreground">
                St
              </th>
              <Head label="Command" column="name" className="text-left" />
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr
                key={p.pid}
                className="border-b border-border/40 hover:bg-accent"
              >
                <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">
                  {p.pid}
                </td>
                <td className="truncate px-2 py-1 text-muted-foreground">
                  {p.user}
                </td>
                <td className="px-2 py-1 text-right tabular-nums">
                  {p.cpu.toFixed(1)}
                </td>
                <td className="px-2 py-1 text-right tabular-nums">
                  {p.memoryPercent.toFixed(1)}
                </td>
                <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">
                  {formatBytes(p.rss)}
                </td>
                <td className="px-2 py-1 font-mono text-xs text-muted-foreground">
                  {p.state}
                </td>
                <td className="max-w-0 truncate px-2 py-1" title={p.name}>
                  {p.name}
                  {p.elapsedSeconds !== null && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {formatDuration(p.elapsedSeconds)}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
