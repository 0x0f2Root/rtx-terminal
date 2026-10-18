import { IconTile } from '@/components/reui/icon-tile';
import { useMemo, useState } from 'react';
import {
  Bookmark,
  Copy,
  Ellipsis,
  History,
  Play,
  Search,
  TextCursorInput,
  Trash2,
} from 'lucide-react';
import { Badge } from '@/components/reui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { clearHistory, removeHistoryEntry, useAppData } from '@/state/app-data';
import { patchUi, useUi } from '@/state/ui';
import { copyText, insertCommand, runCommand } from '../actions';

const MODE_LABEL = {
  off: 'Off',
  memory: 'This session only',
  persist: 'Saved to disk',
} as const;

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay
    ? date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
}

function closeThen(action: () => void) {
  patchUi({ historyOpen: false });
  requestAnimationFrame(action);
}

/**
 * Commands rtx-terminal observed: typed at a prompt with plain editing, or sent from saved commands.
 * This is not the shell's own history file, which also holds commands from other terminals.
 */
export function HistoryDialog() {
  const open = useUi((s) => s.historyOpen);
  const entries = useAppData((s) => s.history.entries);
  const mode = useAppData((s) => s.preferences.history.mode);
  const homeDir = useAppData((s) => s.homeDir);
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...entries]
      .reverse()
      .filter((e) => !q || e.command.toLowerCase().includes(q));
  }, [entries, query]);

  return (
    <Dialog open={open} onOpenChange={(next) => patchUi({ historyOpen: next })}>
      <DialogContent className="flex h-[min(40rem,85vh)] flex-col gap-4 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Command history
            <Badge
              variant={
                mode === 'off'
                  ? 'secondary'
                  : mode === 'persist'
                    ? 'info-light'
                    : 'outline'
              }
            >
              {MODE_LABEL[mode]}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            Commands rtx-terminal saw you type or run. Your shell keeps its own
            history separately.
          </DialogDescription>
        </DialogHeader>
        <InputGroup>
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search commands"
            aria-label="Search command history"
          />
        </InputGroup>
        <ScrollArea className="min-h-0 flex-1">
          {visible.length === 0 ? (
            <Empty className="h-full">
              <EmptyHeader>
                <EmptyMedia>
                  <IconTile variant="elevated" size="lg" aria-hidden="true">
                    <History />
                  </IconTile>
                </EmptyMedia>
                <EmptyTitle>
                  {mode === 'off'
                    ? 'History is turned off'
                    : entries.length === 0
                      ? 'No commands yet'
                      : 'No commands match'}
                </EmptyTitle>
                <EmptyDescription>
                  {mode === 'off'
                    ? 'Turn history on in Settings to search commands you run here.'
                    : entries.length === 0
                      ? 'Commands you type or run appear here.'
                      : 'Try a different search.'}
                </EmptyDescription>
              </EmptyHeader>
              {mode === 'off' && (
                <EmptyContent>
                  <Button
                    size="sm"
                    onClick={() =>
                      patchUi({ historyOpen: false, settingsOpen: true })
                    }
                  >
                    Open settings
                  </Button>
                </EmptyContent>
              )}
            </Empty>
          ) : (
            <div className="flex flex-col gap-0.5 pr-3">
              {visible.map((entry) => (
                <div
                  key={entry.id}
                  className="group flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-muted/50"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <code className="truncate font-mono text-xs">
                      {entry.command}
                    </code>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="tabular-nums">
                        {formatTime(entry.timestamp)}
                      </span>
                      {entry.cwd && (
                        <span className="truncate">
                          {entry.cwd.replace(homeDir, '~')}
                        </span>
                      )}
                      {entry.source === 'app' && (
                        <span>· from saved command</span>
                      )}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      closeThen(() => insertCommand(entry.command))
                    }
                  >
                    Insert
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="More actions"
                        />
                      }
                    >
                      <Ellipsis />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      <DropdownMenuItem
                        onClick={() =>
                          closeThen(() => runCommand(entry.command, 'history'))
                        }
                      >
                        <Play />
                        Run in active terminal
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          closeThen(() => insertCommand(entry.command))
                        }
                      >
                        <TextCursorInput />
                        Insert without running
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => copyText(entry.command)}>
                        <Copy />
                        Copy
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          patchUi({
                            commandEditor: 'new',
                            commandEditorDefaults: {
                              command: entry.command,
                              name: entry.command.slice(0, 40),
                            },
                          })
                        }
                      >
                        <Bookmark />
                        Save as command…
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => removeHistoryEntry(entry.id)}
                      >
                        <Trash2 />
                        Remove from history
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
        <DialogFooter className="items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            Lines edited with arrows, Tab completion or without echo (passwords)
            are never recorded.
          </p>
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button
                  variant="outline"
                  size="sm"
                  disabled={entries.length === 0}
                />
              }
            >
              <Trash2 data-icon="inline-start" />
              Clear history
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Clear command history?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes {entries.length} recorded command
                  {entries.length === 1 ? '' : 's'} from rtx-terminal
                  {mode === 'persist' ? ' and deletes the history file' : ''}.
                  Your shell's own history is not touched.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={clearHistory}>
                  Clear history
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
