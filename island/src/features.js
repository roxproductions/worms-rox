'use strict';
/* ============================================================
   WORM ISLAND — gameplay features layered on game.js
   grenades · damage feedback · ninja rope · jetskis · airdrops · Random Goat
   (runs after game.js; shares its top-level bindings, exposes window.FT)
   ============================================================ */
(function () {
  const V = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z);
  const EMOJI = {};
  function emojiSprite(ch, size = 1) {
    if (!EMOJI[ch]) { const c = document.createElement('canvas'); c.width = c.height = 96; const x = c.getContext('2d'); x.font = '70px serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(ch, 48, 54); EMOJI[ch] = new T.CanvasTexture(c); }
    const sp = new T.Sprite(new T.SpriteMaterial({ map: EMOJI[ch], transparent: true, depthTest: false, fog: false })); sp.scale.set(size, size, 1); sp.renderOrder = 9; return sp;
  }
  const FT = window.FT = { src: null };
  const near = (a, b, r) => Math.hypot(a.x - b.x, a.z - b.z) < r;
  const targets = () => { const a = []; if (P.alive) a.push(P); BOTS.forEach(b => { if (!b.dead) a.push(b); }); return a; };

  /* ============================ GRENADES ============================ */
  CFG.fuse = 3;
  const GR = [], gbGeo = new T.SphereGeometry(.13, 12, 10), steel = new T.MeshStandardMaterial({ color: 0x8a9099, roughness: .35, metalness: .8 });
  for (let i = 0; i < 18; i++) {
    const g = new T.Group(), body = new T.Mesh(gbGeo, new T.MeshStandardMaterial({ color: 0x35502a, roughness: .5, metalness: .3 })); body.castShadow = true;
    const top = new T.Mesh(new T.CylinderGeometry(.04, .045, .08, 8), steel); top.position.y = .14;
    const led = new T.Mesh(new T.SphereGeometry(.04, 8, 6), new T.MeshBasicMaterial({ color: 0xff2a1a, fog: false })); led.position.set(0, .2, 0);
    const hg = new T.Group(), gold = new T.MeshStandardMaterial({ color: 0xffc830, roughness: .25, metalness: .9, emissive: 0xffa000, emissiveIntensity: .7 });
    hg.add(new T.Mesh(new T.SphereGeometry(.27, 18, 14), gold)); const cb = new T.Mesh(new T.BoxGeometry(.07, .5, .07), gold); cb.position.y = .43; hg.add(cb); const cb2 = new T.Mesh(new T.BoxGeometry(.3, .07, .07), gold); cb2.position.y = .5; hg.add(cb2);
    const ring = new T.Mesh(new T.TorusGeometry(.27, .03, 6, 20), gold); ring.rotation.x = Math.PI / 2; hg.add(ring);
    hg.add(new T.Mesh(new T.SphereGeometry(.62, 14, 10), new T.MeshBasicMaterial({ color: 0xfff0a0, transparent: true, opacity: .28, depthWrite: false, blending: T.AdditiveBlending, fog: false }))); hg.visible = false; g.add(hg);
    g.add(body, top, led); g.visible = false; sc.add(g); GR.push({ g, led, body, top, hg, on: false });
  }
  const EXL = new T.PointLight(0xff9a40, 0, 34, 2); sc.add(EXL);
  const EXP = [], fbMat = () => new T.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false });
  for (let i = 0; i < 6; i++) {
    const ball = new T.Mesh(new T.SphereGeometry(1, 20, 14), fbMat()), core = new T.Mesh(new T.SphereGeometry(1, 14, 10), new T.MeshBasicMaterial({ color: 0xfff3c0, transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false }));
    const ring = new T.Mesh(new T.RingGeometry(.82, 1, 40), new T.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, fog: false })); ring.rotation.x = -Math.PI / 2;
    ball.visible = core.visible = ring.visible = false; sc.add(ball, core, ring); EXP.push({ ball, core, ring, t: 0, on: false, R: 7 });
  }
  const SCORCH = []; for (let i = 0; i < 10; i++) { const m = new T.Mesh(new T.CircleGeometry(1, 24), new T.MeshBasicMaterial({ color: 0x0c0a08, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })); m.rotation.x = -Math.PI / 2; m.visible = false; m.userData = { l: 0 }; sc.add(m); SCORCH.push(m); }
  let scorchI = 0;

  function throwGren(owner, x, y, z, vx, vy, vz, holy) {
    const o = GR.find(q => !q.on); if (!o) return false;
    Object.assign(o, { on: true, owner, x, y, z, vx, vy, vz, holy: !!holy, t: holy ? 4 : owner === P ? P.fuse : CFG.fuse, spin: rnd(6, 12), tick: 99 }); o.body.visible = o.top.visible = !holy; o.hg.visible = !!holy; o.led.visible = !holy;
    o.g.visible = true; o.g.position.set(x, y, z); owner === P ? snd('throw') : snd('throw', x, y - 1.2, z); if (owner === P && window.NET && NET.on) NET.send('g', { x: +x.toFixed(2), y: +y.toFixed(2), z: +z.toFixed(2), vx: +vx.toFixed(2), vy: +vy.toFixed(2), vz: +vz.toFixed(2), f: holy ? 4 : P.fuse, h: holy ? 1 : 0 }); return true;
  }
  P.fuse = 3;
  FT.fuseStep = function (d) { P.fuse = clamp(Math.round((P.fuse + d * .5) * 2) / 2, 1, 3); FT.hud(); feed('Grenade fuse ' + P.fuse.toFixed(1) + ' s'); snd('hit', undefined, undefined, undefined, { vol: .2, pitch: .8 + P.fuse * .15 }); };
  const GMIN = 8, GMAX = 33, GFULL = 1.25;
  function canGren() { return S.running && live() && P.alive && !P.ride && (P.gren || 0) > 0 && S.t >= (P.gcd || 0); }
  FT.gEmpty = function () { snd('empty'); const b = $('gn'); if (!b) return; b.classList.remove('flash'); void b.offsetWidth; b.classList.add('flash'); clearTimeout(FT.gEmpty.t); FT.gEmpty.t = setTimeout(() => b.classList.remove('flash'), 450); };
  FT.gStart = function () { if (P.gch === undefined || P.gch === null) { if (S.running && live() && P.alive && !P.ride && (P.gren || 0) <= 0) { if (S.t >= (P.gcd || 0) - .5) FT.gEmpty(); return; } if (!canGren()) return; P.gch = S.t; } };
  FT.gCancel = function () { P.gch = null; const b = $('gch'); if (b) b.style.display = 'none'; };
  FT.gEnd = function () {
    if (P.gch === undefined || P.gch === null) return; const pw = clamp((S.t - P.gch) / GFULL, 0, 1); FT.gCancel();
    if (!canGren()) return; FT.throwGren(pw);
  };
  FT.throwGren = function (pw) {
    if (!canGren()) return; if (pw === undefined) pw = .4;
    const sp = GMIN + (GMAX - GMIN) * pw, d = dirVec(P.yaw, P.pitch), o = V(); cam.getWorldPosition(o); o.addScaledVector(d, .45); o.y -= .12;
    if (!throwGren(P, o.x, o.y, o.z, d.x * sp + P.vx * .5, d.y * sp + 3.4 + P.vy * .3, d.z * sp + P.vz * .5)) return;
    P.gren--; P.gcd = S.t + .75; P.swap = .3; P.punch = .15; hudAmmo();
  };
  function crater(x, y, z, R) {
    const g = ground(x, z); if (g === -Infinity || y - g > 3) return;
    const m = SCORCH[scorchI++ % SCORCH.length]; m.position.set(x, g + .03, z); m.scale.setScalar(R * .38); m.userData.l = 16; m.material.opacity = .6; m.visible = true;
  }
  function explode(x, y, z, owner, Rk = 1, Dk = 1, wn = 'GRENADE') {
    const R = 7.6 * Rk, ex = EXP.find(e => !e.on) || EXP[0];
    ex.on = true; ex.t = 0; ex.R = R; ex.gold = wn === 'HOLY HAND GRENADE'; [ex.ball, ex.core, ex.ring].forEach(m => { m.visible = true; m.position.set(x, y + .2, z); }); ex.ring.position.y = y + .05;
    EXL.position.set(x, y + 1.2, z); EXL.intensity = 9;
    puff(x, y + .3, z, 0xffd070, 26, 15, .16, .7, 7); puff(x, y + .3, z, 0xff7a20, 22, 11, .26, .9, 5); puff(x, y + .3, z, 0x2b2622, 26, 6, .62, 1.9, 3); puff(x, y + .2, z, 0xb06d3c, 30, 12, .17, 1.1, 8);
    crater(x, y, z, R);
    snd('explosion', x, y, z, { force: true });
    const pd = Math.hypot(P.x - x, P.y + 1 - y, P.z - z);
    shake = Math.min(1.5, shake + 1.3 * clamp(1 - pd / 34, 0, 1)); if (AU) AU.ring(clamp(1 - pd / 15, 0, 1) * .95);
    for (const t of targets()) {
      const dx = t.x - x, dy = t.y + 1 - y, dz = t.z - z, d = Math.hypot(dx, dy, dz); if (d > R) continue;
      let f = 1 - d / R; if (losBlocked(x, y + .3, z, t.x, t.y + 1, t.z)) f *= .38;
      const dmg = (t === P ? 112 : 135) * Dk * Math.pow(f, 1.05), kx = dx / (d || 1), kz = dz / (d || 1);
      t.vx = (t.vx || 0) + kx * 19 * f; t.vz = (t.vz || 0) + kz * 19 * f; t.vy = Math.max(t.vy || 0, 8.5 * f); t.ground = false;
      FT.src = { x, z };
      if (t === P) damagePlayer(dmg, owner === P ? null : owner, wn); else damageBot(t, dmg, owner, wn, false);
    }
    if (wn !== 'CRATE') for (const dr of DROPS) { if (dr.taken) continue; const dd = Math.hypot(dr.x - x, dr.y + .4 - y, dr.z - z); if (dd > R) continue; crateHit(dr, 135 * Dk * Math.pow(1 - dd / R, 1.05), owner, false); }
    for (const gt of GOATS) { if (!gt.on) continue; const d = Math.hypot(gt.x - x, gt.y + .5 - y, gt.z - z); if (d > R) continue; goatHit(gt, 135 * Dk * Math.pow(1 - d / R, 1.05), owner); }
  }
  FT.explode = explode;
  function holyBoom(x, y, z, owner) {
    puff(x, y + 1, z, 0xfff0a0, 40, 20, .3, 1.2, 4); puff(x, y + 1, z, 0xffffff, 30, 14, .22, 1, 3);
    explode(x, y, z, owner, 2.4, 2.5, 'HOLY HAND GRENADE'); shake = Math.min(2, shake + .8); EXL.intensity = 16; EXL.color.set(0xffe9a0); setTimeout(() => EXL.color.set(0xff9a40), 700);
    if (owner === P) feed('✝ HALLELUJAH! — Holy Hand Grenade detonated');
  }
  /* ---- Holy Hand Grenade: rare drop, key H, 4 s fuse, choir, huge blast ---- */
  FT.holyThrow = function () {
    if (!S.running || !live() || !P.alive || P.ride || (P.holy || 0) <= 0 || S.t < (P.gcd || 0)) return;
    const sp = GMIN + (GMAX - GMIN) * .72, d = dirVec(P.yaw, P.pitch), o = V(); cam.getWorldPosition(o); o.addScaledVector(d, .45); o.y -= .12;
    if (!throwGren(P, o.x, o.y, o.z, d.x * sp + P.vx * .5, d.y * sp + 3.8 + P.vy * .3, d.z * sp + P.vz * .5, true)) return;
    P.holy--; P.gcd = S.t + 1.2; P.swap = .3; P.punch = .2; FT.hud(); announce('HALLELUJAH!', false); snd('hallelujah', undefined, undefined, undefined, { force: true });
  };
  function updateGren(dt) {
    for (const o of GR) if (o.on) {
      o.t -= dt;
      const n = Math.max(1, Math.ceil(Math.hypot(o.vx, o.vy, o.vz) * dt / .2)), h = dt / n; let bounced = false;
      for (let s = 0; s < n; s++) {
        o.vy -= 24 * h; let nx = o.x + o.vx * h, ny = o.y + o.vy * h, nz = o.z + o.vz * h;
        if (ground(nx, nz) > ny - .05) { const gx = ground(nx, o.z) > ny - .05, gz = ground(o.x, nz) > ny - .05; if (gx || !gz) { o.vx *= -.45; nx = o.x; } if (gz || !gx) { o.vz *= -.45; nz = o.z; } bounced = true; }
        for (const c of COLL) { const dx = nx - c.x, dz = nz - c.z, d = Math.hypot(dx, dz), m = c.r + .14; if (d < m && d > 1e-4 && ny < gy(c.x, c.z) + (c.h || 1.4)) { const ux = dx / d, uz = dz / d, vr = o.vx * ux + o.vz * uz; if (vr < 0) { o.vx -= 1.5 * vr * ux; o.vz -= 1.5 * vr * uz; } nx = c.x + ux * m; nz = c.z + uz * m; bounced = true; } }
        const g = ground(nx, nz);
        if (g > -Infinity && ny <= g + .13) { ny = g + .13; if (o.vy < -3) bounced = true; o.vy = -o.vy * .4; if (Math.abs(o.vy) < 1.5) o.vy = 0; const fr = Math.exp(-2.6 * h); o.vx *= fr; o.vz *= fr; }
        if (g === -Infinity && ny < SEA_Y - .15) { puff(nx, SEA_Y + .2, nz, 0xcfe8ff, 8, 3, .09, .6, 4); snd('splash', nx, SEA_Y, nz); o.on = false; o.g.visible = false; break; }
        o.x = nx; o.y = ny; o.z = nz;
      }
      if (!o.on) continue;
      if (bounced) snd('grenBounce', o.x, o.y - 1.2, o.z);
      o.g.position.set(o.x, o.y, o.z); o.g.rotation.x += o.spin * dt * Math.min(1, Math.hypot(o.vx, o.vz) / 6 + .1); o.g.rotation.z += o.spin * .6 * dt * Math.min(1, Math.hypot(o.vx, o.vz) / 6 + .1);
      if (o.holy) { o.hg.rotation.y += dt * 3; if (S.t - (o.sp || 0) > .06) { o.sp = S.t; puff(o.x, o.y + .1, o.z, 0xffe27a, 1, 1.4, .07, .5, 2); } }
      else o.led.visible = o.t < 1 ? Math.sin(o.t * 42) > 0 : Math.sin(o.t * 14) > 0;
      const tk = o.t < 1.2 ? Math.floor(o.t * 6) : Math.floor(o.t * 2); if (!o.holy && o.t < 2.4 && tk !== o.tick) { o.tick = tk; snd('grenTick', o.x, o.y - 1.2, o.z, { hi: o.t < 1.2 }); }
      if (o.t <= 0) { o.on = false; o.g.visible = false; if (o.holy) holyBoom(o.x, o.y, o.z, o.owner); else explode(o.x, o.y, o.z, o.owner); }
    }
    for (const e of EXP) if (e.on) {
      e.t += dt; const k = e.t / .55, kr = e.t / .34;
      if (k >= 1) { e.on = false; e.ball.visible = e.core.visible = e.ring.visible = false; continue; }
      const ease = 1 - Math.pow(1 - k, 3); e.ball.scale.setScalar(Math.max(.01, ease * e.R * .5)); e.ball.material.opacity = .85 * (1 - k) * (1 - k); e.ball.material.color.setHSL(e.gold ? .13 - .02 * k : .08 - .05 * k, 1, e.gold ? .62 - .15 * k : .5 - .2 * k);
      e.core.scale.setScalar(Math.max(.01, ease * e.R * .28)); e.core.material.opacity = Math.max(0, 1 - k * 2.2);
      if (kr < 1) { e.ring.scale.setScalar(1 + (1 - Math.pow(1 - kr, 2)) * e.R); e.ring.material.opacity = .8 * (1 - kr); } else e.ring.visible = false;
    }
    EXL.intensity = Math.max(0, EXL.intensity - dt * 28);
    for (const m of SCORCH) if (m.visible) { m.userData.l -= dt; m.material.opacity = Math.min(.6, m.userData.l / 4); if (m.userData.l <= 0) m.visible = false; }
  }
  // bots: throw + flee
  FT.botGren = function (b, see, dist, dt) {
    if (b.gcd === undefined) b.gcd = rnd(5, 11); b.gcd -= dt;
    if (!see || b.gcd > 0 || dist < 8 || dist > 27 || !P.alive || S.over) return;
    b.gcd = rnd(10, 18); const ex = rnd(-1.2, 1.2), ez = rnd(-1.2, 1.2), dx = P.x + ex - b.x, dz = P.z + ez - b.z, Tt = clamp(Math.hypot(dx, dz) / 15, .55, 1.5), dy = (P.y + .2) - (b.y + 1.4);
    b.kick = 1; throwGren(b, b.x, b.y + 1.4, b.z, dx / Tt, (dy + .5 * 24 * Tt * Tt) / Tt, dz / Tt); emote(b, 'cool', '😈', 1);
  };
  FT.botFlee = function (b) {
    let ax = 0, az = 0, hit = false;
    for (const o of GR) if (o.on) { const dx = b.x - o.x, dz = b.z - o.z, d = Math.hypot(dx, dz); if (d < 8 && o.t < 2.4) { ax += dx / (d || 1) * (8 - d); az += dz / (d || 1) * (8 - d); hit = true; } }
    for (const gt of GOATS) if (gt.on) { const dx = b.x - gt.x, dz = b.z - gt.z, d = Math.hypot(dx, dz); if (d < 6) { ax += dx / (d || 1) * (6 - d); az += dz / (d || 1) * (6 - d); hit = true; } }
    if (!hit) return null;
    const l = Math.hypot(ax, az) || 1, mx = ax / l, mz = az / l; return [mx * -Math.sin(b.yaw) + mz * -Math.cos(b.yaw), mx * Math.cos(b.yaw) + mz * -Math.sin(b.yaw)];
  };
  // bot navigation across the bridge
  FT.navT = function (b, t) {
    const sb = islandOf(b.x), st = islandOf(t[0]); if (sb === st) return t;
    const WA = BRIDGE.WA, WB = BRIDGE.WB, from = sb === 0 ? WA : WB, to = sb === 0 ? WB : WA;
    if (Math.abs(b.z - BRIDGE.zc) > 2.2 || (sb === 0 ? b.x < from[0] : b.x > from[0]) && Math.hypot(b.x - from[0], b.z - from[1]) > 1.6) return from;
    return to;
  };
  FT.crossing = function (b) { return islandOf(b.x) !== islandOf(P.x) && !(b.x > BRIDGE.x0 && b.x < BRIDGE.x1 && Math.abs(b.z - BRIDGE.zc) < 2.5); };

  /* ============================ DAMAGE FEEL ============================ */
  const hitfx = $('hitfx'), hdir = $('hdir'), lowhp = $('lowhp'), HD = hdir ? [...hdir.children] : []; let hdI = 0, hfT = null;
  cv.style.transition = 'filter .45s ease-out';
  const HS = { r: 0, vr: 0, p: 0, vp: 0 };
  FT.hitFeel = function (dmg, by, wn) {
    const src = by && by.x !== undefined ? { x: by.x, z: by.z } : FT.src; FT.src = null;
    let ang = 0; if (src) { const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw), rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw), dx = src.x - P.x, dz = src.z - P.z; ang = Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz); }
    const k = clamp(.35 + dmg / 28, .35, 1.6), sa = Math.sin(ang), ca = Math.cos(ang);
    // aim punch + camera spring
    P.yaw += sa * (.006 + dmg * .0007) * (src ? 1 : 0); P.pitch = clamp(P.pitch + ca * (.008 + dmg * .0006), -1.45, 1.45);
    HS.vr += -sa * (1.4 + dmg * .06) * (src ? 1 : .3) + (src ? 0 : (Math.random() - .5) * 1.5); HS.vp += ca * (1 + dmg * .05); P.fovK += 3 + dmg * .12; shake = Math.min(1.2, shake + .25 * k);
    // screen flash, desaturate, directional wedge
    if (hitfx) { hitfx.style.opacity = clamp(.55 * k, .3, 1); hitfx.classList.add('on'); clearTimeout(hfT); hfT = setTimeout(() => { hitfx.classList.remove('on'); hitfx.style.opacity = 0; }, 110); }
    cv.style.transition = 'none'; cv.style.filter = `saturate(${clamp(1 - .5 * k, .25, .8)}) contrast(1.12) brightness(${1 + .12 * k})`; requestAnimationFrame(() => requestAnimationFrame(() => { cv.style.transition = 'filter .5s ease-out'; cv.style.filter = ''; }));
    if (src && HD.length) { const el = HD[hdI++ % HD.length]; el.style.transition = 'none'; el.style.transform = `rotate(${ang}rad) translateY(-31vh)`; el.style.opacity = 1; requestAnimationFrame(() => requestAnimationFrame(() => { el.style.transition = 'opacity 1.1s ease-out'; el.style.opacity = 0; })); }
    snd('thumpMe', undefined, undefined, undefined, { dmg }); if (AU && dmg > 18) AU.ring(clamp(dmg / 90, 0, .4));
    try { if (TOUCH && navigator.vibrate) navigator.vibrate(dmg > 25 ? [70] : [35]); } catch (e) { }
  };
  function hitUpdate(dt) {
    HS.vr += (-HS.r * 190 - HS.vr * 13) * dt; HS.r += HS.vr * dt; HS.vp += (-HS.p * 190 - HS.vp * 13) * dt; HS.p += HS.vp * dt;
    HK.r = clamp(HS.r, -.16, .16) * .5; HK.p = clamp(HS.p, -.14, .14) * .5;
    const low = P.alive && P.hp < 35; if (lowhp) { if (low !== lowhp.classList.contains('on')) lowhp.classList.toggle('on', low); if (low) lowhp.style.animationDuration = (.45 + P.hp / 35 * .7) + 's'; }
  }

  /* ============================ NINJA ROPE ============================ */
  const ropeMesh = new T.Mesh(new T.BoxGeometry(.022, .022, 1), new T.MeshBasicMaterial({ color: 0xe6d6a8, fog: false })), hook = new T.Mesh(new T.OctahedronGeometry(.11, 0), steel);
  ropeMesh.visible = hook.visible = false; ropeMesh.frustumCulled = false; sc.add(ropeMesh, hook);
  let ropeFly = null;
  /* the rope can also hook moving things: jetskis, supply crates and their parachutes, goats and worms */
  function ropeObjs() {
    const l = []; for (const j of JET) if (j.rider !== P) l.push({ ref: j, cy: .45, r: 1.5, k: 'jet' });
    for (const d of DROPS) { if (d.taken) continue; l.push({ ref: d, cy: .4, r: .95, k: 'drop' }); if (d.chute.visible || d.balloon) l.push({ ref: d, cy: d.balloon ? 3.7 : 3.2, r: d.balloon ? 2 : 1.75, k: 'drop' }); }
    for (const g of GOATS.concat(RG)) if (g.on) l.push({ ref: g, cy: .5, r: .85, k: 'goat' });
    for (const b of BOTS) if (!b.dead) l.push({ ref: b, cy: 1, r: .95, k: 'worm' });
    return l;
  }
  const ropeObjOk = o => o.k === 'jet' ? true : o.k === 'drop' ? (DROPS.includes(o.ref) && !o.ref.taken) : o.k === 'goat' ? o.ref.on : (BOTS.includes(o.ref) && !o.ref.dead);
  function ropeFollow(r) {
    if (!r || !r.obj) return; if (!ropeObjOk(r.obj)) { releaseRope(true); return; }
    const q = r.obj.ref, cy = r.obj.cy; r.x = q.x + r.off[0]; r.y = q.y + cy + r.off[1]; r.z = q.z + r.off[2];
  }
  function ropeRay(o, d, max) {
    const objs = ropeObjs();
    for (let t = .5; t < max; t += .25) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      for (const e of objs) { const q = e.ref, dx = x - q.x, dy = y - (q.y + e.cy), dz = z - q.z; if (dx * dx + dy * dy + dz * dz < e.r * e.r) return { t, x, y, z, k: e.k, obj: e, off: [dx, dy, dz] }; }
      if (solidAt(x, y, z) && y > -3) return { t, x, y, z, k: 'ground' };
      for (const c of COLL) { const dx = x - c.x, dz = z - c.z, gyc = gy(c.x, c.z); if (dx * dx + dz * dz < Math.pow(c.r + (c.kind === 'palm' && y > gyc + 3.6 ? 1.1 : .12), 2) && y < gyc + (c.h || 1.4) && y > gyc - .2) return { t, x, y, z, k: c.kind || 'prop' }; }
      if (y < SEA_Y - 2) break;
    }
    return null;
  }
  FT.rope = function () {
    if (!S.running || !live() || !P.alive || P.ride) return;
    if (P.rope) { releaseRope(true); return; }
    const o = V(); cam.getWorldPosition(o); const d = dirVec(P.yaw, P.pitch), r = ropeRay(o, d, 46);
    snd('ropeShot');
    if (!r) { ropeFly = { x: o.x + d.x * 18, y: o.y + d.y * 18, z: o.z + d.z * 18, t: 0, miss: true }; return; }
    ropeFly = { x: r.x, y: r.y, z: r.z, t: 0, miss: false, hit: r };
  };
  /* waterskiing: roping a jetski that is moving puts you on skis behind it */
  const skisG = new T.Group(); { const sm = new T.MeshStandardMaterial({ color: 0xffd23a, roughness: .5 }); for (const x of [-.22, .22]) { const s = new T.Mesh(new T.BoxGeometry(.16, .04, 1.5), sm); s.position.set(x, .03, 0); skisG.add(s); const tip = new T.Mesh(new T.BoxGeometry(.16, .04, .2), sm); tip.position.set(x, .08, -.8); tip.rotation.x = .35; skisG.add(tip); } skisG.visible = false; sc.add(skisG); }
  FT.skisG = skisG;
  function skiEnd() { if (!P.ski) return; P.ski = false; P.skiI = false; skisG.visible = false; P.vy = Math.max(P.vy, 7.5); P.ground = false; }
  function releaseRope(snd_) { skiEnd(); if (!P.rope && !ropeFly) return; P.rope = null; ropeFly = null; ropeMesh.visible = hook.visible = false; if (snd_) snd('ropeLet'); }
  FT.release = releaseRope;
  FT.ropeVel = function (dt) {
    const r = P.rope; if (!r) return; ropeFollow(r); if (!P.rope) return;
    if (r.obj && r.obj.k === 'jet' && (P.ski || Math.abs(r.obj.ref.v) > 2.5)) {
      const j = r.obj.ref; if (!P.skiI) { P.skiI = true; P.ski = true; P.skiLat = 0; P.skiN = 0; r.len = clamp(r.len, 7, 15); feed('🎿 Waterskiing! A/D carve · W/S shorten / lengthen · jump to hop · F to let go'); snd('splash', P.x, SEA_Y, P.z); }
      const fx = -Math.sin(j.yaw), fz = -Math.cos(j.yaw), rx = Math.cos(j.yaw), rz = -Math.sin(j.yaw);
      const sd = (KEYS.KeyD ? 1 : 0) - (KEYS.KeyA ? 1 : 0) + P.jx, rin = (KEYS.KeyW ? 1 : 0) - (KEYS.KeyS ? 1 : 0) - P.jy;
      r.len = clamp(r.len - rin * 5 * dt, 6, 18); P.skiLat += (clamp(sd, -1, 1) * r.len * .55 - P.skiLat) * Math.min(1, dt * 2.5);
      P.skiT = [j.x - fx * r.len * .92 + rx * P.skiLat, j.z - fz * r.len * .92 + rz * P.skiLat, fx, fz];
      P.vx = j.v * fx; P.vz = j.v * fz; P.fovK = Math.max(P.fovK || 0, Math.abs(j.v) * .18); return;
    }
    // rope mode: W reel in, S reel out, A/D swing left/right (camera-relative)
    const rin = (KEYS.KeyW ? 1 : 0) - (KEYS.KeyS ? 1 : 0) - P.jy;
    if (rin) r.len = clamp(r.len - rin * 8 * dt, 2.2, 46);
    const sd = (KEYS.KeyD ? 1 : 0) - (KEYS.KeyA ? 1 : 0) + P.jx;
    if (sd) { const rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw), a = (P.ground ? 26 : 16) * Math.max(-1, Math.min(1, sd)) * dt; P.vx += rx * a; P.vz += rz * a; }
    if (!P.ground) { P.vx *= 1 - .08 * dt; P.vz *= 1 - .08 * dt; }
    const dx = r.x - P.x, dy = r.y - (P.y + 1), dz = r.z - P.z, d = Math.hypot(dx, dy, dz);
    if (d > r.len) { const nx = dx / d, ny = dy / d, nz = dz / d, vr = P.vx * nx + P.vy * ny + P.vz * nz; if (vr < 0) { P.vx -= vr * nx; P.vy -= vr * ny; P.vz -= vr * nz; if (-vr > 7) snd('ropeCreak'); } }
  };
  FT.ropePos = function (dt) {
    const r = P.rope; if (!r) return; ropeFollow(r); if (!P.rope) return;
    if (P.ski && P.skiT) {
      const [tx, tz, fx, fz] = P.skiT; if (gmax(tx, tz, .6) > -Infinity && ground(tx, tz) > SEA_Y + .5) { releaseRope(true); return; } // towed into the shore
      P.skiN = Math.min(1, (P.skiN || 0) + dt * .6); const k = Math.min(1, dt * (3 + P.skiN * 5)); P.x += (tx - P.x) * k; P.z += (tz - P.z) * k;
      const wy = SEA_Y + .05 + Math.sin(S.t * 3 + P.x * .4) * .06;
      if (!P.ground) { P.vy -= 24 * dt; P.y += P.vy * dt; if (P.y <= wy && P.vy <= 0) { P.y = wy; P.vy = 0; P.ground = true; snd('splash', P.x, SEA_Y, P.z, { vol: .6 }); puff(P.x, wy + .15, P.z, 0xe6f6ff, 10, 4, .13, .6, 3); } }
      else { P.y = wy; P.vy = 0; }
      skisG.visible = true; skisG.position.set(P.x, P.y, P.z); skisG.rotation.set(0, Math.atan2(-fx, -fz), 0);
      if (P.ground && Math.hypot(P.vx, P.vz) > 3 && S.t - (P.skiPuff || 0) > .07) { P.skiPuff = S.t; puff(P.x + fx * .5, SEA_Y + .1, P.z + fz * .5, 0xe6f6ff, 2, 2.6, .11, .5, 1.6); }
      return;
    }
    const dx = r.x - P.x, dy = r.y - (P.y + 1), dz = r.z - P.z, d = Math.hypot(dx, dy, dz);
    if (d > r.len) { const ex = Math.min(2, d - r.len), nx = dx / d, ny = dy / d, nz = dz / d; tryMove(P, nx * ex, nz * ex, true); if (ny > 0) { P.y += ny * ex; P.ground = false; } }
  };
  function ropeVisual(dt) {
    const hand = cam.localToWorld(V(.3, -.32, -.5));
    if (ropeFly) {
      ropeFly.t += dt / .1; const k = Math.min(1, ropeFly.t), e = V(hand.x + (ropeFly.x - hand.x) * k, hand.y + (ropeFly.y - hand.y) * k, hand.z + (ropeFly.z - hand.z) * k);
      setRope(hand, e);
      if (ropeFly.t >= 1) { if (ropeFly.miss) { if (ropeFly.t > 1.8) { ropeFly = null; ropeMesh.visible = hook.visible = false; } } else { const h = ropeFly.hit; if (h.obj) { if (!ropeObjOk(h.obj)) { ropeFly = null; ropeMesh.visible = hook.visible = false; return; } const q = h.obj.ref; h.x = q.x + h.off[0]; h.y = q.y + h.obj.cy + h.off[1]; h.z = q.z + h.off[2]; } P.rope = { x: h.x, y: h.y, z: h.z, len: clamp(Math.hypot(h.x - P.x, h.y - (P.y + 1), h.z - P.z), 2.5, 46), t: 0, obj: h.obj || null, off: h.off || null }; if (h.obj && h.obj.k === 'drop' && h.obj.ref.state === 'fall') { setBalloon(h.obj.ref); if (h.obj.ref.id && window.NET && NET.on) NET.send('bl', { i: h.obj.ref.id }); } snd('ropeHit', h.x, h.y - 1.2, h.z, { force: true }); puff(h.x, h.y, h.z, 0xcbb892, 6, 3, .06, .5); ropeFly = null; } }
    } else if (P.rope) setRope(hand, V(P.rope.x, P.rope.y, P.rope.z));
    else ropeMesh.visible = hook.visible = false;
  }
  function setRope(a, b) { const l = a.distanceTo(b); ropeMesh.position.copy(a).lerp(b, .5); ropeMesh.lookAt(b); ropeMesh.scale.set(1, 1, Math.max(.05, l)); ropeMesh.visible = true; hook.position.copy(b); hook.visible = true; hook.rotation.y += .2; }

  /* ============================ JETSKIS ============================ */
  const JET = [], RAMPS = [], cockpit = new T.Group(); cockpit.visible = false; cam.add(cockpit);
  (function () {
    const m = (c, r = .5, mt = .1) => new T.MeshStandardMaterial({ color: c, roughness: r, metalness: mt }), hullM = m(0xff5a3c, .35, .2), dk = m(0x1a1d24, .6, .3);
    const hood = new T.Mesh(rbox(1.0, .34, 1.5, .12, 2), hullM); hood.position.set(0, -.78, -1.55); cockpit.add(hood);
    const bar = new T.Mesh(new T.CylinderGeometry(.03, .03, .78, 10), dk); bar.rotation.z = Math.PI / 2; bar.position.set(0, -.46, -.78); cockpit.add(bar);
    const stem = new T.Mesh(new T.CylinderGeometry(.035, .04, .3, 10), dk); stem.position.set(0, -.6, -.82); cockpit.add(stem);
    [-.36, .36].forEach(x => { const g = new T.Mesh(new T.CylinderGeometry(.04, .04, .14, 10), m(0x111)); g.rotation.z = Math.PI / 2; g.position.set(x, -.46, -.78); cockpit.add(g); });
    cockpit.traverse(o => { o.castShadow = false; });
  })();
  const riderG = new T.Group(), rAim = new T.Group(); riderG.visible = false;
  (function () {
    const sk = new T.MeshStandardMaterial({ color: 0xe0409a, roughness: .5 }), wh = new T.MeshBasicMaterial({ color: 0xffffff }), bk = new T.MeshBasicMaterial({ color: 0x111111 }), gm = new T.MeshStandardMaterial({ color: 0x23272f, roughness: .4, metalness: .6 });
    const ball = (r, x, y, z, mat, p) => { const m = new T.Mesh(new T.SphereGeometry(r, 14, 10), mat); m.position.set(x, y, z); (p || riderG).add(m); return m; };
    ball(.21, 0, .78, .3, sk); ball(.18, 0, .62, .56, sk); ball(.14, 0, .56, .78, sk); ball(.08, -.3, .88, -.62, sk); ball(.08, .3, .88, -.62, sk);
    rAim.position.set(0, 1.05, .1); riderG.add(rAim); ball(.27, 0, .05, 0, sk, rAim); ball(.07, -.1, .1, -.22, wh, rAim); ball(.07, .1, .1, -.22, wh, rAim); ball(.035, -.1, .1, -.28, bk, rAim); ball(.035, .1, .1, -.28, bk, rAim);
    const gun = new T.Mesh(new T.BoxGeometry(.1, .12, .6), gm); gun.position.set(.2, -.14, -.42); rAim.add(gun); const gb = new T.Mesh(new T.BoxGeometry(.05, .05, .3), gm); gb.position.set(.2, -.12, -.8); rAim.add(gb);
    riderG.traverse(o => { o.castShadow = true; });
  })();
  const _cd = V();
  FT.chaseCam = function () {
    const j = P.ride; if (!j) return; const d = dirVec(P.yaw, P.pitch), px = j.x, py = j.y + 1.45, pz = j.z; let dist = 5.4;
    const r = worldRay(px, py, pz, -d.x, -d.y, -d.z, dist + .4); if (r < dist + .3) dist = Math.max(1.2, r - .35);
    let cx = px - d.x * dist, cy = py - d.y * dist + .5, cz = pz - d.z * dist; cy = Math.max(cy, SEA_Y + .45); cam.position.set(cx, cy, cz);
  };
  FT.rideMuzzle = function () { const j = P.ride, d = dirVec(P.yaw, P.pitch); return V(j.x + d.x * 1.0, j.y + 1.0 + d.y * .9, j.z + d.z * 1.0); };
  function buildJet(col) {
    const g = new T.Group(), hullM = new T.MeshStandardMaterial({ color: col, roughness: .35, metalness: .2 }), dk = new T.MeshStandardMaterial({ color: 0x1a1d24, roughness: .6 }), wh = new T.MeshStandardMaterial({ color: 0xf4f6fa, roughness: .4 });
    const add = (geo, mat, x, y, z, rx = 0) => { const q = new T.Mesh(geo, mat); q.position.set(x, y, z); q.rotation.x = rx; q.castShadow = true; g.add(q); return q; };
    add(rbox(1.0, .42, 2.7, .16, 2), hullM, 0, .1, 0); add(rbox(.84, .12, 1.9, .05, 2), wh, 0, .36, .1); add(rbox(.42, .16, 1.0, .06, 2), dk, 0, .48, .45); add(rbox(.62, .3, .6, .1, 2), hullM, 0, .55, -.62, -.35);
    const bar = add(new T.CylinderGeometry(.025, .025, .72, 8), dk, 0, .82, -.68); bar.rotation.z = Math.PI / 2; add(new T.CylinderGeometry(.03, .03, .3, 8), dk, 0, .7, -.7);
    add(new T.PlaneGeometry(.5, .28), new T.MeshStandardMaterial({ color: 0x9fdcff, transparent: true, opacity: .45, roughness: .1, side: T.DoubleSide }), 0, .86, -.95, -.5);
    add(new T.SphereGeometry(.09, 10, 8), new T.MeshBasicMaterial({ color: 0xfff3b0 }), 0, .22, -1.36); add(new T.CylinderGeometry(.14, .17, .3, 12), dk, 0, .08, 1.38, Math.PI / 2);
    g.visible = true; sc.add(g); return g;
  }
  function seaSpot(isl, ang) { const i = ISL[isl]; for (let r = 4; r < 60; r += .5) { const x = i.x + Math.cos(ang) * r, z = i.z + Math.sin(ang) * r * (i.rz / i.rx); if (gmax(x, z, 2.2) === -Infinity && r > 6) return [x, z]; } return [i.x + Math.cos(ang) * 40, i.z + Math.sin(ang) * 40]; }
  [[0, Math.PI, 0xff5a3c], [1, 0, 0x2aa8ff], [0, Math.PI * .5, 0xffd23a], [1, -Math.PI * .5, 0x6bff6b]].forEach(([isl, ang, col]) => { const [x, z] = seaSpot(isl, ang); JET.push({ x, z, y: SEA_Y, yaw: ang + Math.PI / 2, v: 0, vy: 0, air: false, g: buildJet(col), rider: null, lean: 0, home: [x, z] }); });
  [[BRIDGE.mid - 9, 11, .3], [BRIDGE.mid + 9, -11, -.3], [-40, 26, 1.2], [44, -25, 2.4]].forEach(([x, z, yaw]) => { if (gmax(x, z, 2) !== -Infinity) return; const g = new T.Group(), wood = new T.MeshStandardMaterial({ color: 0x9c6a3a, roughness: .8 }), q = new T.Mesh(rbox(2.6, .2, 3.4, .06, 2), wood); q.rotation.x = .36; q.position.y = .25; q.castShadow = true; g.add(q); const f1 = new T.Mesh(new T.CylinderGeometry(.25, .25, .6, 10), new T.MeshStandardMaterial({ color: 0xe84a3a })); f1.position.set(-1.1, 0, .9); const f2 = f1.clone(); f2.position.x = 1.1; g.add(f1, f2); g.position.set(x, SEA_Y, z); g.rotation.y = yaw; sc.add(g); RAMPS.push({ x, z }); });
  const useEl = $('use'); let useTxt = '';
  const nearJet = () => { let b = null, bd = 7; for (const j of JET) if (!j.rider) { const d = Math.hypot(j.x - P.x, j.z - P.z); if (d < bd && Math.abs(P.y - (j.y + .5)) < 5) { bd = d; b = j; } } return b; };
  function landNear(x, z) { for (let r = 1.5; r < 7; r += .5) for (let a = 0; a < 6.28; a += .5) { const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; if (gmax(px, pz, .5) > -Infinity && ground(px, pz) > .3) return [px, pz]; } return null; }
  FT.jetNear = () => !!nearJet();
  FT.rideInfo = () => { const j = P.ride; if (!j) return null; return [JET.indexOf(j), +j.yaw.toFixed(2), +j.lean.toFixed(2), +j.v.toFixed(1)]; };
  FT.netRide = (b, i, yaw, lean, v) => {
    const j = JET[i | 0]; if (!j || j.rider === P) return; if (b.jet && b.jet !== j && b.jet.rider === b) b.jet.rider = null;
    j.rider = b; b.jet = j; j.x = b.x; j.z = b.z; j.y = b.y + .37; let da = yaw - j.yaw; da = Math.atan2(Math.sin(da), Math.cos(da)); j.yaw += da * .4; j.lean = lean; j.v = v; j.air = !b.tg;
  };
  FT.netRideEnd = b => { if (b.jet && b.jet.rider === b) b.jet.rider = null; b.jet = null; };
  FT.throwRaw = (o, x, y, z, vx, vy, vz, fuse, holy) => { const ok = throwGren(o, x, y, z, vx, vy, vz, holy); if (ok && holy) { feed('✝ ' + (o.name || 'Someone') + ' pulled the HOLY HAND GRENADE'); snd('hallelujah', undefined, undefined, undefined, { force: true }); } if (ok && fuse >= 1 && fuse <= 5) { const q = GR.filter(q => q.on && q.owner === o).pop(); if (q) q.t = fuse; } return ok; };
  FT.use = function () {
    if (!S.running || !live() || !P.alive) return;
    if (P.ride) { const j = P.ride, l = landNear(j.x, j.z); if (!l) { feed('No shore nearby — ride closer to land'); return; } P.ride = null; j.rider = null; P.x = l[0]; P.z = l[1]; P.y = gy(l[0], l[1]) + .01; P.vx = P.vz = P.vy = 0; cockpit.visible = false; if (AU) AU.engine(null); snd('mount'); return; }
    const j = nearJet(); if (!j) { feed('No jetski close by — walk to the shore beside one'); return; } if (j) { releaseRope(false); P.ride = j; j.rider = P; P.yaw = j.yaw; cockpit.visible = false; snd('mount'); P.ads = 0; mouseR = false; }
  };
  FT.rideStep = function (dt) {
    const j = P.ride; if (!j) return;
    const thr = (KEYS.KeyW ? 1 : 0) - (KEYS.KeyS ? .6 : 0) - P.jy, st = (KEYS.KeyA ? 1 : 0) - (KEYS.KeyD ? 1 : 0) - P.jx;
    const tv = thr > 0 ? thr * 25 : thr * 9; j.v += (tv - j.v) * Math.min(1, dt * (Math.abs(tv) > Math.abs(j.v) ? .8 : .6)); if (!thr) j.v *= 1 - .35 * dt;
    const dyw = st * 1.55 * clamp(Math.abs(j.v) / 7, 0, 1) * Math.sign(j.v || 1) * dt; j.yaw += dyw; P.yaw += dyw; j.lean += (st * clamp(j.v / 25, 0, 1) - j.lean) * Math.min(1, dt * 5);
    const fx = -Math.sin(j.yaw), fz = -Math.cos(j.yaw); let nx = j.x + fx * j.v * dt, nz = j.z + fz * j.v * dt;
    if (gmax(nx, nz, .9) > -Infinity) { if (Math.abs(j.v) > 3) { snd('jetBump'); shake = Math.min(1, shake + .3); } j.v *= -.3; nx = j.x; nz = j.z; if (gmax(nx, nz, .9) > -Infinity) { const l = landNear(nx, nz); if (l) { nx += (nx - l[0]) * .05; nz += (nz - l[1]) * .05; } } }
    if (Math.abs(nx) > 150 || Math.abs(nz) > 100) { j.v *= .5; nx = j.x; nz = j.z; if (S.t - (j.warn || -9) > 3) { j.warn = S.t; feed('Open sea — turn back'); } }
    j.x = nx; j.z = nz;
    const wy = SEA_Y + .05 + Math.sin(S.t * 3 + j.x * .4) * .06 + Math.sin(S.t * 2.2 + j.z * .3) * .05;
    if (!j.air) { j.y = wy; if (j.v > 7) for (const r of RAMPS) if (Math.hypot(j.x - r.x, j.z - r.z) < 2.1) { j.air = true; j.vy = 5.5 + j.v * .24; snd('jump'); break; } }
    else { j.vy -= 24 * dt; j.y += j.vy * dt; if (j.y <= wy) { j.y = wy; j.air = false; if (j.vy < -4) { snd('splash'); puff(j.x, wy + .2, j.z, 0xdff3ff, 22, 8, .16, .8, 6); } j.vy = 0; } }
    P.x = j.x; P.z = j.z; P.y = j.y - .37; P.vx = fx * j.v; P.vz = fz * j.v; P.vy = j.vy; P.ground = !j.air;
    P.fovK = Math.max(P.fovK, Math.abs(j.v) * .22);
    const sp01 = clamp(Math.abs(j.v) / 25, 0, 1); if (AU) AU.engine(.12 + sp01 * .88);
    if (Math.abs(j.v) > 3 && !j.air) { const bx = j.x + Math.sin(j.yaw) * 1.4, bz = j.z + Math.cos(j.yaw) * 1.4; puff(bx, wy + .1, bz, 0xe6f6ff, 2, 2.2 + sp01 * 3, .13, .55, 1.5 + sp01 * 2); if (Math.abs(j.lean) > .35) puff(j.x + Math.cos(j.yaw) * -Math.sign(j.lean) * .6, wy + .15, j.z - Math.sin(j.yaw) * -Math.sign(j.lean) * .6, 0xe6f6ff, 1, 3, .1, .5, 2); }
    HK.lean = -j.lean * .09;
  };
  function jetVisual(dt) {
    for (const j of JET) {
      const wy = SEA_Y + .05 + Math.sin(S.t * 3 + j.x * .4) * .06;
      if (!j.rider) { j.y += (wy - j.y) * Math.min(1, dt * 4); j.v *= 1 - .8 * dt; j.air = false; }
      j.g.position.set(j.x, j.y, j.z); j.g.rotation.set(-clamp(j.v / 25, -.2, 1) * .09 + (j.air ? clamp(-j.vy * .03, -.3, .3) : 0), j.yaw, -j.lean * .35 + Math.sin(S.t * 2 + j.x) * .02, 'YXZ'); j.g.visible = true;
    }
    if (!P.ride) { HK.lean = (HK.lean || 0) * (1 - Math.min(1, dt * 6)); if (AU) AU.engine(null); }
    cockpit.visible = false; vmRoot.visible = !(P.ride && P.alive);
    if (P.ride && P.alive) { if (riderG.parent !== P.ride.g) P.ride.g.add(riderG); riderG.visible = true; rAim.rotation.set(clamp(P.pitch, -1.2, 1.2), P.yaw - P.ride.yaw, 0, 'YXZ'); } else if (riderG.parent) { riderG.parent.remove(riderG); riderG.visible = false; }
    // use prompt
    let txt = ''; if (S.running && live() && P.alive) { if (P.ride) txt = TOUCH ? '' : 'E · GET OFF'; else if (nearJet()) txt = TOUCH ? 'TAP RIDE' : 'E · RIDE JETSKI'; }
    if (useEl && txt !== useTxt) { useTxt = txt; useEl.textContent = txt; useEl.style.opacity = txt ? 1 : 0; }
    const tu = $('tuse'); if (tu) { const t = P.ride ? 'GET OFF' : (nearJet() ? 'RIDE' : 'RIDE'); if (tu.textContent !== t) tu.textContent = t; tu.style.opacity = (P.ride || nearJet()) ? 1 : .35; }
  }

  /* ============================ AIRDROPS ============================ */
  const DROPS = [], DT = {
    health: { c: 0xff4a5a, e: '❤️', label: 'HEALTH' }, ammo: { c: 0xffd23a, e: '🔫', label: 'AMMO + GRENADES' }, goat: { c: 0xf4efe4, e: '🐐', label: 'RANDOM GOAT' }, holy: { c: 0xffd23a, e: '✝️', label: 'HOLY HAND GRENADE' }
  };
  const chuteGeo = new T.SphereGeometry(1.7, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), beamGeo = new T.CylinderGeometry(.22, .22, 70, 10, 1, true);
  function newDrop(type) {
    const def = DT[type], g = new T.Group(), crate = new T.Mesh(rbox(.9, .8, .9, .1, 2), new T.MeshStandardMaterial({ color: def.c, roughness: .5 })); crate.castShadow = true; g.add(crate);
    const band = new T.Mesh(new T.BoxGeometry(.94, .12, .94), new T.MeshStandardMaterial({ color: 0x2a2a30 })); g.add(band);
    const chute = new T.Mesh(chuteGeo, new T.MeshStandardMaterial({ color: def.c, roughness: .8, side: T.DoubleSide })); chute.position.y = 3.2; chute.castShadow = true; g.add(chute);
    const pts = []; for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; pts.push(V(Math.cos(a) * 1.65, 3.2, Math.sin(a) * 1.65), V(Math.cos(a) * .35, .4, Math.sin(a) * .35)); }
    const strings = new T.LineSegments(new T.BufferGeometry().setFromPoints(pts), new T.LineBasicMaterial({ color: 0xffffff })); g.add(strings);
    const em = emojiSprite(def.e, 1.0); em.position.y = 1.15; g.add(em);
    const beam = new T.Mesh(beamGeo, new T.MeshBasicMaterial({ color: def.c, transparent: true, opacity: .28, depthWrite: false, blending: T.AdditiveBlending, fog: false, side: T.DoubleSide })); beam.position.y = 35; g.add(beam);
    sc.add(g); return { g, chute, strings, beam, type, state: 'fall', t: 0, ph: rnd(6.28), hp: 150, isDrop: true };
  }
  function spawnDrop(type, pos, id) {
    const s = pos || SPAWNS[Math.random() * SPAWNS.length | 0]; if (!s) return; if (!pos && window.NET && NET.on && NET.count > 0) { id = Math.random().toString(36).slice(2, 8); NET.send('drop', { ty: type, x: s[0], z: s[1], i: id }); } const d = newDrop(type); d.id = id || null; d.x = s[0] - WIND.vx * 1.1 * 11.5; d.z = s[1] - WIND.vz * 1.1 * 11.5; d.y = 62; d.gy = gy(s[0], s[1]) + .4; d.tx = s[0]; d.tz = s[1]; DROPS.push(d); d.g.position.set(d.x, d.y, d.z);
    feed('📦 SUPPLY DROP — ' + DT[type].label); announce(type === 'goat' ? 'RANDOM GOAT INCOMING' : type === 'holy' ? 'HOLY HAND GRENADE INBOUND' : 'SUPPLY DROP INBOUND', false); snd('chute');
  }
  function dropPick(d, who) {
    const isP = who === P; if ((d.type === 'goat' || d.type === 'holy') && !isP) return false;
    if (d.type === 'health') { if (who.hp >= 100) return false; who.hp = Math.min(100, who.hp + 60); if (isP) { hudHp(); setFaceOv('😋', 1); feed('+60 health'); } }
    else if (d.type === 'ammo') { if (!isP) return false; P.ammo[1] = WP[1].mag; P.ammo[2] = WP[2].mag; P.gren = Math.min(6, (P.gren || 0) + 3); feed('+3 grenades · ammo full'); hudAmmo(); }
    else if (d.type === 'holy') { P.holy = Math.min(2, (P.holy || 0) + 1); feed('✝ HOLY HAND GRENADE acquired — press H to throw'); announce('HOLY HAND GRENADE', false); FT.hud(); }
    else { P.ammo[3] = Math.min(3, (P.ammo[3] || 0) + 1); feed('🐐 RANDOM GOAT acquired — press 4'); announce('RANDOM GOAT', false); selectWeapon(3); }
    if (isP) snd('pickup'); else snd('pickup', d.x, d.y, d.z); return true;
  }
  /* a falling crate that gets roped turns into a hovering balloon until somebody shoots it down; every crate has 150 hp (1.5 x a worm) and explodes when it runs out */
  function setBalloon(d) {
    if (d.balloon || d.state !== 'fall' || d.taken) return; d.balloon = true; d.by0 = d.y; d.chute.visible = false;
    const bal = new T.Mesh(new T.SphereGeometry(1.9, 22, 16), new T.MeshStandardMaterial({ color: DT[d.type].c, roughness: .7 })); bal.position.y = 3.7; bal.castShadow = true; d.g.add(bal);
    const band = new T.Mesh(new T.TorusGeometry(1.9, .09, 6, 30), new T.MeshStandardMaterial({ color: 0xffffff, roughness: .6 })); band.rotation.x = Math.PI / 2; bal.add(band); d.bal = bal;
    feed('🎈 Crate inflated into a balloon — it hovers while roped, drifts down if abandoned'); snd('chute', d.x, d.y, d.z);
  }
  function crateBoom(d, by) {
    if (d.taken) return; d.taken = true; const x = d.x, y = d.y + .5, z = d.z;
    puff(x, y, z, 0xffd070, 22, 14, .16, .7, 7); puff(x, y, z, DT[d.type].c, 20, 9, .2, 1, 5); puff(x, y, z, 0x2b2622, 20, 6, .6, 1.8, 3); snd('explosion', x, y, z, { force: true });
    explode(x, y, z, by, 1, .8, 'CRATE'); if (by === P) feed('YOU ▸ CRATE BLOWN UP');
  }
  function crateHit(d, dmg, by, send) {
    if (d.taken) return; if (send && d.id && window.NET && NET.on) NET.send('ch', { i: d.id, dm: Math.round(dmg) });
    d.hp -= dmg; puff(d.x, d.y + .5, d.z, 0xcbb892, 4, 3, .07, .4); snd('hit', d.x, d.y, d.z, { vol: .5 });
    if (d.hp <= 0) crateBoom(d, by);
  }
  FT.dropBalloon = id => { for (const d of DROPS) if (d.id && d.id === id) setBalloon(d); };
  FT.crateHitId = (id, dm, by) => { for (const d of DROPS) if (d.id && d.id === id) crateHit(d, dm, by, false); };
  let nextDrop = 7;
  function dropsUpdate(dt) {
    const net = window.NET && NET.on && NET.count > 0; if (!net || NET.leader()) nextDrop -= dt;
    if (nextDrop <= 0 && !S.over) { nextDrop = rnd(20, 32); const r = Math.random(); spawnDrop(r < .31 ? 'health' : r < .58 ? 'ammo' : r < .88 ? 'goat' : 'holy'); }
    for (let i = DROPS.length - 1; i >= 0; i--) {
      const d = DROPS[i]; d.t += dt;
      if (d.taken) { sc.remove(d.g); DROPS.splice(i, 1); continue; }
      if (d.balloon) {
        /* held = somebody (me or a remote player) has a rope on the balloon; an abandoned balloon drifts down like the parachute did and lands as a normal crate */
        const by = d.y + 3.7; let held = !!(P.rope && P.rope.obj && P.rope.obj.ref === d) || !!ropeFly;
        if (!held) for (const b of BOTS) if (!b.dead && b.rope && Math.hypot(b.rope[0] - d.x, b.rope[1] - by, b.rope[2] - d.z) < 3.4) { held = true; break; }
        if (held) d.heldT = d.t; else if (d.heldT === undefined) d.heldT = d.t;
        if (d.t - d.heldT > .8) {
          if (!d.drift) { d.drift = true; if (d.t < 900) feed('🎈 Balloon abandoned — drifting down'); }
          d.by0 -= 2.6 * dt; d.x += (Math.sin(d.t * 1.1 + d.ph) * .7 + WIND.vx * 1.1) * dt; d.z += (Math.cos(d.t * .9 + d.ph) * .7 + WIND.vz * 1.1) * dt;
          if (d.by0 <= d.gy) {
            const gg = ground(d.x, d.z); if (!(gg > -Infinity) || Math.abs(gg + .4 - d.gy) > 1.6) { d.x = d.tx; d.z = d.tz; } else d.gy = gg + .4;
            d.y = d.gy; d.balloon = false; d.drift = false; if (d.bal) { d.g.remove(d.bal); d.bal = null; } d.state = 'land'; d.t = 0; d.g.rotation.set(0, d.g.rotation.y, 0); d.g.position.set(d.x, d.y, d.z); d.chute.visible = false; d.strings.visible = false;
            snd('crateLand', d.x, d.y, d.z); puff(d.x, d.y, d.z, 0xcbb892, 14, 4, .12, .8); continue;
          }
        } else d.drift = false;
        d.bobT = (d.bobT || 0) + dt; d.y = d.by0 + Math.sin(d.bobT * 1.2) * .3; d.g.position.set(d.x, d.y, d.z); d.g.rotation.z = Math.sin(d.bobT * .9 + d.ph) * .07; d.bal.scale.setScalar(1 + Math.sin(d.bobT * 2) * .015); d.beam.material.opacity = .2 + Math.sin(d.t * 3) * .07; continue; }
      if (d.state === 'fall') { d.y -= 5.2 * dt; d.x += (Math.sin(d.t * 1.1 + d.ph) * .7 + WIND.vx * 1.1) * dt; d.z += (Math.cos(d.t * .9 + d.ph) * .7 + WIND.vz * 1.1) * dt; d.g.position.set(d.x, d.y, d.z); d.g.rotation.z = Math.sin(d.t * 1.3 + d.ph) * .06 - WIND.vx * .12; d.g.rotation.x = WIND.vz * .12; d.chute.scale.x = d.chute.scale.z = 1 + Math.sin(d.t * 5 + d.ph) * .02 * (.5 + WIND.e); if (d.y <= d.gy) { { const gg = ground(d.x, d.z); if (!(gg > -Infinity) || Math.abs(gg + .4 - d.gy) > 1.6) { d.x = d.tx; d.z = d.tz; d.g.position.x = d.x; d.g.position.z = d.z; } else d.gy = gg + .4; } d.y = d.gy; d.state = 'land'; d.g.rotation.x = 0; d.t = 0; d.g.rotation.z = 0; d.g.position.y = d.y; snd('crateLand', d.x, d.y, d.z); puff(d.x, d.y, d.z, 0xcbb892, 14, 4, .12, .8); } }
      else {
        d.chute.scale.y = Math.max(.05, d.chute.scale.y - dt * .9); d.chute.position.y = 3.2 - (1 - d.chute.scale.y) * 3; d.chute.material.opacity = 1; if (d.t > 2.5) { d.chute.visible = false; d.strings.visible = false; }
        d.g.children[0].rotation.y += dt * .5; d.beam.material.opacity = .2 + Math.sin(d.t * 3) * .07;
        for (const w of [P, ...BOTS]) { if (w.net) continue; if ((w === P ? !P.alive : w.dead)) continue; if (Math.hypot(w.x - d.x, w.z - d.z) < 1.7 && Math.abs(w.y - d.y) < 2.2 && dropPick(d, w)) { if (w === P && d.id && window.NET && NET.on) NET.send('pk', { i: d.id }); d.t = 999; break; } }
        if (d.t > 45) d.t = 999;
      }
      if (d.taken || d.t === 999 || (d.state === 'land' && d.t > 999)) { sc.remove(d.g); DROPS.splice(i, 1); }
    }
  }

  /* ============================ RANDOM GOAT ============================ */
  const GOATS = []; WP[3] = { n: 'GOAT', goat: 1, rate: .6, dmg: 0 };
  function goatMesh() {
    const g = new T.Group(), body = new T.MeshStandardMaterial({ color: 0xf5f0e6, roughness: .85 }), dk = new T.MeshStandardMaterial({ color: 0x2a2420, roughness: .7 }), hornM = new T.MeshStandardMaterial({ color: 0xcdbfa0, roughness: .6 }), pink = new T.MeshStandardMaterial({ color: 0xffa0b4, roughness: .7 });
    const add = (geo, mat, x, y, z, rx = 0, rz = 0) => { const m = new T.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, 0, rz); m.castShadow = true; g.add(m); return m; };
    const hop = new T.Group(); g.add(hop);
    const A = (geo, mat, x, y, z, rx = 0, rz = 0) => { const m = add(geo, mat, x, y, z, rx, rz); g.remove(m); hop.add(m); return m; };
    A(rbox(.5, .42, .8, .14, 2), body, 0, .52, 0); A(rbox(.32, .34, .34, .11, 2), body, 0, .74, -.46); A(rbox(.2, .14, .16, .06, 2), pink, 0, .68, -.62);
    A(new T.SphereGeometry(.045, 8, 6), dk, -.1, .8, -.62); A(new T.SphereGeometry(.045, 8, 6), dk, .1, .8, -.62);
    A(new T.ConeGeometry(.045, .26, 8), hornM, -.1, .98, -.46, -.35, .35); A(new T.ConeGeometry(.045, .26, 8), hornM, .1, .98, -.46, -.35, -.35);
    A(rbox(.18, .06, .12, .02, 2), body, -.22, .8, -.46, 0, .5); A(rbox(.18, .06, .12, .02, 2), body, .22, .8, -.46, 0, -.5);
    A(new T.ConeGeometry(.04, .14, 6), body, 0, .6, -.56, Math.PI, 0);
    for (const [x, z] of [[-.17, -.28], [.17, -.28], [-.17, .28], [.17, .28]]) { A(new T.CylinderGeometry(.06, .05, .4, 8), body, x, .2, z); A(new T.CylinderGeometry(.065, .065, .06, 8), dk, x, .02, z); }
    A(new T.SphereGeometry(.09, 8, 6), body, 0, .62, .42); g.userData.hop = hop; return g;
  }
  for (let i = 0; i < 5; i++) { const m = goatMesh(); m.visible = false; sc.add(m); GOATS.push({ g: m, on: false }); }
  /* networked goats: my goats are simulated here and broadcast; other players' goats are displayed from their state */
  const RG = []; for (let i = 0; i < 10; i++) { const m = goatMesh(); m.visible = false; sc.add(m); RG.push({ g: m, on: false, remote: true, x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, ang: 0, air: 0, last: 0, bt: 1, peer: '', slot: 0 }); }
  FT.goatState = () => { const l = []; GOATS.forEach((g, i) => { if (g.on && g.owner === P) l.push([i, +g.x.toFixed(2), +g.y.toFixed(2), +g.z.toFixed(2), +g.g.rotation.y.toFixed(2), g.ground ? 0 : 1]); }); return l; };
  FT.goatNet = (peer, list) => {
    for (const q of list) {
      if (!Array.isArray(q) || q.length < 6 || !q.every(isFinite)) continue; let gt = RG.find(o => o.on && o.peer === peer && o.slot === q[0]);
      if (!gt) { gt = RG.find(o => !o.on); if (!gt) continue; Object.assign(gt, { on: true, peer, slot: q[0], x: q[1], y: q[2], z: q[3], bt: rnd(.4, 1) }); gt.g.visible = true; snd('bleat', q[1], q[2], q[3], { pitch: rnd(.95, 1.25), vol: 1.5, force: true }); }
      gt.tx = q[1]; gt.ty = q[2]; gt.tz = q[3]; gt.ang = q[4]; gt.air = q[5]; gt.last = S.t;
    }
  };
  function rgUpdate(dt) {
    for (const gt of RG) if (gt.on) {
      if (S.t - gt.last > .6) { gt.on = false; gt.g.visible = false; continue; }
      const k = Math.min(1, dt * 14); if (Math.hypot(gt.tx - gt.x, gt.tz - gt.z) > 8) { gt.x = gt.tx; gt.y = gt.ty; gt.z = gt.tz; } else { gt.x += (gt.tx - gt.x) * k; gt.y += (gt.ty - gt.y) * k; gt.z += (gt.tz - gt.z) * k; }
      gt.bt -= dt; if (gt.bt <= 0) { const gd = P.alive ? Math.hypot(P.x - gt.x, P.z - gt.z) : 40, near = clamp(1 - gd / 40, 0, 1); gt.bt = rnd(.9, 1.5) * (1 - near * .65); snd('bleat', gt.x, gt.y, gt.z, { pitch: rnd(.95, 1.25) + near * .12, vol: 1.5 + near * 1.3, force: true }); }
      const st = gt.air ? 1.22 : 1; gt.g.userData.hop.scale.set(1 / Math.sqrt(st), st, 1 / Math.sqrt(st)); gt.g.position.set(gt.x, gt.y, gt.z);
      let da = gt.ang - gt.g.rotation.y; da = Math.atan2(Math.sin(da), Math.cos(da)); gt.g.rotation.y += da * Math.min(1, dt * 10);
    }
  }
  FT.goatHitSlot = (slot, dmg, by) => { const gt = GOATS[slot]; if (gt && gt.on && gt.owner === P) goatHit(gt, dmg, by); };
  FT.goatBoom = (peer, x, y, z, k, killer) => {
    let bd = 5, bg = null; for (const gt of RG) if (gt.on && gt.peer === peer) { const d = Math.hypot(gt.x - x, gt.z - z); if (d < bd) { bd = d; bg = gt; } } if (bg) { bg.on = false; bg.g.visible = false; }
    if (k === 1) { puff(x, y + .5, z, 0xf5f0e6, 22, 6, .16, .9, 5); puff(x, y + .5, z, 0xffa0b4, 8, 5, .11, .8, 5); snd('goatPop', x, y, z); return; }
    bloodAt(x, y + .3, z, 60, 0, 0, true); puff(x, y + .3, z, 0xf5f0e6, 18, 7, .14, .9, 5); snd('goatPop', x, y, z); explode(x, y, z, killer, .55, .3, 'GOAT BLAST');
  };
  // viewmodel: holding a goat
  (function () { const g = goatMesh(); g.scale.setScalar(.5); g.position.set(0, -.22, -.1); g.rotation.set(.15, Math.PI, 0); const wrap = new T.Group(); wrap.add(g); const h = hand(.05); h.position.set(.0, -.12, .05); wrap.add(h); const h2 = hand(.05); h2.position.set(-.06, -.1, -.1); wrap.add(h2); VM[3] = { g: wrap, hip: [.2, -.26, -.5], ads: [.2, -.26, -.5], rot: [0, 0, 0], muz: null, kick: 0, pos: V(.2, -.26, -.5) }; wrap.visible = false; vmRoot.add(wrap); VM[3].g.scale.setScalar(1); })();
  FT.releaseGoat = function () {
    if ((P.ammo[3] || 0) <= 0 || !P.alive) return; const gt = GOATS.find(q => !q.on); if (!gt) return;
    const d = dirVec(P.yaw, 0), o = V(); cam.getWorldPosition(o);
    Object.assign(gt, { on: true, x: P.x + d.x * 1.1, z: P.z + d.z * 1.1, y: o.y - .6, vx: d.x * 5, vz: d.z * 5, vy: 5.5, owner: P, hp: 100, t: 0, jt: .35, ground: false, sq: 0, ang: Math.atan2(-d.x, -d.z), bt: .2, arm: 3.5, hops: 0 }); gt.g.visible = true;
    P.ammo[3]--; snd('bleat'); P.swap = .3; hudAmmo(); if (P.ammo[3] <= 0) defer(() => { if (P.w === 3) selectWeapon(1); }, .35);
  };
  function goatsUpdate(dt) {
    for (const gt of GOATS) if (gt.on) {
      gt.t += dt; gt.arm -= dt; gt.bt -= dt;
      if (gt.bt <= 0) { const gd = P.alive ? Math.hypot(P.x - gt.x, P.z - gt.z) : 40, near = clamp(1 - gd / 40, 0, 1); gt.bt = rnd(.9, 1.5) * (1 - near * .65); snd('bleat', gt.x, gt.y, gt.z, { pitch: rnd(.95, 1.25) + near * .12, vol: 1.5 + near * 1.3, force: true }); }
      gt.vy -= 24 * dt; gt.x += gt.vx * dt; gt.z += gt.vz * dt; gt.y += gt.vy * dt; const g = ground(gt.x, gt.z);
      if (g === -Infinity && gt.y < SEA_Y - .2) { puff(gt.x, SEA_Y + .2, gt.z, 0xcfe8ff, 10, 3, .1, .6, 4); gt.on = false; gt.g.visible = false; snd('splash', gt.x, SEA_Y, gt.z); continue; }
      if (g > -Infinity && gt.y <= g) { gt.y = g; if (gt.vy < -3) { gt.sq = .16; snd('grenBounce', gt.x, gt.y, gt.z); } gt.vy = 0; gt.vx *= .3; gt.vz *= .3; gt.ground = true; gt.jt -= dt;
        if (gt.jt <= 0) { // newborn-goat hop: random heading, sometimes lunge at the nearest worm
          const first = gt.hops < 3; let tgt = null, bd = first ? 70 : 18; for (const t of targets()) { if (t === gt.owner && (gt.arm > 0 || first)) continue; const d = Math.hypot(t.x - gt.x, t.z - gt.z); if (d < bd) { bd = d; tgt = t; } }
          let ang = Math.random() * 6.283; if (tgt && (first || Math.random() < .38)) ang = Math.atan2(-(tgt.x - gt.x), -(tgt.z - gt.z)) + rnd(first ? -.12 : -.5, first ? .12 : .5); gt.hops++;
          const sp = first ? rnd(7.5, 9.5) : rnd(4.5, 8.5); let ok = false; for (let k = 0; k < 7; k++) { const dx = -Math.sin(ang), dz = -Math.cos(ang); if (ground(gt.x + dx * sp * .5, gt.z + dz * sp * .5) > -Infinity && ground(gt.x + dx * sp * .9, gt.z + dz * sp * .9) > -Infinity) { ok = true; gt.vx = dx * sp; gt.vz = dz * sp; gt.ang = ang; break; } ang += 1.1; }
          if (!ok) { gt.vx = gt.vz = 0; }
          gt.vy = rnd(5.5, 9.5); gt.ground = false; gt.jt = rnd(.12, .4); gt.flip = (Math.random() < .5 ? -1 : 1) * rnd(0, 6);
        }
      }
      if (g > -Infinity && ground(gt.x, gt.z) > gt.y + .3) { gt.vx *= -.5; gt.vz *= -.5; }
      gt.sq = Math.max(0, gt.sq - dt); const st = gt.vy > 1 ? 1.22 : gt.sq > 0 ? .62 : 1; gt.g.userData.hop.scale.set(1 / Math.sqrt(st), st, 1 / Math.sqrt(st)); gt.g.position.set(gt.x, gt.y, gt.z); gt.g.rotation.y += (gt.ang - gt.g.rotation.y) * Math.min(1, dt * 10); gt.g.rotation.x = gt.ground ? 0 : -gt.vy * .03; gt.g.rotation.z = gt.ground ? 0 : (gt.flip || 0) * .1 * Math.sign(gt.vy || 1) * (1 - Math.abs(gt.vy) / 12);
      // gore
      for (const t of targets()) { if (t === gt.owner && gt.arm > 0) continue; if (Math.hypot(t.x - gt.x, t.z - gt.z) < 1 && gt.y - t.y > -.4 && gt.y - t.y < 1.9) { goatKill(gt, t); break; } }
      if (gt.on && gt.t > 28) { goatPoof(gt); }
    }
  }
  const GR_ = (o, d, c, r) => { const ox = c.x - o.x, oy = c.y - o.y, oz = c.z - o.z, tc = ox * d.x + oy * d.y + oz * d.z; if (tc < 0) return Infinity; const d2 = ox * ox + oy * oy + oz * oz - tc * tc; if (d2 > r * r) return Infinity; return tc - Math.sqrt(r * r - d2); };
  FT.goatRay = function (o, d, best) { let bt = best, g = null; for (const dr of DROPS) { if (dr.taken) continue; let t = GR_(o, d, { x: dr.x, y: dr.y + .45, z: dr.z }, .85); if (dr.chute.visible || dr.balloon) t = Math.min(t, GR_(o, d, { x: dr.x, y: dr.y + (dr.balloon ? 3.7 : 3.2), z: dr.z }, dr.balloon ? 1.9 : 1.6)); if (t < bt) { bt = t; g = dr; } } for (const gt of GOATS.concat(RG)) { if (!gt.on) continue; const t = GR_(o, d, { x: gt.x, y: gt.y + .55, z: gt.z }, .75); if (t < bt) { bt = t; g = gt; } } return g ? { t: bt, g } : null; };
  function goatHit(gt, dmg, by) {
    if (gt.isDrop) { crateHit(gt, dmg, by, by === P); return; }
    if (!gt.on) return;
    if (gt.remote) { bloodAt(gt.x, gt.y + .6, gt.z, dmg * .5, 0, 0, false); snd('bleat', gt.x, gt.y, gt.z, { pitch: 1.8, vol: 1.6, force: true }); if (window.NET && NET.on) NET.send('gh', { to: gt.peer, i: gt.slot, dm: Math.round(dmg) }); return; }
    gt.hp -= dmg; bloodAt(gt.x, gt.y + .6, gt.z, dmg * .5, 0, 0, false); snd('bleat', gt.x, gt.y, gt.z, { pitch: 1.8, vol: 1.6, force: true }); gt.sq = .12;
    if (gt.hp <= 0) goatDie(gt, by);
  }
  FT.goatHit = goatHit;
  function goatDie(gt, by) {
    gt.on = false; gt.g.visible = false; const x = gt.x, y = gt.y + .4, z = gt.z;
    if (gt.owner === P && window.NET && NET.on) NET.send('gx', { x: +x.toFixed(2), y: +y.toFixed(2), z: +z.toFixed(2), k: 0, by: by && by.net ? by.peer : (by === P ? NET.me : null) });
    bloodAt(x, y + .3, z, 60, 0, 0, true); puff(x, y + .3, z, 0xf5f0e6, 18, 7, .14, .9, 5); snd('goatPop', x, y, z);
    explode(x, y, z, by || gt.owner, .55, .3, 'GOAT BLAST'); if (by === P) feed('YOU ▸ GOAT [' + (WP[P.w].n || 'SHOT') + '] BLOWN UP');
  }
  FT.botGoat = function (b, dt) {
    b.gdc = (b.gdc === undefined ? rnd(.2, .5) : b.gdc) - dt; if (b.gdc > 0) return;
    for (const gt of GOATS) { if (!gt.on || gt.owner === b) continue; const d = Math.hypot(gt.x - b.x, gt.z - b.z); if (d > 15 || losBlocked(b.x, b.y + 1.4, b.z, gt.x, gt.y + .6, gt.z)) continue; b.gdc = rnd(.35, .6); b.kick = 1; b.burstT = .3; snd(b.kind === 'uzi' ? 'uzi' : 'shotgun', b.x, b.y, b.z); if (Math.random() < .75) goatHit(gt, rnd(9, 15), b); return; }
    b.gdc = .25;
  };
  function goatPoof(gt) { if (gt.owner === P && window.NET && NET.on) NET.send('gx', { x: +gt.x.toFixed(2), y: +gt.y.toFixed(2), z: +gt.z.toFixed(2), k: 1, by: null }); puff(gt.x, gt.y + .5, gt.z, 0xf5f0e6, 22, 6, .16, .9, 5); puff(gt.x, gt.y + .5, gt.z, 0xffa0b4, 8, 5, .11, .8, 5); snd('goatPop', gt.x, gt.y, gt.z); gt.on = false; gt.g.visible = false; }
  function goatKill(gt, t) {
    const owner = gt.owner; FT.src = { x: gt.x, z: gt.z };
    if (t === P) damagePlayer(999, owner === P ? null : owner, 'GOAT'); else damageBot(t, 999, owner, 'GOAT', false);
    snd('bleat', gt.x, gt.y, gt.z, { pitch: 1.5 }); goatPoof(gt); if (owner === P && t !== P) announce('GOAT KILL', true);
  }
  FT.goatSelect = function () { if ((P.ammo[3] || 0) > 0) selectWeapon(3); };
  const WCYC = () => [0, 1, 2].concat(P.ammo[3] > 0 || P.w === 3 ? [3] : [], [4]);
  FT.nextWeapon = function () { const l = WCYC(), i = l.indexOf(P.w); return l[(i + 1) % l.length]; };
  FT.prevWeapon = function () { const l = WCYC(), i = l.indexOf(P.w); return l[(i - 1 + l.length) % l.length]; };

  /* ============================ HUD + glue ============================ */
  FT.hud = function () {
    const gn = $('gn'); if (gn) gn.textContent = '💣 ' + (P.gren || 0) + (TOUCH ? '' : ' · HOLD G · FUSE ' + (P.fuse || 3).toFixed(1) + 's [ ]') + ((P.holy || 0) > 0 ? '  ✝ HOLY ×' + P.holy + (TOUCH ? '' : ' [H]') : '') + (P.rope ? '  🪢' : '');
    const s3 = $('s3'); if (s3) { s3.style.display = (P.ammo[3] > 0 || P.w === 3) ? '' : 'none'; s3.innerHTML = '<b>4</b>GOAT ×' + (P.ammo[3] || 0); }
    if (P.w === 3) { $('wn').textContent = 'RANDOM GOAT'; $('an').textContent = P.ammo[3] || 0; $('ar').textContent = TOUCH ? 'TAP TO RELEASE' : 'CLICK TO RELEASE'; }
  };
  FT.onDeath = function () { FT.gCancel(); releaseRope(false); if (P.ride) { P.ride.rider = null; P.ride = null; cockpit.visible = false; if (AU) AU.engine(null); } };
  FT.onRespawn = function () { P.holy = 0; P.gren = 3; P.ammo[3] = 0; P.gcd = 0; releaseRope(false); FT.hud(); };
  FT.reset = function () { FT.gCancel(); RG.forEach(g => { g.on = false; g.g.visible = false; }); BOTS.forEach(b => { b.balloon = null; if (b.m) b.m.head.scale.set(1, 1, 1); }); BL.forEach(m => m.visible = false); GR.forEach(o => { o.on = false; o.g.visible = false; }); GOATS.forEach(g => { g.on = false; g.g.visible = false; }); DROPS.splice(0).forEach(d => sc.remove(d.g)); nextDrop = 7; FT.onDeath(); };
  /* ============================ BLOOD ============================ */
  const BL = [], bfx = $('bloodfx'); let bli = 0;
  (function () { const geo = new T.CircleGeometry(1, 10); for (let i = 0; i < 90; i++) { const m = new T.Mesh(geo, new T.MeshBasicMaterial({ color: i % 3 ? 0xa80d18 : 0x6a070e, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })); m.rotation.x = -Math.PI / 2; m.visible = false; m.userData.l = 0; sc.add(m); BL.push(m); } })();
  function splat(x, z, r) { const g = ground(x, z); if (g === -Infinity) return; const m = BL[bli++ % BL.length]; m.position.set(x, g + .035 + (bli % 5) * .004, z); m.scale.set(r * rnd(.8, 1.4), r * rnd(.8, 1.4), 1); m.rotation.z = Math.random() * 6.28; m.material.opacity = .9; m.userData.l = 24; m.visible = true; }
  function bloodAt(x, y, z, dmg, kx, kz, big) {
    { // never spray into the viewer's face: push the burst away from the camera if it is too close
      const cx = P.x, cz = P.z, dx = x - cx, dz = z - cz, dd = Math.hypot(dx, dz), MIN = 2.2;
      if (dd < MIN) { const ux = dd > .01 ? dx / dd : -Math.sin(P.yaw), uz = dd > .01 ? dz / dd : -Math.cos(P.yaw); x = cx + ux * MIN; z = cz + uz * MIN; if (y < P.y + 1.4) y = Math.max(y, P.y + .3); }
    }
    const n = Math.min(60, 18 + (dmg * .7 | 0)) + (big ? 46 : 0);
    puff(x, y, z, 0xc0101c, n, 7, .12, 1.15, 3.8, 0x4a0408); puff(x, y, z, 0x7a0810, n * .6 | 0, 5, .09, 1.3, 3, 0x300205);
    puff(x, y, z, 0xe01826, (n * .4 | 0), 11, .07, .9, 5.5, 0x600309); // fast spray
    if (big) puff(x, y, z, 0xd01a28, 30, 12, .16, 1.2, 7, 0x500308);
    for (let i = 0; i < (big ? 16 : 6); i++) splat(x + rnd(-1.6, 1.6) + kx * rnd(0, 2.2), z + rnd(-1.6, 1.6) + kz * rnd(0, 2.2), rnd(.22, .55) * (big ? 1.7 : 1));
  }
  FT.blood = bloodAt;
  FT.bloodBot = function (b, dmg, by, head) { const src = by || P, dx = b.x - src.x, dz = b.z - src.z, d = Math.hypot(dx, dz) || 1; bloodAt(b.x, b.y + (head ? 1.7 : 1.1), b.z, dmg, dx / d, dz / d, false); };
  FT.bloodMe = function () { }; // gore is for opponents only, never the viewer
  function bloodUpdate(dt) { for (const m of BL) if (m.visible) { m.userData.l -= dt; m.material.opacity = Math.min(.9, m.userData.l / 6 * .9); if (m.userData.l <= 0) m.visible = false; } }

  /* ============================ TAIL (scorpion strike) ============================ */
  WP[4] = { n: 'TAIL', melee: 1, tail: 1, rate: .62, dmg: 0, range: 3.5 };
  (function () {
    const g = new T.Group(), pv = new T.Group(); g.add(pv); const skin = MS(0xe0409a, .5), tipm = MS(0x7a1020, .4, .2);
    for (let i = 0; i < 11; i++) { const m = new T.Mesh(new T.SphereGeometry(.05 * (1 - i * .055) + .008, 14, 10), skin); m.position.set(0, -.04 + .0017 * i * i, -.02 - i * .068); m.scale.z = 1.25; pv.add(m); }
    const tip = new T.Mesh(new T.ConeGeometry(.02, .12, 10), tipm); tip.rotation.x = -Math.PI / 2 - .35; tip.position.set(0, -.04 + .0017 * 121 + .02, -.02 - 10 * .068 - .09); pv.add(tip);
    g.visible = false; vmRoot.add(g); VM[4] = { g, pv, hip: [.28, -.3, -.3], ads: [.28, -.3, -.3], rot: [0, 0, 0], muz: null, kick: 0, pos: V(.28, -.3, -.3) };
  })();
  const BALL = .85;
  FT.tailStrike = function () {
    const f = dirVec(P.yaw, 0); let hit = null, bd = WP[4].range;
    for (const b of BOTS) { if (b.dead || b.balloon) continue; const dx = b.x - P.x, dz = b.z - P.z, d = Math.hypot(dx, dz); if (d > bd) continue; const ang = Math.acos(clamp((dx * f.x + dz * f.z) / (d || 1), -1, 1)); if (ang < .6 && Math.abs(b.y - P.y) < 2.2) { bd = d; hit = b; } }
    if (!hit) { const o = V(); cam.getWorldPosition(o); const dv = dirVec(P.yaw, P.pitch), r = worldRay(o.x, o.y, o.z, dv.x, dv.y, dv.z, 3.2); if (r < 3.1) { snd('batHit', undefined, undefined, undefined, { mat: 'rock' }); puff(o.x + dv.x * r, o.y + dv.y * r, o.z + dv.z * r, 0xb06d3c, 5, 3, .07, .5); shake = .25; } return; }
    hit.balloon = { t: 0, by: P, pf: 0 }; hit.flinch = 1; hit.hitT = .7; snd('tailHit', hit.x, hit.y, hit.z); snd('inflate', hit.x, hit.y + 1.4, hit.z, { force: true }); voice('hurt', hit, { pitch: 1.6 });
    bloodAt(hit.x, hit.y + 1.7, hit.z, 40, 0, 0, false); hitMarker(true); shake = .55; P.punch = .35; bubble(hit.x, hit.y + 3.4, hit.z, '😳', .9);
  };
  FT.frozen = function (b) { if (!b.balloon) return false; b.vx = b.vz = 0; return true; };
  function balloonUpdate(dt) {
    for (const b of BOTS) {
      const bl = b.balloon; if (!bl) continue;
      if (b.dead) { b.balloon = null; b.m.head.scale.set(1, 1, 1); continue; }
      bl.t += dt; const k = Math.min(1, bl.t / BALL), sc_ = 1 + 2.8 * Math.pow(k, 1.4) + Math.sin(S.t * (22 + k * 30)) * .08 * k;
      b.m.head.scale.set(sc_, sc_ * (1 + .1 * Math.sin(S.t * 30)), sc_); b.m.head.position.y = 1.6 + .55 * k * (sc_ - 1) * .25; b.flinch = .6;
      bl.pf -= dt; if (bl.pf <= 0) { bl.pf = .12; puff(b.x, b.y + 1.7, b.z, 0xb0101a, 3, 2.5, .06, .5, 1.5); }
      if (k >= 1) {
        b.balloon = null; b.m.head.scale.set(1, 1, 1); const hx = b.x, hy = b.y + 2.2, hz = b.z;
        bloodAt(hx, hy, hz, 90, 0, 0, true); puff(hx, hy, hz, 0xffa0b4, 22, 9, .14, .9, 6); puff(hx, hy, hz, 0xffe0e6, 8, 6, .09, .7, 4); snd('goatPop', hx, hy, hz); shake = Math.min(1.3, shake + .5);
        damageBot(b, 999, bl.by, 'TAIL', true);
      }
    }
  }
  FT.dropAt = (type, x, z, id) => { if (DT[type]) spawnDrop(type, [x, z], id ? String(id).slice(0, 12) : null); };
  FT.dropTake = id => { for (const d of DROPS) if (d.id && d.id === id && !d.taken) { d.taken = true; snd('pickup', d.x, d.y, d.z); } };
  FT.dbg = { JET, DROPS, GOATS, GR, RG, spawnDrop };
  FT.update = function (dt) {
    rgUpdate(dt);
    { const gb = $('gch'); if (gb) { if (P.gch !== undefined && P.gch !== null && P.alive && !P.ride) { const pw = clamp((S.t - P.gch) / GFULL, 0, 1); gb.style.display = 'block'; gb.firstElementChild.style.width = (pw * 100) + '%'; } else if (gb.style.display !== 'none') gb.style.display = 'none'; } }
    updateGren(dt); bloodUpdate(dt); balloonUpdate(dt); goatsUpdate(dt); dropsUpdate(dt); ropeVisual(dt); jetVisual(dt); hitUpdate(dt); FT.hud();
    if (P.rope && !P.alive) releaseRope(false);
  };
  FT.onRespawn();
})();
