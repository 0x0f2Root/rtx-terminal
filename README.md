<p align="center">
  <img src="assets/icon.png" alt="" width="128" height="128">
</p>

<h1 align="center">
  <img src="assets/logo-title.svg" alt="RTX-Terminal" width="560">
</h1>

<p align="center">
  Another yet modern terminal for Linux built with Electron, React, xterm.js and node-pty.
</p>

<p align="center">
  <img src="public/rtx.png" alt="rtx-terminal in the Glass theme: a zsh session with the sidebar showing open terminals, saved commands and SSH hosts" width="900">
</p>

## Features
<p align="center">
  SSH Resources Monitor
</p>
<p align="center">
  <img src="public/rtx3.png" width="900">
</p>
<p align="center">
  SSH Remote File Manager
</p>
<p align="center">
  <img src="public/RTX4.png" width="900">
</p>




- **Tabs and split panes**: split right or down, resize with the dividers, move focus between panes.
  Switching tabs never restarts a shell.
- **Search** in terminal output (case, whole word and regex options).
- **Command palette** (`Ctrl+Shift+P`) for every action, theme switching, tab switching, saved commands
  and history.
- **Saved commands** with categories, tags, descriptions, optional shortcuts, import and export.
  _Insert_ types a command at the prompt; _Run_ also presses Enter. Commands that look destructive
  (`rm -rf`, `dd of=`, `mkfs`, `git reset --hard`, `sudo`, …) ask for confirmation before running.
- **SSH sessions** through ssh2: saved hosts with groups, tags and search; password, private key
  (including encrypted keys) and ssh-agent authentication; host keys verified against the app's
  `known_hosts` and `~/.ssh/known_hosts`. SSH tabs sit next to local ones, work in split panes, show
  their connection state, and can be disconnected and reconnected explicitly (SSH menu, sidebar,
  pane menu, or `Ctrl+Shift+O` to connect).
- **Preferences**: font, size, line height, cursor, theme, default shell, initial size, scrollback,
  copy-on-select, GPU rendering, and configurable shortcuts.

## Requirements

- Linux x64, Node.js 22 or newer and npm (developed with Node 24 and npm 12).
- To build node-pty: `python3`, `make` and a C++ compiler (`sudo apt install build-essential python3`).
- To build the `.deb`: `dpkg` and `fakeroot` (`sudo apt install dpkg fakeroot`).

## Development

```bash
npm install
npm start            # Electron Forge dev mode with Vite hot reload
npm run typecheck    # tsc --noEmit (strict)
npm run lint         # oxlint and oxfmt --check
```

In development, `F12` toggles DevTools. Editing a file that holds live terminal state reloads the
window; the main process ends the old shells when the page navigates.

## Packaging

```bash
npm run package      # out/rtx-terminal-linux-x64/
npm run make:deb     # out/make/deb/x64/rtx-terminal_1.0.0_amd64.deb
sudo apt install ./out/make/deb/x64/rtx-terminal_1.0.0_amd64.deb
```

Packaging rebuilds node-pty against the installed Electron version, ships only its Linux binary
(unpacked from the asar archive) and its JavaScript, and bundles everything else with Vite. The
`.deb` declares Electron's runtime libraries (GTK 3, NSS, libdrm, libgbm, …) as dependencies.

- **Main process** owns PTYs, files and dialogs. Each session belongs to the window that created
  it; requests for other sessions are ignored. Output is coalesced (5 ms or 64 KB) and paused with
  xterm.js-style flow control when the renderer falls behind.
- **Renderer** keeps one `TerminalController` per pane outside React. Panes move between split
  containers without losing scrollback or restarting their process.
- **Sessions** use a `SessionBackend` interface implemented by node-pty (local) and ssh2 (SSH). The
  renderer only names a saved host id; the main process reads the host from disk, connects, and asks
  the renderer about unknown or changed host keys and missing passwords or passphrases.

## Keyboard shortcuts

App shortcuts use `Ctrl+Shift` so plain `Ctrl` keys (`Ctrl+C`, `Ctrl+R`, `Ctrl+B`, …) reach the shell.
All of them can be changed in Settings → Keyboard.

| Action                             | Shortcut                      |
| ---------------------------------- | ----------------------------- |
| Command palette                    | `Ctrl+Shift+P`                |
| New tab                            | `Ctrl+Shift+T`                |
| Split right / down                 | `Ctrl+Shift+D` / `E`          |
| Close pane                         | `Ctrl+Shift+W`                |
| Next / previous pane               | `Ctrl+Shift+]` / `[`          |
| Next / previous tab                | `Ctrl+Tab` / `Ctrl+Shift+Tab` |
| Rename tab                         | `Ctrl+Shift+R`                |
| Find in terminal                   | `Ctrl+Shift+F`                |
| Copy / paste                       | `Ctrl+Shift+C` / `V`          |
| Select all output                  | `Ctrl+Shift+A`                |
| Clear terminal                     | `Ctrl+Shift+K`                |
| Run saved command                  | `Ctrl+Shift+S`                |
| Command history                    | `Ctrl+Shift+H`                |
| Connect to SSH host                | `Ctrl+Shift+O`                |
| Toggle sidebar                     | `Ctrl+Shift+B`                |
| Font size bigger / smaller / reset | `Ctrl+Shift+=` / `-` / `0`    |
| Settings                           | `Ctrl+,`                      |

