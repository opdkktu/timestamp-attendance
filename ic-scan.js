/**
 * SIAGA — scan a MyKad with the camera and read the IC number + name (runs in the browser; the picture is never uploaded or saved).
 *
 *   SiagaIcScan.open({ layout:'new'|'old', onLayout:fn })  → Promise<{ ic, name, layout } | null>   (null = cancelled)
 *   SiagaIcScan.parseIc(text) / parseName(text)            → helpers (also used by the tests)
 *
 * The camera shows a card-shaped frame (85.6 : 54). The person moves the card until it fills the frame; the frame turns green when the
 * picture is sharp and bright enough. On capture only the two areas that hold the IC number and the name are read (digits-only for the IC),
 * with a whole-card read as back-up. The result is shown for a quick check before it is used.
 * 'new' = new MyKad (photo on the left, IC under the title) · 'old' = current MyKad (IC top-left, chip, photo on the right).
 */
(function (root) {
  var TESS_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  var RATIO = 85.6 / 54;                                           // ISO ID-1 card
  // [x, y, w, h] as fractions of the card
  var LAYOUTS = {
    'new': { label: 'IC Baharu', hint: 'Foto di kiri', ic: [0.28, 0.22, 0.70, 0.24], name: [0.28, 0.44, 0.70, 0.24] },
    'old': { label: 'IC Lama', hint: 'Cip di kiri', ic: [0.02, 0.17, 0.62, 0.20], name: [0.02, 0.56, 0.68, 0.20] }
  };
  var SKIP = /^(NO|JALAN|JLN|LORONG|LRG|TAMAN|TMN|KAMPUNG|KG|BANDAR|PERSIARAN|BLOK|LOT|PETI|WARGANEGARA|LELAKI|PEREMPUAN|ISLAM|KAD|MALAYSIA|IDENTITY|CARD|MYKAD|KERAJAAN|PERSEKUTUAN|PUTRAJAYA|SELANGOR|KEDAH|PENANG|PERAK|JOHOR|SABAH|SARAWAK)\b/;

  /* ---------------- text → IC / name ---------------- */
  function fixDigits(s) { return s.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/S/g, '5').replace(/B/g, '8').replace(/Z/g, '2'); }
  function validIc(d) {
    if (!/^\d{12}$/.test(d)) return false;
    var m = +d.slice(2, 4), day = +d.slice(4, 6); return m >= 1 && m <= 12 && day >= 1 && day <= 31;
  }
  /** → '780505140005' or '' */
  function parseIc(text) {
    var t = String(text || ''), re = /[\dOIlSBZ|]{6}[\s\-–—_.]{0,2}[\dOIlSBZ|]{2}[\s\-–—_.]{0,2}[\dOIlSBZ|]{4}/g, m, first = '';
    while ((m = re.exec(t))) { var d = fixDigits(m[0]).replace(/\D/g, ''); if (validIc(d)) return d; if (!first && d.length === 12) first = d; }
    var raw = t.replace(/\D/g, ''); var k; for (k = 0; k + 12 <= raw.length; k++) if (validIc(raw.slice(k, k + 12))) return raw.slice(k, k + 12);
    return '';
  }
  /** → 'MUHAMMAD ASRAF BIN SUKADI' or '' (drops address / label lines and stray 1-letter noise) */
  function parseName(text) {
    var lines = String(text || '').split(/\n+/).map(function (l) {
      var toks = l.replace(/[^A-Za-z '@./-]/g, ' ').split(/\s+/).filter(Boolean);
      while (toks.length > 1 && toks[toks.length - 1].length === 1 && /[a-z]/.test(toks[toks.length - 1])) toks.pop();      // "SUKAD j" → "SUKAD"
      while (toks.length > 1 && toks[0].length === 1 && /[a-z]/.test(toks[0])) toks.shift();
      return toks.join(' ').toUpperCase();
    }).filter(function (l) { return l.replace(/[^A-Z]/g, '').length >= 3; });
    var out = [];
    for (var i = 0; i < lines.length; i++) { if (SKIP.test(lines[i])) { if (out.length) break; continue; } out.push(lines[i]); if (out.length === 2) break; }
    return out.join(' ').replace(/\s+/g, ' ').trim();
  }

  /* ---------------- image helpers ---------------- */
  /** focus + light of a small grey picture → { sharp, bright } */
  function quality(g, w, h) {
    var sum = 0, i, x, y, n = 0, s2 = 0, s1 = 0;
    for (i = 0; i < w * h; i++) sum += g[i];
    for (y = 1; y < h - 1; y++) for (x = 1; x < w - 1; x++) {
      var p = y * w + x, l = 4 * g[p] - g[p - 1] - g[p + 1] - g[p - w] - g[p + w]; s1 += l; s2 += l * l; n++;
    }
    var mean = s1 / n; return { sharp: s2 / n - mean * mean, bright: sum / (w * h) };
  }
  function stretch(canvas) {                         // grey + percentile contrast stretch (guilloche background → clearer ink)
    var ctx = canvas.getContext('2d'), d = ctx.getImageData(0, 0, canvas.width, canvas.height), px = d.data, hist = new Array(256).fill(0), i, g, n = px.length / 4;
    for (i = 0; i < px.length; i += 4) { g = (px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) >> 8; px[i] = g; hist[g]++; }
    var lo = 0, hi = 255, acc = 0; for (i = 0; i < 256; i++) { acc += hist[i]; if (acc > n * 0.01) { lo = i; break; } }
    acc = 0; for (i = 255; i >= 0; i--) { acc += hist[i]; if (acc > n * 0.02) { hi = i; break; } }
    var span = Math.max(50, hi - lo);
    for (i = 0; i < px.length; i += 4) { g = Math.max(0, Math.min(255, (px[i] - lo) * 255 / span)); px[i] = px[i + 1] = px[i + 2] = g; }
    ctx.putImageData(d, 0, 0); return canvas;
  }
  function cropTo(src, sx, sy, sw, sh, outW) {
    var c = document.createElement('canvas'); c.width = Math.round(outW); c.height = Math.max(8, Math.round(outW * sh / sw));
    c.getContext('2d').drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height); return c;
  }
  function loadScript(src) {
    return new Promise(function (res, rej) {
      if (root.Tesseract) return res();
      var s = document.createElement('script'); s.src = src; s.async = true; s.onload = function () { res(); };
      s.onerror = function () { rej(new Error('Tidak dapat memuatkan pembaca teks (rangkaian).')); }; document.head.appendChild(s);
    });
  }
  var worker = null;
  function getWorker(onP) {
    if (worker) return Promise.resolve(worker);
    return loadScript(TESS_URL).then(function () {
      return root.Tesseract.createWorker('eng', 1, { logger: function (m) { if (onP && m && m.status === 'recognizing text') onP(m.progress || 0); } });
    }).then(function (w) { worker = w; return w; });
  }
  var DIG = { tessedit_char_whitelist: '0123456789-', tessedit_pageseg_mode: '6' };
  var ALPHA = { tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz '@./-", tessedit_pageseg_mode: '6' };
  var FREE = { tessedit_char_whitelist: '', tessedit_pageseg_mode: '6' };

  /** card canvas (already cropped to the card) → { ic, name } */
  function readCard(card, layout, onP, icOnly) {
    var L = LAYOUTS[layout] || LAYOUTS['new'], W = card.width, H = card.height;
    function region(r) { return stretch(cropTo(card, r[0] * W, r[1] * H, r[2] * W, r[3] * H, 1100)); }
    var ic = '', name = '', w;
    return getWorker(onP).then(function (x) { w = x; return w.setParameters(DIG); })
      .then(function () { return w.recognize(region(L.ic)); })
      .then(function (r) { ic = parseIc(r.data.text); if (icOnly) return; return w.setParameters(ALPHA).then(function () { return w.recognize(region(L.name)); }).then(function (r2) { name = parseName(r2.data.text); }); })
      .then(function () { if (ic && (name || icOnly)) return; return w.setParameters(FREE).then(function () { return w.recognize(stretch(cropTo(card, 0, 0, W, H, 1500))); }).then(function (f) { if (!ic) ic = parseIc(f.data.text); if (!name && !icOnly) name = parseName(f.data.text); }); })
      .then(function () { return { ic: ic, name: name }; });
  }

  /* ---------------- UI ---------------- */
  var CSS = '.icx{position:fixed;inset:0;z-index:10000;background:#05100e;color:#fff;font-family:Inter,system-ui,sans-serif;display:flex;flex-direction:column}' +
    '.icx *{box-sizing:border-box}.icx video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#000}' +
    '.icx-top{position:relative;z-index:3;display:flex;align-items:center;gap:10px;padding:calc(10px + env(safe-area-inset-top)) 14px 10px;background:linear-gradient(#000a,#0000)}' +
    '.icx-top b{flex:1;font-size:16px}.icx-x{width:42px;height:42px;border:0;border-radius:50%;background:#ffffff2a;color:#fff;font-size:20px;cursor:pointer}' +
    '.icx-seg{position:relative;z-index:3;display:flex;margin:0 14px;background:#0008;border-radius:14px;padding:4px;gap:4px}' +
    '.icx-seg button{flex:1;border:0;border-radius:11px;padding:9px 6px;background:none;color:#cfe;font:700 13px Inter,sans-serif;cursor:pointer;min-height:44px}.icx-seg button small{display:block;font-weight:500;font-size:10.5px;opacity:.8}' +
    '.icx-seg button.on{background:#fff;color:#0B3D3A}' +
    '.icx-stage{position:relative;z-index:2;flex:1;display:flex;align-items:center;justify-content:center;pointer-events:none}' +
    '.icx-frame{position:relative;width:min(92vw,calc(46vh * ' + RATIO.toFixed(3) + '));aspect-ratio:' + RATIO.toFixed(3) + ';border-radius:16px;box-shadow:0 0 0 100vmax #000a;border:2px solid #ffffffaa;transition:border-color .25s, box-shadow .25s}' +
    '.icx-frame.good{border-color:#3be58a;box-shadow:0 0 0 100vmax #000a,0 0 24px #3be58a88}.icx-frame.dark{border-color:#ffb020}' +
    '.icx-frame::before,.icx-frame::after{content:"";position:absolute;width:26px;height:26px;border:4px solid #fff;border-radius:6px}.icx-frame::before{left:-4px;top:-4px;border-right:0;border-bottom:0}.icx-frame::after{right:-4px;bottom:-4px;border-left:0;border-top:0}' +
    '.icx-zone{position:absolute;border:1.5px dashed #ffffffcc;border-radius:6px;font-size:10px;font-weight:800;letter-spacing:.06em;color:#fff;padding:1px 4px;text-shadow:0 1px 3px #000;transition:all .3s}' +
    '.icx-msg{position:relative;z-index:3;text-align:center;font-size:13.5px;font-weight:600;padding:8px 18px;min-height:40px;text-shadow:0 1px 4px #000}' +
    '.icx-bot{position:relative;z-index:3;display:flex;align-items:center;justify-content:space-between;padding:8px 26px calc(16px + env(safe-area-inset-bottom));background:linear-gradient(#0000,#000b)}' +
    '.icx-side{width:76px;border:0;background:none;color:#fff;font:600 12px Inter,sans-serif;cursor:pointer;text-align:center;min-height:48px}.icx-side span{display:block;font-size:22px}' +
    '.icx-shot{width:76px;height:76px;border-radius:50%;border:5px solid #fff;background:#ffffff33;cursor:pointer;position:relative}.icx-shot::after{content:"";position:absolute;inset:6px;border-radius:50%;background:#fff}.icx-shot:active::after{inset:10px}' +
    '.icx-shot:disabled{opacity:.4}' +
    '.icx-res{position:absolute;inset:0;z-index:5;background:#05100ef2;display:none;flex-direction:column;align-items:center;justify-content:center;padding:22px;gap:12px}.icx-res.show{display:flex}' +
    '.icx-card{width:100%;max-width:420px;background:#fff;color:#1E2B29;border-radius:22px;padding:18px}' +
    '.icx-card h3{margin:0 0 4px;font-size:17px;color:#0F5C56}.icx-card p{margin:0 0 12px;font-size:12.5px;color:#5B6B68}' +
    '.icx-card label{display:block;font-size:12px;font-weight:700;margin:10px 0 4px}.icx-card input{width:100%;height:48px;border:1.5px solid #DCEAE6;border-radius:12px;padding:0 12px;font:700 17px Inter,sans-serif;letter-spacing:.02em}' +
    '.icx-card input.bad{border-color:#C0392B;background:#FDEEEB}.icx-note{font-size:12px;color:#8a5a00;margin-top:6px;min-height:16px}' +
    '.icx-row{display:flex;gap:10px;margin-top:14px}.icx-row button{flex:1;height:50px;border:0;border-radius:14px;font:800 15px Inter,sans-serif;cursor:pointer}.icx-ghost{background:#EAF6F2;color:#0F5C56}.icx-go{background:#0F5C56;color:#fff}' +
    '.icx-spin{width:46px;height:46px;border:5px solid #ffffff44;border-top-color:#fff;border-radius:50%;animation:icxs .8s linear infinite}@keyframes icxs{to{transform:rotate(360deg)}}' +
    '@media (prefers-reduced-motion:reduce){.icx-spin{animation-duration:2s}}';

  function open(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      if (!document.getElementById('icxCss')) { var st = document.createElement('style'); st.id = 'icxCss'; st.textContent = CSS; document.head.appendChild(st); }
      var layout = LAYOUTS[opts.layout] ? opts.layout : 'new', stream = null, timer = null, closed = false, good = 0, busy = false;
      var el = document.createElement('div'); el.className = 'icx'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Imbas kad pengenalan');
      el.innerHTML =
        '<video playsinline muted autoplay></video>' +
        '<div class="icx-top"><b>📷 Imbas Kad Pengenalan</b><button class="icx-x" type="button" aria-label="Tutup">✕</button></div>' +
        '<div class="icx-seg" role="group" aria-label="Jenis kad"></div>' +
        '<div class="icx-stage"><div class="icx-frame"><div class="icx-zone" data-z="ic">NO. IC</div><div class="icx-zone" data-z="name">NAMA</div></div></div>' +
        '<div class="icx-msg" role="status" aria-live="polite">Memulakan kamera…</div>' +
        '<div class="icx-bot"><button class="icx-side" type="button" data-a="file"><span>🖼️</span>Pilih gambar</button><button class="icx-shot" type="button" aria-label="Ambil gambar" disabled></button><button class="icx-side" type="button" data-a="torch" style="visibility:hidden"><span>🔦</span>Lampu</button></div>' +
        '<div class="icx-res"></div><input type="file" accept="image/*" hidden>';
      document.body.appendChild(el);
      var $ = function (s) { return el.querySelector(s); }, video = $('video'), frame = $('.icx-frame'), msg = $('.icx-msg'), shot = $('.icx-shot'), res = $('.icx-res'), file = $('input[type=file]');

      function setMsg(t) { msg.textContent = t; }
      function drawZones() {
        var L = LAYOUTS[layout];
        [['ic', L.ic], ['name', L.name]].forEach(function (z) { var e = frame.querySelector('[data-z=' + z[0] + ']'); e.style.left = z[1][0] * 100 + '%'; e.style.top = z[1][1] * 100 + '%'; e.style.width = z[1][2] * 100 + '%'; e.style.height = z[1][3] * 100 + '%'; });
        el.querySelectorAll('.icx-seg button').forEach(function (b) { b.classList.toggle('on', b.dataset.l === layout); b.setAttribute('aria-pressed', b.dataset.l === layout); });
        try { if (opts.onLayout) opts.onLayout(layout); } catch (e) {}
      }
      var seg = $('.icx-seg'); Object.keys(LAYOUTS).forEach(function (k) { var b = document.createElement('button'); b.type = 'button'; b.dataset.l = k; b.innerHTML = LAYOUTS[k].label + '<small>' + LAYOUTS[k].hint + '</small>'; b.onclick = function () { layout = k; drawZones(); }; seg.appendChild(b); });
      drawZones();

      function done(v) { if (closed) return; closed = true; clearInterval(timer); try { if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} el.remove(); resolve(v); }
      $('.icx-x').onclick = function () { done(null); };
      document.addEventListener('keydown', function esc(e) { if (closed) return document.removeEventListener('keydown', esc); if (e.key === 'Escape') done(null); });

      /* geometry: card frame (client px) → video pixels */
      function frameInVideo() {
        var vr = video.getBoundingClientRect(), fr = frame.getBoundingClientRect(), vw = video.videoWidth, vh = video.videoHeight; if (!vw) return null;
        var s = Math.max(vr.width / vw, vr.height / vh), ox = (vr.width - vw * s) / 2, oy = (vr.height - vh * s) / 2;
        return { x: (fr.left - vr.left - ox) / s, y: (fr.top - vr.top - oy) / s, w: fr.width / s, h: fr.height / s };
      }
      /* live focus / light meter */
      var qc = document.createElement('canvas'); qc.width = 200; qc.height = Math.round(200 / RATIO);
      function meter() {
        if (busy || !video.videoWidth) return; var f = frameInVideo(); if (!f) return;
        var ctx = qc.getContext('2d'); ctx.drawImage(video, f.x, f.y, f.w, f.h, 0, 0, qc.width, qc.height);
        var d = ctx.getImageData(0, 0, qc.width, qc.height).data, g = new Uint8Array(qc.width * qc.height);
        for (var i = 0; i < g.length; i++) g[i] = (d[i * 4] * 77 + d[i * 4 + 1] * 150 + d[i * 4 + 2] * 29) >> 8;
        var q = quality(g, qc.width, qc.height);
        frame.classList.remove('good', 'dark');
        if (q.bright < 70) { good = 0; frame.classList.add('dark'); setMsg('💡 Terlalu gelap — cari tempat lebih cerah atau hidupkan lampu'); }
        else if (q.sharp < 60) { good = 0; setMsg('🔍 Kabur — laraskan jarak sehingga kad memenuhi bingkai, tunggu fokus'); }
        else { good++; frame.classList.add('good'); setMsg(good > 1 ? '✅ Bagus! Tahan sebentar, kemudian tekan butang bulat' : 'Letakkan kad dalam bingkai'); }
      }

      function startCamera() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { setMsg('Kamera tidak disokong. Guna “Pilih gambar”.'); return; }
        navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false }).then(function (s) {
          stream = s; video.srcObject = s; return video.play();
        }).then(function () {
          shot.disabled = false; setMsg('Letakkan kad dalam bingkai'); timer = setInterval(meter, 350);
          try { var tr = stream.getVideoTracks()[0], cap = tr.getCapabilities && tr.getCapabilities(); if (cap && cap.torch) { var tb = $('[data-a=torch]'), on = false; tb.style.visibility = 'visible'; tb.onclick = function () { on = !on; tr.applyConstraints({ advanced: [{ torch: on }] }).catch(function () {}); }; } } catch (e) {}
        }).catch(function (e) { setMsg(e && e.name === 'NotAllowedError' ? 'Kebenaran kamera ditolak. Benarkan kamera pada tetapan pelayar, atau guna “Pilih gambar”.' : 'Kamera tidak dapat dibuka. Guna “Pilih gambar”.'); });
      }

      /* result sheet */
      function showResult(r) {
        busy = false; var okIc = validIc(r.ic);
        res.innerHTML = '<div class="icx-card"><h3>' + (r.ic || r.name ? 'Semak maklumat' : 'Tidak dapat dibaca') + '</h3><p>' + (r.ic || r.name ? (opts.direct ? 'Betulkan nombor IC, kemudian tekan “Cari”.' : 'Betulkan jika perlu, kemudian tekan “Isi ke borang”.') : 'Cuba lagi: cahaya lebih terang, tiada silau, kad memenuhi bingkai.') + '</p>' +
          '<label for="icxIc">No. Kad Pengenalan</label><input id="icxIc" inputmode="numeric" maxlength="12" value="' + (r.ic || '') + '"><div class="icx-note" id="icxN"></div>' +
          '<label for="icxNm"' + (opts.icOnly ? ' style="display:none"' : '') + '>Nama Penuh</label><input id="icxNm"' + (opts.icOnly ? ' style="display:none"' : '') + ' autocapitalize="characters" value="' + String(r.name || '').replace(/"/g, '&quot;') + '">' +
          '<div class="icx-row"><button type="button" class="icx-ghost" id="icxAgain">Imbas semula</button><button type="button" class="icx-go" id="icxUse">' + (opts.direct ? 'Cari' : 'Isi ke borang') + '</button></div></div>';
        res.classList.add('show');
        var ic = res.querySelector('#icxIc'), nm = res.querySelector('#icxNm'), note = res.querySelector('#icxN');
        function chk() { ic.value = ic.value.replace(/\D/g, '').slice(0, 12); var v = validIc(ic.value); ic.classList.toggle('bad', ic.value.length > 0 && !v); note.textContent = ic.value.length === 12 && !v ? '⚠️ Nombor IC tidak sah — semak semula.' : (ic.value && ic.value.length < 12 ? ic.value.length + '/12 digit' : ''); }
        ic.oninput = chk; nm.oninput = function () { nm.value = nm.value.toUpperCase(); }; chk();
        res.querySelector('#icxAgain').onclick = function () { res.classList.remove('show'); setMsg('Letakkan kad dalam bingkai'); };
        res.querySelector('#icxUse').onclick = function () { if (ic.value && !validIc(ic.value)) { ic.focus(); return; } done({ ic: ic.value, name: nm.value.trim(), layout: layout }); };
      }
      function reading(pct) { res.innerHTML = '<div class="icx-spin"></div><div style="font-weight:700">Membaca kad…' + (pct ? ' ' + pct + '%' : '') + '</div><div style="font-size:12px;opacity:.75">Gambar tidak dihantar ke mana-mana</div>'; res.classList.add('show'); }
      function process(canvas) {
        busy = true; reading(0);
        var t = setTimeout(function () { busy = false; res.classList.remove('show'); setMsg('Bacaan terlalu lama. Cuba lagi.'); }, 60000);
        readCard(canvas, layout, function (p) { reading(Math.round(p * 100)); }, !!opts.icOnly).then(function (r) { clearTimeout(t); if (closed) return; if (opts.direct && validIc(r.ic)) { done({ ic: r.ic, name: r.name || '', layout: layout }); return; } showResult(r); })
          .catch(function (e) { clearTimeout(t); busy = false; res.classList.remove('show'); setMsg((e && e.message) || 'Bacaan gagal. Cuba lagi.'); });
      }
      shot.onclick = function () {
        var f = frameInVideo(); if (!f || busy) return;
        var c = cropTo(video, Math.max(0, f.x), Math.max(0, f.y), Math.min(video.videoWidth - Math.max(0, f.x), f.w), Math.min(video.videoHeight - Math.max(0, f.y), f.h), Math.max(1400, Math.min(2000, f.w)));
        if (navigator.vibrate) try { navigator.vibrate(25); } catch (e) {}
        process(c);
      };
      $('[data-a=file]').onclick = function () { file.click(); };
      file.onchange = function () {
        var f = file.files && file.files[0]; if (!f) return; var url = URL.createObjectURL(f), img = new Image();
        img.onload = function () { URL.revokeObjectURL(url); var k = Math.min(1, 2000 / img.width); var c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); process(c); };
        img.onerror = function () { URL.revokeObjectURL(url); setMsg('Gambar tidak dapat dibaca.'); }; img.src = url; file.value = '';
      };
      startCamera();
    });
  }

  root.SiagaIcScan = { open: open, parseIc: parseIc, parseName: parseName, validIc: validIc, quality: quality, layouts: LAYOUTS };
  if (typeof module !== 'undefined') module.exports = root.SiagaIcScan;
})(typeof window !== 'undefined' ? window : globalThis);
