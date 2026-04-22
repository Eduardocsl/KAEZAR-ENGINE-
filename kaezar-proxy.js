#!/usr/bin/env node
/**
 * KaezarEngine CORS Proxy — kaezar-proxy.js
 * Roda localmente e faz forward das chamadas de AI que bloqueiam CORS no browser.
 *
 * USO:
 *   node kaezar-proxy.js
 *
 * Requisitos: Node.js 18+ (sem dependências externas)
 * Porta padrão: 3131
 */

const http  = require('http');
const https = require('https');
const { URL } = require('url');

const PORT = process.env.PORT || 3131;

// Providers permitidos — qualquer outro é bloqueado por segurança
const ALLOWED_HOSTS = [
  'api.openai.com',
  'api.deepseek.com',
  'api.groq.com',
  'api.mistral.ai',
  'dashscope.aliyuncs.com',
  'generativelanguage.googleapis.com',
];

const server = http.createServer((req, res) => {
  // ── CORS headers — permite o HTML aberto como file:// ou localhost ──
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, anthropic-version, anthropic-dangerous-direct-browser-access');

  // Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Healthcheck
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', proxy: 'KaezarEngine CORS Proxy', port: PORT }));
    return;
  }

  // Espera URL no formato: POST /proxy?url=https://api.deepseek.com/v1/chat/completions
  const reqUrl = new URL(req.url, `http://localhost:${PORT}`);
  const target = reqUrl.searchParams.get('url');

  if (!target) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Parâmetro ?url= obrigatório' }));
    return;
  }

  let targetUrl;
  try { targetUrl = new URL(target); }
  catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'URL de destino inválida' }));
    return;
  }

  if (!ALLOWED_HOSTS.includes(targetUrl.hostname)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Host não permitido: ${targetUrl.hostname}` }));
    return;
  }

  // Coletar body da requisição
  let body = [];
  req.on('data', chunk => body.push(chunk));
  req.on('end', () => {
    body = Buffer.concat(body);

    // Headers para o destino (copia os originais, remove host)
    const forwardHeaders = { ...req.headers };
    delete forwardHeaders['host'];
    forwardHeaders['content-length'] = Buffer.byteLength(body);

    const options = {
      hostname: targetUrl.hostname,
      port:     targetUrl.port || 443,
      path:     targetUrl.pathname + targetUrl.search,
      method:   req.method,
      headers:  forwardHeaders,
    };

    const proxyReq = https.request(options, proxyRes => {
      res.writeHead(proxyRes.statusCode, {
        'Content-Type': proxyRes.headers['content-type'] || 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      proxyRes.pipe(res, { end: true });
    });

    proxyReq.on('error', err => {
      console.error('[proxy error]', err.message);
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Proxy error: ${err.message}` }));
      }
    });

    proxyReq.write(body);
    proxyReq.end();
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════╗
║   KaezarEngine CORS Proxy — ativo! ✅    ║
║   http://localhost:${PORT}                  ║
║                                          ║
║   Providers habilitados:                 ║
║   • OpenAI   • DeepSeek   • Groq         ║
║   • Mistral  • Qwen       • Gemini       ║
║                                          ║
║   Abra o KaezarEngine.html no browser.  ║
║   Ctrl+C para encerrar.                  ║
╚══════════════════════════════════════════╝
`);
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Porta ${PORT} já está em uso. Feche o processo anterior ou mude a porta.\n`);
  } else {
    console.error('Erro no servidor:', err);
  }
  process.exit(1);
});
