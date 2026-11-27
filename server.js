'use strict';

const http = require('node:http');
const os = require('node:os');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_FILE = path.join(ROOT, 'data.json');
const REMOTE_PIN = String(crypto.randomInt(100000, 1000000));

const GAME_LABELS = {
  '2xko': '2XKO',
  'mk1': 'MORTAL KOMBAT 1',
  'ggst': 'GUILTY GEAR STRIVE'
};

function defaultState() {
  return {
    playerName: 'LYCAN',
    selectedGame: '2xko',
    position: 'bottom-center',
    scale: 0.9,
    opacity: 94,
    profiles: {
      '2xko': { wins: 0, losses: 0, mains: ['Ekko', 'Warwick'], streak: 0, detectedCharacters: [], detectedAt: 0 },
      'mk1': { wins: 0, losses: 0, mains: [], streak: 0, detectedCharacters: [], detectedAt: 0 },
      'ggst': { wins: 0, losses: 0, mains: [], streak: 0, detectedCharacters: [], detectedAt: 0 }
    },
    lastResult: null,
    updatedAt: Date.now()
  };
}

function loadState() {
  try {
    if (!fs.existsSync(DATA_FILE)) return defaultState();
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const base = defaultState();
    return {
      ...base,
      ...parsed,
      profiles: {
        ...base.profiles,
        ...(parsed.profiles || {})
      }
    };
  } catch (error) {
    console.error('No se pudo leer data.json. Se usaran valores iniciales:', error.message);
    return defaultState();
  }
}

let state = loadState();

function saveState() {
  state.updatedAt = Date.now();
  const tempFile = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tempFile, DATA_FILE);
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(payload));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error('La solicitud es demasiado grande.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('JSON invalido.'));
      }
    });
    req.on('error', reject);
  });
}

function cleanString(value, fallback, max = 32) {
  if (typeof value !== 'string') return fallback;
  const cleaned = value.trim().replace(/[<>]/g, '').slice(0, max);
  return cleaned || fallback;
}

function sanitizeState(input) {
  const next = defaultState();
  next.playerName = cleanString(input.playerName, state.playerName, 24);
  next.selectedGame = Object.hasOwn(GAME_LABELS, input.selectedGame) ? input.selectedGame : state.selectedGame;
  next.position = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'bottom-center'].includes(input.position)
    ? input.position : state.position;
  next.scale = Number.isFinite(Number(input.scale)) ? Math.min(1.35, Math.max(0.7, Number(input.scale))) : state.scale;
  next.opacity = Number.isFinite(Number(input.opacity)) ? Math.min(100, Math.max(35, Number(input.opacity))) : state.opacity;

  for (const game of Object.keys(GAME_LABELS)) {
    const oldProfile = state.profiles[game] || next.profiles[game];
    const incoming = input.profiles && input.profiles[game] ? input.profiles[game] : oldProfile;
    const mains = Array.isArray(incoming.mains)
      ? incoming.mains.map(name => cleanString(name, '', 22)).filter(Boolean).slice(0, 3)
      : oldProfile.mains;
    next.profiles[game] = {
      wins: Number.isInteger(incoming.wins) ? Math.max(0, Math.min(99999, incoming.wins)) : oldProfile.wins,
      losses: Number.isInteger(incoming.losses) ? Math.max(0, Math.min(99999, incoming.losses)) : oldProfile.losses,
      mains,
      streak: Number.isInteger(incoming.streak) ? Math.max(-999, Math.min(999, incoming.streak)) : oldProfile.streak,
      detectedCharacters: Array.isArray(incoming.detectedCharacters)
        ? incoming.detectedCharacters.map(name => cleanString(name, '', 20)).filter(Boolean).slice(0, 2)
        : (oldProfile.detectedCharacters || []),
      detectedAt: Number.isFinite(Number(incoming.detectedAt)) ? Math.max(0, Number(incoming.detectedAt)) : (oldProfile.detectedAt || 0)
    };
  }
  next.lastResult = state.lastResult;
  return next;
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
};

function serveStatic(req, res, pathname) {
  let requestedPath = pathname;
  if (requestedPath === '/' || requestedPath === '/dashboard') requestedPath = '/dashboard.html';
  if (requestedPath === '/overlay') requestedPath = '/overlay.html';
  if (requestedPath === '/remote') requestedPath = '/remote.html';

  const filePath = path.resolve(PUBLIC_DIR, `.${requestedPath}`);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('No se encontro el archivo.');
    }
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);

  if (req.method === 'GET' && pathname === '/api/network-info') {
    const interfaces = os.networkInterfaces();
    const addresses = [];
    for (const entries of Object.values(interfaces)) for (const item of entries || []) {
      if (item.family === 'IPv4' && !item.internal) addresses.push(item.address);
    }
    return sendJson(res, 200, { addresses, port: PORT, pin: REMOTE_PIN });
  }

  if (req.method === 'GET' && pathname === '/api/state') {
    return sendJson(res, 200, state);
  }

  if (req.method === 'POST' && pathname === '/api/state') {
    try {
      const input = await readJson(req);
      state = sanitizeState(input);
      saveState();
      return sendJson(res, 200, { ok: true, state });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error.message });
    }
  }

  if (req.method === 'POST' && pathname === '/api/result') {
    try {
      const input = await readJson(req);
      if (input.remote === true && input.pin !== REMOTE_PIN) return sendJson(res, 403, { ok: false, error: 'Código de conexión incorrecto.' });
      if (!['win', 'loss'].includes(input.result)) {
        return sendJson(res, 400, { ok: false, error: 'El resultado debe ser win o loss.' });
      }
      const profile = state.profiles[state.selectedGame];
      if (input.result === 'win') {
        profile.wins += 1;
        profile.streak = profile.streak > 0 ? profile.streak + 1 : 1;
      } else {
        profile.losses += 1;
        profile.streak = profile.streak < 0 ? profile.streak - 1 : -1;
      }
      state.lastResult = { result: input.result, game: state.selectedGame, at: Date.now() };
      saveState();
      return sendJson(res, 200, { ok: true, state });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error.message });
    }
  }

  if (req.method === 'POST' && pathname === '/api/detected-characters') {
    try {
      const input = await readJson(req);
      const game = input.game || state.selectedGame;
      if (game !== '2xko') return sendJson(res, 400, { ok: false, error: 'La detección automática de personajes está configurada para 2XKO.' });
      const roster = new Set([
        'Ahri', 'Akali', 'Blitzcrank', 'Braum', 'Caitlyn', 'Darius', 'Ekko', 'Illaoi',
        'Jinx', 'Lux', 'Samira', 'Senna', 'Sett', 'Teemo', 'Thresh', 'Vi', 'Warwick', 'Yasuo'
      ]);
      const characters = Array.isArray(input.characters)
        ? [...new Set(input.characters.map(name => cleanString(name, '', 20)).filter(name => roster.has(name)))].slice(0, 2)
        : [];
      if (!characters.length) return sendJson(res, 400, { ok: false, error: 'No se reconocieron personajes válidos de 2XKO.' });
      state.profiles['2xko'].detectedCharacters = characters;
      state.profiles['2xko'].detectedAt = Date.now();
      saveState();
      return sendJson(res, 200, { ok: true, state });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error.message });
    }
  }

  if (req.method === 'POST' && pathname === '/api/reset') {
    try {
      const input = await readJson(req);
      const game = input.game || state.selectedGame;
      if (!Object.hasOwn(GAME_LABELS, game)) return sendJson(res, 400, { ok: false, error: 'Juego no valido.' });
      state.profiles[game] = { ...state.profiles[game], wins: 0, losses: 0, streak: 0 };
      state.lastResult = null;
      saveState();
      return sendJson(res, 200, { ok: true, state });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error.message });
    }
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }

  if (req.method === 'GET') return serveStatic(req, res, pathname);
  res.writeHead(405);
  res.end('Method not allowed');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('\nOverlay de juegos de pelea lista:');
  console.log(`  Panel de control: http://127.0.0.1:${PORT}/dashboard`);
  console.log(`  Overlay para OBS: http://127.0.0.1:${PORT}/overlay`);
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) for (const item of entries || []) {
    if (item.family === 'IPv4' && !item.internal) console.log(`  Control móvil: http://${item.address}:${PORT}/remote`);
  }
  console.log(`  Código de conexión móvil: ${REMOTE_PIN}`);
  console.log('\nDeja esta ventana abierta mientras uses la overlay.\n');
});
