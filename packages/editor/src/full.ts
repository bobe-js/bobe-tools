import { render } from 'bobe-dom';
import { BobeEditor } from './index';
import type { BobeEditorOptions } from './types';

export * from './index';

export function createBobeEditor(container: HTMLElement, options: BobeEditorOptions = {}) {
  const [, store] = render(BobeEditor as any, container, { props: options }) as readonly [unknown, BobeEditor];
  return store;
}
