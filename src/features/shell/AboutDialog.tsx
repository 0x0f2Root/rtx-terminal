import { useEffect, useState } from 'react';
import { RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import type { AppInfo } from '@/shared/api';
import { patchUi, useUi } from '@/state/ui';

export function AboutDialog() {
  const open = useUi((s) => s.aboutOpen);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadInfo = () => {
    setInfo(null);
    setError(null);
    void window.rtx.system
      .appInfo()
      .then(setInfo)
      .catch((reason: unknown) =>
        setError(
          reason instanceof Error ? reason.message : 'Could not load app info.',
        ),
      );
  };

  useEffect(() => {
    if (open) loadInfo();
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(next) => patchUi({ aboutOpen: next })}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>About rtx-terminal</DialogTitle>
          <DialogDescription>
            A keyboard-driven terminal for Linux.
          </DialogDescription>
        </DialogHeader>
        {info ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Version</dt>
            <dd>{info.version}</dd>
            <dt className="text-muted-foreground">Electron</dt>
            <dd>{info.electron}</dd>
            <dt className="text-muted-foreground">Chromium</dt>
            <dd>{info.chrome}</dd>
            <dt className="text-muted-foreground">Node.js</dt>
            <dd>{info.node}</dd>
            <dt className="text-muted-foreground">Platform</dt>
            <dd>
              {info.platform} ({info.arch})
            </dd>
          </dl>
        ) : error ? (
          <div className="flex items-center justify-between gap-3" role="alert">
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button size="sm" variant="outline" onClick={loadInfo}>
              <RotateCw data-icon="inline-start" />
              Retry
            </Button>
          </div>
        ) : (
          <div
            className="flex flex-col gap-2"
            role="status"
            aria-label="Loading application information"
          >
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
