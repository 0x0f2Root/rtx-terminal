import type { ReactNode } from 'react';
import { ShortcutKeys } from '@/components/shortcut-keys';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

/**
 * The app's icon-only action: a ghost `icon-sm` Button whose accessible name is also its tooltip,
 * optionally with the action's shortcut. This is the convention the header, sidebar and dialogs
 * already follow; feature code uses this instead of re-composing Tooltip and Button.
 */
export function IconButton({
  label,
  onClick,
  disabled,
  accelerator,
  variant = 'ghost',
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** An accelerator such as "Ctrl+Shift+T", shown in the tooltip. */
  accelerator?: string | null;
  variant?: 'ghost' | 'outline';
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant={variant}
            size="icon-sm"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent className="flex items-center gap-2">
        {label}
        {accelerator && <ShortcutKeys accelerator={accelerator} />}
      </TooltipContent>
    </Tooltip>
  );
}
