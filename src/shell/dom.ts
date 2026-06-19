/** Tiny hyperscript helper — keeps the shell's DOM construction terse. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string; html?: string } = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  const { class: className, html, ...rest } = props as Record<string, unknown>;
  if (className) node.className = className as string;
  if (html !== undefined) node.innerHTML = html as string;
  Object.assign(node, rest);
  for (const c of children) node.append(c);
  return node;
}

export function clear(node: HTMLElement): void {
  node.replaceChildren();
}
