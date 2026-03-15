// ============================================================
// 射龍門 — Client Application
// ============================================================

const socket = io();

// ── State ─────────────────────────────────────────────────
let myId = null;
let currentState = null;
let selectedGuess = null;
let lastSeenSkills = [];

// ── DOM References ────────────────────────────────────────
const lobbyView = document.getElementById('lobby-view');
const gameView = document.getElementById('game-view');
const panelMainMenu = document.getElementById('panel-main-menu');
const panelJoin = document.getElementById('panel-join');
const panelRoom = document.getElementById('panel-room');
const playerNameInput = document.getElementById('player-name');
const roomCodeInput = document.getElementById('room-code-input');
const displayRoomCode = document.getElementById('display-room-code');
const lobbyPlayerList = document.getElementById('lobby-player-list');
const btnStart = document.getElementById('btn-start');
const waitingText = document.getElementById('waiting-text');
const roundBadge = document.getElementById('round-badge');
const potAmount = document.getElementById('pot-amount');
const playerSidebar = document.getElementById('player-sidebar');
const gateCard1Slot = document.getElementById('gate-card-1');
const gateCard2Slot = document.getElementById('gate-card-2');
const thirdCardSlot = document.getElementById('third-card-slot');
const actionSection = document.getElementById('action-section');
const resultDisplay = document.getElementById('result-display');
const resultText = document.getElementById('result-text');
const statusMessage = document.getElementById('status-message');
const gameOverOverlay = document.getElementById('game-over-overlay');
const winnerText = document.getElementById('winner-text');
const finalStandings = document.getElementById('final-standings');
const btnRestart = document.getElementById('btn-restart');
const btnBackLobby = document.getElementById('btn-back-lobby');
const btnEarlySettle = document.getElementById('btn-early-settle');
const btnSkillStore = document.getElementById('btn-skill-store');
const skillStoreOverlay = document.getElementById('skill-store-overlay');
const btnCloseStore = document.getElementById('btn-close-store');
const storeBalance = document.getElementById('store-balance');
const skillsList = document.getElementById('skills-list');
const replaceSkillOverlay = document.getElementById('replace-skill-overlay');
const replaceRankGrid = document.getElementById('replace-rank-grid');

// ── Avatar Colors ─────────────────────────────────────────
const AVATAR_COLORS = [
  '#fbbf24', '#34d399', '#60a5fa', '#f87171', '#a78bfa',
  '#fb923c', '#2dd4bf', '#818cf8', '#f472b6', '#facc15'
];

// ── Skills Configuration ────────────────────────────────────
const SKILL_CONFIG = {
  obscure: { levels: [1, 2, 3], costs: [50, 100, 150], chances: [0.05, 0.075, 0.10], name: '門牌遮蔽', desc: '在對手回合時，有機率隱藏其第二張門牌' },
  replace: { levels: [1, 2, 3], costs: [100, 150, 200], chances: [0.05, 0.075, 0.10], name: '門牌替換', desc: '在所有回合時，有機率替換第二張門牌' },
  steal:   { levels: [1, 2, 3], costs: [100, 150, 200], chances: [0.05, 0.075, 0.10], name: '偷錢', desc: '在對手贏得獎池時，有機率偷取其 30% 獲利' }
};

// ── Lobby Events ──────────────────────────────────────────
document.getElementById('btn-create').addEventListener('click', () => {
  const name = playerNameInput.value.trim();
  if (!name) return showToast('請輸入暱稱', true);
  socket.emit('create-room', name);
});

document.getElementById('btn-show-join').addEventListener('click', () => {
  const name = playerNameInput.value.trim();
  if (!name) return showToast('請輸入暱稱', true);
  panelMainMenu.classList.add('hidden');
  panelJoin.classList.remove('hidden');
  roomCodeInput.focus();
});

document.getElementById('btn-back').addEventListener('click', () => {
  panelJoin.classList.add('hidden');
  panelMainMenu.classList.remove('hidden');
});

document.getElementById('btn-join').addEventListener('click', () => {
  const name = playerNameInput.value.trim();
  const code = roomCodeInput.value.trim().toUpperCase();
  if (!name) return showToast('請輸入暱稱', true);
  if (!code || code.length !== 4) return showToast('請輸入 4 位房間代碼', true);
  socket.emit('join-room', { code, playerName: name });
});

roomCodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-join').click();
});

playerNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-create').click();
});

document.getElementById('btn-save-settings').addEventListener('click', () => {
  const entryFee = parseInt(document.getElementById('setting-entry-fee').value) || 10;
  const startingMoney = parseInt(document.getElementById('setting-starting-money').value) || 500;
  const mode = document.getElementById('setting-game-mode').value;
  socket.emit('update-settings', { entryFee, startingMoney, mode });
  showToast('設定已儲存！');
});

btnStart.addEventListener('click', () => {
  socket.emit('start-game');
});

btnRestart.addEventListener('click', () => {
  socket.emit('restart-game');
});

btnBackLobby.addEventListener('click', () => {
  location.reload();
});

btnEarlySettle.addEventListener('click', () => {
  socket.emit('request-settle');
  showToast('已申請提早結算，本輪結束後將進行結算');
});

btnSkillStore.addEventListener('click', () => {
  skillStoreOverlay.classList.remove('hidden');
  renderSkillStore();
});

btnCloseStore.addEventListener('click', () => {
  skillStoreOverlay.classList.add('hidden');
});

// ── Socket Events ─────────────────────────────────────────
socket.on('connect', () => {
  myId = socket.id;
});

socket.on('room-created', (code) => {
  showRoomPanel(code);
});

socket.on('room-joined', (code) => {
  showRoomPanel(code);
});

socket.on('game-state', (state) => {
  currentState = state;
  if (state.phase === 'lobby') {
    renderLobbyPlayers(state);
  } else {
    showGameView();
    renderGame(state);
    
    // Live update the store balance/skills if it's currently open
    if (!skillStoreOverlay.classList.contains('hidden')) {
      renderSkillStore();
    }

    // Show toast notifications for newly activated skills
    if (state.activeSkills && state.activeSkills.length > 0) {
      state.activeSkills.forEach(s => {
        const hash = `${state.roundNumber}-${state.phase}-${s.playerId}-${s.skill}-${s.message || ''}`;
        if (!lastSeenSkills.includes(hash)) {
          lastSeenSkills.push(hash);
          showToast(`⚡ ${s.playerName} 發動了【${s.skill}】${s.message ? ' : ' + s.message : ''}`);
        }
      });
    } else if (state.phase === 'betting' || state.phase === 'choosing' || ['revealing', 'gameOver'].includes(state.phase)) {
      // clear when skills array is empty
      if (!state.activeSkills || state.activeSkills.length === 0) {
          lastSeenSkills = [];
      }
    }
  }
});

socket.on('error-msg', (msg) => {
  showToast(msg, true);
});

socket.on('skill-bought', (data) => {
  if (data.playerId === myId) {
    showToast(`成功購買/升級【${data.name}】至 Lv.${data.newLevel}`);
    if (!skillStoreOverlay.classList.contains('hidden')) {
      renderSkillStore();
    }
  } else {
    showToast(`【${data.playerName}】購買了技能【${data.name}】`);
  }
});

// ── Lobby Rendering ───────────────────────────────────────
function showRoomPanel(code) {
  panelMainMenu.classList.add('hidden');
  panelJoin.classList.add('hidden');
  panelRoom.classList.remove('hidden');
  displayRoomCode.textContent = code;
}

function renderLobbyPlayers(state) {
  lobbyPlayerList.innerHTML = '';
  state.players.forEach((p, i) => {
    const div = document.createElement('div');
    div.className = 'player-item';
    div.innerHTML = `
      <div class="player-avatar" style="background:${AVATAR_COLORS[i % AVATAR_COLORS.length]}">${p.name[0]}</div>
      <span class="player-name">${escapeHtml(p.name)}</span>
      ${p.isHost ? '<span class="player-badge">房主</span>' : ''}
    `;
    lobbyPlayerList.appendChild(div);
  });

  // Update dynamic room info
  if (state.entryFee != null) {
    document.getElementById('display-entry-fee').textContent = state.entryFee;
  }
  if (state.startingMoney != null) {
    document.getElementById('display-starting-money').textContent = state.startingMoney;
  }
  if (state.mode) {
    document.getElementById('display-room-mode').textContent = state.mode === 'special' ? '特殊模式' : '一般模式';
  }

  const isHost = state.players.find(p => p.id === myId)?.isHost;
  
  if (isHost && state.players.length >= 2) {
    btnStart.classList.remove('hidden');
    waitingText.classList.add('hidden');
  } else if (isHost) {
    btnStart.classList.add('hidden');
    waitingText.textContent = '等待更多玩家加入...';
    waitingText.classList.remove('hidden');
  } else {
    btnStart.classList.add('hidden');
    waitingText.textContent = '等待房主開始遊戲...';
    waitingText.classList.remove('hidden');
  }

  // Show settings input for host, read-only info for guests
  const hostSettingsDiv = document.getElementById('host-settings');
  const roomInfoDisplay = document.getElementById('room-info-display');
  if (isHost) {
    hostSettingsDiv.classList.remove('hidden');
    roomInfoDisplay.classList.add('hidden');
    document.getElementById('setting-entry-fee').value = state.entryFee || 10;
    document.getElementById('setting-starting-money').value = state.startingMoney || 500;
    document.getElementById('setting-game-mode').value = state.mode || 'normal';
  } else {
    hostSettingsDiv.classList.add('hidden');
    roomInfoDisplay.classList.remove('hidden');
  }
}

// ── Game View ─────────────────────────────────────────────
function showGameView() {
  lobbyView.classList.remove('active');
  gameView.classList.add('active');
}

function renderGame(state) {
  // Update Header
  document.getElementById('round-badge').textContent = `第 ${state.roundNumber} 輪`;
  document.getElementById('game-room-mode-badge').textContent = state.mode === 'special' ? '特殊模式' : '一般模式';
  document.getElementById('game-room-code-badge').textContent = `代碼: ${state.code}`;
  potAmount.textContent = state.pot;
  
  if (state.mode === 'special') {
      btnSkillStore.classList.remove('hidden');
  } else {
      btnSkillStore.classList.add('hidden');
  }

  const isHost = state.players.find(p => p.id === myId)?.isHost;
  if (isHost && !state.pendingSettlement) {
    btnEarlySettle.classList.remove('hidden');
    btnEarlySettle.textContent = '💳 提早結算';
    btnEarlySettle.disabled = false;
  } else if (isHost && state.pendingSettlement) {
    btnEarlySettle.classList.remove('hidden');
    btnEarlySettle.textContent = '⏳ 回合結束時結算';
    btnEarlySettle.disabled = true;
  } else {
    btnEarlySettle.classList.add('hidden');
  }

  // Sidebar
  renderSidebar(state);

  // Cards
  renderCards(state);

  // Actions / Status
  if (state.phase === 'gameOver') {
    replaceSkillOverlay.classList.add('hidden');
    showGameOver(state);
  } else if (state.phase === 'skill-replace') {
    renderReplaceSkillPhase(state);
  } else if (state.phase === 'revealing' || state.phase === 'consecutive') {
    replaceSkillOverlay.classList.add('hidden');
    renderReveal(state);
  } else if (state.isYourTurn) {
    replaceSkillOverlay.classList.add('hidden');
    resultDisplay.classList.add('hidden');
    if (state.phase === 'choosing') {
      renderGuessControls(state);
    } else {
      renderBetControls(state);
    }
    statusMessage.textContent = '輪到你了！';
  } else {
    replaceSkillOverlay.classList.add('hidden');
    actionSection.innerHTML = '';
    resultDisplay.classList.add('hidden');
    if (state.currentPlayer) {
      statusMessage.textContent = `等待 ${state.currentPlayer.name} 行動...`;
    }
  }
}

// ── Sidebar ───────────────────────────────────────────────
function renderSidebar(state) {
  playerSidebar.innerHTML = '';
  state.players.forEach((p, i) => {
    const div = document.createElement('div');
    div.className = 'sidebar-player' +
      (p.isCurrentPlayer ? ' active-turn' : '') +
      (p.eliminated ? ' eliminated' : '');
    div.innerHTML = `
      ${p.isCurrentPlayer ? '<div class="turn-indicator"></div>' : ''}
      <div class="player-avatar" style="background:${AVATAR_COLORS[i % AVATAR_COLORS.length]}">${p.name[0]}</div>
      <div class="player-info">
        <div class="player-name">${escapeHtml(p.name)}${p.id === myId ? ' (你)' : ''}${p.isHost ? ' 👑' : ''}</div>
        <div class="player-money${p.money === 0 ? ' zero' : ''}">$${p.money}${p.eliminated ? ' ☠️' : ''}${p.waitingForNextRound ? ' <span style="color:#f39c12; font-size:0.85em; margin-left: 4px;">⌛ 等待中</span>' : ''}</div>
      </div>
    `;
    playerSidebar.appendChild(div);
  });
}

// ── Cards ─────────────────────────────────────────────────
function renderCards(state) {
  if (state.gateCards.length >= 2) {
    gateCard1Slot.innerHTML = renderCardHTML(state.gateCards[0]);
    
    const shouldHide = state.gateCard2Hidden && state.isYourTurn && !['revealing', 'gameOver', 'consecutive'].includes(state.phase);
    if (shouldHide || state.phase === 'skill-replace') {
      gateCard2Slot.innerHTML = '<div class="card card-back card-hidden"><div class="card-back-pattern">?</div></div>';
    } else {
      gateCard2Slot.innerHTML = renderCardHTML(state.gateCards[1]);
    }
  }

  if (state.thirdCard) {
    thirdCardSlot.innerHTML = renderCardHTML(state.thirdCard, true);
  } else if (state.phase === 'consecutive') {
    thirdCardSlot.innerHTML = '';
  } else {
    thirdCardSlot.innerHTML = '<div class="card card-back card-hidden"><div class="card-back-pattern">?</div></div>';
  }
}

function renderCardHTML(card, reveal = false) {
  const isRed = card.suit === '♥' || card.suit === '♦';
  const colorClass = isRed ? 'red' : 'black';
  return `
    <div class="card-face ${colorClass} ${reveal ? 'card-reveal' : ''}">
      <div class="card-corner card-corner-tl">${card.rank}<br>${card.suit}</div>
      <div class="card-rank">${card.rank}</div>
      <div class="card-suit">${card.suit}</div>
      <div class="card-corner card-corner-br">${card.rank}<br>${card.suit}</div>
    </div>
  `;
}

// ── Bet Controls ──────────────────────────────────────────
function renderBetControls(state) {
  const maxBet = state.maxBet;
  const minBet = state.minBet || 1;
  if (maxBet < minBet) {
    actionSection.innerHTML = '<p style="color:var(--text-muted)">無法下注（獎池或餘額不足）</p>';
    return;
  }
  const initialBet = Math.max(minBet, Math.floor(maxBet / 2));
  actionSection.innerHTML = `
    <div class="bet-controls">
      <div class="bet-amount-display" id="bet-display">${initialBet}</div>
      <div class="bet-slider-row">
        <span style="color:var(--text-muted);font-size:0.8rem">${minBet}</span>
        <input type="range" id="bet-slider" min="${minBet}" max="${maxBet}" value="${initialBet}">
        <span style="color:var(--text-muted);font-size:0.8rem">${maxBet}</span>
      </div>
      <div class="bet-quick-btns">
        <button data-pct="10">10%</button>
        <button data-pct="25">25%</button>
        <button data-pct="50">50%</button>
        <button data-pct="100">ALL IN</button>
      </div>
      <button class="btn btn-primary btn-bet" id="btn-place-bet">
        <span class="btn-icon">🎲</span> 下注
      </button>
    </div>
  `;

  const slider = document.getElementById('bet-slider');
  const display = document.getElementById('bet-display');

  slider.addEventListener('input', () => {
    display.textContent = slider.value;
    updateSliderBg(slider);
  });
  updateSliderBg(slider);

  document.querySelectorAll('.bet-quick-btns button').forEach(btn => {
    btn.addEventListener('click', () => {
      const pct = parseInt(btn.dataset.pct);
      const val = Math.max(minBet, Math.floor(maxBet * pct / 100));
      slider.value = val;
      display.textContent = val;
      updateSliderBg(slider);
    });
  });

  document.getElementById('btn-place-bet').addEventListener('click', () => {
    socket.emit('place-bet', parseInt(slider.value));
  });
}

// ── Guess Controls (equal gate cards) ─────────────────────
function renderGuessControls(state) {
  const maxBet = state.maxBet;
  const minBet = state.minBet || 1;
  selectedGuess = null;
  if (maxBet < minBet) {
    actionSection.innerHTML = '<p style="color:var(--text-muted)">無法下注（獎池或餘額不足）</p>';
    return;
  }
  const initialBet = Math.max(minBet, Math.floor(maxBet / 2));
  actionSection.innerHTML = `
    <div class="guess-controls">
      <div class="guess-label">🃏 兩張門牌相同！猜第三張牌比門牌大還是小？</div>
      <div class="guess-btns">
        <button class="btn-guess higher" id="btn-higher">⬆️ 大</button>
        <button class="btn-guess lower" id="btn-lower">⬇️ 小</button>
      </div>
      <div class="bet-amount-display" id="bet-display">${initialBet}</div>
      <div class="bet-slider-row">
        <span style="color:var(--text-muted);font-size:0.8rem">${minBet}</span>
        <input type="range" id="bet-slider" min="${minBet}" max="${maxBet}" value="${initialBet}">
        <span style="color:var(--text-muted);font-size:0.8rem">${maxBet}</span>
      </div>
      <div class="bet-quick-btns">
        <button data-pct="10">10%</button>
        <button data-pct="25">25%</button>
        <button data-pct="50">50%</button>
        <button data-pct="100">ALL IN</button>
      </div>
      <button class="btn btn-primary btn-bet" id="btn-place-guess" disabled>
        <span class="btn-icon">🎲</span> 確認下注
      </button>
    </div>
  `;

  const slider = document.getElementById('bet-slider');
  const display = document.getElementById('bet-display');

  slider.addEventListener('input', () => {
    display.textContent = slider.value;
    updateSliderBg(slider);
  });
  updateSliderBg(slider);

  document.querySelectorAll('.bet-quick-btns button').forEach(btn => {
    btn.addEventListener('click', () => {
      const pct = parseInt(btn.dataset.pct);
      const val = Math.max(minBet, Math.floor(maxBet * pct / 100));
      slider.value = val;
      display.textContent = val;
      updateSliderBg(slider);
    });
  });

  const btnHigher = document.getElementById('btn-higher');
  const btnLower = document.getElementById('btn-lower');
  const btnPlaceGuess = document.getElementById('btn-place-guess');

  btnHigher.addEventListener('click', () => {
    selectedGuess = 'higher';
    btnHigher.classList.add('selected');
    btnLower.classList.remove('selected');
    btnPlaceGuess.disabled = false;
  });

  btnLower.addEventListener('click', () => {
    selectedGuess = 'lower';
    btnLower.classList.add('selected');
    btnHigher.classList.remove('selected');
    btnPlaceGuess.disabled = false;
  });

  btnPlaceGuess.addEventListener('click', () => {
    if (!selectedGuess) return showToast('請先選擇大或小', true);
    socket.emit('place-guess', { guess: selectedGuess, amount: parseInt(slider.value) });
  });
}

// ── Reveal ────────────────────────────────────────────────
function renderReveal(state) {
  actionSection.innerHTML = '';
  if (state.lastResult) {
    showResult(state.lastResult);
  }
  statusMessage.textContent = '下一位玩家準備中...';
}

// ── Game Over ─────────────────────────────────────────────
function showGameOver(state) {
  gameOverOverlay.classList.remove('hidden');
  actionSection.innerHTML = '';
  resultDisplay.classList.add('hidden');

  // Sort players by money descending
  const sorted = [...state.players].sort((a, b) => b.money - a.money);
  const winner = sorted[0];
  winnerText.textContent = `🏆 ${winner.name} 獲勝！`;

  // Show remaining pot
  document.getElementById('pot-remaining-amount').textContent = `$${state.pot}`;

  const medals = ['🥇', '🥈', '🥉'];
  finalStandings.innerHTML = '';
  sorted.forEach((p, i) => {
    const div = document.createElement('div');
    div.className = 'standing-item';
    const netMoney = p.money - state.startingMoney;
    const netString = netMoney >= 0 ? `+${netMoney}` : `${netMoney}`;
    const netColor = netMoney >= 0 ? 'var(--accent-emerald)' : 'var(--accent-red)';
    div.innerHTML = `
      <span class="standing-rank">${medals[i] || `#${i + 1}`}</span>
      <span class="standing-name" style="flex:1;">${escapeHtml(p.name)}${p.id === myId ? ' (你)' : ''}</span>
      <span class="standing-money${p.money === 0 ? ' zero' : ''}" style="display:flex; flex-direction:column; text-align:right; line-height:1.2;">
        $${p.money}
        <span style="font-size:0.75rem; color:${netColor};">(淨利: ${netString})</span>
      </span>
    `;
    finalStandings.appendChild(div);
  });

  const isHost = state.players.find(p => p.id === myId)?.isHost;
  if (isHost) {
    btnRestart.classList.remove('hidden');
  }
}

// ── Utilities ─────────────────────────────────────────────
function updateSliderBg(slider) {
  const pct = ((slider.value - slider.min) / (slider.max - slider.min)) * 100;
  slider.style.background = `linear-gradient(to right, var(--accent-gold) ${pct}%, rgba(255,255,255,0.1) ${pct}%)`;
}

function showToast(msg, isError = false) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast' + (isError ? ' error' : '');
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ── Skill System (Special Mode) ───────────────────────────
function renderSkillStore() {
  if (!currentState) return;
  const me = currentState.players.find(p => p.id === myId);
  if (!me) return;

  storeBalance.textContent = `$${me.money}`;
  skillsList.innerHTML = '';

  for (const [skillId, config] of Object.entries(SKILL_CONFIG)) {
    const activeLevel = me.skills ? me.skills[skillId] : 0;
    const pendingLevel = me.pendingSkills ? me.pendingSkills[skillId] : 0;
    const currentMax = Math.max(activeLevel, pendingLevel);

    const isMax = currentMax >= 3;
    const cost = isMax ? '-' : config.costs[currentMax];
    const canAfford = !isMax && me.money >= cost;
    const nextChance = isMax ? config.chances[2] : config.chances[currentMax];
    const curChance = currentMax === 0 ? 0 : config.chances[currentMax - 1];

    const div = document.createElement('div');
    div.className = 'skill-card';
    div.innerHTML = `
      <div class="skill-info-wrap">
        <div class="skill-name">${config.name} ${currentMax > 0 ? `<span class="skill-lvl-badge">Lv.${currentMax}</span>` : ''}</div>
        <div class="skill-desc">${config.desc}</div>
        <div class="skill-stats">觸發機率: ${(curChance * 100).toFixed(1)}% ${!isMax ? '→ 升級後: ' + (nextChance * 100).toFixed(1) + '%' : ''}</div>
        ${pendingLevel > activeLevel ? `<div style="font-size:0.8rem; color:var(--text-muted); margin-top:4px;">(Lv.${pendingLevel} 將於下回合生效)</div>` : ''}
      </div>
      <div class="skill-action-wrap">
      <div class="skill-action-wrap">
        ${isMax 
          ? '<span style="color:var(--text-muted); font-size:0.9rem; font-weight:bold; margin-top:8px;">已滿等</span>' 
          : `<button class="btn btn-primary btn-sm" onclick="btnBuySkill(this, '${skillId}')" ${!canAfford ? 'disabled' : ''} style="padding: 6px 16px;">
              ${currentMax === 0 ? '購買' : '升級'} ($${cost})
            </button>`
        }
      </div>
    `;
    skillsList.appendChild(div);
  }
}

window.btnBuySkill = function(btn, skillId) {
  btn.disabled = true; // prevent double clicks causing lag sensation
  btn.textContent = '處理中...';
  socket.emit('buy-skill', skillId);
};

// ── Replace Skill Phase ───────────────────────────────────
function renderReplaceSkillPhase(state) {
  replaceSkillOverlay.classList.remove('hidden');
  const activeDiv = document.getElementById('replace-skill-active');
  const waitingDiv = document.getElementById('replace-skill-waiting');
  
  if (state.replacePlayerId === myId) {
    activeDiv.classList.remove('hidden');
    waitingDiv.classList.add('hidden');
    
    // Show the first gate card
    const gc1 = state.gateCards[0];
    const isRed = gc1.suit === '♥' || gc1.suit === '♦';
    const color = isRed ? 'var(--accent-red)' : 'var(--text-main)';
    document.getElementById('replace-gate-card').innerHTML = `<span style="color:${color}">${gc1.suit} ${gc1.rank}</span>`;
    
    replaceRankGrid.innerHTML = '';
    const allRanks = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
    allRanks.forEach(rank => {
      const btn = document.createElement('button');
      btn.className = 'btn ' + (state.replaceOptions.includes(rank) ? 'btn-primary' : 'btn-secondary');
      btn.textContent = rank;
      btn.style.padding = '10px';
      btn.style.fontSize = '1.2rem';
      
      if (!state.replaceOptions.includes(rank)) {
        btn.disabled = true;
        btn.style.opacity = '0.5';
      } else {
        btn.onclick = () => {
          socket.emit('execute-replace', rank);
          replaceSkillOverlay.classList.add('hidden');
        };
      }
      replaceRankGrid.appendChild(btn);
    });
  } else {
    activeDiv.classList.add('hidden');
    waitingDiv.classList.remove('hidden');
    const rpPlayer = state.players.find(p => p.id === state.replacePlayerId);
    document.getElementById('replace-waiting-name').textContent = rpPlayer ? rpPlayer.name : '某玩家';
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showResult(lastResult) {
  resultDisplay.className = 'result-display ' + lastResult.type;
  resultText.textContent = lastResult.message;
  resultDisplay.classList.remove('hidden');
  if (lastResult.eliminated) {
    resultText.textContent += ' 玩家已淘汰！';
  }
}
