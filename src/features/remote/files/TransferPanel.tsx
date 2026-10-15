import { ArrowDownToLine, ArrowUpFromLine, RotateCw, X } from 'lucide-react';
import { Badge } from '@/components/reui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from 'cn';
import type { TransferProgress, TransferStatus } from '@/shared/remote';
import { formatBytes, formatBytesPerSecond } from '../format';

const STATUS_VARIANT: Record<
  TransferStatus,
  | 'primary-light'
  | 'success-light'
  | 'destructive-light'
  | 'warning-light'
  | 'secondary'
> = {
  queued: 'secondary',
  transferring: 'primary-light',
  completed: 'success-light',
  failed: 'destructive-light',
  cancelled: 'warning-light',
};

function percent(transfer: TransferProgress): number | null {
  if (transfer.total === null || transfer.total === 0) return null;
  return Math.min(
    100,
    Math.round((transfer.transferred / transfer.total) * 100),
  );
}

function TransferRow({
  transfer,
  onCancel,
  onRetry,
}: {
  transfer: TransferProgress;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
}) {
  const pct = percent(transfer);
  const active =
    transfer.status === 'transferring' || transfer.status === 'queued';
  return (
    <div className="flex flex-col gap-1 px-3 py-2">
      <div className="flex items-center gap-2">
        {transfer.direction === 'upload' ? (
          <ArrowUpFromLine className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ArrowDownToLine className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span
          className="min-w-0 flex-1 truncate text-sm"
          title={transfer.destination}
        >
          {transfer.name}
        </span>
        <Badge variant={STATUS_VARIANT[transfer.status]} size="sm">
          {transfer.status}
        </Badge>
        {active ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onCancel(transfer.id)}
            aria-label="Cancel transfer"
          >
            <X />
          </Button>
        ) : transfer.status === 'failed' || transfer.status === 'cancelled' ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onRetry(transfer.id)}
            aria-label="Retry transfer"
          >
            <RotateCw />
          </Button>
        ) : null}
      </div>
      {transfer.status === 'transferring' && (
        <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-200"
            style={{ width: pct === null ? '100%' : `${pct}%` }}
          />
        </div>
      )}
      <div className="flex items-center justify-between text-xs tabular-nums text-muted-foreground">
        <span>
          {formatBytes(transfer.transferred)}
          {transfer.total !== null ? ` / ${formatBytes(transfer.total)}` : ''}
          {pct !== null ? ` · ${pct}%` : ''}
        </span>
        <span>
          {transfer.status === 'transferring' &&
          transfer.bytesPerSecond !== null
            ? formatBytesPerSecond(transfer.bytesPerSecond)
            : transfer.error
              ? transfer.error
              : ''}
        </span>
      </div>
    </div>
  );
}

export function TransferPanel({
  transfers,
  onCancel,
  onRetry,
  onClear,
  className,
}: {
  transfers: TransferProgress[];
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onClear: () => void;
  className?: string;
}) {
  if (transfers.length === 0) return null;
  const active = transfers.filter(
    (t) => t.status === 'transferring' || t.status === 'queued',
  ).length;
  return (
    <div
      className={cn('flex max-h-56 flex-col border-t border-border', className)}
    >
      <div className="flex items-center gap-2 px-3 py-1.5">
        <span className="text-xs font-medium">Transfers</span>
        {active > 0 && (
          <Badge variant="primary-light" size="sm">
            {active} active
          </Badge>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          onClick={onClear}
          disabled={active === transfers.length}
        >
          Clear finished
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="divide-y divide-border/50">
          {transfers.map((transfer) => (
            <TransferRow
              key={transfer.id}
              transfer={transfer}
              onCancel={onCancel}
              onRetry={onRetry}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
