import { useEffect, useState, type FormEvent } from 'react';
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
import { Switch } from '@/components/ui/switch';
import { answerCredential, useSshPrompts } from './ssh-prompts';

/** Asks for one password or key passphrase. The value goes to one connection attempt only. */
export function CredentialDialog() {
  const request = useSshPrompts((s) => s.credentials[0] ?? null);
  const keyring = useSshPrompts((s) => s.secrets.available);
  const [secret, setSecret] = useState('');
  const [save, setSave] = useState(false);

  useEffect(() => {
    setSecret('');
    setSave(false);
  }, [request?.id]);

  if (!request) return null;
  const isPassword = request.kind === 'password';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!secret) return;
    answerCredential(request.id, { secret, save: keyring && save });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && answerCredential(request.id, null)}
    >
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit} className="flex flex-col gap-6">
          <DialogHeader>
            <DialogTitle>
              {isPassword ? 'Password' : 'Key passphrase'}
            </DialogTitle>
            <DialogDescription>
              {isPassword
                ? `Sign in to ${request.hostLabel} as ${request.target}.`
                : `The private key for ${request.hostLabel} is encrypted.`}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={!!request.message}>
              <FieldLabel htmlFor="ssh-secret">
                {isPassword ? 'Password' : 'Passphrase'}
              </FieldLabel>
              <Input
                id="ssh-secret"
                type="password"
                autoFocus
                autoComplete="off"
                value={secret}
                aria-invalid={!!request.message}
                onChange={(e) => setSecret(e.target.value)}
              />
              {request.message && <FieldError>{request.message}</FieldError>}
            </Field>
            <Field orientation="horizontal">
              <FieldLabel htmlFor="ssh-secret-save" className="font-normal">
                Save in the system keyring
              </FieldLabel>
              <Switch
                id="ssh-secret-save"
                checked={keyring && save}
                disabled={!keyring}
                onCheckedChange={setSave}
              />
            </Field>
            <FieldDescription>
              {keyring
                ? 'Saved only after a successful sign-in, encrypted by your desktop keyring.'
                : 'No system keyring is available, so it will be asked for each time.'}
            </FieldDescription>
          </FieldGroup>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => answerCredential(request.id, null)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!secret}>
              Connect
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
