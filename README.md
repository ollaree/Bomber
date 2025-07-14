# Bomberman Online

A real-time multiplayer online game inspired by the classic Bomberman series, built with Node.js, Express, and WebSockets. The game is deployed at [https://bomber-a4og.onrender.com/](https://bomber-a4og.onrender.com/) and the source code is available at [https://github.com/ollaree/Bomber](https://github.com/ollaree/Bomber).

## Features

* **Real-time Multiplayer:** Play with up to 4 players in a single game session
* **Private Lobbies:** Create private games with unique 5-digit game codes for friend groups
* **Classic Gameplay:** Drop bombs, break destructible crates, and trap opponents to be the last one standing
* **Responsive Layout:** Adaptive game interface optimized for different screen sizes and devices
* **Live Nicknames:** Player identifiers displayed above character sprites in real-time

## Technical Architecture

### Backend Stack
- **Node.js** - JavaScript runtime for server-side execution
- **Express.js** - Web application framework for HTTP server and static file serving
- **WebSocket (ws)** - Low-latency bidirectional communication for real-time gameplay
- **UUID** - Unique identifier generation for client sessions and game rooms

### Game Engine
- **Canvas-based Rendering** - HTML5 Canvas for 2D graphics rendering
- **Client-side Prediction** - Smooth movement with server reconciliation
- **State Synchronization** - Authoritative server with client state updates
- **Collision Detection** - Grid-based physics system for player and bomb interactions

### Network Protocol
- **WebSocket Events** - Custom message protocol for game state updates
- **Room Management** - Lobby system with unique game codes
- **Player Synchronization** - Real-time position and action broadcasting

## How to Play

1. **Access the Game:** Navigate to [https://bomber-a4og.onrender.com/](https://bomber-a4og.onrender.com/)
2. **Enter a Nickname:** Choose a display name for your character
3. **Create or Join:**
   * **Create Game:** Generates a new lobby with a unique 5-digit game code
   * **Join Game:** Enter an existing game code to join a friend's lobby
4. **Lobby:** Wait for players to join. The host can start the match with minimum 2 players
5. **Controls:**
   * **Movement:** Arrow Keys or WASD
   * **Place Bomb:** Spacebar
6. **Objective:** Survive and be the last player standing

## Game Mechanics

- **Bomb System:** Timed explosives with cross-pattern blast radius
- **Destructible Environment:** Break crates to clear paths and find power-ups
- **Grid-based Movement:** Classic tile-based positioning system
- **Elimination Rules:** Players are eliminated when caught in bomb explosions

The game maintains the classic Bomberman formula while leveraging modern web technologies for seamless multiplayer experience across devices.
