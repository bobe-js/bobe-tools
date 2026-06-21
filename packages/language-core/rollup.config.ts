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

const external = [/^typescript/, 'bobe', 'bobe/compiler'];

export default [
  {
    input: 'src/index.ts',
    output: [
      { file: pkg.main, format: 'cjs', sourcemap: true },
      { file: pkg.module, format: 'esm', sourcemap: true }
    ],
    plugins: [
      nodeResolve({ extensions: ['.ts', '.js', '.json', '.node'] }),
      commonjs(),
      esbuild({ target: 'es2020', tsconfig: path.resolve(__dirname, 'tsconfig.json') })
    ],
    external
  },
  {
    input: 'src/index.ts',
    output: { file: pkg.types || 'dist/index.d.ts', format: 'es' },
    plugins: [dts()],
    external
  }
] as RollupOptions[];
