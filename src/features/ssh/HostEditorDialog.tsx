import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  ChevronRight,
  FileKey,
  FolderOpen,
  Globe,
  KeyRound,
  Server,
  ShieldCheck,
  User,
} from 'lucide-react';
import { IconTile } from '@/components/reui/icon-tile';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
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
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldTitle,
} from '@/components/ui/field';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from '@/components/ui/input-group';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
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

const AUTH_ITEMS: {
  value: SshAuthMethod;
  label: string;
  hint: string;
  icon: ReactNode;
}[] = [
  {
    value: 'agent',
    label: 'SSH agent',
    hint: 'Keys held by your running ssh-agent or desktop keyring.',
    icon: <ShieldCheck />,
  },
  {
    value: 'key',
    label: 'Private key file',
    hint: 'A key file; encrypted keys ask for their passphrase.',
    icon: <FileKey />,
  },
  {
    value: 'password',
    label: 'Password',
    hint: 'Asked when connecting, or taken from the system keyring.',
    icon: <KeyRound />,
  },
];

const NO_SECRETS: string[] = [];

/** The equivalent OpenSSH command line, so the form reads as what it will do. */
function sshPreview(draft: SshHostDraft): string {
  const target = draft.host.trim() || draft.configAlias || '<host>';
  const user = draft.username.trim();
  const parts = ['ssh', user ? `${user}@${target}` : target];
  if (draft.port && draft.port !== 22) parts.push('-p', String(draft.port));
  if (draft.auth === 'key' && draft.keyPath?.trim())
    parts.push('-i', draft.keyPath.trim());
  return parts.join(' ');
}

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
  const [advancedOpen, setAdvancedOpen] = useState(false);

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
    setAdvancedOpen(false);
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
  // An invalid timeout would otherwise hide inside the folded section.
  const advancedInvalid = !!(shown.connectTimeout || shown.keepAlive);

  const save = (connect: boolean, event?: FormEvent) => {
    event?.preventDefault();
    setSubmitted(true);
    if (Object.keys(errors).length > 0) {
      if (errors.connectTimeout || errors.keepAlive) setAdvancedOpen(true);
      return;
    }
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
      <DialogContent className="flex h-[min(48rem,90vh)] flex-col sm:max-w-xl">
        <form
          onSubmit={(e) => save(false, e)}
          className="flex min-h-0 flex-1 flex-col gap-6"
          noValidate
        >
          <DialogHeader className="flex-row items-center gap-3">
            <IconTile variant="elevated" size="default" aria-hidden="true">
              <Server />
            </IconTile>
            <div className="flex min-w-0 flex-col gap-0.5">
              <DialogTitle>
                {existing ? 'Edit SSH host' : 'New SSH connection'}
              </DialogTitle>
              <DialogDescription>
                Saved without passwords; secrets stay in your system keyring.
              </DialogDescription>
            </div>
          </DialogHeader>
          <ScrollArea className="min-h-0 flex-1">
            <FieldGroup className="pr-3">
              <FieldSet>
                <FieldLegend>Connection</FieldLegend>
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
                <div className="grid grid-cols-[1fr_7rem] gap-3">
                  <Field data-invalid={!!shown.host}>
                    <FieldLabel htmlFor="host-address">Host</FieldLabel>
                    <InputGroup>
                      <InputGroupAddon>
                        <Globe />
                      </InputGroupAddon>
                      <InputGroupInput
                        id="host-address"
                        value={draft.host}
                        placeholder="203.0.113.10 or server.example.com"
                        spellCheck={false}
                        aria-invalid={!!shown.host}
                        onChange={(e) => set({ host: e.target.value })}
                      />
                    </InputGroup>
                    {shown.host && <FieldError>{shown.host}</FieldError>}
                  </Field>
                  <Field data-invalid={!!shown.port}>
                    <FieldLabel htmlFor="host-port">Port</FieldLabel>
                    <InputGroup>
                      <InputGroupAddon>
                        <InputGroupText>:</InputGroupText>
                      </InputGroupAddon>
                      <InputGroupInput
                        id="host-port"
                        type="number"
                        min={1}
                        max={65535}
                        className="tabular-nums"
                        value={draft.port}
                        aria-invalid={!!shown.port}
                        onChange={(e) => set({ port: Number(e.target.value) })}
                      />
                    </InputGroup>
                    {shown.port && <FieldError>{shown.port}</FieldError>}
                  </Field>
                </div>
                <Field data-invalid={!!shown.username}>
                  <FieldLabel htmlFor="host-user">User</FieldLabel>
                  <InputGroup>
                    <InputGroupAddon>
                      <User />
                    </InputGroupAddon>
                    <InputGroupInput
                      id="host-user"
                      value={draft.username}
                      placeholder="deploy"
                      spellCheck={false}
                      aria-invalid={!!shown.username}
                      onChange={(e) => set({ username: e.target.value })}
                    />
                  </InputGroup>
                  {shown.username ? (
                    <FieldError>{shown.username}</FieldError>
                  ) : (
                    <FieldDescription className="truncate font-mono text-xs">
                      {sshPreview(draft)}
                    </FieldDescription>
                  )}
                </Field>
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
              </FieldSet>

              <FieldSeparator />

              <FieldSet>
                <FieldLegend>Authentication</FieldLegend>
                <RadioGroup
                  value={draft.auth}
                  onValueChange={(value) =>
                    set({ auth: value as SshAuthMethod })
                  }
                  aria-label="Authentication method"
                >
                  {AUTH_ITEMS.map((item) => (
                    <FieldLabel key={item.value} htmlFor={`auth-${item.value}`}>
                      <Field orientation="horizontal">
                        <IconTile
                          variant="elevated"
                          size="sm"
                          aria-hidden="true"
                        >
                          {item.icon}
                        </IconTile>
                        <FieldContent>
                          <FieldTitle>{item.label}</FieldTitle>
                          <FieldDescription>{item.hint}</FieldDescription>
                        </FieldContent>
                        <RadioGroupItem
                          value={item.value}
                          id={`auth-${item.value}`}
                        />
                      </Field>
                    </FieldLabel>
                  ))}
                </RadioGroup>
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
                        onChange={(e) =>
                          set({ keyPath: e.target.value || null })
                        }
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
                    <FieldDescription className="flex-1">
                      A {saved.join(' and ')} is saved in the system keyring.
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
              </FieldSet>

              <FieldSeparator />

              <FieldSet>
                <FieldLegend>Organization</FieldLegend>
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
              </FieldSet>

              <Collapsible
                open={advancedOpen || advancedInvalid}
                onOpenChange={setAdvancedOpen}
                className="group/advanced flex flex-col gap-3"
              >
                <CollapsibleTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="self-start"
                    />
                  }
                >
                  <ChevronRight
                    data-icon="inline-start"
                    className="transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] group-data-open/advanced:rotate-90 motion-reduce:transition-none"
                  />
                  Advanced
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="grid grid-cols-2 gap-3">
                    <Field data-invalid={!!shown.connectTimeout}>
                      <FieldLabel htmlFor="host-timeout">
                        Connect timeout
                      </FieldLabel>
                      <InputGroup>
                        <InputGroupInput
                          id="host-timeout"
                          type="number"
                          min={5}
                          max={120}
                          className="tabular-nums"
                          value={draft.connectTimeout}
                          aria-invalid={!!shown.connectTimeout}
                          onChange={(e) =>
                            set({ connectTimeout: Number(e.target.value) })
                          }
                        />
                        <InputGroupAddon align="inline-end">
                          <InputGroupText>s</InputGroupText>
                        </InputGroupAddon>
                      </InputGroup>
                      {shown.connectTimeout ? (
                        <FieldError>{shown.connectTimeout}</FieldError>
                      ) : (
                        <FieldDescription>5 to 120 seconds.</FieldDescription>
                      )}
                    </Field>
                    <Field data-invalid={!!shown.keepAlive}>
                      <FieldLabel htmlFor="host-keepalive">
                        Keepalive
                      </FieldLabel>
                      <InputGroup>
                        <InputGroupInput
                          id="host-keepalive"
                          type="number"
                          min={0}
                          max={300}
                          className="tabular-nums"
                          value={draft.keepAlive}
                          aria-invalid={!!shown.keepAlive}
                          onChange={(e) =>
                            set({ keepAlive: Number(e.target.value) })
                          }
                        />
                        <InputGroupAddon align="inline-end">
                          <InputGroupText>s</InputGroupText>
                        </InputGroupAddon>
                      </InputGroup>
                      {shown.keepAlive ? (
                        <FieldError>{shown.keepAlive}</FieldError>
                      ) : (
                        <FieldDescription>0 turns it off.</FieldDescription>
                      )}
                    </Field>
                  </div>
                </CollapsibleContent>
              </Collapsible>
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
