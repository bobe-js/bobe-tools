export const G: Record<any, any> = {};

declare const __BOBE_LANG_CORE_PRODUCTION__: boolean | undefined;

const processLike = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
const isProduction =
  typeof __BOBE_LANG_CORE_PRODUCTION__ !== 'undefined'
    ? __BOBE_LANG_CORE_PRODUCTION__
    : processLike?.env?.NODE_ENV === 'production';

export const log: (...args: (string | number)[]) => void = isProduction ? () => {} : (...args) => {
  G.log?.info?.(args.join(' '));
};

export const Virtual_File_Suffix = '__bobe_virtual_file__';

export const Virtual_File_Exp = /__bobe_virtual_file__/;
