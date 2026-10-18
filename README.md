<p align="center">
  <img src="assets/icon.png" alt="" width="128" height="128">
</p>

<h1 align="center">
  <img src="assets/logo-title.svg" alt="RTX-Terminal" width="560">
</h1>

<p align="center">
  A modern, keyboard-driven terminal for Linux.
</p>

<p align="center">
  <a href="https://github.com/0x0f2Root/rtx-terminal/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/0x0f2Root/rtx-terminal?display_name=tag&sort=semver"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue"></a>
  <img alt="Platform: Linux x64" src="https://img.shields.io/badge/platform-Linux%20x64-informational">
  <img alt="Built with Electron" src="https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white">
</p>

<p align="center">
  <img src="public/rtx.png" alt="RTX-Terminal with colored tabs: Claude Code in a split pane next to an SSH session on a Debian server, with the sidebar showing open terminals, saved commands and SSH hosts" width="900">
</p>

## Features

### Terminal

- **Tabs and split panes.** Split right or down, resize with the dividers and move focus between
  panes. Switching tabs never restarts a shell, and tabs can be renamed and colored.
- **GPU rendering** through WebGL, with an automatic fallback when the GPU is unavailable.
- **Search** terminal output with case, whole word and regex options.
- **Command palette** (`Ctrl+Shift+P`) for every action, theme, tab, saved command and history entry.
- **Command history** you can search and re-insert at the prompt.

### Saved commands

- Organize commands in **categories** with tags, descriptions and optional shortcuts.
- **Insert** types a command at the prompt; **Run** also presses Enter.
- Commands that look destructive (`rm -rf`, `dd of=`, `mkfs`, `git reset --hard`, `sudo`, …) ask for
  confirmation before they run.
- **Import and export** your library as JSON.

### SSH

- **Saved hosts** with groups, tags and search, plus `~/.ssh/config` aliases.
- Password, private key (including encrypted keys) and **ssh-agent** authentication. Secrets are kept
  in the system keyring, never in config files.
- **Host keys** are verified against the app's own store and `~/.ssh/known_hosts`; unknown or changed
  keys always ask first.
- SSH tabs sit next to local ones, work in split panes and can be disconnected and reconnected.

<p align="center">
  <img src="public/split-ssh.png" alt="A split pane with btop running locally next to an SSH session on a Debian server" width="900">
</p>

### Remote file manager

- Browse, rename, create and delete files and folders over SFTP.
- Upload and download with a transfer queue. You are only asked what to do when a file with the same
  name already exists, and the safe choice keeps both copies.

<p align="center">
  <img src="public/file-manager.png" alt="The SFTP file manager listing the root directory of a Debian server, with symlinks, permissions and owners" width="900">
</p>

### Resource monitor

- Live CPU, memory, disk, network and load charts for any SSH host, with no agent to install.
- A sortable, filterable process table.

<p align="center">
  <img src="public/resource-monitor.png" alt="The SSH resource monitor showing live CPU, memory, disk and network charts for a Debian server" width="900">
</p>

### Look and feel

- Four app themes: **Gray Dark**, **Full Black**, **Light** and **Glass** (translucent panels over a
  wallpaper of your choice, with adjustable blur, tint and dimming).
- Independent terminal color schemes, fonts, line height, cursor style and scrollback.
- Every shortcut can be changed in **Settings → Keyboard**.

## Keyboard shortcuts

App shortcuts use `Ctrl+Shift`, so plain `Ctrl` keys (`Ctrl+C`, `Ctrl+R`, `Ctrl+B`, …) reach the shell.

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

## Build from source

### Requirements

- Linux x64 with **Node.js 22 or newer** and npm (developed with Node 24).
- A toolchain for the native `node-pty` module: `sudo apt install build-essential python3`
- For the `.deb`: `sudo apt install dpkg fakeroot`

### Run in development

```bash
git clone https://github.com/0x0f2Root/rtx-terminal.git
cd rtx-terminal
npm install
npm start            # Electron Forge with Vite hot reload
```

`F12` toggles DevTools. Changes to the main process need a full restart of `npm start`.

### Check

```bash
npm run typecheck    # tsc --noEmit (strict)
npm run lint         # oxlint and oxfmt --check
npm test             # vitest
```

### Package

```bash
npm run package      # unpacked app in out/RTX-Terminal-linux-x64/
npm run make:deb     # out/make/deb/x64/rtx-terminal_<version>_amd64.deb
```

## Contributing

Issues and pull requests are welcome. Before opening a pull request, make sure `npm run typecheck`,
`npm run lint` and `npm test` pass.

## License

[MIT](LICENSE) © 0x0f2Root
