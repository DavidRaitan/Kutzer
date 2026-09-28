const http = require('http');
const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;
const net = require('net');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 4173);
const ROOT = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8'
};

const MAX_PDF_BYTES = 40 * 1024 * 1024;

// The PDF proxy must only reach public internet hosts, never this machine or the LAN.
function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
  return v6 === '::' || v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80');
}

async function assertPublicUrl(url) {
  if (!/^https?:$/.test(url.protocol)) throw new Error('Only http(s) URLs are supported');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map(a => a.address);
  if (!addrs.length || addrs.some(isPrivateAddress)) throw new Error('That address is not allowed');
}

// Follows redirects by hand so every hop is checked, not just the first URL.
async function fetchPublic(rawUrl) {
  let url = new URL(rawUrl);
  for (let hop = 0; hop < 5; hop++) {
    await assertPublicUrl(url);
    const resp = await fetch(url, { redirect: 'manual' });
    if (resp.status >= 300 && resp.status < 400 && resp.headers.get('location')) {
      url = new URL(resp.headers.get('location'), url);
      continue;
    }
    return resp;
  }
  throw new Error('Too many redirects');
}

// Only the app itself may use the proxy: reject other sites' pages (Sec-Fetch-Site)
// and DNS-rebinding tricks (Host must be this server).
function isOwnRequest(req) {
  const hostOk = [`${HOST}:${PORT}`, `localhost:${PORT}`, `127.0.0.1:${PORT}`].includes(req.headers.host);
  const site = req.headers['sec-fetch-site'];
  return hostOk && (!site || site === 'same-origin');
}

function safeResolve(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]);
  } catch (e) {
    return null;
  }
  const normalized = decoded === '/' ? '/index.html' : decoded;
  const abs = path.resolve(ROOT, '.' + normalized);
  if (!abs.startsWith(ROOT)) return null;
  return abs;
}

const server = http.createServer((req, res) => {
  if ((req.url || '').startsWith('/fetch-pdf?')) {
    if (!isOwnRequest(req)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }
    let remoteUrl = '';
    try {
      remoteUrl = new URL(req.url, `http://${HOST}:${PORT}`).searchParams.get('url') || '';
      if (!/^https?:\/\//i.test(remoteUrl)) throw new Error('Only http(s) URLs are supported');
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Bad PDF URL');
      return;
    }

    fetchPublic(remoteUrl).then(async remote => {
      const type = remote.headers.get('content-type') || 'application/octet-stream';
      if (Number(remote.headers.get('content-length') || 0) > MAX_PDF_BYTES) throw new Error('File is larger than 40 MB');
      const buffer = Buffer.from(await remote.arrayBuffer());
      if (buffer.length > MAX_PDF_BYTES) throw new Error('File is larger than 40 MB');
      // Google Drive's "confirm download" page is HTML, which the app inspects, so allow text too
      if (!/pdf|octet-stream|text\/html/i.test(type)) throw new Error('The link did not return a PDF');
      res.writeHead(remote.status, {
        'Content-Type': type,
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': 'sandbox'
      });
      res.end(buffer);
    }).catch(err => {
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Could not fetch PDF: ' + err.message);
    });
    return;
  }

  const target = safeResolve(req.url || '/');
  if (!target) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.stat(target, (statErr, stat) => {
    if (statErr || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });

    const stream = fs.createReadStream(target);
    stream.on('error', () => {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Server error');
    });
    stream.pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Zichru running at http://${HOST}:${PORT}`);
});
