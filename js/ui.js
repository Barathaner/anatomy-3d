/* UI layer: presets, grouped parts tree, search, info card, section tool, quiz, theme, shortcuts. */
(function () {
  'use strict';
  const A = window.ANATOMY, SYS = A.SYSTEMS;
  const V = window.Viewer;
  const $ = s => document.querySelector(s);
  const $$ = s => Array.prototype.slice.call(document.querySelectorAll(s));
  const UI = window.UI = {};
  const S = V.state, parts = V.parts;
  const SYS_KEYS = Object.keys(SYS);

  function el(tag, attrs, kids) {
    const n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(k => {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== false && attrs[k] != null) n.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    });
    (kids || []).forEach(c => n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    return n;
  }
  const icon = id => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.innerHTML = '<use href="#' + id + '"/>'; return s; };
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  };
  let toastTimer = null;
  function toast(msg) {
    const box = $('#toasts');
    box.textContent = '';
    box.appendChild(el('div', { class: 'toast', text: msg }));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { box.textContent = ''; }, 2600);
  }
  UI.toast = toast;

  // ------------------------------------------------------------------ visibility helpers
  function partVisible(p) {
    if (!S.sysOn[p.system]) return false;
    if (p.system === 'muscles' && !S.muscleLayer[p.layer]) return false;
    return !S.hidden.has(p.id);
  }
  function touchVis() { V.markVisDirty(); V.requestShadow(); refreshTree(); syncPresetButtons(); }
  function reveal(id) {
    const p = parts[id];
    S.sysOn[p.system] = true;
    if (S.sysAlpha[p.system] < 1) S.sysAlpha[p.system] = 1;
    if (p.system === 'muscles') S.muscleLayer[p.layer] = true;
    S.hidden.delete(id);
    if (S.isolate && !S.isolate.has(id)) S.isolate = null;
    touchVis();
  }

  // ------------------------------------------------------------------ presets
  let activePreset = 'all';
  function applyPreset(pr) {
    SYS_KEYS.forEach(k => { S.sysOn[k] = false; S.sysAlpha[k] = 1; });
    Object.keys(pr.systems).forEach(k => { if (pr.systems[k] > 0) { S.sysOn[k] = true; S.sysAlpha[k] = pr.systems[k]; } });
    const layers = pr.layers || ['superficial'];
    S.muscleLayer.superficial = layers.indexOf('superficial') >= 0;
    S.muscleLayer.deep = layers.indexOf('deep') >= 0;
    S.hidden.clear(); S.isolate = null;
    activePreset = pr.id;
    if (S.selected && !partVisible(parts[S.selected])) deselect();
    touchVis();
    $$('#presets button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === pr.id)));
    syncIsolateButton();
  }
  function syncPresetButtons() {
    // custom changes drop the "active preset" highlight
    const pr = A.PRESETS.find(x => x.id === activePreset);
    let match = !!pr && !S.hidden.size && !S.isolate;
    if (match) SYS_KEYS.forEach(k => {
      const want = pr.systems[k] > 0;
      if (S.sysOn[k] !== want || (want && Math.abs(S.sysAlpha[k] - pr.systems[k]) > 0.01)) match = false;
    });
    $$('#presets button').forEach(b => b.setAttribute('aria-pressed', String(match && b.dataset.id === activePreset)));
  }
  function buildPresets() {
    const nav = $('#presets');
    A.PRESETS.forEach(pr => {
      const dotKey = Object.keys(pr.systems).find(k => pr.systems[k] === 1);
      const b = el('button', { type: 'button', 'data-id': pr.id, title: pr.label + ' (' + pr.key + ')', onclick: () => applyPreset(pr) },
        [el('i', { style: dotKey ? '--c:' + SYS[dotKey].color : '--c:var(--text-3)' }), pr.label]);
      nav.appendChild(b);
    });
  }

  // ------------------------------------------------------------------ tree
  const groups = {};   // def.key -> { def, ids }
  const rowEls = {};   // def.key -> li
  const sysEls = {};
  const lastSide = {};
  function buildTree() {
    V.partList.forEach(p => {
      const g = groups[p.def.key] = groups[p.def.key] || { def: p.def, key: p.def.key, ids: [] };
      g.ids.push(p.id);
    });
    Object.keys(groups).forEach(k => groups[k].ids.sort());
    const tree = $('#tree');
    SYS_KEYS.forEach(sk => {
      const defs = Object.keys(groups).map(k => groups[k]).filter(g => g.def.system === sk);
      const sec = el('section', { class: 'sys' + (sk === 'skeleton' ? ' open' : ''), 'data-sys': sk });
      const eye = el('button', { class: 'eye', type: 'button', 'aria-label': 'Show or hide ' + SYS[sk].label, 'aria-pressed': 'true', onclick: e => { e.stopPropagation(); S.sysOn[sk] = !S.sysOn[sk]; if (S.sysOn[sk] && S.sysAlpha[sk] < 1) S.sysAlpha[sk] = 1; touchVis(); } }, [icon('i-eye')]);
      const head = el('div', { class: 'sys-h' }, [
        el('button', { class: 'chev', type: 'button', 'aria-label': 'Expand ' + SYS[sk].label, onclick: () => sec.classList.toggle('open') }, [icon('i-chev')]),
        el('span', { class: 'dot', style: '--c:' + SYS[sk].color }),
        el('button', { class: 'nm', type: 'button', text: SYS[sk].label, onclick: () => sec.classList.toggle('open') }),
        el('span', { class: 'cnt', text: String(defs.reduce((n, g) => n + g.ids.length, 0)) }),
        eye
      ]);
      const body = el('div', { class: 'sys-body' });
      if (sk === 'muscles') {
        const lay = el('div', { class: 'layers' });
        ['superficial', 'deep'].forEach(l => {
          lay.appendChild(el('button', { type: 'button', 'data-layer': l, 'aria-pressed': String(!!S.muscleLayer[l]), text: l === 'superficial' ? 'Superficial' : 'Deep layer',
            onclick: () => { S.muscleLayer[l] = !S.muscleLayer[l]; if (S.muscleLayer[l]) S.sysOn.muscles = true; touchVis(); } }));
        });
        body.appendChild(lay);
      }
      A.REGIONS.forEach(rg => {
        const list = defs.filter(g => g.def.region === rg).sort((a, b) => a.def.name.localeCompare(b.def.name));
        if (!list.length) return;
        const ul = el('ul');
        list.forEach(g => { const li = buildRow(g); rowEls[g.key] = li; ul.appendChild(li); });
        body.appendChild(el('div', { class: 'reg', 'data-region': rg }, [el('h4', { text: rg }), ul]));
      });
      sec.appendChild(head); sec.appendChild(body);
      sysEls[sk] = sec;
      tree.appendChild(sec);
    });
  }
  function buildRow(g) {
    const def = g.def, sided = !!def.sided;
    const li = el('li', { class: 'row', 'data-key': g.key, role: 'treeitem' });
    li.appendChild(el('button', { class: 'name', type: 'button', text: def.name, onclick: () => selectGroup(g.key) }));
    if (def.layer === 'deep') li.appendChild(el('span', { class: 'tag', text: 'deep' }));
    if (sided) {
      const side = el('span', { class: 'side' });
      [['l', 'L', 'Left'], ['r', 'R', 'Right']].forEach(s => {
        side.appendChild(el('button', { type: 'button', 'data-side': s[0], title: s[2], 'aria-label': def.name + ', ' + s[2], text: s[1], onclick: () => selectGroup(g.key, s[0]) }));
      });
      li.appendChild(side);
    }
    li.appendChild(el('span', { class: 'acts' }, [
      el('button', { class: 'eye', type: 'button', 'aria-label': 'Show or hide ' + def.name, 'aria-pressed': 'true', onclick: () => toggleHidden(g.ids) }, [icon('i-eye')]),
      el('button', { class: 'eye', type: 'button', 'aria-label': 'Focus ' + def.name, title: 'Focus', onclick: () => { reveal(g.ids[0]); V.focus(g.ids); } }, [icon('i-focus')])
    ]));
    li.addEventListener('mouseenter', () => { if (!quiz.on) g.ids.forEach(id => V.setFlag(id, 'hover', true)); });
    li.addEventListener('mouseleave', () => g.ids.forEach(id => V.setFlag(id, 'hover', id === S.hover)));
    return li;
  }
  function toggleHidden(ids) {
    const anyVisible = ids.some(id => !S.hidden.has(id));
    ids.forEach(id => { if (anyVisible) S.hidden.add(id); else S.hidden.delete(id); });
    if (anyVisible && S.selected && ids.indexOf(S.selected) >= 0) deselect();
    touchVis();
  }
  function selectGroup(key, side) {
    const g = groups[key];
    let id = g.ids[0];
    if (g.def.sided) {
      const s = side || lastSide[key] || 'l';
      id = key + '_' + s; lastSide[key] = s;
    }
    if (quiz.on) return;
    select(id, { focus: true });
  }
  function refreshTree() {
    Object.keys(groups).forEach(k => {
      const g = groups[k], li = rowEls[k]; if (!li) return;
      const vis = g.ids.some(id => partVisible(parts[id]));
      li.classList.toggle('off', !vis);
      const eye = li.querySelector('.acts .eye');
      eye.setAttribute('aria-pressed', String(vis));
      eye.firstChild.innerHTML = '<use href="#' + (vis ? 'i-eye' : 'i-eye-off') + '"/>';
      const sel = S.selected && parts[S.selected].def.key === k;
      li.classList.toggle('sel', !!sel);
      li.setAttribute('aria-selected', String(!!sel));
      li.querySelectorAll('.side button').forEach(b => b.classList.toggle('cur', !!sel && S.selected.slice(-1) === b.dataset.side));
    });
    SYS_KEYS.forEach(sk => {
      const eye = sysEls[sk].querySelector('.sys-h .eye');
      eye.setAttribute('aria-pressed', String(!!S.sysOn[sk]));
      eye.firstChild.innerHTML = '<use href="#' + (S.sysOn[sk] ? 'i-eye' : 'i-eye-off') + '"/>';
    });
    $$('.layers button').forEach(b => b.setAttribute('aria-pressed', String(!!S.muscleLayer[b.dataset.layer])));
    syncIsolateButton();
  }

  // ------------------------------------------------------------------ search
  function esc(s) { return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function runSearch() {
    const raw = $('#search').value.trim().toLowerCase();
    const words = raw.split(/\s+/).filter(Boolean);
    const tree = $('#tree');
    tree.classList.toggle('searching', words.length > 0);
    let n = 0;
    const matched = [];
    Object.keys(groups).forEach(k => {
      const g = groups[k], li = rowEls[k];
      const hay = (g.def.name + ' ' + SYS[g.def.system].label + ' ' + g.def.region + ' ' + g.def.desc + ' ' + g.def.fn + (g.def.sided ? ' left right' : '')).toLowerCase();
      const ok = words.every(w => hay.indexOf(w) >= 0);
      li.hidden = !ok;
      const nm = li.querySelector('.name');
      if (ok && words.length) {
        let t = esc(g.def.name);
        words.forEach(w => { t = t.replace(new RegExp('(' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig'), '<mark>$1</mark>'); });
        nm.innerHTML = t;
      } else nm.textContent = g.def.name;
      if (ok) { n++; matched.push(k); }
    });
    $$('.reg').forEach(r => { r.hidden = !r.querySelector('li:not([hidden])'); });
    $$('.sys').forEach(s => { s.hidden = !s.querySelector('li:not([hidden])'); });
    $('#tree-empty').hidden = n > 0;
    $('#search-meta').textContent = words.length ? n + (n === 1 ? ' match' : ' matches') : Object.keys(groups).length + ' structures, ' + V.partList.length + ' parts';
    UI._first = matched[0];
  }

  // phones: keep the model visible above the bottom sheet
  function layoutShift() {
    const mobile = window.matchMedia('(max-width: 900px)').matches;
    const card = $('#info:not([hidden])') || $('#quiz:not([hidden])');
    V.setViewShift(mobile && card ? (card.offsetHeight + 74) / 2 : 0);
  }
  window.addEventListener('resize', layoutShift);

  // ------------------------------------------------------------------ selection + info card
  function select(id, opts) {
    opts = opts || {};
    if (quiz.on) return;
    if (!id) { deselect(); return; }
    reveal(id);
    V.setSelected(id);
    renderInfo();
    refreshTree();
    const row = rowEls[parts[id].def.key];
    if (row && opts.scroll !== false) { sysEls[parts[id].system].classList.add('open'); row.scrollIntoView({ block: 'nearest' }); }
    if (opts.focus) V.focus(id);
  }
  function deselect() {
    if (!S.selected) return;
    V.setSelected(null);
    $('#info').hidden = true;
    refreshTree();
    layoutShift();
  }
  function renderInfo() {
    const p = parts[S.selected];
    if (!p) { $('#info').hidden = true; return; }
    const d = p.def;
    $('#info').hidden = false;
    $('#i-name').textContent = p.name;
    $('#i-dot').style.setProperty('--c', SYS[p.system].color);
    const chips = $('#i-chips'); chips.textContent = '';
    chips.appendChild(el('span', { class: 'chip' }, [el('span', { class: 'dot', style: '--c:' + SYS[p.system].color }), SYS[p.system].label + (p.layer === 'deep' ? ' (deep)' : '')]));
    chips.appendChild(el('span', { class: 'chip', text: p.region }));
    $('#i-desc').textContent = d.desc;
    $('#i-fn').textContent = d.fn;
    const sides = $('#i-sides');
    sides.hidden = !d.sided;
    if (d.sided) sides.querySelectorAll('button').forEach(b => {
      b.classList.toggle('on', b.dataset.side === (p.side > 0 ? 'l' : 'r'));
      b.onclick = () => select(d.key + '_' + b.dataset.side, { focus: true });
    });
    const rel = $('#i-rel'); rel.textContent = '';
    p.neighbours.slice(0, 6).forEach(id => {
      const q = parts[id];
      rel.appendChild(el('button', { class: 'chip', type: 'button', text: q.name, onclick: () => select(id, { focus: true }) }));
    });
    $('#i-rel-wrap').hidden = !p.neighbours.length;
    syncIsolateButton();
    if (window.matchMedia('(max-width: 900px)').matches) closePanel();
    layoutShift();
  }
  function syncIsolateButton() {
    const b = $('#i-isolate'); if (!b) return;
    const on = !!S.isolate;
    b.setAttribute('aria-pressed', String(on));
  }
  function isolateSelected() {
    if (S.isolate) { S.isolate = null; toast('Showing all visible layers again'); touchVis(); return; }
    if (!S.selected) { toast('Select a part first'); return; }
    const p = parts[S.selected];
    S.isolate = new Set([p.id]);
    toast('Isolated ' + p.name + '. Press I to restore');
    touchVis();
  }
  function hideSelected() {
    if (!S.selected) { toast('Select a part first'); return; }
    const p = parts[S.selected];
    S.hidden.add(p.id);
    deselect();
    toast('Hid ' + p.name + '. Shift+H shows everything');
    touchVis();
  }
  function showAll() {
    S.hidden.clear(); S.isolate = null;
    touchVis(); toast('Everything visible again');
  }
  function bindInfo() {
    $('#info-close').onclick = deselect;
    $('#i-focus').onclick = () => S.selected && V.focus(S.selected);
    $('#i-isolate').onclick = isolateSelected;
    $('#i-hide').onclick = hideSelected;
  }

  // ------------------------------------------------------------------ canvas interaction
  const canvas = $('#c'), tooltip = $('#tooltip');
  let down = null, hoverReq = false, lastMove = null, lastTap = 0, lastTapId = null;
  function onClickPart(id) {
    if (quiz.on) { quizPick(id); return; }
    if (id) select(id, { scroll: true }); else deselect();
  }
  canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; tooltip.hidden = true; });
  canvas.addEventListener('pointerup', e => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t;
    down = null;
    if (moved > 6 || dt > 600) return;
    const id = V.pick(e.clientX, e.clientY);
    const now = performance.now();
    const dbl = e.pointerType === 'touch' ? (now - lastTap < 320 && lastTapId === id) : false;
    lastTap = now; lastTapId = id;
    if (dbl) { if (id) { select(id, { focus: true }); } else V.resetView(); return; }
    onClickPart(id);
  });
  canvas.addEventListener('dblclick', e => {
    if (e.pointerType === 'touch') return;
    const id = V.pick(e.clientX, e.clientY);
    if (quiz.on) return;
    if (id) select(id, { focus: true }); else V.resetView();
  });
  canvas.addEventListener('pointermove', e => {
    if (e.buttons || e.pointerType === 'touch') return;
    lastMove = { x: e.clientX, y: e.clientY };
    if (hoverReq) return;
    hoverReq = true;
    requestAnimationFrame(() => {
      hoverReq = false;
      if (!lastMove) return;
      const id = V.pick(lastMove.x, lastMove.y);
      V.setHover(id);
      canvas.classList.toggle('over', !!id);
      if (id && !quiz.on) {
        const p = parts[id], r = $('#stage').getBoundingClientRect();
        tooltip.textContent = '';
        tooltip.appendChild(el('span', { class: 'dot', style: '--c:' + SYS[p.system].color }));
        tooltip.appendChild(document.createTextNode(p.name));
        tooltip.hidden = false;
        const w = tooltip.offsetWidth;
        tooltip.style.left = Math.max(8, Math.min(lastMove.x - r.left + 16, r.width - w - 8)) + 'px';
        tooltip.style.top = Math.max(8, lastMove.y - r.top + 18) + 'px';
      } else tooltip.hidden = true;
    });
  });
  canvas.addEventListener('pointerleave', () => { lastMove = null; V.setHover(null); tooltip.hidden = true; canvas.classList.remove('over'); });
  V.on('label-click', id => { if (!quiz.on) select(id, { focus: true }); });

  // ------------------------------------------------------------------ toolbar, section, opacity
  function setPopover(which) {
    const map = { opacity: '#pop-opacity', section: '#pop-section' };
    Object.keys(map).forEach(k => {
      const show = k === which && $(map[k]).hidden;
      $(map[k]).hidden = !show;
      $('#tb-' + k).setAttribute('aria-expanded', String(show));
    });
  }
  function secPositionFromSlider() {
    const k = S.clip, r = V.clipRange(k.axis);
    const v = +$('#section-pos').value / 1000;
    return r[0] + (r[1] - r[0]) * v;
  }
  function updateSection(toggleOn) {
    const k = S.clip;
    const pos = secPositionFromSlider();
    V.setClip({ pos, on: toggleOn === undefined ? k.on : toggleOn });
    const names = { x: 'Sagittal', z: 'Coronal', y: 'Transverse' };
    $('#section-out').textContent = names[k.axis] + ' · ' + (pos * 100).toFixed(0) + ' cm';
    $('#tb-section').setAttribute('aria-pressed', String(S.clip.on));
  }
  function bindToolbar() {
    $('#tb-reset').onclick = () => V.resetView();
    $$('#toolbar .seg button').forEach(b => { b.onclick = () => V.viewFrom(b.dataset.view); });
    $('#tb-labels').onclick = toggleLabels;
    $('#tb-opacity').onclick = () => setPopover('opacity');
    $('#tb-section').onclick = () => {
      if (!S.clip.on) { updateSection(true); }
      setPopover('section');
    };
    $('#opacity').oninput = e => {
      S.globalAlpha = +e.target.value / 100;
      $('#opacity-out').textContent = e.target.value + '%';
      V.markVisDirty(); V.requestShadow();
    };
    $$('#section-axis button').forEach(b => {
      b.onclick = () => {
        $$('#section-axis button').forEach(x => x.classList.toggle('on', x === b));
        S.clip.axis = b.dataset.axis;
        const r = V.clipRange(b.dataset.axis);
        $('#section-pos').value = Math.round((0 - r[0]) / (r[1] - r[0]) * 1000);
        if (b.dataset.axis === 'y') $('#section-pos').value = 800;
        if (b.dataset.axis === 'z') $('#section-pos').value = Math.round((0.0 - r[0]) / (r[1] - r[0]) * 1000);
        updateSection(true);
      };
    });
    $('#section-pos').oninput = () => updateSection(true);
    $('#section-flip').onclick = () => { S.clip.flip = !S.clip.flip; updateSection(true); };
    $('#section-off').onclick = () => { updateSection(false); setPopover(null); };
  }
  function toggleLabels() {
    const on = !S.labels;
    V.setLabels(on);
    $('#tb-labels').setAttribute('aria-pressed', String(on));
    toast(on ? 'Labels on. Click a label to open it' : 'Labels off');
  }
  function toggleSection() {
    if (S.clip.on) { updateSection(false); setPopover(null); } else { updateSection(true); setPopover('section'); }
  }

  // ------------------------------------------------------------------ panel, theme, help
  function closePanel() { $('#app').dataset.panel = 'closed'; $('#btn-panel').setAttribute('aria-expanded', 'false'); $('#scrim').hidden = true; setTimeout(resizeSoon, 320); }
  function openPanel() { $('#app').dataset.panel = 'open'; $('#btn-panel').setAttribute('aria-expanded', 'true'); $('#scrim').hidden = !window.matchMedia('(max-width: 900px)').matches; setTimeout(resizeSoon, 320); }
  function togglePanel() { ($('#app').dataset.panel === 'open') ? closePanel() : openPanel(); }
  function resizeSoon() { window.dispatchEvent(new Event('resize')); }
  function setTheme(t) {
    document.documentElement.dataset.theme = t;
    store.set('anatomy-theme', t);
    $('#btn-theme use').setAttribute('href', t === 'dark' ? '#i-sun' : '#i-moon');
    V.setTheme && V.setTheme(t);
  }
  function openHelp() { $('#help').hidden = false; $('#help-close').focus(); }
  function closeHelp() { $('#help').hidden = true; }

  // ------------------------------------------------------------------ quiz
  const quiz = { on: false, mode: 'find', scope: 'visible', n: 0, total: 10, score: 0, streak: 0, best: 0, right: 0, cur: null, answered: false, hinted: false, pool: [], asked: [], missed: [], used: new Set(), choices: [] };
  function setQuizHowto() {
    $('#quiz-howto').textContent = quiz.mode === 'find'
      ? 'You get a name. Click that part in the 3D view. Turn layers on or off first to change what is in play.'
      : 'A part flashes in the 3D view. Choose its name from four options.';
  }
  function openQuiz() {
    quiz.on = true;
    deselect();
    V.clearFlags();
    V.setLabels(false); $('#tb-labels').setAttribute('aria-pressed', 'false');
    $('#quiz').hidden = false; $('#info').hidden = true;
    $('#quiz-setup').hidden = false; $('#quiz-play').hidden = true; $('#quiz-done').hidden = true;
    $('#btn-quiz').setAttribute('aria-pressed', 'true');
    $('#btn-quiz span').textContent = 'Exit quiz';
    setQuizHowto();
    $('#tooltip').hidden = true;
    V.resetView();
    layoutShift();
  }
  function closeQuiz() {
    quiz.on = false; quiz.cur = null;
    $('#quiz').hidden = true;
    V.clearFlags();
    if (S.selected) { V.setFlag(S.selected, 'selected', true); renderInfo(); }
    $('#btn-quiz').setAttribute('aria-pressed', 'false');
    $('#btn-quiz span').textContent = 'Quiz';
    layoutShift();
  }
  function scopeParts() {
    const sc = quiz.scope;
    if (sc === 'visible') return V.partList.filter(p => partVisible(p) && p.pickable);
    if (sc === 'all') return V.partList.slice();
    return V.partList.filter(p => p.system === sc && (p.system !== 'muscles' || true));
  }
  function prepareScope() {
    const sc = quiz.scope;
    if (sc === 'visible') return;
    SYS_KEYS.forEach(k => { S.sysOn[k] = false; S.sysAlpha[k] = 1; });
    if (sc === 'all') { SYS_KEYS.forEach(k => { S.sysOn[k] = true; }); S.muscleLayer.superficial = true; S.muscleLayer.deep = true; S.sysAlpha.skeleton = 0.55; S.sysAlpha.muscles = 0.55; }
    else {
      S.sysOn[sc] = true;
      if (sc === 'muscles') { S.muscleLayer.superficial = true; S.muscleLayer.deep = true; S.sysOn.skeleton = true; S.sysAlpha.skeleton = 0.2; }
      else if (sc !== 'skeleton') { S.sysOn.skeleton = true; S.sysAlpha.skeleton = 0.2; }
    }
    S.hidden.clear(); S.isolate = null; activePreset = '';
    touchVis();
  }
  function startQuiz(onlyIds) {
    if (!onlyIds) { quiz.scope = $('#quiz-scope').value; prepareScope(); }
    quiz.pool = onlyIds ? onlyIds.map(id => parts[id]) : scopeParts();
    quiz.pool.forEach(p => { if (!partVisible(p)) reveal(p.id); });
    if (quiz.pool.length < 4) { toast('Switch on more layers: the quiz needs at least 4 visible parts'); return; }
    quiz.n = 0; quiz.score = 0; quiz.streak = 0; quiz.best = 0; quiz.right = 0; quiz.missed = []; quiz.used = new Set();
    quiz.total = Math.min(10, quiz.pool.length);
    $('#quiz-setup').hidden = true; $('#quiz-done').hidden = true; $('#quiz-play').hidden = false;
    V.resetView();
    nextQuestion();
    layoutShift();
  }
  function nextQuestion() {
    V.clearFlags();
    requestAnimationFrame(layoutShift);
    if (quiz.n >= quiz.total) { finishQuiz(); return; }
    let cands = quiz.pool.filter(p => !quiz.used.has(p.id));
    if (!cands.length) { quiz.used.clear(); cands = quiz.pool; }
    const p = cands[Math.floor(Math.random() * cands.length)];
    quiz.used.add(p.id);
    quiz.cur = p; quiz.answered = false; quiz.hinted = false; quiz.n++;
    $('#q-feedback').textContent = ''; $('#q-feedback').className = 'feedback';
    $('#q-next').hidden = true; $('#q-skip').hidden = false; $('#q-hint').hidden = false;
    $('#q-hint').disabled = false;
    updateQuizStats();
    const ch = $('#q-choices'); ch.textContent = '';
    if (quiz.mode === 'find') {
      $('#q-prompt').textContent = 'Find and click: ' + p.name;
    } else {
      $('#q-prompt').textContent = 'Which part is outlined?';
      V.setFlag(p.id, 'target', true);
      V.focus(p.id, { wide: true });
      const same = shuffle(quiz.pool.filter(q => q !== p && q.system === p.system && q.name !== p.name));
      const rest = shuffle(quiz.pool.filter(q => q !== p && q.system !== p.system && q.name !== p.name));
      const picks = shuffle([p].concat(same.concat(rest).slice(0, 3)));
      quiz.choices = picks;
      picks.forEach((q, i) => {
        ch.appendChild(el('button', { type: 'button', 'data-id': q.id, onclick: () => answer(q.id) }, [el('kbd', { text: String(i + 1) }), q.name]));
      });
    }
  }
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function updateQuizStats() {
    $('#q-count').textContent = Math.min(quiz.n, quiz.total) + ' / ' + quiz.total;
    $('#q-score').textContent = quiz.score + ' pts';
    $('#q-streak').textContent = quiz.streak > 1 ? quiz.streak + ' in a row' : '';
    const done = quiz.answered ? quiz.n : quiz.n - 1;
    $('#quiz-bar').style.width = Math.round(done / quiz.total * 100) + '%';
    const pb = $('#quiz-play .progress'); pb.setAttribute('aria-valuenow', String(done)); pb.setAttribute('aria-valuemax', String(quiz.total));
  }
  function answer(id) {
    if (!quiz.cur || quiz.answered) return;
    requestAnimationFrame(layoutShift);
    const p = quiz.cur, ok = id === p.id;
    quiz.answered = true;
    if (ok) {
      quiz.streak++; quiz.best = Math.max(quiz.best, quiz.streak); quiz.right++;
      const pts = Math.max(25, 100 + 10 * Math.min(quiz.streak - 1, 5) - (quiz.hinted ? 40 : 0));
      quiz.score += pts;
    } else { quiz.streak = 0; quiz.missed.push(p.id); }
    V.setFlag(p.id, 'target', false);
    V.setFlag(p.id, 'result', 'correct');
    if (!ok && parts[id]) V.setFlag(id, 'result', 'wrong');
    V.focus(p.id, { wide: true });
    const fb = $('#q-feedback');
    fb.className = 'feedback';
    fb.textContent = '';
    fb.appendChild(el('strong', { class: ok ? 'good' : 'bad', text: ok ? 'Correct. ' : (parts[id] ? 'Not quite, that was ' + parts[id].name + '. ' : 'Not quite. ') }));
    fb.appendChild(document.createTextNode(p.name + ': ' + p.def.fn));
    $('#q-choices').querySelectorAll('button').forEach(b => {
      b.disabled = true;
      if (b.dataset.id === p.id) b.classList.add('good'); else if (b.dataset.id === id) b.classList.add('bad');
    });
    $('#q-next').hidden = false; $('#q-skip').hidden = true; $('#q-hint').hidden = true;
    $('#q-next').firstChild.nodeValue = quiz.n >= quiz.total ? 'Finish ' : 'Next ';
    updateQuizStats();
    $('#q-next').focus({ preventScroll: true });
  }
  function quizPick(id) {
    if (!quiz.cur || quiz.mode !== 'find' || quiz.answered || !id) return;
    answer(id);
  }
  function skipQuestion() {
    if (!quiz.cur || quiz.answered) return;
    quiz.answered = true; quiz.streak = 0; quiz.missed.push(quiz.cur.id);
    V.setFlag(quiz.cur.id, 'target', false);
    V.setFlag(quiz.cur.id, 'result', 'correct');
    V.focus(quiz.cur.id, { wide: true });
    $('#q-feedback').className = 'feedback';
    $('#q-feedback').textContent = 'Skipped. It was ' + quiz.cur.name + ': ' + quiz.cur.def.fn;
    $('#q-next').hidden = false; $('#q-skip').hidden = true; $('#q-hint').hidden = true;
    $('#q-next').firstChild.nodeValue = quiz.n >= quiz.total ? 'Finish ' : 'Next ';
    updateQuizStats();
  }
  function hint() {
    if (!quiz.cur || quiz.answered || quiz.hinted) return;
    quiz.hinted = true;
    const p = quiz.cur;
    const fb = $('#q-feedback');
    fb.className = 'feedback';
    fb.textContent = 'Hint: ' + SYS[p.system].label.toLowerCase() + ', ' + p.region.toLowerCase() + '. Function: ' + p.def.fn.split(/[;:.]/)[0] + '. (-40 pts)';
    $('#q-hint').disabled = true;
    if (quiz.mode === 'find') V.focus(p.id, { wide: true });
  }
  function finishQuiz() {
    V.clearFlags();
    $('#quiz-play').hidden = true; $('#quiz-done').hidden = false;
    const pct = Math.round(quiz.right / quiz.total * 100);
    $('#done-score').textContent = quiz.score + ' pts';
    $('#done-line').textContent = quiz.right + ' of ' + quiz.total + ' correct (' + pct + '%) · best streak ' + quiz.best + '. ' +
      (pct === 100 ? 'Perfect round.' : pct >= 70 ? 'Solid. Review the misses below.' : 'Keep going, the misses below are worth a look.');
    const m = $('#done-missed'); m.textContent = '';
    quiz.missed.forEach(id => {
      m.appendChild(el('button', { class: 'chip', type: 'button', text: parts[id].name, onclick: () => { closeQuiz(); select(id, { focus: true }); } }));
    });
    $('#done-review').hidden = !quiz.missed.length;
    $('#quiz-bar').style.width = '100%';
    layoutShift();
  }
  function bindQuiz() {
    $('#btn-quiz').onclick = () => (quiz.on ? closeQuiz() : openQuiz());
    $('#quiz-close').onclick = closeQuiz;
    $('#quiz-start').onclick = () => startQuiz();
    $$('#quiz-mode button').forEach(b => { b.onclick = () => {
      quiz.mode = b.dataset.mode;
      $$('#quiz-mode button').forEach(x => x.classList.toggle('on', x === b));
      setQuizHowto();
      if (!$('#quiz-play').hidden) { quiz.n = Math.max(0, quiz.n - 1); nextQuestion(); }
    }; });
    $('#q-hint').onclick = hint;
    $('#q-skip').onclick = skipQuestion;
    $('#q-next').onclick = nextQuestion;
    $('#done-again').onclick = () => { $('#quiz-done').hidden = true; $('#quiz-setup').hidden = false; };
    $('#done-review').onclick = () => startQuiz(quiz.missed.slice());
  }

  // ------------------------------------------------------------------ keyboard
  function bindKeys() {
    window.addEventListener('keydown', e => {
      const t = e.target, typing = t && (t.tagName === 'INPUT' && t.type !== 'range' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
      if (e.key === 'Escape') {
        if (!$('#help').hidden) { closeHelp(); return; }
        if (typing && t.id === 'search') { t.value = ''; runSearch(); t.blur(); return; }
        if (!$('#pop-opacity').hidden || !$('#pop-section').hidden) { setPopover(null); return; }
        if (quiz.on) { closeQuiz(); return; }
        deselect(); return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) {
        if (t && t.id === 'search' && e.key === 'Enter' && UI._first) { selectGroup(UI._first); }
        return;
      }
      const k = e.key;
      if (quiz.on && !$('#quiz-play').hidden) {
        if (quiz.mode === 'name' && k >= '1' && k <= '4' && !quiz.answered) { const b = $('#q-choices').children[+k - 1]; if (b) { b.click(); e.preventDefault(); return; } }
        if (k === 'Enter' && quiz.answered) { nextQuestion(); e.preventDefault(); return; }
        if (k.toLowerCase() === 'h') { hint(); return; }
      }
      const pr = A.PRESETS.find(x => x.key === k);
      if (pr) { applyPreset(pr); return; }
      switch (k) {
        case '/': e.preventDefault(); openPanel(); $('#search').focus(); $('#search').select(); break;
        case '?': openHelp(); break;
        case 'f': case 'F': if (S.selected) V.focus(S.selected); break;
        case 'i': case 'I': isolateSelected(); break;
        case 'h': hideSelected(); break;
        case 'H': showAll(); break;
        case 'r': case 'R': V.resetView(); break;
        case 'l': case 'L': toggleLabels(); break;
        case 'x': case 'X': toggleSection(); break;
        case 'q': case 'Q': (quiz.on ? closeQuiz : openQuiz)(); break;
        case 't': case 'T': setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); break;
        case 'p': case 'P': togglePanel(); break;
        default: break;
      }
    });
  }

  // ------------------------------------------------------------------ init
  UI.init = function () {
    buildPresets();
    buildTree();
    bindInfo(); bindToolbar(); bindQuiz(); bindKeys();
    $('#search').addEventListener('input', runSearch);
    runSearch();
    $('#btn-panel').onclick = togglePanel;
    $('#scrim').onclick = closePanel;
    $('#btn-theme').onclick = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
    $('#btn-help').onclick = openHelp;
    $('#help-close').onclick = closeHelp;
    $('#help').addEventListener('click', e => { if (e.target === $('#help')) closeHelp(); });
    setTheme(document.documentElement.dataset.theme);
    V.initLabels($('#label-layer'));
    if (window.matchMedia('(max-width: 900px)').matches) { $('#app').dataset.panel = 'closed'; $('#btn-panel').setAttribute('aria-expanded', 'false'); }
    const first = A.PRESETS[0];
    applyPreset(first);
    updateSection(false);
    // deep links: #part=heart  #quiz=find|name  #preset=muscles  #labels
    const h = new URLSearchParams(location.hash.slice(1));
    if (h.get('preset')) { const pr = A.PRESETS.find(x => x.id === h.get('preset')); if (pr) applyPreset(pr); }
    if (h.has('labels')) toggleLabels();
    if (h.get('part') && parts[h.get('part')]) select(h.get('part'), { focus: true });
    if (h.get('section')) { const a = h.get('section'); if ('xyz'.indexOf(a) >= 0) { const b = $('#section-axis button[data-axis="' + a + '"]'); if (b) b.click(); setPopover('section'); } }
    if (h.get('quiz') === 'find' || h.get('quiz') === 'name') {
      openQuiz(); quiz.mode = h.get('quiz');
      $$('#quiz-mode button').forEach(x => x.classList.toggle('on', x.dataset.mode === quiz.mode));
      setQuizHowto(); startQuiz();
    }
  };
  UI.api = { select, applyPreset, quiz, openQuiz, startQuiz, answer, nextQuestion, partVisible, runSearch, isolateSelected, hideSelected, showAll, toggleLabels, updateSection, setTheme };
})();
