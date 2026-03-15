const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createRoom, getRoom, deleteRoom, rooms } = require('./game');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// Track socket → room mapping
const socketRooms = new Map(); // socketId → roomCode

io.on('connection', (socket) => {
  console.log(`[連線] ${socket.id}`);

  // ── Create Room ─────────────────────────────────────
  socket.on('create-room', (playerName) => {
    // If client is still passing object, handle it backward compatibly
    const name = typeof playerName === 'string' ? playerName : playerName?.playerName;
    const room = createRoom(socket.id, name);
    room.onStateChange = () => broadcastState(room);
    socket.join(room.code);
    socketRooms.set(socket.id, room.code);
    socket.emit('room-created', room.code);
    broadcastState(room);
  });

  // ── Update Settings (host only, before game starts) ────
  socket.on('update-settings', ({ entryFee, startingMoney, mode }) => {
    const room = getRoomForSocket(socket);
    if (!room) return;
    if (room.hostId !== socket.id) return socket.emit('error-msg', '只有房主可以調整設定');
    if (room.gameStarted) return socket.emit('error-msg', '遊戲已開始，無法調整');
    room.updateSettings(entryFee, startingMoney, mode);
    broadcastState(room);
  });

  // ── Request Settle (host only, during game) ───────────────
  socket.on('request-settle', () => {
    const room = getRoomForSocket(socket);
    if (!room) return;
    if (room.hostId !== socket.id) return socket.emit('error-msg', '只有房主可以提早結算');
    if (!room.gameStarted || room.phase === 'gameOver') return socket.emit('error-msg', '目前無法結算');
    room.pendingSettlement = true;
    broadcastState(room);
  });

  // ── Join Room ───────────────────────────────────────────
  socket.on('join-room', ({ code, playerName }) => {
    const room = getRoom(code);
    if (!room) return socket.emit('error-msg', '房間不存在');
    if (!room.addPlayer(socket.id, playerName)) {
      return socket.emit('error-msg', '房間已滿（上限 10 人）');
    }
    socket.join(code);
    socketRooms.set(socket.id, code);
    socket.emit('room-joined', code);
    broadcastState(room);
  });

  // ── Start Game ──────────────────────────────────────────
  socket.on('start-game', () => {
    const room = getRoomForSocket(socket);
    if (!room) return;
    if (room.hostId !== socket.id) return socket.emit('error-msg', '只有房主可以開始遊戲');
    if (room.players.length < 2) return socket.emit('error-msg', '至少需要 2 位玩家');
    room.startGame();
    broadcastState(room);
  });

  // ── Place Bet (normal mode) ─────────────────────────────
  socket.on('place-bet', (amount) => {
    const room = getRoomForSocket(socket);
    if (!room) return;
    const result = room.placeBet(socket.id, amount);
    if (result.error) return socket.emit('error-msg', result.error);
    broadcastState(room);
    // Auto-advance after a delay so players can see the result
    setTimeout(() => {
      if (room.phase === 'revealing' || room.phase === 'consecutive') {
        room.nextTurn();
        broadcastState(room);
      }
    }, 3000);
  });

  // ── Place Guess (equal gate cards mode) ─────────────────
  socket.on('place-guess', ({ guess, amount }) => {
    const room = getRoomForSocket(socket);
    if (!room) return;
    const result = room.placeGuess(socket.id, guess, amount);
    if (result.error) return socket.emit('error-msg', result.error);
    broadcastState(room);
    setTimeout(() => {
      if (room.phase === 'revealing' || room.phase === 'consecutive') {
        room.nextTurn();
        broadcastState(room);
      }
    }, 3000);
  });

  // ── Special Mode Skills ─────────────────────────────────
  socket.on('buy-skill', (skillId) => {
    const room = getRoomForSocket(socket);
    if (!room) return;
    const result = room.buySkill(socket.id, skillId);
    if (result.error) return socket.emit('error-msg', result.error);
    // Notify all players (could be a toast)
    io.to(room.code).emit('skill-bought', { 
      playerId: socket.id, 
      playerName: room.players.find(p => p.id === socket.id)?.name,
      skillId, 
      newLevel: result.newLevel, 
      name: result.name 
    });
    broadcastState(room);
  });

  socket.on('execute-replace', (rank) => {
    const room = getRoomForSocket(socket);
    if (!room) return;
    const result = room.executeReplace(socket.id, rank); // rank can be null for auto-pick
    if (result && result.error) return socket.emit('error-msg', result.error);
    broadcastState(room);
  });

  // ── Kick Player (host only) ─────────────────────────────
  socket.on('kick-player', (targetId) => {
    const room = getRoomForSocket(socket);
    if (!room) return;
    if (room.hostId !== socket.id) return socket.emit('error-msg', '只有房主可以踢人');
    if (targetId === socket.id) return socket.emit('error-msg', '不能踢出自己');
    const targetPlayer = room.players.find(p => p.id === targetId);
    if (!targetPlayer) return socket.emit('error-msg', '找不到該玩家');
    const targetSocket = io.sockets.sockets.get(targetId);
    if (targetSocket) {
      targetSocket.emit('kicked-from-room');
      targetSocket.leave(room.code);
      socketRooms.delete(targetId);
    }
    room.removePlayer(targetId);
    broadcastState(room);
  });

  // ── Restart Game ────────────────────────────────────────
  socket.on('restart-game', () => {
    const room = getRoomForSocket(socket);
    if (!room) return;
    if (room.hostId !== socket.id) return socket.emit('error-msg', '只有房主可以重新開始');
    room.startGame();
    broadcastState(room);
  });

  // ── Disconnect ──────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log(`[斷線] ${socket.id}`);
    const code = socketRooms.get(socket.id);
    if (!code) return;
    const room = getRoom(code);
    if (!room) return;

    if (!room.gameStarted) {
      room.removePlayer(socket.id);
      if (room.players.length === 0) {
        deleteRoom(code);
      } else {
        broadcastState(room);
      }
    } else {
      // Mark as disconnected during game
      const player = room.players.find(p => p.id === socket.id);
      if (player) {
        player.connected = false;
        // If it was this player's turn, skip
        const current = room.getCurrentPlayer();
        if (current && current.id === socket.id) {
          room.nextTurn();
        }
        broadcastState(room);
      }
    }
    socketRooms.delete(socket.id);
  });
});

function getRoomForSocket(socket) {
  const code = socketRooms.get(socket.id);
  if (!code) { socket.emit('error-msg', '你不在任何房間中'); return null; }
  const room = getRoom(code);
  if (!room) { socket.emit('error-msg', '房間不存在'); return null; }
  return room;
}

function broadcastState(room) {
  for (const player of room.players) {
    const state = room.getStateForPlayer(player.id);
    io.to(player.id).emit('game-state', state);
  }

  // Handle auto-advance for consecutive phase right after broadcasting
  if (room.phase === 'consecutive' && !room._autoAdvanceScheduled) {
    room._autoAdvanceScheduled = true;
    setTimeout(() => {
      room._autoAdvanceScheduled = false;
      if (room.phase === 'consecutive') {
        room.nextTurn();
        broadcastState(room);
      }
    }, 3000);
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🐉 射龍門伺服器啟動於 http://localhost:${PORT}`);
});
