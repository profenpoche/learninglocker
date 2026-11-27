// JSON.parse avec les messages d'erreur de Node 10 (V8 6.8), renvoyés tels quels par l'API legacy
// (ex. « Unexpected token o in JSON at position 1 » ; Node 24 dit « Unexpected token 'o', "{oups"
// is not valid JSON »). Le texte est d'abord analysé par JSON.parse ; en cas d'échec seulement, un
// petit analyseur retrouve la position et la nature du premier caractère invalide, comme V8 6.8.
//
// Sérialisation des erreurs : l'API legacy renvoyait certains objets Error tels quels (`res.send(err)`),
// avec toutes leurs propriétés propres (un module installait Error.prototype.toJSON). Les piles
// d'appel (`stack`) ne sont pas reproduites : chemins internes du serveur legacy, et fuite
// d'informations (décision D7).

const WHITESPACE = new Set([' ', '\t', '\n', '\r']);

class Scanner {
  pos = 0;
  constructor(private readonly text: string) {}

  private fail(): never {
    const { text, pos } = this;
    if (pos >= text.length) throw new SyntaxError('Unexpected end of JSON input');
    const c = text[pos] ?? '';
    if (c >= '0' && c <= '9') throw new SyntaxError(`Unexpected number in JSON at position ${String(pos)}`);
    if (c === '"') throw new SyntaxError(`Unexpected string in JSON at position ${String(pos)}`);
    throw new SyntaxError(`Unexpected token ${c} in JSON at position ${String(pos)}`);
  }

  private peek(): string | undefined { return this.text[this.pos]; }

  private skip(): void {
    while (this.pos < this.text.length && WHITESPACE.has(this.text[this.pos] ?? '')) this.pos += 1;
  }

  private expect(c: string): void {
    if (this.peek() !== c) this.fail();
    this.pos += 1;
  }

  private literal(word: string): void {
    for (const c of word) {
      if (this.peek() !== c) this.fail();
      this.pos += 1;
    }
  }

  private string(): void {
    this.expect('"');
    for (;;) {
      const c = this.peek();
      if (c === undefined) this.fail();
      if (c === '"') { this.pos += 1; return; }
      if (c.charCodeAt(0) < 0x20) this.fail();
      if (c === '\\') {
        this.pos += 1;
        const e = this.peek();
        if (e === 'u') {
          this.pos += 1;
          for (let i = 0; i < 4; i += 1) {
            if (!/[0-9a-fA-F]/.test(this.peek() ?? '')) this.fail();
            this.pos += 1;
          }
          continue;
        }
        if (e === undefined || !'"\\/bfnrt'.includes(e)) this.fail();
      }
      this.pos += 1;
    }
  }

  private digits(): void {
    if (!/[0-9]/.test(this.peek() ?? '')) this.fail();
    while (/[0-9]/.test(this.peek() ?? '')) this.pos += 1;
  }

  private number(): void {
    if (this.peek() === '-') this.pos += 1;
    if (this.peek() === '0') {
      this.pos += 1;
    } else {
      this.digits();
    }
    if (this.peek() === '.') { this.pos += 1; this.digits(); }
    if (this.peek() === 'e' || this.peek() === 'E') {
      this.pos += 1;
      if (this.peek() === '+' || this.peek() === '-') this.pos += 1;
      this.digits();
    }
  }

  value(): void {
    this.skip();
    const c = this.peek();
    if (c === '"') this.string();
    else if (c === '-' || (c !== undefined && c >= '0' && c <= '9')) this.number();
    else if (c === '{') this.object();
    else if (c === '[') this.array();
    else if (c === 't') this.literal('true');
    else if (c === 'f') this.literal('false');
    else if (c === 'n') this.literal('null');
    else this.fail();
    this.skip();
  }

  private object(): void {
    this.expect('{');
    this.skip();
    if (this.peek() === '}') { this.pos += 1; return; }
    for (;;) {
      this.skip();
      if (this.peek() !== '"') this.fail();
      this.string();
      this.skip();
      this.expect(':');
      this.value();
      if (this.peek() === ',') { this.pos += 1; continue; }
      this.expect('}');
      return;
    }
  }

  private array(): void {
    this.expect('[');
    this.skip();
    if (this.peek() === ']') { this.pos += 1; return; }
    for (;;) {
      this.value();
      if (this.peek() === ',') { this.pos += 1; continue; }
      this.expect(']');
      return;
    }
  }

  document(): void {
    this.value();
    if (this.pos < this.text.length) this.fail();
  }
}

/** JSON.parse ; en cas d'erreur, SyntaxError avec le message de Node 10. */
export const parseJsonLegacy = (value: unknown, reviver?: (this: unknown, key: string, value: unknown) => unknown): unknown => {
  const text = String(value);
  try {
    return JSON.parse(text, reviver);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    new Scanner(text).document();
    throw error;
  }
};

/** Objet JSON d'une erreur renvoyée telle quelle par l'API legacy : propriétés propres, sauf `stack`. */
export const errorToJson = (error: unknown): unknown => {
  if (!(error instanceof Error)) return error;
  const out: Record<string, unknown> = {};
  for (const key of Object.getOwnPropertyNames(error)) {
    if (key === 'stack') continue;
    const value = (error as unknown as Record<string, unknown>)[key];
    out[key] = value instanceof Error ? errorToJson(value) : value;
  }
  return out;
};
