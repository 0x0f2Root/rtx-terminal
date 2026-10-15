import { useEffect, useRef } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CaseSensitive,
  Regex,
  WholeWord,
  X,
} from 'lucide-react';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group';
import { Toggle } from '@/components/ui/toggle';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { patchSearch, useUi } from '@/state/ui';
import { getController } from './registry';

/** Find bar for one pane, backed by xterm's search addon. Enter goes forward, Shift+Enter back. */
export function TerminalSearch({ paneId }: { paneId: string }) {
  const search = useUi((s) => s.search);
  const inputRef = useRef<HTMLInputElement>(null);
  const options = {
    caseSensitive: search.caseSensitive,
    regex: search.regex,
    wholeWord: search.wholeWord,
  };

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Re-run the search as the query or its options change, starting from the current match.
  useEffect(() => {
    const controller = getController(paneId);
    if (!controller) return;
    if (!search.query) {
      controller.clearSearch();
      patchSearch({ resultIndex: -1, resultCount: 0 });
      return;
    }
    let valid = true;
    if (search.regex) {
      try {
        new RegExp(search.query);
      } catch {
        valid = false;
      }
    }
    if (valid)
      controller.find(search.query, { ...options, incremental: true }, 'next');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    paneId,
    search.query,
    search.caseSensitive,
    search.regex,
    search.wholeWord,
  ]);

  const find = (direction: 'next' | 'previous') =>
    getController(paneId)?.find(search.query, options, direction);

  const close = () => {
    getController(paneId)?.clearSearch();
    patchSearch({ open: false, paneId: null, resultIndex: -1, resultCount: 0 });
    getController(paneId)?.focus();
  };

  const status = !search.query
    ? ''
    : search.resultCount === 0
      ? 'No results'
      : `${search.resultIndex + 1} of ${search.resultCount}`;

  const toggles = [
    {
      key: 'caseSensitive',
      label: 'Match case',
      icon: CaseSensitive,
      pressed: search.caseSensitive,
    },
    {
      key: 'wholeWord',
      label: 'Whole word',
      icon: WholeWord,
      pressed: search.wholeWord,
    },
    {
      key: 'regex',
      label: 'Regular expression',
      icon: Regex,
      pressed: search.regex,
    },
  ] as const;

  return (
    <div className="absolute top-2 right-4 z-10 flex items-center gap-1 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md">
      <InputGroup className="w-64">
        <InputGroupInput
          ref={inputRef}
          value={search.query}
          placeholder="Find in terminal"
          aria-label="Find in terminal"
          onChange={(event) => patchSearch({ query: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              find(event.shiftKey ? 'previous' : 'next');
            } else if (event.key === 'Escape') {
              event.preventDefault();
              close();
            }
          }}
        />
        <InputGroupAddon align="inline-end">
          <span
            className="text-xs text-muted-foreground tabular-nums"
            aria-live="polite"
          >
            {status}
          </span>
        </InputGroupAddon>
      </InputGroup>
      {toggles.map(({ key, label, icon: Icon, pressed }) => (
        <Tooltip key={key}>
          <TooltipTrigger
            render={
              <Toggle
                size="sm"
                aria-label={label}
                pressed={pressed}
                onPressedChange={(value) => patchSearch({ [key]: value })}
              />
            }
          >
            <Icon />
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      ))}
      <InputGroupButton
        size="icon-xs"
        aria-label="Previous match"
        onClick={() => find('previous')}
      >
        <ArrowUp />
      </InputGroupButton>
      <InputGroupButton
        size="icon-xs"
        aria-label="Next match"
        onClick={() => find('next')}
      >
        <ArrowDown />
      </InputGroupButton>
      <InputGroupButton size="icon-xs" aria-label="Close find" onClick={close}>
        <X />
      </InputGroupButton>
    </div>
  );
}
