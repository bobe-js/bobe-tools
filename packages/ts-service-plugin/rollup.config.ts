import esbuild from 'rollup-plugin-esbuild';
import dts from 'rollup-plugin-dts';
import nodeResolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import { RollupOptions } from 'rollup';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// 获取当前文件的绝对路径
const __filename = fileURLToPath(import.meta.url);
// 获取当前文件所在的目录路径
const __dirname = dirname(__filename);

// @ts-ignore
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, './package.json')));
const bigCamel = (name: string) =>
  name
    .split('-')
    .map(it => it[0].toUpperCase() + it.slice(1))
    .join('');

export default [
  {
    input: 'src/index.ts',
    output: [
      { file: pkg.main, format: 'cjs', sourcemap: true },
      { file: pkg.module, format: 'esm', sourcemap: true }
    ],
    plugins: [
      nodeResolve({
        extensions: ['.ts', '.js', '.json', '.node']
      }),
      commonjs(),
      esbuild({
        target: 'node14',
        tsconfig: path.resolve(__dirname, 'tsconfig.json')
      })
    ],
    external: [/^typescript/]
  },
  // 2. 类型构建
  {
    input: 'src/index.ts',
    output: { file: pkg.types || 'dist/index.d.ts', format: 'es' },
    plugins: [dts()],
    external: [/^typescript/]
  }
] as RollupOptions[];
