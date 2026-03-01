# CLB360 — Delta Gate Audio Router (v3)

## What v3 does (matching your request)
- **GUI is horizontal** on both Sender and Receiver (top action bars)
- **Sender has dropdowns** (Sender-only):
  - **Arrivals → Gate 1–4**
  - **Departures → Gate 1–4**
  - This enforces **max 2 gates active at once** (one for Arrivals, one for Departures; can be same gate)
- **Receiver has dropdown**:
  - Select **Gate 1–4**
  - Receiver **only shows that gate view**
  - Receiver plays Arrivals only if Sender routes Arrivals to that selected gate, and similarly for Departures
- Supports **5 devices**: **1 master (Sender)** + **up to 4 listeners (Receivers)**
- **Receiver volume controls**:
  - Master volume + Arrivals volume + Departures volume + mute buttons

## Files
- `index.html` — main Sender/Receiver app
- `preview.html` — client preview
- `server.js` — signaling + static server (`/ws`)
- `package.json` — Node deps (`ws`)

---

## Run (LAN test)
1) Install Node.js 18+
2) In this folder:
```bash
npm install
npm start
```
3) Sender opens:
- `http://<SENDER_LAN_IP>:8787/`
4) Receivers open the same URL on 4 devices:
- `http://<SENDER_LAN_IP>:8787/`

### Use
- Sender: click once (arms audio) → choose Arrivals/Departures routing gates → load audio files → Start → Play
- Receivers: select Gate → Connect → Enable & Play

---

## Global deployment (server-based)
For “any location” playback over the internet you need:
1) A public server (VPS) with a domain name
2) HTTPS for the website (recommended)
3) A WebSocket proxy for `/ws`
4) **TURN** for reliability across strict NATs (recommended)

### Deploy on a VPS
- Copy this folder to a VPS
- Run:
```bash
npm install
npm start
```
- Put it behind HTTPS with a reverse proxy (Caddy example):

```
yourdomain.com {
  encode gzip
  reverse_proxy /ws* localhost:8787
  reverse_proxy localhost:8787
}
```

In the app (Sender and Receivers):
- Signaling URL: `wss://yourdomain.com/ws`
- ICE Servers: choose **TURN** and paste TURN JSON

### TURN JSON example
```json
[
  { "urls": ["turn:yourdomain.com:3478?transport=udp"], "username": "user", "credential": "pass" },
  { "urls": ["turn:yourdomain.com:3478?transport=tcp"], "username": "user", "credential": "pass" }
]
```

> Note: “Public STUN” uses external Google STUN. For strict “no third-party,” use self-hosted TURN.

---

## Notes
- WebRTC is real-time but not guaranteed sample-locked across devices.
- Receiver Buffer trades latency for stability.
- Delta logo is a placeholder mark for layout.
