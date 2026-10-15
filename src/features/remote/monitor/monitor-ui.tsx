import { cn } from 'cn';
import { Skeleton } from '@/components/ui/skeleton';
import type { MetricBlock } from '@/shared/remote';

/**
 * Surface primitives for the monitor. ReUI's Card and Frame cannot be installed in this
 * environment (their registry is unreachable), so `Panel` provides the equivalent card surface
 * with the same `--card` token the themes drive, keeping Full Black and Glass correct.
 */
export function Panel({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col rounded-lg border border-border bg-card',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PanelHeader({
  title,
  icon,
  action,
}: {
  title: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
      {icon}
      <span className="text-sm font-medium tracking-tight">{title}</span>
      {action && (
        <div className="ml-auto flex items-center gap-1">{action}</div>
      )}
    </div>
  );
}

/** A compact overview tile: a current value with a unit, a sub-line, and loading/unavailable states. */
export function MetricCard({
  title,
  icon,
  block,
  render,
}: {
  title: string;
  icon: React.ReactNode;
  block: MetricBlock<unknown> | null;
  render: () => { value: string; unit?: string; sub?: string };
}) {
  return (
    <Panel className="gap-1 p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {title}
      </div>
      {block === null ? (
        <Skeleton className="mt-1 h-7 w-20" />
      ) : block.state === 'unavailable' ? (
        <div className="mt-1 flex flex-col gap-0.5">
          <span className="text-sm text-muted-foreground">Unavailable</span>
          <span
            className="text-xs text-muted-foreground/70"
            title={block.reason}
          >
            {block.reason}
          </span>
        </div>
      ) : (
        (() => {
          const { value, unit, sub } = render();
          return (
            <>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-semibold tabular-nums tracking-tight">
                  {value}
                </span>
                {unit && (
                  <span className="text-xs text-muted-foreground">{unit}</span>
                )}
              </div>
              {sub && (
                <span className="text-xs text-muted-foreground">{sub}</span>
              )}
            </>
          );
        })()
      )}
    </Panel>
  );
}
