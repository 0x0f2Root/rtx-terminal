import { useEffect, useState, type FormEvent } from 'react';
import { FolderOpen } from 'lucide-react';
import { NameDialog } from '@/components/name-dialog';
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
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LIMITS, type SessionProfile } from '@/shared/config';
import { newId } from '@/lib/ids';
import { updateProfiles, useAppData } from '@/state/app-data';
import { patchUi, useUi } from '@/state/ui';
import { renameTab, workspace } from '@/state/workspace';
import { openProfile } from '../actions';

const DEFAULT_SHELL = '__default';
const NO_GROUP = '__none';

export function ProfileEditorDialog() {
  const editing = useUi((s) => s.profileEditor);
  const defaults = useUi((s) => s.profileEditorDefaults);
  const groups = useAppData((s) => s.profiles.groups);
  const shells = useAppData((s) => s.shells);
  const [name, setName] = useState('');
  const [shell, setShell] = useState(DEFAULT_SHELL);
  const [cwd, setCwd] = useState('');
  const [groupId, setGroupId] = useState(NO_GROUP);
  const [submitted, setSubmitted] = useState(false);

  const open = editing !== null;
  const existing = editing && editing !== 'new' ? editing : null;

  useEffect(() => {
    if (!open) return;
    const source: Partial<SessionProfile> = existing ?? defaults ?? {};
    setName(source.name ?? '');
    setShell(source.shell ?? DEFAULT_SHELL);
    setCwd(source.cwd ?? '');
    setGroupId(source.groupId ?? groups[0]?.id ?? NO_GROUP);
    setSubmitted(false);
  }, [open, existing, defaults, groups]);

  const close = () =>
    patchUi({ profileEditor: null, profileEditorDefaults: null });
  const nameError = !name.trim() ? 'Give the session a name.' : null;
  const cwdError =
    cwd.trim() && !cwd.trim().startsWith('/')
      ? 'Use an absolute path, or leave empty for your home folder.'
      : null;

  const shellItems = [
    { value: DEFAULT_SHELL, label: 'Default shell' },
    ...shells.map((s) => ({ value: s.path, label: s.path })),
    ...(shell !== DEFAULT_SHELL && !shells.some((s) => s.path === shell)
      ? [{ value: shell, label: shell }]
      : []),
  ];
  const groupItems = [
    ...groups.map((g) => ({ value: g.id, label: g.name })),
    { value: NO_GROUP, label: 'No group' },
  ];

  const save = (event: FormEvent, launch = false) => {
    event.preventDefault();
    setSubmitted(true);
    if (nameError || cwdError) return;
    const profile: SessionProfile = {
      id: existing?.id ?? newId('prf'),
      kind: 'local',
      name: name.trim().slice(0, LIMITS.name),
      shell: shell === DEFAULT_SHELL ? null : shell,
      cwd: cwd.trim() || null,
      groupId: groupId === NO_GROUP ? null : groupId,
      favorite: existing?.favorite ?? false,
    };
    updateProfiles((p) => ({
      ...p,
      profiles: existing
        ? p.profiles.map((x) => (x.id === existing.id ? profile : x))
        : [...p.profiles, profile],
    }));
    close();
    if (launch) openProfile(profile);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={save} className="flex flex-col gap-6" noValidate>
          <DialogHeader>
            <DialogTitle>
              {existing ? 'Edit saved session' : 'New saved session'}
            </DialogTitle>
            <DialogDescription>
              A local shell with its own starting folder. SSH sessions will be
              added later.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={submitted && !!nameError}>
              <FieldLabel htmlFor="profile-name">Name</FieldLabel>
              <Input
                id="profile-name"
                autoFocus
                value={name}
                maxLength={LIMITS.name}
                aria-invalid={submitted && !!nameError}
                onChange={(e) => setName(e.target.value)}
                placeholder="Project workspace"
              />
              {submitted && nameError && <FieldError>{nameError}</FieldError>}
            </Field>
            <Field data-invalid={submitted && !!cwdError}>
              <FieldLabel htmlFor="profile-cwd">Starting folder</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id="profile-cwd"
                  value={cwd}
                  className="font-mono text-xs"
                  aria-invalid={submitted && !!cwdError}
                  onChange={(e) => setCwd(e.target.value)}
                  placeholder="Home folder"
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    size="xs"
                    onClick={() =>
                      void window.rtx.system
                        .pickDirectory()
                        .then((dir) => dir && setCwd(dir))
                    }
                  >
                    <FolderOpen />
                    Browse
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
              {submitted && cwdError ? (
                <FieldError>{cwdError}</FieldError>
              ) : (
                <FieldDescription>
                  The folder must exist when the session opens.
                </FieldDescription>
              )}
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel>Shell</FieldLabel>
                <Select
                  items={shellItems}
                  value={shell}
                  onValueChange={(value) => setShell(String(value))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {shellItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>Group</FieldLabel>
                <Select
                  items={groupItems}
                  value={groupId}
                  onValueChange={(value) => setGroupId(String(value))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {groupItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={(e) => save(e, true)}
            >
              Save and open
            </Button>
            <Button type="submit">
              {existing ? 'Save changes' : 'Create session'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function GroupEditorDialog() {
  const editing = useUi((s) => s.groupEditor);
  const existing = editing && editing !== 'new' ? editing : null;
  return (
    <NameDialog
      open={editing !== null}
      title={existing ? 'Rename group' : 'New group'}
      description="Groups organize saved sessions in the sidebar."
      label="Group name"
      initial={existing?.name ?? ''}
      placeholder="Work"
      submitLabel={existing ? 'Rename' : 'Create group'}
      onClose={() => patchUi({ groupEditor: null })}
      onSubmit={(name) =>
        updateProfiles((p) =>
          existing
            ? {
                ...p,
                groups: p.groups.map((g) =>
                  g.id === existing.id ? { ...g, name } : g,
                ),
              }
            : { ...p, groups: [...p.groups, { id: newId('grp'), name }] },
        )
      }
    />
  );
}

export function RenameTabDialog() {
  const tabId = useUi((s) => s.renameTabId);
  const tab = tabId ? workspace.get().tabs.find((t) => t.id === tabId) : null;
  return (
    <NameDialog
      open={tabId !== null}
      title="Rename tab"
      description="Leave empty to follow the title the shell sets."
      label="Tab name"
      initial={tab?.customTitle ?? ''}
      placeholder="Automatic"
      submitLabel="Rename"
      allowEmpty
      onClose={() => patchUi({ renameTabId: null })}
      onSubmit={(name) => tabId && renameTab(tabId, name || null)}
    />
  );
}
