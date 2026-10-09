/* Boot: start the viewer, load the model with a progress bar, then build the UI. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const errors = [];
  function note(msg) {
    errors.push(String(msg));
    document.documentElement.dataset.errors = String(errors.length);
  }
  window.addEventListener('error', e => note(e.message));
  window.addEventListener('unhandledrejection', e => note(e.reason && e.reason.message || e.reason));

  function fatal(msg) {
    $('#nogl-msg').textContent = msg;
    $('#nogl').hidden = false;
    $('#loading').classList.add('done');
  }
  function progress(f, msg) {
    $('#load-bar').style.width = Math.max(3, Math.round(f * 100)) + '%';
    if (msg) $('#load-msg').textContent = msg;
  }

  async function boot() {
    try {
      Viewer.init($('#c'), $('#stage'));
    } catch (e) {
      note(e.message);
      fatal('WebGL could not start (' + e.message + '). Try a current Chrome, Edge, Firefox or Safari with hardware acceleration enabled.');
      return;
    }
    try {
      await Viewer.load(progress);
    } catch (e) {
      note(e.message);
      fatal('The anatomy model failed to load: ' + e.message);
      return;
    }
    UI.init();
    progress(1, 'Ready');
    setTimeout(() => $('#loading').classList.add('done'), 150);
    document.documentElement.dataset.ready = '1';
    document.documentElement.dataset.parts = String(Viewer.partList.length);
  }
  window.__anatomy = { Viewer: window.Viewer, UI: window.UI, errors };
  boot();
})();
