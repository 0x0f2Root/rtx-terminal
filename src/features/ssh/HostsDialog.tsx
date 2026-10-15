import { useMemo, useState } from 'react';
import {
  Copy,
  Ellipsis,
  Pencil,
  Plug,
  Plus,
  Search,
  Server,
  Trash2,
  Unplug,
} from 'lucide-react';
import { Badge } from '@/components/reui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { SshHost } from '@/shared/config';
import { useAppData } from '@/state/app-data';
import { patchUi, useUi } from '@/state/ui';
import { useWorkspace } from '@/state/workspace';
import {
  connectHost,
  deleteHost,
  disconnectHost,
  duplicateHost,
} from '../actions';
import { hostStatus, hostTarget, matchesHost } from './host-utils';

function closeThen(action: () => void) {
  patchUi({ hostsOpen: false });
  requestAnimationFrame(action);
}

const editHost = (host: SshHost | 'new') =>
  patchUi({ hostEditor: host, hostEditorDefaults: null });

function HostRow({ host }: { host: SshHost }) {
  const status = useWorkspace((s) => hostStatus(s, host.id));
  return (
    <div className="flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-muted/50">
      <Server className="size-4 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">{host.name}</span>
          {status === 'connected' && (
            <Badge variant="success-light">Connected</Badge>
          )}
          {status === 'connecting' && (
            <Badge variant="warning-light">Connecting</Badge>
          )}
          {host.group && <Badge variant="outline">{host.group}</Badge>}
          {host.tags.map((tag) => (
            <Badge key={tag} variant="secondary">
              {tag}
            </Badge>
          ))}
        </div>
        <code className="truncate font-mono text-xs text-muted-foreground">
          {hostTarget(host)}
        </code>
      </div>
      <Button size="sm" onClick={() => closeThen(() => connectHost(host))}>
        <Plug data-icon="inline-start" />
        Connect
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`More actions for ${host.name}`}
            />
          }
        >
          <Ellipsis />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem
            onClick={() => closeThen(() => connectHost(host, 'split-right'))}
          >
            Connect in split right
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => closeThen(() => connectHost(host, 'split-down'))}
          >
            Connect in split down
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={status !== 'connected'}
            onClick={() => disconnectHost(host.id)}
          >
            <Unplug />
            Disconnect
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => editHost(host)}>
            <Pencil />
            Edit…
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => duplicateHost(host)}>
            <Copy />
            Duplicate
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => deleteHost(host)}
          >
            <Trash2 />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function HostsDialog() {
  const open = useUi((s) => s.hostsOpen);
  const hosts = useAppData((s) => s.profiles.hosts);
  const [query, setQuery] = useState('');
  const visible = useMemo(
    () =>
      hosts
        .filter((h) => matchesHost(h, query))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [hosts, query],
  );

  return (
    <Dialog open={open} onOpenChange={(next) => patchUi({ hostsOpen: next })}>
      <DialogContent className="flex h-[min(38rem,85vh)] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>SSH hosts</DialogTitle>
          <DialogDescription>
            Saved connections. Passwords and passphrases are kept in your system
            keyring.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <InputGroup className="flex-1">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search names, addresses, users, groups and tags"
              aria-label="Search SSH hosts"
            />
          </InputGroup>
          <Button size="sm" onClick={() => editHost('new')}>
            <Plus data-icon="inline-start" />
            New host
          </Button>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          {visible.length === 0 ? (
            <Empty className="h-full">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Server />
                </EmptyMedia>
                <EmptyTitle>
                  {hosts.length === 0 ? 'No SSH hosts yet' : 'No hosts match'}
                </EmptyTitle>
                <EmptyDescription>
                  {hosts.length === 0
                    ? 'Save a server once and connect to it from anywhere in the app.'
                    : 'Try a different search.'}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                {hosts.length === 0 ? (
                  <Button size="sm" onClick={() => editHost('new')}>
                    <Plus data-icon="inline-start" />
                    New host
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setQuery('')}
                  >
                    Clear search
                  </Button>
                )}
              </EmptyContent>
            </Empty>
          ) : (
            <div className="flex flex-col gap-0.5 pr-3">
              {visible.map((host) => (
                <HostRow key={host.id} host={host} />
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
