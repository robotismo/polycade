/**
 * Minimal object pool. Avoids per-frame allocation churn (and the GC pauses
 * that wreck the 60fps budget) for short-lived game objects like pipes,
 * bricks, bullets and particles.
 */
export class Pool<T> {
  private free: T[] = [];
  private readonly create: () => T;
  private readonly onAcquire?: (item: T) => void;
  private readonly onRelease?: (item: T) => void;

  constructor(opts: {
    create: () => T;
    onAcquire?: (item: T) => void;
    onRelease?: (item: T) => void;
    prefill?: number;
  }) {
    this.create = opts.create;
    if (opts.onAcquire) this.onAcquire = opts.onAcquire;
    if (opts.onRelease) this.onRelease = opts.onRelease;
    for (let i = 0; i < (opts.prefill ?? 0); i++) this.free.push(this.create());
  }

  acquire(): T {
    const item = this.free.pop() ?? this.create();
    this.onAcquire?.(item);
    return item;
  }

  release(item: T): void {
    this.onRelease?.(item);
    this.free.push(item);
  }
}
