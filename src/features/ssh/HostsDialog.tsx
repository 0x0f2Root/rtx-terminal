import { useMemo, useState } from 'react';
import {
  Columns2,
  Copy,
  Ellipsis,
  FolderTree,
  Gauge,
  Pencil,
  Plug,
  Plus,
  Rows2,
  Search,
  Server,
  Trash2,
  Unplug,
} from 'lucide-react';
import { Badge } from '@/components/reui/badge';
import { IconTile } from '@/components/reui/icon-tile';
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
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
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
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { SshAuthMethod, SshHost } from '@/shared/config';
import { useAppData } from '@/state/app-data';
import { patchUi, useUi } from '@/state/ui';
import { useWorkspace } from '@/state/workspace';
import {
  connectHost,
  deleteHost,
  disconnectHost,
  duplicateHost,
  openHostFiles,
  openHostMonitor,
} from '../actions';
import { hostStatus, hostTarget, matchesHost } from './host-utils';

const AUTH_LABEL: Record<SshAuthMethod, string> = {
  agent: 'SSH agent',
  key: 'Private key',
  password: 'Password',
};

function closeThen(action: () => void) {
  patchUi({ hostsOpen: false });
  requestAnimationFrame(action);
}

const editHost = (host: SshHost | 'new') =>
  patchUi({ hostEditor: host, hostEditorDefaults: null });

function HostActions({
  host,
  connected,
}: {
  host: SshHost;
  connected: boolean;
}) {
  return (
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
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Connect</DropdownMenuLabel>
          <DropdownMenuItem
            onClick={() => closeThen(() => connectHost(host, 'split-right'))}
          >
            <Columns2 />
            In split right
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => closeThen(() => connectHost(host, 'split-down'))}
          >
            <Rows2 />
            In split down
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!connected}
            onClick={() => disconnectHost(host.id)}
          >
            <Unplug />
            Disconnect
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Tools</DropdownMenuLabel>
          <DropdownMenuItem
            onClick={() => closeThen(() => openHostFiles(host))}
          >
            <FolderTree />
            Remote files
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => closeThen(() => openHostMonitor(host))}
          >
            <Gauge />
            Resource monitor
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => editHost(host)}>
            <Pencil />
            Edit…
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => duplicateHost(host)}>
            <Copy />
            Duplicate
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            variant="destructive"
            onClick={() => deleteHost(host)}
          >
            <Trash2 />
            Delete
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** One saved host as an outline item: tile, name and target, status, then its actions. */
function HostItem({ host }: { host: SshHost }) {
  const status = useWorkspace((s) => hostStatus(s, host.id));
  const meta = [
    AUTH_LABEL[host.auth],
    host.configAlias ? `~/.ssh/config: ${host.configAlias}` : null,
    ...host.tags,
  ].filter(Boolean);
  return (
    <Item variant="outline" size="sm">
      <ItemMedia>
        <IconTile variant="elevated" size="sm" aria-hidden="true">
          <Server />
        </IconTile>
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="w-full min-w-0">
          <span className="truncate">{host.name}</span>
          {status === 'connected' && (
            <Badge variant="success-light">Connected</Badge>
          )}
          {status === 'connecting' && (
            <Badge variant="warning-light">Connecting</Badge>
          )}
        </ItemTitle>
        <ItemDescription className="truncate font-mono">
          {hostTarget(host)}
        </ItemDescription>
        <p className="truncate text-xs text-muted-foreground">
          {meta.join(' · ')}
        </p>
      </ItemContent>
      <ItemActions>
        <Button
          size="sm"
          variant="outline"
          onClick={() => closeThen(() => connectHost(host))}
        >
          <Plug data-icon="inline-start" />
          Connect
        </Button>
        <HostActions host={host} connected={status === 'connected'} />
      </ItemActions>
    </Item>
  );
}

export function HostsDialog() {
  const open = useUi((s) => s.hostsOpen);
  const hosts = useAppData((s) => s.profiles.hosts);
  const [query, setQuery] = useState('');
  // Hosts sorted by name under their group; ungrouped hosts come last.
  const groups = useMemo(() => {
    const byGroup = new Map<string, SshHost[]>();
    for (const host of hosts) {
      if (!matchesHost(host, query)) continue;
      const key = host.group ?? '';
      byGroup.set(key, [...(byGroup.get(key) ?? []), host]);
    }
    return [...byGroup.entries()]
      .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
      .map(([name, items]) => ({
        name,
        items: items.sort((a, b) => a.name.localeCompare(b.name)),
      }));
  }, [hosts, query]);

  return (
    <Dialog open={open} onOpenChange={(next) => patchUi({ hostsOpen: next })}>
      <DialogContent className="flex h-[min(38rem,85vh)] flex-col gap-4 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            SSH hosts
            {hosts.length > 0 && (
              <Badge variant="secondary" className="tabular-nums">
                {hosts.length}
              </Badge>
            )}
          </DialogTitle>
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
        <ScrollArea className="min-h-0 min-w-0 flex-1">
          {groups.length === 0 ? (
            <Empty className="h-full">
              <EmptyHeader>
                <EmptyMedia>
                  <IconTile variant="elevated" size="lg" aria-hidden="true">
                    <Server />
                  </IconTile>
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
            <div className="flex flex-col gap-4 pr-3">
              {groups.map((group) => (
                <section
                  key={group.name}
                  className="flex flex-col gap-2"
                  aria-label={group.name || 'Ungrouped'}
                >
                  {(group.name || groups.length > 1) && (
                    <h3 className="text-xs font-medium text-muted-foreground">
                      {group.name || 'Ungrouped'}
                    </h3>
                  )}
                  <ItemGroup className="gap-2">
                    {group.items.map((host) => (
                      <HostItem key={host.id} host={host} />
                    ))}
                  </ItemGroup>
                </section>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
