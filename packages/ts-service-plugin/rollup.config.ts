import esbuild from 'rollup-plugin-esbuild';
import nodeResolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import dts from 'rollup-plugin-dts';
import { RollupOptions } from 'rollup';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// @ts-ignore
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, './package.json')));
const isProduction = process.env.NODE_ENV ? process.env.NODE_ENV === 'production' : !process.env.ROLLUP_WATCH;
const define = {
  __BOBE_LANG_CORE_PRODUCTION__: isProduction ? 'true' : 'false',
  'process.env.NODE_ENV': JSON.stringify(isProduction ? 'production' : 'development')
};
export default [
  {
    input: 'src/index.ts',
    output: { file: pkg.main, format: 'cjs', sourcemap: true },
    plugins: [
      nodeResolve({ extensions: ['.ts', '.js', '.json', '.node'], preferBuiltins: true }),
      commonjs(),
      esbuild({
        target: 'node14',
        tsconfig: path.resolve(__dirname, 'tsconfig.json'),
        define
      })
    ],
    external: [/^typescript/]
  },
  // 2. 类型构建
  {
    input: 'src/index.ts',
    output: { file: pkg.types || 'dist/index.d.ts', format: 'es' },
    plugins: [dts()],
    external: [/^typescript/, '@bobe-js/lang-core']
  }
] as RollupOptions[];
