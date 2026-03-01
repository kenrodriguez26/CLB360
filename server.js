const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 8787;
const PUBLIC_DIR = process.cwd();

// --- 1. Servidor de Archivos Estáticos ---
const server = http.createServer((req, res) => {
    let urlPath = req.url === "/" ? "/index.html" : req.url.split('?')[0];
    const filePath = path.join(PUBLIC_DIR, urlPath);
    
    const ext = path.extname(filePath);
    const contentTypes = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript",
        ".css": "text/css"
    };
    const contentType = contentTypes[ext] || "text/plain";

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end("Not found");
            return;
        }
        res.writeHead(200, { "Content-Type": contentType });
        res.end(data);
    });
});

// --- 2. Servidor de Señalización (WebSockets) ---
const wss = new WebSocket.Server({ noServer: true });

// Manejar el "Upgrade" de HTTP a WebSocket
server.on("upgrade", (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
    });
});

let nextId = 1;
const rooms = new Map(); // nombre_sala -> { senderId, clients: Map }

wss.on("connection", (ws) => {
    const id = String(nextId++);
    ws.__id = id;
    ws.__room = null;
    ws.__role = null;

    console.log(`Cliente conectado: ID ${id}`);

    ws.on("message", (raw) => {
        let msg;
        try { msg = JSON.parse(String(raw)); } catch (e) { return; }

        if (msg.type === "join") {
            const roomName = String(msg.room || "clb360");
            const role = String(msg.role || "receiver");
            
            if (!rooms.has(roomName)) {
                rooms.set(roomName, { senderId: null, clients: new Map(), roles: new Map() });
            }
            const room = rooms.get(roomName);

            ws.__room = roomName;
            ws.__role = role;
            room.clients.set(id, ws);
            room.roles.set(id, role);

            if (role === "sender") {
                room.senderId = id;
                // Notificar a receivers existentes
                room.clients.forEach((cws, cid) => {
                    if (cid !== id && room.roles.get(cid) === "receiver") {
                        cws.send(JSON.stringify({ type: "sender-ready", id }));
                        ws.send(JSON.stringify({ type: "receiver-joined", id: cid }));
                    }
                });
            } else {
                // Notificar al sender si existe
                if (room.senderId && room.clients.has(room.senderId)) {
                    room.clients.get(room.senderId).send(JSON.stringify({ type: "receiver-joined", id }));
                    ws.send(JSON.stringify({ type: "sender-ready", id: room.senderId }));
                }
            }
            ws.send(JSON.stringify({ type: "joined", id, room: roomName, role }));
        }

        if (msg.type === "signal") {
            const room = rooms.get(ws.__room);
            if (!room) return;
            const target = room.clients.get(String(msg.to));
            if (target && target.readyState === WebSocket.OPEN) {
                target.send(JSON.stringify({ 
                    type: "signal", 
                    from: id, 
                    data: msg.data 
                }));
            }
        }
    });

    ws.on("close", () => {
        if (!ws.__room) return;
        const room = rooms.get(ws.__room);
        if (!room) return;

        room.clients.delete(id);
        if (ws.__role === "sender") {
            room.senderId = null;
            room.clients.forEach(cws => cws.send(JSON.stringify({ type: "sender-left" })));
        } else if (room.senderId && room.clients.has(room.senderId)) {
            room.clients.get(room.senderId).send(JSON.stringify({ type: "receiver-left", id }));
        }
        if (room.clients.size === 0) rooms.delete(ws.__room);
        console.log(`Cliente desconectado: ID ${id}`);
    });
});

// --- 3. Inicio del Servidor ---
server.listen(PORT, "0.0.0.0", () => {
    console.log(`Servidor CLB360 corriendo en puerto ${PORT}`);
});
