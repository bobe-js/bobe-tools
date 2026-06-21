import esbuild from 'rollup-plugin-esbuild';
import dts from 'rollup-plugin-dts';
import { RollupOptions } from 'rollup';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// @ts-ignore
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, './package.json')));
export default [
  {
    input: 'src/index.ts',
    output: { file: pkg.main, format: 'cjs', sourcemap: true },
    plugins: [
      esbuild({
        target: 'node14',
        tsconfig: path.resolve(__dirname, 'tsconfig.json')
      })
    ],
    external: [/^typescript/, '@bobe-js/lang-core']
  },
  // 2. 类型构建
  {
    input: 'src/index.ts',
    output: { file: pkg.types || 'dist/index.d.ts', format: 'es' },
    plugins: [dts()],
    external: [/^typescript/, '@bobe-js/lang-core']
  }
] as RollupOptions[];
