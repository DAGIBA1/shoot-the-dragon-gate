const { io } = require("socket.io-client");

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

let clients = [];
let gameStuck = false;

async function runTest(numPlayers = 4) {
    console.log(`Starting simulation with ${numPlayers} players...`);
    const roomCode = await createRoomAndJoin(numPlayers);
    if (!roomCode) {
        console.log("Failed to create/join room.");
        return;
    }

    console.log(`Room created: ${roomCode}. Starting game...`);
    const host = clients[0];
    host.socket.emit('update-settings', { entryFee: 10, startingMoney: 500, mode: 'special' });
    await sleep(500);
    host.socket.emit('start-game');

    // Monitor for stuck state
    let lastStateTime = Date.now();
    let currentRound = 0;
    
    // Listen for state changes on all clients
    clients.forEach(c => {
        c.socket.on('game-state', (state) => {
            lastStateTime = Date.now();
            c.state = state;
            if (state.roundNumber > currentRound) {
                currentRound = state.roundNumber;
                console.log(`Round ${currentRound} started.`);
            }
        });
        c.socket.on('error-msg', (msg) => {
            console.log(`[${c.name}] Error: ${msg}`);
        });
    });

    const checker = setInterval(() => {
        if (Date.now() - lastStateTime > 15000) {
            console.log("GAME STUCK DETECTED! No state change for 15 seconds.");
            const s = clients[0].state;
            console.log(`Phase: ${s.phase}, Round: ${s.roundNumber}, Pot: ${s.pot}`);
            if (s.currentPlayer) {
                console.log(`Current Player: ${s.currentPlayer.name}`);
            }
            if (s.phase === 'skill-replace') {
                console.log(`Replace Player: ${s.replacePlayerId}`);
            }
            console.log(JSON.stringify(s, null, 2));
            gameStuck = true;
            clearInterval(checker);
            process.exit(1);
        }
    }, 1000);

    // AI logic loop
    while (!gameStuck) {
        let anyAction = false;
        
        for (const c of clients) {
            if (!c.state) continue;
            const state = c.state;

            if (state.phase === 'gameOver') {
                console.log("Game over reached cleanly.");
                clearInterval(checker);
                process.exit(0);
            }

            if (state.phase === 'skill-replace' && state.replacePlayerId === c.socket.id) {
                console.log(`[${c.name}] Triggered replace skill.`);
                // Send replace randomly after 1s or auto-pick
                if (Math.random() < 0.5) {
                    const opts = state.replaceOptions;
                    const choice = opts[Math.floor(Math.random() * opts.length)];
                    c.socket.emit('execute-replace', choice);
                    anyAction = true;
                    await sleep(500);
                }
            } else if (state.isYourTurn && state.phase === 'choosing' && c.socket.id === state.currentPlayer.id) {
                console.log(`[${c.name}] It's my turn (choosing).`);
                const guess = Math.random() < 0.5 ? 'higher' : 'lower';
                c.socket.emit('place-guess', { guess, amount: state.minBet });
                anyAction = true;
                await sleep(500);
            } else if (state.isYourTurn && state.phase === 'betting' && c.socket.id === state.currentPlayer.id) {
                console.log(`[${c.name}] It's my turn (betting).`);
                c.socket.emit('place-bet', state.minBet);
                anyAction = true;
                await sleep(500);
            }
        }
        
        if (!anyAction) {
            // We sleep a bit
            await sleep(200);
        }
    }
}

async function createRoomAndJoin(numPlayers) {
    return new Promise(resolve => {
        let joinedCount = 0;
        let roomCode = null;

        for (let i = 0; i < numPlayers; i++) {
            const socket = io("http://localhost:3000");
            const name = `Bot${i}`;
            const client = { socket, name, state: null };
            clients.push(client);

            socket.on('connect', () => {
                if (i === 0) {
                    socket.emit('create-room', name);
                } else {
                    // Wait for room code
                    const waitJoin = setInterval(() => {
                        if (roomCode) {
                            clearInterval(waitJoin);
                            socket.emit('join-room', { code: roomCode, playerName: name });
                        }
                    }, 100);
                }
            });

            socket.on('room-created', (code) => {
                roomCode = code;
                joinedCount++;
            });

            socket.on('room-joined', () => {
                joinedCount++;
                if (joinedCount === numPlayers) {
                    resolve(roomCode);
                }
            });
        }
        
        setTimeout(() => {
            if (joinedCount < numPlayers) resolve(null);
        }, 5000);
    });
}

runTest(4);
