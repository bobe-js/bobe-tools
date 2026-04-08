export const G: Record<any, any> = {};

export function log(...args: (string | number)[]) {
  G.log.info(args.join(' '));
}

export const Virtual_File_Suffix = '_bobevritualfile';

export const Virtual_File_Exp = /_bobevritualfile/;
