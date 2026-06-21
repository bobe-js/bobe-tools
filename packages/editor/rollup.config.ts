import esbuild from 'rollup-plugin-esbuild';
import dts from 'rollup-plugin-dts';
import nodeResolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import { RollupOptions } from 'rollup';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// @ts-ignore
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, './package.json')));

const hostExternal = ['aoye', 'bobe', 'bobe-dom'];
const extensions = ['.ts', '.js', '.json', '.node'];
const jsPlugins = () => [
  nodeResolve({ browser: true, extensions }),
  commonjs(),
  inlineCss(),
  esbuild({ target: 'es2020', tsconfig: path.resolve(__dirname, 'tsconfig.json') })
];

function inlineCss() {
  return {
    name: 'bobe-editor-inline-css',
    transform(code: string, id: string) {
      if (!id.endsWith('.css')) return null;
      return {
        code: `
const css = ${JSON.stringify(code)};
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}
export default css;
`,
        map: null
      };
    }
  };
}

export default [
  {
    input: 'src/index.ts',
    output: [
      { file: pkg.main, format: 'cjs', sourcemap: true, inlineDynamicImports: true },
      { file: pkg.module, format: 'esm', sourcemap: true, inlineDynamicImports: true }
    ],
    plugins: jsPlugins(),
    external: hostExternal
  },
  {
    input: 'src/full.ts',
    output: [
      { file: 'dist/full.cjs', format: 'cjs', sourcemap: true, inlineDynamicImports: true },
      { file: 'dist/full.esm.js', format: 'esm', sourcemap: true, inlineDynamicImports: true }
    ],
    plugins: jsPlugins()
  },
  {
    input: 'src/index.ts',
    output: { file: pkg.types || 'dist/index.d.ts', format: 'es' },
    plugins: [dts()],
    external: hostExternal
  },
  {
    input: 'src/full.ts',
    output: { file: 'dist/full.d.ts', format: 'es' },
    plugins: [dts()],
    external: hostExternal
  }
] as RollupOptions[];
