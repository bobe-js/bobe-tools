export class LRUCache<K = string, V = any> {
  private maxSize: number;
  private cache: Map<K, V> = new Map();

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    if (!this.cache.has(key)) {
      return undefined; // 如果缓存中没有该键，返回 -1
    }

    // 将该键值对移动到 Map 的末尾，表示它是最近使用的
    const value = this.cache.get(key)!;
    this.cache.delete(key); // 先删除
    this.cache.set(key, value); // 再插入到末尾
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      // 更新已有的键值对，并将其移动到末尾
      this.cache.delete(key);
      this.cache.set(key, value);
    } else {
      // 如果缓存已满，移除最久未使用的元素
      if (this.cache.size >= this.maxSize) {
        // Map 会保持插入顺序，删除最前面的键值对
        this.cache.delete(this.cache.keys().next().value!);
      }
      this.cache.set(key, value);
    }
  }

  // 新增 has 方法，检查某个键是否在缓存中
  has = this.cache.has.bind(this.cache) as typeof this.cache.has;

  delete = this.cache.delete.bind(this.cache) as typeof this.cache.delete;
}
export type SingleArgFn = (v: any) => any;

const cache = new LRUCache<any, any>(1000);
export function memo<T extends SingleArgFn>(fn: T): T {
  const wrap = (v: Parameters<T>) => {
    const res = fn(v);
    cache.set(v, res);
    return res;
  };
  return wrap as T;
}

export function createMemo() {
  const cache = new LRUCache<any, any>(1000);
  return function memo<T extends SingleArgFn>(fn: T): T {
    const wrap = (v: Parameters<T>) => {
      const res = fn(v);
      cache.set(v, res);
      return res;
    };
    return wrap as T;
  };
}
