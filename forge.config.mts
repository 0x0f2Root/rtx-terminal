import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

/**
 * Native modules the main process loads from node_modules at runtime. Vite leaves them external,
 * so they must be copied into the package next to the .vite output (with what they need to rebuild).
 */
const RUNTIME_MODULES = [
  'node-pty',
  'node-addon-api',
  // ssh2 and its pure-JavaScript dependency tree (its optional native speedups are not shipped).
  'ssh2',
  'asn1',
  'bcrypt-pbkdf',
  'safer-buffer',
  'tweetnacl',
];

const linuxMetadata = {
  name: 'RTX-Terminal',
  productName: 'RTX-Terminal',
  genericName: 'Terminal',
  description: 'A keyboard-driven terminal for Linux',
  productDescription:
    'RTX-Terminal is a GPU-accelerated terminal emulator with tabs, split panes, saved commands and a command palette.',
  // The makers accept freedesktop main categories only.
  categories: ['System', 'Utility'] as ('System' | 'Utility')[],
  icon: 'assets/icon.png',
  bin: 'RTX-Terminal',
};

const config: ForgeConfig = {
  packagerConfig: {
    name: 'RTX-Terminal',
    executableName: 'RTX-Terminal',
    asar: true,
    icon: 'assets/icon',
    extraResource: ['assets/icon.png'],
    // The Vite plugin normally keeps only .vite; native runtime modules must ship too.
    ignore: (file: string) => {
      if (!file) return false;
      if (file === '/package.json' || file.startsWith('/.vite')) return false;
      if (file === '/node_modules') return false;
      return !RUNTIME_MODULES.some(
        (name) =>
          file === `/node_modules/${name}` ||
          file.startsWith(`/node_modules/${name}/`),
      );
    },
  },
  rebuildConfig: {
    onlyModules: ['node-pty'],
  },
  hooks: {
    // Runs after node-pty was rebuilt for Electron and before the asar is created: keep only the
    // compiled Linux binary and node-pty's JavaScript, not sources, headers or other platforms' builds.
    packageAfterPrune: async (
      _config,
      buildPath,
      _electronVersion,
      platform,
    ) => {
      if (platform !== 'linux') return;
      const ptyDir = path.join(buildPath, 'node_modules', 'node-pty');
      const remove = [
        'prebuilds',
        'third_party',
        'deps',
        'src',
        'scripts',
        'typings',
        'binding.gyp',
        path.join('build', 'Release', 'obj.target'),
        path.join('build', 'Release', '.deps'),
        path.join('build', 'Release', 'node-addon-api'),
      ].map((entry) => path.join(ptyDir, entry));
      remove.push(path.join(buildPath, 'node_modules', 'node-addon-api'));
      await Promise.all(
        remove.map((target) => fs.rm(target, { recursive: true, force: true })),
      );
      for (const file of await fs.readdir(path.join(ptyDir, 'lib'))) {
        if (file.endsWith('.test.js') || file.endsWith('.map'))
          await fs.rm(path.join(ptyDir, 'lib', file));
      }
    },
  },
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ['darwin']),
    new MakerRpm({ options: linuxMetadata }),
    new MakerDeb({
      options: {
        ...linuxMetadata,
        section: 'utils',
        priority: 'optional',
        maintainer: '0x0f2Root <0x0f2Root@proton.me>',
      },
    }),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main.ts',
          config: 'vite.main.config.mts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.mts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
