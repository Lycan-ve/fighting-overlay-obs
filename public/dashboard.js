'use strict';

const $ = id => document.getElementById(id);
let currentState = null;
let lastUpdatedAt = 0;
let captureStream = null;
let ocrWorker = null;
let detectorRunning = false;
let scanTimer = null;
let stableCandidate = '';
let stableCandidateCount = 0;
let lastPostedCandidate = '';
let latestDetected = [];
const GAME_NAMES = { '2xko': '2XKO', mk1: 'MORTAL KOMBAT 1', ggst: 'GUILTY GEAR STRIVE' };
const FIGHTER_ASSET_BASE = 'https://raw.githubusercontent.com/Lycan-ve/Hot-Coffee-Frontend/master/public/fighters/';

// Roster jugable consultado en la galería oficial y en las notas del parche 1.3.3.
const CHAMPIONS = [
  'Ahri', 'Akali', 'Blitzcrank', 'Braum', 'Caitlyn', 'Darius', 'Ekko', 'Illaoi',
  'Jinx', 'Lux', 'Samira', 'Senna', 'Sett', 'Teemo', 'Thresh', 'Vi', 'Warwick', 'Yasuo'
];

function winRate(profile) {
  const total = profile.wins + profile.losses;
  return total ? Math.round(profile.wins / total * 100) : 0;
}

function streakText(value) {
  if (!value) return '—';
  return value > 0 ? `W${value}` : `L${Math.abs(value)}`;
}

function setValueUnlessFocused(id, value) {
  if (document.activeElement !== $(id)) $(id).value = value;
}

function fighterAssetUrl(name) {
  if (!CHAMPIONS.includes(name)) return '';
  return `${FIGHTER_ASSET_BASE}${encodeURIComponent(name)}.png`;
}

function createFighterChip(name, className) {
  const chip = document.createElement('span');
  chip.className = className;
  const image = document.createElement('img');
  image.className = 'fighter-chip-image';
  image.src = fighterAssetUrl(name);
  image.alt = '';
  image.loading = 'lazy';
  image.decoding = 'async';
  image.onerror = () => { image.remove(); chip.classList.add('portrait-fallback'); };
  const label = document.createElement('span');
  label.textContent = name;
  chip.append(image, label);
  return chip;
}

function makeChips(container, names, className, emptyLabel) {
  container.replaceChildren();
  const values = names && names.length ? names : [];
  if (!values.length) {
    const empty = document.createElement('span');
    empty.className = 'detected-empty';
    empty.textContent = emptyLabel;
    container.append(empty);
    return;
  }
  for (const name of values) container.append(createFighterChip(name, className));
}

function currentMainsFromInput() {
  return $('mains-input').value.split(',').map(name => name.trim()).filter(name => CHAMPIONS.includes(name)).slice(0, 3);
}

function renderMainPicker(selectedNames = []) {
  const picker = $('main-picker');
  if (!picker) return;
  picker.replaceChildren();
  for (const name of CHAMPIONS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'fighter-option';
    button.dataset.name = name;
    button.setAttribute('aria-pressed', String(selectedNames.includes(name)));
    button.title = name;
    const image = document.createElement('img');
    image.src = fighterAssetUrl(name);
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.onerror = () => { image.remove(); button.classList.add('portrait-fallback'); };
    const label = document.createElement('span');
    label.textContent = name;
    button.append(image, label);
    picker.append(button);
  }
}

function syncMainPicker(names = currentMainsFromInput()) {
  const selected = new Set(names);
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
  $('picker-hint').textContent = selected.length ? `${selected.length}/3 personajes seleccionados.` : 'Selecciona hasta tres personajes. También puedes escribir sus nombres arriba.';
  syncMainPicker(selected);
}

function render(state) {
  currentState = state;
  const profile = state.profiles[state.selectedGame];
  setValueUnlessFocused('player-name-input', state.playerName);
  setValueUnlessFocused('game-select', state.selectedGame);
  setValueUnlessFocused('mains-input', profile.mains.join(', '));
  $('main-picker-wrap').hidden = state.selectedGame !== '2xko';
  renderMainPicker(currentMainsFromInput());
  $('picker-hint').textContent = profile.mains.length ? `${profile.mains.length}/3 personajes seleccionados.` : 'Selecciona hasta tres personajes. También puedes escribir sus nombres arriba.';
  $('position-select').value = state.position;
  $('scale-range').value = Math.round(state.scale * 100);
  $('opacity-range').value = state.opacity;
  $('scale-output').value = `${Math.round(state.scale * 100)}%`;
  $('opacity-output').value = `${state.opacity}%`;
  $('summary-wins').textContent = profile.wins;
  $('summary-losses').textContent = profile.losses;
  $('summary-rate').textContent = `${winRate(profile)}%`;
  $('summary-streak').textContent = streakText(profile.streak);

  $('preview-game').textContent = `${GAME_NAMES[state.selectedGame]} · RÉCORD DE SESIÓN`;
  $('preview-player').textContent = state.playerName;
  $('preview-wins').textContent = profile.wins;
  $('preview-losses').textContent = profile.losses;
  $('preview-rate').innerHTML = `${winRate(profile)}<span class="percent">%</span>`;
  makeChips($('preview-mains'), profile.mains, 'main-chip', 'Sin configurar');

  const detectedFresh = Array.isArray(profile.detectedCharacters)
    && profile.detectedCharacters.length > 0
    && profile.detectedAt
    && Date.now() - profile.detectedAt < 45000;
  $('preview-team-row').hidden = !detectedFresh || state.selectedGame !== '2xko';
  if (!$('preview-team-row').hidden) makeChips($('preview-team-chips'), profile.detectedCharacters, 'detected-chip', '');

  const streak = $('preview-streak');
  if (profile.streak) {
    streak.hidden = false;
    streak.textContent = profile.streak > 0 ? `↗ ${profile.streak} W` : `↘ ${Math.abs(profile.streak)} L`;
  } else streak.hidden = true;

  const mount = $('preview-mount');
  mount.style.opacity = String(state.opacity / 100);
  const card = mount.querySelector('.preview-card');
  card.style.transform = `scale(${0.27 * state.scale})`;
  card.classList.toggle('position-bottom-center', state.position === 'bottom-center');
  card.style.transformOrigin = state.position === 'bottom-center' ? 'bottom center' : (state.position.endsWith('left') ? 'top left' : 'top right');
  card.style.top = state.position.startsWith('top') ? '14.5%' : 'auto';
  card.style.bottom = state.position.startsWith('bottom') ? '3%' : 'auto';
  card.style.left = state.position === 'bottom-center' ? '50%' : (state.position.endsWith('left') ? '2%' : 'auto');
  if (state.position === 'bottom-center') card.style.marginLeft = '-440px'; else card.style.marginLeft = '0';
  card.style.right = state.position.endsWith('right') ? '2%' : 'auto';

  if (profile.detectedCharacters?.length && profile.detectedAt) {
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

async function resetStats() {
  const game = currentState?.selectedGame;
  if (!game || !window.confirm(`¿Reiniciar victorias, derrotas y racha de ${GAME_NAMES[game]}?`)) return;
  try {
    const saved = await api('/api/reset', { game });
    lastUpdatedAt = saved.updatedAt;
    render(saved);
    $('save-message').textContent = 'Estadísticas reiniciadas.';
  } catch (error) {
    $('save-message').textContent = error.message;
  }
}

function setDetectorStatus(message, state = 'idle') {
  const target = $('detector-status');
  target.replaceChildren();
  const dot = document.createElement('span');
  dot.className = `status-dot detector-dot-${state}`;
  const text = document.createElement('span');
  text.textContent = message;
  target.append(dot, text);
}

function showDetected(names, confidence) {
  latestDetected = names || [];
  makeChips($('detected-list'), latestDetected, 'detected-chip', 'No se reconocen campeones todavía');
  $('detected-confidence').textContent = confidence == null ? 'LECTURA GUARDADA' : `OCR ${Math.round(confidence)}%`;
  $('apply-detected').disabled = latestDetected.length === 0 || currentState?.selectedGame !== '2xko';
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

function findChampionNames(text) {
  const normalized = normalizeText(text);
  const compact = normalized.replace(/[^a-z]/g, '');
  const tokens = normalized.match(/[a-z]+/g) || [];
  const found = [];

  for (const champion of CHAMPIONS) {
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
  // El HUD de 2XKO muestra primero el Point y luego el Assist. Limita el equipo a dos nombres.
  return found.slice(0, 2);
}

function getHudCrop(video) {
  const width = video.videoWidth;
  const height = video.videoHeight;
  const side = $('hud-side').value;
  const sourceX = side === 'left' ? 0.105 : 0.65;
  const sourceY = 0.058;
  const sourceW = 0.335;
  const sourceH = 0.084;
  return {
    sx: Math.round(width * sourceX),
    sy: Math.round(height * sourceY),
    sw: Math.round(width * sourceW),
    sh: Math.round(height * sourceH)
  };
}

function prepareCrop() {
  const video = $('capture-video');
  if (!video.videoWidth || !video.videoHeight) return null;
  const crop = getHudCrop(video);
  const canvas = $('ocr-crop-preview');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function postDetectedCharacters(names) {
  const saved = await api('/api/detected-characters', { game: '2xko', characters: names });
  lastUpdatedAt = saved.updatedAt;
  render(saved);
  showDetected(names, null);
  setDetectorStatus(`Equipo reconocido: ${names.join(' + ')}`, 'active');
}

async function scanFrame() {
  if (!detectorRunning || !ocrWorker) return;
  try {
    const canvas = prepareCrop();
    if (!canvas) throw new Error('Esperando imagen de la ventana compartida…');
    const result = await ocrWorker.recognize(canvas);
    const text = result?.data?.text || '';
    const confidence = result?.data?.confidence;
    $('ocr-text').textContent = text.trim() || '(No se reconoció texto en este recorte)';
    const names = findChampionNames(text);
    showDetected(names, confidence);

    if (names.length) {
      const signature = names.join('|');
      if (signature === stableCandidate) stableCandidateCount += 1;
      else {
        stableCandidate = signature;
        stableCandidateCount = 1;
      }
      setDetectorStatus(`Leyendo HUD… ${names.join(' + ')}`, 'scanning');
      if (stableCandidateCount >= 2 && signature !== lastPostedCandidate) {
        await postDetectedCharacters(names);
        lastPostedCandidate = signature;
      }
    } else {
      stableCandidate = '';
      stableCandidateCount = 0;
      setDetectorStatus('No se detectan campeones; comprueba el recorte y el lado.', 'scanning');
    }
  } catch (error) {
    setDetectorStatus(error.message || 'No se pudo leer el HUD.', 'error');
  } finally {
    if (detectorRunning) scanTimer = window.setTimeout(scanFrame, 2400);
  }
}

async function stopDetector(message = 'Detector apagado') {
  detectorRunning = false;
  if (scanTimer) window.clearTimeout(scanTimer);
  scanTimer = null;
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
  setDetectorStatus(message, 'idle');
}

async function startDetector() {
  if (detectorRunning || captureStream) return;
  if (!currentState || currentState.selectedGame !== '2xko' || $('game-select').value !== '2xko') {
    setDetectorStatus('Selecciona y guarda 2XKO como juego activo.', 'error');
    return;
  }
  if (!navigator.mediaDevices?.getDisplayMedia) {
    setDetectorStatus('Este navegador no permite compartir pantalla. Abre el panel en Chrome o Edge.', 'error');
    return;
  }
  if (!window.Tesseract?.createWorker) {
    setDetectorStatus('No se pudo cargar el motor OCR. Comprueba tu conexión e inténtalo otra vez.', 'error');
    return;
  }

  try {
    setDetectorStatus('Selecciona la ventana de 2XKO en el cuadro del navegador…', 'scanning');
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
    stableCandidate = '';
    stableCandidateCount = 0;
    lastPostedCandidate = '';
    setDetectorStatus('Preparando OCR en el navegador…', 'scanning');
    ocrWorker = await window.Tesseract.createWorker('eng', 1, {
      logger: message => {
        if (message.status === 'recognizing text') {
          setDetectorStatus(`Analizando HUD… ${Math.round((message.progress || 0) * 100)}%`, 'scanning');
        } else if (message.status) {
          setDetectorStatus(`Preparando OCR: ${message.status}`, 'scanning');
        }
      }
    });
    await ocrWorker.setParameters({
      tessedit_pageseg_mode: '6',
      preserve_interword_spaces: '1',
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz '
    });
    captureStream.getVideoTracks()[0]?.addEventListener('ended', () => {
      stopDetector('La captura de pantalla se detuvo.');
    }, { once: true });
    setDetectorStatus('Detector activo. Mantén visible la ventana de 2XKO.', 'active');
    scanFrame();
  } catch (error) {
    await stopDetector(error.name === 'NotAllowedError' ? 'Permiso de captura cancelado.' : `No se pudo iniciar: ${error.message}`);
  }
}

async function applyDetectedAsMains() {
  if (!latestDetected.length || !currentState || currentState.selectedGame !== '2xko') return;
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
  $('picker-hint').textContent = `${count}/3 personajes reconocidos en la lista.`;
});
$('save-appearance').addEventListener('click', saveAppearance);
$('add-win').addEventListener('click', () => addResult('win'));
$('add-loss').addEventListener('click', () => addResult('loss'));
$('reset-stats').addEventListener('click', resetStats);
$('start-detection').addEventListener('click', startDetector);
$('stop-detection').addEventListener('click', () => stopDetector());
$('apply-detected').addEventListener('click', applyDetectedAsMains);
$('hud-side').addEventListener('change', () => {
  stableCandidate = '';
  stableCandidateCount = 0;
  lastPostedCandidate = '';
});
$('game-select').addEventListener('change', () => {
  const game = $('game-select').value;
  if (game !== '2xko' && detectorRunning) stopDetector('Detección detenida: 2XKO ya no es el juego seleccionado.');
  if (currentState) $('mains-input').value = currentState.profiles[game].mains.join(', ');
  $('main-picker-wrap').hidden = game !== '2xko';
  syncMainPicker(currentMainsFromInput());
  $('apply-detected').disabled = game !== '2xko' || latestDetected.length === 0;
});
$('scale-range').addEventListener('input', () => $('scale-output').value = `${$('scale-range').value}%`);
$('opacity-range').addEventListener('input', () => $('opacity-output').value = `${$('opacity-range').value}%`);
window.addEventListener('beforeunload', () => {
  if (captureStream) captureStream.getTracks().forEach(track => track.stop());
  if (ocrWorker) ocrWorker.terminate();
});

refresh();
setInterval(refresh, 700);
