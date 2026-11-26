'use strict';
/* ============================================================
   WORM ISLAND AUDIO ENGINE (all synthesised, no samples)

   Design notes (from standard FPS audio practice):
   - Bus tree:  sfx / vox / amb / mus  ->  master -> health low-pass -> compressor -> soft clip
   - Weapons are built from layers: transient (crack), punch (band noise), body (pitched thump),
     sub (player only), mechanics (bolt/handling) and tail (sent to reverb + slapback echo).
     Layers are offset by a few ms so their peaks do not stack.
   - Non-player fire uses two layers (near + distant) and no sub; distance is conveyed by gain,
     air-absorption low-pass, propagation delay and a wetter reverb send.
   - Every playback is randomised in pitch/level; footsteps change with the surface.
   - Mix states: low-pass + heartbeat as health drops, music/ambience ducking under announcer.
   - Voice limiting by priority so a three-bot firefight stays readable.
   - Ambience: waves, wind, foam and random gull one-shots (never loops audibly).
   - Adaptive music: pad + arp always, drums/bass added as combat intensity rises.
   ============================================================ */
function makeAudio(ctx, cfg) {
  cfg = cfg || {};
  const SR = ctx.sampleRate, A = {}, now = () => ctx.currentTime;
  const rnd = (a, b) => b === undefined ? Math.random() * a : a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), lerp = (a, b, t) => a + (b - a) * t;
  const rv = (s) => 1 + rnd(-(s === undefined ? .05 : s), (s === undefined ? .05 : s));
  const G = (v) => { const g = ctx.createGain(); g.gain.value = v === undefined ? 1 : v; return g; };
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

  /* ---------- noise sources ---------- */
  function noiseBuf(kind, secs) {
    const n = (SR * secs) | 0, b = ctx.createBuffer(1, n, SR), d = b.getChannelData(0); let mx = 1e-6;
    if (kind === 'white') for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    else if (kind === 'pink') { let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0; for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; b0 = .99886 * b0 + w * .0555179; b1 = .99332 * b1 + w * .0750759; b2 = .969 * b2 + w * .153852; b3 = .8665 * b3 + w * .3104856; b4 = .55 * b4 + w * .5329522; b5 = -.7616 * b5 - w * .016898; d[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * .5362; b6 = w * .115926; } }
    else { let l = 0; for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; l = (l + .02 * w) / 1.02; d[i] = l; } }
    for (let i = 0; i < n; i++) mx = Math.max(mx, Math.abs(d[i])); const k = .9 / mx; for (let i = 0; i < n; i++) d[i] *= k;
    return b;
  }
  const NB = { white: noiseBuf('white', 2), pink: noiseBuf('pink', 4), brown: noiseBuf('brown', 4) };

  /* ---------- impulse response: open island, ~1.4 s tail, darker as it decays ---------- */
  function makeIR(secs, decay) {
    const n = (SR * secs) | 0, b = ctx.createBuffer(2, n, SR);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch); let lp = 0;
      for (let i = 0; i < n; i++) { const t = i / SR, env = Math.exp(-t * decay) * Math.min(1, t / .008), k = clamp(.55 * Math.exp(-t * 1.6) + .05, .03, 1); lp += ((Math.random() * 2 - 1) - lp) * k; d[i] = lp * env; }
      [[.017, .6], [.029, -.5], [.043, .4], [.061, -.3]].forEach(([tt, g]) => { const j = ((tt + ch * .004) * SR) | 0; if (j < n) d[j] += g; });
    }
    return b;
  }

  /* ---------- buses and master chain ---------- */
  const master = G(.92), mlp = ctx.createBiquadFilter(); mlp.type = 'lowpass'; mlp.frequency.value = 20000; mlp.Q.value = .5;
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.knee.value = 14; comp.ratio.value = 5; comp.attack.value = .004; comp.release.value = .16;
  const sat = ctx.createWaveShaper(); { const c = new Float32Array(2048), k = 1.25; for (let i = 0; i < 2048; i++) { const x = i / 1023.5 - 1; c[i] = Math.tanh(x * k) / Math.tanh(k); } sat.curve = c; sat.oversample = '2x'; }
  const trim = G(.9);
  const rlp = ctx.createBiquadFilter(); rlp.type = 'lowpass'; rlp.frequency.value = 20000; rlp.Q.value = .4;
  master.connect(mlp); mlp.connect(comp); comp.connect(sat); sat.connect(trim); trim.connect(rlp); rlp.connect(cfg.dest || ctx.destination);
  const BUS = { sfx: G(1), vox: G(.95), amb: G(.55), mus: G(.3) };
  const VOL = { master: .92, sfx: 1, vox: .95, amb: .55, mus: .3 };
  Object.values(BUS).forEach(b => b.connect(master));
  const revIn = G(1), revHP = ctx.createBiquadFilter(); revHP.type = 'highpass'; revHP.frequency.value = 240;
  const conv = ctx.createConvolver(); conv.buffer = makeIR(1.6, 4.6); const revOut = G(.75);
  revIn.connect(revHP); revHP.connect(conv); conv.connect(revOut); revOut.connect(master);
  const echoIn = G(1), dly = ctx.createDelay(1); dly.delayTime.value = .29; const elp = ctx.createBiquadFilter(); elp.type = 'lowpass'; elp.frequency.value = 2400;
  const efb = G(.3), eout = G(.45); echoIn.connect(dly); dly.connect(elp); elp.connect(efb); efb.connect(dly); elp.connect(eout); eout.connect(master);
  A.ctx = ctx; A.master = master; A.bus = BUS;

  /* ---------- listener + routing ---------- */
  const lst = { x: 0, y: 0, z: 0, fx: 0, fz: -1 };
  A.setListener = (px, py, pz, fx, fy, fz, ux, uy, uz) => {
    lst.x = px; lst.y = py; lst.z = pz; lst.fx = fx; lst.fz = fz; const L = ctx.listener;
    if (L.positionX) { L.positionX.value = px; L.positionY.value = py; L.positionZ.value = pz; L.forwardX.value = fx; L.forwardY.value = fy; L.forwardZ.value = fz; L.upX.value = ux; L.upY.value = uy; L.upZ.value = uz; }
    else if (L.setPosition) { L.setPosition(px, py, pz); L.setOrientation(fx, fy, fz, ux, uy, uz); }
  };
  let pannerCount = 0;
  function route(busName, pos, o) {
    const bus = BUS[busName], inp = G(1), rev = o.rev === undefined ? .12 : o.rev, rs = G(rev), es = G(o.echo || 0);
    rs.connect(revIn); es.connect(echoIn);
    if (!pos) {
      let tail = bus; if (ctx.createStereoPanner) { const pn = ctx.createStereoPanner(); pn.pan.value = o.pan || 0; pn.connect(bus); tail = pn; }
      inp.connect(tail); inp.connect(rs); inp.connect(es);
      return { inp, t0: now(), d: 0 };
    }
    const dx = pos.x - lst.x, dy = pos.y - lst.y, dz = pos.z - lst.z, d = Math.hypot(dx, dy, dz);
    if (d > 115 && !o.force) return null;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; let fc = Math.max(1100, 17000 / (1 + d * .09)); if (o.occl) fc *= .35; lp.frequency.value = fc;
    const dg = G(Math.max(.015, 1 / (1 + .16 * Math.pow(d, 1.1))) * (o.occl ? .65 : 1) * (o.vol || 1));
    inp.connect(lp); lp.connect(dg); rs.gain.value = clamp(rev * (1 + d * .05), 0, .7); dg.connect(rs); dg.connect(es);
    if (pannerCount < 12 && ctx.createPanner) {
      const p = ctx.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'linear'; p.rolloffFactor = 0; p.refDistance = 1; p.maxDistance = 1000;
      if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; } else p.setPosition(pos.x, pos.y, pos.z);
      dg.connect(p); p.connect(bus); pannerCount++; setTimeout(() => { pannerCount = Math.max(0, pannerCount - 1); }, (o.life || 2.5) * 1000 + 300);
    } else {
      const hd = Math.hypot(dx, dz) || 1, pan = clamp((dx * (-lst.fz) + dz * lst.fx) / hd, -1, 1);
      if (ctx.createStereoPanner) { const pn = ctx.createStereoPanner(); pn.pan.value = pan; dg.connect(pn); pn.connect(bus); } else dg.connect(bus);
    }
    return { inp, t0: now() + (o.noDelay ? 0 : Math.min(.28, d / 343)), d };
  }

  /* ---------- synthesis primitives ---------- */
  function nb(out, t, dur, o) { // shaped noise burst
    const s = ctx.createBufferSource(); s.buffer = NB[o.c || 'white']; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = o.type || 'lowpass'; f.Q.value = o.q || .7; f.frequency.setValueAtTime(o.f1, t); f.frequency.exponentialRampToValueAtTime(Math.max(30, o.f2 || o.f1), t + dur);
    const g = G(0), a = o.a === undefined ? .001 : o.a; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(o.g, t + a); g.gain.exponentialRampToValueAtTime(.0004, t + Math.max(a + .002, dur));
    s.connect(f); f.connect(g); g.connect(out); s.start(t, Math.random() * 1.5); s.stop(t + dur + .05);
  }
  function os(out, t, f0, f1, dur, o) { // pitched oscillator with exponential pitch + amp curves
    const s = ctx.createOscillator(); s.type = o.type || 'sine'; s.frequency.setValueAtTime(f0, t); s.frequency.exponentialRampToValueAtTime(Math.max(18, f1), t + dur);
    const g = G(0), a = o.a === undefined ? .001 : o.a; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(o.g, t + a); g.gain.exponentialRampToValueAtTime(.0004, t + Math.max(a + .002, dur));
    let tail = g; if (o.lp) { const l = ctx.createBiquadFilter(); l.type = 'lowpass'; l.frequency.value = o.lp; s.connect(l); l.connect(g); } else s.connect(g);
    g.connect(out); s.start(t); s.stop(t + dur + .05);
  }
  const VW = { a: [800, 1150, 2900], e: [480, 1900, 2650], i: [300, 2250, 3010], o: [500, 900, 2800], u: [350, 700, 2600] };
  function formant(out, t, o) { // glottal saw -> 3 vowel formants, cartoon worm voices
    const dur = o.dur, src = ctx.createOscillator(); src.type = 'sawtooth'; src.frequency.setValueAtTime(o.f0, t); src.frequency.exponentialRampToValueAtTime(Math.max(50, o.f1), t + dur);
    const lfo = ctx.createOscillator(); lfo.frequency.value = o.vib || 5.5; const ld = G(o.f0 * (o.vd === undefined ? .025 : o.vd)); lfo.connect(ld); ld.connect(src.frequency);
    const sum = G(0), g = o.g, att = o.att || .015; sum.gain.setValueAtTime(0, t); sum.gain.linearRampToValueAtTime(g, t + att); sum.gain.setValueAtTime(g, t + Math.max(att, dur * .55)); sum.gain.exponentialRampToValueAtTime(.0005, t + dur);
    const Q = [6, 9, 12], FG = [1.5, .8, .4], v = o.v, sq = o.sq || 1.12;
    for (let k = 0; k < 3; k++) {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = Q[k]; bp.frequency.setValueAtTime(VW[v[0]][k] * sq, t);
      for (let i = 1; i < v.length; i++) bp.frequency.linearRampToValueAtTime(VW[v[i]][k] * sq, t + dur * i / (v.length - 1));
      const fg = G(FG[k]); src.connect(bp); bp.connect(fg); fg.connect(sum);
    }
    const br = o.breath === undefined ? .15 : o.breath;
    if (br) { const s = ctx.createBufferSource(); s.buffer = NB.pink; s.loop = true; const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = .8; const bg = G(br); s.connect(bp); bp.connect(bg); bg.connect(sum); s.start(t, Math.random()); s.stop(t + dur + .05); }
    sum.connect(out); src.start(t); lfo.start(t); src.stop(t + dur + .05); lfo.stop(t + dur + .05);
  }

  /* ---------- the sound table ---------- */
  const S = {};
  const def = (name, d) => { S[name] = d; };
  // --- weapons
  def('uzi', { pri: 2, rev: .22, echo: .1, life: 1.2, fn: (out, t, c) => {
    const r = c.r, far = c.pos;
    nb(out, t, .018, { type: 'highpass', f1: 3500 * r, f2: 2500, g: .5, a: .0005 });
    nb(out, t + .002, .05, { type: 'bandpass', f1: 2000 * r, f2: 650, q: .9, g: .7 });
    os(out, t + .003, 210 * r, 75, .075, { g: .8 }); os(out, t + .004, 360 * r, 130, .05, { type: 'triangle', g: .3 });
    nb(out, t + .012, .3, { c: 'pink', type: 'lowpass', f1: 1400 * r, f2: 200, g: .28 });
    if (!far) { nb(out, t + .014, .012, { type: 'bandpass', f1: 3800, f2: 3000, q: 3, g: .2 }); os(out, t + .02, 2300, 1800, .012, { type: 'square', g: .05 }); os(out, t, 80, 38, .12, { g: .5 }); }
  } });
  def('shotgun', { pri: 3, rev: .5, echo: .28, life: 2.5, fn: (out, t, c) => {
    const r = c.r, far = c.pos;
    nb(out, t, .014, { type: 'highpass', f1: 5000 * r, f2: 3000, g: .65, a: .0004 });
    nb(out, t + .001, .36, { type: 'lowpass', f1: 4200 * r, f2: 260, g: .95 });
    nb(out, t + .003, .13, { type: 'bandpass', f1: 900, f2: 250, q: 1, g: .6 });
    os(out, t + .002, 125 * r, 30, .55, { g: .95 }); os(out, t + .002, 78 * r, 34, .3, { type: 'sawtooth', g: .18, lp: 220 });
    nb(out, t + .02, 1.1, { c: 'brown', type: 'lowpass', f1: 900, f2: 90, g: .45 });
    if (!far) os(out, t, 55, 28, .35, { g: .6 });
  } });
  def('pump', { pri: 1, rev: .2, life: .8, fn: (out, t, c) => {
    nb(out, t, .05, { type: 'bandpass', f1: 1400, f2: 900, q: 1.2, g: .3 }); os(out, t, 170, 95, .06, { type: 'triangle', g: .38 }); os(out, t, 2450, 2400, .09, { g: .05 }); os(out, t, 3150, 3100, .07, { g: .035 });
    const u = t + .17; nb(out, u, .06, { type: 'bandpass', f1: 1700, f2: 800, q: 1.2, g: .42 }); os(out, u, 210, 110, .07, { type: 'triangle', g: .48 }); os(out, u, 2700, 2650, .1, { g: .06 }); os(out, u, 3400, 3300, .08, { g: .04 });
  } });
  const chuck = (out, t, g) => { nb(out, t, .045, { type: 'bandpass', f1: 1700, f2: 700, q: 1.2, g: .42 * g }); os(out, t, 215, 100, .07, { type: 'triangle', g: .52 * g }); os(out, t, 2800, 2700, .07, { g: .05 * g }); nb(out, t, .012, { type: 'highpass', f1: 4500, f2: 3500, g: .2 * g }); };
  def('reload', { pri: 1, rev: .1, life: .9, fn: (out, t) => { chuck(out, t + .03, .85); chuck(out, t + .27, 1.05); } });   // fast: chuck-chuck
  def('shell', { lv: 1.4, pri: 1, rev: .08, life: .5, fn: (out, t) => { chuck(out, t, .8); } });
  def('empty', { lv: 2.2, pri: 1, rev: .05, life: .4, fn: (out, t) => { os(out, t, 1600, 1300, .015, { type: 'square', g: .08 }); nb(out, t, .012, { type: 'bandpass', f1: 4000, f2: 3600, q: 2, g: .1 }); } });
  def('draw', { lv: 1.8, pri: 1, rev: .06, life: .5, fn: (out, t) => { nb(out, t, .06, { type: 'bandpass', f1: 1200, f2: 2400, q: 1.5, g: .14 }); os(out, t, 200, 130, .05, { type: 'triangle', g: .2 }); os(out, t + .07, 1400, 1300, .012, { type: 'square', g: .06 }); nb(out, t, .12, { c: 'pink', type: 'bandpass', f1: 600, f2: 400, q: .8, g: .06, a: .03 }); } });
  def('casing', { lv: 1.8, pri: 0, rev: .1, life: .6, fn: (out, t, c) => {
    const r = c.r; os(out, t, 4300 * r, 3300, .05, { g: .05 }); os(out, t + .05, 6100 * r, 5200, .03, { g: .025 }); nb(out, t, .01, { type: 'highpass', f1: 6000, f2: 5000, g: .03 });
    os(out, t + .13, 3900 * r, 3000, .04, { g: .02 });
  } });
  def('batSwing', { pri: 2, rev: .1, life: .6, fn: (out, t, c) => {
    nb(out, t, .26, { c: 'pink', type: 'bandpass', f1: 380, f2: 1700, q: 1.3, g: .5, a: .09 }); nb(out, t + .1, .16, { c: 'pink', type: 'bandpass', f1: 1700, f2: 500, q: 1.3, g: .3, a: .02 }); os(out, t, 150, 90, .22, { g: .1, a: .08 });
  } });
  def('batHit', { pri: 3, rev: .22, echo: .06, life: 1.2, fn: (out, t, c) => {
    const r = c.r, worm = (c.o.mat || 'worm') === 'worm';
    if (worm) {
      os(out, t, 420 * r, 210, .03, { type: 'square', g: .35 }); nb(out, t, .02, { type: 'highpass', f1: 3200, f2: 2500, g: .5 }); os(out, t, 95 * r, 38, .2, { g: 1 });
      os(out, t, 690 * r, 670, .24, { g: .1 }); os(out, t, 1320 * r, 1290, .16, { g: .04 }); nb(out, t + .01, .15, { c: 'pink', type: 'bandpass', f1: 520, f2: 300, q: 2.5, g: .35 }); os(out, t + .05, 220, 520, .12, { g: .1, a: .02 });
    } else { os(out, t, 80 * r, 40, .15, { g: .65 }); nb(out, t, .09, { type: 'lowpass', f1: 1200, f2: 300, g: .4 }); os(out, t, 300 * r, 200, .025, { type: 'square', g: .2 }); }
  } });
  // --- feedback
  def('hit', { lv: 2.2, pri: 3, rev: .02, life: .3, fn: (out, t, c) => { const p = c.o.p || 1; os(out, t, 2300 * p, 2000 * p, .055, { g: .32 }); os(out, t + .02, 3100 * p, 2900 * p, .06, { g: .18 }); } });
  def('headshot', { pri: 3, rev: .12, life: .8, fn: (out, t) => { [[1700, .32, .38], [2650, .22, .3], [3900, .12, .24], [5200, .06, .2]].forEach(([f, g, d]) => os(out, t, f, f * .995, d, { g })); os(out, t, 130, 60, .1, { g: .28 }); } });
  def('killconfirm', { pri: 3, rev: .06, life: .4, fn: (out, t) => { os(out, t, 880, 870, .11, { g: .16 }); os(out, t + .07, 1320, 1300, .13, { g: .14 }); os(out, t, 110, 55, .1, { g: .3 }); } });
  def('hurt', { pri: 3, rev: .1, life: 1.2, fn: (out, t, c) => {
    const big = (c.o.dmg || 10) > 24; os(out, t, 100, 50, .15, { g: .75 }); nb(out, t, .13, { c: 'pink', type: 'lowpass', f1: 900, f2: 200, g: .42 }); nb(out, t, .02, { type: 'highpass', f1: 2000, f2: 1500, g: .2 });
    os(out, t + .02, 4300, 4250, big ? 1.1 : .5, { g: big ? .035 : .015, a: .06 });
  } });
  def('die', { pri: 2, rev: .25, life: 1.2, fn: (out, t) => { os(out, t, 90, 35, .3, { g: .6 }); nb(out, t, .3, { c: 'brown', type: 'lowpass', f1: 600, f2: 120, g: .4 }); nb(out, t, .02, { type: 'highpass', f1: 1800, f2: 1200, g: .15 }); } });
  def('tailStab', { pri: 3, rev: .1, life: .5, fn: (out, t) => {
    nb(out, t, .1, { type: 'highpass', f1: 900, f2: 4800, g: .5, a: .012 }); os(out, t + .045, 900, 260, .1, { g: .28, type: 'triangle' }); nb(out, t + .07, .05, { type: 'bandpass', f1: 3200, f2: 1800, q: 2, g: .3 });
  } });
  def('tailHit', { pri: 4, rev: .2, echo: .05, life: 1, fn: (out, t) => {
    nb(out, t, .24, { type: 'lowpass', f1: 2000, f2: 180, g: .85 }); os(out, t, 170, 55, .22, { g: .6 });
    for (let i = 0; i < 4; i++) nb(out, t + .03 * i, .06, { c: 'pink', type: 'bandpass', f1: rnd(500, 1500), f2: rnd(250, 700), q: 5, g: .25 });
  } });
  def('inflate', { pri: 4, rev: .2, life: 1.2, fn: (out, t) => {
    os(out, t, 240, 1500, .85, { g: .22, type: 'sawtooth', lp: 1900, a: .04 }); os(out, t, 360, 2200, .85, { g: .1, type: 'triangle', a: .04 });
    nb(out, t, .85, { c: 'pink', type: 'bandpass', f1: 500, f2: 3200, q: 1.5, g: .3, a: .05 });
  } });
  def('gib', { pri: 3, rev: .35, echo: .08, life: 1.2, fn: (out, t) => {
    nb(out, t, .4, { type: 'lowpass', f1: 2200, f2: 160, g: .85 }); os(out, t, 130, 38, .3, { g: .7 });
    for (let i = 0; i < 6; i++) nb(out, t + .04 * i + rnd(0, .02), .07, { c: 'pink', type: 'bandpass', f1: rnd(400, 1300), f2: rnd(250, 600), q: 4, g: .22 });
    nb(out, t, .06, { type: 'highpass', f1: 3000, f2: 2000, g: .2 });
  } });
  // --- movement
  def('jump', { lv: 2.4, pri: 1, rev: .06, life: .4, fn: (out, t) => { nb(out, t, .09, { c: 'pink', type: 'bandpass', f1: 1200, f2: 600, q: 1, g: .1 }); os(out, t, 150, 210, .07, { g: .06 }); } });
  def('land', { pri: 1, rev: .1, life: .5, fn: (out, t, c) => {
    const s = c.o.surf || 'grass';
    if (s === 'rock') { os(out, t, 110, 50, .09, { g: .6 }); nb(out, t, .025, { type: 'highpass', f1: 1200, f2: 900, g: .25 }); }
    else if (s === 'sand') { nb(out, t, .13, { c: 'pink', type: 'lowpass', f1: 900, f2: 250, g: .35 }); os(out, t, 70, 40, .1, { g: .4 }); }
    else { nb(out, t, .1, { c: 'pink', type: 'lowpass', f1: 700, f2: 200, g: .35 }); os(out, t, 75, 40, .11, { g: .5 }); nb(out, t, .12, { type: 'highpass', f1: 5000, f2: 4000, g: .03, a: .02 }); }
  } });
  def('step', { pri: 0, cd: .08, rev: .08, life: .4, fn: (out, t, c) => {
    const s = c.o.surf || 'grass', r = c.r;
    if (s === 'sand') { nb(out, t, .11, { c: 'pink', type: 'bandpass', f1: 2200 * r, f2: 1400, q: .5, g: .38, a: .014 }); os(out, t, 90, 60, .05, { g: .18 }); }
    else if (s === 'rock') { os(out, t, 130 * r, 65, .055, { g: .4 }); nb(out, t, .016, { type: 'highpass', f1: 1800, f2: 1400, g: .22 }); }
    else { nb(out, t, .075, { c: 'pink', type: 'bandpass', f1: 3000 * r, f2: 1800, q: .6, g: .18 }); os(out, t, 85 * r, 55, .055, { g: .26 }); nb(out, t + .02, .15, { type: 'highpass', f1: 5000, f2: 4500, g: .035, a: .03 }); }
  } });
  def('slither', { lv: 1.4, pri: 0, cd: .1, rev: .15, life: .5, fn: (out, t, c) => { nb(out, t, .17, { c: 'pink', type: 'bandpass', f1: 700 * c.r, f2: 350, q: 2, g: .24, a: .04 }); nb(out, t + .02, .1, { type: 'bandpass', f1: 1600, f2: 900, q: 2, g: .08 }); os(out, t, 90, 60, .12, { g: .12 }); } });
  def('dodge', { lv: 1.7, pri: 2, rev: .12, life: .5, fn: (out, t) => { nb(out, t, .24, { c: 'pink', type: 'bandpass', f1: 1800, f2: 400, q: .9, g: .38, a: .03 }); os(out, t, 220, 110, .16, { type: 'triangle', g: .08 }); nb(out, t, .05, { type: 'highpass', f1: 4000, f2: 3000, g: .05 }); } });
  def('splash', { pri: 2, rev: .3, life: 1.2, fn: (out, t) => { nb(out, t, .65, { type: 'lowpass', f1: 3200, f2: 250, g: .7, a: .004 }); os(out, t, 280, 60, .4, { g: .3 }); for (let i = 0; i < 4; i++) os(out, t + .1 + i * .06 + rnd(0, .03), rnd(300, 900), rnd(500, 1200), .05, { g: .09 }); } });
  def('impact', { lv: 1.6, pri: 0, cd: .035, rev: .1, life: .4, fn: (out, t, c) => {
    const m = c.o.mat || 'dirt';
    if (m === 'sea') nb(out, t, .16, { type: 'bandpass', f1: 1500, f2: 400, q: .8, g: .2 }); else { nb(out, t, .07, { type: 'lowpass', f1: 1800 * c.r, f2: 300, g: .3 }); os(out, t, 120 * c.r, 60, .05, { g: .3 }); }
  } });
  def('whiz', { lv: 2.6, pri: 2, cd: .07, rev: .05, noDelay: true, life: .3, fn: (out, t, c) => { nb(out, t, .09, { type: 'bandpass', f1: 5200 * c.r, f2: 2400, q: 2, g: .2, a: .01 }); os(out, t, 3200, 1400, .11, { g: .05, a: .01 }); } });
  def('pickup', { pri: 2, rev: .25, life: 1, fn: (out, t) => { [[660, 0], [880, .07], [1320, .14]].forEach(([f, d]) => { os(out, t + d, f, f, .28, { g: .17 }); os(out, t + d, f * 2, f * 2, .18, { g: .05 }); }); } });
  def('spawn', { pri: 2, rev: .35, life: 1, fn: (out, t) => { os(out, t, 300, 1500, .45, { g: .14, a: .1 }); os(out, t, 450, 2250, .45, { type: 'triangle', g: .05, a: .1 }); nb(out, t, .45, { type: 'bandpass', f1: 500, f2: 4000, q: 4, g: .05, a: .15 }); } });
  def('sting', { pri: 3, bus: 'sfx', rev: .45, life: 2, fn: (out, t, c) => {
    const k = [1, 1.19, 1.5][c.o.lvl || 0]; nb(out, t, .55, { type: 'lowpass', f1: 2500, f2: 200, g: .5 }); os(out, t, 110, 40, .65, { g: .7 }); os(out, t, 60, 38, .9, { g: .5 });
    os(out, t + .02, 880 * k, 870 * k, .7, { type: 'triangle', g: .07 }); os(out, t + .02, 1320 * k, 1310 * k, .7, { type: 'triangle', g: .05 }); nb(out, t, .6, { type: 'bandpass', f1: 400, f2: 5000, q: 1.2, g: .12, a: .3 });
  } });
  def('ui', { lv: 2, pri: 1, rev: .05, life: .3, fn: (out, t) => { os(out, t, 1000, 1500, .04, { g: .12 }); } });
  def('heartbeat', { pri: 3, rev: .05, life: .6, fn: (out, t) => { os(out, t, 62, 42, .13, { g: .75 }); os(out, t + .17, 58, 38, .11, { g: .5 }); } });
  def('gull', { pri: 0, bus: 'amb', rev: .4, echo: .15, life: 2, fn: (out, t, c) => {
    const n = 2 + (Math.random() * 2 | 0), f = rnd(1700, 2200);
    for (let i = 0; i < n; i++) { const u = t + i * rnd(.26, .34); const s = ctx.createOscillator(); s.type = 'sine'; s.frequency.setValueAtTime(f, u); s.frequency.exponentialRampToValueAtTime(f * 1.45, u + .08); s.frequency.exponentialRampToValueAtTime(f * .85, u + .22);
      const g = G(0); g.gain.setValueAtTime(0, u); g.gain.linearRampToValueAtTime(.1, u + .02); g.gain.exponentialRampToValueAtTime(.0005, u + .24); const h = ctx.createOscillator(); h.type = 'sine'; h.frequency.setValueAtTime(f * 2, u); h.frequency.exponentialRampToValueAtTime(f * 2.9, u + .08); h.frequency.exponentialRampToValueAtTime(f * 1.7, u + .22); const hg = G(.04); h.connect(hg); hg.connect(g);
      s.connect(g); g.connect(out); s.start(u); h.start(u); s.stop(u + .27); h.stop(u + .27); }
  } });

  // --- grenades / explosions
  def('explosion', { pri: 3, rev: .8, echo: .5, life: 4.5, fn: (out, t, c) => {
    const r = c.r;
    nb(out, t, .02, { type: 'highpass', f1: 2500, f2: 1800, g: .8, a: .0004 });
    nb(out, t, .9, { type: 'lowpass', f1: 5200 * r, f2: 140, g: 1, a: .002 });
    nb(out, t + .004, .35, { type: 'bandpass', f1: 1200, f2: 300, q: .8, g: .7 });
    os(out, t, 85 * r, 22, 1.1, { g: 1.1 }); os(out, t, 52, 20, 1.5, { g: .75 }); os(out, t + .01, 160, 45, .45, { type: 'triangle', g: .35 });
    nb(out, t + .05, 2.2, { c: 'brown', type: 'lowpass', f1: 700, f2: 50, g: .75, a: .06 });
    for (let i = 0; i < 14; i++) { const u = t + .22 + i * .08 + rnd(0, .12); nb(out, u, .05, { c: 'pink', type: 'bandpass', f1: rnd(500, 3200), f2: rnd(300, 900), q: 3, g: rnd(.06, .2) * (1 - i / 18) }); }
    nb(out, t + .5, 1.8, { c: 'pink', type: 'lowpass', f1: 1400, f2: 120, g: .22, a: .3 });
  } });
  def('grenBounce', { pri: 2, cd: .05, rev: .15, life: .6, fn: (out, t, c) => { const r = c.r; os(out, t, 1850 * r, 1500, .12, { g: .12 }); os(out, t, 3200 * r, 2900, .06, { g: .06 }); os(out, t, 110, 60, .06, { g: .35 }); nb(out, t, .012, { type: 'bandpass', f1: 3500, f2: 3000, q: 3, g: .2 }); } });
  def('hallelujah', { pri: 3, rev: .75, life: 3.4, fn: (out, t, c) => { // choir: Hal-le-lu-jah!
    for (const [f, v, off, dur] of [[392, 'a', 0, .5], [392, 'e', .5, .4], [440, 'u', .9, .4], [523, 'a', 1.3, 1.9]]) for (const [m, gg] of [[1, .1], [1.5, .07], [.5, .08], [1.26, .06]]) formant(out, t + off, { f0: f * m, f1: f * m * 1.004, dur, g: gg, v: [v], att: .07, vib: 5.2, vd: .012, breath: .04, sq: 1.05 });
    os(out, t + 1.3, 2093, 2093, 1.8, { g: .012, a: .3 }); os(out, t + 1.3, 1568, 1568, 1.8, { g: .012, a: .3 }); } });
  def('grenTick', { pri: 2, rev: .1, life: .3, fn: (out, t, c) => { os(out, t, c.o.hi ? 2600 : 1900, c.o.hi ? 2550 : 1880, .06, { g: .1 }); os(out, t, c.o.hi ? 5200 : 3800, c.o.hi ? 5100 : 3750, .03, { g: .03 }); } });
  def('throw', { pri: 2, rev: .12, life: .6, fn: (out, t) => { nb(out, t, .012, { type: 'bandpass', f1: 3000, f2: 2600, q: 3, g: .15 }); os(out, t + .01, 1200, 900, .02, { type: 'square', g: .05 }); nb(out, t + .08, .3, { c: 'pink', type: 'bandpass', f1: 500, f2: 1600, q: 1, g: .3, a: .1 }); } });
  def('thumpMe', { pri: 3, rev: .06, life: .5, fn: (out, t, c) => { const k = clamp((c.o.dmg || 10) / 30, .4, 1.4); os(out, t, 70, 32, .2, { g: .9 * k }); nb(out, t, .06, { type: 'lowpass', f1: 900, f2: 200, g: .5 * k }); nb(out, t, .015, { type: 'highpass', f1: 2500, f2: 1800, g: .22 * k }); } });
  // --- rope
  def('ropeShot', { pri: 2, rev: .12, life: .5, fn: (out, t) => { nb(out, t, .14, { type: 'bandpass', f1: 3500, f2: 900, q: 1.5, g: .25, a: .01 }); os(out, t, 2400, 600, .12, { type: 'sawtooth', g: .035, lp: 2000 }); os(out, t, 200, 120, .05, { g: .2 }); } });
  def('ropeHit', { pri: 2, rev: .2, life: .8, fn: (out, t) => { os(out, t, 140, 60, .1, { g: .6 }); nb(out, t, .03, { type: 'bandpass', f1: 2500, f2: 1500, q: 2, g: .35 }); os(out, t + .02, 900, 880, .35, { type: 'triangle', g: .05 }); } });
  def('ropeLet', { pri: 1, rev: .08, life: .4, fn: (out, t) => { nb(out, t, .12, { c: 'pink', type: 'bandpass', f1: 1400, f2: 500, q: 1.2, g: .22, a: .01 }); os(out, t, 400, 200, .06, { type: 'triangle', g: .1 }); } });
  def('ropeCreak', { pri: 0, cd: .25, rev: .05, life: .5, fn: (out, t, c) => { os(out, t, rnd(180, 260), rnd(120, 170), .16, { type: 'sawtooth', g: .03, lp: 600 }); } });
  // --- goat + crates + jetski
  def('bleat', { pri: 2, bus: 'vox', rev: .25, echo: .08, life: 1.2, fn: (out, t, c) => { const b = (c.o.pitch || 1) * c.r; formant(out, t, { f0: 430 * b, f1: 350 * b, dur: .55, v: ['e', 'a', 'e'], vib: 13, vd: .09, g: .75, breath: .12, sq: 1.25 }); } });
  def('goatPop', { pri: 3, rev: .3, life: 1, fn: (out, t) => { os(out, t, 300, 90, .12, { g: .7 }); nb(out, t, .12, { c: 'pink', type: 'lowpass', f1: 3000, f2: 300, g: .5 }); os(out, t + .08, 900, 400, .18, { type: 'triangle', g: .12 }); } });
  def('chute', { pri: 1, rev: .3, life: 1, fn: (out, t) => { nb(out, t, .5, { c: 'pink', type: 'bandpass', f1: 400, f2: 900, q: .7, g: .22, a: .15 }); os(out, t, 100, 70, .3, { g: .05 }); } });
  def('crateLand', { pri: 2, rev: .35, life: 1, fn: (out, t) => { os(out, t, 90, 40, .22, { g: .8 }); nb(out, t, .15, { type: 'lowpass', f1: 1500, f2: 250, g: .45 }); os(out, t + .04, 1200, 900, .2, { type: 'triangle', g: .06 }); [660, 880, 1320].forEach((f, i) => os(out, t + .25 + i * .09, f, f, .25, { g: .1 })); } });
  def('jetBump', { pri: 2, cd: .3, rev: .15, life: .6, fn: (out, t) => { os(out, t, 100, 40, .15, { g: .7 }); nb(out, t, .1, { c: 'pink', type: 'lowpass', f1: 1500, f2: 300, g: .4 }); } });
  def('mount', { pri: 2, rev: .1, life: .5, fn: (out, t) => { os(out, t, 160, 90, .08, { g: .35 }); nb(out, t, .05, { type: 'bandpass', f1: 1500, f2: 800, q: 2, g: .15 }); os(out, t + .1, 70, 120, .25, { type: 'sawtooth', g: .08, lp: 400 }); } });
  // --- worm voices
  def('voice', { pri: 2, bus: 'vox', rev: .18, echo: .05, life: 1.5, fn: (out, t, c) => {
    const b = (c.o.base || 260) * c.r, k = c.o.kind || 'hurt', q = c.o.self ? .6 : 1, pick = a => a[(Math.random() * a.length) | 0];
    if (k === 'hurt') formant(out, t, { f0: b * 1.25, f1: b * .85, dur: .22, v: pick([['o', 'a'], ['e', 'a'], ['a', 'o']]), g: .7 * q });
    else if (k === 'die') formant(out, t, { f0: b * 1.6, f1: b * .5, dur: .85, v: ['a', 'o', 'u'], vib: 7, vd: .05, g: .8 * q, breath: .2 });
    else if (k === 'fall') formant(out, t, { f0: b * 1.5, f1: b * .4, dur: .95, v: ['a', 'o'], vib: 9, vd: .06, g: .75 * q });
    else if (k === 'spawn') formant(out, t, { f0: b * .9, f1: b * 1.3, dur: .3, v: ['u', 'o'], g: .45 * q, att: .05 });
    else if (k === 'taunt') { formant(out, t, { f0: b * 1.1, f1: b * 1.0, dur: .1, v: ['a'], g: .55 * q, breath: .1 }); formant(out, t + .14, { f0: b * .95, f1: b * .8, dur: .14, v: ['a', 'o'], g: .55 * q }); }
    else if (k === 'laugh') for (let i = 0; i < 5; i++) formant(out, t + i * .13, { f0: b * 1.3 * (1 - i * .03), f1: b * 1.15 * (1 - i * .03), dur: .09, v: [i % 2 ? 'e' : 'a'], g: .5 * q, breath: .2 });
    else if (k === 'jump') formant(out, t, { f0: b * .9, f1: b * 1.05, dur: .09, v: ['u', 'a'], g: .3 * q, breath: .1 });
    else if (k === 'oof') formant(out, t, { f0: b * .8, f1: b * .6, dur: .13, v: ['o'], g: .6 * q });
  } });

  /* ---------- playback ---------- */
  const active = [], lastT = {}; const MAXV = 44;
  function allow(pri, life) { const t = now(); while (active.length && active[0] < t) active.shift(); if (active.length >= MAXV && pri < 2) return false; active.push(t + (life || 1)); active.sort((a, b) => a - b); return true; }
  A.names = Object.keys(S);
  A.play = (name, pos, o) => {
    o = o || {}; const d = S[name]; if (!d) return false; const t = now();
    if (d.cd && !o.force) { if (t - (lastT[name] || -9) < d.cd) return false; lastT[name] = t; }
    if (!allow(d.pri === undefined ? 1 : d.pri, d.life)) return false;
    const r = route(d.bus || 'sfx', pos, { rev: d.rev, echo: d.echo, vol: o.vol, occl: o.occl, noDelay: d.noDelay, life: d.life, pan: o.pan, force: o.force });
    if (!r) return false; if (d.lv) r.inp.gain.value = d.lv; d.fn(r.inp, r.t0, { pos: !!pos, d: r.d, o, r: rv(.05) }); return true;
  };

  /* ---------- volume + mix states ---------- */
  A.setVol = (name, v) => { VOL[name] = v; if (name === 'master') master.gain.setTargetAtTime(v, now(), .03); else BUS[name].gain.setTargetAtTime(v, now(), .03); };
  A.getVol = name => VOL[name];
  A.duck = (level, hold) => {
    const t = now(); [['mus', level], ['amb', Math.min(1, level + .3)]].forEach(([n, l]) => { const g = BUS[n].gain; g.cancelScheduledValues(t); g.setTargetAtTime(VOL[n] * l, t, .03); g.setTargetAtTime(VOL[n], t + (hold || 1.2), .45); });
  };
  const HB = { h: 1, alive: true, next: 0 };
  A.setHealth = (h01, alive) => { h01 = clamp(+h01 || 0, 0, 1); HB.h = h01; HB.alive = alive; const f = (!alive || h01 >= .35) ? 20000 : lerp(1800, 20000, Math.pow(h01 / .35, 1.5)); mlp.frequency.setTargetAtTime(f, now(), .15); };

  /* ---------- ambience ---------- */
  const amb = { started: false, nextBird: 0 };
  A.startAmbience = () => {
    if (amb.started) return; amb.started = true;
    const mk = (buf, type, f, q, g, pan) => {
      const s = ctx.createBufferSource(); s.buffer = NB[buf]; s.loop = true; s.start(0, Math.random() * 2); const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const gn = G(g);
      s.connect(fl); fl.connect(gn); if (ctx.createStereoPanner) { const pn = ctx.createStereoPanner(); pn.pan.value = pan || 0; gn.connect(pn); pn.connect(BUS.amb); } else gn.connect(BUS.amb); return gn;
    };
    const lfo = (param, rate, depth) => { const o = ctx.createOscillator(); o.frequency.value = rate; const d = G(depth); o.connect(d); d.connect(param); o.start(); };
    const wl = mk('pink', 'lowpass', 650, .6, .24, -.5), wr = mk('pink', 'lowpass', 600, .6, .24, .5); lfo(wl.gain, .11, .17); lfo(wr.gain, .15, .17);
    const foam = mk('white', 'highpass', 3200, .5, .04, 0); lfo(foam.gain, .11, .03);
    const wind = mk('brown', 'bandpass', 380, .5, .17, 0); lfo(wind.gain, .05, .08); lfo(wind.gain, .21, .04);
    const whis = mk('pink', 'bandpass', 1500, 10, .014, .2); lfo(whis.gain, .07, .012);
    amb.nextBird = now() + rnd(4, 9);
  };

  /* ---------- adaptive music ---------- */
  const M = { on: true, inten: .12, target: .12, step: 0, next: 0, bpm: 116 };
  const padBus = G(1), musMix = G(1); padBus.connect(musMix); musMix.connect(BUS.mus);
  const CH = [{ root: 33, tones: [57, 60, 64, 67] }, { root: 29, tones: [53, 57, 60, 64] }, { root: 36, tones: [55, 60, 64, 67] }, { root: 31, tones: [55, 59, 62, 67] }]; // Am F C G
  const ARP = [0, 2, 1, 3, 2, 1, 3, 2];
  function mstep(idx, t, I) {
    const bar = Math.floor(idx / 16), s = idx % 16, ch = CH[bar % 4], sd = 60 / M.bpm / 4, out = musMix;
    if (s === 0) { // pad
      ch.tones.slice(0, 3).forEach(n => [-6, 0, 6].forEach(dt => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(n - 12); o.detune.value = dt * 2; const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500 + I * 900; const g = G(0); const L = sd * 16; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.022, t + .6); g.gain.setValueAtTime(.022, t + L - .5); g.gain.linearRampToValueAtTime(0, t + L + .6); o.connect(f); f.connect(g); g.connect(padBus); o.start(t); o.stop(t + L + .7); }));
    }
    if (s % 2 === 0) { // arp pluck
      const n = ch.tones[ARP[(s / 2) % 8] % 4] + 12, o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = mtof(n); const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(3000, t); f.frequency.exponentialRampToValueAtTime(500, t + .2); const g = G(0), pk = .035 + I * .035;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(pk, t + .004); g.gain.exponentialRampToValueAtTime(.0005, t + .24); o.connect(f); f.connect(g); g.connect(out); const e = G(.5); g.connect(e); e.connect(echoIn); o.start(t); o.stop(t + .3);
    }
    if (I > .3 && s % 4 === 0) { // kick + sidechain on the pad
      os(out, t, 150, 42, .17, { g: .55 }); nb(out, t, .01, { type: 'highpass', f1: 3000, f2: 2000, g: .1 });
      padBus.gain.setValueAtTime(.45, t); padBus.gain.linearRampToValueAtTime(1, t + .2);
    }
    if (I > .5 && (s === 4 || s === 12)) { nb(out, t, .13, { type: 'bandpass', f1: 1800, f2: 1500, q: .7, g: .2 }); [0, .012, .024].forEach(d => nb(out, t + d, .02, { type: 'bandpass', f1: 1500, f2: 1400, q: 1, g: .12 })); }
    if (I > .15 && s % 2 === 1) nb(out, t, .03, { type: 'highpass', f1: 7000, f2: 6500, g: .06 });
    if (I > .5 && s === 14) nb(out, t, .12, { type: 'highpass', f1: 7000, f2: 5500, g: .05, a: .004 });
    if (I > .3 && [0, 3, 6, 8, 11, 14].includes(s)) { // bass
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(ch.root + (s === 6 || s === 14 ? 12 : 0)); const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(180, t + .18); const g = G(0); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.16, t + .005); g.gain.exponentialRampToValueAtTime(.0005, t + .2); o.connect(f); f.connect(g); g.connect(out); o.start(t); o.stop(t + .25);
    }
    if (I > .75 && (s === 0 || s === 10)) ch.tones.slice(1, 3).forEach(n => { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = mtof(n); const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2200; const g = G(0); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.035, t + .005); g.gain.exponentialRampToValueAtTime(.0005, t + .12); o.connect(f); f.connect(g); g.connect(out); o.start(t); o.stop(t + .15); });
  }
  A.startMusic = () => { M.next = now() + .1; M.step = 0; };
  A.musicOn = on => { M.on = on; };
  A.setIntensity = x => { M.target = clamp(x, .12, 1); };
  A.tick = () => { // call ~every 80 ms
    const t = now(), sd = 60 / M.bpm / 4;
    if (M.next === 0 || M.next < t - .25) M.next = t + .06;
    while (M.next < t + .3) { if (M.on) { M.inten += (M.target - M.inten) * .06; mstep(M.step, M.next, M.inten); } M.step++; M.next += sd; }
    if (HB.alive && HB.h < .3 && t >= HB.next) { A.play('heartbeat', null, { force: true }); HB.next = t + lerp(.5, 1.0, HB.h / .3); }
    if (amb.started && t >= amb.nextBird) { amb.nextBird = t + rnd(7, 16); const a = rnd(6.28); A.play('gull', { x: lst.x + Math.cos(a) * 55, y: lst.y + 22 + rnd(0, 12), z: lst.z + Math.sin(a) * 55 }, { force: true }); }
  };
  A.renderMusic = (bars, I) => { const sd = 60 / M.bpm / 4; for (let i = 0; i < bars * 16; i++) mstep(i, .05 + i * sd, I); };

  /* ---------- tinnitus after blasts + jetski engine ---------- */
  A.ring = (k) => { k = clamp(k, 0, 1); if (k < .08) return; const t = now(); rlp.frequency.cancelScheduledValues(t); rlp.frequency.setValueAtTime(lerp(20000, 500, k), t); rlp.frequency.setTargetAtTime(20000, t + .35 + k * 1.2, .5 + k * .6);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 7100; const g = G(0); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.05 * k, t + .05); g.gain.setTargetAtTime(0, t + .4, .7 + k); o.connect(g); g.connect(master); o.start(t); o.stop(t + 4); };
  const ENG = { on: false };
  A.engine = (v) => { // v: null = off, 0..1 speed
    if (v === null || v === undefined) { if (ENG.g) ENG.g.gain.setTargetAtTime(0, now(), .12); return; }
    if (!ENG.g) { ENG.g = G(0); const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 60; const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 30; const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500; f.Q.value = 3;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 23; const ld = G(10); lfo.connect(ld); ld.connect(o1.frequency); const g2 = G(.5); o2.connect(g2); o1.connect(f); g2.connect(f); f.connect(ENG.g);
      const ns = ctx.createBufferSource(); ns.buffer = NB.pink; ns.loop = true; const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 900; nf.Q.value = .7; const ng = G(.35); ns.connect(nf); nf.connect(ng); ng.connect(ENG.g); ENG.g.connect(BUS.sfx); [o1, o2, lfo, ns].forEach(x => x.start()); ENG.o1 = o1; ENG.o2 = o2; ENG.f = f; ENG.nf = nf; ENG.lfo = lfo; }
    const t = now(); ENG.o1.frequency.setTargetAtTime(58 + v * 120, t, .08); ENG.o2.frequency.setTargetAtTime(29 + v * 60, t, .08); ENG.f.frequency.setTargetAtTime(380 + v * 1700, t, .1); ENG.nf.frequency.setTargetAtTime(700 + v * 2400, t, .1); ENG.lfo.frequency.setTargetAtTime(18 + v * 40, t, .1); ENG.g.gain.setTargetAtTime(.09 + v * .16, t, .08);
  };
  A.music = M; A.sounds = S;
  return A;
}
