import { useEffect, useState, type FormEvent } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/reui/badge';
import { ShortcutRecorder } from '@/components/shortcut-recorder';
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
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { LIMITS } from '@/shared/config';
import { destructiveReason } from '@/lib/dangerous';
import { newId } from '@/lib/ids';
import { updateCommands, useAppData } from '@/state/app-data';
import { patchUi, useUi } from '@/state/ui';

const NO_CATEGORY = '__none';
const NEW_CATEGORY = '__new';

type Draft = {
  name: string;
  command: string;
  description: string;
  categoryId: string;
  newCategory: string;
  tags: string;
  shortcut: string | null;
};

const EMPTY: Draft = {
  name: '',
  command: '',
  description: '',
  categoryId: NO_CATEGORY,
  newCategory: '',
  tags: '',
  shortcut: null,
};

export function CommandEditorDialog() {
  const editing = useUi((s) => s.commandEditor);
  const defaults = useUi((s) => s.commandEditorDefaults);
  const categories = useAppData((s) => s.commands.categories);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [submitted, setSubmitted] = useState(false);

  const open = editing !== null;
  const existing = editing && editing !== 'new' ? editing : null;

  useEffect(() => {
    if (!open) return;
    const source = existing ?? defaults ?? {};
    setDraft({
      name: source.name ?? '',
      command: source.command ?? '',
      description: source.description ?? '',
      categoryId: source.categoryId ?? NO_CATEGORY,
      newCategory: '',
      tags: (source.tags ?? []).join(', '),
      shortcut: source.shortcut ?? null,
    });
    setSubmitted(false);
  }, [open, existing, defaults]);

  const close = () =>
    patchUi({ commandEditor: null, commandEditorDefaults: null });
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const nameError = !draft.name.trim() ? 'Give the command a name.' : null;
  const commandError = !draft.command.trim()
    ? 'Enter the command to run.'
    : null;
  const categoryError =
    draft.categoryId === NEW_CATEGORY && !draft.newCategory.trim()
      ? 'Name the new category.'
      : null;
  const warning = destructiveReason(draft.command);

  const save = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (nameError || commandError || categoryError) return;
    const now = Date.now();
    let categoryId: string | null =
      draft.categoryId === NO_CATEGORY ? null : draft.categoryId;
    let newCategory: { id: string; name: string } | null = null;
    if (draft.categoryId === NEW_CATEGORY) {
      const name = draft.newCategory.trim().slice(0, LIMITS.name);
      const match = categories.find(
        (c) => c.name.toLowerCase() === name.toLowerCase(),
      );
      if (match) categoryId = match.id;
      else {
        newCategory = { id: newId('cat'), name };
        categoryId = newCategory.id;
      }
    }
    const tags = [
      ...new Set(
        draft.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      ),
    ].slice(0, LIMITS.tags);
    const fields = {
      name: draft.name.trim().slice(0, LIMITS.name),
      command: draft.command,
      description: draft.description.trim(),
      categoryId,
      tags,
      shortcut: draft.shortcut,
    };
    updateCommands((c) => ({
      ...c,
      categories: newCategory ? [...c.categories, newCategory] : c.categories,
      commands: existing
        ? c.commands.map((cmd) =>
            cmd.id === existing.id
              ? { ...cmd, ...fields, updatedAt: now }
              : cmd,
          )
        : [
            ...c.commands,
            { id: newId('cmd'), ...fields, createdAt: now, updatedAt: now },
          ],
    }));
    close();
  };

  const categoryItems = [
    { value: NO_CATEGORY, label: 'Uncategorized' },
    ...categories.map((c) => ({ value: c.id, label: c.name })),
    { value: NEW_CATEGORY, label: 'New category…' },
  ];

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={save} className="flex flex-col gap-6" noValidate>
          <DialogHeader>
            <DialogTitle>
              {existing ? 'Edit saved command' : 'New saved command'}
            </DialogTitle>
            <DialogDescription>
              Saved commands can be inserted or run in any local terminal.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={submitted && !!nameError}>
              <FieldLabel htmlFor="cmd-name">Name</FieldLabel>
              <Input
                id="cmd-name"
                autoFocus
                value={draft.name}
                maxLength={LIMITS.name}
                aria-invalid={submitted && !!nameError}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="Restart the dev server"
              />
              {submitted && nameError && <FieldError>{nameError}</FieldError>}
            </Field>
            <Field data-invalid={submitted && !!commandError}>
              <FieldLabel htmlFor="cmd-command">Command</FieldLabel>
              <Textarea
                id="cmd-command"
                value={draft.command}
                rows={3}
                spellCheck={false}
                className="font-mono text-xs"
                aria-invalid={submitted && !!commandError}
                onChange={(e) => set({ command: e.target.value })}
                placeholder="npm run dev"
              />
              {submitted && commandError && (
                <FieldError>{commandError}</FieldError>
              )}
              {warning && (
                <FieldDescription className="flex items-center gap-2">
                  <Badge variant="warning-light">
                    <TriangleAlert />
                    Asks before running
                  </Badge>
                  This command {warning}.
                </FieldDescription>
              )}
            </Field>
            <Field>
              <FieldLabel htmlFor="cmd-description">Description</FieldLabel>
              <Textarea
                id="cmd-description"
                value={draft.description}
                rows={2}
                maxLength={LIMITS.description}
                onChange={(e) => set({ description: e.target.value })}
                placeholder="Optional notes"
              />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field data-invalid={submitted && !!categoryError}>
                <FieldLabel>Category</FieldLabel>
                <Select
                  items={categoryItems}
                  value={draft.categoryId}
                  onValueChange={(value) => set({ categoryId: String(value) })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {categoryItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {draft.categoryId === NEW_CATEGORY && (
                  <Input
                    value={draft.newCategory}
                    aria-label="New category name"
                    aria-invalid={submitted && !!categoryError}
                    onChange={(e) => set({ newCategory: e.target.value })}
                    placeholder="Category name"
                  />
                )}
                {submitted && categoryError && (
                  <FieldError>{categoryError}</FieldError>
                )}
              </Field>
              <Field>
                <FieldLabel htmlFor="cmd-tags">Tags</FieldLabel>
                <Input
                  id="cmd-tags"
                  value={draft.tags}
                  onChange={(e) => set({ tags: e.target.value })}
                  placeholder="deploy, docker"
                />
                <FieldDescription>Separate tags with commas.</FieldDescription>
              </Field>
            </div>
            <Field>
              <FieldLabel>Keyboard shortcut</FieldLabel>
              <ShortcutRecorder
                value={draft.shortcut}
                ownerId={existing?.id}
                onChange={(shortcut) => set({ shortcut })}
              />
              <FieldDescription>
                The shortcut types the command into the active terminal without
                running it.
              </FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit">
              {existing ? 'Save changes' : 'Create command'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
