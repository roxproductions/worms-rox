// Worms Rox! relay for Cloudflare Workers (free plan). One Durable Object fans messages out per room.
// Push alerts go out through ntfy.sh (free, iOS + Android apps). Players subscribe on alerts.html.
// Change the topics with Worker variables NTFY_TOPIC_WORMS / NTFY_TOPIC_GTA (the signup page shows them, so they are not a secret).
const TOPICS = { worms: 'worms-rox', gta: 'roxtown-carnage' };
const TITLES = { worms: 'Worms Rox!', gta: 'RoxTown Carnage' };
const COOLDOWN = 15 * 60 * 1000; // at most one alert per game every 15 minutes
export class Hub {
  constructor(state, env) { this.state = state; this.env = env; }
  async alert(game, who) {
    const last = (await this.state.storage.get('n_' + game)) || 0;
    if (Date.now() - last < COOLDOWN) return false;
    await this.state.storage.put('n_' + game, Date.now());
    const topic = (game === 'gta' ? this.env.NTFY_TOPIC_GTA : this.env.NTFY_TOPIC_WORMS) || TOPICS[game];
    const url = game === 'gta' ? (this.env.GTA_URL || 'https://roxproductions.se/games/crosstown/') : (this.env.WORMS_URL || 'https://roxproductions.se/games/worms/');
    try {
      await fetch('https://ntfy.sh/' + topic, { method: 'POST', body: (who ? who + ' is' : 'Someone is') + ' playing right now. Come join!',
        headers: { Title: TITLES[game] + ' – game on!', Tags: 'video_game', Click: url, Priority: 'default' } });
    } catch (e) {}
    return true;
  }
  async fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === '/notify') { // for other games (e.g. the GTA server): GET /notify?game=gta&name=Anna
      const g = u.searchParams.get('game') === 'gta' ? 'gta' : 'worms';
      const ok = await this.alert(g, (u.searchParams.get('name') || '').slice(0, 24).replace(/[^\w .-]/g, ''));
      return new Response(ok ? 'sent' : 'cooldown', { status: 200, headers: { 'Access-Control-Allow-Origin': '*' } });
    }
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Worms relay OK', { status: 200 });
    const pair = new WebSocketPair();
    this.state.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  webSocketMessage(ws, msg) {
    if (typeof msg !== 'string' || msg.length > 20000) return;
    let room = (ws.deserializeAttachment() || {}).room;
    if (!room) {
      try { const o = JSON.parse(msg); if (o.k === 'join' && typeof o.room === 'string') {
          const r = o.room.slice(0, 80); ws.serializeAttachment({ room: r });
          let n = 0; for (const s of this.state.getWebSockets()) { const a = s.deserializeAttachment(); if (a && a.room === r) n++; }
          if (n === 1 && !r.startsWith('test')) this.alert('worms', '').catch(() => {});
        } } catch (e) {}
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
