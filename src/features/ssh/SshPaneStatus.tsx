import { Pencil, RotateCw, ServerOff, ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/reui/badge';
import { IconTile } from '@/components/reui/icon-tile';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';
import type { SshErrorCode } from '@/shared/api';
import { useAppData } from '@/state/app-data';
import { patchUi } from '@/state/ui';
import type { PaneState } from '@/state/workspace';
import { closePane } from '../actions';
import { getController } from '../terminal/registry';

const ERROR_TITLES: Partial<Record<SshErrorCode, string>> = {
  dns: 'Host name not found',
  refused: 'Connection refused',
  unreachable: 'Host unreachable',
  timeout: 'Connection timed out',
  auth: 'Authentication failed',
  agent: 'SSH agent unavailable',
  'key-file': 'Private key unavailable',
  'passphrase-wrong': 'Wrong key passphrase',
  'host-key-rejected': 'Host key not trusted',
  'host-key-changed': 'Host key changed',
  'host-key-revoked': 'Host key revoked',
  cancelled: 'Connection cancelled',
  'host-missing': 'Host no longer saved',
};

const HOST_KEY_ERRORS = new Set<SshErrorCode>([
  'host-key-rejected',
  'host-key-changed',
  'host-key-revoked',
]);

/** Connection progress, failure and disconnect states for a pane running an SSH session. */
export function SshPaneStatus({ pane }: { pane: PaneState }) {
  const hostId = pane.launch.ssh?.hostId ?? '';
  const host = useAppData(
    (s) => s.profiles.hosts.find((h) => h.id === hostId) ?? null,
  );
  const controller = () => getController(pane.id);
  const name = host?.name ?? pane.launch.label ?? 'host';

  if (pane.status === 'starting') {
    return (
      <div className="absolute inset-0 flex items-center justify-center animate-in fade-in-0 duration-200 delay-300 fill-mode-backwards ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:animate-none">
        <div className="flex items-center gap-2 text-sm">
          <Spinner />
          <span className="text-muted-foreground">
            {pane.connecting === 'authenticating'
              ? `Signing in to ${name}`
              : `Connecting to ${name}`}
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => controller()?.cancelConnect()}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  if (pane.status === 'error') {
    const hostKey = pane.errorCode
      ? HOST_KEY_ERRORS.has(pane.errorCode)
      : false;
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-workspace/90 p-6">
        <Empty className="max-w-md">
          <EmptyHeader>
            <EmptyMedia>
              <IconTile
                variant="elevated"
                size="lg"
                aria-hidden="true"
                className={hostKey ? 'text-destructive' : undefined}
              >
                {hostKey ? <ShieldAlert /> : <ServerOff />}
              </IconTile>
            </EmptyMedia>
            <EmptyTitle>
              {(pane.errorCode && ERROR_TITLES[pane.errorCode]) ??
                `Could not connect to ${name}`}
            </EmptyTitle>
            <EmptyDescription>{pane.error}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row justify-center gap-2">
            {host && (
              <Button size="sm" onClick={() => controller()?.restart()}>
                <RotateCw data-icon="inline-start" />
                Retry
              </Button>
            )}
            {host && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  patchUi({ hostEditor: host, hostEditorDefaults: null })
                }
              >
                <Pencil data-icon="inline-start" />
                Edit host
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => closePane(pane.id)}
            >
              Close
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  if (pane.status === 'exited') {
    return (
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 border-t bg-chrome/95 px-3 py-2 animate-in fade-in-0 duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:animate-none">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <Badge
            variant={pane.exitCode === 0 ? 'secondary' : 'destructive-light'}
          >
            Disconnected
          </Badge>
          <span className="truncate text-muted-foreground">
            {pane.exitReason ?? 'The connection ended.'} Reconnecting opens a
            new remote shell.
          </span>
        </div>
        <div className="flex items-center gap-2">
          {host && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => controller()?.restart()}
            >
              <RotateCw data-icon="inline-start" />
              Reconnect
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => closePane(pane.id)}>
            Close
          </Button>
        </div>
      </div>
    );
  }

  return null;
}
