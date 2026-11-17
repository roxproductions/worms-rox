// Worms Rox! relay for Cloudflare Workers (free plan). One Durable Object fans messages out per room.
export class Hub {
  constructor(state) { this.state = state; }
  async fetch(req) {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Worms relay OK', { status: 200 });
    const pair = new WebSocketPair();
    this.state.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  webSocketMessage(ws, msg) {
    if (typeof msg !== 'string' || msg.length > 20000) return;
    let room = (ws.deserializeAttachment() || {}).room;
    if (!room) {
      try { const o = JSON.parse(msg); if (o.k === 'join' && typeof o.room === 'string') ws.serializeAttachment({ room: o.room.slice(0, 80) }); } catch (e) {}
      return;
    }
    for (const s of this.state.getWebSockets()) {
      if (s === ws) continue;
      const a = s.deserializeAttachment();
      if (a && a.room === room) { try { s.send(msg); } catch (e) {} }
    }
  }
  webSocketClose(ws) { try { ws.close(); } catch (e) {} }
  webSocketError(ws) { try { ws.close(); } catch (e) {} }
}
export default {
  async fetch(req, env) {
    return env.HUB.get(env.HUB.idFromName('all')).fetch(req);
  }
};
