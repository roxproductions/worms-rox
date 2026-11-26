'use strict';
/* ============================================================
   WORM ISLAND — first-person worm deathmatch (working title)
   Structure: world · audio · fx · weapons/viewmodels · player · bots · match · hud · loop
   The simulation (P, BOTS, S) is kept apart from rendering so networking can be added later.
   ============================================================ */
const T = THREE;
const Q = new URLSearchParams(location.search);
const TOUCH = (() => { try { return matchMedia('(pointer:coarse)').matches || Q.has('touch'); } catch (e) { return Q.has('touch'); } })();
const DEMO = Q.has('demo');                       // test hook: no pointer lock needed
const CFG = { N: 36, fragLimit: 10, bots: 3, sens: 0.0022, fov: 74, adsFov: 52, gravity: 24, jump: 8.4, step: 1.06 };
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a = 1, b) => b === undefined ? Math.random() * a : a + Math.random() * (b - a);
const hs = (x, y) => { const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); };
let seed = 11; const srnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

/* ---------------- renderer, post-processing ---------------- */
const cv = $('gl');
const rd = new T.WebGLRenderer({ canvas: cv, antialias: true, powerPreference: 'high-performance' });
rd.setPixelRatio(Math.min(2, devicePixelRatio || 1));
rd.outputEncoding = T.LinearEncoding; rd.toneMapping = T.NoToneMapping;       // done in the final pass
rd.shadowMap.enabled = true; rd.shadowMap.type = T.PCFSoftShadowMap;
const sc = new T.Scene(); sc.background = new T.Color('#8fd0ff'); sc.fog = new T.Fog('#bfe3f8', 120, 340);
const cam = new T.PerspectiveCamera(CFG.fov, 1, 0.05, 700); sc.add(cam);
let composer = null, bloom = null;
function initComposer() {
  try {
    const w = innerWidth, h = innerHeight, pr = rd.getPixelRatio();
    const rt = (T.WebGLMultisampleRenderTarget && rd.capabilities.isWebGL2) ? new T.WebGLMultisampleRenderTarget(w * pr, h * pr, { type: T.HalfFloatType }) : new T.WebGLRenderTarget(w * pr, h * pr, { type: T.HalfFloatType }); if (rt.samples !== undefined && rd.capabilities.isWebGL2) rt.samples = 4;
    composer = new T.EffectComposer(rd, rt); composer.setPixelRatio(pr); composer.setSize(w, h);
    composer.addPass(new T.RenderPass(sc, cam));
    bloom = new T.UnrealBloomPass(new T.Vector2(w, h), 0.28, 0.6, 0.86); composer.addPass(bloom);
    const fin = new T.ShaderPass({
      uniforms: { tDiffuse: { value: null }, exposure: { value: 0.8 }, sat: { value: 1.38 } },
      vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: `uniform sampler2D tDiffuse;uniform float exposure,sat;varying vec2 vUv;
      vec3 aces(vec3 x){return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.);}
      void main(){vec3 c=texture2D(tDiffuse,vUv).rgb*exposure;c=aces(c);float l=dot(c,vec3(.299,.587,.114));c=mix(vec3(l),c,sat);
      c=c*.97+.015;c+=vec3(.008,.016,.04)*(1.-l)*(1.-l);vec2 d=vUv-.5;c*=1.-dot(d,d)*.32;gl_FragColor=vec4(pow(c,vec3(1./2.2)),1.);}`
    });
    composer.addPass(fin);
  } catch (e) { console.warn('composer unavailable', e); composer = null; rd.outputEncoding = T.sRGBEncoding; rd.toneMapping = T.ACESFilmicToneMapping; }
}
function resize() {
  const w = innerWidth, h = innerHeight; rd.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix();
  if (composer) { composer.setPixelRatio(rd.getPixelRatio()); composer.setSize(w, h); }
}
addEventListener('resize', resize);

/* ---------------- lights, sky, sea ---------------- */
sc.add(new T.HemisphereLight(0xcfe6ff, 0xc9a06a, 0.6));
const sun = new T.DirectionalLight(0xffecc4, 1.45); sun.position.set(40, 70, 25); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -34, right: 34, top: 34, bottom: -34, far: 220 }); sun.shadow.radius = 3; sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.35; sc.add(sun); sc.add(sun.target);
const skyMat = new T.ShaderMaterial({ side: T.BackSide, depthWrite: false, fog: false,
  vertexShader: 'varying vec3 v;void main(){v=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader: 'varying vec3 v;void main(){vec3 d=normalize(v);float k=smoothstep(-.05,.8,d.y);vec3 c=mix(vec3(.88,.97,1.),vec3(.30,.64,1.),pow(k,.8));float s=max(dot(d,normalize(vec3(.5,.7,.35))),0.);c+=vec3(1.,.92,.7)*(pow(s,300.)*2.5+pow(s,8.)*.14);gl_FragColor=vec4(c,1.);}' });
sc.add(new T.Mesh(new T.SphereGeometry(450, 32, 16), skyMat));
const cloudMat = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 1, emissive: 0xc4dcf4, emissiveIntensity: .6 }), CLOUDS = [];
for (let i = 0; i < 18; i++) { const g = new T.Group(), n = 3 + (srnd() * 4 | 0); for (let j = 0; j < n; j++) { const b = new T.Mesh(new T.SphereGeometry(5 + srnd() * 5, 18, 12), cloudMat); b.position.set(j * 6 - n * 3, srnd() * 2, srnd() * 3); b.scale.y = .72; g.add(b); } const a = srnd() * 6.28, r = 130 + srnd() * 100; g.position.set(Math.cos(a) * r, 45 + srnd() * 45, Math.sin(a) * r); g.userData.sp = .5 + srnd() * .8; sc.add(g); CLOUDS.push(g); }
const SEA_Y = -1.3;
const sea = new T.Mesh(new T.PlaneGeometry(1000, 1000), new T.ShaderMaterial({ uniforms: { t: { value: 0 }, land: { value: new T.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, T.RGBAFormat) } }, transparent: true,
  vertexShader: 'varying vec3 p;void main(){p=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(p,1.);}',
  fragmentShader: `uniform float t;uniform sampler2D land;varying vec3 p;void main(){
    vec2 u=p.xz*.08;float w=sin(u.x*3.+t*.8)*sin(u.y*3.4-t*.6)+sin((u.x+u.y)*5.+t*1.1)*.5;
    float cau=pow(abs(sin(u.x*9.+sin(u.y*7.+t)*1.5)*sin(u.y*8.-t*.7)),6.);
    vec2 uv=vec2((p.x+50.)/100.,(p.z+30.)/60.);float ins=step(0.,uv.x)*step(uv.x,1.)*step(0.,uv.y)*step(uv.y,1.);
    float dd=mix(8.,texture2D(land,uv).r*8.,ins);
    float d=length(p.xz);float sh=smoothstep(160.,40.,d);
    vec3 c=mix(vec3(.03,.44,.93),vec3(.16,.74,.99),sh*.9);
    c=mix(c,vec3(.52,.97,.92),(1.-smoothstep(.4,4.2,dd))*.85);
    c+=cau*.22*sh+max(w,0.)*.04;
    float fw=.62+.2*sin(t*1.3+p.x*.7+p.z*.5)+.1*sin(t*2.1-p.z*1.1);
    float foam=smoothstep(.4,.1,abs(dd-fw))+smoothstep(.2,.04,abs(dd-(fw+1.3+.25*sin(t*.9+p.x*.5))))*.5;
    c=mix(c,vec3(1.),clamp(foam,0.,1.));
    gl_FragColor=vec4(c,.95);}` }));
sea.rotation.x = -Math.PI / 2; sea.position.y = SEA_Y; sc.add(sea);

/* ---------------- terrain: rounded voxels, heightfield collision ---------------- */
const NX = 100, NZ = 60, HALFX = NX / 2, HALFZ = NZ / 2, HT = new Int8Array(NX * NZ), BR = new Uint8Array(NX * NZ);
const ISL = [{ x: -24, z: 1, rx: 22, rz: 20 }, { x: 24, z: -1, rx: 18, rz: 17 }];
const CASTLES = [{ x: -29, z: -8, hw: 3 }, { x: 28, z: 8, hw: 3 }];
const TOWERS = [{ x: -20, z: 7 }, { x: 22, z: -6 }];
const TPATH = []; { for (let i = 0; i < 6; i++) TPATH.push([-2.5 + i, -2.5]); for (let i = 1; i < 6; i++) TPATH.push([2.5, -2.5 + i]); for (let i = 1; i < 6; i++) TPATH.push([2.5 - i, 2.5]); for (let i = 1; i < 5; i++) TPATH.push([-2.5, 2.5 - i]); }
const STONE = new Uint8Array(100 * 60), TOP_CORE = 18, TSTEPS = 14;
const BRIDGE = { x0: -6, x1: 10, zc: 0, hw: 1.5, WA: [-9, 0], WB: [13, 0], mid: 2 };
const wxOf = ix => ix - HALFX + .5, wzOf = iz => iz - HALFZ + .5, islandOf = x => x < BRIDGE.mid ? 0 : 1;
for (let x = 0; x < NX; x++) for (let z = 0; z < NZ; z++) {
  const wx = wxOf(x), wz = wzOf(z); let base = 0;
  for (const i of ISL) { const d = Math.hypot((wx - i.x) / i.rx, (wz - i.z) / i.rz); base = Math.max(base, Math.max(0, 1.2 - d * d * 1.1) * 5.4); }
  const h = base > .3 ? base + Math.sin(x * .55) * Math.cos(z * .5) * .7 + (hs(x, z) - .5) * .8 : base;
  HT[x * NZ + z] = h < .8 ? 0 : Math.round(h);
}
for (const c of CASTLES) {
  const sd = c.x < 0 ? 1 : -1;
  for (let x = 0; x < NX; x++) for (let z = 0; z < NZ; z++) {
    const dx = wxOf(x) - c.x, dz = wzOf(z) - c.z, ax = Math.abs(dx), az = Math.abs(dz), i = x * NZ + z;
    if (ax < 4 && az < 4) HT[i] = 4;                       // flat apron
    if (ax < 3 && az < 3) { HT[i] = 7; STONE[i] = 1; }     // solid keep, walkable roof at 6.5
    if (az < 1 && dx * sd > 0) { const k = dx * sd; if (k > 5 && k < 6) HT[i] = 4; else if (k > 4 && k < 5) { HT[i] = 5; STONE[i] = 1; } else if (k > 3 && k < 4) { HT[i] = 6; STONE[i] = 1; } }   // 3-step stair on the island-facing side
  }
}
for (const t of TOWERS) for (let x = 0; x < NX; x++) for (let z = 0; z < NZ; z++) {
  const dx = wxOf(x) - t.x, dz = wzOf(z) - t.z, ax = Math.abs(dx), az = Math.abs(dz), i = x * NZ + z; if (ax >= 5 || az >= 5) continue;
  HT[i] = 4;
  if (ax < 4 && az < 4) {
    if (ax < 2 && az < 2) { HT[i] = TOP_CORE; STONE[i] = 1; }
    else { const cx = Math.max(-2.5, Math.min(2.5, dx)), cz = Math.max(-2.5, Math.min(2.5, dz)); const k = TPATH.findIndex(p => Math.abs(p[0] - cx) < .01 && Math.abs(p[1] - cz) < .01); if (k >= 0 && k < TSTEPS) { HT[i] = 5 + k; STONE[i] = 1; } }
  }
}
for (let x = 0; x < NX; x++) for (let z = 0; z < NZ; z++) { const wx = wxOf(x), wz = wzOf(z); if (wx >= BRIDGE.x0 && wx <= BRIDGE.x1 && Math.abs(wz - BRIDGE.zc) <= BRIDGE.hw) { const i = x * NZ + z; if (HT[i] > 3) HT[i] = 3; else if (HT[i] < 2) { HT[i] = 2; BR[i] = 1; } } }
const cellH = (ix, iz) => (ix < 0 || iz < 0 || ix >= NX || iz >= NZ) ? 0 : HT[ix * NZ + iz];
const ground = (x, z) => { const h = cellH(Math.floor(x + HALFX), Math.floor(z + HALFZ)); return h > 0 ? h - .5 : -Infinity; };
const gmax = (x, z, r) => Math.max(ground(x, z), ground(x + r, z), ground(x - r, z), ground(x, z + r), ground(x, z - r));
function rbox(w, h, d, r, s = 3) { // rounded box (smooth chunky look)
  const g = new T.BoxGeometry(w, h, d, s * 2, s * 2, s * 2), ps = g.attributes.position, hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r, v = new T.Vector3();
  for (let i = 0; i < ps.count; i++) { v.fromBufferAttribute(ps, i); const ix = clamp(v.x, -hx, hx), iy = clamp(v.y, -hy, hy), iz = clamp(v.z, -hz, hz), dx = v.x - ix, dy = v.y - iy, dz = v.z - iz, l = Math.hypot(dx, dy, dz); if (l > 1e-6) ps.setXYZ(i, ix + dx / l * r, iy + dy / l * r, iz + dz / l * r); }
  g.computeVertexNormals(); return g;
}
(function buildTerrain() {
  const chunks = new Map(), C = (hex, k = 1) => { const c = new T.Color(hex); c.multiplyScalar(k); return c; };
  const GR = [0x4fb534, 0x59bf38, 0x45a82e], SAND = [0xf5da94, 0xeecb82], DIRT = [0xd29a58, 0xbb8046, 0x9c6837], ROCK = 0xa98260, STN = [0xcfc7b8, 0xbdb5a6], WOOD = [0x8e5c30, 0x7a4c27];
  const CS = 20, push = (x, y, z, col) => { const key = ((x / CS) | 0) + ',' + ((z / CS) | 0); let c = chunks.get(key); if (!c) chunks.set(key, c = { cx: ((x / CS) | 0) * CS + CS / 2 - HALFX, cz: ((z / CS) | 0) * CS + CS / 2 - HALFZ, it: [] }); c.it.push([x - HALFX + .5, y, z - HALFZ + .5, col]); };
  for (let x = 0; x < NX; x++) for (let z = 0; z < NZ; z++) {
    const h = HT[x * NZ + z]; if (h <= 0) continue;
    if (BR[x * NZ + z]) { push(x, h - 1, z, C(WOOD[(x + z) & 1], .93 + hs(x * 3, z) * .14)); continue; }
    for (let y = -3; y < h; y++) {
      const nb = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]];
      let exp = false; for (const [a, b, c] of nb) { const nh = cellH(x + a, z + c), yy = y + b; if (!(yy >= -3 && yy < nh)) { exp = true; break; } }
      if (!exp) continue;
      let col; const dep = h - 1 - y, j = .93 + hs(x * 3 + y, z) * .14;
      if (STONE[x * NZ + z] && y >= 3) col = C(STN[(x + z + y) & 1], dep === 0 ? j * 1.06 : j * .96);
      else if (dep === 0) { col = h <= 1 ? C(SAND[(x + z) & 1], j) : C(GR[(x * 7 + z * 3) % 3], j); const hi = Math.max(cellH(x + 1, z), cellH(x - 1, z), cellH(x, z + 1), cellH(x, z - 1)); if (hi > h) col.multiplyScalar(.9); }
      else if (dep <= 2) col = C(DIRT[0], j); else if (dep <= 4) col = C(DIRT[1], j); else col = (hs(x + y, z * 5) > .85) ? C(ROCK, j) : C(DIRT[2], j);
      push(x, y, z, col);
    }
  }
  const geo = rbox(1, 1, 1, .27, 2), mat = new T.MeshStandardMaterial({ roughness: .85 }), D = new T.Object3D(); geo.boundingSphere = new T.Sphere(new T.Vector3(0, 0, 0), 28);
  chunks.forEach(c => {
    const im = new T.InstancedMesh(geo, mat, c.it.length); im.position.set(c.cx, 2, c.cz);
    c.it.forEach((it, i) => { D.position.set(it[0] - c.cx, it[1] - 2, it[2] - c.cz); D.scale.setScalar(.992); D.updateMatrix(); im.setMatrixAt(i, D.matrix); im.setColorAt(i, it[3]); });
    im.castShadow = im.receiveShadow = true; sc.add(im);
  });
  // posts under the bridge
  const pm = new T.MeshStandardMaterial({ color: 0x6b4a2a, roughness: .9 }); for (let x = BRIDGE.x0; x <= BRIDGE.x1; x += 4) for (const zz of [-1.9, 1.9]) { const wx = x + .5, ix = Math.floor(wx + HALFX), iz = Math.floor(zz + HALFZ); if (BR[ix * NZ + iz] || BR[ix * NZ + Math.floor(BRIDGE.zc + HALFZ)]) { const m = new T.Mesh(new T.CylinderGeometry(.16, .2, 4.2, 8), pm); m.position.set(wx, -.7, zz); m.castShadow = true; sc.add(m); } }
})();

/* props */
const MS = (c, r = .8, m = 0, e = 0) => new T.MeshStandardMaterial({ color: c, roughness: r, metalness: m, emissive: e || 0x000000, emissiveIntensity: e ? 1.2 : 0 });
const COLL = [];             // circle colliders {x,z,r}
const gy = (x, z) => { const g = ground(x, z); return g === -Infinity ? 0 : g; };
/* ---------------- wind: slowly drifting direction + strength, with gusts ---------------- */
const WIND = { a: Math.random() * 6.283, s: .45, ta: 0, ts: .45, next: 10, vx: 0, vz: 0, e: .45 }; WIND.ta = WIND.a;
const PALMS = [];
function windUpdate(dt) {
  const W = WIND, t = performance.now() / 1000; W.next -= dt;
  if (W.next <= 0) { W.next = rnd(14, 28); W.ta = W.a + rnd(-2.2, 2.2); W.ts = Math.random() < .2 ? rnd(.08, .2) : rnd(.3, 1); }
  let da = W.ta - W.a; da = Math.atan2(Math.sin(da), Math.cos(da)); W.a += da * Math.min(1, dt * .16); W.s += (W.ts - W.s) * Math.min(1, dt * .18);
  W.e = W.s * (1 + .28 * Math.sin(t * .9 + Math.sin(t * .31) * 2.2) + .12 * Math.sin(t * 2.3)); W.vx = Math.cos(W.a) * W.e; W.vz = Math.sin(W.a) * W.e;
  for (const p of PALMS) {
    const ph = p.ph; p.g.rotation.z = -W.vx * .035 + Math.sin(t * .8 + ph) * .012 * W.e; p.g.rotation.x = W.vz * .035 + Math.cos(t * .7 + ph) * .012 * W.e;
    for (const l of p.leaves) { const f = Math.cos(l.ang - W.a); l.m.rotation.z = l.z0 + W.e * (.14 * f + .06 * Math.sin(t * 1.9 + ph + l.ang * 1.3)); l.m.rotation.x = .08 * W.e * Math.sin(t * 2.6 + ph * 2 + l.ang); }
  }
  const wh = $('wind'); if (wh) { const yaw = P.yaw, rx = Math.cos(yaw), rz = -Math.sin(yaw), fx = -Math.sin(yaw), fz = -Math.cos(yaw), wx = Math.cos(W.a), wz = Math.sin(W.a); wh.querySelector('i').style.transform = 'rotate(' + (Math.atan2(wx * rx + wz * rz, wx * fx + wz * fz) * 57.2958).toFixed(1) + 'deg)'; const n = Math.max(1, Math.min(5, Math.round(W.s * 5))); wh.lastElementChild.textContent = '▮'.repeat(n) + '▯'.repeat(5 - n); }
}
/* ---- toy-diorama props: merged vertex-coloured geometry helpers ---- */
const DECOR = [];
function tint(g, hex) { const c = new T.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } g.setAttribute('color', new T.BufferAttribute(a, 3)); return g; }
function mergeG(list) {
  const P_ = [], N_ = [], C_ = [];
  for (const g of list) { const n = g.index ? g.toNonIndexed() : g; for (const [src, dst] of [[n.attributes.position, P_], [n.attributes.normal, N_], [n.attributes.color, C_]]) for (let i = 0; i < src.array.length; i++) dst.push(src.array[i]); }
  const o = new T.BufferGeometry(); o.setAttribute('position', new T.Float32BufferAttribute(P_, 3)); o.setAttribute('normal', new T.Float32BufferAttribute(N_, 3)); o.setAttribute('color', new T.Float32BufferAttribute(C_, 3)); return o;
}
const VMAT = new T.MeshStandardMaterial({ vertexColors: true, roughness: .8 });
/* one shared drooping, scalloped palm frond (grows along +x) */
const LEAFG = (() => {
  const SL = 22, SW = 4, L = 3.5, pos = [], col = [], idx = [], c0 = new T.Color(0x0f6a26), c1 = new T.Color(0x3fae2e), c2 = new T.Color(0x86cc3a), cc = new T.Color();
  for (let i = 0; i <= SL; i++) {
    const t = i / SL, sc_ = Math.sqrt(Math.max(0, 1 - Math.pow(t, 3.4))) * (.35 + .65 * Math.min(1, t / .22)), sc2 = 1 - .2 * (.5 + .5 * Math.sin(t * 24)) * Math.max(0, (t - .15) / .85), w = .95 * sc_ * sc2;
    for (let j = 0; j <= SW; j++) {
      const u = j / SW * 2 - 1, au = Math.abs(u);
      pos.push(t * L * (1 - .22 * t), -t * t * 1.5 + (1 - au) * .26 * w * (.4 + t) - au * au * .06, u * w);
      cc.copy(c0).lerp(c1, Math.min(1, t * 1.25)).lerp(c2, au * au * .55 * (.4 + t)); col.push(cc.r, cc.g, cc.b);
    }
  }
  for (let i = 0; i < SL; i++) for (let j = 0; j < SW; j++) { const a = i * (SW + 1) + j, b = a + 1, c = a + SW + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new T.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
})();
const LEAFM = new T.MeshStandardMaterial({ vertexColors: true, roughness: .62, side: T.DoubleSide });
function palmTrunk(lx, lz) {
  const K = 9, H = 4.6, pts = [], parts = [], up = new T.Vector3(0, 1, 0);
  for (let i = 0; i <= K; i++) { const t = i / K; pts.push(new T.Vector3(lx * t * t * 1.5, H * t, lz * t * t * 1.5)); }
  for (let i = 0; i < K; i++) {
    const a = pts[i], b = pts[i + 1], dir = b.clone().sub(a), len = dir.length(), r = .4 * (1 - .06 * i);
    const g = new T.CylinderGeometry(r * .82, r * (i === 0 ? 1.35 : 1.14), len * 1.05, 12, 1, false);
    g.applyMatrix4(new T.Matrix4().compose(a.clone().lerp(b, .5), new T.Quaternion().setFromUnitVectors(up, dir.normalize()), new T.Vector3(1, 1, 1)));
    parts.push(tint(g, i % 2 ? 0x9c6526 : 0xbf8636));
  }
  const top = pts[K], crown = new T.SphereGeometry(.46, 10, 8); crown.translate(top.x, top.y + .05, top.z); parts.push(tint(crown, 0x9a7032));
  for (const [dx, dy, dz] of [[.32, -.3, .2], [-.3, -.26, .26], [.04, -.4, -.36]]) { const c = new T.SphereGeometry(.26, 9, 7); c.translate(top.x + dx, top.y + dy, top.z + dz); parts.push(tint(c, 0xa6d84c)); }
  return { geo: mergeG(parts), top };
}
function palm(x, z, s = 1) {
  const g = new T.Group(), ang0 = rnd(6.28), lean = rnd(.35, .95), { geo, top } = palmTrunk(Math.cos(ang0) * lean, Math.sin(ang0) * lean);
  const tr = new T.Mesh(geo, VMAT); tr.castShadow = true; g.add(tr);
  const lv = [], N = 9;
  for (let i = 0; i < N + 2; i++) {
    const young = i >= N, ang = young ? i * 3 : i * (6.283 / N) + rnd(-.18, .18), piv = new T.Group(); piv.rotation.order = 'YZX';
    const l = new T.Mesh(LEAFG, LEAFM); l.castShadow = true; l.scale.setScalar(young ? .62 : rnd(.88, 1.15)); piv.add(l);
    const z0 = young ? 1.05 : rnd(.12, .55); piv.position.set(top.x, top.y + .12, top.z); piv.rotation.y = -ang; piv.rotation.z = z0; g.add(piv); lv.push({ m: piv, ang, z0 });
  }
  PALMS.push({ g, leaves: lv, ph: rnd(6.28) });
  g.position.set(x, gy(x, z), z); g.scale.setScalar(s); sc.add(g); COLL.push({ x, z, r: .38 * s, h: 5.6 * s, kind: 'palm' });
}
function castle(C) {
  const g = new T.Group(), st = MS(0xcfc7b8, .95), rf = MS(0xd9543c, .8), h = 4 - .5 + 0;
  const k = (w, hh, d, m, px, py, pz) => { const b = new T.Mesh(rbox(w, hh, d, .08, 2), m); b.position.set(px, py + hh / 2, pz); b.castShadow = b.receiveShadow = true; g.add(b); };
  for (const [a, b] of [[-2.5, -2.5], [2.5, -2.5], [-2.5, 2.5], [2.5, 2.5]]) {
    k(1.6, 4.8, 1.6, st, a, 0, b); const c = new T.Mesh(new T.ConeGeometry(1.25, 1.7, 8), rf); c.position.set(a, 5.65, b); c.castShadow = true; g.add(c);
    for (let i = 0; i < 4; i++) k(.36, .42, .36, st, a + (i % 2 ? .52 : -.52), 4.8, b + (i < 2 ? .52 : -.52));
    COLL.push({ x: C.x + a, z: C.z + b, r: .8, h: 4.8, kind: 'castle' });
  }
  k(1.4, 1.9, .3, MS(0x5a3a22), 0, 0, 3.05);
  g.position.set(C.x, h, C.z); sc.add(g);
}
function tower(T0) {
  const g = new T.Group(), st = MS(0xcfc7b8, .95), rf = MS(0xd9543c, .8), gold = MS(0xf2c34d, .5, .1, 0x3a2a00), base = 3.5, top = TOP_CORE - .5;
  // open canopy on four posts over the top platform
  for (const [a, b] of [[-1.8, -1.8], [1.8, -1.8], [-1.8, 1.8], [1.8, 1.8]]) { const p = new T.Mesh(new T.CylinderGeometry(.12, .14, 3.1, 8), st); p.position.set(a, top + 1.55, b); p.castShadow = true; g.add(p); }
  const cone = new T.Mesh(new T.ConeGeometry(3.1, 3, 12), rf); cone.position.set(0, top + 3.1 + 1.5, 0); cone.castShadow = true; g.add(cone);
  const fin = new T.Mesh(new T.SphereGeometry(.2, 10, 8), gold); fin.position.set(0, top + 6.3, 0); g.add(fin);
  const pole = new T.Mesh(new T.CylinderGeometry(.04, .04, 1.2, 6), st); pole.position.set(0, top + 6.7, 0); g.add(pole);
  const flag = new T.Mesh(new T.PlaneGeometry(.9, .5), new T.MeshBasicMaterial({ color: 0xff6a5c, side: T.DoubleSide })); flag.position.set(.45, top + 7, 0); g.add(flag);
  // window + long golden braid on the -x face (the side with ground-level steps)
  const win = new T.Mesh(rbox(.16, 1.1, .9, .05, 2), MS(0x2a1b2e, .9)); win.position.set(-2.02, top - 2.2, 0); g.add(win);
  const sill = new T.Mesh(rbox(.34, .14, 1.15, .04, 2), st); sill.position.set(-2.1, top - 2.82, 0); g.add(sill);
  const y0 = top - 2.8, y1 = base + .5, n = Math.round((y0 - y1) / .3);
  for (let i = 0; i < n; i++) { const s = new T.Mesh(new T.SphereGeometry(.17, 8, 6), gold); s.scale.set(1, 1.45, 1); s.position.set(-2.22, y0 - i * .3, Math.sin(i * 1.15) * .13); s.castShadow = true; g.add(s); }
  const bow = new T.Mesh(new T.TorusGeometry(.22, .06, 6, 12), MS(0xff6a5c, .6)); bow.position.set(-2.22, y1 - .1, 0); bow.rotation.y = Math.PI / 2; g.add(bow);
  g.position.set(T0.x, 0, T0.z); sc.add(g);
}
CASTLES.forEach(castle); TOWERS.forEach(tower);
const nearCastle = (x, z, m = 4.5) => CASTLES.some(c => Math.abs(x - c.x) < m && Math.abs(z - c.z) < m) || TOWERS.some(c => Math.abs(x - c.x) < m + .8 && Math.abs(z - c.z) < m + .8);
const onBridgeZone = (x, z) => x > BRIDGE.x0 - 4 && x < BRIDGE.x1 + 4 && Math.abs(z - BRIDGE.zc) < 4;
// scatter palms + rocks + flags on both islands
const PLACED = [];
function scatter(n, minD, okFn, fn) { let tries = 0, made = 0; while (made < n && tries++ < n * 40) { const i = ISL[srnd() * ISL.length | 0], a = srnd() * 6.28, r = Math.sqrt(srnd()) * .9, x = i.x + Math.cos(a) * r * i.rx, z = i.z + Math.sin(a) * r * i.rz, g = ground(x, z); if (g === -Infinity || !okFn(g, x, z) || nearCastle(x, z) || onBridgeZone(x, z) || PLACED.some(q => Math.hypot(q[0] - x, q[1] - z) < minD)) continue; PLACED.push([x, z]); fn(x, z); made++; } }
scatter(34, 4.2, g => g > .4 && g < 4, (x, z) => palm(x, z, .95 + srnd() * .35));
scatter(26, 3, g => g > 1.5, (x, z) => { const b = new T.Mesh(new T.DodecahedronGeometry(.4 + srnd() * .5, 1), MS(0x7f8696, .9)); b.position.set(x, gy(x, z) + .25, z); b.rotation.set(srnd() * 3, srnd() * 3, 0); b.castShadow = b.receiveShadow = true; sc.add(b); COLL.push({ x, z, r: .45, h: .9, kind: 'rock' }); });
function flag(x, z, c) { const g = new T.Group(), p = new T.Mesh(new T.CylinderGeometry(.06, .06, 3.2, 8), MS(0xb98a52)); p.position.y = 1.6; p.castShadow = true; g.add(p); const f = new T.Mesh(rbox(1.2, .7, .05, .02, 2), MS(c, .6)); f.position.set(.65, 2.8, 0); f.castShadow = true; g.add(f); g.position.set(x, gy(x, z), z); sc.add(g); (flag.l = flag.l || []).push(f); }
scatter(5, 14, g => g > 2.5, (x, z) => flag(x, z, [0x2a7bff, 0xff3a3a, 0xffd23a, 0x3aff7a, 0xff7ae0][PLACED.length % 5]));
/* ---------------- diorama decor: hyacinth flowers, shells, stumps; shoreline distance map for the sea shader ---------------- */
(function decor() {
  let sd = 20261126; const dr = () => ((sd = (sd * 1664525 + 1013904223) >>> 0) / 4294967296), pick = a => a[dr() * a.length | 0];
  // shoreline distance field -> sea shallows + foam
  { const data = new Uint8Array(NX * NZ * 4); for (let ix = 0; ix < NX; ix++) for (let iz = 0; iz < NZ; iz++) { let d = 8; if (HT[ix * NZ + iz] > 0) d = 0; else for (let a = -8; a <= 8 && d > 1; a++) for (let b = -8; b <= 8; b++) if (cellH(ix + a, iz + b) > 0) { const q = Math.hypot(a, b); if (q < d) d = q; } const k = (iz * NX + ix) * 4, v = Math.round(d / 8 * 255); data[k] = data[k + 1] = data[k + 2] = v; data[k + 3] = 255; }
    const tx = new T.DataTexture(data, NX, NZ, T.RGBAFormat); tx.minFilter = tx.magFilter = T.LinearFilter; tx.wrapS = tx.wrapT = T.ClampToEdgeWrapping; tx.needsUpdate = true; sea.material.uniforms.land.value = tx; }
  const free = (x, z, m) => !nearCastle(x, z, m) && !onBridgeZone(x, z) && !COLL.some(c => Math.hypot(c.x - x, c.z - z) < c.r + .7);
  const spot = (okFn, tries = 60) => { for (let k = 0; k < tries; k++) { const i = ISL[dr() * ISL.length | 0], a = dr() * 6.28, r = Math.sqrt(dr()) * .95, x = i.x + Math.cos(a) * r * i.rx, z = i.z + Math.sin(a) * r * i.rz, g = ground(x, z); if (g > -Infinity && okFn(g, x, z) && free(x, z, 4.2)) return [x, z, g]; } return null; };
  // hyacinth: 3-stem clump with cone-shaped blooms
  const bloomGeo = hex => { const parts = [], ST = new T.Color(0x3d9a2c); for (let k = 0; k < 3; k++) { const ox = (k - 1) * .16, oz = (k % 2 ? .1 : -.08), h = .5 + k * .08; const st = new T.CylinderGeometry(.025, .035, h, 5); st.translate(ox, h / 2, oz); parts.push(tint(st, 0x3d9a2c));
      for (let j = 0; j < 9; j++) { const t = j / 8, b = new T.SphereGeometry(.058 * (1.05 - t * .45), 6, 5); b.translate(ox + Math.cos(j * 2.4) * .05 * (1 - t * .6), h * .52 + t * h * .55, oz + Math.sin(j * 2.4) * .05 * (1 - t * .6)); parts.push(tint(b, hex)); }
      for (const sgn of [-1, 1]) { const lf = new T.ConeGeometry(.07, .42, 4); lf.rotateZ(sgn * .55); lf.translate(ox + sgn * .09, .2, oz); parts.push(tint(lf, 0x2f8a26)); } } return mergeG(parts); };
  const D = new T.Object3D();
  for (const [hex, n] of [[0xffd93a, 90], [0xfdfdf2, 30], [0xf24a4a, 16]]) {
    const pts = []; for (let k = 0; k < n; k++) { const p = spot((g, x, z) => g > 1.2 && gmax(x, z, .5) - ground(x, z) < 1.2, 40); if (!p) continue; pts.push(p); }
    const im = new T.InstancedMesh(bloomGeo(hex), VMAT, pts.length); pts.forEach((p, i) => { D.position.set(p[0], p[2], p[1]); D.rotation.set(0, dr() * 6.28, 0); D.scale.setScalar(.75 + dr() * .4); D.updateMatrix(); im.setMatrixAt(i, D.matrix); }); im.castShadow = false; sc.add(im); DECOR.push(im);
  }
  // beach shells (conch-ish): cone + round end, three colours
  const shellGeo = hex => { const c = new T.ConeGeometry(.13, .34, 7); c.rotateZ(Math.PI / 2); c.translate(.08, .1, 0); const b = new T.SphereGeometry(.15, 8, 6); b.scale(1, .8, .9); b.translate(-.08, .1, 0); return mergeG([tint(c, hex), tint(b, hex)]); };
  for (const [hex, n] of [[0xf08a3a, 14], [0xd9ecff, 12], [0xa9b8e8, 9]]) {
    const pts = []; for (let k = 0; k < n; k++) { const p = spot((g, x, z) => g <= .6 && g > -.6, 80); if (p) pts.push(p); }
    const im = new T.InstancedMesh(shellGeo(hex), VMAT, pts.length); pts.forEach((p, i) => { D.position.set(p[0], p[2] + .02, p[1]); D.rotation.set(0, dr() * 6.28, 0); D.scale.setScalar(.9 + dr() * .5); D.updateMatrix(); im.setMatrixAt(i, D.matrix); }); im.castShadow = true; sc.add(im); DECOR.push(im);
  }
  // cut tree stumps (solid, small collider)
  const stumpGeo = (() => { const side = new T.CylinderGeometry(.5, .66, .62, 12, 1, true), top = new T.CylinderGeometry(.5, .5, .04, 12); top.translate(0, .33, 0); const ring = new T.TorusGeometry(.3, .025, 5, 14); ring.rotateX(Math.PI / 2); ring.translate(0, .355, 0); return mergeG([tint(side, 0xc29346), tint(top, 0xe8c383), tint(ring, 0xb78a45)]); })();
  for (let k = 0; k < 7; k++) { const p = spot((g, x, z) => g > .4 && g < 3.5, 60); if (!p) continue; const m = new T.Mesh(stumpGeo, VMAT); m.position.set(p[0], p[2] + .3, p[1]); m.rotation.y = dr() * 6.28; m.castShadow = m.receiveShadow = true; sc.add(m); COLL.push({ x: p[0], z: p[1], r: .55, h: .65, kind: 'rock' }); }
})();
const solidAt = (x, y, z) => { const g = ground(x, z); return (g > y && y > -3.5); };
function worldRay(ox, oy, oz, dx, dy, dz, max) { for (let t = .3; t < max; t += .25) { const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t; if (solidAt(x, y, z) || y < -6) return t - .12; } return max; }
function losBlocked(ax, ay, az, bx, by, bz) { const dx = bx - ax, dy = by - ay, dz = bz - az, l = Math.hypot(dx, dy, dz); for (let t = .6; t < l; t += .5) if (solidAt(ax + dx / l * t, ay + dy / l * t, az + dz / l * t)) return true; return false; }

/* ---------------- audio: see audio.js (makeAudio) ---------------- */
let AC = null, AU = null, CI = 0;
const VOLS = { master: .92, sfx: 1, vox: .95, amb: .55, mus: .3 }; try { Object.assign(VOLS, JSON.parse(localStorage.getItem('wi_vol') || '{}')); } catch (e) { }
function aInit() { if (AU) return; try { AC = new (window.AudioContext || window.webkitAudioContext)(); AU = makeAudio(AC); for (const k in VOLS) AU.setVol(k, VOLS[k]); AU.startAmbience(); AU.startMusic(); AU.setHealth(P.hp / 100, P.alive); } catch (e) { AC = null; AU = null; } }
const surfAt = (x, z) => { if (CASTLES.some(c => Math.abs(x - c.x) < c.hw + .5 && Math.abs(z - c.z) < c.hw + .5) || TOWERS.some(c => Math.abs(x - c.x) < 4 && Math.abs(z - c.z) < 4)) return 'rock'; const ix = Math.floor(x + HALFX), iz = Math.floor(z + HALFZ); if (BR[ix * NZ + iz]) return 'rock'; return cellH(ix, iz) <= 1 ? 'sand' : 'grass'; };
const BASEP = { BLUBBER: 250, MARMALADE: 190, GRAPE: 310 };
const COMBAT = { uzi: .07, shotgun: .22, hurt: .3, die: .2, gib: .25, batHit: .15 };
function snd(n, x, y, z, o) { // positional if a source is given
  if (!AU) return; o = o || {};
  try {
    let pos = null;
    if (x !== undefined) { pos = { x, y: y + 1.2, z }; const d = Math.hypot(x - P.x, z - P.z); if (d > 4 && losBlocked(P.x, P.y + 1.6, P.z, x, y + 1.2, z)) o.occl = true; if (d < 28 && COMBAT[n]) CI = Math.min(1, CI + COMBAT[n] * (x === undefined ? 1 : .5)); }
    else if (COMBAT[n]) CI = Math.min(1, CI + COMBAT[n]);
    AU.play(n, pos, o);
  } catch (e) { }
}
function voice(kind, b, o) { // worm voices: bots positional, the player is 'self'
  if (!AU) return; try { const base = b ? (BASEP[b.name] || 260) : 220; AU.play('voice', b ? { x: b.x, y: b.y + 1.5, z: b.z } : null, Object.assign({ kind, base, self: !b }, o || {})); } catch (e) { }
}
let ANV = null, ANPICK = ''; try { ANPICK = localStorage.getItem('wi_annv') || ''; } catch (e) { }
const ANBAD = /fred|albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|hysterical|junior|kathy|organ|princess|ralph|trinoids|whisper|wobble|zarvox|superstar|jester|eddy|flo\b|grandma|grandpa|reed|rocko|sandy|shelley/i;
function annScore(v) { let s = 0; const n = v.name; if (/\bkaren\b/i.test(n)) s += 200; if (/natural|neural|online/i.test(n)) s += 60; if (/premium|enhanced|siri/i.test(n)) s += 45; if (/google uk english male/i.test(n)) s += 35; if (/daniel|aaron|arthur|ryan|guy|davis|james|mark|tom|evan|david|george|oliver|male/i.test(n)) s += 25; if (/female|zira|hazel|susan|samantha|moira|tessa|victoria/i.test(n)) s -= 8; if (ANBAD.test(n)) s -= 200; if (v.localService) s += 4; if (/^en[-_](gb|us|au)/i.test(v.lang)) s += 3; return s; }
function annVoices() { if (!window.speechSynthesis) return []; return speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang)).sort((a, b) => annScore(b) - annScore(a)); }
function annVoice() { if (ANV !== null) return ANV; if (!window.speechSynthesis) return null; const en = annVoices(); if (!en.length) return null; if (ANPICK === 'off') return ANV = false; const pk = ANPICK && en.find(v => v.name === ANPICK); return ANV = pk || en[0]; }
try { if (window.speechSynthesis) speechSynthesis.onvoiceschanged = () => { ANV = null; try { annFill(); } catch (e) { } }; } catch (e) { }
function annText(t) { t = t.replace(/\s+/g, ' ').trim(); const bang = /!$/.test(t); t = t.replace(/[!.]+$/, '').toLowerCase(); t = t.charAt(0).toUpperCase() + t.slice(1); return t + (bang ? '!' : '.'); }
function announce(text, big = true) {
  const m = $('msg'); m.textContent = text; m.classList.add('on'); clearTimeout(announce.t); announce.t = setTimeout(() => m.classList.remove('on'), 1500);
  if (big) snd('sting', undefined, undefined, undefined, { lvl: Math.min(2, (P.multi || 1) - 1) }); if (AU) AU.duck(.3, 1.6); if (!window.speechSynthesis || !AC) return;
  try {
    const v = annVoice(); if (v === false) return;
    speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(annText(text)); if (v) { u.voice = v; u.lang = v.lang; }
    const hype = Math.min(3, Math.max(0, (P.multi || 1) - 1) + (P.streak >= 5 ? 1 : 0)); u.pitch = (v && /karen/i.test(v.name) ? .95 : .88) + hype * .05 + (Math.random() - .5) * .06; u.rate = 1.0 + hype * .04 + (Math.random() - .5) * .04; u.volume = 1;
    setTimeout(() => { try { speechSynthesis.speak(u); } catch (e) { } }, 170);
  } catch (e) { }
}
function annFill() { const sel = $('annsel'); if (!sel) return; const vs = annVoices(); sel.innerHTML = ''; const add = (v, t) => { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.append(o); }; add('', 'Auto (most natural)'); vs.slice(0, 14).forEach(v => add(v.name, v.name)); add('off', 'Off (text only)'); sel.value = ANPICK && [...sel.options].some(o => o.value === ANPICK) ? ANPICK : ''; }

/* ---------------- fx: tracers, particles, flashes ---------------- */
const TR = [], tGeo = new T.BoxGeometry(.014, .014, 1), tMat = () => new T.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, depthWrite: false, fog: false });
for (let i = 0; i < 40; i++) { const m = new T.Mesh(tGeo, tMat()); m.visible = false; m.userData.l = 0; sc.add(m); TR.push(m); }
function tracer(a, b, life = .07) { const m = TR.find(t => !t.visible); if (!m) return; const l = a.distanceTo(b); m.position.copy(a).lerp(b, .5); m.lookAt(b); m.scale.set(1, 1, Math.max(.1, l)); m.material.opacity = .9; m.visible = true; m.userData.l = life; m.userData.m = life; }
const PA = [], pGeo = new T.IcosahedronGeometry(1, 0);
for (let i = 0; i < 900; i++) { const m = new T.Mesh(pGeo, new T.MeshStandardMaterial({ roughness: .8 })); m.visible = false; m.userData = { l: 0 }; sc.add(m); PA.push(m); }
function puff(x, y, z, color, n = 6, sp = 3, size = .06, life = .6, up = 2, emi = 0) {
  for (let i = 0; i < n; i++) { const m = PA.find(p => !p.visible); if (!m) return; m.position.set(x, y, z); m.material.color.set(color); m.material.emissive.set(emi); const s = size * (.6 + Math.random() * .9); m.scale.setScalar(s); m.userData = { vx: (Math.random() - .5) * sp, vy: Math.random() * sp * .8 + up * .5, vz: (Math.random() - .5) * sp, l: life * (.6 + Math.random() * .6), m: life, s }; m.visible = true; }
}
const flashLight = new T.PointLight(0xffc860, 0, 10, 2); cam.add(flashLight);
let shake = 0; const HK = { p: 0, r: 0, lean: 0 };
function updateFx(dt) {
  for (const m of TR) if (m.visible) { m.userData.l -= dt; m.material.opacity = Math.max(0, m.userData.l / m.userData.m) * .9; if (m.userData.l <= 0) m.visible = false; }
  for (const m of PA) if (m.visible) { const u = m.userData; u.l -= dt; u.vy -= 14 * dt; m.position.x += u.vx * dt; m.position.y += u.vy * dt; m.position.z += u.vz * dt; m.scale.setScalar(u.s * Math.max(.05, u.l / u.m)); if (u.l <= 0 || m.position.y < SEA_Y) m.visible = false; }
  flashLight.intensity = Math.max(0, flashLight.intensity - dt * 60);
  shake = Math.max(0, shake - dt * 5);
  for (const m of GIBS) if (m.visible) {
    const u = m.userData; u.l -= dt; u.vy -= 22 * dt; m.position.x += u.vx * dt; m.position.y += u.vy * dt; m.position.z += u.vz * dt;
    const g = ground(m.position.x, m.position.z);
    if (g > -Infinity && m.position.y < g + u.r * .7) { m.position.y = g + u.r * .7; if (u.vy < -3 && u.b < 2) puff(m.position.x, g + .1, m.position.z, m.material.color.getHex(), 3, 2, .06, .35); u.vy = -u.vy * .42; u.vx *= .72; u.vz *= .72; u.sx *= .6; u.sy *= .6; u.b++; if (Math.abs(u.vy) < 1.2) u.vy = 0; }
    m.rotation.x += u.sx * dt; m.rotation.z += u.sy * dt; m.scale.setScalar(u.r * Math.min(1, Math.max(.05, u.l / .6)));
    if (u.l <= 0 || m.position.y < -7) m.visible = false;
  }
  for (const s of BUB) if (s.visible) {
    const u = s.userData; u.l -= dt; const age = 1 - u.l / u.m, k = age < .16 ? (() => { const t = age / .16 - 1; return 1 + 2.7 * t * t * t + 1.7 * t * t; })() : 1;
    s.scale.set(1.5 * k, 1.5 * k, 1); s.position.y = u.y0 + age * .8; s.material.opacity = u.l < .25 ? Math.max(0, u.l / .25) : 1; if (u.l <= 0) s.visible = false;
  }
  for (const m of SFXP) if (m.visible) { const u = m.userData; u.t += dt; const k = u.t / .6; m.scale.set(1 + k * 1.4, 1 + k * .3, 1 + k * 1.4); m.material.opacity = .7 * (1 - k); if (k >= 1) m.visible = false; }
}

/* ---------------- worms (bots + models) ---------------- */

/* ---------------- faces, emoji bubbles, gibs, spawn flashes ---------------- */
/* Worms-style faces: bulging eyes with big pupils, thick brows, a huge morphing mouth (ox/oy = open width/height), head squash & stretch */
const X_ = o => Object.assign({ brow: .1, by: .45, ex: 1, ey: 1, pk: 1, smile: .6, ox: 0, oy: 0, hw: 1, hh: 1, ln: 0 }, o);
const EXPR = {
  neutral:   X_({}),
  angry:     X_({ brow: .7, by: .4, ey: .8, smile: -.7, pk: 1.1 }),
  rage:      X_({ brow: .85, by: .36, ex: 1.05, ey: .75, pk: .8, smile: 0, ox: 1.6, oy: .95, hw: 1.06, hh: .96 }),
  hurt:      X_({ brow: -.55, by: .56, ey: .35, pk: .8, smile: -.4, ox: 1.0, oy: .6, hw: .97, hh: 1.04 }),
  scared:    X_({ brow: -.6, by: .66, ex: 1.35, ey: 1.4, pk: .4, smile: 0, ox: 1.15, oy: 1.4, hw: .96, hh: 1.08 }),
  surprised: X_({ brow: -.15, by: .66, ex: 1.25, ey: 1.3, pk: .55, smile: 0, ox: .95, oy: 1.15, hh: 1.05 }),
  scream:    X_({ brow: -.3, by: .62, ex: 1.35, ey: 1.4, pk: .5, smile: 0, ox: 1.9, oy: 1.8, hw: 1.08, hh: 1.05, ln: 1 }),
  happy:     X_({ brow: -.1, by: .55, ey: .8, pk: 1.1, smile: .9, ox: 1.55, oy: .85, ln: 1 }),
  cool:      X_({ brow: 0, by: .5, smile: .9, ox: 1.2, oy: .45, sh: 1 }),
  flat:      X_({ smile: .05, by: .48 }),
  worried:   X_({ brow: -.4, by: .58, smile: -.35, ex: 1.1, ey: 1.1 }),
  sleep:     X_({ brow: -.1, ey: .08, smile: 0, ox: .45, oy: .35 }),
  dead:      X_({ brow: -.4, ox: .85, oy: .6, smile: 0, xe: 1, ln: 1 })
};
const FKEYS = ['brow', 'by', 'ex', 'ey', 'pk', 'smile', 'ox', 'oy', 'hw', 'hh', 'ln'];
function applyFace(m, dt, blink) {
  const c = m.fc, t = m.ft, k = Math.min(1, dt * 16), F = m.F, now = performance.now() / 1000;
  for (const key of FKEYS) c[key] += (t[key] - c[key]) * k;
  const ey = c.ey * (blink ? .1 : 1), xe = !!t.xe, ER = .34, ez = .64 + ER * c.ex * .9, ph = m.ph || 0;
  F.brows.forEach(([br, s]) => { br.rotation.z = c.brow * s; br.position.y = c.by + .12; });
  F.eyes.forEach((e, i) => { e.scale.set(c.ex, ey, c.ex); e.position.z = .64 + (c.ex - 1) * .1; });
  const lx = Math.sin(now * 1.1 + ph) * .05 + (c.oy > 1.2 ? 0 : 0), ly = Math.sin(now * .8 + ph * 2) * .025;
  F.pupils.forEach((p, i) => { const s = i ? 1 : -1; p.scale.set(c.pk, c.pk * Math.min(1, ey * 2), c.pk); p.position.set(s * .34 + lx * ey + (c.ox > 1.4 ? -s * .03 : 0), .22 + ly * 2, ez + .03); p.visible = !xe; });
  F.hl.forEach((h, i) => { const s = i ? 1 : -1; h.scale.setScalar(c.pk); h.position.set(s * .34 + .06 + lx * ey, .22 + .1, ez + .12); h.visible = !xe && ey > .5; });
  F.xs.forEach(x => { x.visible = xe; x.position.z = ez + .04; });
  F.shades.visible = !!t.sh;
  const mo = F.mouth; mo.rotation.z = c.smile >= 0 ? Math.PI : 0; mo.scale.set(1.15, Math.max(.12, Math.abs(c.smile)), 1); mo.position.y = c.smile >= 0 ? -.3 : -.56; mo.visible = c.oy < .25;
  F.open.visible = c.oy > .08; F.open.scale.set(Math.max(.01, c.ox), Math.max(.01, c.oy), .55);
  F.tongue.visible = c.ln > .3; F.tongue.position.y = -.17 + Math.sin(now * 9 + ph) * .02; F.tongue.position.z = .06 + (t.xe ? .1 : 0);
  F.chin.position.y = -.64 - c.oy * .3; F.chin.position.z = .42 - c.oy * .12;
  m.head.scale.set(c.hw, c.hh, (c.hw + c.hh) * .5);
  if (m.hb_ !== undefined) m.hb_.scale.set(1, 1, 1);
}
const EMO_TEX = {};
function emoTex(ch) {
  if (EMO_TEX[ch]) return EMO_TEX[ch];
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  x.font = '92px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(ch, 64, 70);
  return EMO_TEX[ch] = new T.CanvasTexture(c);
}
const BUB = []; for (let i = 0; i < 8; i++) { const sp_ = new T.Sprite(new T.SpriteMaterial({ transparent: true, depthTest: false, fog: false })); sp_.visible = false; sp_.renderOrder = 20; sp_.userData = { l: 0 }; sc.add(sp_); BUB.push(sp_); }
function bubble(x, y, z, ch, life = 1.1) {
  if (ch === '💤') ch = 'Zzz'; else return;
  const s = BUB.find(b => !b.visible) || BUB[0]; s.material.map = emoTex(ch); s.material.needsUpdate = true; s.position.set(x, y, z);
  s.userData = { l: life, m: life, y0: y }; s.visible = true; s.material.opacity = 1; s.scale.set(.01, .01, 1);
}
function emote(b, ex, ch, hold = 1) { b.ex = ex; b.exT = hold; if (ch) bubble(b.x, b.y + 3.7, b.z, ch, Math.max(.9, hold)); }
const GIBS = [], gGeo = new T.IcosahedronGeometry(1, 1);
for (let i = 0; i < 40; i++) { const m = new T.Mesh(gGeo, new T.MeshStandardMaterial({ roughness: .6 })); m.visible = false; m.castShadow = true; m.userData = {}; sc.add(m); GIBS.push(m); }
function gib(x, y, z, vx, vy, vz, r, color, life = 4) {
  const m = GIBS.find(g => !g.visible); if (!m) return; m.material.color.set(color); m.position.set(x, y, z); m.scale.setScalar(r);
  m.userData = { vx, vy, vz, r, l: life, sx: rnd(-9, 9), sy: rnd(-9, 9), b: 0 }; m.visible = true;
}
function spawnGibs(b, kx, kz, headOnly) {
  const x = b.x, y = b.y;
  if (headOnly) { gib(x, y + 2.2, z0(b), kx * 3 + rnd(-1, 1), 8 + rnd(0, 3), kz * 3 + rnd(-1, 1), .5, b.col, 5); gib(x, y + 2.4, z0(b), rnd(-3, 3), 9, rnd(-3, 3), .42, 0x3b7a2b, 5); gib(x, y + 2.2, z0(b), rnd(-2, 2), 7, rnd(-2, 2), .26, 0xffffff, 4); gib(x, y + 2.2, z0(b), rnd(-2, 2), 7, rnd(-2, 2), .26, 0xffffff, 4); return; }
  for (let i = 0; i < 10; i++) gib(x + rnd(-.5, .5), y + rnd(.3, 1.6), b.z + rnd(-.5, .5), kx * rnd(2, 9) + rnd(-4, 4), rnd(4, 11), kz * rnd(2, 9) + rnd(-4, 4), rnd(.14, .34), b.col);
  gib(x, y + 1.8, b.z, rnd(-3, 3), 9, rnd(-3, 3), .45, b.col, 5); gib(x, y + 2, b.z, rnd(-3, 3), 10, rnd(-3, 3), .38, 0x3b7a2b, 5);
  gib(x, y + 1.8, b.z, rnd(-4, 4), 8, rnd(-4, 4), .26, 0xffffff, 5); gib(x, y + 1.8, b.z, rnd(-4, 4), 8, rnd(-4, 4), .26, 0xffffff, 5); gib(x, y + 1.2, b.z, rnd(-3, 3), 7, rnd(-3, 3), .22, 0x6b4a2a, 5);
}
const z0 = b => b.z;
const SFXP = []; for (let i = 0; i < 6; i++) { const m = new T.Mesh(new T.CylinderGeometry(.8, .8, 6, 24, 1, true), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, fog: false })); m.visible = false; m.userData = { t: 0 }; sc.add(m); SFXP.push(m); }
function spawnFx(x, y, z, col) { const m = SFXP.find(q => !q.visible) || SFXP[0]; m.material.color.set(col); m.position.set(x, y + 3, z); m.userData.t = 0; m.visible = true; puff(x, y + .3, z, col, 14, 5, .1, .7, 3); }
function ejectShell(shell) {
  const v = VM[P.w], p = new T.Vector3(); v.g.getWorldPosition(p);
  const r = new T.Vector3(1, 0, 0).applyQuaternion(cam.quaternion), u = new T.Vector3(0, 1, 0).applyQuaternion(cam.quaternion), f = new T.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
  const m = PA.find(q => !q.visible); if (!m) return; p.addScaledVector(r, .05).addScaledVector(f, .12).addScaledVector(u, .03); m.position.copy(p);
  m.material.color.set(shell ? 0xd9402a : 0xe6b84a); const sz = shell ? .045 : .028, l = .9;
  m.userData = { vx: r.x * 2.8 + rnd(-.4, .4), vy: u.y * 2.4 + 1.6, vz: r.z * 2.8 + rnd(-.4, .4), l, m: l, s: sz }; m.scale.setScalar(sz); m.visible = true;
  defer(() => snd('casing'), .28);
}
function makeWorm(col, name) {
  const g = new T.Group(), sk = MS(col, .5), segs = [];
  const sp = (r, x, y, z, m = sk, add = true) => { const o = new T.Mesh(new T.SphereGeometry(r, 28, 20), m); o.position.set(x, y, z); o.castShadow = true; if (add) g.add(o); return o; };
  const body = new T.Group(); g.add(body);
  [[.62, .62, 0], [.55, .5, -.8], [.46, .4, -1.45], [.36, .3, -2.05], [.26, .22, -2.5]].forEach((q, i) => { const s = sp(q[0], 0, q[1], q[2], sk, false); body.add(s); segs.push(s); });
  const head = new T.Group(); head.position.set(0, 1.6, .12); body.add(head); const hs_ = sp(.8, 0, 0, 0, sk, false); head.add(hs_);
  const w = MS(0xffffff, .12), bk = MS(0x14101a, .15), brw = MS(0x120c10, .35);
  const F = { brows: [], eyes: [], pupils: [], hl: [], xs: [] };
  for (const s of [-1, 1]) {
    const e = sp(.34, s * .34, .22, .62, w, false); head.add(e); F.eyes.push(e);
    const pu = sp(.15, s * .34, .22, .96, bk, false); head.add(pu); F.pupils.push(pu);
    const hl_ = sp(.055, s * .34 + .06, .32, 1.08, w, false); head.add(hl_); F.hl.push(hl_);
    const br = new T.Mesh(new T.SphereGeometry(.2, 14, 10), brw); br.scale.set(1.45, .62, .85); br.position.set(s * .32, .6, .74); head.add(br); F.brows.push([br, s]);
    const xg = new T.Group(); for (const a of [.785, -.785]) { const bar = new T.Mesh(new T.BoxGeometry(.5, .09, .06), bk); bar.rotation.z = a; xg.add(bar); } xg.position.set(s * .34, .22, 1.0); xg.visible = false; head.add(xg); F.xs.push(xg);
  }
  const mo = new T.Mesh(new T.TorusGeometry(.28, .06, 8, 20, Math.PI), MS(0x8a1030)); mo.position.set(0, -.3, .88); mo.rotation.z = Math.PI; head.add(mo); F.mouth = mo;
  const opn = new T.Group(); opn.position.set(0, -.3, .62); opn.visible = false; head.add(opn); F.open = opn;
  const cav = new T.Mesh(new T.SphereGeometry(.3, 20, 14), MS(0x3a0614, .5)); opn.add(cav);
  const lip = new T.Mesh(new T.TorusGeometry(.3, .05, 8, 28), MS(0xd9606e, .45)); lip.position.z = .08; opn.add(lip);
  const tg = new T.Mesh(new T.SphereGeometry(.17, 12, 10), MS(0xff7a98, .4)); tg.scale.set(1.1, .7, .9); tg.position.set(0, -.17, .06); opn.add(tg); F.tongue = tg;
  const shades = new T.Group(); shades.add(new T.Mesh(rbox(1.1, .3, .16, .05, 2), MS(0x0c0c14, .15, .6))); shades.position.set(0, .22, 1.08); shades.visible = false; head.add(shades); F.shades = shades;
  sk.emissive.set(0xffffff); sk.emissiveIntensity = 0;
  const chin = sp(.4, 0, -.64, .42, sk, false); chin.scale.set(1.15, .62, .95); head.add(chin); F.chin = chin;
  const tip = new T.Mesh(new T.ConeGeometry(.26, 1.0, 20), sk); tip.rotation.x = -Math.PI / 2; tip.position.set(0, 0, -.62); tip.castShadow = true; segs[4].add(tip); segs.push(tip);
  const belt = new T.Mesh(new T.CylinderGeometry(.66, .66, .16, 24), MS(0x6b4a2a)); belt.position.set(0, .78, 0); body.add(belt);
  // weapon held in front (swapped by bots)
  const gun = new T.Group(); gun.position.set(-.78, 1.0, .62); body.add(gun); const hand = sp(.17, -.62, .9, .1, sk, false); body.add(hand);
  // outline hull
  const ol = new T.MeshBasicMaterial({ color: 0x1a0a1e, side: T.BackSide }); [...segs, hs_, chin].forEach(s => { const o = new T.Mesh(s.geometry, ol); o.scale.setScalar(1.045); s.add(o); });
  g.scale.setScalar(.9);
  // name + health sprites
  const c = document.createElement('canvas'); c.width = 256; c.height = 64; const x = c.getContext('2d'); x.font = '700 34px system-ui,sans-serif'; x.textAlign = 'center'; x.lineWidth = 6; x.strokeStyle = 'rgba(20,6,30,.9)'; x.strokeText(name, 128, 42); x.fillStyle = '#fff'; x.fillText(name, 128, 42);
  const label = new T.Sprite(new T.SpriteMaterial({ map: new T.CanvasTexture(c), depthTest: false, transparent: true, fog: false })); label.scale.set(2.2, .55, 1); label.position.y = 3.35; label.renderOrder = 10; g.add(label);
  const hbBg = new T.Sprite(new T.SpriteMaterial({ color: 0x000000, depthTest: false, transparent: true, opacity: .55, fog: false })), hbFg = new T.Sprite(new T.SpriteMaterial({ color: 0x6bff6b, depthTest: false, transparent: true, fog: false }));
  hbBg.scale.set(1.5, .16, 1); hbBg.position.y = 3.0; hbFg.center.set(0, .5); hbFg.scale.set(1.44, .1, 1); hbFg.position.set(-.72, 3.0, 0); hbBg.renderOrder = 11; hbFg.renderOrder = 12; g.add(hbBg, hbFg);
  return { g, body, head, segs, gun, hbFg, hbBg, label, F, skin: sk, ph: Math.random() * 6.28, fc: { ...EXPR.neutral }, ft: EXPR.neutral };
}
function botGun(b, kind) {
  b.m.gun.clear(); const dark = MS(0x2a303b, .4, .8), wood = MS(0x7a4a26, .7);
  if (kind === 'uzi') { const m = new T.Mesh(rbox(.12, .16, .5, .03, 2), dark); m.position.z = .1; b.m.gun.add(m); const mg = new T.Mesh(rbox(.08, .3, .1, .02, 2), MS(0xff7a2a, .5)); mg.position.set(0, -.2, .05); b.m.gun.add(mg); }
  else { const br = new T.Mesh(new T.CylinderGeometry(.045, .045, 1.1, 12), dark); br.rotation.x = Math.PI / 2; br.position.z = .3; b.m.gun.add(br); const st = new T.Mesh(rbox(.12, .18, .5, .03, 2), wood); st.position.z = -.3; b.m.gun.add(st); }
}

/* ---------------- weapon definitions + first-person viewmodels ---------------- */
const WP = [
  { n: 'BAT', melee: 1, rate: .55, dmg: 55, range: 2.7 },
  { n: 'UZI', auto: 1, rate: .068, dmg: 10, spread: .028, ads: .008, mag: 32, reload: .65, range: 70, kick: .014, adsK: .6 },
  { n: 'SHOTGUN', pellets: 9, rate: .85, dmg: 12, spread: .08, ads: .052, mag: 6, reload: .3, range: 38, kick: .07, adsK: .75 }
];
// index 3 = goat (features.js), index 4 = TAIL (features.js)
const VM = [], vmRoot = new T.Group(); cam.add(vmRoot);
function hand(r = .05) { const m = new T.Mesh(new T.SphereGeometry(r, 18, 14), MS(0xe0409a, .5)); m.castShadow = false; return m; }
function mkMuz() { const g = new T.Group(); const mat = new T.MeshBasicMaterial({ color: 0xffd070, transparent: true, depthWrite: false, fog: false, blending: T.AdditiveBlending }); for (let i = 0; i < 3; i++) { const p = new T.Mesh(new T.PlaneGeometry(.34, .34), mat); p.rotation.z = i * Math.PI / 3; g.add(p); const q = p.clone(); q.rotation.y = Math.PI / 2; q.rotation.z = i * Math.PI / 3; g.add(q); } g.visible = false; return g; }
(function buildViewmodels() {
  const steel = MS(0x2a303b, .35, .85), dark = MS(0x14171d, .5, .6), lite = MS(0x707a8c, .35, .9), wood = MS(0x8a5328, .65), acc = MS(0xff7a2a, .45, .2, 0x401a00), tape = MS(0x1a1a22, .9);
  const add = (grp, geo, mat, x, y, z, rx = 0) => { const m = new T.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.x = rx; grp.add(m); return m; };
  // BAT
  { const g = new T.Group(), pv = new T.Group(); g.add(pv);
    const prof = [[.018, 0], [.02, .22], [.03, .4], [.045, .6], [.052, .78], [.05, .92], [.0, .94]].map(p => new T.Vector2(p[0], p[1]));
    const bat = new T.Mesh(new T.LatheGeometry(prof, 20), wood); bat.position.y = -.2; pv.add(bat); add(pv, new T.CylinderGeometry(.024, .024, .2, 14), tape, 0, -.1, 0);
    add(pv, new T.SphereGeometry(.03, 12, 10), wood, 0, -.21, 0); const h1 = hand(.045); h1.position.set(0, -.04, 0); pv.add(h1); const h2 = hand(.04); h2.position.set(0, .06, 0); pv.add(h2);
    VM[0] = { g, pv, hip: [.3, -.38, -.5], ads: [.3, -.38, -.5], rot: [-.45, .1, -.35], muz: null }; }
  // UZI
  { const g = new T.Group();
    add(g, rbox(.07, .1, .3, .018, 2), steel, 0, 0, -.12); add(g, rbox(.062, .036, .28, .014, 2), lite, 0, .067, -.13); add(g, new T.CylinderGeometry(.014, .014, .12, 12), dark, 0, .02, -.33, Math.PI / 2);
    add(g, rbox(.046, .17, .06, .012, 2), acc, 0, -.13, -.04); add(g, rbox(.056, .13, .07, .014, 2), dark, 0, -.1, .06, .22); add(g, new T.BoxGeometry(.012, .03, .012), dark, 0, .095, -.26); add(g, new T.BoxGeometry(.03, .03, .012), dark, 0, .095, -.02);
    const h1 = hand(.052); h1.position.set(.0, -.08, .07); g.add(h1); const h2 = hand(.05); h2.position.set(-.01, -.07, -.2); g.add(h2);
    const muz = mkMuz(); muz.position.set(0, .02, -.46); g.add(muz);
    VM[1] = { g, hip: [.24, -.22, -.5], ads: [0, -.088, -.5], rot: [0, 0, 0], muz, sightY: .09 }; }
  // SHOTGUN
  { const g = new T.Group();
    add(g, new T.CylinderGeometry(.024, .024, .75, 14), steel, 0, .03, -.46, Math.PI / 2); add(g, new T.CylinderGeometry(.021, .021, .6, 12), dark, 0, -.017, -.4, Math.PI / 2);
    add(g, rbox(.07, .1, .26, .016, 2), steel, 0, 0, -.06); const pump = add(g, rbox(.075, .058, .2, .02, 2), wood, 0, -.03, -.4);
    add(g, rbox(.06, .1, .36, .02, 2), wood, 0, -.035, .3, .12); add(g, new T.BoxGeometry(.012, .026, .012), lite, 0, .065, -.82); add(g, new T.BoxGeometry(.02, .02, .02), lite, 0, .07, -.18);
    const h1 = hand(.052); h1.position.set(0, -.08, .02); g.add(h1); const h2 = hand(.05); h2.position.set(0, -.06, -.4); g.add(h2);
    const muz = mkMuz(); muz.scale.setScalar(1.7); muz.position.set(0, .03, -.88); g.add(muz);
    VM[2] = { g, pump, hip: [.24, -.24, -.46], ads: [0, -.078, -.42], rot: [0, 0, 0], muz, sightY: .075 }; }
  VM.forEach(v => { v.g.visible = false; v.g.scale.setScalar(1); vmRoot.add(v.g); v.kick = 0; v.pos = new T.Vector3(...v.hip); });
})();

/* ---------------- game state ---------------- */
const S = { running: false, over: false, t: 0, limit: CFG.fragLimit, firstBlood: false, feed: [] };
const P = { x: 0, y: 0, z: 0, vx: 0, vz: 0, vy: 0, yaw: 0, pitch: 0, hp: 100, alive: true, ground: true, camStep: 0, w: 1, last: 2, ammo: [Infinity, 32, 6], cd: 0, reload: 0, swap: 0, swing: -1, swingHit: 0, ads: 0, bob: 0, step: 0, kills: 0, deaths: 0, streak: 0, lastKill: -99, rt: 0, name: 'YOU', recoil: 0, punch: 0, hurt: 0, sway: [0, 0], jx: 0, jy: 0, jrun: false, rollNow: 0, dodgeT: 0, dodgeDir: 0, dodgeFwd: 0, dodgeCD: 0, fovK: 0, sprintK: 0, faceOv: null, faceT: 0, faceCh: '', multi: 0 };
const KEYS = {}; let mouseL = false, mouseR = false, fireLatch = false, locked = false, NOLOCK = false;
const live = () => locked || DEMO || NOLOCK;
const later = []; const defer = (fn, t) => later.push({ fn, t: S.t + t });
const SPAWNS = []; for (let x = 2; x < NX - 2; x++) for (let z = 2; z < NZ - 2; z++) { const h = HT[x * NZ + z], wx = wxOf(x), wz = wzOf(z); if (h >= 3 && !BR[x * NZ + z] && !nearCastle(wx, wz, 4.6) && !onBridgeZone(wx, wz) && cellH(x + 1, z) > 0 && cellH(x - 1, z) > 0 && cellH(x, z + 1) > 0 && cellH(x, z - 1) > 0 && hs(x, z) > .6) SPAWNS.push([wx, wz]); }
function pickSpawn(avoid) { let best = null, bd = -1; for (let i = 0; i < 12; i++) { const s = SPAWNS[Math.random() * SPAWNS.length | 0]; let d = 99; for (const a of avoid) if (a.alive !== false && !a.dead) d = Math.min(d, Math.hypot(a.x - s[0], a.z - s[1])); if (d > bd) { bd = d; best = s; } } return best; }

/* ---------------- movement shared by player & bots ---------------- */
function pushOut(e, r = .4) {
  for (const c of COLL) { const dx = e.x - c.x, dz = e.z - c.z, d = Math.hypot(dx, dz), m = r + c.r; if (d < m && d > 1e-4 && e.y < gy(c.x, c.z) + 1.4) { e.x = c.x + dx / d * m; e.z = c.z + dz / d * m; } }
}
function tryMove(e, dx, dz, isP) {
  for (const ax of [0, 1]) {
    const nx = e.x + (ax === 0 ? dx : 0), nz = e.z + (ax === 1 ? dz : 0), gm = gmax(nx, nz, .3), rise = gm - e.y;
    if (rise <= (e.ground ? CFG.step : .1)) { if (gm > e.y + .02 && e.ground) { if (isP) e.camStep -= gm - e.y; e.y = gm; } e.x = nx; e.z = nz; }
  }
  pushOut(e);
}
function physics(e, dt, isP) {
  e.vy -= CFG.gravity * dt; e.y += e.vy * dt; const g = gmax(e.x, e.z, .3);
  if (e.y <= g) { if (isP && e.vy < -9) { snd('land', undefined, undefined, undefined, { surf: surfAt(e.x, e.z) }); P.punch = .5; voice('oof'); } e.y = g; e.vy = 0; e.ground = true; } else if (e.y > g + .06) e.ground = false;
  if (e.y < -5.5) return 'fell';
}

/* ---------------- player ---------------- */
function respawnPlayer() { const s = pickSpawn(BOTS); P.x = s[0]; P.z = s[1]; P.y = gy(P.x, P.z) + .01; P.vx = P.vz = P.vy = 0; P.hp = 100; P.alive = true; P.ammo = [Infinity, 32, 6, 0]; if (window.FT) FT.onRespawn(); P.reload = 0; P.cd = .3; P.camStep = 0; P.yaw = Math.atan2(P.x, P.z); P.pitch = 0; selectWeapon(1, true); snd('spawn'); hudHp(); hudAmmo(); setFaceOv('😮', .8); spawnFx(P.x, P.y, P.z, 0xffe3b0); }
function selectWeapon(i, force) { if (i === P.w && !force) return; if (P.reload > 0) { P.reload = 0; } if (!force) P.last = P.w; P.w = i; P.swap = .28; if (!force) snd('draw'); P.swing = -1; P.cd = Math.max(P.cd, .2); VM.forEach((v, k) => v.g.visible = k === i); document.querySelectorAll('#slots div').forEach(d => d.classList.toggle('on', +d.dataset.i === i)); hudAmmo(); }
let QM = null, QMW = 0; try { if (localStorage.getItem('wi_qmw') === '4') QMW = 4; } catch (e) {}
function quickMelee() {
  if (!S.running || !live() || !P.alive || P.ride || P.swing >= 0 || QM !== null) return;
  if (P.w === QMW) { P.cd = 0; fireWeapon(); return; }
  QM = P.w; selectWeapon(QMW, true); P.swap = 0; P.cd = 0; P.gch = null; fireWeapon();
}
function quickMeleeCycle() { QMW = QMW === 0 ? 4 : 0; try { localStorage.setItem('wi_qmw', QMW); } catch (e) {} feed('Quick melee (E): ' + (QMW === 4 ? 'TAIL STRIKE' : 'BASEBALL BAT')); snd('draw'); }
function quickMeleeEnd() { if (QM === null) return; if (!P.alive) { QM = null; return; } if (P.swing < 0) { const w = QM; QM = null; selectWeapon(w, true); P.swap = .1; snd('draw'); } }
function dirVec(yaw, pitch) { const c = Math.cos(pitch); return new T.Vector3(-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c); }
function spreadDir(d, s) { const a = rnd(0, 6.283), r = Math.sqrt(Math.random()) * s, up = new T.Vector3(0, 1, 0), rt = new T.Vector3().crossVectors(d, up).normalize(), u = new T.Vector3().crossVectors(rt, d).normalize(); return d.clone().addScaledVector(rt, Math.cos(a) * r).addScaledVector(u, Math.sin(a) * r).normalize(); }
function rayVsSphere(o, d, c, r) { const oc = new T.Vector3().subVectors(o, c), b = oc.dot(d), cc = oc.dot(oc) - r * r, disc = b * b - cc; if (disc < 0) return Infinity; const t = -b - Math.sqrt(disc); return t > 0 ? t : (-b + Math.sqrt(disc) > 0 ? 0 : Infinity); }
function wormSpheres(b) { const c = Math.cos(b.yaw), s = Math.sin(b.yaw); const fw = (k) => new T.Vector3(b.x + Math.sin(b.yaw) * 0 + (-Math.sin(b.yaw)) * 0, 0, 0); // placeholder replaced below
  const ax = -Math.sin(b.yaw), az = -Math.cos(b.yaw); // forward in world
  return { head: new T.Vector3(b.x + ax * .12, b.y + 1.5, b.z + az * .12), headR: .66, body: [new T.Vector3(b.x, b.y + .5, b.z), new T.Vector3(b.x - ax * .75, b.y + .42, b.z - az * .75), new T.Vector3(b.x - ax * 1.4, b.y + .32, b.z - az * 1.4)], bodyR: [.58, .5, .4] }; }
function shootRay(origin, dir, wp, extraDmg) {
  const wd = worldRay(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, wp.range); let best = wd, hit = null, head = false;
  for (const b of BOTS) { if (b.dead) continue; const sp = wormSpheres(b), th = rayVsSphere(origin, dir, sp.head, sp.headR * .9); if (th < best) { best = th; hit = b; head = true; } sp.body.forEach((c, i) => { const t = rayVsSphere(origin, dir, c, sp.bodyR[i]); if (t < best) { best = t; hit = b; head = false; } }); }
  let goat = null; if (window.FT) { const gr = FT.goatRay(origin, dir, best); if (gr) { best = gr.t; hit = null; head = false; goat = gr.g; } }
  return { t: best, hit, head, wallT: wd, goat };
}
function fireWeapon() {
  const wp = WP[P.w], v = VM[P.w]; P.cd = wp.rate;
  if (wp.melee) { P.swing = 0; P.swingHit = 1; snd(wp.tail ? 'tailStab' : 'batSwing'); if (window.NET && NET.on) NET.send('sw', { w: P.w }); return; }
  if (wp.goat) { FT.releaseGoat(); return; }
  if (P.ammo[P.w] <= 0) { snd('empty'); P.cd = .25; if (P.ammo[P.w] <= 0) startReload(); return; }
  P.ammo[P.w]--; hudAmmo(); aInit();
  const o = new T.Vector3(); cam.getWorldPosition(o); const base = dirVec(P.yaw, P.pitch + P.recoil * 0);
  const speed = Math.hypot(P.vx, P.vz), sp = (P.ads > .5 ? wp.ads : wp.spread) * (1 + speed * .06 + (P.ground ? 0 : 1.2)) * (1 - (P.cr || 0) * .25);
  const mp = new T.Vector3(); if (P.ride && window.FT) mp.copy(FT.rideMuzzle()); else if (v.muz) v.muz.getWorldPosition(mp); else mp.copy(o);
  let anyHit = false, anyHead = false;
  const n = wp.pellets || 1;
  for (let i = 0; i < n; i++) {
    const d = spreadDir(base, sp), r = shootRay(o, d, wp), end = o.clone().addScaledVector(d, r.t);
    if (n === 1 || i % 3 === 0) { tracer(mp, end, n > 1 ? .05 : .06); if (window.NET && NET.on) NET.fx(P.w, mp, end, i === 0); }
    if (r.goat) { FT.goatHit(r.goat, wp.dmg * (wp.pellets ? 1 - clamp(r.t / wp.range, 0, 1) * .75 : 1), P); anyHit = true; puff(end.x, end.y, end.z, 0xf5f0e6, 3, 3, .07, .5); }
    else if (r.hit) { const f = wp.pellets ? 1 - clamp(r.t / wp.range, 0, 1) * .75 : 1; damageBot(r.hit, wp.dmg * f * (r.head ? 2 : 1), P, wp.n, r.head); anyHit = true; anyHead = anyHead || r.head; puff(end.x, end.y, end.z, r.hit.col, 3, 3, .07, .5); }
    else if (r.t < wp.range - .5) { if (i % 2 === 0) { const sea_ = end.y < .3; snd('impact', end.x, end.y - 1.2, end.z, { mat: sea_ ? 'sea' : 'dirt' }); } const gcol = end.y > 1.2 ? 0x4fc230 : 0xb06d3c; puff(end.x, end.y, end.z, solidAt(end.x, end.y - .3, end.z) ? gcol : 0xcfe8ff, 3, 2, .05, .45); }
  }
  if (anyHit) hitMarker(anyHead);
  if (P.w === 1) ejectShell(false);
  snd(P.w === 1 ? 'uzi' : 'shotgun'); v.kick = Math.min(1.5, v.kick + (P.w === 1 ? .55 : 1)); P.recoil += wp.kick * (P.ads > .5 ? wp.adsK : 1); shake = Math.min(1, shake + (P.w === 2 ? .5 : .15));
  if (v.muz) { v.muz.visible = true; v.muz.rotation.z = rnd(6.28); v.muz.userData.t = .045; flashLight.position.copy(v.g.position).add(new T.Vector3(0, 0, -.5)); flashLight.intensity = P.w === 2 ? 6 : 3; }
  if (P.w === 2) { defer(() => { snd('pump'); v.pumpT = .38; ejectShell(true); }, .32); }
  if (P.ammo[P.w] <= 0 && P.w === 1) defer(() => { if (P.ammo[1] <= 0) startReload(); }, .15);
}
function startReload() { const wp = WP[P.w]; if (wp.melee || wp.goat || P.reload > 0 || P.ammo[P.w] >= wp.mag || !P.alive) return; P.reload = P.w === 2 ? .001 : wp.reload; P.reloadT = 0; if (P.w === 1) snd('reload'); P.ads = 0; }
function meleeHit() {
  if (WP[P.w].tail) { FT.tailStrike(); return; }
  const o = new T.Vector3(); cam.getWorldPosition(o); const f = dirVec(P.yaw, 0); let hit = null, bd = WP[0].range;
  for (const b of BOTS) { if (b.dead) continue; const dx = b.x - P.x, dz = b.z - P.z, d = Math.hypot(dx, dz); if (d > bd) continue; const ang = Math.acos(clamp((dx * f.x + dz * f.z) / (d || 1), -1, 1)); if (ang < .75 && Math.abs(b.y - P.y) < 2) { bd = d; hit = b; } }
  if (hit && hit.net) { const hr = dirVec(P.yaw, 0); NET.send('hr', { to: hit.peer, vx: +(hr.x * 42).toFixed(2), vz: +(hr.z * 42).toFixed(2), vy: 25 }); snd('batHit', hit.x, hit.y, hit.z); snd('headshot'); hitMarker(true); shake = 1; puff(hit.x, hit.y + 1.2, hit.z, 0xffe27a, 22, 7, .12, .8); P.punch = .45; announce('HOME RUN!'); feed('⚾ YOU ▸ ' + hit.name + ' [HOME RUN]'); }
  else if (hit) { const hr = dirVec(P.yaw, 0); hit.flinch = 1; hit.react = Math.max(hit.react, .5); hit.vx = hr.x * 42; hit.vz = hr.z * 42; hit.vy = 25; hit.ground = false; hit.homer = true; hit.homerT = 0; hit.tgt = null; snd('batHit', hit.x, hit.y, hit.z); snd('headshot'); hitMarker(true); shake = 1; puff(hit.x, hit.y + 1.2, hit.z, 0xffe27a, 22, 7, .12, .8); P.punch = .45; announce('HOME RUN!'); feed('⚾ YOU ▸ ' + hit.name + ' [HOME RUN]'); }
  else { const e = o.clone().addScaledVector(dirVec(P.yaw, P.pitch), 2.4), r = worldRay(o.x, o.y, o.z, ...dirVec(P.yaw, P.pitch).toArray(), 2.4); if (r < 2.3) { snd('batHit', undefined, undefined, undefined, { mat: 'rock' }); puff(o.x + f.x * r, o.y - .4, o.z + f.z * r, 0xb06d3c, 5, 3, .07, .5); shake = .3; } }
}
function hitMarker(head) { const h = $('hm'); h.classList.add('on'); h.classList.toggle('hd', !!head); clearTimeout(hitMarker.t); hitMarker.t = setTimeout(() => h.classList.remove('on'), 90); snd(head ? 'headshot' : 'hit'); }
function updatePlayer(dt) {
  P.dodgeCD = Math.max(0, P.dodgeCD - dt); P.faceT -= dt;
  const ads = mouseR && P.alive && !P.ride && P.reload <= 0 && WP[P.w].ads !== undefined && P.swap <= 0;
  P.ads = lerp(P.ads, ads ? 1 : 0, Math.min(1, dt * 14));
  if (!P.alive) P.tcr = false; P.cr = lerp(P.cr || 0, ((KEYS.KeyC || P.tcr) && P.alive && !P.ride && !P.rope) ? 1 : 0, Math.min(1, dt * 12));
  if (P.alive) {
    if (!P.ride) {
    const fw = (KEYS.KeyW ? 1 : 0) - (KEYS.KeyS ? 1 : 0) - P.jy, sd = (KEYS.KeyD ? 1 : 0) - (KEYS.KeyA ? 1 : 0) + P.jx, L = Math.hypot(fw, sd) || 1;
    const spd = 5.6 * ((KEYS.ShiftLeft || P.jrun) && fw > 0 && !ads && P.cr < .3 ? 1.5 : 1) * (1 - P.ads * .42) * (1 - P.cr * .45), fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw), rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw);
    const tx = (fx * fw + rx * sd) / Math.max(1, L) * spd, tz = (fz * fw + rz * sd) / Math.max(1, L) * spd, k = Math.min(1, dt * (P.ground ? 13 : 2.6));
    if (P.hr > 0) { P.hrAge = (P.hrAge || 0) + dt; if (P.ground && P.hrAge > .35) P.hr = 0; } else if (P.rope) { if (P.ground) { P.vx -= P.vx * k * .6; P.vz -= P.vz * k * .6; } } else { P.vx += (tx - P.vx) * k; P.vz += (tz - P.vz) * k; } if (window.FT) FT.ropeVel(dt);
    const jpr = KEYS.Space && !P.spacePrev; P.spacePrev = KEYS.Space; if (P.ground) P.airJump = false;
    if (KEYS.Space && P.ground) { P.vy = CFG.jump; P.ground = false; snd('jump'); voice('jump'); }
    else if (jpr && !P.ground && !P.airJump && !P.rope && !P.ride && P.alive) { P.airJump = true; P.vy = CFG.jump * .95; snd('jump', P.x, P.y, P.z, { pitch: 1.25 }); puff(P.x, P.y + .1, P.z, 0xffffff, 10, 3.5, .08, .45, .4); }
    tryMove(P, P.vx * dt, P.vz * dt, true);
    const sp = Math.hypot(P.vx, P.vz); if (P.ground && sp > 1) { P.bob += dt * sp * 1.9; P.step -= dt * sp; if (P.step <= 0) { const sf = surfAt(P.x, P.z); snd('step', undefined, undefined, undefined, { surf: sf }); snd('slither'); P.step = 2.2; } }
    } else FT.rideStep(dt);
    // weapon logic
    P.cd -= dt; P.swap -= dt; const wp = WP[P.w];
    if (P.reload > 0) {
      if (P.w === 1) { P.reloadT += dt; if (P.reloadT >= wp.reload) { P.ammo[1] = wp.mag; P.reload = 0; hudAmmo(); } }
      else { P.reload -= dt; if (P.reload <= 0) { if (P.ammo[2] < wp.mag) { P.ammo[2]++; snd('shell'); hudAmmo(); P.reload = wp.reload; if (mouseL && P.ammo[2] > 0) { P.reload = 0; } } else P.reload = 0; } }
    }
    if (mouseL && P.cd <= 0 && P.swap <= 0 && (P.reload <= 0 || (P.w === 2 && P.ammo[2] > 0)) && (wp.auto || !fireLatch)) { if (P.reload > 0) P.reload = 0; fireWeapon(); fireLatch = true; }
    if (!mouseL) fireLatch = false;
    if (P.swing >= 0) { const tl = WP[P.w].tail; P.swing += dt / (tl ? .26 : .42); if (P.swingHit && P.swing > (tl ? .45 : .38)) { P.swingHit = 0; meleeHit(); } if (P.swing >= 1) P.swing = -1; }
    quickMeleeEnd();
    if (P.w !== 0 && P.ammo[P.w] <= 0 && P.reload <= 0 && P.cd <= 0) startReload();
    // pickups
    for (const m of MEDS) if (m.on && Math.hypot(m.x - P.x, m.z - P.z) < 1.3 && Math.abs(m.y - P.y) < 2 && P.hp < 100) { m.on = false; m.t = 18; m.g.visible = false; if (window.NET) NET.send('mk', { i: MEDS.indexOf(m) }); P.hp = Math.min(100, P.hp + 45); hudHp(); snd('pickup'); setFaceOv('😋', 1); feed('+45 health'); }
  } else { P.rt -= dt; if (P.rt <= 0 && !S.over) respawnPlayer(); }
  if (!P.ride && !P.ski && physics(P, dt, true) === 'fell' && P.alive) { snd('splash'); if (S.t < (P.hrUntil || 0) && P.hrBy) killPlayer(P.hrBy, 'HOME RUN'); else killPlayer(null, 'the sea'); }
  if (window.FT) FT.ropePos(dt);
  P.camStep *= 1 - Math.min(1, dt * 14);
  P.recoil = Math.max(0, P.recoil - dt * .22 - P.recoil * dt * 6); P.punch = Math.max(0, P.punch - dt * 2.2); P.hurt = Math.max(0, P.hurt - dt * 1.6); hudFace();
}
function damagePlayer(dmg, by, wn) {
  if (!P.alive || S.over) return; P.hp -= dmg; P.hurt = 1; setFaceOv(P.hp < 25 ? '😱' : '😖', .5); hudHp(); snd('hurt', undefined, undefined, undefined, { dmg }); voice('hurt'); shake = Math.min(1, shake + .35);
  $('vig').style.boxShadow = 'inset 0 0 160px 40px rgba(255,40,40,.55)'; setTimeout(() => $('vig').style.boxShadow = 'inset 0 0 160px 40px rgba(255,40,40,0)', 140);
  if (window.FT) { FT.hitFeel(dmg, by, wn); FT.bloodMe(dmg, by); }
  if (P.hp <= 0) killPlayer(by, wn);
}
function killPlayer(by, wn) {
  if (window.FT) FT.onDeath(); if (window.NET && NET.on) NET.die(by, wn);
  P.alive = false; P.hp = 0; P.deaths++; P.streak = 0; P.rt = 2.6; hudHp(); snd('die'); voice(wn === 'the sea' || !by ? 'fall' : 'die'); mouseR = false;
  if (by) { by.kills++; feed(by.name + ' ▸ YOU' + (wn ? ' [' + wn + ']' : '')); } else { P.kills = Math.max(0, P.kills - 1); feed(wn === 'GRENADE' ? 'YOU blew yourself up' : wn === 'GOAT' ? 'YOU were gored by a goat' : 'YOU fell into ' + (wn || 'the sea')); BOTS.forEach(o => { if (!o.dead) emote(o, 'cool', '😂', 1.6); }); }
  if (by) { emote(by, 'cool', '😎', 2.4); defer(() => voice('laugh', by), .6); }
  scoreCheck();
}

/* ---------------- bots ---------------- */
const BOTS = [], BOT_DEFS = [['BLUBBER', 0x3fa0ff, 'uzi'], ['MARMALADE', 0xff9a3a, 'shotgun'], ['GRAPE', 0xa266ff, 'uzi'], ['PICKLE', 0x4cd964, 'shotgun'], ['WIGGLES', 0xff5a7a, 'uzi'], ['NOODLE', 0xffd84a, 'shotgun'], ['SQUIRM', 0x2fd6c8, 'uzi'], ['GOOBER', 0xb07a4a, 'shotgun']];
function addBot(i) { const d = BOT_DEFS[i]; { const m = makeWorm(d[1], d[0]); sc.add(m.g); const b = { name: d[0], col: d[1], kind: d[2], m, x: 0, y: 0, z: 0, vx: 0, vz: 0, vy: 0, yaw: 0, hp: 100, dead: true, rt: 1 + i * .8, ground: true, kills: 0, deaths: 0, burst: 0, bcd: 0, react: 0, tgt: null, ph: rnd(6.28), stuck: 0, camStep: 0, dodgeCD: 1, lean: 0, flinch: 0, flash: 0, land: 0, saw: false, hitT: 0, recent: 0, exT: 0, ex: null, kick: 0, burstT: 0, corpse: null, wasG: true, blink: rnd(2, 5), blinkT: 0 }; m.g.visible = false; botGun(b, d[2]); BOTS.push(b); spawnBot(b, true); } }
const nBots = () => BOTS.filter(b => !b.net).length;
function applyBots(n, persist) {
  n = clamp(n | 0, 0, BOT_DEFS.length);
  while (nBots() < n) { const used = new Set(BOTS.filter(b => !b.net).map(b => b.name)); addBot(Math.max(0, BOT_DEFS.findIndex(d => !used.has(d[0])))); }
  while (nBots() > n) { let k = -1; for (let i = BOTS.length - 1; i >= 0; i--) if (!BOTS[i].net) { k = i; break; } const b = BOTS.splice(k, 1)[0]; sc.remove(b.m.g); b.corpse = null; b.dead = true; }
  if (persist) { CFG.bots = n; try { localStorage.setItem('wi_bots', n); } catch (e) { } }
  const p = $('ovp'), bn = $('bn'), tot = BOTS.length + 1; if (p && !(window.NET && NET.on && NET.count)) p.textContent = tot + ' worm' + (BOTS.length ? 's' : '') + ', one floating island. First to the frag limit wins.'; if (bn) bn.textContent = persist || !(window.NET && NET.count) ? n : CFG.bots;
  if (window.FT && FT.onBots) FT.onBots(); scoreCheck();
}
function setBots(n) { applyBots(clamp(n | 0, 1, BOT_DEFS.length), true); }
function initBots() { let n = CFG.bots; try { const v = +localStorage.getItem('wi_bots'); if (v >= 1 && v <= BOT_DEFS.length) n = v; } catch (e) { } setBots(n); }
function spawnBot(b, first) { const s = pickSpawn([P, ...BOTS.filter(o => o !== b)]); b.x = s[0]; b.z = s[1]; b.y = gy(b.x, b.z) + .01; b.vx = b.vz = b.vy = 0; b.hp = 100; b.dead = false; b.react = .6; b.tgt = null; b.m.g.visible = true; b.m.g.scale.setScalar(.9); b.m.hbFg.scale.x = 1.44; b.m.hbFg.material.color.set(0x6bff6b); b.yaw = rnd(6.28);
  const m = b.m; b.corpse = null; m.body.rotation.set(0, 0, 0); m.body.scale.set(1, 1, 1); m.head.visible = true; m.head.scale.set(1, 1, 1); b.balloon = null; m.label.visible = m.hbBg.visible = m.hbFg.visible = true;
  b.dodgeCD = 1; b.lean = b.flinch = b.flash = b.land = b.hitT = b.recent = 0; b.saw = false; b.wasG = true;
  emote(b, 'surprised', '😮', .9); spawnFx(b.x, b.y, b.z, b.col); snd('spawn', b.x, b.y, b.z); voice('spawn', b); }
function killBot(b, by, wn, head, gibbed) {
  b.dead = true; b.rt = 3.2; b.deaths++; b.ex = null;
  const src = by || P, dx = b.x - src.x, dz = b.z - src.z, d = Math.hypot(dx, dz) || 1, kx = dx / d, kz = dz / d, m = b.m;
  snd(gibbed ? 'gib' : 'die', b.x, b.y, b.z); voice(gibbed ? 'hurt' : (by === P && wn === 'BAT') ? 'oof' : 'die', b); m.label.visible = m.hbBg.visible = m.hbFg.visible = false;
  if (gibbed) { spawnGibs(b, kx, kz, false); m.g.visible = false; b.corpse = null; shake = Math.min(1, shake + .25); }
  else {
    if (head) { spawnGibs(b, kx, kz, true); m.head.visible = false; }
    const bat = wn === 'BAT', sp = bat ? 10 : 4.5;
    b.corpse = { t: 0, vx: kx * sp, vy: bat ? 6.5 : 4, vz: kz * sp, spin: (Math.random() < .5 ? -1 : 1) * rnd(4, 8), landed: false, side: Math.random() < .5 ? -1 : 1, sq: 0 }; b.ground = false;
  }
  bubble(b.x, b.y + 3.2, b.z, gibbed ? '💀' : '😵', 1.4); puff(b.x, b.y + 1, b.z, b.col, gibbed ? 30 : 14, 7, .13, 1, 4);
}
function damageBot(b, dmg, by, wn, head) {
  if (b.dead || S.over) return;
  if (b.net) { if (wn !== 'GRENADE' && wn !== 'GOAT BLAST' && wn !== 'CRATE' && wn !== 'HOLY HAND GRENADE') NET.hit(b, dmg, wn, head); b.flash = 1; b.hitT = .7; b.flinch = 1; if (window.FT) FT.bloodBot(b, dmg, by, head); return; }
  b.recent = (S.t - (b.t0 || -9) < .2 ? b.recent : 0) + dmg; b.t0 = S.t;
  b.hp -= dmg; if (window.FT) FT.bloodBot(b, dmg, by, head); const f = clamp(b.hp / 100, 0, 1); b.m.hbFg.scale.x = 1.44 * f; b.m.hbFg.material.color.set(f > .5 ? 0x6bff6b : f > .25 ? 0xffd23a : 0xff4a3a);
  b.react = Math.max(b.react, .15); b.flinch = 1; b.flash = 1; b.hitT = .7;
  if (b.hp > 0) { b.ex = b.hp < 30 ? 'scared' : 'hurt'; b.exT = .35; if (S.t - (b.lastVox || -9) > .35) { b.lastVox = S.t; voice('hurt', b); } if (S.t - (b.lastBub || -9) > 1.4) { b.lastBub = S.t; bubble(b.x, b.y + 3.6, b.z, b.hp < 30 ? '😱' : '😖', .8); } return; }
  const gibbed = b.recent > 95 || (head && wn === 'SHOTGUN');
  killBot(b, by, wn, head, gibbed);
  if (by === P) {
    P.kills++; P.streak++; P.multi = (S.t - P.lastKill < 3.2) ? P.multi + 1 : 1; P.lastKill = S.t;
    feed('YOU ▸ ' + b.name + ' [' + wn + ']' + (gibbed ? ' GIBBED' : head ? ' HEADSHOT' : ''));
    const MULTI = ['', '', 'DOUBLE KILL!', 'MULTI KILL!', 'ULTRA KILL!', 'MONSTER KILL!'], SPREE = { 3: 'KILLING SPREE!', 5: 'RAMPAGE!', 7: 'DOMINATING!', 9: 'UNSTOPPABLE!', 11: 'GODLIKE!' };
    let line = null; if (P.multi >= 2) line = MULTI[Math.min(5, P.multi)]; else if (SPREE[P.streak]) line = SPREE[P.streak]; else if (!S.firstBlood) line = 'FIRST BLOOD!'; else if (head) line = 'HEADSHOT!';
    S.firstBlood = true; if (line) announce(line); setFaceOv('😎', 2);
  } else if (by) feed(by.name + ' ▸ ' + b.name);
  scoreCheck();
}
function homerStep(b, dt) {
  b.homerT += dt; b.x += b.vx * dt; b.z += b.vz * dt; b.vx *= 1 - .03 * dt; b.vz *= 1 - .03 * dt;
  const r = physics(b, dt, false);
  puff(b.x, b.y + 1, b.z, 0xffe27a, 1, 1.2, .1, .55); if (Math.random() < .5) puff(b.x, b.y + 1, b.z, 0xffffff, 1, 1.5, .07, .5);
  if (r === 'fell') {
    b.homer = false; snd('splash', b.x, SEA_Y, b.z); puff(b.x, SEA_Y + .2, b.z, 0xcfe8ff, 16, 5, .12, .8, 5);
    b.dead = true; b.rt = 2; b.m.g.visible = false; b.deaths++; b.corpse = null; b.m.g.rotation.x = 0; bubble(b.x, 0, b.z, '😱', 1);
    P.kills++; P.streak++; P.multi = (S.t - P.lastKill < 3.2) ? P.multi + 1 : 1; P.lastKill = S.t; feed('YOU ▸ ' + b.name + ' [HOME RUN] — into the sea'); setFaceOv('😎', 2); S.firstBlood = true; scoreCheck(); return;
  }
  if (b.ground && b.homerT > .3) { b.homer = false; b.vx = b.vz = 0; b.m.g.rotation.x = 0; snd('land', b.x, b.y, b.z); puff(b.x, b.y + .2, b.z, 0xcbb892, 10, 3, .1, .6); }
}
function botThink(b, dt) {
  if (b.net) return;
  if (b.dead) { b.homer = false; b.rt -= dt; if (b.rt <= 0 && !S.over) spawnBot(b); return; }
  if (b.homer) { homerStep(b, dt); return; }
  if (window.FT && FT.frozen(b)) return;
  if (window.FT) FT.botGoat(b, dt);
  const dx = P.x - b.x, dz = P.z - b.z, dist = Math.hypot(dx, dz); let see = false;
  if (P.alive && dist < 36) see = !losBlocked(b.x, b.y + 1.4, b.z, P.x, P.y + 1.2, P.z);
  let fw = 0, sd = 0; const spd = 3.7;
  b.dodgeCD -= dt; b.hitT = Math.max(0, b.hitT - dt);
  if (see && !b.saw && S.t - (b.lastEmo || -9) > 4) { emote(b, 'angry', '😠', 1.0); b.lastEmo = S.t; voice('taunt', b); } b.saw = see;
  if (see && b.ground && b.dodgeCD <= 0 && (b.hitT > 0 ? Math.random() < dt * 3 : Math.random() < dt * .3)) botDodge(b);
  else if (see && b.ground && Math.random() < dt * .45) { b.vy = CFG.jump * .82; b.ground = false; }
  if (see) {
    const want = Math.atan2(-dx, -dz); let da = want - b.yaw; da = Math.atan2(Math.sin(da), Math.cos(da)); b.yaw += clamp(da, -dt * 4.4, dt * 4.4);
    b.react -= dt; const kind = b.kind;
    if (dist > 13) fw = 1; else if (dist < 5) fw = -.6; sd = Math.sin(S.t * 1.2 + b.ph) * .9;
    if (b.react <= 0 && Math.abs(da) < .22) {
      b.bcd -= dt;
      if (kind === 'uzi' && dist < 32) { if (b.bcd <= 0) { botShoot(b, 1, .045, 5.5); b.burst++; b.bcd = b.burst % 9 === 0 ? 1.0 : .11; } }
      else if (kind === 'shotgun' && dist < 15) { if (b.bcd <= 0) { botShoot(b, 8, .09, 7); b.bcd = 1.35; } }
      else if (kind === 'shotgun') fw = 1;
    }
    if (FT.crossing(b)) { const wp = FT.navT(b, [P.x, P.z]), mx = wp[0] - b.x, mz = wp[1] - b.z, ml = Math.hypot(mx, mz) || 1; fw = (mx * -Math.sin(b.yaw) + mz * -Math.cos(b.yaw)) / ml; sd = (mx * Math.cos(b.yaw) + mz * -Math.sin(b.yaw)) / ml; }
  } else {
    if (!b.tgt || Math.hypot(b.tgt[0] - b.x, b.tgt[1] - b.z) < 1.5 || b.stuck > 1.2) { b.tgt = null; for (let i = 0; i < 8; i++) { const s = SPAWNS[Math.random() * SPAWNS.length | 0]; if (Math.hypot(s[0] - b.x, s[1] - b.z) > 5) { b.tgt = s; break; } } b.stuck = 0; if (!b.tgt) b.tgt = [0, 0]; }
    const wp = FT.navT(b, b.tgt), want = Math.atan2(-(wp[0] - b.x), -(wp[1] - b.z)); let da = want - b.yaw; da = Math.atan2(Math.sin(da), Math.cos(da)); b.yaw += clamp(da, -dt * 3, dt * 3); fw = Math.abs(da) < 1 ? 1 : .2; b.react = .55;
  }
  FT.botGren(b, see, dist, dt); { const fl = FT.botFlee(b); if (fl) { fw = fl[0]; sd = fl[1]; } }
  const fx = -Math.sin(b.yaw), fz = -Math.cos(b.yaw), rx = Math.cos(b.yaw), rz = -Math.sin(b.yaw), L = Math.hypot(fw, sd) || 1, k = Math.min(1, dt * (b.ground ? 12 : 2.4));
  b.vx += ((fx * fw + rx * sd) / L * spd * Math.min(1, L) - b.vx) * k; b.vz += ((fz * fw + rz * sd) / L * spd * Math.min(1, L) - b.vz) * k;
  const px = b.x, pz = b.z; const ahead = gmax(b.x + b.vx * .35, b.z + b.vz * .35, .3);
  if (ahead === -Infinity) { b.vx *= -.2; b.vz *= -.2; b.tgt = null; } else if (ahead - b.y > CFG.step && b.ground && ahead - b.y < 2.6) { b.vy = CFG.jump; b.ground = false; }
  tryMove(b, b.vx * dt, b.vz * dt, false);
  if (Math.hypot(b.x - px, b.z - pz) < dt * .5 && fw > 0) b.stuck += dt; else b.stuck = Math.max(0, b.stuck - dt);
  // keep bots apart + away from the player
  for (const o of [P, ...BOTS]) { if (o === b || o.dead || o.alive === false) continue; const ox = b.x - o.x, oz = b.z - o.z, d = Math.hypot(ox, oz); if (d < 1.1 && d > 1e-3) { b.x += ox / d * (1.1 - d) * .5; b.z += oz / d * (1.1 - d) * .5; } }
  if (physics(b, dt, false) === 'fell') { b.dead = true; b.rt = 2; b.m.g.visible = false; b.deaths++; b.corpse = null; bubble(b.x, 0, b.z, '😱', 1); feed(b.name + ' fell into the sea'); }
}
function botDodge(b) {
  const dir = Math.random() < .5 ? -1 : 1, rx = Math.cos(b.yaw), rz = -Math.sin(b.yaw);
  b.vx = rx * dir * 10; b.vz = rz * dir * 10; b.vy = 4.5; b.ground = false; b.lean = dir; b.dodgeCD = 1.6 + Math.random(); snd('dodge', b.x, b.y, b.z);
}
function botShoot(b, pellets, spread, dmg) {
  b.kick = 1; b.burstT = .45;
  const o = new T.Vector3(b.x, b.y + 1.4, b.z), tgt = new T.Vector3(P.x, P.y + 1.1 - (P.cr || 0) * .5, P.z), d0 = tgt.clone().sub(o), dist = d0.length(); d0.normalize();
  snd(b.kind === 'uzi' ? 'uzi' : 'shotgun', b.x, b.y, b.z);
  const mp = o.clone().addScaledVector(new T.Vector3(-Math.sin(b.yaw), 0, -Math.cos(b.yaw)), 1.2).add(new T.Vector3(Math.cos(b.yaw) * -.6, -.3, -Math.sin(b.yaw) * -.6)); let hits = 0;
  for (let i = 0; i < pellets; i++) {
    const d = spreadDir(d0, spread + dist * .0016), t = rayVsSphere(o, d, tgt, .62), wd = worldRay(o.x, o.y, o.z, d.x, d.y, d.z, 60);
    const end = o.clone().addScaledVector(d, Math.min(t < Infinity ? t : wd, wd)); if (i % 3 === 0) tracer(mp, end, .06);
    if (t < Infinity && t < wd) hits++;
  }
  if (AU && !hits) { const hd = new T.Vector3(P.x, P.y + 1.5 - (P.cr || 0) * .6, P.z), k = hd.clone().sub(o).dot(d0); if (k > 3 && k < 60) { const cp = o.clone().addScaledVector(d0, k), off = cp.distanceTo(hd); if (off < 4.5) snd('whiz', cp.x, cp.y - 1.2, cp.z); } }
  if (hits) damagePlayer(dmg * hits * (pellets > 1 ? 1 : 1), b, b.kind.toUpperCase());
}
function botFace(b) {
  let ex = 'neutral';
  if (b.dead) ex = 'dead'; else if (b.paused) ex = 'sleep'; else if (b.exT > 0 && b.ex) ex = b.ex; else if (b.burstT > 0) ex = 'rage'; else if (b.flinch > .2) ex = b.hp < 30 ? 'scream' : 'hurt'; else if (b.hp < 30) ex = 'scared'; else if (b.saw) ex = 'angry'; else if (b.hp < 60) ex = 'worried';
  b.m.ft = EXPR[ex];
}
function animateBots(dt) {
  for (const b of BOTS) {
    const m = b.m;
    b.flinch = Math.max(0, b.flinch - dt * 5); b.flash = Math.max(0, b.flash - dt * 7); b.kick = Math.max(0, b.kick - dt * 7); b.burstT -= dt; b.exT -= dt; b.land = Math.max(0, b.land - dt * 5); b.lean *= 1 - Math.min(1, dt * 6);
    m.skin.emissiveIntensity = b.flash * .9; b.blink -= dt; if (b.blink <= 0) { b.blinkT = .13; b.blink = rnd(2, 5); } b.blinkT -= dt;
    botFace(b); applyFace(m, dt, b.blinkT > 0 && !b.dead);
    if (b.dead && !b.corpse) continue;
    m.g.position.set(b.x, b.y, b.z); m.g.rotation.y = b.yaw + Math.PI; m.g.rotation.x = b.homer ? b.homerT * 16 : 0;
    if (!b.dead && b.ground && AU) { const mv = Math.hypot(b.x - (b.px === undefined ? b.x : b.px), b.z - (b.pz === undefined ? b.z : b.pz)); b.stp = (b.stp || 0) - mv; if (b.stp <= 0) { b.stp = 2.2; snd('step', b.x, b.y, b.z, { surf: surfAt(b.x, b.z) }); } } b.px = b.x; b.pz = b.z;
    if (b.dead) { // ragdoll-ish corpse: flies, tumbles, lands on its side, shrinks away
      const c = b.corpse; c.t += dt;
      if (!c.landed) {
        c.vy -= 24 * dt; b.x += c.vx * dt; b.y += c.vy * dt; b.z += c.vz * dt; const g = ground(b.x, b.z);
        if (g > -Infinity && b.y <= g) { b.y = g; if (c.vy < -3) { snd('land', b.x, b.y, b.z); puff(b.x, b.y + .2, b.z, 0xb06d3c, 5, 3, .07, .4); c.sq = 1; } c.vy = -c.vy * .3; c.vx *= .55; c.vz *= .55; if (Math.abs(c.vy) < 1.6) { c.landed = true; const rx = m.body.rotation.x; m.body.rotation.x = ((rx + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; } }
        else if (b.y < -6) { m.g.visible = false; continue; }
        if (!c.landed) m.body.rotation.x += c.spin * dt;
      } else { m.body.rotation.x *= 1 - Math.min(1, dt * 8); m.body.rotation.z += (c.side * 1.45 - m.body.rotation.z) * Math.min(1, dt * 8); }
      c.sq = Math.max(0, c.sq - dt * 4); m.body.scale.set(1 + c.sq * .15, 1 - c.sq * .25, 1 + c.sq * .15);
      m.g.position.set(b.x, b.y, b.z); m.g.scale.setScalar(.9 * clamp(b.rt / .7, 0, 1)); continue;
    }
    const sp = Math.hypot(b.vx, b.vz), ph = S.t * (3 + sp * 2) + b.ph;
    m.segs.forEach((s, i) => { if (i > 4) return; s.position.x = Math.sin(ph - i * .9) * .12 * (.4 + sp * .25); s.position.y = [.62, .5, .4, .3, .22][i] + Math.max(0, Math.sin(ph * 1.5 - i)) * .06 * Math.min(1, sp); });
    if (b.wasG === false && b.ground) b.land = 1; b.wasG = b.ground;
    const st = b.ground ? 0 : clamp(b.vy * .02, -.1, .16), sq = b.land * .18;
    m.body.scale.set(1 - st * .5 + sq * .6, 1 + st - sq, 1 - st * .5 + sq * .6);
    m.body.rotation.x = Math.min(.14, sp * .035) - b.flinch * .45; m.body.rotation.z = b.lean * .5;
    if (b.ride) { m.body.scale.y *= .6; m.g.position.y += .45; }
    m.head.rotation.x = -b.flinch * .35; m.gun.position.z = .62 - b.kick * .18;
    m.head.position.y = 1.6 + Math.sin(S.t * 2 + b.ph) * .03; m.head.rotation.y = Math.sin(S.t * .8 + b.ph) * .1;
    m.label.quaternion.copy(cam.quaternion);
  }
}

/* ---------------- pickups ---------------- */
const MEDS = []; (function () { const pts = []; for (const q of SPAWNS) { if (pts.length < 9 && pts.every(o => Math.hypot(o[0] - q[0], o[1] - q[1]) > 15)) pts.push(q); } pts.forEach(p => { const g = new T.Group(); const b = new T.Mesh(rbox(.6, .6, .6, .1, 2), MS(0xffffff, .4)); g.add(b); const r = MS(0xff3a4a, .4, 0, 0x550010); const a = new T.Mesh(new T.BoxGeometry(.64, .2, .2), r), c = new T.Mesh(new T.BoxGeometry(.2, .64, .2), r), d = new T.Mesh(new T.BoxGeometry(.2, .2, .64), r); g.add(a, c, d); b.castShadow = true; const y = gy(p[0], p[1]); g.position.set(p[0], y + .9, p[1]); sc.add(g); MEDS.push({ x: p[0], z: p[1], y, g, on: true, t: 0 }); }); })();

/* ---------------- HUD / match ---------------- */
const EMJ = { '😮': 'surprised', '😋': 'happy', '😱': 'scream', '😖': 'hurt', '😎': 'cool', '😵': 'dead', '😠': 'angry', '😈': 'cool', '🙂': 'neutral', '😐': 'flat', '😬': 'worried' };
function setFaceOv(ch, t) { P.faceOv = EMJ[ch] || ch; P.faceT = t; }
const HF = { fc: { ...EXPR.neutral }, name: '', els: null };
function hudFaceInit() {
  const f = $('face'); if (!f || HF.els) return; const N = 'http://www.w3.org/2000/svg', mk = (t, a, p) => { const e = document.createElementNS(N, t); for (const k in a) e.setAttribute(k, a[k]); (p || sv).appendChild(e); return e; };
  const sv = document.createElementNS(N, 'svg'); sv.setAttribute('viewBox', '-52 -52 104 104'); sv.setAttribute('width', '46'); sv.setAttribute('height', '46'); sv.style.overflow = 'visible'; f.appendChild(sv);
  const E = { head: mk('ellipse', { rx: 44, ry: 44, fill: '#f2a07c', stroke: '#2a0e22', 'stroke-width': 5 }) };
  E.cav = mk('ellipse', { cx: 0, cy: 22, rx: 1, ry: 1, fill: '#3a0614' }); E.tg = mk('ellipse', { cx: 0, cy: 30, rx: 10, ry: 6, fill: '#ff7a98' }); E.smile = mk('path', { d: '', fill: 'none', stroke: '#8a1030', 'stroke-width': 6, 'stroke-linecap': 'round' });
  E.eyes = [-1, 1].map(s => { const w = mk('ellipse', { cx: s * 18, cy: -8, rx: 14, ry: 16, fill: '#fff', stroke: '#2a0e22', 'stroke-width': 3 }), p = mk('ellipse', { cx: s * 18, cy: -6, rx: 7, ry: 7, fill: '#14101a' }), h = mk('circle', { cx: s * 18 + 3, cy: -11, r: 2.6, fill: '#fff' }); return { w, p, h, s }; });
  E.brows = [-1, 1].map(s => ({ b: mk('rect', { x: -15, y: -4, width: 30, height: 8, rx: 4, fill: '#1a1014' }), s }));
  E.xs = mk('path', { d: 'M-27-18L-9 2M-9-18L-27 2M9-18L27 2M27-18L9 2', stroke: '#14101a', 'stroke-width': 5, 'stroke-linecap': 'round', fill: 'none' }); E.sh = mk('rect', { x: -38, y: -20, width: 76, height: 22, rx: 8, fill: '#0c0c14' });
  HF.els = E;
}
function hudFaceDraw(t, dt) {
  const E = HF.els; if (!E) return; const c = HF.fc, k = Math.min(1, dt * 14); for (const key of FKEYS) c[key] += (t[key] - c[key]) * k;
  const xe = !!t.xe, ey = c.ey;
  E.head.setAttribute('rx', 44 * c.hw); E.head.setAttribute('ry', 44 * c.hh);
  E.eyes.forEach(e => { e.w.setAttribute('rx', 14 * c.ex); e.w.setAttribute('ry', 16 * ey); e.p.setAttribute('rx', 7 * c.pk); e.p.setAttribute('ry', 7 * c.pk * Math.min(1, ey * 1.6)); e.p.style.display = xe ? 'none' : ''; e.h.style.display = xe || ey < .5 ? 'none' : ''; });
  E.brows.forEach(b => { b.b.setAttribute('transform', 'translate(' + b.s * 18 + ',' + (-24 - (c.by - .45) * 40) + ') rotate(' + (c.brow * b.s * 57) + ')'); });
  const open = c.oy > .08; E.cav.style.display = E.tg.style.display = open ? '' : 'none'; E.smile.style.display = open ? 'none' : '';
  E.cav.setAttribute('rx', 20 * Math.max(.05, c.ox)); E.cav.setAttribute('ry', 14 * Math.max(.05, c.oy)); E.cav.setAttribute('cy', 20 + 5 * c.oy); E.tg.setAttribute('rx', 11 * Math.max(.2, c.ox)); E.tg.style.display = open && c.ln > .3 ? '' : 'none'; E.tg.setAttribute('cy', 20 + 12 * c.oy);
  E.smile.setAttribute('d', 'M-16 22Q0 ' + (22 + c.smile * 24) + ' 16 22'); E.xs.style.display = xe ? '' : 'none'; E.sh.style.display = t.sh ? '' : 'none';
}
function hudFace() {
  hudFaceInit(); let n; if (!P.alive) n = 'dead'; else if (P.faceT > 0 && P.faceOv) n = P.faceOv; else n = P.hp > 80 ? (P.streak >= 3 ? 'cool' : 'neutral') : P.hp > 55 ? 'flat' : P.hp > 35 ? 'worried' : P.hp > 15 ? 'hurt' : 'scared';
  if (n !== HF.name) { HF.name = n; const f = $('face'); f.classList.remove('pop'); void f.offsetWidth; f.classList.add('pop'); }
  hudFaceDraw(EXPR[n] || EXPR.neutral, 1 / 60);
}
function feed(txt) { const d = document.createElement('div'); d.textContent = txt; $('feed').appendChild(d); setTimeout(() => d.remove(), 5200); while ($('feed').children.length > 5) $('feed').firstChild.remove(); }
function hudHp() { if (AU) AU.setHealth(P.hp / 100, P.alive); $('hpn').textContent = Math.max(0, Math.ceil(P.hp)); $('hpb').style.width = clamp(P.hp, 0, 100) + '%'; }
function hudAmmo() { hudAmmoBase(); if (window.FT) FT.hud(); }
function hudAmmoBase() { const wp = WP[P.w]; $('wn').textContent = wp.n; $('tswap').textContent = wp.n === 'SHOTGUN' ? 'SHOT' : wp.n; if (wp.melee) { $('an').textContent = '∞'; $('ar').textContent = wp.tail ? 'STRIKE WITH LEFT CLICK' : 'SWING WITH LEFT CLICK'; } else { $('an').textContent = P.ammo[P.w]; $('ar').textContent = P.reload > 0 ? 'RELOADING…' : (P.ammo[P.w] < wp.mag ? 'RELOAD [R]' : (P.w === 1 ? 'FULL AUTO' : 'PUMP ACTION')); } }
function scoreboard() { const rows = [{ name: 'YOU', k: P.kills, d: P.deaths }, ...BOTS.map(b => ({ name: b.name, k: b.kills, d: b.deaths }))].sort((a, b) => b.k - a.k); return '<table><tr><th>WORM</th><th>FRAGS</th><th>DEATHS</th></tr>' + rows.map(r => `<tr><td>${r.name}</td><td>${r.k}</td><td>${r.d}</td></tr>`).join('') + '</table>'; }
function scoreCheck() {
  const best = Math.max(...BOTS.map(b => b.kills)); $('sc').textContent = P.kills + ' / ' + S.limit; $('sc2').textContent = 'BEST BOT ' + best + ' · FRAG LIMIT ' + S.limit;
  const left = S.limit - Math.max(P.kills, best); if (S.running && !S.over && left !== S.left) { if (S.left !== undefined && left > 0 && left <= 3) defer(() => announce(left === 1 ? 'ONE FRAG LEFT' : (left === 2 ? 'TWO' : 'THREE') + ' FRAGS LEFT', false), 1.8); S.left = left; }
  if (!S.over && (P.kills >= S.limit || best >= S.limit)) { S.over = true; const win = P.kills >= S.limit; setTimeout(() => { if (document.pointerLockElement) document.exitPointerLock(); $('ov').style.display = 'flex'; $('res').textContent = win ? 'VICTORY!' : 'DEFEATED'; $('ovp').innerHTML = scoreboard(); $('play').textContent = 'PLAY AGAIN'; announce(win ? 'YOU WIN' : 'YOU LOSE', false); }, 1400); }
}
function resetMatch() { const wasOver = S.over; S.over = false; S.firstBlood = false; P.kills = P.deaths = P.streak = 0; BOTS.forEach(b => { b.kills = b.deaths = 0; if (!b.net) spawnBot(b); }); if (window.NET && NET.on && wasOver && !NET.silent) NET.send('rs'); MEDS.forEach(m => { m.on = true; m.g.visible = true; }); if (window.FT) FT.reset(); respawnPlayer(); S.left = undefined; scoreCheck(); $('res').textContent = ''; announce('PREPARE FOR BATTLE', false); defer(() => announce('PLAY!'), 2.2); $('ovp').textContent = 'Four worms, one floating island. First to the frag limit wins.'; }

/* ---------------- input ---------------- */
const TAP = {};
function tryDodge(code) {
  if (P.ride || !P.alive || !P.ground || P.dodgeCD > 0 || S.over) return;
  const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw), rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw); let dx, dz, side = 0, fwd = 0;
  if (code === 'KeyW') { dx = fx; dz = fz; fwd = 1; } else if (code === 'KeyS') { dx = -fx; dz = -fz; fwd = -1; } else if (code === 'KeyA') { dx = -rx; dz = -rz; side = 1; } else { dx = rx; dz = rz; side = -1; }
  P.vx = dx * 13; P.vz = dz * 13; P.vy = 4.8; P.ground = false; P.dodgeCD = .8; P.dodgeT = .55; P.dodgeDir = side; P.dodgeFwd = fwd; P.fovK = fwd > 0 ? 12 : 6; snd('dodge');
}
addEventListener('keydown', e => {
  if (S.running && ['Space','Tab','ArrowUp','ArrowDown'].includes(e.code)) e.preventDefault();
  if (e.code === 'Escape' && NOLOCK && S.running && !S.over) pauseGame();
  if (e.repeat) return; KEYS[e.code] = true;
  if (S.running && P.alive && ['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) { const n = performance.now(); if (n - (TAP[e.code] || 0) < 260) tryDodge(e.code); TAP[e.code] = n; }
  if (e.code === 'Tab') { e.preventDefault(); $('sb').innerHTML = scoreboard(); $('sb').style.display = 'block'; }
  if (!S.running) return;
  if (e.code === 'Digit1') selectWeapon(0); if (e.code === 'Digit2') selectWeapon(1); if (e.code === 'Digit3') selectWeapon(2);
  if (e.code === 'KeyV' && !e.repeat && S.running) quickMeleeCycle(); if (e.code === 'KeyQ') selectWeapon(P.last); if (e.code === 'KeyR') startReload();
  if (e.code === 'Digit4') FT.goatSelect(); if (e.code === 'Digit5') selectWeapon(4); if (e.code === 'KeyG') FT.gStart(); if (e.code === 'KeyH' && !e.repeat && window.FT) FT.holyThrow(); if (e.code === 'KeyF') FT.rope(); if (e.code === 'KeyE' && !e.repeat) { if (P.ride || FT.jetNear()) FT.use(); else quickMelee(); }
});
addEventListener('keyup', e => { KEYS[e.code] = false; if (e.code === 'KeyG' && window.FT) FT.gEnd(); if (e.code === 'Tab') $('sb').style.display = 'none'; });
addEventListener('mousedown', e => { if (!S.running || !live()) return; aInit(); if (e.button === 0) mouseL = true; if (e.button === 2) mouseR = true; });
addEventListener('mouseup', e => { if (e.button === 0) mouseL = false; if (e.button === 2) mouseR = false; });
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('wheel', e => { if (!S.running) return; selectWeapon(e.deltaY > 0 ? FT.nextWeapon() : FT.prevWeapon()); });
let SENSM = 1; try { const v = parseFloat(localStorage.getItem('wi_sens')); if (v >= .2 && v <= 4) SENSM = v; } catch (e) {}
function sensShow() { const el = $('sensfx'); if (!el) return; const f = Math.log(SENSM / .2) / Math.log(4 / .2); el.querySelector('i').style.width = (f * 100).toFixed(1) + '%'; el.querySelector('b').textContent = SENSM.toFixed(2) + '×'; el.classList.add('on'); clearTimeout(sensShow.t); sensShow.t = setTimeout(() => el.classList.remove('on'), 1300); }
function sensStep(d) { SENSM = clamp(Math.round(SENSM * Math.pow(1.12, d) * 100) / 100, .2, 4); try { localStorage.setItem('wi_sens', SENSM); } catch (e) {} sensShow(); snd('hit', undefined, undefined, undefined, { vol: .25, pitch: 1 + d * .12 }); }
addEventListener('keydown', e => { if (e.repeat && false) return; if (e.key === '+' || e.key === '=') sensStep(1); else if (e.key === '-' || e.key === '_') sensStep(-1); else if (window.FT && S.running && (e.key === '[' || e.code === 'BracketLeft')) FT.fuseStep(-1); else if (window.FT && S.running && (e.key === ']' || e.code === 'BracketRight')) FT.fuseStep(1); });
addEventListener('mousemove', e => { if (!S.running || !P.alive || !live()) return; const k = CFG.sens * SENSM * (1 - P.ads * .45); P.yaw -= e.movementX * k; P.pitch = clamp(P.pitch - e.movementY * k, -1.45, 1.45); P.sway[0] = clamp(P.sway[0] + e.movementX * .0004, -.05, .05); P.sway[1] = clamp(P.sway[1] + e.movementY * .0004, -.05, .05); });
document.addEventListener('pointerlockerror', () => { NOLOCK = true; });
document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === cv; if (!locked && !NOLOCK && S.running && !S.over) { $('ov').style.display = 'flex'; $('play').textContent = 'RESUME'; mouseL = mouseR = false; } });
function startPlay() { aInit(); if (AC && AC.state === 'suspended') AC.resume(); $('ov').style.display = 'none'; if (!S.running) { S.running = true; resetMatch(); } else if (S.over) resetMatch(); NOLOCK = TOUCH; try { if (!DEMO && !TOUCH) { const r = cv.requestPointerLock(); if (r && r.catch) r.catch(() => { NOLOCK = true; }); } } catch (e) { NOLOCK = true; }
  setTimeout(() => { if (!DEMO && !locked && S.running) NOLOCK = true; }, 600);
  if (TOUCH) { try { const de = document.documentElement; const r = (de.requestFullscreen || de.webkitRequestFullscreen || (() => { })).call(de); if (r && r.catch) r.catch(() => { }); } catch (e) { } try { screen.orientation.lock('landscape').catch(() => { }); } catch (e) { } } }
$('play').onclick = startPlay;
if (window.parent !== window) { $('back').style.display = 'inline-block'; $('back').onclick = () => { try { parent.postMessage({ island: 'exit' }, '*'); } catch (e) { } }; }
$('ov').addEventListener('click', e => { if (e.target === $('ov')) startPlay(); });

/* ---------------- viewmodel animation + camera ---------------- */
function updateView(dt) {
  const rr_ = Math.cos(P.yaw), rz_ = -Math.sin(P.yaw), strafeV = P.vx * rr_ + P.vz * rz_;
  P.dodgeT = Math.max(0, P.dodgeT - dt); const dpw = P.dodgeT > 0 ? Math.sin(Math.PI * (1 - P.dodgeT / .55)) : 0;
  P.rollNow = lerp(P.rollNow, (P.alive ? -strafeV * .006 : 0) + P.dodgeDir * .3 * dpw, Math.min(1, dt * 14)); P.fovK *= 1 - Math.min(1, dt * 5);
  const v = VM[P.w], wp = WP[P.w], ads = P.ads; v.kick = Math.max(0, v.kick - dt * 8);
  const tgt = new T.Vector3(...(wp.melee ? v.hip : [lerp(v.hip[0], v.ads[0], ads), lerp(v.hip[1], v.ads[1], ads), lerp(v.hip[2], v.ads[2], ads)]));
  const moving = P.ground ? Math.hypot(P.vx, P.vz) : 0, bob = Math.sin(P.bob * 1.4) * .012 * (1 - ads * .85) * Math.min(1, moving / 4), bobx = Math.cos(P.bob * .7) * .01 * (1 - ads * .85) * Math.min(1, moving / 4);
  const spr = ((KEYS.ShiftLeft && KEYS.KeyW || P.jrun) && P.cr < .3 && P.ground && moving > 6 && ads < .1 && P.reload <= 0 && P.alive) ? 1 : 0; P.sprintK = lerp(P.sprintK, spr, Math.min(1, dt * 9));
  tgt.x += bobx - P.sway[0] * (1 - ads * .8); tgt.y += bob + P.sway[1] * (1 - ads * .8) - (P.swap > 0 ? P.swap * .9 : 0) - (P.alive ? 0 : .5); tgt.z += v.kick * .05;
  if (P.reload > 0) { tgt.y -= .12 * Math.sin(Math.min(1, (P.w === 1 ? P.reloadT / wp.reload : .5)) * Math.PI); }
  tgt.y += Math.sin(S.t * 1.6) * .0035 * (1 - ads) - P.sprintK * .05 + clamp(P.vy * .0035, -.05, .05) * (1 - ads) - P.punch * .05; tgt.x += P.sprintK * .05 - P.dodgeDir * dpw * .04;
  v.pos.lerp(tgt, Math.min(1, dt * 16)); v.g.position.copy(v.pos);
  let rx = v.rot[0], ry = v.rot[1], rz = v.rot[2];
  if (wp.tail) { const s = P.swing; if (s >= 0) { const w = clamp(s / .45, 0, 1), th = clamp((s - .45) / .16, 0, 1), ret = clamp((s - .62) / .38, 0, 1), wi = w * w * (3 - 2 * w), e = th * th * (3 - 2 * th), c = wi * (1 - e) * (1 - ret), tt = e * (1 - ret); rx = -c * .7 + tt * .1; ry = 0; rz = c * .25; v.pv.position.set(0, c * .16 - tt * .03, c * .26 - tt * .7); } else { rz = Math.sin(S.t * 2.2) * .05; ry = Math.sin(S.t * 1.3) * .06; v.pv.position.set(0, bob * .6, 0); } }
  else if (wp.melee) {
    if (P.swing >= 0) { const s = P.swing; const wind = clamp(s / .38, 0, 1), hit = clamp((s - .38) / .3, 0, 1), ret = clamp((s - .68) / .32, 0, 1); const e = hit * hit * (3 - 2 * hit); rx = lerp(-.45, -1.1, wind) + (e * .95) - ret * .0; ry = lerp(.1, .75, wind) - e * 1.6 + ret * .85; rz = lerp(-.35, -.9, wind) + e * 1.1 - ret * .2; v.pv.position.set(-e * .38 + wind * .1 - ret * .0, -e * .06, -e * .12); rx = lerp(rx, v.rot[0], ret); ry = lerp(ry, v.rot[1], ret); rz = lerp(rz, v.rot[2], ret); if (ret > 0) v.pv.position.multiplyScalar(1 - ret); } else v.pv.position.set(0, bob * .6, 0);
  } else { rx += v.kick * .05 + (P.reload > 0 ? .5 * Math.sin(Math.min(1, P.reloadT / wp.reload || .5) * Math.PI) : 0); ry += P.sway[0] * 1.2; rz += bobx * 2; }
  if (!(wp.melee && P.swing >= 0)) { rx += P.sprintK * .35 + (P.swap > 0 ? P.swap * 1.6 : 0); ry += P.sprintK * .4; rz += P.sprintK * .12 + Math.sin(S.t * 1.1) * .008 * (1 - ads); } rz -= P.rollNow * .5;
  v.g.rotation.set(rx, ry, rz); if (v.pump) { v.pumpT = Math.max(0, (v.pumpT || 0) - dt); const k = v.pumpT > 0 ? Math.sin((1 - v.pumpT / .38) * Math.PI) : 0; v.pump.position.z = -.4 + k * .13; }
  if (v.muz && v.muz.visible) { v.muz.userData.t -= dt; if (v.muz.userData.t <= 0) v.muz.visible = false; }
  P.sway[0] *= 1 - Math.min(1, dt * 9); P.sway[1] *= 1 - Math.min(1, dt * 9);
  // camera
  const eye = 1.62 - (P.cr || 0) * .66 + P.camStep + Math.sin(P.bob * 1.4) * .035 * Math.min(1, moving / 4) * (1 - ads * .7) - (P.alive ? 0 : 1.1) + P.punch * -.06 * Math.sin(P.punch * 14);
  cam.position.set(P.x, P.y + eye, P.z); if (P.ride && P.alive && window.FT) FT.chaseCam(); const sh = shake * shake * .02; { const sx = Math.round(P.x / 3) * 3, sz = Math.round(P.z / 3) * 3; sun.position.set(sx + 40, 70, sz + 25); sun.target.position.set(sx, 0, sz); sun.target.updateMatrixWorld(); }
  if (AU) { const fw = dirVec(P.yaw, P.pitch); AU.setListener(P.x, P.y + eye, P.z, fw.x, fw.y, fw.z, 0, 1, 0); }
  cam.rotation.set(P.pitch + P.recoil + HK.p - P.dodgeFwd * .09 * dpw + (Math.random() - .5) * sh, P.yaw + (Math.random() - .5) * sh, (P.alive ? 0 : .7) + P.rollNow + HK.r + HK.lean + (Math.random() - .5) * sh * .5, 'YXZ');
  const f = lerp(CFG.fov, wp.melee ? CFG.fov : CFG.adsFov, ads) + ((KEYS.ShiftLeft || P.jrun) && moving > 6 ? 3 : 0) + P.fovK; if (Math.abs(cam.fov - f) > .05) { cam.fov += (f - cam.fov) * Math.min(1, dt * 12); cam.updateProjectionMatrix(); }
  const gap = 6 + (wp.spread ? (wp.spread * 220 * (1 - ads * .65)) : 6) + moving * .9 + (P.ground ? 0 : 8) + v.kick * 6;
  document.querySelectorAll('#xh i:not(.d)').forEach(i => { const c = i.className; i.style.transform = c === 't' ? `translateY(${-gap + 6}px)` : c === 'b' ? `translateY(${gap - 6}px)` : c === 'l' ? `translateX(${-gap + 6}px)` : `translateX(${gap - 6}px)`; i.style.opacity = ads > .6 && P.w === 1 ? .35 : 1; });
}

/* ---------------- touch controls: floating joystick, look pad, buttons ---------------- */
function pauseGame() { NOLOCK = false; $('ov').style.display = 'flex'; $('play').textContent = 'RESUME'; mouseL = mouseR = false; P.jx = P.jy = 0; P.jrun = false; }
if (TOUCH) (function touchControls() {
  document.body.classList.add('touch');
  $('play').textContent = 'TAP TO PLAY';
  const tc = $('tc'), zone = $('tj'), look = $('tl'), base = $('jbase'), knob = $('jknob'), R = 56, GH = { x: 92, y: 0 };
  const ghost = () => { const h = innerHeight; base.style.left = GH.x + 'px'; base.style.top = (h - 92) + 'px'; knob.style.left = '50%'; knob.style.top = '50%'; base.classList.remove('on'); };
  ghost(); addEventListener('resize', ghost);
  let jid = null, jo = null, lid = null, lx = 0, ly = 0, l0 = null, fireOff = null;
  const set = (el, on) => el.classList.toggle('on', on);
  zone.addEventListener('touchstart', e => {
    e.preventDefault(); aInit(); if (jid !== null) return; const t = e.changedTouches[0]; jid = t.identifier; jo = { x: t.clientX, y: t.clientY };
    base.style.left = jo.x + 'px'; base.style.top = jo.y + 'px'; base.classList.add('on');
  }, { passive: false });
  zone.addEventListener('touchmove', e => {
    e.preventDefault(); for (const t of e.changedTouches) if (t.identifier === jid) {
      let dx = t.clientX - jo.x, dy = t.clientY - jo.y; const d = Math.hypot(dx, dy), k = d > R ? R / d : 1; dx *= k; dy *= k;
      knob.style.left = 'calc(50% + ' + dx + 'px)'; knob.style.top = 'calc(50% + ' + dy + 'px)'; let m = Math.min(1, d / R); m = m < .14 ? 0 : (m - .14) / .86;
      const a = Math.atan2(dy, dx); P.jx = Math.cos(a) * m; P.jy = Math.sin(a) * m; P.jrun = m > .95 && P.jy < -.45;
    }
  }, { passive: false });
  const jend = e => { for (const t of e.changedTouches) if (t.identifier === jid) { jid = null; P.jx = P.jy = 0; P.jrun = false; ghost(); } };
  zone.addEventListener('touchend', jend); zone.addEventListener('touchcancel', jend);
  look.addEventListener('touchstart', e => { e.preventDefault(); aInit(); if (lid !== null) return; const t = e.changedTouches[0]; lid = t.identifier; lx = t.clientX; ly = t.clientY; l0 = { x: t.clientX, y: t.clientY }; clearTimeout(fireOff); mouseL = true; }, { passive: false });
  look.addEventListener('touchmove', e => {
    e.preventDefault(); for (const t of e.changedTouches) if (t.identifier === lid) {
      const dx = t.clientX - lx, dy = t.clientY - ly; lx = t.clientX; ly = t.clientY; if (l0 && Math.hypot(t.clientX - l0.x, t.clientY - l0.y) > 18) { l0 = null; if (mouseL) { clearTimeout(fireOff); fireOff = setTimeout(() => { mouseL = false; }, 90); } } if (!S.running || !P.alive) return;
      const k = .0052 * (1 - P.ads * .45); P.yaw -= dx * k; P.pitch = clamp(P.pitch - dy * k, -1.45, 1.45);
    }
  }, { passive: false });
  const lend = e => { for (const t of e.changedTouches) if (t.identifier === lid) { lid = null; l0 = null; clearTimeout(fireOff); fireOff = setTimeout(() => { mouseL = false; }, 90); } };
  look.addEventListener('touchend', lend); look.addEventListener('touchcancel', lend);
  const btn = (id, down, up) => { const el = $(id); el.addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); aInit(); el.classList.add('on'); down(); }, { passive: false }); const u = e => { e.preventDefault(); el.classList.remove('on'); if (up) up(); }; el.addEventListener('touchend', u, { passive: false }); el.addEventListener('touchcancel', u, { passive: false }); };
  btn('tjump', () => { KEYS.Space = true; }, () => { KEYS.Space = false; });
  btn('treload', () => startReload(), null);
  btn('tswap', () => selectWeapon(FT.nextWeapon()), null);
  btn('tgren', () => FT.gStart(), () => FT.gEnd()); btn('tcrh', () => { P.tcr = !P.tcr; $('tcrh').classList.toggle('lit', P.tcr); }, null); btn('trope', () => FT.rope(), null); btn('tuse', () => FT.use(), null);
  btn('tdodge', () => { const ax = Math.abs(P.jx), ay = Math.abs(P.jy); tryDodge(Math.hypot(P.jx, P.jy) < .3 ? 'KeyW' : (ax > ay ? (P.jx < 0 ? 'KeyA' : 'KeyD') : (P.jy < 0 ? 'KeyW' : 'KeyS'))); }, null);
  btn('tpause', () => { if (S.running && !S.over) pauseGame(); }, null);
  setInterval(() => { const vis = S.running && $('ov').style.display === 'none'; if (tc.style.display !== (vis ? 'block' : 'none')) tc.style.display = vis ? 'block' : 'none'; }, 120);
})();

/* ---------------- main loop ---------------- */
let last = performance.now(), MEDT = 0;
/* ---------------- graphics quality: Auto drops detail when the frame rate is poor ---------------- */
let GFXL = 0, GFXM = 'auto', FPSV = 60, gfxLow = 0, gfxAt = 0; try { GFXM = localStorage.getItem('wi_gfx') || 'auto'; } catch (e) { }
const GFXN = ['High', 'Medium', 'Low', 'Minimum'];
function applyGfx(l) {
  GFXL = l; const dpr = devicePixelRatio || 1; rd.setPixelRatio([Math.min(2, dpr), Math.min(1.5, dpr), 1, .7][l]);
  if (composer) { if (bloom) bloom.enabled = l === 0; for (const r of [composer.renderTarget1, composer.renderTarget2]) if (r && r.samples !== undefined) { const ns = l === 0 ? 4 : 0; if (r.samples !== ns) { r.samples = ns; r.dispose(); } } }
  DECOR.forEach(m => { m.visible = l < 2; });
  rd.shadowMap.enabled = l < 3; rd.shadowMap.type = l <= 1 ? T.PCFSoftShadowMap : T.PCFShadowMap;
  const ms = l <= 1 ? 2048 : 1024; if (sun.shadow.mapSize.x !== ms) { sun.shadow.mapSize.set(ms, ms); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
  sc.traverse(o => { const m = o.material; if (m) (Array.isArray(m) ? m : [m]).forEach(x => { x.needsUpdate = true; }); });
  resize(); gfxAt = performance.now();
}
function gfxSet(m) { GFXM = m; try { localStorage.setItem('wi_gfx', m); } catch (e) { } applyGfx(m === 'auto' ? Math.max(GFXL, 0) : +m); const s = $('gfxsel'); if (s) s.value = m; }
function fpsTick(rdt, now) {
  if (rdt <= 0 || rdt > 2) return; FPSV += (1 / rdt - FPSV) * .06;
  if (GFXM !== 'auto' || !S.running || !live() || document.hidden || now - gfxAt < 5000 || GFXL >= 3) { gfxLow = 0; return; }
  if (FPSV < 40) { gfxLow += rdt; if (gfxLow > 3) { gfxLow = 0; applyGfx(GFXL + 1); FPSV = 60; feed('Auto graphics: ' + GFXN[GFXL] + ' (frame rate was low) — change under Graphics in the menu'); } } else gfxLow = Math.max(0, gfxLow - rdt * 2);
}
{ const s = $('gfxsel'); if (s) { s.value = GFXM; s.onchange = () => gfxSet(s.value); } if (GFXM !== 'auto') applyGfx(+GFXM || 0); }
function frame(now) {
  requestAnimationFrame(frame); fpsTick((now - last) / 1000, now); let dt = Math.min(.05, (now - last) / 1000); last = now;
  if (S.running && live()) {
    S.t += dt;
    for (let i = later.length - 1; i >= 0; i--) if (later[i].t <= S.t) { const f = later[i].fn; later.splice(i, 1); f(); }
    updatePlayer(dt); if (window.NET) NET.tick(dt); BOTS.forEach(b => botThink(b, dt)); animateBots(dt); if (window.FT) FT.update(dt);
    for (const m of MEDS) { if (!m.on) { m.t -= dt; if (m.t <= 0) { m.on = true; m.g.visible = true; } } else { m.g.rotation.y += dt * 1.6; m.g.position.y = m.y + .9 + Math.sin(S.t * 2.2) * .1; } }
  } else if (!S.running) { // title screen: slow orbit
    S.t += dt; const a = S.t * .05; cam.position.set(Math.sin(a) * 78, 30, Math.cos(a) * 62); cam.lookAt(0, 2, 0); VM.forEach(v => v.g.visible = false);
  }
  if (S.running) updateView(dt); updateFx(dt);
  if (AU) { CI = Math.max(0, CI - dt * .14); AU.setIntensity(S.running && live() ? .12 + CI * .88 : .12); AU.tick(); }
  sea.material.uniforms.t.value = S.t; windUpdate(dt); CLOUDS.forEach(c => { const k = c.userData.sp * dt * 1.2 * (.5 + WIND.e * 1.5); c.position.x += Math.cos(WIND.a) * k; c.position.z += Math.sin(WIND.a) * k; if (c.position.x > 250) c.position.x = -250; else if (c.position.x < -250) c.position.x = 250; if (c.position.z > 250) c.position.z = -250; else if (c.position.z < -250) c.position.z = 250; });
  (flag.l || []).forEach((f, i) => f.rotation.y = Math.sin(S.t * 3 + i) * .25);
  if (composer) composer.render(); else rd.render(sc, cam);
}

/* ---------------- sound menu: volumes + Sound Lab ---------------- */
$('infob').onclick = () => document.body.classList.add('info'); $('sheetx').onclick = () => document.body.classList.remove('info');
(function () {
  const vb = $('vols'), LAB = ['uzi', 'shotgun', 'pump', 'reload', 'batSwing', 'batHit', 'hit', 'headshot', 'hurt', 'gib', 'step', 'land', 'splash', 'pickup', 'dodge', 'whiz', 'sting', 'heartbeat', 'gull'];
  [['master', 'Master'], ['sfx', 'Effects'], ['vox', 'Voices'], ['amb', 'Ambience'], ['mus', 'Music']].forEach(([k, n]) => {
    const l = document.createElement('span'); l.textContent = n; const r = document.createElement('input'); r.type = 'range'; r.min = 0; r.max = 1; r.step = .01; r.value = VOLS[k];
    r.oninput = () => { VOLS[k] = +r.value; if (AU) AU.setVol(k, VOLS[k]); try { localStorage.setItem('wi_vol', JSON.stringify(VOLS)); } catch (e) { } }; vb.append(l, r);
  });
  { const sel = $('annsel'); if (sel) { annFill(); sel.onchange = () => { ANPICK = sel.value; ANV = null; try { localStorage.setItem('wi_annv', ANPICK); } catch (e) { } if (ANPICK !== 'off') { aInit(); if (AC && AC.state === 'suspended') AC.resume(); announce('Double kill!', false); } }; const tb = $('annt'); if (tb) tb.onclick = () => { aInit(); if (AC && AC.state === 'suspended') AC.resume(); announce('Killing spree!', false); }; } }
  const lb = $('labb'); LAB.forEach(n => { const b = document.createElement('button'); b.textContent = n; b.onclick = () => { aInit(); if (AC && AC.state === 'suspended') AC.resume(); if (AU) AU.play(n, null, { force: true, kind: 'hurt' }); }; lb.append(b); });
  const vx = document.createElement('button'); vx.textContent = 'voices'; vx.onclick = () => { aInit(); ['hurt', 'die', 'taunt', 'laugh', 'spawn'].forEach((k, i) => setTimeout(() => { if (AU) AU.play('voice', null, { kind: k, base: 250, force: true }); }, i * 1100)); }; lb.append(vx);
})();
initComposer(); resize(); initBots(); { const bm = $('bm'), bp = $('bp'); if (bm) bm.onclick = () => { setBots(CFG.bots - 1); if (!S.over) resetMatch(); }; if (bp) bp.onclick = () => { setBots(CFG.bots + 1); if (!S.over) resetMatch(); }; } hudHp(); hudAmmo(); scoreCheck();
window.WI = { HK, TOUCH, P, BOTS, S, KEYS, WP, selectWeapon, startPlay, set: (k, v) => { if (k === 'L') mouseL = v; if (k === 'R') mouseR = v; }, fire: fireWeapon, cam, dodge: tryDodge, hit: damageBot, emote, bubble, get AU() { return AU; }, hurtMe: damagePlayer };
if (window.parent !== window) { try { parent.postMessage({ island: 'ready' }, '*'); } catch (e) { } }
requestAnimationFrame(frame);
if (DEMO && Q.get('demo') === 'go') { startPlay(); }
