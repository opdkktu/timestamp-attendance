/**
 * SIAGA — Emergency alert screen + siren (shared by dashboard.html and emergency.html)
 *
 *   SiagaEmergency.show({id, at})         full-screen red alert + siren
 *   SiagaEmergency.check(apiUrl)          asks the server "is there an emergency right now?" and shows it if so
 *   SiagaEmergency.page(apiUrl)           for emergency.html (shows the "no emergency" state too)
 *   SiagaEmergency.stop()                 silence the siren
 *
 * Siren sound: ./siren.mp3 (put your file next to the HTML files). If it is missing, a built-in
 * two-tone siren is generated, so the alarm never fails silently.
 * Browsers only let a page make sound after the person has touched it once — when a phone is
 * locked or the app was just opened from a notification, the alert shows one huge
 * "BUNYIKAN SIREN" button instead (and starts by itself the moment it is allowed).
 */
(function(){
  var SIREN_SRC = './siren.mp3';
  var DEFAULT_API = 'https://script.google.com/macros/s/AKfycbxOamlCtYPlZCvQOys1VTjkZu7aVqMsdDStTdytPex7eH5jNGuIBiR91BfougaEF3SI/exec';
  var retryTimer = null, primed = false, watching = false, pollTimer = null;
  var audio = null, ctx = null, synth = null, playing = false, vibTimer = null, wake = null;
  var overlay = null, current = null, ageTimer = null, pageMode = false;

  /* ---------- styles + DOM ---------- */
  function build(){
    if(overlay) return;
    var css = document.createElement('style');
    css.textContent =
      '.sos-ov{position:fixed;inset:0;z-index:99999;display:none;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px;color:#fff;font-family:Poppins,Inter,system-ui,sans-serif;background:#b3001b;}' +
      '.sos-ov.show{display:flex;animation:sosBg 1s ease-in-out infinite;}' +
      '@keyframes sosBg{0%,100%{background:#b3001b}50%{background:#e5112f}}' +
      '.sos-ring{width:120px;height:120px;border-radius:50%;background:rgba(255,255,255,.16);display:flex;align-items:center;justify-content:center;font-size:62px;margin-bottom:18px;animation:sosPulse 1s ease-out infinite;}' +
      '@keyframes sosPulse{0%{box-shadow:0 0 0 0 rgba(255,255,255,.55)}100%{box-shadow:0 0 0 38px rgba(255,255,255,0)}}' +
      '.sos-title{font-size:28px;font-weight:800;line-height:1.15;letter-spacing:.01em;}' +
      '.sos-sub{margin-top:10px;font-size:15px;opacity:.92;max-width:320px;line-height:1.5;}' +
      '.sos-age{margin-top:14px;font-size:13px;font-weight:700;background:rgba(0,0,0,.25);padding:6px 14px;border-radius:99px;}' +
      '.sos-btn{margin-top:22px;width:min(320px,100%);height:58px;border-radius:18px;border:none;font-weight:800;font-size:16px;cursor:pointer;font-family:inherit;}' +
      '.sos-btn.main{background:#fff;color:#b3001b;box-shadow:0 10px 30px rgba(0,0,0,.35);animation:sosBtn 1s ease-in-out infinite;}' +
      '@keyframes sosBtn{0%,100%{transform:scale(1)}50%{transform:scale(1.04)}}' +
      '.sos-btn.ghost{background:rgba(255,255,255,.16);color:#fff;border:1px solid rgba(255,255,255,.4);height:48px;font-size:14px;margin-top:12px;}' +
      '.sos-btn[hidden]{display:none;}' +
      '@media (prefers-reduced-motion:reduce){.sos-ov.show,.sos-ring,.sos-btn.main{animation:none}}';
    document.head.appendChild(css);

    overlay = document.createElement('div');
    overlay.className = 'sos-ov';
    overlay.setAttribute('role', 'alertdialog');
    overlay.setAttribute('aria-live', 'assertive');
    overlay.setAttribute('aria-label', 'Amaran kecemasan');
    overlay.innerHTML =
      '<div class="sos-ring" id="sosIcon">🚨</div>' +
      '<div class="sos-title" id="sosTitle">KECEMASAN!<br>Seseorang memerlukan bantuan</div>' +
      '<div class="sos-sub" id="sosSub">Sila segera ke kaunter / kawasan kecemasan klinik.</div>' +
      '<div class="sos-age" id="sosAge"></div>' +
      '<button class="sos-btn main" id="sosPlay" hidden>🔊 BUNYIKAN SIREN</button>' +
      '<button class="sos-btn ghost" id="sosMute" hidden>🔇 Hentikan siren</button>' +
      '<button class="sos-btn ghost" id="sosClose">Saya faham — tutup</button>';
    document.body.appendChild(overlay);

    document.getElementById('sosPlay').onclick = function(){ start(); };
    document.getElementById('sosMute').onclick = function(){ stop(); };
    document.getElementById('sosClose').onclick = function(){ dismiss(); };
    // any touch on the alert is the "user gesture" the browser wants — use it to start the siren
    overlay.addEventListener('pointerdown', function(){ if(current && !playing) start(); }, true);
  }

  function ackKey(id){ return 'kkah_sos_ack_' + id; }
  function acked(id){ try{ return sessionStorage.getItem(ackKey(id)) === '1'; }catch(e){ return false; } }

  function ageText(at){
    var s = Math.max(0, Math.round((Date.now() - at) / 1000));
    if(s < 60) return 'Dihantar ' + s + ' saat lalu';
    return 'Dihantar ' + Math.round(s / 60) + ' minit lalu';
  }

  /* ---------- siren ---------- */
  function setButtons(){
    var play = document.getElementById('sosPlay'), mute = document.getElementById('sosMute');
    if(play) play.hidden = playing;
    if(mute) mute.hidden = !playing;
  }

  function startSynth(){
    try{
      var AC = window.AudioContext || window.webkitAudioContext;
      if(!AC) return 'blocked';
      if(!ctx) ctx = new AC();
      if(ctx.state === 'suspended') ctx.resume();
      if(ctx.state !== 'running') return 'blocked';
      var osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = 'sawtooth'; gain.gain.value = 0.9;
      osc.connect(gain); gain.connect(ctx.destination); osc.start();
      var high = false;
      function sweep(){
        var t = ctx.currentTime;
        osc.frequency.cancelScheduledValues(t);
        osc.frequency.setValueAtTime(high ? 1250 : 640, t);
        osc.frequency.linearRampToValueAtTime(high ? 640 : 1250, t + 0.85);
        high = !high;
      }
      sweep();
      var iv = setInterval(sweep, 900);
      synth = { stop: function(){ clearInterval(iv); try{ osc.stop(); }catch(e){} try{ osc.disconnect(); }catch(e){} } };
      return 'playing';
    }catch(e){ return 'blocked'; }
  }

  function start(){
    if(playing) return Promise.resolve('playing');
    function ok(){
      playing = true; setButtons(); clearInterval(retryTimer);
      if(navigator.vibrate){ try{ navigator.vibrate([400,200,400,200,400]); }catch(e){} clearInterval(vibTimer); vibTimer = setInterval(function(){ try{ navigator.vibrate([400,200,400]); }catch(e){} }, 1500); }
      try{ if(navigator.wakeLock) navigator.wakeLock.request('screen').then(function(w){ wake = w; }).catch(function(){}); }catch(e){}
      return 'playing';
    }
    try{
      if(!audio){ audio = new Audio(SIREN_SRC); audio.loop = true; audio.preload = 'auto'; audio.volume = 1; }
      return audio.play().then(ok).catch(function(err){
        if(err && err.name === 'NotAllowedError'){ setButtons(); armRetry(); return 'blocked'; }
        // siren.mp3 missing or unsupported → built-in siren
        var r = startSynth();
        if(r === 'playing') return ok();
        setButtons(); return 'blocked';
      });
    }catch(e){
      var r = startSynth();
      if(r === 'playing') return Promise.resolve(ok());
      setButtons(); return Promise.resolve('blocked');
    }
  }

  /** Autoplay was refused → keep trying every second; the very first tap/key/scroll anywhere also starts it. */
  function armRetry(){
    clearInterval(retryTimer);
    retryTimer = setInterval(function(){ if(!current || playing){ clearInterval(retryTimer); return; } start(); }, 1000);
  }

  /** Unlock sound early: the first touch on ANY SIAGA page primes the siren + audio engine, so a later alert can sound by itself. */
  function prime(){
    if(primed) return; primed = true;
    try{
      if(!audio){ audio = new Audio(SIREN_SRC); audio.loop = true; audio.preload = 'auto'; audio.volume = 1; }
      audio.muted = true;
      var p = audio.play();
      var done = function(){ try{ audio.pause(); audio.currentTime = 0; audio.muted = false; }catch(e){} };
      if(p && p.then) p.then(done).catch(function(){ try{ audio.muted = false; }catch(e){} }); else done();
    }catch(e){}
    try{
      var AC = window.AudioContext || window.webkitAudioContext;
      if(AC){ if(!ctx) ctx = new AC(); if(ctx.state === 'suspended') ctx.resume(); }
    }catch(e){}
  }
  function armPrime(){
    var ev = ['pointerdown','touchstart','keydown','click'];
    function once(){ ev.forEach(function(n){ document.removeEventListener(n, once, true); }); prime(); if(current && !playing) start(); }
    ev.forEach(function(n){ document.addEventListener(n, once, true); });
  }

  function stop(){
    clearInterval(retryTimer);
    playing = false;
    try{ if(audio){ audio.pause(); audio.currentTime = 0; } }catch(e){}
    try{ if(synth){ synth.stop(); synth = null; } }catch(e){}
    clearInterval(vibTimer); try{ if(navigator.vibrate) navigator.vibrate(0); }catch(e){}
    try{ if(wake){ wake.release(); wake = null; } }catch(e){}
    setButtons();
  }

  /* ---------- alert ---------- */
  function show(info){
    build();
    info = info || {};
    current = info;
    overlay.style.background = ''; overlay.style.animation = '';
    document.getElementById('sosIcon').textContent = '🚨';
    document.getElementById('sosTitle').innerHTML = 'KECEMASAN!<br>Seseorang memerlukan bantuan';
    document.getElementById('sosSub').textContent = 'Sila segera ke kaunter / kawasan kecemasan klinik.';
    document.getElementById('sosClose').hidden = false;
    var ageEl = document.getElementById('sosAge');
    clearInterval(ageTimer);
    if(info.at){ ageEl.style.display = ''; ageEl.textContent = ageText(info.at); ageTimer = setInterval(function(){ ageEl.textContent = ageText(info.at); }, 5000); }
    else ageEl.style.display = 'none';
    overlay.classList.add('show');
    setButtons();
    start();
  }

  function dismiss(){
    stop();
    clearInterval(ageTimer);
    if(current && current.id){ try{ sessionStorage.setItem(ackKey(current.id), '1'); }catch(e){} }
    current = null;
    if(overlay) overlay.classList.remove('show');
    if(pageMode){ showNone(); }
  }

  function showNone(){
    build();
    stop(); current = null;
    document.getElementById('sosIcon').textContent = '✅';
    document.getElementById('sosTitle').innerHTML = 'Tiada kecemasan aktif';
    document.getElementById('sosSub').textContent = 'Amaran ini telah tamat atau telah ditutup. Jika anda masih memerlukan bantuan, hubungi rakan sekerja secara terus.';
    document.getElementById('sosAge').style.display = 'none';
    document.getElementById('sosPlay').hidden = true;
    document.getElementById('sosMute').hidden = true;
    document.getElementById('sosClose').hidden = true;
    overlay.classList.add('show');
    overlay.style.background = '#0B3D3A'; overlay.style.animation = 'none';
  }

  function ask(apiUrl){
    return fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'getActiveEmergency' }) })
      .then(function(r){ return r.json(); }).catch(function(){ return null; });
  }

  /** Dashboard: show the alert if one is active (and not already dismissed on this device). */
  function check(apiUrl){
    return ask(apiUrl).then(function(d){
      if(d && d.ok && d.active && !acked(d.id) && !(current && current.id === d.id)) show({ id: d.id, at: d.at });
      return d;
    });
  }

  /** emergency.html: show the live alert, or the calm "no emergency" state. */
  function page(apiUrl){
    pageMode = true;
    build();
    function tick(){
      ask(apiUrl).then(function(d){
        if(d && d.ok && d.active){
          if(!current || current.id !== d.id){ overlay.style.background = ''; overlay.style.animation = ''; show({ id: d.id, at: d.at }); }
        }else if(d && d.ok && !d.active && current){ showNone(); }
        else if(d && d.ok && !d.active && !current && !overlay.classList.contains('show')){ showNone(); }
      });
    }
    tick();
    setInterval(tick, 5000);
    armPrime(); listenSw();
    document.addEventListener('visibilitychange', function(){ if(document.visibilityState === 'visible') tick(); });
  }

  /** Dashboard: a push that arrives while the app is open. */
  function fromPush(data){
    if(data && data.type === 'emergency' && !acked(data.id)) show({ id: data.id, at: data.at ? Number(data.at) : Date.now() });
  }

  /** A push the service worker saw (works even when the page is in the background). */
  function listenSw(){
    try{
      if(!('serviceWorker' in navigator) || listenSw.done) return; listenSw.done = true;
      navigator.serviceWorker.addEventListener('message', function(e){
        var d = e && e.data;
        if(d && d.type === 'siaga-emergency') fromPush({ type: 'emergency', id: d.id, at: d.at });
      });
    }catch(e){}
  }

  /**
   * Every SIAGA page: stay ready for an emergency.
   *  - primes sound on the first touch, so the siren can start by itself later
   *  - hears the service worker the instant a push arrives (even if the page is hidden)
   *  - asks the server every 20 s while visible (+ right away on focus / back online / screen on) as a safety net
   */
  function watch(apiUrl){
    apiUrl = apiUrl || window.SIAGA_API || DEFAULT_API;
    if(watching) return; watching = true;
    build(); armPrime(); listenSw();
    function go(){ check(apiUrl); }
    function sched(){ clearTimeout(pollTimer); pollTimer = setTimeout(function(){ if(document.visibilityState === 'visible') go(); sched(); }, 18000 + Math.random() * 4000); }
    document.addEventListener('visibilitychange', function(){ if(document.visibilityState === 'visible') go(); });
    window.addEventListener('focus', go); window.addEventListener('online', go); window.addEventListener('pageshow', go);
    go(); sched();
  }

  window.SiagaEmergency = { watch: watch, prime: prime, show: show, check: check, page: page, stop: stop, fromPush: fromPush, start: start };
})();
