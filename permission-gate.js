/**
 * SIAGA — Location gate (shared by any page that must not run without location).
 * Include with: <script src="./permission-gate.js"></script>
 *
 * Behaviour: on load (and every time the app comes back to the foreground) it checks that
 * location really works — not only that permission was granted, but that the device's
 * Location/GPS switch is on and a fix can be obtained. If not, a full-screen overlay blocks
 * the whole page and explains exactly what to do, then re-checks automatically.
 *
 * API:  SiagaGate.isOk()            → boolean
 *       SiagaGate.onOk(fn)          → fn(position) when location is confirmed (immediately if already)
 *       SiagaGate.recheck()         → force a re-check
 */
(function(){
  var ok = false, lastPos = null, listeners = [], checking = false, pollTimer = null;
  var overlay, elTitle, elBody, elSteps, elBtn, elIcon;

  var css = '' +
  '.pg-ov{position:fixed;inset:0;z-index:9999;display:none;align-items:center;justify-content:center;padding:22px;' +
  'background:radial-gradient(circle at 50% 30%,rgba(0,234,255,.15),transparent 55%),rgba(8,11,24,.97);' +
  'font-family:Inter,Poppins,sans-serif;color:#fff;text-align:center}' +
  '.pg-ov.show{display:flex;animation:pgIn .35s ease both}@keyframes pgIn{from{opacity:0}to{opacity:1}}' +
  '.pg-card{max-width:380px;width:100%}' +
  '.pg-icon{width:92px;height:92px;margin:0 auto 20px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:42px;' +
  'background:rgba(255,93,108,.14);border:2px solid #ff5d6c;box-shadow:0 0 30px rgba(255,93,108,.45);animation:pgPulse 2s infinite}' +
  '.pg-icon.ask{background:rgba(0,234,255,.12);border-color:#00eaff;box-shadow:0 0 30px rgba(0,234,255,.45)}' +
  '@keyframes pgPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.07)}}' +
  '.pg-title{font-size:21px;font-weight:700;margin-bottom:10px}' +
  '.pg-body{font-size:14px;line-height:1.6;color:#c6cbe0;margin-bottom:16px}' +
  '.pg-steps{text-align:left;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:12px 16px 12px 34px;margin:0 0 18px;font-size:13px;line-height:1.7;color:#e3e6f2}' +
  '.pg-btn{width:100%;height:52px;border:none;border-radius:14px;cursor:pointer;font-size:15px;font-weight:700;color:#fff;' +
  'background:linear-gradient(90deg,#00c6ff,#0072ff,#8a2be2);box-shadow:0 10px 28px rgba(0,114,255,.4)}' +
  '.pg-btn:disabled{opacity:.6}' +
  '.pg-foot{margin-top:14px;font-size:11.5px;color:#8a90aa}';

  function build(){
    if(overlay) return;
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    overlay = document.createElement('div');
    overlay.className = 'pg-ov';
    overlay.setAttribute('role', 'alertdialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML =
      '<div class="pg-card">' +
        '<div class="pg-icon" id="pgIcon">📍</div>' +
        '<div class="pg-title" id="pgTitle"></div>' +
        '<div class="pg-body" id="pgBody"></div>' +
        '<ol class="pg-steps" id="pgSteps"></ol>' +
        '<button class="pg-btn" id="pgBtn"></button>' +
        '<div class="pg-foot">SIAGA memerlukan lokasi untuk kehadiran dan keselamatan rekod.</div>' +
      '</div>';
    document.body.appendChild(overlay);
    elTitle = overlay.querySelector('#pgTitle'); elBody = overlay.querySelector('#pgBody');
    elSteps = overlay.querySelector('#pgSteps'); elBtn = overlay.querySelector('#pgBtn'); elIcon = overlay.querySelector('#pgIcon');
    elBtn.addEventListener('click', function(){ check(true); });
  }

  var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);

  function show(kind){
    build();
    var steps = [];
    if(kind === 'ask'){
      elIcon.className = 'pg-icon ask'; elIcon.textContent = '📍';
      elTitle.textContent = 'Benarkan akses lokasi';
      elBody.textContent = 'Ketik butang di bawah, kemudian pilih “Allow / Benarkan” apabila diminta oleh telefon.';
      elBtn.textContent = 'Benarkan Lokasi';
    }else if(kind === 'denied'){
      elIcon.className = 'pg-icon'; elIcon.textContent = '🚫';
      elTitle.textContent = 'Akses lokasi disekat';
      elBody.textContent = 'Pelayar tidak lagi boleh bertanya sendiri. Sila benarkan secara manual:';
      steps = isIOS
        ? ['Buka Tetapan (Settings) iPhone', 'Privasi & Keselamatan → Perkhidmatan Lokasi → hidupkan', 'Cari SIAGA / Safari → pilih “Semasa Menggunakan Apl”', 'Kembali ke SIAGA dan ketik “Semak semula”']
        : ['Ketik ikon 🔒 / tetapan di sebelah alamat laman (atau tahan ikon SIAGA → Info apl)', 'Pilih Kebenaran (Permissions) → Lokasi', 'Tetapkan kepada “Benarkan”', 'Kembali ke SIAGA dan ketik “Semak semula”'];
      elBtn.textContent = 'Semak semula';
    }else if(kind === 'off'){
      elIcon.className = 'pg-icon'; elIcon.textContent = '📡';
      elTitle.textContent = 'Lokasi (GPS) dimatikan';
      elBody.textContent = 'Kebenaran sudah diberi, tetapi suis Lokasi pada telefon anda dimatikan.';
      steps = isIOS
        ? ['Buka Tetapan → Privasi & Keselamatan → Perkhidmatan Lokasi', 'Hidupkan Perkhidmatan Lokasi', 'Kembali ke SIAGA — semakan dibuat automatik']
        : ['Tarik panel pantas dari atas skrin', 'Hidupkan ikon “Lokasi / Location”', 'Kembali ke SIAGA — semakan dibuat automatik'];
      elBtn.textContent = 'Semak semula';
    }else if(kind === 'unsupported'){
      elIcon.className = 'pg-icon'; elIcon.textContent = '⚠️';
      elTitle.textContent = 'Peranti tidak menyokong lokasi';
      elBody.textContent = 'Sila gunakan telefon atau pelayar lain yang menyokong lokasi (Chrome / Safari terkini).';
      elBtn.textContent = 'Cuba lagi';
    }else{ // timeout / unknown
      elIcon.className = 'pg-icon'; elIcon.textContent = '⏳';
      elTitle.textContent = 'Tidak dapat mengesan lokasi';
      elBody.textContent = 'Isyarat GPS lemah. Pergi ke kawasan terbuka atau dekat tingkap, kemudian cuba lagi.';
      elBtn.textContent = 'Cuba lagi';
    }
    elSteps.style.display = steps.length ? 'block' : 'none';
    elSteps.innerHTML = steps.map(function(s){ return '<li>' + s + '</li>'; }).join('');
    elBtn.disabled = false;
    overlay.classList.add('show');
    document.documentElement.style.overflow = 'hidden';
    if(!pollTimer) pollTimer = setInterval(function(){ check(false); }, 4000); // auto-detect when they fix it in Settings
  }

  function hide(){
    if(overlay) overlay.classList.remove('show');
    document.documentElement.style.overflow = '';
    if(pollTimer){ clearInterval(pollTimer); pollTimer = null; }
  }

  function fail(kind){ ok = false; show(kind); }

  function succeed(pos){
    var wasOk = ok;
    ok = true; lastPos = pos; hide();
    if(!wasOk){ listeners.splice(0).forEach(function(fn){ try{ fn(pos); }catch(e){} }); }
  }

  async function permState(){
    try{
      if(navigator.permissions && navigator.permissions.query){
        var r = await navigator.permissions.query({ name: 'geolocation' });
        return r.state; // granted | denied | prompt
      }
    }catch(e){}
    return 'unknown';
  }

  async function check(userGesture){
    if(checking) return;
    if(!navigator.geolocation){ fail('unsupported'); return; }
    checking = true;
    try{
      var st = await permState();
      if(st === 'denied'){ fail('denied'); return; }
      // 'prompt'/'unknown' and not a tap → ask the person to tap first (many browsers block silent prompts)
      if((st === 'prompt' || st === 'unknown') && !userGesture && !ok){
        // try a silent fix once; if the browser holds the prompt back, fall to the tap-to-allow card
        var silent = await getPos(4000);
        if(silent.pos){ succeed(silent.pos); return; }
        if(silent.err && silent.err.code === 1){ fail('denied'); return; }
        fail('ask'); return;
      }
      if(elBtn) { elBtn.disabled = true; }
      var res = await getPos(12000);
      if(res.pos){ succeed(res.pos); return; }
      var code = res.err && res.err.code;
      if(code === 1) fail('denied');
      else if(code === 2) fail('off');
      else fail('timeout');
    } finally { checking = false; }
  }

  function getPos(timeout){
    return new Promise(function(resolve){
      navigator.geolocation.getCurrentPosition(
        function(p){ resolve({ pos: p }); },
        function(e){ resolve({ err: e }); },
        { enableHighAccuracy: false, timeout: timeout, maximumAge: 30000 }
      );
    });
  }

  window.SiagaGate = {
    isOk: function(){ return ok; },
    position: function(){ return lastPos; },
    onOk: function(fn){ if(ok) fn(lastPos); else listeners.push(fn); },
    recheck: function(){ return check(false); }
  };

  function start(){
    build();
    check(false);
    document.addEventListener('visibilitychange', function(){ if(!document.hidden) check(false); });
    window.addEventListener('focus', function(){ check(false); });
    try{
      if(navigator.permissions && navigator.permissions.query){
        navigator.permissions.query({ name: 'geolocation' }).then(function(r){ r.onchange = function(){ check(false); }; });
      }
    }catch(e){}
    setInterval(function(){ if(ok && !document.hidden) check(false); }, 60000); // catches GPS switched off mid-session
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
