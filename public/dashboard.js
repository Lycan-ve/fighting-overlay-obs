'use strict';

const $ = id => document.getElementById(id);
let currentState = null;
let lastUpdatedAt = 0;
let captureStream = null;
let ocrWorker = null;
let detectorRunning = false;
let scanTimer = null;
let scanPhaseIndex = 0;
let stableCandidate = '';
let stableCandidateCount = 0;
let lastPostedCandidate = '';
let stableOpponent = '';
let stableOpponentCount = 0;
let lastPostedOpponent = '';
let stableResult = '';
let stableResultCount = 0;
let lastAutoResultAt = 0;
let latestDetected = [];
let ownTag = '';
let ownTagCount = 0;
let oppTag = '';
let oppTagCount = 0;

const SCAN_PHASES = ['team', 'result', 'opponents', 'result'];
const RESULT_COOLDOWN_MS = 10000;
const GAME_NAMES = { '2xko': '2XKO', ggst: 'GUILTY GEAR STRIVE', mk11: 'MORTAL KOMBAT 11' };
const THEME_CLASSES = ['theme-2xko', 'theme-mk11', 'theme-ggst'];
const FIGHTER_ASSET_BASE = 'https://raw.githubusercontent.com/Lycan-ve/Hot-Coffee-Frontend/master/public/fighters/';

// Iconos locales de Guilty Gear Strive dentro del propio repo (public/Assest).
const GGST_ASSET_PATH = '/Assest/' + encodeURIComponent('Guilty Gear Strive') + '/';
// Nombres del roster cuyo archivo de icono usa una clave distinta.
const GGST_ICON_KEYS = { 'A.B.A': 'ABA', 'Bedman?': 'Bed', 'Happy Chaos': 'HappyChaos' };

// Rosters por juego para el OCR (nombres tal como aparecen en el HUD).
const CHAMPIONS_2XKO = [
  'Ahri', 'Akali', 'Blitzcrank', 'Braum', 'Caitlyn', 'Darius', 'Ekko', 'Illaoi',
  'Jinx', 'Lux', 'Samira', 'Senna', 'Sett', 'Teemo', 'Thresh', 'Vi', 'Warwick', 'Yasuo'
];
const CHAMPIONS_GGST = [
  'Sol', 'Ky', 'May', 'Axl', 'Chipp', 'Potemkin', 'Faust', 'Millia', 'Zato',
  'Ramlethal', 'Leo', 'Nagoriyuki', 'Giovanna', 'Anji', 'I-No', 'Goldlewis',
  'Jack-O', 'Happy Chaos', 'Baiken', 'Testament', 'Bridget', 'Sin', 'Bedman?',
  'Asuka', 'Johnny', 'Elphelt', 'A.B.A', 'Slayer', 'Venom', 'Dizzy', 'Unika', 'Lucy'
];
const CHAMPIONS_MK11 = [
  'Scorpion', 'Liu Kang', 'Kung Lao', 'Sub-Zero', 'Raiden', 'Sonya', 'Johnny Cage',
  'Cassie Cage', 'Jax', 'Jacqui Briggs', 'Baraka', 'Jade', 'Kitana', 'Mileena',
  'Skarlet', "D'Vorah", 'Kotal Kahn', 'Geras', 'Kollector', 'Noob Saibot', 'Cetrion',
  'Shao Kahn', 'Frost', 'Erron Black', 'Shang Tsung', 'Nightwolf', 'Sindel',
  'Terminator', 'Joker', 'Spawn', 'Fujin', 'Sheeva', 'RoboCop', 'Rain', 'Rambo'
];

// Configuración de detección por juego, medida sobre las capturas de HUD del canal.
// Son proporciones del ancho/alto de la ventana compartida; ajusta con las vistas
// de diagnóstico si un recorte queda desplazado.
// mode 'roster': busca nombres de personajes. mode 'tags': lee etiquetas de jugador
// (el HUD de MK11 no muestra personajes, solo gamertags).
const GAME_DETECT = {
  '2xko': {
    mode: 'roster',
    roster: CHAMPIONS_2XKO,
    teamSize: 2,
    hud: { left: { x: 0.105, y: 0.058, w: 0.335, h: 0.084 }, right: { x: 0.65, y: 0.058, w: 0.335, h: 0.084 } },
    result: { x: 0.14, y: 0.28, w: 0.72, h: 0.40 },
    winWords: ['victory', 'victoria', 'youwin', 'wins', 'winner'],
    lossWords: ['defeat', 'derrota', 'youlose', 'loser']
  },
  'ggst': {
    mode: 'roster',
    roster: CHAMPIONS_GGST,
    teamSize: 1,
    hud: { left: { x: 0.07, y: 0.08, w: 0.17, h: 0.055 }, right: { x: 0.78, y: 0.08, w: 0.17, h: 0.055 } },
    result: { x: 0.25, y: 0.30, w: 0.50, h: 0.40 },
    winWords: ['youwin', 'win', 'wins'],
    lossWords: ['youlose', 'lose', 'defeat']
  },
  'mk11': {
    mode: 'tags',
    roster: CHAMPIONS_MK11,
    teamSize: 1,
    hud: { left: { x: 0.055, y: 0.06, w: 0.20, h: 0.075 }, right: { x: 0.72, y: 0.06, w: 0.20, h: 0.075 } },
    result: { x: 0.22, y: 0.30, w: 0.56, h: 0.38 },
    winWords: ['victory', 'youwin', 'wins', 'winner'],
    lossWords: ['defeat', 'youlose', 'loser']
  }
};

function rosterFor(game) {
  const config = GAME_DETECT[game];
  return config ? config.roster : CHAMPIONS_2XKO;
}

function winRate(profile) {
  const total = profile.wins + profile.losses;
  return total ? Math.round(profile.wins / total * 100) : 0;
}

function streakText(value) {
  if (!value) return '—';
  return value > 0 ? 'W' + value : 'L' + Math.abs(value);
}

function setValueUnlessFocused(id, value) {
  if (document.activeElement !== $(id)) $(id).value = value;
}

function fighterAssetUrl(name, game) {
  // 2XKO: retratos del repo Hot-Coffee-Frontend. GGST: iconos locales de
  // public/Assest. En MK11 el HUD no muestra personajes, solo nombres.
  if (game === 'ggst') {
    if (!CHAMPIONS_GGST.includes(name)) return '';
    return GGST_ASSET_PATH + 'icon_' + encodeURIComponent(GGST_ICON_KEYS[name] || name) + '_0.png';
  }
  if (!CHAMPIONS_2XKO.includes(name)) return '';
  return FIGHTER_ASSET_BASE + encodeURIComponent(name) + '.png';
}

function createFighterChip(name, className, game) {
  const chip = document.createElement('span');
  chip.className = className;
  const url = fighterAssetUrl(name, game);
  if (url) {
    const image = document.createElement('img');
    image.className = 'fighter-chip-image';
    image.src = url;
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.onerror = () => { image.remove(); chip.classList.add('portrait-fallback'); };
    chip.append(image);
  }
  const label = document.createElement('span');
  label.textContent = name;
  chip.append(label);
  return chip;
}

function makeChips(container, names, className, emptyLabel, game) {
  container.replaceChildren();
  const values = names && names.length ? names : [];
  if (!values.length) {
    const empty = document.createElement('span');
    empty.className = 'detected-empty';
    empty.textContent = emptyLabel;
    container.append(empty);
    return;
  }
  for (const name of values) container.append(createFighterChip(name, className, game));
}

function currentMainsFromInput() {
  const roster = rosterFor(currentState ? currentState.selectedGame : $('game-select').value);
  return $('mains-input').value.split(',').map(name => name.trim()).filter(name => roster.includes(name)).slice(0, 3);
}

function renderMainPicker(selectedNames) {
  const picker = $('main-picker');
  if (!picker) return;
  picker.replaceChildren();
  const game = currentState ? currentState.selectedGame : $('game-select').value;
  const roster = rosterFor(game);
  const selected = selectedNames || [];
  for (const name of roster) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'fighter-option';
    button.dataset.name = name;
    button.setAttribute('aria-pressed', String(selected.includes(name)));
    button.title = name;
    const url = fighterAssetUrl(name, game);
    if (url) {
      const image = document.createElement('img');
      image.src = url;
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.onerror = () => { image.remove(); button.classList.add('portrait-fallback'); };
      button.append(image);
    }
    const label = document.createElement('span');
    label.textContent = name;
    button.append(label);
    picker.append(button);
  }
  const title = $('picker-title');
  if (title) title.textContent = 'ELIGE TUS MAINS · ' + (GAME_NAMES[game] || '');
}

function syncMainPicker(names) {
  const selected = new Set(names || currentMainsFromInput());
  document.querySelectorAll('.fighter-option').forEach(button => {
    const active = selected.has(button.dataset.name);
    button.classList.toggle('selected', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function toggleMainPickerCharacter(name) {
  const selected = currentMainsFromInput();
  const index = selected.indexOf(name);
  if (index >= 0) selected.splice(index, 1);
  else if (selected.length < 3) selected.push(name);
  else {
    $('picker-hint').textContent = 'El límite es de tres mains. Quita uno para elegir otro.';
    return;
  }
  $('mains-input').value = selected.join(', ');
  $('picker-hint').textContent = selected.length ? selected.length + '/3 personajes seleccionados.' : 'Selecciona hasta tres personajes. También puedes escribir sus nombres arriba.';
  syncMainPicker(selected);
}

function renderHistory(profile) {
  const list = $('history-list');
  if (!list) return;
  const entries = Array.isArray(profile.matchHistory) ? profile.matchHistory.slice().reverse().slice(0, 20) : [];
  list.replaceChildren();
  if (!entries.length) {
    const note = document.createElement('p');
    note.className = 'empty-note';
    note.textContent = 'Todavía no hay partidas en el historial. Cada victoria o derrota, manual o automática, aparecerá aquí.';
    list.append(note);
    return;
  }
  for (const entry of entries) {
    const item = document.createElement('div');
    item.className = 'history-item';
    const badge = document.createElement('span');
    badge.className = 'result-badge ' + entry.result;
    badge.textContent = entry.result === 'win' ? 'VICTORIA' : 'DERROTA';
    const copy = document.createElement('div');
    copy.className = 'history-copy';
    const line = document.createElement('span');
    line.className = 'history-line';
    const team = entry.team && entry.team.length ? entry.team.join(' + ') : 'Personaje no detectado';
    const opp = entry.opponents && entry.opponents.length ? ' vs ' + entry.opponents.join(' + ') : '';
    line.textContent = team + opp;
    const meta = document.createElement('span');
    meta.className = 'history-meta';
    meta.textContent = entry.at ? new Date(entry.at).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }) : '';
    copy.append(line, meta);
    const source = document.createElement('span');
    source.className = 'history-source';
    source.textContent = entry.source === 'auto' ? 'AUTO' : 'MANUAL';
    item.append(badge, copy, source);
    list.append(item);
  }
}

function renderCharStats(profile) {
  const wrap = $('char-stats-list');
  if (!wrap) return;
  const raw = profile.charStats && typeof profile.charStats === 'object' ? profile.charStats : {};
  const rows = Object.keys(raw)
    .map(name => ({ name, wins: raw[name].wins || 0, losses: raw[name].losses || 0 }))
    .filter(row => row.wins + row.losses > 0)
    .sort((a, b) => (b.wins + b.losses) - (a.wins + a.losses))
    .slice(0, 8);
  wrap.replaceChildren();
  if (!rows.length) {
    const note = document.createElement('p');
    note.className = 'empty-note';
    note.textContent = 'El win rate por personaje aparece aquí cuando la detección registra tus partidas.';
    wrap.append(note);
    return;
  }
  for (const row of rows) {
    const total = row.wins + row.losses;
    const pct = Math.round(row.wins / total * 100);
    const card = document.createElement('div');
    card.className = 'char-stat';
    const name = document.createElement('div');
    name.className = 'char-stat-name';
    name.textContent = row.name;
    const line = document.createElement('div');
    line.className = 'char-stat-line';
    line.textContent = row.wins + 'W · ' + row.losses + 'L · ' + pct + '% WR';
    const bar = document.createElement('div');
    bar.className = 'char-stat-bar';
    const fill = document.createElement('span');
    fill.style.width = pct + '%';
    bar.append(fill);
    card.append(name, line, bar);
    wrap.append(card);
  }
}

function renderToday(profile) {
  const note = $('today-note');
  if (!note) return;
  const history = Array.isArray(profile.matchHistory) ? profile.matchHistory : [];
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  let wins = 0;
  let losses = 0;
  for (const entry of history) {
    if (entry.at && entry.at >= startOfDay.getTime()) {
      if (entry.result === 'win') wins += 1;
      else losses += 1;
    }
  }
  if (!wins && !losses) {
    note.textContent = 'HOY: sin partidas registradas todavía.';
    return;
  }
  const total = wins + losses;
  const pct = Math.round(wins / total * 100);
  note.textContent = 'HOY: ' + wins + 'W · ' + losses + 'L · ' + pct + '% win rate.';
}

function render(state) {
  currentState = state;
  const profile = state.profiles[state.selectedGame];
  setValueUnlessFocused('player-name-input', state.playerName);
  setValueUnlessFocused('game-select', state.selectedGame);
  setValueUnlessFocused('mains-input', profile.mains.join(', '));
  renderMainPicker(currentMainsFromInput());
  $('picker-hint').textContent = profile.mains.length ? profile.mains.length + '/3 personajes seleccionados.' : 'Selecciona hasta tres personajes. También puedes escribir sus nombres arriba.';
  $('position-select').value = state.position;
  $('scale-range').value = Math.round(state.scale * 100);
  $('opacity-range').value = state.opacity;
  $('scale-output').value = Math.round(state.scale * 100) + '%';
  $('opacity-output').value = state.opacity + '%';
  $('auto-record-toggle').checked = state.autoRecord !== false;
  $('auto-apply-toggle').checked = state.autoApplyMains === true;
  $('summary-wins').textContent = profile.wins;
  $('summary-losses').textContent = profile.losses;
  $('summary-rate').textContent = winRate(profile) + '%';
  $('summary-streak').textContent = streakText(profile.streak);
  renderToday(profile);
  renderHistory(profile);
  renderCharStats(profile);

  $('preview-game').textContent = GAME_NAMES[state.selectedGame] + ' · RÉCORD DE SESIÓN';
  $('preview-player').textContent = state.playerName;
  $('preview-wins').textContent = profile.wins;
  $('preview-losses').textContent = profile.losses;
  $('preview-rate').innerHTML = winRate(profile) + '<span class="percent">%</span>';
  makeChips($('preview-mains'), profile.mains, 'main-chip', 'Sin configurar', state.selectedGame);

  const detectedFresh = Array.isArray(profile.detectedCharacters)
    && profile.detectedCharacters.length > 0
    && profile.detectedAt
    && Date.now() - profile.detectedAt < 45000;
  $('preview-team-row').hidden = !detectedFresh;
  if (!$('preview-team-row').hidden) makeChips($('preview-team-chips'), profile.detectedCharacters, 'detected-chip', '', state.selectedGame);

  const opponentsFresh = Array.isArray(profile.detectedOpponents)
    && profile.detectedOpponents.length > 0
    && profile.detectedOpponentsAt
    && Date.now() - profile.detectedOpponentsAt < 45000;
  $('preview-opponents-row').hidden = !opponentsFresh;
  if (!$('preview-opponents-row').hidden) makeChips($('preview-opponents-chips'), profile.detectedOpponents, 'detected-chip', '', state.selectedGame);

  const streak = $('preview-streak');
  if (profile.streak) {
    streak.hidden = false;
    streak.textContent = profile.streak > 0 ? '↗ ' + profile.streak + ' W' : '↘ ' + Math.abs(profile.streak) + ' L';
  } else streak.hidden = true;

  const mount = $('preview-mount');
  mount.style.opacity = String(state.opacity / 100);
  const card = mount.querySelector('.preview-card');
  card.classList.remove.apply(card.classList, THEME_CLASSES);
  card.classList.add('theme-' + state.selectedGame);
  card.style.transform = 'scale(' + (0.27 * state.scale) + ')';
  card.classList.toggle('position-bottom-center', state.position === 'bottom-center');
  card.style.transformOrigin = state.position === 'bottom-center' ? 'bottom center' : (state.position.endsWith('left') ? 'top left' : 'top right');
  card.style.top = state.position.startsWith('top') ? '14.5%' : 'auto';
  card.style.bottom = state.position.startsWith('bottom') ? '3%' : 'auto';
  card.style.left = state.position === 'bottom-center' ? '50%' : (state.position.endsWith('left') ? '2%' : 'auto');
  if (state.position === 'bottom-center') card.style.marginLeft = '-440px'; else card.style.marginLeft = '0';
  card.style.right = state.position.endsWith('right') ? '2%' : 'auto';

  if (profile.detectedCharacters && profile.detectedCharacters.length && profile.detectedAt) {
    latestDetected = profile.detectedCharacters.slice();
    if (!detectorRunning && Date.now() - profile.detectedAt < 45000) {
      showDetected(latestDetected, null);
    }
  }
}

async function api(path, payload) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.error || 'No se pudo guardar el cambio.');
  return data.state;
}

async function refresh() {
  try {
    const response = await fetch('/api/state', { cache: 'no-store' });
    if (!response.ok) throw new Error('Error de conexión');
    const state = await response.json();
    if (!currentState || state.updatedAt !== lastUpdatedAt) {
      lastUpdatedAt = state.updatedAt;
      render(state);
    }
  } catch (error) {
    $('save-message').textContent = 'No hay conexión con el servidor local.';
  }
}

async function saveProfile() {
  if (!currentState) return;
  const next = structuredClone(currentState);
  next.playerName = $('player-name-input').value.trim() || 'PLAYER';
  const newGame = $('game-select').value;
  next.selectedGame = newGame;
  next.profiles[newGame].mains = $('mains-input').value.split(',').map(x => x.trim()).filter(Boolean).slice(0, 3);
  try {
    const saved = await api('/api/state', next);
    lastUpdatedAt = saved.updatedAt;
    render(saved);
    $('save-message').textContent = 'Perfil guardado correctamente.';
  } catch (error) {
    $('save-message').textContent = error.message;
  }
}

async function saveAppearance() {
  if (!currentState) return;
  const next = structuredClone(currentState);
  next.position = $('position-select').value;
  next.scale = Number($('scale-range').value) / 100;
  next.opacity = Number($('opacity-range').value);
  try {
    const saved = await api('/api/state', next);
    lastUpdatedAt = saved.updatedAt;
    render(saved);
    $('save-message').textContent = 'Apariencia aplicada.';
  } catch (error) {
    $('save-message').textContent = error.message;
  }
}

async function saveAutomation() {
  if (!currentState) return;
  const next = structuredClone(currentState);
  next.autoRecord = $('auto-record-toggle').checked;
  next.autoApplyMains = $('auto-apply-toggle').checked;
  try {
    const saved = await api('/api/state', next);
    lastUpdatedAt = saved.updatedAt;
    render(saved);
    $('save-message').textContent = 'Ajustes de automatización guardados.';
  } catch (error) {
    $('save-message').textContent = error.message;
  }
}

async function addResult(result) {
  try {
    const saved = await api('/api/result', { result });
    lastUpdatedAt = saved.updatedAt;
    render(saved);
    $('save-message').textContent = result === 'win' ? 'Victoria registrada.' : 'Derrota registrada.';
  } catch (error) {
    $('save-message').textContent = error.message;
  }
}

async function undoLast() {
  if (!currentState) return;
  try {
    const saved = await api('/api/undo', { game: currentState.selectedGame });
    lastUpdatedAt = saved.updatedAt;
    render(saved);
    $('save-message').textContent = 'Última partida deshecha.';
  } catch (error) {
    $('save-message').textContent = error.message;
  }
}

async function resetStats() {
  const game = currentState && currentState.selectedGame;
  if (!game || !window.confirm('¿Reiniciar victorias, derrotas y racha de ' + GAME_NAMES[game] + '?')) return;
  try {
    const saved = await api('/api/reset', { game });
    lastUpdatedAt = saved.updatedAt;
    render(saved);
    $('save-message').textContent = 'Estadísticas reiniciadas.';
  } catch (error) {
    $('save-message').textContent = error.message;
  }
}

function setDetectorStatus(message, stateName) {
  const target = $('detector-status');
  target.replaceChildren();
  const dot = document.createElement('span');
  dot.className = 'status-dot detector-dot-' + (stateName || 'idle');
  const text = document.createElement('span');
  text.textContent = message;
  target.append(dot, text);
}

function showDetected(names, confidence) {
  latestDetected = names || [];
  makeChips($('detected-list'), latestDetected, 'detected-chip', 'No se reconocen personajes todavía', activeGame());
  $('detected-confidence').textContent = confidence == null ? 'LECTURA GUARDADA' : 'OCR ' + Math.round(confidence) + '%';
  $('apply-detected').disabled = latestDetected.length === 0 || !currentState;
}

function normalizeText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function levenshtein(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const saved = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = saved;
    }
  }
  return row[b.length];
}

function findRosterNames(text, game) {
  const roster = rosterFor(game);
  const normalized = normalizeText(text);
  const compact = normalized.replace(/[^a-z]/g, '');
  const tokens = normalized.match(/[a-z]+/g) || [];
  const found = [];

  for (const champion of roster) {
    const key = normalizeText(champion).replace(/[^a-z]/g, '');
    let matched = key.length <= 3 ? tokens.includes(key) : compact.includes(key);
    if (!matched) {
      const maxDistance = key.length >= 8 ? 2 : key.length >= 5 ? 1 : 0;
      matched = tokens.some(token => token.length >= key.length - maxDistance
        && token.length <= key.length + maxDistance
        && levenshtein(token, key) <= maxDistance);
    }
    if (matched) found.push(champion);
  }
  // 2XKO muestra Point y Assist; GGST y MK11 un solo personaje.
  const teamSize = GAME_DETECT[game] ? GAME_DETECT[game].teamSize : 1;
  return found.slice(0, teamSize);
}

// Palabras clave de la pantalla de resultado por juego. Dos lecturas seguidas
// del mismo veredicto registran la partida (si el registro automático está activado).
function findResult(text, game) {
  const config = GAME_DETECT[game] || GAME_DETECT['2xko'];
  const compact = normalizeText(text).replace(/[^a-z]/g, '');
  if (!compact) return '';
  if (config.lossWords.some(word => compact.includes(word))) return 'loss';
  if (config.winWords.some(word => compact.includes(word))) return 'win';
  return '';
}

// MK11: el banner final muestra "ETIQUETA WINS". Compara con las etiquetas leídas
// en el HUD para atribuir la victoria o la derrota.
function tagKeyWords(tag) {
  return (normalizeText(tag).match(/[a-z0-9]+/g) || []).filter(token => token.length >= 4);
}

function findTagResult(text) {
  const compact = normalizeText(text).replace(/[^a-z0-9]/g, '');
  if (!compact) return '';
  if (compact.includes('defeat') || compact.includes('youlose')) return 'loss';
  if (!compact.includes('wins') && !compact.includes('victory')) return '';
  const ownHit = tagKeyWords(ownTag).some(token => compact.includes(token));
  const oppHit = tagKeyWords(oppTag).some(token => compact.includes(token));
  if (ownHit && !oppHit) return 'win';
  if (oppHit && !ownHit) return 'loss';
  return '';
}

function drawCrop(video, crop, canvas) {
  if (!video.videoWidth || !video.videoHeight || !canvas) return null;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.drawImage(video, crop.x * video.videoWidth, crop.y * video.videoHeight, crop.w * video.videoWidth, crop.h * video.videoHeight, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function activeGame() {
  return currentState ? currentState.selectedGame : $('game-select').value;
}

function detectConfig() {
  return GAME_DETECT[activeGame()] || GAME_DETECT['2xko'];
}

function prepareTeamCrop(side, canvas) {
  const video = $('capture-video');
  if (!video.videoWidth || !video.videoHeight) return null;
  return drawCrop(video, detectConfig().hud[side] || detectConfig().hud.left, canvas);
}

function prepareResultCrop() {
  const video = $('capture-video');
  if (!video.videoWidth || !video.videoHeight) return null;
  return drawCrop(video, detectConfig().result, $('result-crop-preview'));
}

function resetResultDebounce() {
  stableResult = '';
  stableResultCount = 0;
}

async function postDetectedCharacters(names) {
  const game = activeGame();
  const saved = await api('/api/detected-characters', { game, characters: names });
  lastUpdatedAt = saved.updatedAt;
  render(saved);
  showDetected(names, null);
  setDetectorStatus('Personajes reconocidos: ' + names.join(' + '), 'active');
  // Nuevo personaje en pantalla = nueva partida: reinicia el debounce de resultados.
  resetResultDebounce();
}

async function scanTeamFrame() {
  if (!ocrWorker) return;
  const game = activeGame();
  const config = detectConfig();
  const side = $('hud-side').value;
  const canvas = prepareTeamCrop(side, $('ocr-crop-preview'));
  if (!canvas) throw new Error('Esperando imagen de la ventana compartida…');
  const result = await ocrWorker.recognize(canvas);
  const text = (result && result.data && result.data.text) || '';
  const confidence = result && result.data ? result.data.confidence : undefined;
  $('ocr-text').textContent = text.trim() || '(No se reconoció texto en este recorte)';

  if (config.mode === 'tags') {
    const candidate = text.trim().replace(/\s+/g, ' ');
    if (candidate.length >= 3) {
      if (candidate === ownTag) ownTagCount += 1;
      else {
        ownTag = candidate;
        ownTagCount = 1;
      }
      setDetectorStatus(ownTagCount >= 2 ? 'Tu etiqueta: ' + candidate : 'Leyendo tu etiqueta…', 'scanning');
    }
    showDetected([], confidence);
    return;
  }

  const names = findRosterNames(text, game);
  showDetected(names, confidence);

  if (names.length) {
    const signature = names.join('|');
    if (signature === stableCandidate) stableCandidateCount += 1;
    else {
      stableCandidate = signature;
      stableCandidateCount = 1;
    }
    setDetectorStatus('Leyendo HUD… ' + names.join(' + '), 'scanning');
    if (stableCandidateCount >= 2 && signature !== lastPostedCandidate) {
      await postDetectedCharacters(names);
      lastPostedCandidate = signature;
    }
  } else {
    stableCandidate = '';
    stableCandidateCount = 0;
    setDetectorStatus('No se detectan personajes; comprueba el recorte y el lado.', 'scanning');
  }
}

async function scanOpponentFrame() {
  if (!ocrWorker) return;
  const game = activeGame();
  const config = detectConfig();
  const side = $('hud-side').value === 'left' ? 'right' : 'left';
  const canvas = prepareTeamCrop(side, $('ocr-opponent-preview'));
  if (!canvas) throw new Error('Esperando imagen de la ventana compartida…');
  const result = await ocrWorker.recognize(canvas);
  const text = (result && result.data && result.data.text) || '';
  const opponentText = $('opponent-text');
  if (opponentText) opponentText.textContent = text.trim() || '(Sin texto en el lado rival)';

  if (config.mode === 'tags') {
    const candidate = text.trim().replace(/\s+/g, ' ');
    if (candidate.length >= 3) {
      if (candidate === oppTag) oppTagCount += 1;
      else {
        oppTag = candidate;
        oppTagCount = 1;
      }
      if (oppTagCount >= 2 && oppTag !== lastPostedOpponent) {
        const saved = await api('/api/detected-characters', { game, opponents: [candidate] });
        lastUpdatedAt = saved.updatedAt;
        render(saved);
        lastPostedOpponent = oppTag;
        setDetectorStatus('Rival: ' + candidate, 'scanning');
      }
    }
    return;
  }

  const names = findRosterNames(text, game);
  if (names.length) {
    const signature = names.join('|');
    if (signature === stableOpponent) stableOpponentCount += 1;
    else {
      stableOpponent = signature;
      stableOpponentCount = 1;
    }
    if (stableOpponentCount >= 2 && signature !== lastPostedOpponent) {
      const saved = await api('/api/detected-characters', { game, opponents: names });
      lastUpdatedAt = saved.updatedAt;
      render(saved);
      lastPostedOpponent = signature;
      setDetectorStatus('Rivales reconocidos: ' + names.join(' + '), 'scanning');
    }
  } else {
    stableOpponent = '';
    stableOpponentCount = 0;
  }
}

async function scanResultFrame() {
  if (!ocrWorker) return;
  const game = activeGame();
  const config = detectConfig();
  const canvas = prepareResultCrop();
  if (!canvas) throw new Error('Esperando imagen de la ventana compartida…');
  const result = await ocrWorker.recognize(canvas);
  const text = (result && result.data && result.data.text) || '';
  const resultText = $('result-text');
  if (resultText) resultText.textContent = text.trim() || '(Sin texto en la zona de resultado)';
  const verdict = config.mode === 'tags' ? findTagResult(text) : findResult(text, game);
  if (!verdict) {
    const compact = normalizeText(text).replace(/[^a-z0-9]/g, '');
    if (config.mode === 'tags' && (compact.includes('wins') || compact.includes('victory'))) {
      setDetectorStatus('Pantalla de resultado sin atribuir: todavía no leí las etiquetas de los jugadores.', 'scanning');
    }
    resetResultDebounce();
    return;
  }
  if (verdict === stableResult) stableResultCount += 1;
  else {
    stableResult = verdict;
    stableResultCount = 1;
  }
  if (stableResultCount < 2) {
    setDetectorStatus('Posible resultado en pantalla: ' + (verdict === 'win' ? 'VICTORIA' : 'DERROTA') + '…', 'scanning');
    return;
  }
  if (Date.now() - lastAutoResultAt < RESULT_COOLDOWN_MS) return;
  lastAutoResultAt = Date.now();
  resetResultDebounce();
  if (!currentState || currentState.autoRecord === false) {
    setDetectorStatus('Resultado detectado (' + (verdict === 'win' ? 'VICTORIA' : 'DERROTA') + ') pero el registro automático está apagado.', 'scanning');
    return;
  }
  try {
    const saved = await api('/api/result', { result: verdict, source: 'auto' });
    lastUpdatedAt = saved.updatedAt;
    render(saved);
    setDetectorStatus('Resultado registrado automáticamente: ' + (verdict === 'win' ? 'VICTORIA ✓' : 'DERROTA ✕'), 'active');
  } catch (error) {
    setDetectorStatus('No se pudo registrar el resultado automático: ' + error.message, 'error');
  }
}

async function scanFrame() {
  if (!detectorRunning || !ocrWorker) return;
  const phase = SCAN_PHASES[scanPhaseIndex % SCAN_PHASES.length];
  scanPhaseIndex += 1;
  try {
    if (phase === 'team') await scanTeamFrame();
    else if (phase === 'opponents') await scanOpponentFrame();
    else await scanResultFrame();
  } catch (error) {
    setDetectorStatus(error.message || 'No se pudo leer la pantalla.', 'error');
  } finally {
    if (detectorRunning) scanTimer = window.setTimeout(scanFrame, 1800);
  }
}

async function stopDetector(message) {
  detectorRunning = false;
  if (scanTimer) window.clearTimeout(scanTimer);
  scanTimer = null;
  scanPhaseIndex = 0;
  stableCandidate = '';
  stableCandidateCount = 0;
  lastPostedCandidate = '';
  stableOpponent = '';
  stableOpponentCount = 0;
  lastPostedOpponent = '';
  stableResult = '';
  stableResultCount = 0;
  ownTag = '';
  ownTagCount = 0;
  oppTag = '';
  oppTagCount = 0;
  if (captureStream) {
    captureStream.getTracks().forEach(track => track.stop());
    captureStream = null;
  }
  $('capture-video').srcObject = null;
  if (ocrWorker) {
    try { await ocrWorker.terminate(); } catch (error) { console.warn('OCR worker:', error); }
    ocrWorker = null;
  }
  $('start-detection').hidden = false;
  $('stop-detection').hidden = true;
  setDetectorStatus(message || 'Detector apagado', 'idle');
}

async function startDetector() {
  if (detectorRunning || captureStream) return;
  const game = $('game-select').value;
  if (!currentState || !GAME_DETECT[game]) {
    setDetectorStatus('Selecciona y guarda un juego válido.', 'error');
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    setDetectorStatus('Este navegador no permite compartir pantalla. Abre el panel en Chrome o Edge.', 'error');
    return;
  }
  if (!window.Tesseract || !window.Tesseract.createWorker) {
    setDetectorStatus('No se pudo cargar el motor OCR. Comprueba tu conexión e inténtalo otra vez.', 'error');
    return;
  }

  try {
    setDetectorStatus('Selecciona la ventana de ' + (GAME_NAMES[game] || 'tu juego') + ' en el cuadro del navegador…', 'scanning');
    captureStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 5, max: 10 } },
      audio: false
    });
    const video = $('capture-video');
    video.srcObject = captureStream;
    await video.play();
    if (!video.videoWidth) await new Promise(resolve => video.addEventListener('loadedmetadata', resolve, { once: true }));

    detectorRunning = true;
    $('start-detection').hidden = true;
    $('stop-detection').hidden = false;
    scanPhaseIndex = 0;
    stableCandidate = '';
    stableCandidateCount = 0;
    lastPostedCandidate = '';
    stableOpponent = '';
    stableOpponentCount = 0;
    lastPostedOpponent = '';
    stableResult = '';
    stableResultCount = 0;
    ownTag = '';
    ownTagCount = 0;
    oppTag = '';
    oppTagCount = 0;
    setDetectorStatus('Preparando OCR en el navegador…', 'scanning');
    ocrWorker = await window.Tesseract.createWorker('eng', 1, {
      logger: message => {
        if (message.status === 'recognizing text') {
          setDetectorStatus('Analizando pantalla… ' + Math.round((message.progress || 0) * 100) + '%', 'scanning');
        } else if (message.status) {
          setDetectorStatus('Preparando OCR: ' + message.status, 'scanning');
        }
      }
    });
    await ocrWorker.setParameters({
      tessedit_pageseg_mode: '6',
      preserve_interword_spaces: '1',
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz 0123456789\'.-'
    });
    const track = captureStream.getVideoTracks()[0];
    if (track) track.addEventListener('ended', () => {
      stopDetector('La captura de pantalla se detuvo.');
    }, { once: true });
    setDetectorStatus('Detector activo: personajes, rivales y resultados se leen automáticamente.', 'active');
    scanFrame();
  } catch (error) {
    await stopDetector(error.name === 'NotAllowedError' ? 'Permiso de captura cancelado.' : 'No se pudo iniciar: ' + error.message);
  }
}

async function applyDetectedAsMains() {
  if (!latestDetected.length || !currentState) return;
  $('mains-input').value = latestDetected.join(', ');
  syncMainPicker(latestDetected);
  await saveProfile();
}

$('save-profile').addEventListener('click', saveProfile);
$('main-picker').addEventListener('click', event => {
  const button = event.target.closest('.fighter-option');
  if (button) toggleMainPickerCharacter(button.dataset.name);
});
$('mains-input').addEventListener('input', () => {
  syncMainPicker(currentMainsFromInput());
  const count = currentMainsFromInput().length;
  $('picker-hint').textContent = count + '/3 personajes reconocidos en la lista.';
});
$('save-appearance').addEventListener('click', saveAppearance);
$('auto-record-toggle').addEventListener('change', saveAutomation);
$('auto-apply-toggle').addEventListener('change', saveAutomation);
$('add-win').addEventListener('click', () => addResult('win'));
$('add-loss').addEventListener('click', () => addResult('loss'));
$('undo-last').addEventListener('click', undoLast);
$('reset-stats').addEventListener('click', resetStats);
$('start-detection').addEventListener('click', startDetector);
$('stop-detection').addEventListener('click', () => stopDetector());
$('apply-detected').addEventListener('click', applyDetectedAsMains);
$('hud-side').addEventListener('change', () => {
  stableCandidate = '';
  stableCandidateCount = 0;
  lastPostedCandidate = '';
  stableOpponent = '';
  stableOpponentCount = 0;
  lastPostedOpponent = '';
  resetResultDebounce();
  ownTag = '';
  ownTagCount = 0;
  oppTag = '';
  oppTagCount = 0;
});
$('game-select').addEventListener('change', () => {
  const game = $('game-select').value;
  if (detectorRunning) stopDetector('Detección detenida: cambiaste de juego.');
  if (currentState) $('mains-input').value = currentState.profiles[game].mains.join(', ');
  renderMainPicker(currentMainsFromInput());
  syncMainPicker(currentMainsFromInput());
  $('apply-detected').disabled = latestDetected.length === 0;
});
$('scale-range').addEventListener('input', () => $('scale-output').value = $('scale-range').value + '%');
$('opacity-range').addEventListener('input', () => $('opacity-output').value = $('opacity-range').value + '%');
window.addEventListener('beforeunload', () => {
  if (captureStream) captureStream.getTracks().forEach(track => track.stop());
  if (ocrWorker) ocrWorker.terminate();
});

refresh();
setInterval(refresh, 700);