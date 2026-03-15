// ============================================================
// 射龍門 Game Engine
// ============================================================

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const RANK_VALUES = {
  'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
  '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13
};

const MAX_PLAYERS = 10;
const DEFAULT_ENTRY_FEE = 10;
const DEFAULT_STARTING_MONEY = 500;

// ── Skills Configuration ────────────────────────────────────
const SKILL_CONFIG = {
  obscure: { levels: [1, 2, 3], costs: [50, 100, 150], chances: [0.05, 0.075, 0.10], name: '門牌遮蔽', desc: '在對手回合時，有機率隱藏其第二張門牌' },
  replace: { levels: [1, 2, 3], costs: [100, 150, 200], chances: [0.05, 0.075, 0.10], name: '門牌替換', desc: '在所有回合時，有機率替換第二張門牌' },
  steal:   { levels: [1, 2, 3], costs: [100, 150, 200], chances: [0.05, 0.075, 0.10], name: '偷錢', desc: '在對手贏得獎池時，有機率偷取其 30% 獲利' }
};

// ── Deck ────────────────────────────────────────────────────
class Deck {
  constructor() {
    this.cards = [];
    this.reset();
  }

  reset() {
    this.cards = [];
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        this.cards.push({ suit, rank, value: RANK_VALUES[rank] });
      }
    }
    this.shuffle();
  }

  shuffle() {
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
  }

  draw() {
    return this.cards.pop();
  }
}

// ── Room ────────────────────────────────────────────────────
class Room {
  constructor(code, hostId, hostName) {
    this.code = code;
    this.hostId = hostId;
    this.mode = 'normal';
    this.entryFee = DEFAULT_ENTRY_FEE;
    this.startingMoney = DEFAULT_STARTING_MONEY;
    this.players = [];
    this.addPlayer(hostId, hostName);
    this.gameStarted = false;
    this.deck = null;
    this.pot = 0;
    this.currentPlayerIndex = 0;
    this.roundStartIndex = 0; // rotates each round
    this.roundNumber = 0;
    this.gateCards = []; // two gate cards
    this.thirdCard = null;
    this.phase = 'lobby'; // lobby | betting | choosing | consecutive | revealing | gameOver
    this.lastResult = null;
    this.pendingSettlement = false;
    this.turnOrder = []; // active player indices for current round
    this.turnPosition = 0; // position within turnOrder
  }

  updateSettings(entryFee, startingMoney, mode) {
    if (this.gameStarted) return false;
    if (entryFee && Number.isInteger(entryFee) && entryFee > 0) this.entryFee = entryFee;
    if (startingMoney && Number.isInteger(startingMoney) && startingMoney > 0) this.startingMoney = startingMoney;
    if (mode) this.mode = mode;
    return true;
  }

  addPlayer(id, name) {
    if (this.players.length >= MAX_PLAYERS) return false;
    if (this.players.find(p => p.id === id)) return false;
    this.players.push({
      id,
      name,
      money: this.startingMoney,
      eliminated: false,
      connected: true,
      waitingForNextRound: this.gameStarted,
      skills: { obscure: 0, replace: 0, steal: 0 },
      pendingSkills: { obscure: 0, replace: 0, steal: 0 }
    });
    return true;
  }

  removePlayer(id) {
    this.players = this.players.filter(p => p.id !== id);
    if (this.hostId === id && this.players.length > 0) {
      this.hostId = this.players[0].id;
    }
  }

  getActivePlayers() {
    return this.players.filter(p => !p.eliminated && p.connected && !p.waitingForNextRound);
  }

  // Check & collect entry fees if pot is too low
  collectEntryFees() {
    const activePlayers = this.getActivePlayers();
    const threshold = this.entryFee * activePlayers.length;
    if (this.pot < threshold) {
      for (const player of activePlayers) {
        const fee = Math.min(this.entryFee, player.money);
        player.money -= fee;
        this.pot += fee;
        // Check elimination after fee
        if (player.money <= 0) {
          player.money = 0;
          player.eliminated = true;
        }
      }
    }
  }

  buySkill(playerId, skillId) {
    if (this.mode !== 'special') return { error: '只有特殊模式可購買技能' };
    const player = this.players.find(p => p.id === playerId);
    if (!player) return { error: '找不到玩家' };
    const config = SKILL_CONFIG[skillId];
    if (!config) return { error: '無效的技能' };

    const currentLevel = Math.max(player.skills[skillId], player.pendingSkills[skillId]);
    if (currentLevel >= 3) return { error: '技能已達最高等級' };

    const nextLevel = currentLevel + 1;
    const cost = config.costs[nextLevel - 1];
    if (player.money < cost) return { error: '餘額不足' };

    player.money -= cost;
    player.pendingSkills[skillId] = nextLevel;
    
    // Check elimination if money drops to 0 (though normally you wouldn't spend your last dime, but possible)
    if (player.money <= 0) {
      player.money = 0;
      player.eliminated = true;
    }
    return { success: true, newLevel: nextLevel, cost, name: config.name };
  }

  startGame() {
    if (this.players.length < 2) return false;
    this.gameStarted = true;
    this.roundNumber = 0;
    this.roundStartIndex = 0;
    this.pot = 0;
    this.pendingSettlement = false;
    for (const p of this.players) {
      p.money = this.startingMoney;
      p.eliminated = false;
      p.waitingForNextRound = false;
    }
    this.startNewRound();
    return true;
  }

  startNewRound() {
    for (const p of this.players) {
      p.waitingForNextRound = false;
      // Merge pending skills into active skills
      for (const key in p.pendingSkills) {
        if (p.pendingSkills[key] > p.skills[key]) {
          p.skills[key] = p.pendingSkills[key];
        }
      }
    }

    if (this.pendingSettlement) {
      this.phase = 'gameOver';
      this.pendingSettlement = false;
      return;
    }

    const activePlayers = this.getActivePlayers();
    if (activePlayers.length <= 1) {
      this.phase = 'gameOver';
      return;
    }

    this.roundNumber++;
    this.deck = new Deck();
    this.collectEntryFees();

    // Rebuild active players list after potential elimination from entry fees
    const activeAfterFees = this.getActivePlayers();
    if (activeAfterFees.length <= 1) {
      this.phase = 'gameOver';
      return;
    }

    // Build turn order starting from roundStartIndex, wrapping around
    this.turnOrder = [];
    const total = this.players.length;
    for (let i = 0; i < total; i++) {
      const idx = (this.roundStartIndex + i) % total;
      const p = this.players[idx];
      if (!p.eliminated && p.connected) {
        this.turnOrder.push(idx);
      }
    }

    this.turnPosition = 0;
    this.lastResult = null;
    this.dealGateCards();
  }

  dealGateCards() {
    // Collect entry fees if pot dropped below threshold
    this.collectEntryFees();

    // Re-check after fee collection (players may have been eliminated)
    const activePlayers = this.getActivePlayers();
    if (activePlayers.length <= 1) {
      this.phase = 'gameOver';
      return;
    }

    // Skip current player if they got eliminated by entry fee
    const currentPlayer = this.getCurrentPlayer();
    if (currentPlayer && currentPlayer.eliminated) {
      this.nextTurn();
      return;
    }

    this.gateCards = [this.deck.draw(), this.deck.draw()];
    this.thirdCard = null;
    this.lastResult = null;
    this.gateCard2Hidden = false;
    this.activeSkills = [];

    if (this.mode === 'special') {
      const currentPlayer = this.getCurrentPlayer();
      // Obscure: Opponents only
      for (let idx of this.turnOrder) {
        const p = this.players[idx];
        if (p.id !== currentPlayer.id && p.skills.obscure > 0) {
          const chance = SKILL_CONFIG.obscure.chances[p.skills.obscure - 1];
          if (Math.random() < chance) {
            this.gateCard2Hidden = true;
            this.activeSkills.push({ playerId: p.id, playerName: p.name, skill: '門牌遮蔽' });
            break;
          }
        }
      }

      // Replace: All players (Priority: Active Player -> Turn Order)
      let replaceWinner = null;
      for (let i = 0; i < this.turnOrder.length; i++) {
        const actualIndex = (this.turnPosition + i) % this.turnOrder.length;
        const p = this.players[this.turnOrder[actualIndex]];
        if (p.skills.replace > 0) {
          const chance = SKILL_CONFIG.replace.chances[p.skills.replace - 1];
          if (Math.random() < chance) {
            replaceWinner = p;
            break; // Highest priority triggers first
          }
        }
      }

      if (replaceWinner) {
        this.phase = 'skill-replace';
        this.replacePlayerId = replaceWinner.id;
        this.activeSkills.push({ playerId: replaceWinner.id, playerName: replaceWinner.name, skill: '門牌替換' });
        
        // Get available ranks from deck
        const counts = {};
        for (const c of this.deck.cards) counts[c.rank] = (counts[c.rank] || 0) + 1;
        this.replaceOptions = Object.keys(counts);

        // Auto-pick after 10s if no response
        this.replaceTimeout = setTimeout(() => {
          this.executeReplace(replaceWinner.id, null);
        }, 10000);
        if (this.onStateChange) this.onStateChange();
        return;
      }
    }

    this.checkGateCards();
  }

  executeReplace(playerId, selectedRank) {
    if (this.phase !== 'skill-replace' || this.replacePlayerId !== playerId) return { error: '無效的操作' };
    
    clearTimeout(this.replaceTimeout);
    this.replaceTimeout = null;

    let validCards = [];
    if (selectedRank) {
      validCards = this.deck.cards.filter(c => c.rank === selectedRank);
    }
    
    if (validCards.length === 0) {
      // Fallback: Pick a random card from remaining deck
      validCards = this.deck.cards;
    }

    if (validCards.length > 0) {
      // Pick random suit of that rank (or random card entirely)
      const ranIdx = Math.floor(Math.random() * validCards.length);
      const chosenCard = validCards[ranIdx];
      
      // Remove chosen card from deck
      const deckIdx = this.deck.cards.indexOf(chosenCard);
      if (deckIdx !== -1) this.deck.cards.splice(deckIdx, 1);
      
      this.gateCards[1] = chosenCard;
    }

    this.checkGateCards();
  }

  checkGateCards() {

    const low = Math.min(this.gateCards[0].value, this.gateCards[1].value);
    const high = Math.max(this.gateCards[0].value, this.gateCards[1].value);

    // Check if gate cards are consecutive → auto-lose entry fee
    if (high - low === 1) {
      const cp = this.getCurrentPlayer();
      const loss = Math.min(this.entryFee, cp.money);
      cp.money -= loss;
      this.pot += loss;
      if (cp.money <= 0) {
        cp.money = 0;
        cp.eliminated = true;
      }
      this.lastResult = {
        type: 'consecutive',
        amount: loss,
        message: `連號（${low} 和 ${high}）！自動賠 ${loss} 元！`,
        eliminated: cp.eliminated || false
      };
      this.phase = 'consecutive';
      return;
    }

    // Check if gate cards are equal → choosing phase
    if (this.gateCards[0].value === this.gateCards[1].value) {
      this.phase = 'choosing'; // player must choose higher or lower
    } else {
      this.phase = 'betting';
    }

    // Call an external trigger if needed (or simply depend on state broadcast)
    if (this.onStateChange) this.onStateChange();
  }

  executeSteal(winnerId, originalWinAmount) {
    if (this.mode !== 'special') return;
    
    const winner = this.players.find(p => p.id === winnerId);
    if (!winner) return;

    let stealCandidates = [];
    for (let i = 0; i < this.turnOrder.length; i++) {
        // Iterate starting from current player to respect turn order
        const actualIndex = (this.turnPosition + i) % this.turnOrder.length;
        const p = this.players[this.turnOrder[actualIndex]];
        if (p.id !== winnerId && p.skills.steal > 0) {
            const chance = SKILL_CONFIG.steal.chances[p.skills.steal - 1];
            if (Math.random() < chance) {
                stealCandidates.push(p);
            }
        }
    }
    
    let remainingWin = originalWinAmount;
    // Base 30% of original
    const stealAmount = Math.floor(originalWinAmount * 0.3);
    
    for (const thief of stealCandidates) {
        if (remainingWin <= 0) break;
        const actualSteal = Math.min(stealAmount, remainingWin);
        
        winner.money -= actualSteal;
        thief.money += actualSteal;
        remainingWin -= actualSteal;
        
        this.activeSkills.push({
            playerId: thief.id, 
            playerName: thief.name, 
            skill: '偷錢', 
            message: `從 ${winner.name} 偷走了 $${actualSteal}` 
        });
    }
  }

  getCurrentPlayer() {
    if (this.turnOrder.length === 0) return null;
    const idx = this.turnOrder[this.turnPosition];
    return this.players[idx];
  }

  // Place a bet (normal mode: gate cards are different)
  placeBet(playerId, amount) {
    const currentPlayer = this.getCurrentPlayer();
    if (!currentPlayer || currentPlayer.id !== playerId) return { error: '不是你的回合' };
    if (this.phase !== 'betting') return { error: '目前不是下注階段' };
    if (amount < this.entryFee) return { error: `最低下注金額為 ${this.entryFee} 元` };
    if (amount > currentPlayer.money) return { error: '下注金額不可超過持有金額' };
    if (amount > this.pot) return { error: '下注金額不可超過獎池金額' };

    this.thirdCard = this.deck.draw();
    const low = Math.min(this.gateCards[0].value, this.gateCards[1].value);
    const high = Math.max(this.gateCards[0].value, this.gateCards[1].value);
    const val = this.thirdCard.value;

    let result;
    if (val === this.gateCards[0].value || val === this.gateCards[1].value) {
      // Hit the post → pay double
      const loss = amount * 2;
      currentPlayer.money -= loss;
      this.pot += loss;
      result = { type: 'hitPost', amount: loss, message: '撞柱！賠雙倍！' };
    } else if (val > low && val < high) {
      // Win
      const win = amount;
      currentPlayer.money += win;
      this.pot -= win;
      this.executeSteal(currentPlayer.id, win);
      result = { type: 'win', amount: win, message: '進洞！贏得獎金！' };
    } else {
      // Lose
      const loss = amount;
      currentPlayer.money -= loss;
      this.pot += loss;
      result = { type: 'lose', amount: loss, message: '未進洞！賠掉底注！' };
    }

    if (currentPlayer.money <= 0) {
      currentPlayer.money = 0;
      currentPlayer.eliminated = true;
      result.eliminated = true;
    }

    this.lastResult = result;
    this.phase = 'revealing';
    return { success: true, result };
  }

  // Place a guess (equal gate cards mode)
  placeGuess(playerId, guess, amount) {
    // guess: 'higher' or 'lower'
    const currentPlayer = this.getCurrentPlayer();
    if (!currentPlayer || currentPlayer.id !== playerId) return { error: '不是你的回合' };
    if (this.phase !== 'choosing') return { error: '目前不是猜牌階段' };
    if (amount < this.entryFee) return { error: `最低下注金額為 ${this.entryFee} 元` };
    if (amount > currentPlayer.money) return { error: '下注金額不可超過持有金額' };
    if (amount > this.pot) return { error: '下注金額不可超過獎池金額' };

    this.thirdCard = this.deck.draw();
    const gateValue = this.gateCards[0].value;
    const val = this.thirdCard.value;

    let result;
    const guessCorrect = (guess === 'higher' && val > gateValue) ||
                         (guess === 'lower' && val < gateValue);

    if (val === gateValue) {
      // Triple penalty
      const loss = amount * 3;
      currentPlayer.money -= loss;
      this.pot += loss;
      result = { type: 'tripleHit', amount: loss, message: '撞柱！賠三倍！' };
    } else if (guessCorrect) {
      const win = amount;
      currentPlayer.money += win;
      this.pot -= win;
      this.executeSteal(currentPlayer.id, win);
      result = { type: 'win', amount: win, message: '猜中！贏得獎金！' };
    } else {
      // Lose
      const loss = amount;
      currentPlayer.money -= loss;
      this.pot += loss;
      result = { type: 'lose', amount: loss, message: '猜錯！賠掉底注！' };
    }

    if (currentPlayer.money <= 0) {
      currentPlayer.money = 0;
      currentPlayer.eliminated = true;
      result.eliminated = true;
    }

    this.lastResult = result;
    this.phase = 'revealing';
    return { success: true, result };
  }

  // Advance to next player's turn or next round
  nextTurn() {
    this.turnPosition++;

    // Skip eliminated / disconnected players
    while (this.turnPosition < this.turnOrder.length) {
      const idx = this.turnOrder[this.turnPosition];
      const p = this.players[idx];
      if (!p.eliminated && p.connected) break;
      this.turnPosition++;
    }

    const activePlayers = this.getActivePlayers();
    if (activePlayers.length <= 1) {
      this.phase = 'gameOver';
      return;
    }

    if (this.turnPosition >= this.turnOrder.length) {
      // Round is over → auto-start new round
      this.roundStartIndex = (this.roundStartIndex + 1) % this.players.length;
      // Skip eliminated players for roundStartIndex
      let safety = 0;
      while (this.players[this.roundStartIndex].eliminated && safety < this.players.length) {
        this.roundStartIndex = (this.roundStartIndex + 1) % this.players.length;
        safety++;
      }
      this.startNewRound();
      return;
    }

    this.dealGateCards();
  }

  // Get sanitized state for a specific player
  getStateForPlayer(playerId) {
    const currentPlayer = this.getCurrentPlayer();
    return {
      code: this.code,
      mode: this.mode,
      phase: this.phase,
      pot: this.pot,
      roundNumber: this.roundNumber,
      entryFee: this.entryFee,
      startingMoney: this.startingMoney,
      pendingSettlement: this.pendingSettlement,
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        money: p.money,
        eliminated: p.eliminated,
        connected: p.connected,
        isHost: p.id === this.hostId,
        isCurrentPlayer: currentPlayer ? p.id === currentPlayer.id : false,
        skills: p.skills,
        pendingSkills: p.pendingSkills
      })),
      currentPlayer: currentPlayer ? {
        id: currentPlayer.id,
        name: currentPlayer.name
      } : null,
      gateCards: this.gateCards,
      thirdCard: this.thirdCard,
      lastResult: this.lastResult,
      isYourTurn: currentPlayer ? currentPlayer.id === playerId : false,
      minBet: this.entryFee,
      maxBet: currentPlayer && currentPlayer.id === playerId
        ? Math.min(currentPlayer.money, this.pot)
        : 0,
      gateCardsEqual: this.gateCards.length === 2 && this.gateCards[0].value === this.gateCards[1].value,
      gateCard2Hidden: this.gateCard2Hidden || false,
      activeSkills: this.activeSkills || [],
      replaceOptions: this.replaceOptions || [],
      replacePlayerId: this.replacePlayerId || null
    };
  }
}

// ── Room Manager ────────────────────────────────────────────
const rooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  } while (rooms.has(code));
  return code;
}

function createRoom(hostId, hostName) {
  const code = generateRoomCode();
  const room = new Room(code, hostId, hostName);
  rooms.set(code, room);
  return room;
}

function getRoom(code) {
  return rooms.get(code) || null;
}

function deleteRoom(code) {
  rooms.delete(code);
}

module.exports = {
  createRoom,
  getRoom,
  deleteRoom,
  rooms,
  MAX_PLAYERS,
  DEFAULT_ENTRY_FEE,
  DEFAULT_STARTING_MONEY
};
