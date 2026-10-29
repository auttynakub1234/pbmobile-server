# Point Blank Mobile (PBMobile) - Dedicated Server & Web Client

Point Blank Mobile (PBMobile) Custom Dedicated Game Server and Standalone Web Client with real-time 3D multiplayer synchronization, custom room creation, bot match options, and local asset caching.

---

## 🌟 Key Features

- **🎮 Dual WebSocket Architecture:**
  - **Lobby Server (`/ws`):** Player authentication, custom room management, chat, matchmaking, profile, and inventory.
  - **Battle Server (`/b{roomId}`):** High-frequency 30Hz real-time entity state synchronization (position, yaw, pitch, animations, hitboxes, combat damage, headshots, and kill broadcasts).
- **🗺️ Complete 12 Map Stages & 3D Meshes:**
  - Pre-cached 3D world meshes, stages, textures, and sky models for all 12 official maps:
    * *Downtown, Downtown 2, Luxville, BurningHall, Crackdown, Library, Hospital, NPort, BlackPanther, Giran2, Helispot, Uptown*.
- **👥 Real-time Multiplayer & Bot Match Modes:**
  - Seamless 2-16 player online synchronization with Three.js client renderer.
  - Custom room creation supporting:
    * Team Deathmatch (Mata-Mata)
    * Bomb Mission (Destruição)
    * Bot mode toggle (AI difficulty 1-10, customizable bot count per team).
- **⚡ Smart Local Asset Resolution:**
  - Local asset resolver serving 3D meshes, textures, sounds, and UI atlases with 0ms latency.
  - Automatic fallback between standard and `{ rs: 1 }` mesh hash formats.
  - Cloudflare bypass and upstream caching proxy for newly requested assets.
- **🛠️ Management & Monitoring Tools:**
  - **Admin Studio (`/admin`):** Live dashboard showing online players, active rooms, memory usage, tick rate, and user database.
  - **3D Viewer (`/viewer`):** Interactive WebGL 3D model viewer for inspecting weapons and map stage geometry.

---

## 🚀 Quick Start

### 1. Prerequisites
- [Node.js](https://nodejs.org/) v18.0.0 or higher
- Linux / macOS / Windows

### 2. Installation
```bash
git clone https://github.com/auttynakub1234/pbmobile-server.git
cd pbmobile-server
npm install
```

### 3. Start Server
Run directly with Node:
```bash
# Starts HTTP server & WebSockets on PORT 3000
npm start
```

Or run via the included helper scripts:
```bash
./start_server.sh   # Starts server in background
./stop_server.sh    # Stops server
```

Or using **PM2** (recommended for production):
```bash
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
```

---

## 🌐 Endpoints

| URL Path | Protocol | Description |
| :--- | :--- | :--- |
| `http://localhost:3000/` | HTTP | Main Web Lobby & Home Screen |
| `http://localhost:3000/jogo` | HTTP | In-game 3D Battlefield (Three.js) |
| `http://localhost:3000/admin` | HTTP | Admin Control Center & Real-time Stats |
| `http://localhost:3000/viewer` | HTTP | 3D Weapon & Stage Model Viewer |
| `ws://localhost:3000/ws` | WebSocket | Lobby Socket (Handshake, Rooms, Chat) |
| `ws://localhost:3000/b{roomId}` | WebSocket | Battle Dedicated Socket (30Hz Combat Sync) |

---

## 🧪 Verification & Automated Tests

Run the included automated tests to verify server stability and multiplayer networking:

```bash
# Verify real-time 2-player 3D position & yaw sync
node test_visibility.js

# Verify combat, weapon firing, damage registration, and kill broadcast
node test_online.js
```

---

## 📁 Project Structure

```
├── pb_server.js          # Core HTTP + WebSocket Server engine
├── pb_database.js        # File-backed database (users, rooms, inventory)
├── bundle.js             # Patched 3D game engine client (Three.js)
├── client.patched.js     # Patched Web lobby interface
├── index.html            # Main web portal and lobby UI
├── jogo.html             # 3D game battlefield page
├── viewer.html           # 3D model studio viewer
├── nginx_pbmobile.conf   # Production Nginx reverse proxy configuration
├── pbmobile.service      # Systemd service unit definition
├── test_visibility.js    # Automated 2-player 3D visibility & sync test
├── test_online.js        # Automated combat and damage test
├── a/                    # Local cached assets (meshes, textures, stages, sounds)
│   ├── mesh/             # 3D world meshes and sky models
│   ├── stage/            # Stage definitions & spawn coordinate JSONs
│   ├── tex/              # Map and weapon textures
│   └── weapon/           # 3D weapon models
└── static/               # UI atlases, sounds, and client scripts
```

---

## 📄 License
ISC License
