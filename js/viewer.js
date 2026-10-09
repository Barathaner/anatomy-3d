/* 3D viewer: renderer, PBR materials, environment, shadows, loading, picking, outlines,
   cross-section, camera fly-to and leader-line labels. No DOM chrome besides the canvas
   and the label layer; ui.js drives it through window.Viewer. */
(function () {
  'use strict';
  const A = window.ANATOMY, SYS = A.SYSTEMS;
  const V = window.Viewer = {};
  const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const parts = V.parts = {}, partList = V.partList = [];
  const state = V.state = {
    sysOn: { skeleton: true, muscles: false, organs: true, circulatory: true, nervous: true },
    sysAlpha: { skeleton: 1, muscles: 1, organs: 1, circulatory: 1, nervous: 1 },
    muscleLayer: { superficial: true, deep: false },
    hidden: new Set(), isolate: null, globalAlpha: 1,
    clip: { on: false, axis: 'x', pos: 0, flip: false },
    hover: null, selected: null, labels: false, theme: 'dark'
  };
  const listeners = {};
  V.on = (e, f) => { (listeners[e] = listeners[e] || []).push(f); };
  const emit = (e, a, b) => (listeners[e] || []).forEach(f => f(a, b));

  let renderer, scene, camera, controls, canvas, stage, floorGroup, keyLight;
  let needsRender = true, shadowDirty = true, visDirty = true, labelDirty = true, viewShift = 0;
  const homeTarget = new THREE.Vector3(0, 0.86, 0), homePos = new THREE.Vector3(0, 0.98, 3.15);
  const clipPlane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);
  let clipHelper;

  const lin = hex => new THREE.Color(hex).convertSRGBToLinear();
  const TONE_COLORS = A.TONES;

  // ------------------------------------------------------------------ init
  V.init = function (canvasEl, stageEl) {
    canvas = canvasEl; stage = stageEl;
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.setClearColor(0x000000, 0);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(34, 1, 0.02, 40);
    camera.position.copy(homePos);

    scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x2a2420, 0.35));
    keyLight = new THREE.DirectionalLight(0xfff3e6, 2.3);
    keyLight.position.set(1.3, 4.2, 2.2);
    keyLight.target.position.set(0, 0.9, 0);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    const sc = keyLight.shadow.camera;
    sc.left = -1.1; sc.right = 1.1; sc.top = 1.3; sc.bottom = -1.0; sc.near = 0.5; sc.far = 9; sc.updateProjectionMatrix();
    keyLight.shadow.bias = -0.0004; keyLight.shadow.normalBias = 0.004; keyLight.shadow.radius = 3;
    scene.add(keyLight, keyLight.target);
    const fill = new THREE.DirectionalLight(0xb7cdff, 0.7); fill.position.set(-2.4, 1.4, 1.6); scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 0.9); rim.position.set(-0.6, 2.2, -3); scene.add(rim);

    buildEnvironment();
    buildFloor();
    V.scene = scene; V.keyLight = keyLight;

    controls = new THREE.OrbitControls(camera, canvas);
    controls.target.copy(homeTarget);
    controls.enableDamping = true; controls.dampingFactor = 0.09;
    controls.screenSpacePanning = true;
    controls.minDistance = 0.22; controls.maxDistance = 6;
    controls.rotateSpeed = 0.8; controls.zoomSpeed = 0.9;
    controls.update();
    controls.addEventListener('change', () => { needsRender = true; labelDirty = true; });
    controls.addEventListener('start', () => { tween = null; });
    controls.addEventListener('end', () => { labelDirty = true; emit('camera-settled'); });

    new ResizeObserver(resize).observe(stage);
    resize();
    pickTarget = new THREE.WebGLRenderTarget(1, 1, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
    requestAnimationFrame(frame);
  };

  function resize() {
    const w = Math.max(1, stage.clientWidth), h = Math.max(1, stage.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // keep the whole figure in view on tall/narrow screens
    camera.fov = w / h < 0.8 ? 34 / Math.max(0.55, w / h / 0.8) : 34;
    applyView();
    outlineRes.value.set(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
    needsRender = true; labelDirty = true;
  }

  // Shift the rendered window up so the subject stays visible above a bottom sheet (phones).
  function applyView() {
    const w = Math.max(1, stage.clientWidth), h = Math.max(1, stage.clientHeight);
    if (viewShift) camera.setViewOffset(w, h, 0, viewShift, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
  V.setViewShift = function (px) {
    px = Math.round(px || 0);
    if (px === viewShift) return;
    viewShift = px; applyView(); needsRender = true; labelDirty = true;
  };

  // ------------------------------------------------------------------ environment / floor
  // Studio-style image-based lighting from a small procedural cube map (LDR canvases).
  // Deliberately not PMREM: the half-float PMREM path is fragile on software/older GPUs.
  function buildEnvironment() {
    const N = 128;
    const norm = v => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
    const boxes = [
      { d: norm([0.7, 0.8, 0.7]), w: 0.30, k: 1.0, c: [1.0, 0.94, 0.86] },   // warm key softbox
      { d: norm([-0.9, 0.35, 0.55]), w: 0.38, k: 0.55, c: [0.78, 0.86, 1.0] }, // cool fill
      { d: norm([0.0, 0.4, -1.0]), w: 0.34, k: 0.6, c: [1, 1, 1] },           // back strip
      { d: norm([0.0, 1.0, 0.0]), w: 0.55, k: 0.45, c: [1, 1, 1] }            // top
    ];
    const top = [0.52, 0.6, 0.78], mid = [0.3, 0.33, 0.4], bot = [0.09, 0.085, 0.085];
    const dirFor = [
      (u, v) => [1, -v, -u], (u, v) => [-1, -v, u], (u, v) => [u, 1, v], (u, v) => [u, -1, -v], (u, v) => [u, -v, 1], (u, v) => [-u, -v, -1]
    ];
    const canvases = dirFor.map(fn => {
      const c = document.createElement('canvas'); c.width = c.height = N;
      const ctx = c.getContext('2d'), img = ctx.createImageData(N, N);
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const d = norm(fn((x + 0.5) / N * 2 - 1, (y + 0.5) / N * 2 - 1));
        const yy = d[1];
        let col;
        if (yy > 0) { const s = Math.min(1, yy / 0.9); col = [0, 1, 2].map(i => mid[i] + (top[i] - mid[i]) * s); }
        else { const s = Math.min(1, -yy / 0.5); col = [0, 1, 2].map(i => mid[i] + (bot[i] - mid[i]) * s); }
        boxes.forEach(b => {
          const dot = d[0] * b.d[0] + d[1] * b.d[1] + d[2] * b.d[2];
          const f = Math.max(0, Math.min(1, (dot - (1 - b.w)) / (b.w * 0.45)));
          const k = f * f * (3 - 2 * f) * b.k * 1.4;
          for (let i = 0; i < 3; i++) col[i] += k * b.c[i];
        });
        const o = (y * N + x) * 4;
        for (let i = 0; i < 3; i++) img.data[o + i] = Math.round(255 * Math.min(1, Math.pow(col[i], 1 / 2.2)));
        img.data[o + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      return c;
    });
    const tex = new THREE.CubeTexture(canvases);
    tex.encoding = THREE.sRGBEncoding;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    scene.environment = tex;
  }
  function buildFloor() {
    floorGroup = new THREE.Group();
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(1.6, 48), new THREE.ShadowMaterial({ opacity: 0.32 }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.0005; shadow.receiveShadow = true;
    const disc = document.createElement('canvas'); disc.width = disc.height = 256;
    const g = disc.getContext('2d').createRadialGradient(128, 128, 10, 128, 128, 126);
    g.addColorStop(0, 'rgba(255,255,255,0.20)'); g.addColorStop(0.55, 'rgba(255,255,255,0.07)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    const ctx = disc.getContext('2d'); ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
    const glow = new THREE.Mesh(new THREE.CircleGeometry(1.5, 48), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(disc), transparent: true, depthWrite: false }));
    glow.rotation.x = -Math.PI / 2; glow.position.y = 0.0002;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.58, 0.585, 96), new THREE.MeshBasicMaterial({ color: 0x8ea6c9, transparent: true, opacity: 0.35, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.001;
    floorGroup.add(glow, shadow, ring);
    scene.add(floorGroup);
  }

  // ------------------------------------------------------------------ materials
  const NOISE_GLSL = [
    'float h13(vec3 p){ p = fract(p*0.1031); p += dot(p, p.zyx+31.32); return fract((p.x+p.y)*p.z); }',
    'float vn(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);',
    ' return mix(mix(mix(h13(i),h13(i+vec3(1,0,0)),f.x), mix(h13(i+vec3(0,1,0)),h13(i+vec3(1,1,0)),f.x), f.y),',
    '            mix(mix(h13(i+vec3(0,0,1)),h13(i+vec3(1,0,1)),f.x), mix(h13(i+vec3(0,1,1)),h13(i+vec3(1,1,1)),f.x), f.y), f.z); }',
    'vec3 vng(vec3 p){ float e=0.4; float c=vn(p); return vec3(vn(p+vec3(e,0,0))-c, vn(p+vec3(0,e,0))-c, vn(p+vec3(0,0,e))-c)/e; }'
  ].join('\n');
  function patchBump(mat, strength, freq) {
    mat.onBeforeCompile = shader => {
      shader.uniforms.uBump = { value: strength };
      shader.uniforms.uFreq = { value: freq };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vOP;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOP = position;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uBump; uniform float uFreq; varying vec3 vOP;\n' + NOISE_GLSL)
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' +
          'vec3 bg = vng(vOP * uFreq) + 0.5 * vng(vOP * uFreq * 3.1);\n' +
          'vec3 bgv = (viewMatrix * vec4(bg, 0.0)).xyz;\n' +
          'normal = normalize(normal - uBump * (bgv - dot(bgv, normal) * normal));');
    };
    mat.customProgramCacheKey = () => 'bump-' + strength + '-' + freq;
  }
  const STYLE = {
    skeleton:    { rough: 0.62, clear: 0.12, clearRough: 0.5, bump: 0.35, freq: 140, env: 0.85 },
    muscles:     { rough: 0.52, clear: 0.4, clearRough: 0.45, bump: 0.25, freq: 90, env: 0.9, sheen: 0x6a2a28 },
    organs:      { rough: 0.38, clear: 0.65, clearRough: 0.25, bump: 0.22, freq: 110, env: 1.0 },
    circulatory: { rough: 0.34, clear: 0.7, clearRough: 0.22, bump: 0.12, freq: 160, env: 1.0 },
    nervous:     { rough: 0.45, clear: 0.45, clearRough: 0.35, bump: 0.18, freq: 130, env: 0.95 }
  };
  function makeMaterial(def, tone) {
    const st = Object.assign({}, STYLE[def.system]);
    let hex = tone === 'main' ? (def.color || SYS[def.system].color) : TONE_COLORS[tone];
    if (tone === 'tendon' || tone === 'cartilage') { st.rough = 0.36; st.clear = 0.5; st.clearRough = 0.3; st.bump = 0.1; }
    if (def.key === 'teeth' || def.key === 'eye') { st.rough = 0.2; st.clear = 0.9; st.clearRough = 0.08; st.bump = 0.05; }
    if (def.key === 'discs') { st.rough = 0.4; st.clear = 0.5; }
    const p = {
      color: lin(hex), vertexColors: true, roughness: st.rough, metalness: 0,
      clearcoat: st.clear, clearcoatRoughness: st.clearRough, envMapIntensity: st.env, side: THREE.FrontSide,
      transparent: false
    };
    if (st.sheen) { p.sheen = new THREE.Color(st.sheen); }
    const m = new THREE.MeshPhysicalMaterial(p);
    patchBump(m, st.bump, st.freq);
    return m;
  }

  // ------------------------------------------------------------------ loading
  const nextFrame = () => new Promise(r => setTimeout(r, 0));

  async function fetchBake(progress) {
    const res = await fetch('assets/anatomy.bin.gz', { cache: 'no-cache' });
    if (!res.ok) throw new Error('assets/anatomy.bin.gz missing (' + res.status + ')');
    const total = +res.headers.get('content-length') || 0;
    const reader = res.body.getReader(), chunks = [];
    let got = 0;
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      chunks.push(r.value); got += r.value.length;
      progress(0.45 * (total ? got / total : 0.5), 'Downloading anatomy');
    }
    if (typeof DecompressionStream === 'undefined') throw new Error('DecompressionStream unsupported');
    progress(0.46, 'Unpacking');
    return new Response(new Blob(chunks).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }
  function parseBake(buf) {
    const dv = new DataView(buf);
    if (String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) !== 'ANAT') throw new Error('bad model file');
    const hl = dv.getUint32(8, true);
    const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, hl)));
    const base = 12 + hl, map = {};
    header.parts.forEach(p => {
      map[p.id] = p.items.map(it => {
        const nv = it.nv, q = new Uint16Array(buf, base + it.pos, nv * 3), n8 = new Int8Array(buf, base + it.nrm, nv * 3), c8 = new Uint8Array(buf, base + it.col, nv * 3);
        const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), col = new Float32Array(nv * 3);
        for (let a = 0; a < 3; a++) {
          const lo = it.lo[a], sp = (it.hi[a] - it.lo[a]) / 65535;
          for (let i = a; i < nv * 3; i += 3) pos[i] = lo + q[i] * sp;
        }
        for (let i = 0; i < nv * 3; i++) { nrm[i] = n8[i] / 127; col[i] = Math.pow(c8[i] / 255, 2.2); }
        const idx = it.wide ? new Uint32Array(buf, base + it.idx, it.ni) : new Uint16Array(buf, base + it.idx, it.ni);
        return { tone: it.tone, pos, nrm, col, idx };
      });
    });
    return map;
  }
  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('failed ' + src)); document.body.appendChild(s); });
  }
  async function liveBuild(progress) {
    progress(0.05, 'Sculpting anatomy in the browser (slow path)');
    for (const f of ['js/sdf.js', 'js/model_bones.js', 'js/model_soft.js']) await loadScript(f);
    const map = {}, defs = A.PART_DEFS;
    for (let i = 0; i < defs.length; i++) {
      const d = defs[i];
      (d.sided ? [1, -1] : [0]).forEach(s => {
        const id = d.key + (d.sided ? (s > 0 ? '_l' : '_r') : '');
        map[id] = A.BUILD[d.key](s).map(it => {
          const g = it.g, col = new Float32Array(g.c.length);
          for (let k = 0; k < col.length; k++) col[k] = Math.pow(Math.min(1, Math.max(0, g.c[k])), 2.2);
          return { tone: it.tone || 'main', pos: g.p, nrm: g.n, col, idx: g.i };
        });
      });
      progress(0.05 + 0.4 * (i + 1) / defs.length, 'Sculpting ' + d.name);
      await nextFrame();
    }
    return map;
  }

  V.load = async function (progress) {
    let data;
    try { data = parseBake(await fetchBake(progress)); }
    catch (e) {
      console.warn('Baked model unavailable (' + e.message + '), building live');
      data = await liveBuild(progress);
    }
    const defs = A.PART_DEFS;
    let done = 0;
    const total = defs.reduce((n, d) => n + (d.sided ? 2 : 1), 0);
    for (const def of defs) {
      for (const s of (def.sided ? [1, -1] : [0])) {
        const id = def.key + (def.sided ? (s > 0 ? '_l' : '_r') : '');
        buildPart(def, s, id, data[id]);
        done++;
      }
      if (done % 6 === 0) { progress(0.5 + 0.5 * done / total, 'Building meshes'); await nextFrame(); }
    }
    partList.sort((a, b) => Object.keys(SYS).indexOf(a.system) - Object.keys(SYS).indexOf(b.system) || a.name.localeCompare(b.name));
    makePickMaterials();
    computeNeighbours();
    clipHelper = makeClipHelper();
    progress(1, 'Ready');
    visDirty = true; needsRender = true; shadowDirty = true;
    return partList;
  };

  function buildPart(def, side, id, items) {
    if (!items) throw new Error('no geometry for ' + id);
    const group = new THREE.Group(); group.name = id; group.visible = false;
    const mats = {};
    const meshes = [];
    const box = new THREE.Box3();
    items.forEach(it => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(it.pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(it.nrm, 3));
      g.setAttribute('color', new THREE.BufferAttribute(it.col, 3));
      g.setIndex(new THREE.BufferAttribute(it.idx, 1));
      g.computeBoundingBox(); g.computeBoundingSphere();
      const tone = it.tone || 'main';
      if (!mats[tone]) mats[tone] = makeMaterial(def, tone);
      const m = new THREE.Mesh(g, mats[tone]);
      m.castShadow = true; m.receiveShadow = true;
      m.userData.partId = id; m.userData.mat = mats[tone];
      group.add(m); meshes.push(m);
      box.union(g.boundingBox);
    });
    scene.add(group);
    const center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    // anchor: surface vertex nearest the centre (used for leader lines)
    let best = Infinity, anchor = center.clone();
    meshes.forEach(m => {
      const p = m.geometry.attributes.position.array;
      for (let i = 0; i < p.length; i += 3) {
        const d = (p[i] - center.x) ** 2 + (p[i + 1] - center.y) ** 2 + (p[i + 2] - center.z) ** 2;
        if (d < best) { best = d; anchor.set(p[i], p[i + 1], p[i + 2]); }
      }
    });
    const name = def.name + (def.sided ? (side > 0 ? ' (left)' : ' (right)') : '');
    const part = {
      id, def, name, side, system: def.system, region: def.region, group, mats, meshes, box, center, size, anchor,
      alpha: 0, target: 1, pickable: true, flags: {}, outline: null, neighbours: [],
      layer: def.layer || (def.system === 'muscles' ? 'superficial' : null)
    };
    parts[id] = part; partList.push(part);
    return part;
  }
  function computeNeighbours() {
    partList.forEach(p => {
      p.neighbours = partList.filter(q => q !== p && q.def.key !== p.def.key)
        .map(q => ({ q, d: q.center.distanceTo(p.center) - 0.5 * (q.size.length() + p.size.length()) * 0.3 }))
        .sort((a, b) => a.d - b.d).slice(0, 8).map(o => o.q.id);
    });
  }

  // ------------------------------------------------------------------ visibility model
  V.markVisDirty = () => { visDirty = true; needsRender = true; };
  function computeTargets() {
    partList.forEach(p => {
      let t = state.sysOn[p.system] ? 1 : 0;
      if (p.system === 'muscles' && !state.muscleLayer[p.layer]) t = 0;
      if (state.hidden.has(p.id)) t = 0;
      if (state.isolate && !state.isolate.has(p.id)) t = 0;
      const a = t * (state.isolate && state.isolate.has(p.id) ? 1 : state.sysAlpha[p.system]) * state.globalAlpha;
      p.target = a;
      p.pickable = t > 0 && a >= 0.45;
    });
  }
  V.isVisible = p => p.target > 0.01;

  // ------------------------------------------------------------------ picking (GPU id buffer)
  let pickTarget;
  const pickBuf = new Uint8Array(4);
  function makePickMaterials() {
    partList.forEach((p, i) => {
      const code = i + 1;
      p.pickMat = new THREE.MeshBasicMaterial({ toneMapped: false });
      p.pickMat.color.setRGB(((code >> 16) & 255) / 255, ((code >> 8) & 255) / 255, (code & 255) / 255);
    });
  }
  V.pick = function (clientX, clientY) {
    if (!partList.length) return null;
    const r = canvas.getBoundingClientRect();
    const x = clientX - r.left, y = clientY - r.top;
    if (x < 0 || y < 0 || x > r.width || y > r.height) return null;
    camera.setViewOffset(r.width, r.height, Math.floor(x), Math.floor(y) + viewShift, 1, 1);
    const saved = [];
    partList.forEach(p => {
      saved.push(p.group.visible);
      const on = p.pickable && p.alpha > 0.3;
      p.group.visible = on;
      if (on) p.meshes.forEach(m => { m.material = p.pickMat; });
      if (p.outline) p.outline.forEach(o => { o.visible = false; });
    });
    const fv = floorGroup.visible, hv = clipHelper ? clipHelper.visible : false;
    floorGroup.visible = false; if (clipHelper) clipHelper.visible = false;
    const oldAlpha = renderer.getClearAlpha(), oldColor = renderer.getClearColor(new THREE.Color()).getHex();
    renderer.setClearColor(0x000000, 1);
    renderer.setRenderTarget(pickTarget);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(pickTarget, 0, 0, 1, 1, pickBuf);
    renderer.setRenderTarget(null);
    renderer.setClearColor(oldColor, oldAlpha);
    applyView();
    floorGroup.visible = fv; if (clipHelper) clipHelper.visible = hv;
    partList.forEach((p, i) => {
      p.group.visible = saved[i];
      p.meshes.forEach(m => { m.material = m.userData.mat; });
    });
    needsRender = true;
    const code = (pickBuf[0] << 16) | (pickBuf[1] << 8) | pickBuf[2];
    return code > 0 && code <= partList.length ? partList[code - 1].id : null;
  };
  // meshes remember their display material so the id pass can swap and restore it
  function restoreMaterials() {
    partList.forEach(p => p.meshes.forEach(m => { if (m.userData.mat) m.material = m.userData.mat; }));
  }

  // ------------------------------------------------------------------ outlines
  const outlineRes = { value: new THREE.Vector2(1, 1) };
  function outlineFor(p) {
    if (p.outline) return p.outline;
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, transparent: true, depthWrite: false, clipping: true,
      uniforms: { uColor: { value: new THREE.Color() }, uWidth: { value: 2.2 }, uOpacity: { value: 1 }, uRes: outlineRes },
      vertexShader: [
        '#include <clipping_planes_pars_vertex>',
        'uniform float uWidth; uniform vec2 uRes;',
        'void main(){',
        '  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);',
        '  vec4 clip = projectionMatrix * mvPosition;',
        '  vec3 vn = normalize(normalMatrix * normal);',
        '  vec2 d = (projectionMatrix * vec4(vn, 0.0)).xy;',
        '  d = normalize(d + vec2(1e-6)) * uWidth * 2.0 / uRes;',
        '  clip.xy += d * clip.w;',
        '  gl_Position = clip;',
        '  #include <clipping_planes_vertex>',
        '}'
      ].join('\n'),
      fragmentShader: [
        '#include <clipping_planes_pars_fragment>',
        'uniform vec3 uColor; uniform float uOpacity;',
        'void main(){',
        '#include <clipping_planes_fragment>',
        '  gl_FragColor = vec4(uColor, uOpacity);',
        '}'
      ].join('\n')
    });
    p.outlineMat = mat;
    p.outline = p.meshes.map(m => {
      const o = new THREE.Mesh(m.geometry, mat);
      o.renderOrder = 6; o.frustumCulled = false; o.visible = false;
      p.group.add(o);
      return o;
    });
    return p.outline;
  }
  const OUTLINE = { hover: [0.35, 0.8, 1.0], selected: [1.0, 0.72, 0.2], target: [1.0, 0.86, 0.25], correct: [0.2, 0.85, 0.45], wrong: [0.95, 0.3, 0.28] };
  function updateHighlights(now) {
    let animating = false;
    partList.forEach(p => {
      const f = p.flags;
      const key = f.result === 'correct' ? 'correct' : f.result === 'wrong' ? 'wrong' : f.target ? 'target' : f.selected ? 'selected' : f.hover ? 'hover' : null;
      if (!key && !p._hl) return;
      const sig = (key || '') + '|' + p.alpha.toFixed(2);
      if (key !== 'target' && p._sig === sig) return;
      p._sig = sig;
      p._hl = !!key;
      const o = outlineFor(p);
      const on = !!key && p.alpha > 0.02;
      o.forEach(m => { m.visible = on; });
      let e = 0, ec = [0, 0, 0];
      if (key) {
        ec = OUTLINE[key];
        p.outlineMat.uniforms.uColor.value.setRGB(ec[0], ec[1], ec[2]);
        const pulse = key === 'target' ? 0.55 + 0.45 * Math.sin(now / 240) : 1;
        p.outlineMat.uniforms.uOpacity.value = Math.min(1, 0.4 + p.alpha) * pulse;
        p.outlineMat.uniforms.uWidth.value = key === 'hover' ? 2.6 : 3.0;
        e = key === 'hover' ? 0.16 : key === 'target' ? 0.06 + 0.1 * pulse : key === 'selected' ? 0.12 : 0.2;
        if (key === 'target') animating = true;
        // quiz target / correct answer shines through everything
        const through = key === 'target' || key === 'correct';
        o.forEach(m => { m.material.depthTest = !through; m.renderOrder = through ? 9 : 6; });
      }
      Object.keys(p.mats).forEach(t => {
        const m = p.mats[t];
        m.emissive.setRGB(ec[0], ec[1], ec[2]);
        m.emissiveIntensity = e;
      });
      needsRender = true;
    });
    return animating;
  }

  // ------------------------------------------------------------------ cross-section
  function makeClipHelper() {
    const g = new THREE.Group();
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x5aa8ff, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }));
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)), new THREE.LineBasicMaterial({ color: 0x5aa8ff, transparent: true, opacity: 0.6 }));
    g.add(fill, edge); g.visible = false; g.renderOrder = 8;
    scene.add(g);
    return g;
  }
  const CLIP_RANGE = { x: [-0.34, 0.34], y: [0.0, 1.8], z: [-0.16, 0.17] };
  V.clipRange = axis => CLIP_RANGE[axis];
  V.setClip = function (c) {
    Object.assign(state.clip, c);
    const k = state.clip, n = new THREE.Vector3(k.axis === 'x' ? 1 : 0, k.axis === 'y' ? 1 : 0, k.axis === 'z' ? 1 : 0);
    if (k.flip) n.multiplyScalar(-1);
    clipPlane.normal.copy(n);
    clipPlane.constant = -n.dot(new THREE.Vector3(k.axis === 'x' ? k.pos : 0, k.axis === 'y' ? k.pos : 0, k.axis === 'z' ? k.pos : 0));
    renderer.clippingPlanes = k.on ? [clipPlane] : [];
    if (clipHelper) {
      clipHelper.visible = k.on;
      const sx = k.axis === 'x' ? [0.9, 2.0] : k.axis === 'y' ? [0.9, 0.55] : [0.9, 2.0];
      clipHelper.scale.set(sx[0], sx[1], 1);
      clipHelper.position.set(k.axis === 'x' ? k.pos : 0, k.axis === 'y' ? k.pos : 0.9, k.axis === 'z' ? k.pos : 0);
      clipHelper.rotation.set(0, 0, 0);
      if (k.axis === 'x') clipHelper.rotation.y = Math.PI / 2;
      if (k.axis === 'y') { clipHelper.rotation.x = Math.PI / 2; clipHelper.scale.set(0.9, 0.55, 1); }
    }
    // see the cut interior from both sides
    partList.forEach(p => Object.keys(p.mats).forEach(t => { p.mats[t].side = k.on ? THREE.DoubleSide : THREE.FrontSide; p.mats[t].needsUpdate = true; }));
    shadowDirty = true; needsRender = true;
  };

  // ------------------------------------------------------------------ camera
  let tween = null;
  V.flyTo = function (target, pos, dur) {
    if (reduceMotion) { controls.target.copy(target); camera.position.copy(pos); needsRender = true; return; }
    tween = { t0: performance.now(), dur: dur || 800, fromT: controls.target.clone(), toT: target.clone(), fromP: camera.position.clone(), toP: pos.clone() };
    needsRender = true;
  };
  V.focus = function (ids, o) {
    o = o || {};
    ids = Array.isArray(ids) ? ids : [ids];
    const box = new THREE.Box3();
    ids.forEach(id => { if (parts[id]) box.union(parts[id].box); });
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
    const r = Math.max(sz.x, sz.y * (camera.aspect < 1 ? 1 : 0.8), sz.z) * 0.5;
    const dist = Math.max(o.wide ? 0.9 : 0.42, r / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * (o.wide ? 3.2 : 1.35));
    const dir = camera.position.clone().sub(controls.target).normalize();
    // keep a pleasant 3/4 angle when currently looking from far away
    V.flyTo(c, c.clone().add(dir.multiplyScalar(dist)));
  };
  V.resetView = () => V.flyTo(homeTarget, homePos, 900);
  V.viewFrom = function (name) {
    const t = controls.target.clone(), d = camera.position.distanceTo(controls.target);
    const dirs = { front: [0, 0, 1], back: [0, 0, -1], left: [1, 0, 0], right: [-1, 0, 0], top: [0, 1, 0.001] };
    const v = new THREE.Vector3().fromArray(dirs[name] || dirs.front).normalize().multiplyScalar(d);
    V.flyTo(t, t.clone().add(v));
  };
  V.cameraDistance = () => camera.position.distanceTo(controls.target);

  // ------------------------------------------------------------------ flags
  V.setFlag = function (id, flag, val) {
    const p = parts[id]; if (!p) return;
    p.flags[flag] = val; needsRender = true;
  };
  V.clearFlags = function (flag) {
    partList.forEach(p => { if (flag) p.flags[flag] = false; else p.flags = {}; });
    needsRender = true;
  };
  V.setHover = function (id) {
    if (state.hover === id) return;
    if (state.hover && parts[state.hover]) parts[state.hover].flags.hover = false;
    state.hover = id;
    if (id && parts[id]) parts[id].flags.hover = true;
    needsRender = true;
    emit('hover', id);
  };
  V.setSelected = function (id) {
    if (state.selected && parts[state.selected]) parts[state.selected].flags.selected = false;
    state.selected = id;
    if (id && parts[id]) parts[id].flags.selected = true;
    labelDirty = true; needsRender = true;
  };
  V.setTheme = function (t) {
    state.theme = t;
    if (renderer) renderer.toneMappingExposure = t === 'light' ? 1.2 : 1.05;
    if (floorGroup) floorGroup.children[1].material.opacity = t === 'light' ? 0.22 : 0.34;
    needsRender = true; shadowDirty = true;
  };
  V.setLabels = function (on) { state.labels = on; labelDirty = true; needsRender = true; };
  V.requestShadow = () => { shadowDirty = true; needsRender = true; };

  // ------------------------------------------------------------------ leader-line labels
  let labelLayer, svg, labelEls = {};
  V.initLabels = function (layer) {
    labelLayer = layer;
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'leaders');
    labelLayer.appendChild(svg);
  };
  const tmp = new THREE.Vector3();
  function layoutLabels() {
    if (!labelLayer) return;
    const W = stage.clientWidth, Hh = stage.clientHeight;
    let ids = [];
    if (state.labels) {
      const cand = partList.filter(p => p.target > 0.45 && p.alpha > 0.4 && p.def.label);
      const seen = {};
      cand.sort((a, b) => b.def.label - a.def.label || b.size.length() - a.size.length());
      cand.forEach(p => {
        if (ids.length >= (W < 700 ? 6 : 16)) return;
        const k = p.def.key;
        if (p.def.sided) {
          if (seen[k]) return;
          // label the side nearest the camera
          const other = parts[k + (p.side > 0 ? '_r' : '_l')];
          const dp = camera.position.distanceToSquared(p.anchor), dq = other ? camera.position.distanceToSquared(other.anchor) : Infinity;
          seen[k] = true;
          ids.push(dp <= dq ? p.id : other.id);
        } else ids.push(p.id);
      });
    }
    if (state.selected && ids.indexOf(state.selected) < 0) ids.push(state.selected);
    const items = [];
    ids.forEach(id => {
      const p = parts[id];
      if (!p || p.alpha < 0.05) return;
      tmp.copy(p.anchor).project(camera);
      if (tmp.z > 1 || tmp.z < -1) return;
      items.push({ p, x: (tmp.x + 1) / 2 * W, y: (1 - tmp.y) / 2 * Hh, sel: id === state.selected });
    });
    const used = {};
    // keep clear of the floating card on wide screens
    let reserve = 0;
    if (W > 900) {
      const card = document.querySelector('#info:not([hidden]), #quiz:not([hidden])');
      if (card) reserve = card.offsetWidth + 20;
    }
    const place = side => {
      const col = items.filter(i => (i.x < (W - reserve) / 2) === (side === 'L')).sort((a, b) => a.y - b.y);
      const gap = 26, top = 68, bottom = Hh - 52;
      let prev = top - gap;
      col.forEach(i => { i.ly = Math.max(i.y, prev + gap); prev = i.ly; });
      let next = bottom + gap;
      for (let k = col.length - 1; k >= 0; k--) { col[k].ly = Math.min(col[k].ly, next - gap); next = col[k].ly; }
      col.forEach(i => { i.side = side; });
    };
    place('L'); place('R');
    let path = '';
    items.forEach(i => {
      let el = labelEls[i.p.id];
      if (!el) {
        el = labelEls[i.p.id] = document.createElement('button');
        el.type = 'button'; el.className = 'lbl';
        el.addEventListener('click', ev => { ev.stopPropagation(); emit('label-click', i.p.id); });
        labelLayer.appendChild(el);
      }
      used[i.p.id] = true;
      el.textContent = i.p.name;
      el.classList.toggle('sel', i.sel);
      el.classList.toggle('left', i.side === 'L');
      el.classList.toggle('right', i.side === 'R');
      el.style.display = '';
      el.style.top = (i.ly - 11) + 'px';
      if (i.side === 'L') { el.style.left = '12px'; el.style.right = 'auto'; } else { el.style.right = (12 + reserve) + 'px'; el.style.left = 'auto'; }
      const w = el.offsetWidth || 90;
      const ex = i.side === 'L' ? 12 + w + 4 : W - 12 - reserve - w - 4;
      const mx = i.side === 'L' ? Math.max(ex + 14, Math.min(i.x - 30, ex + 70)) : Math.min(ex - 14, Math.max(i.x + 30, ex - 70));
      path += 'M' + ex.toFixed(1) + ' ' + i.ly.toFixed(1) + ' L' + mx.toFixed(1) + ' ' + i.ly.toFixed(1) + ' L' + i.x.toFixed(1) + ' ' + i.y.toFixed(1) + ' ';
      path += 'M' + (i.x - 3).toFixed(1) + ' ' + i.y.toFixed(1) + ' a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0 ';
    });
    Object.keys(labelEls).forEach(id => { if (!used[id]) labelEls[id].style.display = 'none'; });
    svg.setAttribute('width', W); svg.setAttribute('height', Hh);
    svg.innerHTML = '<path d="' + path + '"/>';
  }

  // ------------------------------------------------------------------ main loop
  let last = performance.now(), idle = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (!partList.length) return;
    if (visDirty) { computeTargets(); visDirty = false; }

    let fading = false;
    const k = reduceMotion ? 1 : 1 - Math.exp(-dt * 9);
    partList.forEach(p => {
      if (p.alpha === p.target) return;
      p.alpha += (p.target - p.alpha) * k;
      if (Math.abs(p.alpha - p.target) < 0.004) p.alpha = p.target;
      fading = true;
      const vis = p.alpha > 0.004;
      p.group.visible = vis;
      const transparent = p.alpha < 0.995;
      Object.keys(p.mats).forEach(t => {
        const m = p.mats[t];
        m.opacity = p.alpha;
        if (m.transparent !== transparent) { m.transparent = transparent; m.needsUpdate = true; }
        m.depthWrite = p.alpha > 0.55;
      });
      const cast = p.alpha > 0.5;
      p.meshes.forEach(m => { m.castShadow = cast; });
    });
    if (fading) { shadowDirty = true; needsRender = true; labelDirty = true; }

    if (tween) {
      let t = (now - tween.t0) / tween.dur;
      if (t >= 1) t = 1;
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      controls.target.lerpVectors(tween.fromT, tween.toT, e);
      camera.position.lerpVectors(tween.fromP, tween.toP, e);
      if (t === 1) tween = null;
      needsRender = true; labelDirty = true;
    }
    const damped = controls.update();
    if (damped) { needsRender = true; labelDirty = true; }

    const pulsing = updateHighlights(now);
    if (pulsing) needsRender = true;

    if (needsRender) {
      if (shadowDirty) { renderer.shadowMap.needsUpdate = true; shadowDirty = false; }
      renderer.render(scene, camera);
      needsRender = false;
      V.frames = (V.frames || 0) + 1;
    }
    if (labelDirty) { layoutLabels(); labelDirty = false; }
  }
  V.screenPos = function (id) {
    const p = parts[id]; if (!p) return null;
    const r = canvas.getBoundingClientRect();
    tmp.copy(p.anchor).project(camera);
    return { x: r.left + (tmp.x + 1) / 2 * r.width, y: r.top + (1 - tmp.y) / 2 * r.height, z: tmp.z };
  };
  V.screenshot = function () { renderer.render(scene, camera); return canvas.toDataURL('image/png'); };
  V.renderer = () => renderer;
})();
