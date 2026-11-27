// Relais transparent vers l'API legacy (méthode « strangler ») : une requête qu'aucune route portée
// ne traite est renvoyée telle quelle à LEGACY_API_URL, et la réponse est recopiée à l'identique
// (statut, en-têtes dont les Set-Cookie multiples, corps en flux, binaire ou multipart).
//
// - Le corps de la requête n'est jamais lu par l'API 2026 avant le relais (pas d'analyseur global).
// - Les en-têtes déjà posés par l'API 2026 (CORS, no-cache) sont retirés : seule la réponse legacy compte.
// - Si le client abandonne (ex. routes /shallow qui ne répondent jamais en legacy), la requête amont est annulée.
// - Erreur réseau vers l'API legacy : 502 en texte brut (l'API legacy, elle, ne relaie rien).
import { request as httpRequest, type IncomingMessage, type ServerResponse, type OutgoingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';

// En-têtes propres à une connexion (RFC 9110 §7.6.1) : jamais recopiés d'un saut à l'autre.
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'te', 'trailer', 'upgrade']);

export interface RelayOptions {
  /** URL de base de l'API legacy, ex. http://api-legacy:8080 (un chemin éventuel sert de préfixe). */
  target: string;
  onError?: (error: Error) => void;
}

const requestHeaders = (req: IncomingMessage): OutgoingHttpHeaders => {
  const headers: OutgoingHttpHeaders = {};
  const raw = req.rawHeaders;
  for (let i = 0; i < raw.length; i += 2) {
    const name = raw[i] ?? '';
    const value = raw[i + 1] ?? '';
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower)) continue;
    const previous = headers[lower];
    if (previous === undefined) headers[lower] = value;
    else headers[lower] = Array.isArray(previous) ? [...previous, value] : [String(previous), value];
  }
  return headers;
};

const responseHeaders = (upstream: IncomingMessage): string[] => {
  const out: string[] = [];
  const raw = upstream.rawHeaders;
  for (let i = 0; i < raw.length; i += 2) {
    const name = raw[i] ?? '';
    if (HOP_BY_HOP.has(name.toLowerCase())) continue;
    out.push(name, raw[i + 1] ?? '');
  }
  return out;
};

/** Crée le gestionnaire de relais (req et res Node, ou Express). */
export const createRelay = ({ target, onError }: RelayOptions) => {
  const base = new URL(target);
  const prefix = base.pathname.replace(/\/$/, '');
  const send = base.protocol === 'https:' ? httpsRequest : httpRequest;

  return (req: IncomingMessage & { originalUrl?: string }, res: ServerResponse): void => {
    const path = `${prefix}${req.originalUrl ?? req.url ?? '/'}`;
    const upstream = send({
      protocol: base.protocol,
      hostname: base.hostname,
      port: base.port || undefined,
      method: req.method,
      path,
      headers: requestHeaders(req),
    });

    let aborted = false;
    res.on('close', () => {
      if (res.writableFinished) return;
      aborted = true;
      upstream.destroy();
    });

    upstream.on('response', (up) => {
      for (const name of res.getHeaderNames()) res.removeHeader(name);
      res.writeHead(up.statusCode ?? 502, up.statusMessage, responseHeaders(up));
      up.pipe(res);
      up.on('error', () => res.destroy());
    });
    upstream.on('error', (error) => {
      if (aborted) return;
      onError?.(error);
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (res.destroyed || res.writableEnded) return;
      for (const name of res.getHeaderNames()) res.removeHeader(name);
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Bad Gateway');
    });
    req.pipe(upstream);
  };
};
