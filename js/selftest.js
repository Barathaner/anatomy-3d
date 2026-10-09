/* In-page smoke test. Open the site with ?selftest and read <html data-selftest> or the console. */
(function () {
  'use strict';
  const pass = [], fail = [];
  const ok = (c, msg) => (c ? pass : fail).push(msg);
  const wait = ms => new Promise(r => setTimeout(r, ms));

  async function run() {
    const X = window.__anatomy, V = X.Viewer, U = X.UI.api, A = window.ANATOMY, S = V.state;
    const ids = V.partList.map(p => p.id);
    ok(ids.length >= 150, 'model has ' + ids.length + ' parts');
    ok(ids.every(i => V.parts[i].def.desc && V.parts[i].def.fn), 'every part has a description and a function text');
    Object.keys(A.SYSTEMS).forEach(s => ok(ids.filter(i => V.parts[i].system === s).length >= 8, 'system ' + s + ' populated'));
    ok(ids.every(i => V.parts[i].meshes.length > 0 && V.parts[i].size.length() > 0), 'every part has geometry');

    // presets drive visibility
    A.PRESETS.forEach(pr => {
      U.applyPreset(pr);
      const on = Object.keys(S.sysOn).filter(k => S.sysOn[k]).sort().join(',');
      const want = Object.keys(pr.systems).filter(k => pr.systems[k] > 0).sort().join(',');
      ok(on === want, 'preset ' + pr.id + ' shows ' + want);
    });

    // GPU picking: one system at a time, aim at each part's surface anchor
    let hit = 0, tried = 0;
    for (const sys of Object.keys(A.SYSTEMS)) {
      S.sysOn = { skeleton: false, muscles: false, organs: false, circulatory: false, nervous: false }; S.sysOn[sys] = true;
      S.sysAlpha = { skeleton: 1, muscles: 1, organs: 1, circulatory: 1, nervous: 1 }; S.muscleLayer.superficial = true; S.muscleLayer.deep = true;
      V.markVisDirty();
      await wait(1300);
      V.partList.filter(p => p.system === sys).forEach(p => {
        const sp = V.screenPos(p.id); if (!sp || sp.z > 1) return;
        tried++;
        const got = V.pick(sp.x, sp.y);
        if (got) ok(V.parts[got].system === sys, 'pick stays inside visible layer');
        if (got === p.id) hit++;
      });
    }
    ok(tried > 100 && hit / tried > 0.6, 'GPU pick hit rate ' + hit + '/' + tried);

    // select / isolate / hide
    U.applyPreset(A.PRESETS[0]);
    U.select('femur_l');
    ok(S.selected === 'femur_l' && !document.getElementById('info').hidden, 'select shows the info card');
    ok(document.getElementById('i-name').textContent === 'Femur (left)', 'info card names the part');
    U.isolateSelected(); ok(S.isolate && S.isolate.size === 1, 'isolate');
    U.showAll(); ok(!S.isolate && S.hidden.size === 0, 'show all');
    U.hideSelected(); ok(S.hidden.has('femur_l'), 'hide');
    U.showAll();
    U.select('biceps_l'); ok(S.sysOn.muscles === true, 'selecting a hidden-layer part reveals its layer');

    // search
    const input = document.getElementById('search');
    input.value = 'femur'; input.dispatchEvent(new Event('input'));
    const rows = document.querySelectorAll('#tree .row:not([hidden])').length;
    ok(rows >= 2 && rows <= 6, 'search "femur" -> ' + rows + ' rows');
    input.value = 'qzxqzx'; input.dispatchEvent(new Event('input'));
    ok(!document.getElementById('tree-empty').hidden, 'empty search shows a hint');
    input.value = ''; input.dispatchEvent(new Event('input'));

    // section
    U.updateSection(true);
    ok(V.renderer().clippingPlanes.length === 1, 'cross-section enables a clip plane');
    U.updateSection(false);
    ok(V.renderer().clippingPlanes.length === 0, 'cross-section off');

    // quiz
    U.applyPreset(A.PRESETS[0]);
    U.openQuiz();
    document.getElementById('quiz-start').click();
    ok(U.quiz.on && !!U.quiz.cur, 'quiz starts');
    const q1 = U.quiz.cur;
    U.answer(q1.id);
    ok(U.quiz.score >= 25 && U.quiz.right === 1, 'correct answer scores');
    U.nextQuestion();
    const wrong = ids.find(i => i !== U.quiz.cur.id);
    U.answer(wrong);
    ok(U.quiz.streak === 0 && U.quiz.right === 1, 'wrong answer breaks the streak');
    document.getElementById('quiz-close').click();
    ok(!U.quiz.on, 'quiz closes');

    // theme
    const t0 = document.documentElement.dataset.theme;
    U.setTheme(t0 === 'dark' ? 'light' : 'dark');
    ok(document.documentElement.dataset.theme !== t0, 'theme toggles');
    U.setTheme(t0);

    ok(X.errors.length === 0, 'no runtime errors ' + JSON.stringify(X.errors.slice(0, 3)));
    U.applyPreset(A.PRESETS[0]);
  }
  function done() {
    document.documentElement.dataset.selftest = JSON.stringify({ pass: pass.length, fail: fail.length, failures: fail });
    console.log('SELFTEST ' + pass.length + ' passed, ' + fail.length + ' failed ' + JSON.stringify(fail));
  }
  const start = () => run().then(done, e => { fail.push('exception: ' + e.message); done(); });
  if (document.documentElement.dataset.ready === '1') start();
  else { const iv = setInterval(() => { if (document.documentElement.dataset.ready === '1') { clearInterval(iv); start(); } }, 200); }
})();
