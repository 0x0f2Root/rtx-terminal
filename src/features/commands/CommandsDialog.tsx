import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Copy,
  Download,
  Ellipsis,
  FolderPlus,
  Pencil,
  Play,
  Plus,
  Search,
  SquareTerminal,
  TextCursorInput,
  Trash2,
  Upload,
} from 'lucide-react';
import { Badge } from '@/components/reui/badge';
import { ShortcutKeys } from '@/components/shortcut-keys';
import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
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
import { Input } from '@/components/ui/input';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { CommandCategory, SavedCommand } from '@/shared/config';
import { LIMITS } from '@/shared/config';
import { newId } from '@/lib/ids';
import { appData, updateCommands, useAppData } from '@/state/app-data';
import { patchUi, useUi } from '@/state/ui';
import { copyText, insertCommand, runCommand } from '../actions';

const ALL = '__all';
const NONE = '__none';

function deleteCommand(command: SavedCommand) {
  updateCommands((c) => ({
    ...c,
    commands: c.commands.filter((x) => x.id !== command.id),
  }));
  toast(`Deleted "${command.name}".`, {
    action: {
      label: 'Undo',
      onClick: () =>
        updateCommands((c) => ({ ...c, commands: [...c.commands, command] })),
    },
  });
}

/** Runs or inserts after the dialog closes, so focus lands in the terminal. */
function closeThen(action: () => void) {
  patchUi({ commandsOpen: false });
  requestAnimationFrame(action);
}

async function importCommands() {
  const result = await window.rtx.store.importCommands();
  if (!result.ok) {
    if (!result.cancelled)
      toast.error('Import failed', { description: result.error });
    return;
  }
  const { categories, commands } = appData.get().commands;
  const categoryByName = new Map(
    categories.map((c) => [c.name.toLowerCase(), c.id]),
  );
  const idMap = new Map<string, string>();
  const addedCategories: CommandCategory[] = [];
  for (const category of result.categories) {
    const existing = categoryByName.get(category.name.toLowerCase());
    if (existing) idMap.set(category.id, existing);
    else {
      const created = { id: newId('cat'), name: category.name };
      addedCategories.push(created);
      categoryByName.set(created.name.toLowerCase(), created.id);
      idMap.set(category.id, created.id);
    }
  }
  const known = new Set(commands.map((c) => `${c.name}\u0000${c.command}`));
  const usedShortcuts = new Set(
    commands.map((c) => c.shortcut).filter(Boolean),
  );
  const now = Date.now();
  const added: SavedCommand[] = [];
  for (const command of result.commands) {
    if (known.has(`${command.name}\u0000${command.command}`)) continue;
    known.add(`${command.name}\u0000${command.command}`);
    added.push({
      ...command,
      id: newId('cmd'),
      categoryId: command.categoryId
        ? (idMap.get(command.categoryId) ?? null)
        : null,
      // Imported shortcuts never override ones already in use.
      shortcut:
        command.shortcut && !usedShortcuts.has(command.shortcut)
          ? command.shortcut
          : null,
      createdAt: now,
      updatedAt: now,
    });
  }
  updateCommands((c) => ({
    ...c,
    categories: [...c.categories, ...addedCategories],
    commands: [...c.commands, ...added].slice(0, LIMITS.commands),
  }));
  const skipped = result.commands.length - added.length;
  toast.success(
    `Imported ${added.length} command${added.length === 1 ? '' : 's'}.`,
    {
      description:
        skipped > 0
          ? `${skipped} already existed and were skipped.`
          : undefined,
    },
  );
}

async function exportCommands() {
  const result = await window.rtx.store.exportCommands(appData.get().commands);
  if (result.ok)
    toast.success('Commands exported.', { description: result.path });
  else if (!result.cancelled)
    toast.error('Export failed', { description: result.error });
}

function CategoryRail({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (id: string) => void;
}) {
  const { categories, commands } = useAppData((s) => s.commands);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [name, setName] = useState('');
  const count = (id: string) =>
    id === ALL
      ? commands.length
      : commands.filter((c) =>
          id === NONE ? !c.categoryId : c.categoryId === id,
        ).length;

  const commit = () => {
    const value = name.trim().slice(0, LIMITS.name);
    if (renaming === 'new' && value) {
      const id = newId('cat');
      updateCommands((c) => ({
        ...c,
        categories: [...c.categories, { id, name: value }],
      }));
      onSelect(id);
    } else if (renaming && value) {
      updateCommands((c) => ({
        ...c,
        categories: c.categories.map((x) =>
          x.id === renaming ? { ...x, name: value } : x,
        ),
      }));
    }
    setRenaming(null);
  };

  const row = (id: string, label: string) => (
    <Button
      key={id}
      variant={selected === id ? 'secondary' : 'ghost'}
      size="sm"
      className="w-full justify-between"
      onClick={() => onSelect(id)}
    >
      <span className="truncate">{label}</span>
      <span className="text-xs text-muted-foreground tabular-nums">
        {count(id)}
      </span>
    </Button>
  );

  return (
    <nav
      className="flex w-44 shrink-0 flex-col gap-1 border-r pr-3"
      aria-label="Categories"
    >
      {row(ALL, 'All commands')}
      {categories.map((category) =>
        renaming === category.id ? (
          <Input
            key={category.id}
            autoFocus
            value={name}
            aria-label="Category name"
            onChange={(e) => setName(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') {
                e.stopPropagation();
                setRenaming(null);
              }
            }}
          />
        ) : (
          <ContextMenu key={category.id}>
            <ContextMenuTrigger>
              {row(category.id, category.name)}
            </ContextMenuTrigger>
            <ContextMenuContent className="w-44">
              <ContextMenuItem
                onClick={() => {
                  setName(category.name);
                  setRenaming(category.id);
                }}
              >
                <Pencil />
                Rename
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                variant="destructive"
                onClick={() => {
                  updateCommands((c) => ({
                    ...c,
                    categories: c.categories.filter(
                      (x) => x.id !== category.id,
                    ),
                    commands: c.commands.map((x) =>
                      x.categoryId === category.id
                        ? { ...x, categoryId: null }
                        : x,
                    ),
                  }));
                  if (selected === category.id) onSelect(ALL);
                  toast(
                    `Deleted category "${category.name}". Its commands are now uncategorized.`,
                  );
                }}
              >
                <Trash2 />
                Delete category
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ),
      )}
      {row(NONE, 'Uncategorized')}
      {renaming === 'new' ? (
        <Input
          autoFocus
          value={name}
          placeholder="Category name"
          aria-label="New category name"
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
              e.stopPropagation();
              setRenaming(null);
            }
          }}
        />
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="justify-start text-muted-foreground"
          onClick={() => {
            setName('');
            setRenaming('new');
          }}
        >
          <FolderPlus data-icon="inline-start" />
          New category
        </Button>
      )}
      <p className="mt-auto pt-2 text-xs text-muted-foreground">
        Right-click a category to rename or delete it.
      </p>
    </nav>
  );
}

function CommandRow({
  command,
  category,
}: {
  command: SavedCommand;
  category: string | null;
}) {
  const menuItems = (
    Item: typeof DropdownMenuItem | typeof ContextMenuItem,
    Separator: typeof DropdownMenuSeparator,
  ) => (
    <>
      <Item
        onClick={() => closeThen(() => runCommand(command.command, 'saved'))}
      >
        <Play />
        Run in active terminal
      </Item>
      <Item onClick={() => closeThen(() => insertCommand(command.command))}>
        <TextCursorInput />
        Insert without running
      </Item>
      <Item onClick={() => copyText(command.command)}>
        <Copy />
        Copy command
      </Item>
      <Separator />
      <Item
        onClick={() =>
          patchUi({ commandEditor: command, commandEditorDefaults: null })
        }
      >
        <Pencil />
        Edit…
      </Item>
      <Item variant="destructive" onClick={() => deleteCommand(command)}>
        <Trash2 />
        Delete
      </Item>
    </>
  );
  return (
    <ContextMenu>
      <ContextMenuTrigger className="group flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/50">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{command.name}</span>
            {category && <Badge variant="outline">{category}</Badge>}
            {command.tags.map((tag) => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
          </div>
          <code className="truncate font-mono text-xs text-muted-foreground">
            {command.command}
          </code>
          {command.description && (
            <p className="line-clamp-2 text-xs text-muted-foreground">
              {command.description}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <ShortcutKeys accelerator={command.shortcut} className="mr-2" />
          <Button
            size="sm"
            variant="outline"
            onClick={() => closeThen(() => insertCommand(command.command))}
          >
            Insert
          </Button>
          <Button
            size="sm"
            onClick={() =>
              closeThen(() => runCommand(command.command, 'saved'))
            }
          >
            <Play data-icon="inline-start" />
            Run
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`More actions for ${command.name}`}
                />
              }
            >
              <Ellipsis />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {menuItems(DropdownMenuItem, DropdownMenuSeparator)}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        {menuItems(ContextMenuItem, ContextMenuSeparator)}
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function CommandsDialog() {
  const open = useUi((s) => s.commandsOpen);
  const { categories, commands } = useAppData((s) => s.commands);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(ALL);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return commands
      .filter((c) =>
        category === ALL
          ? true
          : category === NONE
            ? !c.categoryId
            : c.categoryId === category,
      )
      .filter(
        (c) =>
          !q ||
          [c.name, c.command, c.description, ...c.tags].some((f) =>
            f.toLowerCase().includes(q),
          ),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [commands, category, query]);

  const categoryName = (id: string | null) =>
    categories.find((c) => c.id === id)?.name ?? null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => patchUi({ commandsOpen: next })}
    >
      <DialogContent className="flex h-[min(42rem,85vh)] flex-col gap-4 sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Saved commands</DialogTitle>
          <DialogDescription>
            Insert types a command at the prompt. Run also presses Enter.
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
              placeholder="Search names, commands and tags"
              aria-label="Search saved commands"
            />
          </InputGroup>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void importCommands()}
          >
            <Upload data-icon="inline-start" />
            Import
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={commands.length === 0}
            onClick={() => void exportCommands()}
          >
            <Download data-icon="inline-start" />
            Export
          </Button>
          <Button
            size="sm"
            onClick={() =>
              patchUi({
                commandEditor: 'new',
                commandEditorDefaults:
                  category !== ALL && category !== NONE
                    ? { categoryId: category }
                    : null,
              })
            }
          >
            <Plus data-icon="inline-start" />
            New command
          </Button>
        </div>
        <div className="flex min-h-0 flex-1 gap-4">
          <CategoryRail selected={category} onSelect={setCategory} />
          <ScrollArea className="min-h-0 flex-1">
            {visible.length === 0 ? (
              <Empty className="h-full">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <SquareTerminal />
                  </EmptyMedia>
                  <EmptyTitle>
                    {commands.length === 0
                      ? 'No saved commands yet'
                      : 'No commands match'}
                  </EmptyTitle>
                  <EmptyDescription>
                    {commands.length === 0
                      ? 'Save commands you use often and run them in any terminal.'
                      : 'Try a different search or category.'}
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  {commands.length === 0 ? (
                    <Button
                      size="sm"
                      onClick={() =>
                        patchUi({
                          commandEditor: 'new',
                          commandEditorDefaults: null,
                        })
                      }
                    >
                      <Plus data-icon="inline-start" />
                      New command
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setQuery('');
                        setCategory(ALL);
                      }}
                    >
                      Clear filters
                    </Button>
                  )}
                </EmptyContent>
              </Empty>
            ) : (
              <div className="flex flex-col gap-0.5 pr-3">
                {visible.map((command) => (
                  <CommandRow
                    key={command.id}
                    command={command}
                    category={
                      category === ALL ? categoryName(command.categoryId) : null
                    }
                  />
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
