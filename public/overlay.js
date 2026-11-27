'use strict';

const el = id => document.getElementById(id);
const FIGHTER_ASSET_BASE = 'https://raw.githubusercontent.com/Lycan-ve/Hot-Coffee-Frontend/master/public/fighters/';
const FIGHTERS = new Set(['Ahri','Akali','Blitzcrank','Braum','Caitlyn','Darius','Ekko','Illaoi','Jinx','Lux','Samira','Senna','Sett','Teemo','Thresh','Vi','Warwick','Yasuo']);

function gameName(game) {
  return ({ '2xko': '2XKO', mk1: 'MORTAL KOMBAT 1', ggst: 'GUILTY GEAR STRIVE' })[game] || 'FIGHTING GAME';
}

function rate(profile) {
  const total = profile.wins + profile.losses;
  return total ? Math.round((profile.wins / total) * 100) : 0;
}

function appendChips(container, values, className) {
  container.replaceChildren();
  for (const value of values) {
    const chip = document.createElement('span');
    chip.className = className;
    if (FIGHTERS.has(value)) {
      const image = document.createElement('img');
      image.className = 'fighter-chip-image';
      image.src = FIGHTER_ASSET_BASE + encodeURIComponent(value) + '.png';
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.onerror = () => { image.remove(); chip.classList.add('portrait-fallback'); };
      chip.append(image);
    }
    const label = document.createElement('span');
    label.textContent = value;
    chip.append(label);
    container.append(chip);
  }
}

function render(state) {
  const profile = state.profiles[state.selectedGame];
  if (!profile) return;

  const overlay = el('overlay');
  overlay.className = 'overlay-card position-' + (state.position || 'top-right') + ' theme-' + (state.selectedGame || '2xko');
  overlay.style.transform = 'scale(' + (Number.isFinite(state.scale) ? state.scale : 0.9) + ')';
  overlay.style.opacity = String((Number.isFinite(state.opacity) ? state.opacity : 94) / 100);
  el('player-name').textContent = state.playerName || 'PLAYER';
  el('game-label').textContent = gameName(state.selectedGame) + ' · RÉCORD DE SESIÓN';
  el('wins').textContent = profile.wins;
  el('losses').textContent = profile.losses;
  el('win-rate').innerHTML = rate(profile) + '<span class="percent">%</span>';
  appendChips(el('mains-list'), profile.mains.length ? profile.mains : ['Sin configurar'], 'main-chip');

  const streak = el('streak-pill');
  if (profile.streak !== 0) {
    streak.hidden = false;
    streak.textContent = profile.streak > 0 ? '↗ ' + profile.streak + ' W' : '↘ ' + Math.abs(profile.streak) + ' L';
    streak.style.color = profile.streak > 0 ? '#83e1bc' : '#ff9298';
    streak.style.borderColor = profile.streak > 0 ? 'rgba(131,225,188,.28)' : 'rgba(255,146,152,.28)';
    streak.style.background = profile.streak > 0 ? 'rgba(131,225,188,.12)' : 'rgba(255,146,152,.12)';
  } else {
    streak.hidden = true;
  }

  const isDetectionFresh = Array.isArray(profile.detectedCharacters)
    && profile.detectedCharacters.length > 0
    && profile.detectedAt
    && Date.now() - profile.detectedAt < 45000;
  const detectedRow = el('team-detected-row');
  detectedRow.hidden = !isDetectionFresh || state.selectedGame !== '2xko';
  if (!detectedRow.hidden) appendChips(el('detected-chips'), profile.detectedCharacters, 'detected-chip');

  const opponentsFresh = Array.isArray(profile.detectedOpponents)
    && profile.detectedOpponents.length > 0
    && profile.detectedOpponentsAt
    && Date.now() - profile.detectedOpponentsAt < 45000;
  const opponentsRow = el('team-opponents-row');
  opponentsRow.hidden = !opponentsFresh || state.selectedGame !== '2xko';
  if (!opponentsRow.hidden) appendChips(el('opponents-chips'), profile.detectedOpponents, 'detected-chip');

  const toast = el('result-toast');
  const result = state.lastResult;
  if (result && result.game === state.selectedGame && Date.now() - result.at < 3500) {
    toast.hidden = false;
    toast.className = 'result-toast ' + result.result;
    toast.textContent = result.result === 'win' ? '✓ VICTORIA' : '✕ DERROTA';
  } else {
    toast.hidden = true;
  }
}

async function refresh() {
  try {
    const response = await fetch('/api/state', { cache: 'no-store' });
    if (!response.ok) throw new Error('No se pudo consultar el marcador');
    render(await response.json());
  } catch (error) {
    console.warn(error.message);
  }
}

refresh();
setInterval(refresh, 650);