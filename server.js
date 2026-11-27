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
  'ggst': 'GUILTY GEAR STRIVE',
  'mk11': 'MORTAL KOMBAT 11'
};

const TEAM_LIMITS = { '2xko': 2, 'ggst': 1, 'mk11': 1 };

// En MK11 el HUD no muestra nombres de personajes, solo etiquetas de jugador:
// los rivales se registran por su gamertag en lugar del roster.
const TAG_GAMES = { 'mk11': true };

const ROSTERS = {
  '2xko': new Set([
    'Ahri', 'Akali', 'Blitzcrank', 'Braum', 'Caitlyn', 'Darius', 'Ekko', 'Illaoi',
    'Jinx', 'Lux', 'Samira', 'Senna', 'Sett', 'Teemo', 'Thresh', 'Vi', 'Warwick', 'Yasuo'
  ]),
  'ggst': new Set([
    'Sol', 'Ky', 'May', 'Axl', 'Chipp', 'Potemkin', 'Faust', 'Millia', 'Zato',
    'Ramlethal', 'Leo', 'Nagoriyuki', 'Giovanna', 'Anji', 'I-No', 'Goldlewis',
    'Jack-O', 'Happy Chaos', 'Baiken', 'Testament', 'Bridget', 'Sin', 'Bedman?',
    'Asuka', 'Johnny', 'Elphelt', 'A.B.A', 'Slayer', 'Venom', 'Dizzy', 'Unika', 'Lucy'
  ]),
  'mk11': new Set([
    'Scorpion', 'Liu Kang', 'Kung Lao', 'Sub-Zero', 'Raiden', 'Sonya', 'Johnny Cage',
    'Cassie Cage', 'Jax', 'Jacqui Briggs', 'Baraka', 'Jade', 'Kitana', 'Mileena',
    'Skarlet', "D'Vorah", 'Kotal Kahn', 'Geras', 'Kollector', 'Noob Saibot', 'Cetrion',
    'Shao Kahn', 'Frost', 'Erron Black', 'Shang Tsung', 'Nightwolf', 'Sindel',
    'Terminator', 'Joker', 'Spawn', 'Fujin', 'Sheeva', 'RoboCop', 'Rain', 'Rambo'
  ])
};

const HISTORY_LIMIT = 60;

function defaultProfile(mains) {
  return {
    wins: 0,
    losses: 0,
    mains: mains || [],
    streak: 0,
    detectedCharacters: [],
    detectedAt: 0,
    detectedOpponents: [],
    detectedOpponentsAt: 0,
    matchHistory: [],
    charStats: {}
  };
}

function defaultState() {
  return {
    playerName: 'LYCAN',
    selectedGame: '2xko',
    position: 'bottom-center',
    scale: 0.9,
    opacity: 94,
    autoRecord: true,
    autoApplyMains: false,
    profiles: {
      '2xko': defaultProfile(['Ekko', 'Warwick']),
      'ggst': defaultProfile([]),
      'mk11': defaultProfile([])
    },
    lastResult: null,
    updatedAt: Date.now()
  };
}

function loadState() {
  try {
    if (!fs.existsSync(DATA_FILE)) return defaultState();
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    // Migración: quien usaba Mortal Kombat 1 (mk1) conserva sus datos como mk11.
    if (parsed.profiles && parsed.profiles.mk1 && !parsed.profiles.mk11) {
      parsed.profiles.mk11 = parsed.profiles.mk1;
    }
    const base = defaultState();
    const merged = { ...base, ...parsed };
    merged.profiles = {};
    for (const game of Object.keys(GAME_LABELS)) {
      const fallback = base.profiles[game];
      const loaded = parsed.profiles && parsed.profiles[game] ? parsed.profiles[game] : {};
      merged.profiles[game] = { ...fallback, ...loaded };
    }
    return merged;
  } catch (error) {
    console.error('No se pudo leer data.json. Se usaran valores iniciales:', error.message);
    return defaultState();
  }
}

let state = loadState();

function saveState() {
  state.updatedAt = Date.now();
  const tempFile = DATA_FILE + '.tmp';
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
      if (body.length > 1000000) {
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

function cleanString(value, fallback, max) {
  if (typeof value !== 'string') return fallback;
  const limit = max || 32;
  const cleaned = value.trim().replace(/[<>]/g, '').slice(0, limit);
  return cleaned || fallback;
}

function cleanTag(value) {
  if (typeof value !== 'string') return '';
  const cleaned = cleanString(value, '', 18).replace(/[^a-zA-Z0-9 '._\-]/g, '').trim();
  return cleaned || '';
}

function rosterNames(game, raw, limit) {
  const roster = ROSTERS[game];
  if (!roster || !Array.isArray(raw)) return [];
  const max = limit || TEAM_LIMITS[game] || 1;
  const unique = [];
  for (const name of raw) {
    const cleaned = cleanString(name, '', 22);
    if (roster.has(cleaned) && !unique.includes(cleaned)) unique.push(cleaned);
  }
  return unique.slice(0, max);
}

function detectedNames(game, raw) {
  if (TAG_GAMES[game]) {
    return Array.isArray(raw)
      ? raw.map(cleanTag).filter(Boolean).slice(0, TEAM_LIMITS[game] || 1)
      : [];
  }
  return rosterNames(game, raw);
}

function sanitizeCharStats(game, raw) {
  const out = {};
  const roster = ROSTERS[game];
  if (!roster || !raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const allowTags = TAG_GAMES[game] === true;
  for (const name of Object.keys(raw)) {
    const key = allowTags ? cleanTag(name) : name;
    if (!key) continue;
    if (!allowTags && !roster.has(name)) continue;
    const entry = raw[name] || {};
    out[key] = {
      wins: Number.isInteger(entry.wins) ? Math.max(0, Math.min(9999, entry.wins)) : 0,
      losses: Number.isInteger(entry.losses) ? Math.max(0, Math.min(9999, entry.losses)) : 0
    };
    if (Object.keys(out).length >= 50) break;
  }
  return out;
}

function sanitizeHistory(game, raw) {
  if (!Array.isArray(raw)) return [];
  const limit = TEAM_LIMITS[game] || 1;
  const entries = raw.slice(-HISTORY_LIMIT).map(entry => ({
    at: Number.isFinite(Number(entry && entry.at)) ? Number(entry.at) : 0,
    result: entry && entry.result === 'win' ? 'win' : 'loss',
    team: detectedNames(game, entry && entry.team),
    opponents: detectedNames(game, entry && entry.opponents),
    source: entry && entry.source === 'auto' ? 'auto' : 'manual'
  }));
  return entries;
}

function sanitizeState(input) {
  const next = defaultState();
  next.playerName = cleanString(input.playerName, state.playerName, 24);
  next.selectedGame = Object.hasOwn(GAME_LABELS, input.selectedGame) ? input.selectedGame : state.selectedGame;
  next.position = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'bottom-center'].includes(input.position)
    ? input.position : state.position;
  next.scale = Number.isFinite(Number(input.scale)) ? Math.min(1.35, Math.max(0.7, Number(input.scale))) : state.scale;
  next.opacity = Number.isFinite(Number(input.opacity)) ? Math.min(100, Math.max(35, Number(input.opacity))) : state.opacity;
  next.autoRecord = typeof input.autoRecord === 'boolean' ? input.autoRecord : state.autoRecord;
  next.autoApplyMains = typeof input.autoApplyMains === 'boolean' ? input.autoApplyMains : state.autoApplyMains;

  for (const game of Object.keys(GAME_LABELS)) {
    const oldProfile = state.profiles[game] || next.profiles[game];
    const incoming = input.profiles && input.profiles[game] ? input.profiles[game] : oldProfile;
    const limit = TEAM_LIMITS[game];
    const mains = Array.isArray(incoming.mains)
      ? incoming.mains.map(name => cleanString(name, '', 22)).filter(Boolean).slice(0, 3)
      : oldProfile.mains;
    next.profiles[game] = {
      wins: Number.isInteger(incoming.wins) ? Math.max(0, Math.min(99999, incoming.wins)) : oldProfile.wins,
      losses: Number.isInteger(incoming.losses) ? Math.max(0, Math.min(99999, incoming.losses)) : oldProfile.losses,
      mains,
      streak: Number.isInteger(incoming.streak) ? Math.max(-999, Math.min(999, incoming.streak)) : oldProfile.streak,
      detectedCharacters: Array.isArray(incoming.detectedCharacters)
        ? detectedNames(game, incoming.detectedCharacters).length || TAG_GAMES[game]
          ? detectedNames(game, incoming.detectedCharacters)
          : []
        : (oldProfile.detectedCharacters || []),
      detectedAt: Number.isFinite(Number(incoming.detectedAt)) ? Math.max(0, Number(incoming.detectedAt)) : (oldProfile.detectedAt || 0),
      detectedOpponents: Array.isArray(incoming.detectedOpponents)
        ? detectedNames(game, incoming.detectedOpponents)
        : (oldProfile.detectedOpponents || []),
      detectedOpponentsAt: Number.isFinite(Number(incoming.detectedOpponentsAt)) ? Math.max(0, Number(incoming.detectedOpponentsAt)) : (oldProfile.detectedOpponentsAt || 0),
      matchHistory: sanitizeHistory(game, incoming.matchHistory !== undefined ? incoming.matchHistory : oldProfile.matchHistory),
      charStats: sanitizeCharStats(game, incoming.charStats !== undefined ? incoming.charStats : oldProfile.charStats)
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

  const filePath = path.resolve(PUBLIC_DIR, '.' + requestedPath);
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
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
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
      if (input.source === 'auto' && state.autoRecord === false) {
        return sendJson(res, 200, { ok: true, skipped: true, reason: 'auto-record-off', state });
      }
      const game = state.selectedGame;
      const profile = state.profiles[game];
      profile.charStats = profile.charStats && typeof profile.charStats === 'object' ? profile.charStats : {};
      profile.matchHistory = Array.isArray(profile.matchHistory) ? profile.matchHistory : [];
      if (input.result === 'win') {
        profile.wins += 1;
        profile.streak = profile.streak > 0 ? profile.streak + 1 : 1;
      } else {
        profile.losses += 1;
        profile.streak = profile.streak < 0 ? profile.streak - 1 : -1;
      }
      const team = Array.isArray(profile.detectedCharacters) ? profile.detectedCharacters.slice(0, TEAM_LIMITS[game]) : [];
      const opponents = Array.isArray(profile.detectedOpponents) ? profile.detectedOpponents.slice(0, TEAM_LIMITS[game]) : [];
      for (const name of team) {
        const stats = profile.charStats[name] || (profile.charStats[name] = { wins: 0, losses: 0 });
        if (input.result === 'win') stats.wins += 1;
        else stats.losses += 1;
      }
      profile.matchHistory.push({
        at: Date.now(),
        result: input.result,
        team,
        opponents,
        source: input.source === 'auto' ? 'auto' : 'manual'
      });
      if (profile.matchHistory.length > HISTORY_LIMIT) profile.matchHistory = profile.matchHistory.slice(-HISTORY_LIMIT);
      state.lastResult = { result: input.result, game, at: Date.now() };
      saveState();
      return sendJson(res, 200, { ok: true, state });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error.message });
    }
  }

  if (req.method === 'POST' && pathname === '/api/undo') {
    try {
      const input = await readJson(req);
      const game = input.game || state.selectedGame;
      if (!Object.hasOwn(GAME_LABELS, game)) return sendJson(res, 400, { ok: false, error: 'Juego no valido.' });
      const profile = state.profiles[game];
      profile.matchHistory = Array.isArray(profile.matchHistory) ? profile.matchHistory : [];
      profile.charStats = profile.charStats && typeof profile.charStats === 'object' ? profile.charStats : {};
      if (!profile.matchHistory.length) {
        return sendJson(res, 400, { ok: false, error: 'No hay partidas registradas para deshacer.' });
      }
      const last = profile.matchHistory.pop();
      if (last.result === 'win') profile.wins = Math.max(0, profile.wins - 1);
      else profile.losses = Math.max(0, profile.losses - 1);
      for (const name of Array.isArray(last.team) ? last.team : []) {
        const stats = profile.charStats[name];
        if (stats) {
          if (last.result === 'win') stats.wins = Math.max(0, stats.wins - 1);
          else stats.losses = Math.max(0, stats.losses - 1);
        }
      }
      if (profile.matchHistory.length) {
        let streak = profile.matchHistory[profile.matchHistory.length - 1].result === 'win' ? 1 : -1;
        for (let i = profile.matchHistory.length - 2; i >= 0; i -= 1) {
          const entry = profile.matchHistory[i];
          if (entry.result === 'win' && streak > 0) streak += 1;
          else if (entry.result === 'loss' && streak < 0) streak -= 1;
          else break;
        }
        profile.streak = streak;
      } else {
        profile.streak = 0;
      }
      state.lastResult = null;
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
      if (!Object.hasOwn(GAME_LABELS, game)) return sendJson(res, 400, { ok: false, error: 'Juego no valido.' });
      const own = TAG_GAMES[game] ? [] : rosterNames(game, input.characters);
      const opponents = TAG_GAMES[game]
        ? (Array.isArray(input.opponents) ? [cleanTag(input.opponents[0] || '')].filter(Boolean) : [])
        : rosterNames(game, input.opponents);
      if (!own.length && !opponents.length) return sendJson(res, 400, { ok: false, error: 'No se reconocieron personajes válidos de ' + GAME_LABELS[game] + '.' });
      const profile = state.profiles[game];
      if (own.length) {
        profile.detectedCharacters = own;
        profile.detectedAt = Date.now();
      }
      if (opponents.length) {
        profile.detectedOpponents = opponents;
        profile.detectedOpponentsAt = Date.now();
      }
      if (state.autoApplyMains && own.length) profile.mains = own.slice(0, 3);
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
  console.log('');
  console.log('Overlay de juegos de pelea v0.6.1 lista:');
  console.log('  Panel de control: http://127.0.0.1:' + PORT + '/dashboard');
  console.log('  Overlay para OBS: http://127.0.0.1:' + PORT + '/overlay');
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) for (const item of entries || []) {
    if (item.family === 'IPv4' && !item.internal) console.log('  Control móvil: http://' + item.address + ':' + PORT + '/remote');
  }
  console.log('  Código de conexión móvil: ' + REMOTE_PIN);
  console.log('');
  console.log('Deja esta ventana abierta mientras uses la overlay.');
  console.log('');
});