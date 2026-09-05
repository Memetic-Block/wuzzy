// Minimal JSX-to-string runtime. `h` and `Fragment` are wired up as the
// classic jsxFactory/jsxFragmentFactory in tsconfig.json; Bun applies those
// settings when transpiling .tsx files, so this works at runtime with no deps.
//
// Attribute values are HTML-escaped; children are NOT (they may themselves be
// rendered elements). Don't interpolate untrusted input into children — this
// renders static pages at build time.

type Child = string | number | boolean | null | undefined;
export type Children = Child | Children[];
export type Component<P = Record<string, unknown>> = (
  props: P & { children?: Children },
) => string;

declare global {
  namespace JSX {
    type Element = string;
    interface IntrinsicElements {
      [tag: string]: Record<string, unknown>;
    }
    interface ElementChildrenAttribute {
      children: unknown;
    }
  }
}

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'source', 'track', 'wbr',
]);

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function renderChildren(children: Children): string {
  if (Array.isArray(children)) return children.map(renderChildren).join('');
  if (children == null || typeof children === 'boolean') return '';
  return String(children);
}

export function h(
  tag: string | Component,
  props: Record<string, unknown> | null,
  ...children: Children[]
): string {
  if (typeof tag === 'function') return tag({ ...(props ?? {}), children });

  let attrs = '';
  for (const [name, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    attrs += value === true ? ` ${name}` : ` ${name}="${escapeHtml(String(value))}"`;
  }

  if (VOID_ELEMENTS.has(tag)) return `<${tag}${attrs}>`;
  return `<${tag}${attrs}>${renderChildren(children)}</${tag}>`;
}

export const Fragment: Component = ({ children }) => renderChildren(children);
