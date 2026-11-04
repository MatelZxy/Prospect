// Só para rodar no seu computador (a Vercel usa public/ e api/ direto). Não precisa de npm install.
import http from 'http';
import { readFile } from 'fs/promises';
import handler from './api/search.js';

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/api/search') {
    req.query = Object.fromEntries(u.searchParams);
    res.status = c => { res.statusCode = c; return res; };
    res.json = o => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
    return handler(req, res);
  }
  try { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(await readFile('public/index.html')); }
  catch { res.statusCode = 404; res.end('Não encontrado'); }
}).listen(3000, () => console.log('http://localhost:3000'));
