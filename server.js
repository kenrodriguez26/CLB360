// server.js (v3)
// Self-hosted signaling + static file server
// - Serves index.html and preview.html
// - WebSocket endpoint at /ws
// - One sender per room, many receivers
// - Sends receiver-joined/receiver-left notifications to sender
// - Sends sender-ready + senderId to receivers

const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 8787;
const PUBLIC_DIR = process.cwd();

function serveFile(res, filename, contentType) {
  const filePath = path.join(PUBLIC_DIR, filename);
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found: " + filename);
      return;
    }
    res.writeHead(200, { "Content-Type": contentType });
    res.end(buf);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/" || url.pathname === "/index.html") return serveFile(res, "index.html", "text/html; charset=utf-8");
  if (url.pathname === "/preview.html") return serveFile(res, "preview.html", "text/html; charset=utf-8");
  if (url.pathname === "/healthz") { res.writeHead(200, { "Content-Type": "text/plain" }); res.end("ok"); return; }
  res.writeHead(404); res.end("Not found");
});

const wss = new WebSocket.Server({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname !== "/ws") { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});

let nextId = 1;
const rooms = new Map(); // room -> { senderId, clients: Map(id->ws), roles: Map(id->role) }
function getRoom(name){
  if (!rooms.has(name)) rooms.set(name, { senderId: null, clients: new Map(), roles: new Map() });
  return rooms.get(name);
}
function send(ws, obj){ try { ws.send(JSON.stringify(obj)); } catch {} }

wss.on("connection", (ws) => {
  const id = String(nextId++);
  ws.__id = id;
  ws.__room = null;
  ws.__role = null;

  ws.on("message", (raw) => {
    let msg; try{ msg = JSON.parse(String(raw)); }catch{ return; }

    if (msg.type === "join"){
      const roomName = String(msg.room || "clb360");
      const role = String(msg.role || "receiver");
      const room = getRoom(roomName);

      ws.__room = roomName;
      ws.__role = role;

      room.clients.set(id, ws);
      room.roles.set(id, role);

      if (role === "sender"){
        room.senderId = id;
        // tell existing receivers that sender is ready
        for (const [cid, cws] of room.clients){
          if (cid === id) continue;
          if (room.roles.get(cid) === "receiver"){
            send(cws, { type: "sender-ready", id });
            send(ws, { type:"receiver-joined", id: cid });
          }
        }
      } else {
        // receiver joined: notify sender (if exists) and tell receiver senderId
        if (room.senderId && room.clients.has(room.senderId)){
          send(room.clients.get(room.senderId), { type:"receiver-joined", id });
          send(ws, { type:"sender-ready", id: room.senderId });
        }
      }

      send(ws, { type:"joined", id, room: roomName, role, senderId: room.senderId });
      return;
    }

    if (msg.type === "signal"){
      const roomName = String(msg.room || ws.__room || "clb360");
      const room = getRoom(roomName);
      const to = String(msg.to);
      const from = String(msg.from || ws.__id);

      const target = room.clients.get(to);
      if (target && target.readyState === WebSocket.OPEN){
        send(target, { type:"signal", room: roomName, to, from, data: msg.data });
      }
      return;
    }
  });

  ws.on("close", () => {
    const roomName = ws.__room;
    if (!roomName) return;
    const room = getRoom(roomName);

    room.clients.delete(ws.__id);
    room.roles.delete(ws.__id);

    if (ws.__role === "receiver" && room.senderId && room.clients.has(room.senderId)){
      send(room.clients.get(room.senderId), { type:"receiver-left", id: ws.__id });
    }
    if (room.senderId === ws.__id){
      room.senderId = null;
      for (const [cid, cws] of room.clients){
        if (room.roles.get(cid) === "receiver") send(cws, { type:"sender-left" });
      }
    }
    if (room.clients.size === 0) rooms.delete(roomName);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`CLB360 Delta Gate Audio Router v3
  http://0.0.0.0:${PORT}/
  WebSocket: ws://<HOST>:${PORT}/ws
`);
});
