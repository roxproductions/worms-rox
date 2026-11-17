// Minimal WebSocket relay for Worms Rox!. Run: npm install && node relay-server.js
// Clients that send {k:'join',room} are grouped by room; every other message is forwarded to the rest of that room.
const { WebSocketServer } = require('ws');
const port = +process.env.PORT || 8787;
const wss = new WebSocketServer({ port, maxPayload: 64 * 1024 });
const rooms = new Map();
wss.on('connection', ws => {
  ws.room = null;
  ws.on('message', buf => {
    let m; try { m = JSON.parse(buf); } catch (e) { return; }
    if (m.k === 'join' && typeof m.room === 'string' && m.room.length < 64) {
      ws.room = m.room; if (!rooms.has(ws.room)) rooms.set(ws.room, new Set()); rooms.get(ws.room).add(ws); return;
    }
    if (!ws.room || m.room !== ws.room) return;
    const s = buf.toString();
    for (const o of rooms.get(ws.room)) if (o !== ws && o.readyState === 1) o.send(s);
  });
  ws.on('close', () => { if (ws.room && rooms.has(ws.room)) { const r = rooms.get(ws.room); r.delete(ws); if (!r.size) rooms.delete(ws.room); } });
});
console.log('Worms relay listening on ws://0.0.0.0:' + port);
