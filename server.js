const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 8787;
const PUBLIC_DIR = process.cwd();

// --- 1. Servidor de Archivos Estáticos ---
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  
  if (url.pathname === "/healthz") {
    res.writeHead(200);
    return res.end("ok");
  }

  let filename = (url.pathname === "/" || url.pathname === "/index.html") ? "index.html" : url.pathname.substring(1);
  const filePath = path.join(PUBLIC_DIR, filename);
  const ext = path.extname(filePath);
  const contentTypes = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" };

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
    } else {
      res.writeHead(200, { "Content-Type": contentTypes[ext] || "text/plain" });
      res.end(data);
    }
  });
});

// --- 2. Servidor de Señalización (WebSockets) ---
const wss = new WebSocket.Server({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  // Esto permite que el cliente conecte a wss://tu-app.up.railway.app/ws o a la raíz
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

let nextId = 1;
const rooms = new Map();

function send(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch(e) {} }

wss.on("connection", (ws) => {
  const id = String(nextId++);
  ws.__id = id;
  console.log(`[Connect] ID: ${id}`);

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch(e) { return; }

    if (msg.type === "join") {
      const roomName = msg.room || "clb360";
      const role = msg.role || "receiver";
      ws.__room = roomName;
      ws.__role = role;

      if (!rooms.has(roomName)) {
        rooms.set(roomName, { senderId: null, clients: new Map(), roles: new Map() });
      }
      const room = rooms.get(roomName);
      room.clients.set(id, ws);
      room.roles.set(id, role);

      if (role === "sender") {
        room.senderId = id;
        room.clients.forEach((cws, cid) => {
          if (cid !== id && room.roles.get(cid) === "receiver") {
            send(cws, { type: "sender-ready", id });
            send(ws, { type: "receiver-joined", id: cid });
          }
        });
      } else if (room.senderId) {
        const sws = room.clients.get(room.senderId);
        if (sws) {
          send(sws, { type: "receiver-joined", id });
          send(ws, { type: "sender-ready", id: room.senderId });
        }
      }
      send(ws, { type: "joined", id, room: roomName, role });
    }

    if (msg.type === "signal") {
      const room = rooms.get(ws.__room);
      if (!room) return;
      const target = room.clients.get(String(msg.to));
      if (target && target.readyState === WebSocket.OPEN) {
        send(target, { type: "signal", from: id, data: msg.data });
      }
    }
  });

  ws.on("close", () => {
    console.log(`[Disconnect] ID: ${id}`);
    const room = rooms.get(ws.__room);
    if (room) {
      room.clients.delete(id);
      room.roles.delete(id);
      if (ws.__role === "sender") {
        room.senderId = null;
        room.clients.forEach(cws => send(cws, { type: "sender-left" }));
      } else if (room.senderId) {
        const sws = room.clients.get(room.senderId);
        if (sws) send(sws, { type: "receiver-left", id });
      }
      if (room.clients.size === 0) rooms.delete(ws.__room);
    }
  });
});

// --- 3. Ejecución ---
server.listen(PORT, "0.0.0.0", () => {
  console.log(`SERVER RUNNING ON PORT ${PORT}`);
});
