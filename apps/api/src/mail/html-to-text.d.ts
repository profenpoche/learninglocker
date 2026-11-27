// html-to-text 10 ne fournit pas de déclarations de types.
declare module 'html-to-text' {
  export function convert(html: string, options?: Record<string, unknown>): string;
}
