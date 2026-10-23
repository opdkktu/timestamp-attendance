/**
 * SIAGA — receipt "document mode" (works for BOTH camera photos and gallery pictures).
 *
 *   SiagaScan.open(fileOrBlob) → Promise< { blob, dataUrl, mode:'scan'|'original' } | null >      (null = cancelled)
 *   SiagaScan.detect(imageData) → [TL, TR, BR, BL] in that image's pixels   (exposed for tests)
 *
 * 1. finds the paper automatically (largest bright area → its four corners),
 * 2. shows the picture with 4 draggable corner handles so the driver can fine-tune,
 * 3. straightens the paper (perspective correction), evens out the contrast and returns a clean JPEG.
 * Pure JavaScript — no library, no upload, nothing leaves the phone.
 */
(function (root) {
  var MAXOUT = 1600, DET = 320;

  /* ---------------- paper detection ---------------- */
  function otsu(hist, total) {
    var sum = 0, i; for (i = 0; i < 256; i++) sum += i * hist[i];
    var sB = 0, wB = 0, best = 0, thr = 127;
    for (i = 0; i < 256; i++) {
      wB += hist[i]; if (!wB) continue; var wF = total - wB; if (!wF) break;
      sB += i * hist[i]; var mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best) { best = v; thr = i; }
    }
    return thr;
  }
  /** imageData (any size) → corners [TL,TR,BR,BL] as {x,y} in imageData pixels. Falls back to a slightly inset rectangle. */
  function detect(img) {
    var w = img.width, h = img.height, d = img.data, g = new Uint8Array(w * h), hist = new Array(256).fill(0), i, x, y;
    for (i = 0; i < w * h; i++) { var v = (d[i * 4] * 77 + d[i * 4 + 1] * 150 + d[i * 4 + 2] * 29) >> 8; g[i] = v; hist[v]++; }
    // 3x3 box blur so print/noise does not break the paper into pieces
    var b = new Uint8Array(w * h);
    for (y = 1; y < h - 1; y++) for (x = 1; x < w - 1; x++) {
      var p = y * w + x; b[p] = (g[p - w - 1] + g[p - w] + g[p - w + 1] + g[p - 1] + g[p] + g[p + 1] + g[p + w - 1] + g[p + w] + g[p + w + 1]) / 9;
    }
    var thr = otsu(hist, w * h), mask = new Uint8Array(w * h);
    for (i = 0; i < w * h; i++) mask[i] = b[i] > thr ? 1 : 0;
    // close small holes (printed text) with a dilation + erosion pass of radius 2 on a 1-D basis (fast & enough for receipts)
    mask = close1d(mask, w, h, 3);
    // largest connected bright component (4-neighbour BFS, iterative)
    var lab = new Int32Array(w * h), bestL = 0, bestA = 0, L = 0, stack = new Int32Array(w * h);
    for (i = 0; i < w * h; i++) {
      if (!mask[i] || lab[i]) continue;
      L++; var sp = 0, area = 0; stack[sp++] = i; lab[i] = L;
      while (sp) {
        var q = stack[--sp]; area++;
        var qx = q % w, qy = (q / w) | 0;
        if (qx > 0 && mask[q - 1] && !lab[q - 1]) { lab[q - 1] = L; stack[sp++] = q - 1; }
        if (qx < w - 1 && mask[q + 1] && !lab[q + 1]) { lab[q + 1] = L; stack[sp++] = q + 1; }
        if (qy > 0 && mask[q - w] && !lab[q - w]) { lab[q - w] = L; stack[sp++] = q - w; }
        if (qy < h - 1 && mask[q + w] && !lab[q + w]) { lab[q + w] = L; stack[sp++] = q + w; }
      }
      if (area > bestA) { bestA = area; bestL = L; }
    }
    var inset = function () { var m = 0.04; return [{ x: w * m, y: h * m }, { x: w * (1 - m), y: h * m }, { x: w * (1 - m), y: h * (1 - m) }, { x: w * m, y: h * (1 - m) }]; };
    if (!bestL || bestA < w * h * 0.08) return inset();
    var tl = null, tr = null, br = null, bl = null, sTL = 1e9, sBR = -1e9, dTR = -1e9, dBL = 1e9;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      if (lab[y * w + x] !== bestL) continue;
      var s = x + y, df = x - y;
      if (s < sTL) { sTL = s; tl = { x: x, y: y }; } if (s > sBR) { sBR = s; br = { x: x, y: y }; }
      if (df > dTR) { dTR = df; tr = { x: x, y: y }; } if (df < dBL) { dBL = df; bl = { x: x, y: y }; }
    }
    var q4 = [tl, tr, br, bl];
    if (polyArea(q4) < w * h * 0.08) return inset();
    return q4;
  }
  function close1d(m, w, h, r) {            // horizontal+vertical close (dilate then erode) with window r
    function pass(src, dil) {
      var out = new Uint8Array(w * h), x, y, k;
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        var hit = dil ? 0 : 1;
        for (k = -r; k <= r; k++) {
          var xx = x + k; if (xx < 0 || xx >= w) continue; var v = src[y * w + xx];
          if (dil && v) { hit = 1; break; } if (!dil && !v) { hit = 0; break; }
        }
        out[y * w + x] = hit;
      }
      var out2 = new Uint8Array(w * h);
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        var hit2 = dil ? 0 : 1;
        for (k = -r; k <= r; k++) {
          var yy = y + k; if (yy < 0 || yy >= h) continue; var v2 = out[yy * w + x];
          if (dil && v2) { hit2 = 1; break; } if (!dil && !v2) { hit2 = 0; break; }
        }
        out2[y * w + x] = hit2;
      }
      return out2;
    }
    return pass(pass(m, true), false);
  }
  function polyArea(p) { var a = 0, i; for (i = 0; i < p.length; i++) { var j = (i + 1) % p.length; a += p[i].x * p[j].y - p[j].x * p[i].y; } return Math.abs(a) / 2; }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  /* ---------------- perspective warp ---------------- */
  /** maps the unit square (u,v) → quad (TL,TR,BR,BL); returns a function. (Heckbert's square-to-quad.) */
  function sq2quad(q) {
    var x0 = q[0].x, y0 = q[0].y, x1 = q[1].x, y1 = q[1].y, x2 = q[2].x, y2 = q[2].y, x3 = q[3].x, y3 = q[3].y;
    var dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3, a, b, c, d, e, f, g, hh;
    if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) { a = x1 - x0; b = x2 - x1; c = x0; d = y1 - y0; e = y2 - y1; f = y0; g = 0; hh = 0; }
    else {
      var den = dx1 * dy2 - dx2 * dy1; g = (dx3 * dy2 - dx2 * dy3) / den; hh = (dx1 * dy3 - dx3 * dy1) / den;
      a = x1 - x0 + g * x1; b = x3 - x0 + hh * x3; c = x0; d = y1 - y0 + g * y1; e = y3 - y0 + hh * y3; f = y0;
    }
    return function (u, v) { var z = g * u + hh * v + 1; return [(a * u + b * v + c) / z, (d * u + e * v + f) / z]; };
  }
  function warp(srcCanvas, q) {
    var W = Math.max(dist(q[0], q[1]), dist(q[3], q[2])), H = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
    var k = Math.min(1, MAXOUT / Math.max(W, H)); W = Math.max(40, Math.round(W * k)); H = Math.max(40, Math.round(H * k));
    var sctx = srcCanvas.getContext('2d'), sw = srcCanvas.width, sh = srcCanvas.height, sd = sctx.getImageData(0, 0, sw, sh).data;
    var out = document.createElement('canvas'); out.width = W; out.height = H;
    var octx = out.getContext('2d'), od = octx.createImageData(W, H), map = sq2quad(q), x, y;
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      var p = map((x + 0.5) / W, (y + 0.5) / H), sx = p[0] - 0.5, sy = p[1] - 0.5;
      var x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0, o = (y * W + x) * 4, c;
      x0 = Math.max(0, Math.min(sw - 2, x0)); y0 = Math.max(0, Math.min(sh - 2, y0));
      var i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
      for (c = 0; c < 3; c++) od.data[o + c] = (sd[i00 + c] * (1 - fx) + sd[i10 + c] * fx) * (1 - fy) + (sd[i01 + c] * (1 - fx) + sd[i11 + c] * fx) * fy;
      od.data[o + 3] = 255;
    }
    // even out the contrast: stretch between the 2nd and 98th brightness percentile
    var hist = new Array(256).fill(0), n = W * H, i;
    for (i = 0; i < n; i++) hist[(od.data[i * 4] * 77 + od.data[i * 4 + 1] * 150 + od.data[i * 4 + 2] * 29) >> 8]++;
    var acc = 0, lo = 0, hi = 255; for (i = 0; i < 256; i++) { acc += hist[i]; if (acc >= n * 0.02) { lo = i; break; } }
    acc = 0; for (i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= n * 0.02) { hi = i; break; } }
    if (hi - lo > 40) { var s = 255 / (hi - lo); for (i = 0; i < n * 4; i += 4) for (c = 0; c < 3; c++) { var v = (od.data[i + c] - lo) * s; od.data[i + c] = v < 0 ? 0 : v > 255 ? 255 : v; } }
    octx.putImageData(od, 0, 0);
    return out;
  }

  /* ---------------- UI ---------------- */
  var CSS = '.sc-ov{position:fixed;inset:0;z-index:99999;background:#0a1413;display:flex;flex-direction:column;color:#fff;font-family:Inter,system-ui,sans-serif;touch-action:none}' +
    '.sc-top{padding:max(12px,env(safe-area-inset-top)) 16px 8px;text-align:center}.sc-top b{display:block;font:800 16px Manrope,Inter,sans-serif}.sc-top span{font-size:12.5px;opacity:.75}' +
    '.sc-stage{flex:1;position:relative;min-height:0;display:flex;align-items:center;justify-content:center;overflow:hidden}.sc-stage canvas{position:absolute;touch-action:none}' +
    '.sc-bar{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:10px 14px max(14px,env(safe-area-inset-bottom))}' +
    '.sc-bar button{min-height:50px;border-radius:14px;border:1.5px solid rgba(255,255,255,.28);background:transparent;color:#fff;font:700 14px Inter,sans-serif;cursor:pointer}' +
    '.sc-bar .go{grid-column:1/-1;background:linear-gradient(135deg,#1C8F84,#2FAE60);border:none;font-size:16px;min-height:54px}.sc-bar button:disabled{opacity:.5}';

  function loadBitmap(file) {
    if (root.createImageBitmap) return root.createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () { return viaImg(file); });
    return viaImg(file);
  }
  function viaImg(file) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file), im = new Image();
      im.onload = function () { URL.revokeObjectURL(url); res(im); }; im.onerror = function () { URL.revokeObjectURL(url); rej(new Error('Gambar tidak dapat dibaca')); };
      im.src = url;
    });
  }
  function toBlob(c, q) { return new Promise(function (r) { c.toBlob(r, 'image/jpeg', q); }); }

  function open(file) {
    return loadBitmap(file).then(function (bmp) {
      var iw = bmp.width, ih = bmp.height, k = Math.min(1, 2200 / Math.max(iw, ih));
      var src = document.createElement('canvas'); src.width = Math.round(iw * k); src.height = Math.round(ih * k);
      src.getContext('2d').drawImage(bmp, 0, 0, src.width, src.height);
      var dk = Math.min(1, DET / Math.max(src.width, src.height)), dc = document.createElement('canvas'); dc.width = Math.round(src.width * dk); dc.height = Math.round(src.height * dk);
      dc.getContext('2d').drawImage(src, 0, 0, dc.width, dc.height);
      var corners = detect(dc.getContext('2d').getImageData(0, 0, dc.width, dc.height)).map(function (p) { return { x: p.x / dk, y: p.y / dk }; });
      var auto = corners.map(function (p) { return { x: p.x, y: p.y }; });

      return new Promise(function (resolve) {
        if (!document.getElementById('scCss')) { var st = document.createElement('style'); st.id = 'scCss'; st.textContent = CSS; document.head.appendChild(st); }
        var ov = document.createElement('div'); ov.className = 'sc-ov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
        ov.innerHTML = '<div class="sc-top"><b>Laraskan tepi resit</b><span>Seret 4 bulatan ke penjuru kertas resit</span></div><div class="sc-stage" id="scStage"><canvas id="scImg"></canvas><canvas id="scOv"></canvas></div>' +
          '<div class="sc-bar"><button class="go" id="scGo">✂️ Potong & luruskan</button><button id="scAuto">🔄 Kesan semula</button><button id="scOrig">Guna gambar asal</button><button id="scCancel" style="grid-column:1/-1;border:none;opacity:.8">Batal</button></div>';
        document.body.appendChild(ov);
        var stage = ov.querySelector('#scStage'), ci = ov.querySelector('#scImg'), co = ov.querySelector('#scOv'), scale = 1, offX = 0, offY = 0, drag = -1;
        function layout() {
          var sw = stage.clientWidth, sh = stage.clientHeight; scale = Math.min(sw / src.width, sh / src.height) * 0.94;
          var dw = Math.round(src.width * scale), dh = Math.round(src.height * scale); offX = (sw - dw) / 2; offY = (sh - dh) / 2;
          [ci, co].forEach(function (c) { c.width = sw; c.height = sh; c.style.left = '0'; c.style.top = '0'; });
          ci.getContext('2d').drawImage(src, offX, offY, dw, dh); draw();
        }
        function toScr(p) { return { x: offX + p.x * scale, y: offY + p.y * scale }; }
        function draw() {
          var g = co.getContext('2d'); g.clearRect(0, 0, co.width, co.height);
          var s = corners.map(toScr); g.beginPath(); g.moveTo(s[0].x, s[0].y); for (var i = 1; i < 4; i++) g.lineTo(s[i].x, s[i].y); g.closePath();
          g.fillStyle = 'rgba(47,174,96,.16)'; g.fill(); g.lineWidth = 2.5; g.strokeStyle = '#4ADE80'; g.stroke();
          s.forEach(function (p) { g.beginPath(); g.arc(p.x, p.y, 15, 0, 6.2832); g.fillStyle = 'rgba(255,255,255,.92)'; g.fill(); g.lineWidth = 3; g.strokeStyle = '#16A34A'; g.stroke(); });
        }
        function pos(e) { var r = co.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
        co.addEventListener('pointerdown', function (e) {
          var p = pos(e), best = -1, bd = 44; corners.forEach(function (c, i) { var s = toScr(c), d = Math.hypot(s.x - p.x, s.y - p.y); if (d < bd) { bd = d; best = i; } });
          drag = best; if (best >= 0) { co.setPointerCapture(e.pointerId); e.preventDefault(); }
        });
        co.addEventListener('pointermove', function (e) {
          if (drag < 0) return; var p = pos(e);
          corners[drag] = { x: Math.max(0, Math.min(src.width, (p.x - offX) / scale)), y: Math.max(0, Math.min(src.height, (p.y - offY) / scale)) }; draw();
        });
        co.addEventListener('pointerup', function () { drag = -1; }); co.addEventListener('pointercancel', function () { drag = -1; });
        function close(v) { window.removeEventListener('resize', layout); document.removeEventListener('keydown', onKey); ov.remove(); resolve(v); }
        function onKey(e) { if (e.key === 'Escape') close(null); }
        document.addEventListener('keydown', onKey); window.addEventListener('resize', layout);
        ov.querySelector('#scAuto').onclick = function () { corners = auto.map(function (p) { return { x: p.x, y: p.y }; }); draw(); };
        ov.querySelector('#scCancel').onclick = function () { close(null); };
        ov.querySelector('#scOrig').onclick = function () {
          var k2 = Math.min(1, MAXOUT / Math.max(src.width, src.height)), c = document.createElement('canvas'); c.width = Math.round(src.width * k2); c.height = Math.round(src.height * k2);
          c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
          toBlob(c, 0.82).then(function (b) { close({ blob: b, dataUrl: c.toDataURL('image/jpeg', 0.82), mode: 'original' }); });
        };
        ov.querySelector('#scGo').onclick = function () {
          var btn = this; btn.disabled = true; btn.textContent = 'Memproses…';
          setTimeout(function () {
            try {
              if (polyArea(corners) < src.width * src.height * 0.02) { btn.disabled = false; btn.textContent = '✂️ Potong & luruskan'; alert('Kawasan terlalu kecil. Seret bulatan ke penjuru resit.'); return; }
              var out = warp(src, corners);
              toBlob(out, 0.85).then(function (b) { close({ blob: b, dataUrl: out.toDataURL('image/jpeg', 0.85), mode: 'scan' }); });
            } catch (e) { btn.disabled = false; btn.textContent = '✂️ Potong & luruskan'; alert('Tidak dapat memproses gambar. Cuba "Guna gambar asal".'); }
          }, 30);
        };
        requestAnimationFrame(layout);
      });
    });
  }

  root.SiagaScan = { open: open, detect: detect, _warp: warp };
})(typeof window !== 'undefined' ? window : this);
