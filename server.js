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
    gameAutoDetect: false,
    sessionResetMode: 'manual',
    sessionIdleMinutes: 30,
    ggstApi: { enabled: false, token: '', playerId: '', baselined: false, lastStatus: '', seenKeys: [] },
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
  next.gameAutoDetect = typeof input.gameAutoDetect === 'boolean' ? input.gameAutoDetect : state.gameAutoDetect;
  next.sessionResetMode = ['manual', 'daily', 'idle'].includes(input.sessionResetMode) ? input.sessionResetMode : (state.sessionResetMode || 'manual');
  next.sessionIdleMinutes = Number.isFinite(Number(input.sessionIdleMinutes)) ? Math.min(720, Math.max(1, Math.round(Number(input.sessionIdleMinutes)))) : (state.sessionIdleMinutes || 30);
  next.ggstApi = sanitizeGgstApi(input.ggstApi, state.ggstApi);

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

function resetSessionCounters(profile) {
  profile.wins = 0;
  profile.losses = 0;
  profile.streak = 0;
}

// Reinicio automático del marcador de sesión (configurable en el panel):
// 'daily' vuelve a cero con la primera partida del día y 'idle' tras X minutos sin partidas.
function autoResetSessionIfNeeded(profile) {
  const mode = state.sessionResetMode;
  if (mode !== 'daily' && mode !== 'idle') return false;
  const history = Array.isArray(profile.matchHistory) ? profile.matchHistory : [];
  const lastAt = history.length ? history[history.length - 1].at : 0;
  if (!lastAt) return false;
  let shouldReset = false;
  if (mode === 'daily') {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    shouldReset = lastAt < startOfDay.getTime();
  } else {
    const minutes = Math.max(1, Math.min(720, state.sessionIdleMinutes || 30));
    shouldReset = Date.now() - lastAt >= minutes * 60000;
  }
  if (shouldReset) resetSessionCounters(profile);
  return shouldReset;
}


// =====================================================================
// API de replays de GGST (no oficial, cifrada). El token lo genera el
// helper de Steam incluido en tools/ggst-token; el token y el Player ID
// se pegan en el panel y este servidor sondea el historial de replays.
// =====================================================================
const GGST_BASE = 'https://ggst-game.guiltygear.com';
const GGST_API_KEY = Buffer.from('EEBC1F57487F51921C0465665F8AE6D1658BB26DE6F8A069A3520293A572078F', 'hex');
const GGST_API_VERSION = '0.4.8';
const GGST_POLL_MS = 20000;
// IDs de personaje de la API (orden oficial del juego).
const GGST_CHARACTERS = ['Sol', 'Ky', 'May', 'Axl', 'Chipp', 'Potemkin', 'Faust', 'Millia', 'Zato', 'Ramlethal', 'Leo', 'Nagoriyuki', 'Giovanna', 'Anji', 'I-No', 'Goldlewis', 'Jack-O', 'Happy Chaos', 'Baiken', 'Testament', 'Bridget', 'Sin', 'Bedman?', 'Asuka', 'Johnny', 'Elphelt', 'A.B.A', 'Slayer', 'Dizzy', 'Venom', 'Unika', 'Lucy', 'Jam', 'Robo-Ky'];

function ggstCharacterName(id) {
  const index = Number(id);
  return Number.isInteger(index) && index >= 0 && index < GGST_CHARACTERS.length ? GGST_CHARACTERS[index] : '';
}

// Codificador MessagePack mínimo (solo lo que usa esta API: arrays, cadenas y enteros).
function msgpackEncode(value) {
  if (value === null || value === undefined) return Buffer.from([0xc0]);
  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      if (value >= 0 && value <= 0x7f) return Buffer.from([value]);
      if (value < 0 && value >= -32) return Buffer.from([256 + value]);
      if (value >= -128 && value <= 127) return Buffer.from([0xd0, value & 0xff]);
      if (value >= -32768 && value <= 32767) { const b = Buffer.alloc(3); b[0] = 0xd1; b.writeInt16BE(value, 1); return b; }
      if (value >= -2147483648 && value <= 2147483647) { const b = Buffer.alloc(5); b[0] = 0xd2; b.writeInt32BE(value, 1); return b; }
      const b = Buffer.alloc(9); b[0] = 0xd3; b.writeBigInt64BE(BigInt(value), 1); return b;
    }
    const b = Buffer.alloc(9); b[0] = 0xcb; b.writeDoubleBE(value, 1); return b;
  }
  if (typeof value === 'string') {
    const utf8 = Buffer.from(value, 'utf8');
    if (utf8.length <= 31) return Buffer.concat([Buffer.from([0xa0 + utf8.length]), utf8]);
    if (utf8.length <= 255) return Buffer.concat([Buffer.from([0xd9, utf8.length]), utf8]);
    if (utf8.length <= 65535) { const b = Buffer.alloc(3); b[0] = 0xda; b.writeUInt16BE(utf8.length, 1); return Buffer.concat([b, utf8]); }
    const b = Buffer.alloc(5); b[0] = 0xdb; b.writeUInt32BE(utf8.length, 1); return Buffer.concat([b, utf8]);
  }
  if (Array.isArray(value)) {
    let head;
    if (value.length <= 15) head = Buffer.from([0x90 + value.length]);
    else if (value.length <= 65535) { head = Buffer.alloc(3); head[0] = 0xdc; head.writeUInt16BE(value.length, 1); }
    else { head = Buffer.alloc(5); head[0] = 0xdd; head.writeUInt32BE(value.length, 1); }
    return Buffer.concat([head, ...value.map(msgpackEncode)]);
  }
  throw new Error('Tipo no soportado por el codificador msgpack.');
}

// Decodificador MessagePack mínimo (arrays, mapas, cadenas, enteros, binarios).
function msgpackDecode(buffer) {
  let offset = 0;
  function take(length) {
    if (offset + length > buffer.length) throw new Error('msgpack truncado.');
    const out = buffer.subarray(offset, offset + length);
    offset += length;
    return out;
  }
  function decode() {
    const byte = take(1)[0];
    if (byte <= 0x7f) return byte;
    if (byte >= 0xe0) return byte - 256;
    if (byte >= 0x80 && byte <= 0x8f) {
      const obj = {};
      for (let i = 0; i < (byte & 0x0f); i += 1) { const key = decode(); obj[String(key)] = decode(); }
      return obj;
    }
    if (byte >= 0x90 && byte <= 0x9f) {
      const arr = [];
      for (let i = 0; i < (byte & 0x0f); i += 1) arr.push(decode());
      return arr;
    }
    if (byte >= 0xa0 && byte <= 0xbf) return take(byte & 0x1f).toString('utf8');
    switch (byte) {
      case 0xc0: return null;
      case 0xc2: return false;
      case 0xc3: return true;
      case 0xc4: return Buffer.from(take(take(1)[0]));
      case 0xc5: return Buffer.from(take(take(2).readUInt16BE(0)));
      case 0xc6: return Buffer.from(take(Number(take(4).readUInt32BE(0))));
      case 0xca: return take(4).readFloatBE(0);
      case 0xcb: return take(8).readDoubleBE(0);
      case 0xcc: return take(1)[0];
      case 0xcd: return take(2).readUInt16BE(0);
      case 0xce: return take(4).readUInt32BE(0);
      case 0xcf: return Number(take(8).readBigUInt64BE(0));
      case 0xd0: return take(1).readInt8(0);
      case 0xd1: return take(2).readInt16BE(0);
      case 0xd2: return take(4).readInt32BE(0);
      case 0xd3: return Number(take(8).readBigInt64BE(0));
      case 0xd9: return take(take(1)[0]).toString('utf8');
      case 0xda: return take(take(2).readUInt16BE(0)).toString('utf8');
      case 0xdb: return take(Number(take(4).readUInt32BE(0))).toString('utf8');
      case 0xdc: { const count = take(2).readUInt16BE(0); const arr = []; for (let i = 0; i < count; i += 1) arr.push(decode()); return arr; }
      case 0xdd: { const count = Number(take(4).readUInt32BE(0)); const arr = []; for (let i = 0; i < count; i += 1) arr.push(decode()); return arr; }
      case 0xde: { const count = take(2).readUInt16BE(0); const obj = {}; for (let i = 0; i < count; i += 1) { const key = decode(); obj[String(key)] = decode(); } return obj; }
      case 0xdf: { const count = Number(take(4).readUInt32BE(0)); const obj = {}; for (let i = 0; i < count; i += 1) { const key = decode(); obj[String(key)] = decode(); } return obj; }
      default: throw new Error('msgpack: tipo desconocido 0x' + byte.toString(16));
    }
  }
  return decode();
}

function ggstEncrypt(plaintextBuffer) {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', GGST_API_KEY, nonce);
  const encrypted = Buffer.concat([cipher.update(plaintextBuffer), cipher.final()]);
  return Buffer.concat([nonce, encrypted, cipher.getAuthTag()]).toString('base64url');
}

function ggstDecrypt(responseBuffer) {
  if (responseBuffer.length < 28) throw new Error('Respuesta de GGST demasiado corta.');
  const nonce = responseBuffer.subarray(0, 12);
  const tag = responseBuffer.subarray(responseBuffer.length - 16);
  const data = responseBuffer.subarray(12, responseBuffer.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', GGST_API_KEY, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

async function ggstCall(path, payload) {
  const response = await fetch(GGST_BASE + path, {
    method: 'POST',
    headers: {
      'User-Agent': 'GGST/Steam',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cache-Control': 'no-store',
      'x-client-version': '1'
    },
    body: 'data=' + ggstEncrypt(msgpackEncode(payload))
  });
  if (!response.ok) throw new Error('la API respondió HTTP ' + response.status);
  return msgpackDecode(ggstDecrypt(Buffer.from(await response.arrayBuffer())));
}

// [playerId, token, 10, version, plataforma] + cuerpo de catalog/get_replay
// con el historial filtrado a tus propias partidas.
function ggstReplaysRequest(playerId, token, index, perPage) {
  return [
    [playerId, token, 10, GGST_API_VERSION, 3],
    [1, index, perPage, [-1, 0, 0, 22, 0, 99, [playerId], -1, -1, 0, 1, -1], 6]
  ];
}

async function ggstFetchReplays(session) {
  const decoded = await ggstCall('/api/catalog/get_replay', ggstReplaysRequest(session.playerId, session.token, 0, 10));
  const body = Array.isArray(decoded) && Array.isArray(decoded[1]) ? decoded[1] : null;
  const raw = body && Array.isArray(body[3]) ? body[3] : [];
  return raw.map((entry) => {
    const player = (value) => ({
      id: String(Array.isArray(value) && value[0] != null ? value[0] : ''),
      name: String(Array.isArray(value) && value[1] != null ? value[1] : '')
    });
    return {
      char1: Number(entry[3]),
      char2: Number(entry[4]),
      player1: player(entry[5]),
      player2: player(entry[6]),
      winner: Number(entry[7]),
      date: typeof entry[8] === 'string' ? entry[8] : ''
    };
  }).filter((replay) => replay.date);
}

function sanitizeGgstApi(raw, old) {
  const session = raw && typeof raw === 'object' ? raw : {};
  const base = old || { enabled: false, token: '', playerId: '', baselined: false, lastStatus: '', seenKeys: [] };
  return {
    enabled: typeof session.enabled === 'boolean' ? session.enabled : base.enabled,
    token: typeof session.token === 'string' ? session.token.trim().replace(/[^A-Za-z0-9]/g, '').slice(0, 80) : base.token,
    playerId: typeof session.playerId === 'string' ? session.playerId.trim().replace(/[^0-9]/g, '').slice(0, 24) : base.playerId,
    baselined: typeof session.baselined === 'boolean' ? session.baselined : base.baselined,
    lastStatus: cleanString(session.lastStatus, base.lastStatus || '', 140),
    seenKeys: Array.isArray(session.seenKeys) ? session.seenKeys.filter((key) => typeof key === 'string' && key.length < 120).slice(-200) : (base.seenKeys || [])
  };
}

// Registro común de partidas: lo usan el endpoint manual y el sondeo de la API.
function recordMatch(game, result, team, opponents, source) {
  const profile = state.profiles[game];
  profile.charStats = profile.charStats && typeof profile.charStats === 'object' ? profile.charStats : {};
  profile.matchHistory = Array.isArray(profile.matchHistory) ? profile.matchHistory : [];
  autoResetSessionIfNeeded(profile);
  if (result === 'win') {
    profile.wins += 1;
    profile.streak = profile.streak > 0 ? profile.streak + 1 : 1;
  } else {
    profile.losses += 1;
    profile.streak = profile.streak < 0 ? profile.streak - 1 : -1;
  }
  for (const name of team) {
    const stats = profile.charStats[name] || (profile.charStats[name] = { wins: 0, losses: 0 });
    if (result === 'win') stats.wins += 1;
    else stats.losses += 1;
  }
  profile.matchHistory.push({
    at: Date.now(),
    result,
    team,
    opponents,
    source: source === 'auto' ? 'auto' : 'manual'
  });
  if (profile.matchHistory.length > HISTORY_LIMIT) profile.matchHistory = profile.matchHistory.slice(-HISTORY_LIMIT);
  state.lastResult = { result, game, at: Date.now() };
  saveState();
}

// Sondeo del historial de replays: cada partida nueva se registra sola.
async function pollGgstReplays() {
  const session = state.ggstApi;
  if (!session || !session.enabled || !session.token || !session.playerId) return;
  try {
    const replays = await ggstFetchReplays(session);
    const fresh = [];
    for (const replay of replays) {
      const side = replay.player1.id === session.playerId ? 1 : replay.player2.id === session.playerId ? 2 : 0;
      if (!side) continue;
      const opponent = side === 1 ? replay.player2.name : replay.player1.name;
      const key = replay.date + '|' + side + '|' + opponent;
      if (session.seenKeys.includes(key)) continue;
      fresh.push({ replay, side, key, opponent });
    }
    if (!session.baselined) {
      // Primera conexión: marca el historial actual como ya conocido para no
      // dar de alta partidas viejas de golpe.
      session.seenKeys = fresh.map((item) => item.key).slice(-200);
      session.baselined = true;
      session.lastStatus = 'Conectado a la API de replays de GGST. Las partidas nuevas se registrarán solas.';
      saveState();
      return;
    }
    for (const item of fresh) {
      const myCharId = item.side === 1 ? item.replay.char1 : item.replay.char2;
      const oppCharId = item.side === 1 ? item.replay.char2 : item.replay.char1;
      const team = [ggstCharacterName(myCharId)].filter(Boolean);
      const opponents = [ggstCharacterName(oppCharId)].filter(Boolean);
      const won = (item.side === 1 && item.replay.winner === 1) || (item.side === 2 && item.replay.winner === 2);
      recordMatch('ggst', won ? 'win' : 'loss', team, opponents, 'auto');
      session.seenKeys.push(item.key);
      session.lastStatus = 'Registrada automáticamente: ' + (won ? 'victoria' : 'derrota') + ' vs ' + (item.opponent || 'rival') + '.';
    }
    if (fresh.length) session.seenKeys = session.seenKeys.slice(-200);
    else if (!session.lastStatus.startsWith('Registrada')) {
      session.lastStatus = 'API de GGST conectada, sin partidas nuevas. Última comprobación ' + new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }) + '.';
    }
    saveState();
  } catch (error) {
    session.lastStatus = 'La API de GGST no respondió: ' + error.message;
    saveState();
  }
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon'
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
      const team = Array.isArray(profile.detectedCharacters) ? profile.detectedCharacters.slice(0, TEAM_LIMITS[game]) : [];
      const opponents = Array.isArray(profile.detectedOpponents) ? profile.detectedOpponents.slice(0, TEAM_LIMITS[game]) : [];
      recordMatch(game, input.result, team, opponents, input.source);
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

  if (req.method === 'POST' && pathname === '/api/ggst-session') {
    try {
      const input = await readJson(req);
      const token = typeof input.token === 'string' ? input.token.trim().replace(/[^A-Za-z0-9]/g, '').slice(0, 80) : '';
      const playerId = typeof input.playerId === 'string' ? input.playerId.trim().replace(/[^0-9]/g, '').slice(0, 24) : '';
      if (!token || !playerId) return sendJson(res, 400, { ok: false, error: 'Faltan el token o el Player ID que imprime el helper de Steam.' });
      state.ggstApi.token = token;
      state.ggstApi.playerId = playerId;
      state.ggstApi.enabled = true;
      state.ggstApi.baselined = false;
      state.ggstApi.lastStatus = 'Comprobando la conexión con la API de GGST…';
      saveState();
      await pollGgstReplays();
      return sendJson(res, 200, { ok: true, state });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error.message });
    }
  }

  if (req.method === 'POST' && pathname === '/api/ggst-toggle') {
    try {
      const input = await readJson(req);
      state.ggstApi.enabled = input.enabled === true;
      state.ggstApi.lastStatus = state.ggstApi.enabled ? 'Tracking por API de GGST activado.' : 'Tracking por API de GGST apagado.';
      if (state.ggstApi.enabled && !state.ggstApi.baselined) await pollGgstReplays();
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

// Sondeo periódico de la API de replays de GGST.
setInterval(() => { pollGgstReplays().catch(() => {}); }, GGST_POLL_MS);
if (state.ggstApi && state.ggstApi.enabled) pollGgstReplays().catch(() => {});

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('Overlay de juegos de pelea v0.9.0 lista:');
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