/**
 * Bundles the main and preload processes.
 *
 * The renderer is Vite's job; these two are plain Node bundles that Electron
 * loads directly, so they are built separately and emitted as CommonJS.
 */
import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Source files import each other with `.js` extensions, which is what the
 * TypeScript compiler expects to emit. esbuild resolves those literally, so
 * point them back at the TypeScript that is actually there.
 */
const typescriptExtensions = {
  name: 'ts-extensions',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^\.{1,2}\/.*\.js$/ }, (args) => {
      const candidate = resolve(dirname(args.importer), args.path.replace(/\.js$/, '.ts'));
      return existsSync(candidate) ? { path: candidate } : undefined;
    });
  },
};

await build({
  entryPoints: ['electron/main.ts', 'electron/preload.ts'],
  outdir: 'dist-electron',
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  // Provided by the runtime, never bundled.
  external: ['electron'],
  plugins: [typescriptExtensions],
  logLevel: 'info',
});
