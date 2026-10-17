import type { ReactNode } from 'react';
import {
  Frame,
  FrameDescription,
  FrameFooter,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from '@/components/reui/frame';
import { Skeleton } from '@/components/ui/skeleton';
import type { MetricBlock } from '@/shared/remote';

/**
 * One monitor region as a ReUI Frame: a header bar (title and what is plotted on the left, an
 * optional control on the right) over a card panel. Frame surfaces use the --card token, so they
 * stay translucent in Glass and black in Full Black.
 */
export function MetricFrame({
  title,
  description,
  icon,
  action,
  flush = false,
  footer,
  className,
  children,
}: {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  /** Edge-to-edge content such as a data-grid, as in ReUI's Frame + data-grid composition. */
  flush?: boolean;
  /** A bar under the panel, e.g. details for the selected row. */
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Frame spacing="sm" stacked={flush} dense={flush} className={className}>
      <FrameHeader className="flex-row items-center gap-2">
        {icon && (
          <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>
        )}
        <div className="flex min-w-0 flex-col">
          <FrameTitle>{title}</FrameTitle>
          {description && (
            <FrameDescription className="truncate">
              {description}
            </FrameDescription>
          )}
        </div>
        {action && (
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {action}
          </div>
        )}
      </FrameHeader>
      <FramePanel className={flush ? 'p-0 shadow-none' : 'min-w-0'}>
        {children}
      </FramePanel>
      {footer && <FrameFooter>{footer}</FrameFooter>}
    </Frame>
  );
}

/**
 * One overview statistic. While the first sample is pending it shows a skeleton in its real
 * layout; an unavailable metric says so (with the reason) instead of showing a zero.
 */
export function StatTile({
  label,
  icon,
  block,
  value,
  unit,
  detail,
  trend,
}: {
  label: string;
  icon: ReactNode;
  block: MetricBlock<unknown> | null;
  /** The headline value; null while it cannot be measured yet. */
  value: string | null;
  unit?: string;
  detail?: ReactNode;
  trend?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground [&_svg]:size-3.5">
        {icon}
        {label}
      </div>
      {block === null ? (
        <>
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-4 w-28" />
        </>
      ) : block.state === 'unavailable' ? (
        <>
          <span className="text-sm text-muted-foreground">Unavailable</span>
          <span
            className="truncate text-xs text-muted-foreground"
            title={block.reason}
          >
            {block.reason}
          </span>
        </>
      ) : (
        <>
          <div className="flex items-baseline gap-1">
            <span className="text-xl font-semibold tracking-tight tabular-nums">
              {value ?? '—'}
            </span>
            {unit && value !== null && (
              <span className="text-xs text-muted-foreground">{unit}</span>
            )}
          </div>
          <span className="truncate text-xs text-muted-foreground">
            {value === null ? 'Measuring…' : detail}
          </span>
          {trend}
        </>
      )}
    </div>
  );
}
