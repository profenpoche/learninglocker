// Récepteur HTTP pour tester le statement forwarding : journalise chaque requête
// reçue (une ligne JSON par requête) dans /data/forwarded.ndjson.
import { createServer } from 'node:http';
import { appendFileSync } from 'node:fs';

const OUT = process.env.OUT ?? '/data/forwarded.ndjson';

createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    appendFileSync(OUT, JSON.stringify({
      at: new Date().toISOString(),
      method: req.method,
      url: req.url,
      headers: req.headers,
      body,
    }) + '\n');
    // /fail/* simule une destination en erreur pour tester les tentatives.
    res.statusCode = req.url.startsWith('/fail') ? 500 : 200;
    res.end('ok');
  });
}).listen(9000, () => console.log('echo-server sur :9000'));
