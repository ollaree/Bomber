const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);

// --- Static File Serving ---
// Serve the main directory (for index.html, etc.)
app.use(express.static(path.join(__dirname)));
// **THE FIX**: Explicitly serve the 'graphics' directory
app.use('/graphics', express.static(path.join(__dirname, 'graphics')));


const wss = new WebSocketServer({ server });

// --- Game Configuration ---
const TILE_SIZE = 48; // Server uses a fixed tile size for logic
const MAP_WIDTH_TILES = 17;
const MAP_HEIGHT_TILES = 13;
const PLAYER_SPEED = 2;
const GAME_TICK_RATE = 1000 / 60;
const REMATCH_TIMER = 30000;

const initialMapLayout = [
    [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
    [2, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 2],
    [2, 0, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 0, 2],
    [2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2],
    [2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2],
    [2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2],
    [2, 1, 2, 1, 2, 1, 2, 0, 2, 1, 2, 1, 2, 1, 2, 1, 2],
    [2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2],
    [2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2],
    [2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2],
    [2, 0, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 0, 2],
    [2, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 2],
    [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
];

const spawnPoints = [
    { x: 1 * TILE_SIZE, y: 1 * TILE_SIZE },
    { x: (MAP_WIDTH_TILES - 2) * TILE_SIZE, y: (MAP_HEIGHT_TILES - 2) * TILE_SIZE },
    { x: 1 * TILE_SIZE, y: (MAP_HEIGHT_TILES - 2) * TILE_SIZE },
    { x: (MAP_WIDTH_TILES - 2) * TILE_SIZE, y: 1 * TILE_SIZE },
];

const games = {};

function generateGameId() {
    const chars = 'ABCDEFGHIJKLMNPQRSTUVWXYZ123456789';
    let result = '';
    do {
        result = '';
        for (let i = 0; i < 5; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
    } while (games[result]);
    return result;
}

// --- Game State Management & Broadcasting ---
function resetGame(game) {
    game.gameMap = JSON.parse(JSON.stringify(initialMapLayout));
    game.bombs = [];
    game.explosions = [];
    game.status = 'active';
    game.rematch.votes.clear();
    clearTimeout(game.rematch.timer);

    game.players.forEach((player, index) => {
        player.x = spawnPoints[index].x;
        player.y = spawnPoints[index].y;
        player.direction = 's';
        player.isAlive = true;
        player.bombPower = 2;
        player.keys = {};
    });

    broadcast(game, 'gameStarted', { gameState: getSanitizedGameState(game) });
    game.lastUpdateTime = Date.now();
}

function getSanitizedGameState(game) {
    return {
        players: game.players,
        bombs: game.bombs,
        explosions: game.explosions,
        gameMap: game.gameMap,
        status: game.status,
    };
}

function broadcast(game, type, payload) {
    const message = JSON.stringify({ type, payload });
    game.clients.forEach(client => {
        if (client.readyState === 1) client.send(message);
    });
}

// --- Main Game Loop ---
function gameLoop(gameId) {
    const game = games[gameId];
    if (!game || game.status !== 'active') return;
    handlePlayerMovement(game);
    updateBombs(game);
    updateExplosions(game);
    checkPlayerDeaths(game);
    checkWinCondition(game);
    broadcast(game, 'gameUpdate', getSanitizedGameState(game));
}

// --- Game Logic ---
const getGridPos = (x, y) => ({ col: Math.floor(x / TILE_SIZE), row: Math.floor(y / TILE_SIZE) });

function checkCollision(game, player, x, y) {
    const pWidth = TILE_SIZE * 0.7;
    const pHeight = TILE_SIZE * 0.7;

    const futureCorners = [
        { x: x, y: y },
        { x: x + pWidth, y: y },
        { x: x, y: y + pHeight },
        { x: x + pWidth, y: y + pHeight }
    ];

    for (const corner of futureCorners) {
        const col = Math.floor(corner.x / TILE_SIZE);
        const row = Math.floor(corner.y / TILE_SIZE);

        if (col < 0 || col >= MAP_WIDTH_TILES || row < 0 || row >= MAP_HEIGHT_TILES) {
            return true; // Out of bounds
        }

        const tile = game.gameMap[row][col];

        if (tile === 1 || tile === 2) {
            return true; // Wall or Crate
        }

        if (tile === 3) { // It's a bomb tile
            const bombRect = { x: col * TILE_SIZE, y: row * TILE_SIZE, width: TILE_SIZE, height: TILE_SIZE };
            const playerRect = { x: player.x, y: player.y, width: pWidth, height: pHeight };

            const isOverlapping = playerRect.x < bombRect.x + bombRect.width &&
                                  playerRect.x + playerRect.width > bombRect.x &&
                                  playerRect.y < bombRect.y + bombRect.height &&
                                  playerRect.y + playerRect.height > bombRect.y;

            if (isOverlapping) {
                continue;
            } else {
                return true;
            }
        }
    }
    return false;
}


function handlePlayerMovement(game) {
    game.players.forEach(player => {
        if (!player.isAlive) return;
        let dx = 0, dy = 0;
        if (player.keys.up) { dy = -PLAYER_SPEED; player.direction = 'n'; }
        else if (player.keys.down) { dy = PLAYER_SPEED; player.direction = 's'; }
        else if (player.keys.left) { dx = -PLAYER_SPEED; player.direction = 'w'; }
        else if (player.keys.right) { dx = PLAYER_SPEED; player.direction = 'e'; }
        if (dx === 0 && dy === 0) return;

        const newX = player.x + dx;
        const newY = player.y + dy;

        if (!checkCollision(game, player, newX, player.y)) player.x = newX;
        if (!checkCollision(game, player, player.x, newY)) player.y = newY;
    });
}

function updateBombs(game) {
    const now = Date.now();
    game.bombs.forEach(bomb => {
        if (now >= bomb.explodeTime) {
            game.gameMap[bomb.row][bomb.col] = 0;
            createExplosion(game, bomb.col, bomb.row, bomb.power);
        }
    });
    game.bombs = game.bombs.filter(b => now < b.explodeTime);
}

function createExplosion(game, col, row, power) {
    const coords = [{ col, row, type: 'center' }];
    const dirs = [{x:0,y:1,t:'s'},{x:0,y:-1,t:'n'},{x:1,y:0,t:'e'},{x:-1,y:0,t:'w'}];
    for (const dir of dirs) {
        for (let i = 1; i <= power; i++) {
            const nc = col + dir.x * i, nr = row + dir.y * i;
            if (nc < 0 || nc >= MAP_WIDTH_TILES || nr < 0 || nr >= MAP_HEIGHT_TILES || game.gameMap[nr][nc] === 2) break;
            coords.push({ col: nc, row: nr, type: (i === power) ? dir.t : (dir.x !== 0 ? 'h' : 'v') });
            if (game.gameMap[nr][nc] === 1) { game.gameMap[nr][nc] = 0; break; }
        }
    }
    game.explosions.push({ coords, endTime: Date.now() + 500 });
}

function updateExplosions(game) {
    game.explosions = game.explosions.filter(exp => Date.now() < exp.endTime);
}

function checkPlayerDeaths(game) {
    game.players.forEach(player => {
        if (!player.isAlive) return;
        const pPos = getGridPos(player.x + (TILE_SIZE * 0.35), player.y + (TILE_SIZE * 0.35));
        for (const exp of game.explosions) {
            if (exp.coords.some(c => c.col === pPos.col && c.row === pPos.row)) {
                player.isAlive = false;
                break;
            }
        }
    });
}

function checkWinCondition(game) {
    const alivePlayers = game.players.filter(p => p.isAlive);
    if (alivePlayers.length <= 1 && game.status === 'active') {
        game.status = 'finished';
        const winner = alivePlayers.length === 1 ? alivePlayers[0] : null;
        broadcast(game, 'gameOver', {
             winnerNickname: winner ? winner.nickname : null,
             votes: 0,
             totalPlayers: game.players.length
        });
        game.rematch.timer = setTimeout(() => {
            broadcast(game, 'gameClosed', { message: 'Rematch time expired. Room closing.' });
            clearInterval(game.gameLoopInterval);
            delete games[game.id];
        }, REMATCH_TIMER);
    }
}

// --- WebSocket Connection Handling ---
wss.on('connection', (ws) => {
    ws.clientId = uuidv4();
    ws.send(JSON.stringify({ type: 'connected', payload: { clientId: ws.clientId } }));

    ws.on('message', (message) => {
        const { type, payload } = JSON.parse(message);
        const game = games[ws.gameId];

        switch (type) {
            case 'createGame': {
                const gameId = generateGameId();
                ws.gameId = gameId;
                games[gameId] = {
                    id: gameId,
                    clients: [ws],
                    players: [{ clientId: ws.clientId, nickname: payload.nickname, id: 1 }],
                    hostId: ws.clientId,
                    status: 'waiting',
                    rematch: { votes: new Set(), timer: null },
                };
                broadcast(games[gameId], 'lobbyUpdate', { gameId, players: games[gameId].players, hostId: ws.clientId });
                break;
            }
            case 'joinGame': {
                const gameToJoin = games[payload.gameId];
                if (!gameToJoin || gameToJoin.status !== 'waiting' || gameToJoin.clients.length >= 4 || gameToJoin.players.some(p => p.nickname.toLowerCase() === payload.nickname.toLowerCase())) {
                    let errorMsg = 'Could not join game.';
                    if (!gameToJoin) errorMsg = 'Game not found.';
                    else if (gameToJoin.status !== 'waiting') errorMsg = 'Game has already started.';
                    else if (gameToJoin.clients.length >= 4) errorMsg = 'Game is full.';
                    else if (gameToJoin.players.some(p => p.nickname.toLowerCase() === payload.nickname.toLowerCase())) errorMsg = 'Nickname is already taken.';
                    return ws.send(JSON.stringify({ type: 'error', payload: { message: errorMsg } }));
                }

                ws.gameId = payload.gameId;
                gameToJoin.clients.push(ws);
                gameToJoin.players.push({ clientId: ws.clientId, nickname: payload.nickname, id: gameToJoin.players.length + 1 });
                broadcast(gameToJoin, 'lobbyUpdate', { gameId: gameToJoin.id, players: gameToJoin.players, hostId: gameToJoin.hostId });
                break;
            }
            case 'startGame': {
                if (!game || ws.clientId !== game.hostId || game.players.length < 2) return;
                game.status = 'active';
                resetGame(game);
                game.gameLoopInterval = setInterval(() => gameLoop(game.id), GAME_TICK_RATE);
                break;
            }
            case 'keyUpdate': {
                if (!game || game.status !== 'active') return;
                const player = game.players.find(p => p.clientId === ws.clientId);
                if (player) player.keys = payload.keys;
                break;
            }
            case 'placeBomb': {
                if (!game || game.status !== 'active') return;
                const player = game.players.find(p => p.clientId === ws.clientId);
                if (!player || !player.isAlive) return;
                const { col, row } = getGridPos(player.x + TILE_SIZE * 0.35, player.y + TILE_SIZE * 0.35);
                if (game.gameMap[row][col] === 0) {
                    game.gameMap[row][col] = 3;
                    game.bombs.push({ col, row, power: player.bombPower, explodeTime: Date.now() + 3000 });
                }
                break;
            }
            case 'requestRematch': {
                if (!game || game.status !== 'finished') return;
                game.rematch.votes.add(ws.clientId);
                broadcast(game, 'rematchUpdate', { votes: game.rematch.votes.size, totalPlayers: game.players.length });
                if (game.rematch.votes.size === game.players.length && game.players.length > 1) {
                    clearTimeout(game.rematch.timer);
                    resetGame(game);
                }
                break;
            }
        }
    });

    ws.on('close', () => {
        const game = games[ws.gameId];
        if (!game) return;
        
        game.clients = game.clients.filter(client => client.clientId !== ws.clientId);
        
        if (game.clients.length === 0) {
            clearInterval(game.gameLoopInterval);
            clearTimeout(game.rematch.timer);
            delete games[ws.gameId];
            return;
        }
        
        if (ws.clientId === game.hostId) {
            game.hostId = game.clients[0].clientId;
        }

        const disconnectedPlayer = game.players.find(p => p.clientId === ws.clientId);
        if (disconnectedPlayer) {
            if (game.status === 'active') {
                disconnectedPlayer.isAlive = false;
            } else {
                game.players = game.players.filter(p => p.clientId !== ws.clientId);
            }
        }
        
        broadcast(game, 'lobbyUpdate', { gameId: game.id, players: game.players, hostId: game.hostId });
    });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Server is listening on port ${PORT}`));
