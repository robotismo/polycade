/** Tiny typed event emitter — no dependency, fully tree-shakeable. */
export class Emitter<Events extends Record<string, unknown>> {
  private listeners: { [K in keyof Events]?: Set<(payload: Events[K]) => void> } = {};

  on<K extends keyof Events>(type: K, fn: (payload: Events[K]) => void): () => void {
    (this.listeners[type] ??= new Set()).add(fn);
    return () => this.listeners[type]?.delete(fn);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    this.listeners[type]?.forEach((fn) => fn(payload));
  }
}
