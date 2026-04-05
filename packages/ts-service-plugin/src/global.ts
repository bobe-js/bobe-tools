export const G: Record<any, any> = {}

export function log(...args: (string|number)[]) {
  G.log.info(args.join(' '));
}