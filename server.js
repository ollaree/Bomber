const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

const app = express();
// Serve the graphics folder and the main index.html file
// This setup is correct for serving your assets.
app.use('/graphics', express.static(path.join(__dirname, 'graphics')));
app.use(express.static(__dirname)); // Serve other static files like index.html from root

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// --- Game Configuration ---
const TILE_SIZE = 48;
const MAP_WIDTH_TILES = 17;
const MAP_HEIGHT_TILES = 13;
const PLAYER_SPEED = 2;
const GAME_TICK_RATE = 1000 / 60; // 60 updates per second

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
    [2, 0, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 0, 2, 0, 2],
    [2, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 2],
    [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
];

// In-memory storage for games
const games = {};

function generateGameId() {
    const chars = 'ABCDEFGHIJKLMNPQRSTUVWXYZ123456789';
    let result = '';
    do {
        result = '';
        for (let i = 0; i < 5; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
    } while (games[result]);
    return result;
}

// --- Server-Side Game Loop ---
function gameLoop(gameId) {
    const game = games[gameId];
    if (!game || game.status !== 'active') return;

    const now = Date.now();
    const deltaTime = now - game.lastUpdateTime;
    game.lastUpdateTime = now;

    // Update game state
    handlePlayerMovement(game);
    updateBombs(game, deltaTime);
    updateExplosions(game, deltaTime);
    checkPlayerDeaths(game);
    checkWinCondition(game);

    // Broadcast the updated state to all players in the game
    const gameState = {
        players: game.players,
        bombs: game.bombs,
        explosions: game.explosions,
        gameMap: game.gameMap,
        status: game.status,
        winner: game.winner
    };
    
    const message = JSON.stringify({ type: 'gameUpdate', payload: gameState });
    if (game.player1 && game.player1.readyState === 1) game.player1.send(message);
    if (game.player2 && game.player2.readyState === 1) game.player2.send(message);
}

// --- Game Logic (runs on server) ---
function getGridPos(x, y) {
    return {
        col: Math.floor((x + TILE_SIZE / 2) / TILE_SIZE),
        row: Math.floor((y + TILE_SIZE / 2) / TILE_SIZE)
    };
}

function checkCollision(game, player, x, y) {
    const pWidth = TILE_SIZE * 0.7;
    const pHeight = TILE_SIZE * 0.7;

    // Get the set of tiles the player is CURRENTLY occupying based on their bounding box.
    const currentOccupiedTiles = new Set();
    const currentCorners = [
        { x: player.x, y: player.y },
        { x: player.x + pWidth, y: player.y },
        { x: player.x, y: y + pHeight },
        { x: player.x + pWidth, y: player.y + pHeight }
    ];
    for (const corner of currentCorners) {
        const col = Math.floor(corner.x / TILE_SIZE);
        const row = Math.floor(corner.y / TILE_SIZE);
        currentOccupiedTiles.add(`${col},${row}`);
    }

    // Check the corners of the PROPOSED new position.
    const futureCorners = [
        { x: x, y: y },
        { x: x + pWidth, y: y },
        { x: x, y: y + pHeight },
        { x: x + pWidth, y: y + pHeight }
    ];

    for (const corner of futureCorners) {
        const col = Math.floor(corner.x / TILE_SIZE);
        const row = Math.floor(corner.y / TILE_SIZE);

        // Check for out-of-bounds.
        if (col < 0 || col >= MAP_WIDTH_TILES || row < 0 || row >= MAP_HEIGHT_TILES) return true;
        
        const tile = game.gameMap[row][col];
        
        // Check for collision with walls or crates.
        if (tile === 1 || tile === 2) return true;
        
        // Check for collision with bombs.
        if (tile === 3) {
            // Allow movement if the bomb is on a tile the player is already standing on.
            // This allows the player to move OFF the bomb tile.
            if (currentOccupiedTiles.has(`${col},${row}`)) {
                continue;
            }
            // Disallow movement if it's a new bomb tile the player is not currently on.
            return true;
        }
    }
    
    // No collision detected.
    return false;
}

function handlePlayerMovement(game) {
    game.players.forEach(player => {
        if (!player.isAlive) return;

        let dx = 0;
        let dy = 0;

        if (player.keys.up) { dy = -PLAYER_SPEED; player.direction = 'n'; }
        else if (player.keys.down) { dy = PLAYER_SPEED; player.direction = 's'; }
        else if (player.keys.left) { dx = -PLAYER_SPEED; player.direction = 'w'; }
        else if (player.keys.right) { dx = PLAYER_SPEED; player.direction = 'e'; }

        if (dx === 0 && dy === 0) return;

        if (!checkCollision(game, player, player.x + dx, player.y)) player.x += dx;
        if (!checkCollision(game, player, player.x, player.y + dy)) player.y += dy;
    });
}

function updateBombs(game, deltaTime) {
    game.bombs.forEach(bomb => {
        bomb.timer -= deltaTime;
        if (bomb.timer <= 0) {
            // Explode
            game.gameMap[bomb.row][bomb.col] = 0; // Clear map tile
            createExplosion(game, bomb.col, bomb.row, bomb.power);
        }
    });
    game.bombs = game.bombs.filter(b => b.timer > 0);
}

function createExplosion(game, col, row, power) {
    const blastCoords = [];
    blastCoords.push({ col: col, row: row, type: 'center' });
    const dirs = [{x:0, y:1, type:'s'}, {x:0, y:-1, type:'n'}, {x:1, y:0, type:'e'}, {x:-1, y:0, type:'w'}];
    
    for (const dir of dirs) {
        for (let i = 1; i <= power; i++) {
            const nextCol = col + dir.x * i;
            const nextRow = row + dir.y * i;
            if (nextCol < 0 || nextCol >= MAP_WIDTH_TILES || nextRow < 0 || nextRow >= MAP_HEIGHT_TILES) break;
            
            const tile = game.gameMap[nextRow][nextCol];
            if (tile === 2) break;
            
            let blastType = (i === power) ? dir.type : ((dir.x !== 0) ? 'h' : 'v');
            blastCoords.push({ col: nextCol, row: nextRow, type: blastType });
            
            if (tile === 1) {
                game.gameMap[nextRow][nextCol] = 0; // Destroy crate
                break;
            }
        }
    }
    game.explosions.push({ coords: blastCoords, timer: 500 });
}

function updateExplosions(game, deltaTime) {
    game.explosions.forEach(exp => exp.timer -= deltaTime);
    game.explosions = game.explosions.filter(exp => exp.timer > 0);
}

function checkPlayerDeaths(game) {
    game.players.forEach(player => {
        if (!player.isAlive) return;
        const playerPos = getGridPos(player.x, player.y);
        for (const explosion of game.explosions) {
            if (explosion.coords.some(coord => coord.col === playerPos.col && coord.row === playerPos.row)) {
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
        if (alivePlayers.length === 1) {
            game.winner = alivePlayers[0].id;
        } else {
            game.winner = 'draw';
        }
    }
}


// --- WebSocket Connection Handling ---
wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        const { type, payload } = JSON.parse(message);
        const game = games[ws.gameId];

        switch (type) {
            case 'createGame': {
                const gameId = generateGameId();
                ws.gameId = gameId;
                ws.playerNum = 1;

                games[gameId] = {
                    player1: ws,
                    player2: null,
                    players: [],
                    bombs: [],
                    explosions: [],
                    gameMap: JSON.parse(JSON.stringify(initialMapLayout)),
                    status: 'waiting', // waiting, active, finished
                    winner: null,
                    gameLoopInterval: null,
                    lastUpdateTime: Date.now()
                };
                ws.send(JSON.stringify({ type: 'gameCreated', payload: { gameId } }));
                break;
            }

            case 'joinGame': {
                const gameToJoin = games[payload.gameId];
                if (gameToJoin && !gameToJoin.player2) {
                    ws.gameId = payload.gameId;
                    ws.playerNum = 2;
                    gameToJoin.player2 = ws;
                    
                    // Initialize players
                    gameToJoin.players = [
                        { id: 1, x: 1 * TILE_SIZE, y: 1 * TILE_SIZE, direction: 's', isAlive: true, bombsMax: 1, bombPower: 2, keys: {} },
                        { id: 2, x: (MAP_WIDTH_TILES - 2) * TILE_SIZE, y: (MAP_HEIGHT_TILES - 2) * TILE_SIZE, direction: 's', isAlive: true, bombsMax: 1, bombPower: 2, keys: {} }
                    ];
                    
                    gameToJoin.status = 'active';
                    
                    // Notify both players game has started
                    const startMessage = JSON.stringify({ type: 'gameStarted', payload: { yourId: 1 } });
                    if (gameToJoin.player1) gameToJoin.player1.send(startMessage);
                    
                    const startMessage2 = JSON.stringify({ type: 'gameStarted', payload: { yourId: 2 } });
                    if (gameToJoin.player2) gameToJoin.player2.send(startMessage2);

                    // Start the game loop
                    gameToJoin.lastUpdateTime = Date.now();
                    gameToJoin.gameLoopInterval = setInterval(() => gameLoop(payload.gameId), GAME_TICK_RATE);

                } else {
                    ws.send(JSON.stringify({ type: 'error', payload: { message: 'Game not found or is full.' } }));
                }
                break;
            }

            case 'keyUpdate': {
                if (game && game.players[ws.playerNum - 1]) {
                    game.players[ws.playerNum - 1].keys = payload.keys;
                }
                break;
            }

            case 'placeBomb': {
                if (!game || !game.players[ws.playerNum - 1] || !game.players[ws.playerNum - 1].isAlive) return;

                const player = game.players[ws.playerNum - 1];
                const activeBombs = game.bombs.filter(b => b.ownerId === player.id).length;
                if (activeBombs >= player.bombsMax) return;

                const { col, row } = getGridPos(player.x, player.y);
                if (game.gameMap[row][col] === 0) {
                    game.gameMap[row][col] = 3; // Mark map with bomb
                    game.bombs.push({
                        col, row,
                        power: player.bombPower,
                        ownerId: player.id,
                        timer: 3000
                    });
                }
                break;
            }
        }
    });

    ws.on('close', () => {
        const game = games[ws.gameId];
        if (game) {
            // Stop the game loop and notify other player
            clearInterval(game.gameLoopInterval);
            const otherPlayer = ws.playerNum === 1 ? game.player2 : game.player1;
            if (otherPlayer && otherPlayer.readyState === 1) {
                otherPlayer.send(JSON.stringify({ type: 'opponentDisconnected' }));
            }
            // Clean up game
            delete games[ws.gameId];
        }
    });
});

// *** CHANGE FOR RENDER.COM DEPLOYMENT ***
// Use the port provided by the environment (Render) or default to 8080 for local development.
// Listen on '0.0.0.0' to be accessible in a containerized environment.
const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is listening on port ${PORT}`);
});

