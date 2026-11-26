/* ===================== MULTIPLAYER: Worm Island over the Worms Rox room =====================
   The page that hosts this game (worms.html) owns the room connection and relays messages through postMessage:
     island -> host: {island:'net', d:{t,...}}   host -> island: {islandNet:'init'|'peers'|'msg', ...}
   Every player simulates themselves. Other players are "net worms": entries in BOTS with .net=true, driven by
   their broadcast state. Shooters detect hits against those worms and tell the victim ('h'); the victim applies
   the damage, dies, and announces it ('d'). Grenades are thrown on every client from one 'g' message. */
const NET = window.NET = { on: false, me: null, room: '', name: '', count: 0, acc: 0, silent: false };
(function () {
  const byPeer = new Map(), PAL = [0x3fa0ff, 0xff9a3a, 0xa266ff, 0x4cd964, 0xff5a7a, 0xffd84a, 0x2fd6c8, 0xe8e8f0];
  const hash = s => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
  const r2 = v => Math.round(v * 100) / 100, V3 = (x, y, z) => new T.Vector3(x, y, z);
  const send = (t, o) => { if (!NET.on) return; o = o || {}; o.t = t; try { parent.postMessage({ island: 'net', d: o }, '*'); } catch (e) { } };
  NET.send = send;
  NET.leader = () => { if (!NET.on || !NET.me) return true; for (const id of byPeer.keys()) if (id < NET.me) return false; return true; };

  function setW(b, w) {
    if (b.w === w) return; b.w = w; const g = b.m.gun;
    if (w === 1) botGun(b, 'uzi'); else if (w === 2) botGun(b, 'shotgun');
    else { g.clear(); if (w === 0) { const bt = new T.Mesh(new T.CylinderGeometry(.07, .12, 1.4, 10), MS(0xc9a46a, .6)); bt.rotation.x = Math.PI / 2 - .55; bt.position.set(0, .35, .5); g.add(bt); } }
  }
  function add(peer, name) {
    const col = PAL[hash(peer) % PAL.length], m = makeWorm(col, name); sc.add(m.g); m.g.visible = false;
    const b = { net: true, peer, name, col, kind: 'uzi', m, x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, vx: 0, vz: 0, vy: 0, yaw: 0, tyaw: 0, pitch: 0, hp: 100, dead: true, rt: 0, ground: true, kills: 0, deaths: 0, burst: 0, bcd: 0, react: 0, tgt: null, ph: rnd(6.28), stuck: 0, camStep: 0, dodgeCD: 1, lean: 0, flinch: 0, flash: 0, land: 0, saw: false, hitT: 0, recent: 0, exT: 0, ex: null, kick: 0, burstT: 0, corpse: null, wasG: true, blink: rnd(2, 5), blinkT: 0, w: -1, seen: false, last: 0 };
    setW(b, 1); BOTS.push(b); byPeer.set(peer, b); return b;
  }
  function remove(b, quiet) {
    const i = BOTS.indexOf(b); if (i >= 0) BOTS.splice(i, 1); sc.remove(b.m.g); if (b.ropeM) { sc.remove(b.ropeM); sc.remove(b.hookM); } if (b.skiM) sc.remove(b.skiM); if (window.FT) FT.netRideEnd(b); byPeer.delete(b.peer); b.corpse = null;
    if (!quiet) feed(b.name + ' left the island');
  }
  function revive(b) {
    b.x = b.tx; b.y = b.ty; b.z = b.tz; b.yaw = b.tyaw; b.vx = b.vz = b.vy = 0; b.dead = false; b.corpse = null; b.hp = 100; b.homer = false;
    const m = b.m; m.g.visible = true; m.g.scale.setScalar(.9); m.g.rotation.x = 0; m.hbFg.scale.x = 1.44; m.hbFg.material.color.set(0x6bff6b); m.body.rotation.set(0, 0, 0); m.body.scale.set(1, 1, 1);
    m.head.visible = true; m.head.scale.set(1, 1, 1); b.balloon = null; m.label.visible = m.hbBg.visible = m.hbFg.visible = true; b.flinch = b.flash = b.land = b.hitT = b.recent = 0;
    emote(b, 'surprised', '😮', .9); spawnFx(b.x, b.y, b.z, b.col); snd('spawn', b.x, b.y, b.z);
  }
  function away(b) { if (window.FT) FT.netRideEnd(b); b.ride = false; b.rope = null; b.ski = false; if (b.skiM) b.skiM.visible = false; if (b.ropeM) b.ropeM.visible = b.hookM.visible = false; if (b.dead) return; b.dead = true; b.corpse = null; b.m.g.visible = false; b.balloon = null; b.m.head.scale.set(1, 1, 1); }
  function onState(b, d) {
    b.last = S.t; const a = d.a, fl = a[6] | 0;
    b.tx = a[0]; b.ty = a[1]; b.tz = a[2]; b.tyaw = a[3]; b.pitch = a[4]; setW(b, a[5] | 0); b.tg = !!(fl & 8); b.hp = a[7];
    b.paused = !!(fl & 256); b.ski = !!(fl & 512); b.ride = !!(fl & 4); b.rideA = b.ride ? [a[10] || 0, a[11] || 0, a[12] || 0, a[13] || 0] : null; b.rope = (fl & 64) ? [a[10], a[11], a[12]] : null;
    if (!b.ride && window.FT) FT.netRideEnd(b);
    if (a[8] !== b.kills || a[9] !== b.deaths) { b.kills = a[8]; b.deaths = a[9]; scoreCheck(); }
    if (fl & 32) { away(b); b.seen = true; return; }
    if (!b.seen) { b.seen = true; b.x = b.tx; b.y = b.ty; b.z = b.tz; b.yaw = b.tyaw; }
    if ((fl & 1) && b.dead) revive(b);
    else if (!(fl & 1) && !b.dead) { killBot(b, null, 'the sea', false, false); }
  }
  function award(victim, wn, head, gibbed) { // I killed a real player
    P.kills++; P.streak++; P.multi = (S.t - P.lastKill < 3.2) ? P.multi + 1 : 1; P.lastKill = S.t;
    feed('YOU ▸ ' + victim.name + ' [' + wn + ']' + (gibbed ? ' GIBBED' : head ? ' HEADSHOT' : ''));
    const MULTI = ['', '', 'DOUBLE KILL!', 'MULTI KILL!', 'ULTRA KILL!', 'MONSTER KILL!'], SPREE = { 3: 'KILLING SPREE!', 5: 'RAMPAGE!', 7: 'DOMINATING!', 9: 'UNSTOPPABLE!', 11: 'GODLIKE!' };
    let line = null; if (P.multi >= 2) line = MULTI[Math.min(5, P.multi)]; else if (SPREE[P.streak]) line = SPREE[P.streak]; else if (!S.firstBlood) line = 'FIRST BLOOD!'; else if (head) line = 'HEADSHOT!';
    S.firstBlood = true; if (line) announce(line); setFaceOv('😎', 2); scoreCheck();
  }
  function onDie(peer, d) {
    const v = byPeer.get(peer); if (!v) return; const killer = d.by === NET.me ? P : (d.by ? byPeer.get(d.by) : null), wn = String(d.wn || '');
    if (v.dead) { if (killer === P) award(v, wn, !!d.h, !!d.g); return; }
    killBot(v, killer || null, wn, !!d.h, !!d.g);
    if (killer === P) award(v, wn, !!d.h, !!d.g);
    else if (killer) feed(killer.name + ' ▸ ' + v.name + (wn ? ' [' + wn + ']' : ''));
    else feed(v.name + (wn === 'GRENADE' ? ' blew themselves up' : wn === 'HOME RUN' ? ' went for a swim' : ' fell into the sea'));
  }

  const pend = new Map();
  NET.hit = function (b, dmg, wn, head) { const p = pend.get(b.peer) || { dm: 0, w: wn, hd: 0 }; p.dm += dmg; p.w = wn; if (head) p.hd = 1; pend.set(b.peer, p); };
  NET.die = function (by, wn) { send('d', { by: by && by.net ? by.peer : null, wn: wn || '' }); };
  NET.fx = function (w, m, e, snd1) { send('f', { w, m: [r2(m.x), r2(m.y), r2(m.z)], e: [r2(e.x), r2(e.y), r2(e.z)], s: snd1 ? 1 : 0 }); };
  NET.setName = function (n) { n = String(n || '').replace(/[^\w .-]/g, '').trim().slice(0, 12); if (!n) return; NET.name = n; try { localStorage.setItem('wr_name', n); } catch (e) { } try { parent.postMessage({ island: 'name', name: n }, '*'); } catch (e) { } };

  function sendState(away_) {
    const ri = P.ride && window.FT ? FT.rideInfo() : null, rp = P.rope && !P.ride ? P.rope : null;
    const f = (P.alive ? 1 : 0) | (P.cr > .5 ? 2 : 0) | (ri ? 4 : 0) | (P.ground ? 8 : 0) | (P.swing >= 0 ? 16 : 0) | (away_ ? (S.running ? (P.alive ? 256 : 0) : 32) : 0) | (rp ? 64 : 0) | (P.ski ? 512 : 0);
    const a = [r2(P.x), r2(P.y), r2(P.z), r2(P.yaw), r2(P.pitch), P.w, f, Math.max(0, Math.ceil(P.hp)), P.kills, P.deaths];
    if (ri) a.push(ri[0], ri[1], ri[2], ri[3]); else if (rp) a.push(r2(rp.x), r2(rp.y), r2(rp.z));
    send('s', { a });
  }
  const ropeG = new T.BoxGeometry(.03, .03, 1), ropeMat = new T.MeshBasicMaterial({ color: 0xe6d6a8, fog: false }), hookG = new T.OctahedronGeometry(.11, 0), hookMat = new T.MeshStandardMaterial({ color: 0x9aa3ad, metalness: .8, roughness: .3 });
    const skiG = new T.BoxGeometry(.16, .04, 1.5), skiM = new T.MeshStandardMaterial({ color: 0xffd23a, roughness: .5 });
  function skiFor(b) {
    if (!b.ski || b.dead) { if (b.skiM) b.skiM.visible = false; return; }
    if (!b.skiM) { b.skiM = new T.Group(); for (const x of [-.22, .22]) { const s = new T.Mesh(skiG, skiM); s.position.set(x, .03, 0); b.skiM.add(s); } sc.add(b.skiM); }
    const sp = Math.hypot(b.vx, b.vz); b.skiM.visible = true; b.skiM.position.set(b.x, b.y, b.z); if (sp > 1) b.skiYaw = Math.atan2(-b.vx, -b.vz); b.skiM.rotation.y = b.skiYaw || 0;
    if (sp > 3 && S.t - (b.skiPuff || 0) > .09) { b.skiPuff = S.t; puff(b.x, SEA_Y + .1, b.z, 0xe6f6ff, 2, 2.6, .11, .5, 1.6); }
  }
  function ropeFor(b) {
    if (!b.rope) { if (b.ropeM) b.ropeM.visible = b.hookM.visible = false; return; }
    if (!b.ropeM) { b.ropeM = new T.Mesh(ropeG, ropeMat); b.hookM = new T.Mesh(hookG, hookMat); sc.add(b.ropeM); sc.add(b.hookM); }
    const a = V3(b.x, b.y + 1.2, b.z), e = V3(b.rope[0], b.rope[1], b.rope[2]), l = a.distanceTo(e);
    b.ropeM.position.copy(a).lerp(e, .5); b.ropeM.lookAt(e); b.ropeM.scale.set(1, 1, Math.max(.05, l)); b.ropeM.visible = true; b.hookM.position.copy(e); b.hookM.rotation.y += .2; b.hookM.visible = true;
  }
  NET.tick = function (dt) {
    if (!NET.on) return;
    for (const [id, p] of pend) { send('h', { to: id, dm: Math.round(p.dm), w: p.w, hd: p.hd }); } pend.clear();
    NET.acc += dt; if (NET.acc >= .066) { NET.acc = 0; sendState(false); if (window.FT) { const gl = FT.goatState(); if (gl.length) send('gs', { l: gl }); } }
    for (const b of [...byPeer.values()]) {
      if (b.dead) { if (b.corpse) b.rt -= dt; if (b.ropeM) b.ropeM.visible = b.hookM.visible = false; continue; }
      if (S.t - b.last > 6) { away(b); continue; }
      const dx = b.tx - b.x, dz = b.tz - b.z, dy = b.ty - b.y;
      if (Math.hypot(dx, dz) > 9 || Math.abs(dy) > 9) { b.x = b.tx; b.y = b.ty; b.z = b.tz; b.vx = b.vz = 0; }
      else { const k = Math.min(1, dt * 14); b.x += dx * k; b.z += dz * k; b.y += dy * k; b.vx = dx * 14; b.vz = dz * 14; b.vy = dy * 14; }
      let da = b.tyaw - b.yaw; da = Math.atan2(Math.sin(da), Math.cos(da)); b.yaw += da * Math.min(1, dt * 16); b.ground = b.tg;
      if (b.ride && b.rideA && window.FT) FT.netRide(b, b.rideA[0], b.rideA[1], b.rideA[2], b.rideA[3]); else if (b.jet) FT.netRideEnd(b);
      ropeFor(b); skiFor(b);
      if (b.paused && S.t - (b.zT || -9) > 1.4) { b.zT = S.t; bubble(b.x, b.y + 3.6, b.z, '💤', 1.2); }
      const f = clamp(b.hp / 100, 0, 1); b.m.hbFg.scale.x = 1.44 * f; b.m.hbFg.material.color.set(f > .5 ? 0x6bff6b : f > .25 ? 0xffd23a : 0xff4a3a);
    }
  };
  setInterval(() => { if (NET.on && !(S.running && live())) sendState(true); }, 500);
  setInterval(() => { if (NET.on && NET.count > 0) send('pg', { k: Date.now(), f: Math.round(FPSV) }); }, 2000);
  setInterval(perfUI, 700);
  addEventListener('keydown', e => { if (e.code === 'F3') { e.preventDefault(); NET.perf = !NET.perf; perfUI(); } });
  function perfUI() {
    const el = $('perf'); if (!el) return; const on = ((NET.on && NET.count > 0) || NET.perf) && S.running; el.style.display = on ? 'block' : 'none'; if (!on) return;
    const cls = f => f < 25 ? 'bad' : f < 45 ? '' : 'ok'; let t = `<span class="${cls(FPSV)}">you ${Math.round(FPSV)} fps · ${GFXN[GFXL]}</span>`;
    for (const b of byPeer.values()) t += `<br>${b.name.replace(/[<>&]/g, '')} ${b.ping !== undefined ? `<span class="${b.ping > 200 ? 'bad' : b.ping > 100 ? '' : 'ok'}">${b.ping} ms</span>` : '…'} · ${b.fps !== undefined ? `<span class="${cls(b.fps)}">${b.fps} fps</span>` : '…'}`;
    el.innerHTML = t;
  }

  NET.recv = function (peer, d) {
    if (!d || typeof d.t !== 'string') return; let b = byPeer.get(peer);
    if (!b) { if (d.t === 'rs') { } else b = add(peer, 'Worm'); }
    switch (d.t) {
      case 's': if (Array.isArray(d.a) && d.a.length >= 10 && d.a.every(isFinite)) onState(b, d); break;
      case 'f': if (b && Array.isArray(d.m) && Array.isArray(d.e)) { tracer(V3(d.m[0], d.m[1], d.m[2]), V3(d.e[0], d.e[1], d.e[2]), .06); puff(d.e[0], d.e[1], d.e[2], 0xb06d3c, 2, 3, .06, .45); if (d.s) { snd(d.w === 1 ? 'uzi' : 'shotgun', d.m[0], d.m[1], d.m[2]); b.kick = 1; b.burstT = .45; } } break;
      case 'sw': if (b) { snd(d.w === 4 ? 'tailStab' : 'batSwing', b.x, b.y, b.z); b.kick = 1; } break;
      case 'g': if (b && window.FT && [d.x, d.y, d.z, d.vx, d.vy, d.vz].every(isFinite)) FT.throwRaw(b, +d.x, +d.y, +d.z, +d.vx, +d.vy, +d.vz, +d.f, !!d.h); break;
      case 'h': if (b && d.to === NET.me && P.alive && !S.over && live()) damagePlayer(Math.min(150, +d.dm || 0), b, String(d.w || '')); break;
      case 'hr': if (b && d.to === NET.me && P.alive && !P.ride && !S.over && live() && [d.vx, d.vz, d.vy].every(isFinite)) {
        P.vx = +d.vx; P.vz = +d.vz; P.vy = +d.vy; P.ground = false; P.hr = 4; P.hrAge = 0; P.hrBy = b; P.hrUntil = S.t + 10; if (window.FT) FT.release(false); shake = 1; snd('batHit'); voice('oof'); feed('⚾ ' + b.name + ' hit YOU for a HOME RUN'); P.punch = .5; } break;
      case 'd': if (b) onDie(peer, d); break;
      case 'drop': if (window.FT && isFinite(d.x) && isFinite(d.z)) FT.dropAt(String(d.ty), +d.x, +d.z, d.i); break;
      case 'pg': if (b) { b.fps = Math.round(+d.f) || 0; send('po', { to: peer, k: d.k, f: Math.round(FPSV) }); } break;
      case 'po': if (b && d.to === NET.me && isFinite(d.k)) { b.ping = Math.max(0, Date.now() - d.k); b.fps = Math.round(+d.f) || b.fps; } break;
      case 'bl': if (window.FT && d.i) FT.dropBalloon(String(d.i)); break;
      case 'ch': if (b && window.FT && d.i) FT.crateHitId(String(d.i), Math.min(200, +d.dm || 0), b); break;
      case 'pk': if (window.FT && d.i) FT.dropTake(String(d.i)); break;
      case 'mk': { const m = MEDS[d.i | 0]; if (m && m.on) { m.on = false; m.t = 18; m.g.visible = false; snd('pickup', m.x, m.y, m.z); } break; }
      case 'gs': if (b && window.FT && Array.isArray(d.l)) FT.goatNet(peer, d.l.slice(0, 5)); break;
      case 'gh': if (b && d.to === NET.me && window.FT) FT.goatHitSlot(d.i | 0, Math.min(200, +d.dm || 0), b); break;
      case 'gx': if (b && window.FT && [d.x, d.y, d.z].every(isFinite)) FT.goatBoom(peer, +d.x, +d.y, +d.z, d.k | 0, d.by === NET.me ? P : (d.by ? byPeer.get(d.by) : null) || b); break;
      case 'rs': NET.silent = true; try { if (S.running) resetMatch(); else { S.over = false; } } finally { NET.silent = false; } feed('New match!'); break;
    }
  };

  function ui() {
    const bx = $('netbox'); if (!bx) return; bx.style.display = NET.on ? '' : 'none';
    $('netcnt').textContent = NET.count ? (NET.count + 1) + ' players on the island' : 'You are alone — bots will keep you company';
    $('netroom').textContent = NET.room || ''; document.body.classList.toggle('netplay', NET.count > 0);
    if (NET.count) $('ovp').textContent = 'Real worms, one floating island. First to the frag limit wins.';
  }
  function peers(list) {
    const ids = new Set(list.map(p => p.peer));
    for (const b of [...byPeer.values()]) if (!ids.has(b.peer)) remove(b);
    for (const p of list) { const nm = String(p.name || 'Worm').slice(0, 12); let b = byPeer.get(p.peer); if (b && b.name !== nm) { remove(b, true); b = null; } if (!b) { b = add(p.peer, nm); if (S.running && NET.count !== undefined && nm) feed(nm + ' joined the island'); } }
    NET.count = list.length; applyBots(NET.count > 0 ? 0 : CFG.bots, false); ui();
  }
  addEventListener('message', e => {
    const m = e.data; if (!m || typeof m !== 'object' || e.source !== parent) return;
    if (m.islandNet === 'init') { NET.on = true; NET.me = m.me || null; NET.room = m.room || ''; NET.name = m.name || ''; const ni = $('netname'); if (ni) ni.value = NET.name; ui(); }
    else if (!NET.on) return;
    else if (m.islandNet === 'peers') { NET.me = m.me || NET.me; if (m.room) NET.room = m.room; peers(Array.isArray(m.list) ? m.list : []); }
    else if (m.islandNet === 'msg') NET.recv(String(m.peer), m.d);
  });
  { const ni = $('netname'); if (ni) { ni.onchange = () => NET.setName(ni.value); ni.addEventListener('keydown', e => e.stopPropagation()); } }
  window.NETDBG = { byPeer, add, onState };
})();
