import { useEffect, useState, type FormEvent } from 'react';
import { FolderOpen, KeyRound } from 'lucide-react';
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
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import {
  LIMITS,
  validateSshHost,
  type SshAuthMethod,
  type SshHost,
  type SshHostDraft,
} from '@/shared/config';
import { newId } from '@/lib/ids';
import { updateProfiles } from '@/state/app-data';
import { patchUi, useUi } from '@/state/ui';
import { connectHost } from '../actions';
import { refreshSecretState, useSshPrompts } from './ssh-prompts';

const NO_ALIAS = '__none';

const EMPTY: SshHostDraft = {
  name: '',
  host: '',
  port: 22,
  username: '',
  auth: 'agent',
  keyPath: null,
  configAlias: null,
  group: null,
  tags: [],
  notes: '',
  connectTimeout: 20,
  keepAlive: 15,
};

const AUTH_ITEMS: { value: SshAuthMethod; label: string; hint: string }[] = [
  {
    value: 'agent',
    label: 'SSH agent',
    hint: 'Keys held by your running ssh-agent or desktop keyring.',
  },
  {
    value: 'key',
    label: 'Private key file',
    hint: 'A key file; encrypted keys ask for their passphrase.',
  },
  {
    value: 'password',
    label: 'Password',
    hint: 'Asked when connecting, or taken from the system keyring.',
  },
];

const NO_SECRETS: string[] = [];

export function HostEditorDialog() {
  const editing = useUi((s) => s.hostEditor);
  const defaults = useUi((s) => s.hostEditorDefaults);
  const existing = editing && editing !== 'new' ? editing : null;
  const saved = useSshPrompts((s) =>
    existing ? (s.secrets.saved[existing.id] ?? NO_SECRETS) : NO_SECRETS,
  );
  const [draft, setDraft] = useState<SshHostDraft>(EMPTY);
  const [tags, setTags] = useState('');
  const [aliases, setAliases] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState(false);

  const open = editing !== null;

  useEffect(() => {
    if (!open) return;
    const { id: _id, ...source } = {
      ...EMPTY,
      ...(existing ?? defaults),
    } as SshHost;
    setDraft(source);
    setTags(source.tags.join(', '));
    setSubmitted(false);
    void window.rtx.ssh.configAliases().then(setAliases, () => setAliases([]));
  }, [open, existing, defaults]);

  const close = () => patchUi({ hostEditor: null, hostEditorDefaults: null });
  const set = (patch: Partial<SshHostDraft>) =>
    setDraft((d) => ({ ...d, ...patch }));

  const candidate: SshHostDraft = {
    ...draft,
    name: draft.name.trim(),
    host: draft.host.trim(),
    username: draft.username.trim(),
    keyPath: draft.auth === 'key' ? draft.keyPath?.trim() || null : null,
    group: draft.group?.trim() || null,
    tags: [
      ...new Set(
        tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      ),
    ].slice(0, LIMITS.tags),
  };
  const errors = validateSshHost(candidate);
  const shown = submitted ? errors : {};

  const save = (connect: boolean, event?: FormEvent) => {
    event?.preventDefault();
    setSubmitted(true);
    if (Object.keys(errors).length > 0) return;
    const host: SshHost = { id: existing?.id ?? newId('host'), ...candidate };
    const written = updateProfiles((p) => ({
      ...p,
      hosts: existing
        ? p.hosts.map((h) => (h.id === existing.id ? host : h))
        : [...p.hosts, host],
    }));
    close();
    // The main process reads hosts from disk, so connect only after the save landed.
    if (connect) void written.then((ok) => ok && connectHost(host));
  };

  const aliasItems = [
    { value: NO_ALIAS, label: 'None' },
    ...aliases.map((a) => ({ value: a, label: a })),
  ];
  if (draft.configAlias && !aliases.includes(draft.configAlias))
    aliasItems.push({ value: draft.configAlias, label: draft.configAlias });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="flex h-[min(46rem,90vh)] flex-col sm:max-w-lg">
        <form
          onSubmit={(e) => save(false, e)}
          className="flex min-h-0 flex-1 flex-col gap-6"
          noValidate
        >
          <DialogHeader>
            <DialogTitle>
              {existing ? 'Edit SSH host' : 'New SSH connection'}
            </DialogTitle>
            <DialogDescription>
              Saved without passwords; secrets stay in your system keyring.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="min-h-0 flex-1">
            <FieldGroup className="pr-3">
              <Field data-invalid={!!shown.name}>
                <FieldLabel htmlFor="host-name">Name</FieldLabel>
                <Input
                  id="host-name"
                  autoFocus
                  value={draft.name}
                  maxLength={LIMITS.name}
                  placeholder="web-prod-01"
                  aria-invalid={!!shown.name}
                  onChange={(e) => set({ name: e.target.value })}
                />
                {shown.name && <FieldError>{shown.name}</FieldError>}
              </Field>
              <div className="grid grid-cols-[1fr_6rem] gap-3">
                <Field data-invalid={!!shown.host}>
                  <FieldLabel htmlFor="host-address">Host</FieldLabel>
                  <Input
                    id="host-address"
                    value={draft.host}
                    placeholder="203.0.113.10 or server.example.com"
                    spellCheck={false}
                    aria-invalid={!!shown.host}
                    onChange={(e) => set({ host: e.target.value })}
                  />
                  {shown.host && <FieldError>{shown.host}</FieldError>}
                </Field>
                <Field data-invalid={!!shown.port}>
                  <FieldLabel htmlFor="host-port">Port</FieldLabel>
                  <Input
                    id="host-port"
                    type="number"
                    min={1}
                    max={65535}
                    value={draft.port}
                    aria-invalid={!!shown.port}
                    onChange={(e) => set({ port: Number(e.target.value) })}
                  />
                  {shown.port && <FieldError>{shown.port}</FieldError>}
                </Field>
              </div>
              <Field data-invalid={!!shown.username}>
                <FieldLabel htmlFor="host-user">User</FieldLabel>
                <Input
                  id="host-user"
                  value={draft.username}
                  placeholder="deploy"
                  spellCheck={false}
                  aria-invalid={!!shown.username}
                  onChange={(e) => set({ username: e.target.value })}
                />
                {shown.username && <FieldError>{shown.username}</FieldError>}
              </Field>
              <Field>
                <FieldLabel>Authentication</FieldLabel>
                <Select
                  items={AUTH_ITEMS.map(({ value, label }) => ({
                    value,
                    label,
                  }))}
                  value={draft.auth}
                  onValueChange={(value) =>
                    set({ auth: value as SshAuthMethod })
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AUTH_ITEMS.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>
                  {AUTH_ITEMS.find((a) => a.value === draft.auth)?.hint}
                </FieldDescription>
              </Field>
              {draft.auth === 'key' && (
                <Field data-invalid={!!shown.keyPath}>
                  <FieldLabel htmlFor="host-key">Private key</FieldLabel>
                  <InputGroup>
                    <InputGroupInput
                      id="host-key"
                      value={draft.keyPath ?? ''}
                      placeholder="/home/you/.ssh/id_ed25519"
                      className="font-mono"
                      spellCheck={false}
                      aria-invalid={!!shown.keyPath}
                      onChange={(e) => set({ keyPath: e.target.value || null })}
                    />
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton
                        onClick={() =>
                          void window.rtx.ssh
                            .pickKeyFile()
                            .then((file) => file && set({ keyPath: file }))
                        }
                      >
                        <FolderOpen />
                        Browse
                      </InputGroupButton>
                    </InputGroupAddon>
                  </InputGroup>
                  {shown.keyPath ? (
                    <FieldError>{shown.keyPath}</FieldError>
                  ) : (
                    <FieldDescription>
                      Only the path is saved. The key is read when connecting.
                    </FieldDescription>
                  )}
                </Field>
              )}
              {existing && saved.length > 0 && (
                <Field orientation="horizontal">
                  <FieldDescription className="flex flex-1 items-center gap-2">
                    <KeyRound className="size-4" />A {saved.join(' and ')} is
                    saved in the system keyring.
                  </FieldDescription>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void window.rtx.ssh
                        .forgetSecrets(existing.id)
                        .then(() => refreshSecretState())
                    }
                  >
                    Forget
                  </Button>
                </Field>
              )}
              <Field data-invalid={!!shown.configAlias}>
                <FieldLabel>~/.ssh/config alias</FieldLabel>
                <Select
                  items={aliasItems}
                  value={draft.configAlias ?? NO_ALIAS}
                  onValueChange={(value) =>
                    set({
                      configAlias: value === NO_ALIAS ? null : String(value),
                    })
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {aliasItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {shown.configAlias ? (
                  <FieldError>{shown.configAlias}</FieldError>
                ) : (
                  <FieldDescription>
                    Fills an empty host, user, port or key from that entry.
                    Commands in it are never run.
                  </FieldDescription>
                )}
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel htmlFor="host-group">Group</FieldLabel>
                  <Input
                    id="host-group"
                    value={draft.group ?? ''}
                    placeholder="Production"
                    onChange={(e) => set({ group: e.target.value || null })}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="host-tags">Tags</FieldLabel>
                  <Input
                    id="host-tags"
                    value={tags}
                    placeholder="web, eu"
                    onChange={(e) => setTags(e.target.value)}
                  />
                </Field>
              </div>
              <Field data-invalid={!!shown.notes}>
                <FieldLabel htmlFor="host-notes">Notes</FieldLabel>
                <Textarea
                  id="host-notes"
                  rows={2}
                  value={draft.notes}
                  maxLength={LIMITS.notes}
                  onChange={(e) => set({ notes: e.target.value })}
                />
                {shown.notes && <FieldError>{shown.notes}</FieldError>}
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field data-invalid={!!shown.connectTimeout}>
                  <FieldLabel htmlFor="host-timeout">
                    Connect timeout (s)
                  </FieldLabel>
                  <Input
                    id="host-timeout"
                    type="number"
                    min={5}
                    max={120}
                    value={draft.connectTimeout}
                    aria-invalid={!!shown.connectTimeout}
                    onChange={(e) =>
                      set({ connectTimeout: Number(e.target.value) })
                    }
                  />
                  {shown.connectTimeout && (
                    <FieldError>{shown.connectTimeout}</FieldError>
                  )}
                </Field>
                <Field data-invalid={!!shown.keepAlive}>
                  <FieldLabel htmlFor="host-keepalive">
                    Keepalive (s, 0 off)
                  </FieldLabel>
                  <Input
                    id="host-keepalive"
                    type="number"
                    min={0}
                    max={300}
                    value={draft.keepAlive}
                    aria-invalid={!!shown.keepAlive}
                    onChange={(e) => set({ keepAlive: Number(e.target.value) })}
                  />
                  {shown.keepAlive && (
                    <FieldError>{shown.keepAlive}</FieldError>
                  )}
                </Field>
              </div>
            </FieldGroup>
          </ScrollArea>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="button" variant="outline" onClick={() => save(true)}>
              Save and connect
            </Button>
            <Button type="submit">
              {existing ? 'Save changes' : 'Save host'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
