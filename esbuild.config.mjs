import { build } from 'esbuild';
import { copyFile, readFile } from 'node:fs/promises';
await build({
  entryPoints: ['src/main.ts'], outfile: 'main.js', bundle: true,
  format: 'cjs', platform: 'browser', target: 'es2022', external: ['obsidian'],
  jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
  minify: true, sourcemap: 'external', logLevel: 'info',
  banner: { js: `/*! Upstream infinite-canvas license:\n${await readFile('licenses/infinite-canvas-MIT.txt', 'utf8')}*/` },
});
await copyFile('src/styles.css', 'styles.css');
