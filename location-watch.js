/**
 * SIAGA — location watch (staff side). Include on the dashboard:  <script src="./location-watch.js"></script>
 *
 * What it does (all visible to the staff — nothing is silent):
 *  - POWER SAVER: 9:00–12:00 (window.SIAGA_SAVER) nothing runs in the background — only push notifications keep working
 *  - two windows a day (default 12–1 pm and 2–3 pm); a window covered by continuous readings inside the clinic earns points + a pop-up
 *  - asks the server whether I should report now (checked in, inside the window, not exempt)
 *  - first time: shows a consent notice explaining exactly what is recorded
 *  - while SIAGA is open and visible: reads location every `intervalMin` minutes and sends it
 *  - shows a small status chip ("📍 Lokasi disemak 12:10 · di klinik") with a "Tugas luar" switch
 *  - a push "Sahkan lokasi anda" opens dashboard.html?locping=1 → reports immediately
 * A web page cannot read location while closed/locked — that is a phone limit, so the server pushes a reminder instead.
 */
(function () {
  var API = 'https://script.google.com/macros/s/AKfycbxOamlCtYPlZCvQOys1VTjkZu7aVqMsdDStTdytPex7eH5jNGuIBiR91BfougaEF3SI/exec';
  var token = function () { return sessionStorage.getItem('kkah_session_token') || ''; };
  var IC = function () { return sessionStorage.getItem('kkah_ic') || ''; };
  var cfg = null, lastReport = 0, busy = false, lastStatusAt = 0, chip = null, ticker = null, lastRes = null, askedConsent = false;
  var pingNow = /[?&]locping=1/.test(location.search);
  function saver() { var h = new Date().getHours(); return h >= 9 && h < 12; }   // 9:00–12:00 → idle, battery first
  function wins() { return (cfg && cfg.windows && cfg.windows.length) ? cfg.windows : [(cfg ? cfg.start + '–' + cfg.end : '')]; }

  function post(body) {
    return fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ token: token() }, body)) }).then(function (r) { return r.json(); });
  }
  function consentKey() { return 'kkah_loc_consent_' + IC(); }
  function hasConsent() { try { return localStorage.getItem(consentKey()) === '1'; } catch (e) { return false; } }
  function setConsent() { try { localStorage.setItem(consentKey(), '1'); } catch (e) {} }

  /* ---------- UI ---------- */
  function css() {
    if (document.getElementById('lwCss')) return;
    var s = document.createElement('style'); s.id = 'lwCss';
    s.textContent =
      '.lw-ptoast{position:fixed;left:50%;bottom:96px;transform:translateX(-50%);z-index:9200;background:#0B3D3A;color:#fff;padding:11px 18px;border-radius:99px;font:600 14px Inter,sans-serif;box-shadow:0 14px 30px -10px rgba(0,0,0,.45);animation:lwUp .35s ease both;transition:opacity .4s}.lw-ptoast.out{opacity:0}@keyframes lwUp{from{opacity:0;transform:translate(-50%,14px)}to{opacity:1;transform:translate(-50%,0)}}' +
      '.lw-chip{margin:12px 16px;border-radius:18px;padding:12px 14px;background:#fff;border:1.5px solid #DCEAE6;display:flex;gap:12px;align-items:center;font-family:Inter,sans-serif;box-shadow:0 12px 30px -24px rgba(11,61,58,.5)}' +
      '.lw-chip .ic{width:40px;height:40px;border-radius:13px;background:#EAF6F2;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0}' +
      '.lw-chip .tx{flex:1;min-width:0;font-size:13px;line-height:1.45;color:#1E2B29}.lw-chip .tx b{font-family:Manrope,sans-serif;font-weight:800;font-size:14px;display:block}' +
      '.lw-chip.ok{border-color:#9ad5be}.lw-chip.warn{border-color:#E8C777;background:#FFFBEF}.lw-chip.bad{border-color:#E7A1AA;background:#FFF5F6}' +
      '.lw-chip button{min-height:40px;padding:0 13px;border-radius:12px;border:1.5px solid #DCEAE6;background:#fff;font:700 12.5px Inter,sans-serif;color:#0F5C56;cursor:pointer;white-space:nowrap}' +
      '.lw-chip button.on{background:#0F5C56;color:#fff;border-color:#0F5C56}' +
      '.lw-ov{position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.55);display:flex;align-items:flex-end;justify-content:center;padding:14px}' +
      '.lw-box{width:min(520px,100%);background:#fff;border-radius:24px;padding:22px 20px 18px;font-family:Inter,sans-serif;color:#1E2B29}' +
      '.lw-box h3{margin:0 0 6px;font:800 19px Manrope,sans-serif}.lw-box p{margin:6px 0;font-size:14px;line-height:1.55}.lw-box ul{margin:8px 0 4px;padding-left:20px;font-size:13.5px;line-height:1.6}' +
      '.lw-btns{display:grid;grid-template-columns:1fr 1.5fr;gap:10px;margin-top:16px}' +
      '.lw-btns button{min-height:52px;border-radius:15px;border:none;font:800 15px Manrope,sans-serif;cursor:pointer}' +
      '.lw-btns .g{background:#fff;border:1.5px solid #DCEAE6;color:#1E2B29}.lw-btns .p{background:linear-gradient(135deg,#0B3D3A,#1C8F84);color:#fff}' +
      '.lw-chip .tx a{color:#0F5C56;font-weight:700}.lw-steps{display:flex;gap:6px;margin-top:7px;flex-wrap:wrap}' +
      '.lw-step{font-size:11.5px;font-weight:700;padding:4px 9px;border-radius:99px;background:#F3F8F6;border:1px solid #DCEAE6;color:#5B6B68}' +
      '.lw-step.done{background:#E3F6EC;border-color:#9ad5be;color:#066b43}.lw-step.progress{background:#FFF8E1;border-color:#E8C777;color:#8a6200}.lw-step.broken,.lw-step.missed{background:#FFF1F2;border-color:#E7A1AA;color:#a3202f}' +
      '.lw-pts{position:fixed;inset:0;z-index:9500;background:rgba(6,30,28,.78);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:20px;animation:lwIn .25s ease both}@keyframes lwIn{from{opacity:0}to{opacity:1}}' +
      '.lw-pcard{width:min(360px,100%);background:#fff;border-radius:28px;padding:28px 22px 20px;text-align:center;font-family:Inter,sans-serif;color:#1E2B29;animation:lwPop .45s cubic-bezier(.2,1.2,.3,1) both}@keyframes lwPop{from{transform:scale(.7);opacity:0}to{transform:none;opacity:1}}' +
      '.lw-ptro{width:92px;height:92px;margin:0 auto 10px;border-radius:50%;background:linear-gradient(135deg,#FFF3C4,#FBE08A);display:flex;align-items:center;justify-content:center;font-size:46px;box-shadow:0 14px 30px -12px rgba(201,162,39,.8)}' +
      '.lw-pnum{font:800 46px Manrope,sans-serif;color:#0F5C56;line-height:1}.lw-pnum small{font-size:18px;margin-left:4px}.lw-pcard h3{margin:8px 0 4px;font:800 18px Manrope,sans-serif}.lw-pcard p{margin:0;font-size:13.5px;color:#5B6B68;line-height:1.5}' +
      '.lw-pbtn{display:flex;align-items:center;justify-content:center;width:100%;min-height:50px;margin-top:16px;border-radius:15px;border:none;background:linear-gradient(135deg,#0B3D3A,#1C8F84);color:#fff;font:800 14.5px Manrope,sans-serif;text-decoration:none;cursor:pointer}' +
      '.lw-pbtn.g{background:#fff;color:#5B6B68;border:1.5px solid #DCEAE6;margin-top:8px;font-weight:700}' +
      '@media (prefers-reduced-motion:reduce){.lw-pcard,.lw-pts{animation:none}}';
    document.head.appendChild(s);
  }
  function ensureChip() {
    if (chip) return chip;
    css();
    chip = document.createElement('div'); chip.className = 'lw-chip'; chip.style.display = 'none'; chip.setAttribute('role', 'status');
    var grid = document.getElementById('activeGrid');
    if (grid && grid.parentNode) grid.parentNode.insertBefore(chip, grid); else document.body.insertBefore(chip, document.body.firstChild);
    chip.addEventListener('click', function (e) {
      if (e.target.closest('[data-duty]')) toggleDuty();
      else if (e.target.closest('[data-now]')) report('app', true);
    });
    return chip;
  }
  function render(kind, icon, title, sub, withDuty) {
    var c = ensureChip(); c.style.display = 'flex'; c.className = 'lw-chip ' + kind;
    var duty = lastRes && lastRes.outDuty || (cfg && cfg.me && cfg.me.outDuty);
    c.innerHTML = '<div class="ic">' + icon + '</div><div class="tx"><b>' + title + '</b>' + sub + '</div>' +
      (withDuty ? '<button type="button" data-duty class="' + (duty ? 'on' : '') + '">' + (duty ? '🚗 Tugas luar ✓' : 'Tugas luar') + '</button>' : '');
  }
  function hide() { if (chip) chip.style.display = 'none'; }

  function pointsOverlay(a) {
    css();
    var t = document.createElement('div'); t.className = 'lw-ptoast'; t.setAttribute('role', 'status');
    t.innerHTML = '🎯 <b>+' + a.pts + ' mata</b> · semakan lokasi';
    document.body.appendChild(t);
    try { if (navigator.vibrate) navigator.vibrate(40); } catch (e) {}
    setTimeout(function () { t.classList.add('out'); setTimeout(function () { t.remove(); }, 400); }, 2200);
  }


  function consentSheet() {
    return new Promise(function (resolve) {
      css();
      var ov = document.createElement('div'); ov.className = 'lw-ov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
      ov.innerHTML = '<div class="lw-box"><h3>📍 Semakan lokasi waktu bertugas</h3>' +
        '<p>Pada <b>' + wins().join(' dan ') + '</b>, selepas anda daftar masuk dan sebelum daftar keluar, SIAGA akan menyemak lokasi anda <b>setiap ' + cfg.intervalMin + ' minit</b> apabila aplikasi dibuka.</p>' +
        '<ul><li>🎯 Setiap semakan di dalam klinik memberi <b>+' + (cfg.locPts || 1) + ' mata</b>.</li></ul>' +
        '<ul><li>Pada waktu semakan sahaja, <b>koordinat lokasi &amp; masa</b> direkod dan <b>penyelia boleh melihat jejak pada peta</b>. Tiada penjejakan di luar waktu itu.</li><li>Jika anda di luar kawasan klinik (' + cfg.radiusM + ' m) beberapa bacaan berturut-turut, <b>penyelia dimaklumkan</b>.</li>' +
        '<li>Bertugas di luar (lawatan, ambulans, kursus)? Tekan <b>“Tugas luar”</b> dan tiada amaran dihantar.</li><li>Rekod dipadam automatik selepas 90 hari.</li></ul>' +
        '<p style="font-size:12.5px;color:#5B6B68">Telefon mungkin meminta kebenaran lokasi — sila pilih <b>Benarkan</b>.</p>' +
        '<div class="lw-btns"><button class="g" type="button">Kemudian</button><button class="p" type="button">Saya faham &amp; setuju</button></div></div>';
      document.body.appendChild(ov);
      var b = ov.querySelectorAll('button');
      b[0].onclick = function () { ov.remove(); resolve(false); };
      b[1].onclick = function () { setConsent(); ov.remove(); resolve(true); };
    });
  }

  /* ---------- logic ---------- */
  function steps(rows) {
    if (!rows || !rows.length) return '';
    var ic = { done: '✅', progress: '⏳', broken: '✖', missed: '✖', upcoming: '🕒' };
    return '<div class="lw-steps">' + rows.map(function (r) { return '<span class="lw-step ' + r.state + '">' + (ic[r.state] || '') + ' ' + r.label + '</span>'; }).join('') + '</div>';
  }
  function ptsLink() { return ' <a href="./points.html#rules">Lihat pecahan mata ›</a>'; }
  function winLine(res) {
    if (!res.win) return '';
    return '<br>🎯 <b>+' + (res.locPts || 1) + ' mata</b> setiap semakan di klinik · ' + res.win.inside + ' semakan dalam ' + res.win.label + '.' + ptsLink();
  }
  function fmtOk(res) {
    if (res.outDuty) return ['ok', '🚗', 'Tugas luar', 'Tiada amaran lokasi dihantar kepada penyelia.', true];
    if (res.inside === 'Y') return ['ok', '✅', 'Anda berada di klinik', 'Lokasi disemak ' + res.time + ' · seterusnya dalam ' + res.nextInMin + ' minit.' + winLine(res), true];
    if (res.inside === 'N') return ['bad', '⚠️', 'Anda di luar kawasan klinik', '±' + res.dist + ' m dari klinik' + (res.supervisorNotified ? ' — <b>penyelia telah dimaklumkan</b>.' : '.') + ' Bertugas luar? Tekan “Tugas luar”.', true];
    if (res.inside === 'DENIED') return ['warn', '🔒', 'Kebenaran lokasi dimatikan', 'Hidupkan lokasi untuk SIAGA dalam tetapan telefon, kemudian <a href="#" data-now>cuba lagi</a>.', true];
    return ['warn', '📡', 'Isyarat GPS lemah', 'Lokasi tidak dapat ditentukan dengan tepat. Cuba di kawasan terbuka — <a href="#" data-now>semak semula</a>.', true];
  }

  function getPos() {
    return new Promise(function (res, rej) {
      if (!navigator.geolocation) return rej({ code: 99 });
      navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 });
    });
  }

  function report(src, manual) {
    if (busy || !cfg || !cfg.active) return Promise.resolve();
    if (!hasConsent()) { if (manual || !askedConsent) return askConsentThenReport(src); return Promise.resolve(); }
    busy = true;
    if (manual) render('', '⏳', 'Menyemak lokasi…', 'Sila tunggu sebentar.', false);
    return getPos().then(function (pos) {
      return post({ action: 'reportLocation', lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy, src: src });
    }, function (err) {
      if (err && err.code === 1) return post({ action: 'reportLocation', denied: true, src: src });
      return { ok: true, tracking: true, inside: '?', time: '', nextInMin: cfg.intervalMin, weak: true };
    }).then(function (res) {
      busy = false; lastReport = Date.now();
      if (!res || !res.ok) { if (res && /expired/i.test(res.error || '')) return; render('warn', '⚠️', 'Gagal menghantar lokasi', 'Akan cuba lagi sebentar lagi.', false); return; }
      if (res.tracking === false) { cfg.active = false; refresh(true); return; }
      lastRes = res; var f = fmtOk(res); render(f[0], f[1], f[2], f[3], f[4]);
      if (res.award) pointsOverlay(res.award);
    }).catch(function () { busy = false; render('warn', '📶', 'Tiada sambungan', 'Lokasi akan dihantar bila sambungan pulih.', false); });
  }

  function askConsentThenReport(src) {
    askedConsent = true;
    return consentSheet().then(function (ok) {
      if (ok) return report(src, true);
      render('warn', '📍', 'Semakan lokasi belum diaktifkan', 'Anda perlu bersetuju untuk menghantar lokasi waktu bertugas. <a href="#" data-now>Aktifkan</a>', false);
    });
  }

  function toggleDuty() {
    var cur = !!(lastRes && lastRes.outDuty || (cfg && cfg.me && cfg.me.outDuty)), want = !cur;
    if (want && !confirm('Tandakan anda sedang bertugas di luar klinik? Penyelia akan dimaklumkan dan tiada amaran lokasi dihantar.')) return;
    post({ action: 'setOutDuty', on: want }).then(function (r) {
      if (!r || !r.ok) { alert((r && r.error) || 'Gagal. Cuba lagi.'); return; }
      lastRes = Object.assign({}, lastRes || {}, { outDuty: r.outDuty }); if (cfg && cfg.me) cfg.me.outDuty = r.outDuty;
      if (r.outDuty) render('ok', '🚗', 'Tugas luar', 'Tiada amaran lokasi dihantar kepada penyelia.', true);
      else report('app', true);
    });
  }

  function refresh(force) {
    if (!token()) return Promise.resolve();
    if (!force && Date.now() - lastStatusAt < 4 * 60000) return Promise.resolve();
    lastStatusAt = Date.now();
    return post({ action: 'getLocWatchStatus' }).then(function (s) {
      if (!s || !s.ok) return;
      cfg = s;
      if (s.exempt || !s.enabled || s.reason === 'readonly' || s.reason === 'notin' || s.reason === 'checkedout') { hide(); return; }
      if (s.reason === 'outside_window') { hide(); return; }     // nothing to explain outside the check windows
      if (s.active) {
        if (s.me && s.me.lastTime && !lastRes) { lastRes = { time: s.me.lastTime, inside: s.me.inside, dist: s.me.lastDist, nextInMin: s.intervalMin, outDuty: s.me.outDuty }; var f = fmtOk(lastRes); render(f[0], f[1], f[2], f[3], f[4]); }
        else if (!lastRes) render('', '📍', 'Semakan lokasi aktif', 'Menyemak lokasi anda…' + steps(s.today), true);
        var due = Date.now() - lastReport >= s.intervalMin * 60000;
        if (due && !pingNow) report('app');
      }
    }).catch(function () {});
  }

  function tick() {
    if (document.hidden || !cfg || saver()) return;       // 9:00–12:00 power saver: no background work
    if (cfg.active) { if (Date.now() - lastReport >= cfg.intervalMin * 60000) report('app'); }
    refresh(false);
  }

  function start() {
    if (!token() || ticker) return;
    window.SIAGA_SAVER = saver();
    var wasPing = pingNow;
    refresh(true).then(function () { if (wasPing && cfg && cfg.active) { pingNow = false; report('ping', true); } });
    ticker = setInterval(tick, 60000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden && !saver()) { lastStatusAt = 0; tick(); refresh(true); } });
    window.addEventListener('online', function () { refresh(true); });
  }

  window.SiagaLoc = { start: start, refresh: function () { return refresh(true); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else setTimeout(start, 1200);
})();
