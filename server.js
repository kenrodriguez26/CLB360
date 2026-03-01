const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 8787;
const PUBLIC_DIR = process.cwd();

// --- Servidor de Archivos ---
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  
  // Ruta de salud para Railway
  if (url.pathname === "/healthz") {
    res.writeHead(200);
    return res.end("ok");
  }

  // Servir archivos estáticos
  let filename = url.pathname === "/" ? "index.html" : url.pathname.substring(1);
  const filePath = path.join(PUBLIC_DIR, filename);
  const ext = path.extname(filePath);
  const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

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

// --- Servidor de Señalización ---
const wss = new WebSocket.Server({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  // Aceptamos cualquier ruta para evitar errores de 404 en el socket
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

let nextId = 1;
const rooms = new Map();

wss.on("connection", (ws) => {
  const id = String(nextId++);
  ws.__id = id;
  console.log(`[Connect] ID: ${id}`);

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch(e) { return; }

    if (msg.type === "join") {
      const roomName = msg.room || "clb360";
      ws.__room = roomName;
      ws.__role = msg.role;
      if (!rooms.has(roomName)) rooms.set(roomName, { senderId: null, clients: new Map() });
      const room = rooms.get(roomName);
      room.clients.set(id, ws);

      if (msg.role === "sender") room.senderId = id;
      
      // Notificar a otros en la sala
      room.clients.forEach((cws, cid) => {
        if (cid !== id) {
           if (msg.role === "sender") cws.send(JSON.stringify({type:"sender-ready", id}));
           if (room.senderId === id) ws.send(JSON.stringify({type:"receiver-joined", id: cid}));
        }
      });
      ws.send(JSON.stringify({ type: "joined", id, room: roomName }));
    }

    if (msg.type === "signal") {
      const room = rooms.get(ws.__room);
      if (!room) return;
      const target = room.clients.get(String(msg.to));
      if (target) target.send(JSON.stringify({ type: "signal", from: id, data: msg.data }));
    }
  });

  ws.on("close", () => {
    console.log(`[Disconnect] ID: ${id}`);
    if (ws.__room && rooms.has(ws.__room)) {
      const room = rooms.get(ws.__room);
      room.clients.delete(id);
      if (room.clients.size === 0) rooms.delete(ws.__room);
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`SERVER RUNNING ON PORT ${PORT}`);
});
