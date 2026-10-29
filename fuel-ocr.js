/**
 * SIAGA — petrol receipt reader.
 * Reads a receipt photo in the browser (Tesseract.js, loaded only when needed — nothing is sent to any server for reading) and
 * suggests: total amount (RM), litres, fill date. The driver ALWAYS confirms or corrects the figures — this only saves typing.
 *
 *   SiagaReceipt.read(fileOrBlob, onProgress)  → Promise<{ amount, litres, price, date, confidence, raw }>
 *   SiagaReceipt.parse(text)                   → same object from plain OCR text (also used by the tests)
 *
 * confidence: 'high'   = labelled amount + litres found and RM/litre is believable (≈ RM1.50–4.50)
 *             'medium' = figures found but one was guessed / the price looks unusual
 *             'low'    = could not find a believable pair — fields are left empty for typing
 */
(function (root) {
  var TESS_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  var PRICE_MIN = 1.2, PRICE_MAX = 6.5;          // plausible RM per litre for the sanity check

  /* ---------------- parser ---------------- */
  function numbersIn(line) {
    var out = [], re = /(\d{1,4})[.,](\d{2,3})(?!\d)/g, m;
    while ((m = re.exec(line))) out.push(parseFloat(m[1] + '.' + m[2]));
    return out;
  }
  function clean(text) {
    // common OCR slips inside numbers: O→0, l/I→1 between digits, spaces around the decimal point
    return String(text || '').toUpperCase()
      .replace(/(\d)\s*[.,]\s*(\d)/g, '$1.$2')
      .replace(/([\d.])O(?=[\d.])/g, '$10')        // (no look-behind: older iPhones would fail to load the file)
      .replace(/([\d.])[IL](?=[\d.])/g, '$11');
  }
  var PRICE_LINE = /(HARGA|PRICE|RM\s*\/\s*L|\/\s*L\b|PER\s*L(ITRE|ITER)?|UNIT\s*PRICE)/;
  var SKIP_AMT   = /(TUNAI|CASH|BAKI|CHANGE|TENDER|DISC|DISKAUN|POINT|MATA|REWARD|ROUND|GST|SST|CARD NO|KAD)/;
  var AMT_LINE   = /(JUMLAH|JUM\b|TOTAL|AMOUNT|AMT|BAYAR|PAYABLE|GRAND|NETT?\b|SALE|\bRM\b)/;
  var LIT_LINE   = /(LITRE|LITER|LTR|VOLUME|VOL\b|QTY|QUANTITY|KUANTITI|ISIAN|DISPENS|\bL\b)/;

  function parseDate(t) {
    var now = new Date(), best = null, m, re = /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})|(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/g;
    while ((m = re.exec(t))) {
      var d, mo, y;
      if (m[4]) { y = +m[4]; mo = +m[5]; d = +m[6]; }
      else { d = +m[1]; mo = +m[2]; y = +m[3]; if (y < 100) y += 2000; }
      if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2020) continue;
      var dt = new Date(y, mo - 1, d);
      if (dt.getMonth() !== mo - 1) continue;
      if (dt.getTime() > now.getTime() + 86400000) continue;          // not in the future
      if (now.getTime() - dt.getTime() > 90 * 86400000) continue;     // not older than ~3 months (likely a different number)
      best = y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      break;
    }
    return best;
  }

  function parse(text) {
    var t = clean(text), lines = t.split(/\r?\n/);
    var amtC = [], litC = [], price = null, all = [];
    lines.forEach(function (ln) {
      var ns = numbersIn(ln);
      if (!ns.length) return;
      var isPrice = PRICE_LINE.test(ln), skip = SKIP_AMT.test(ln);
      if (isPrice) {
        ns.forEach(function (n) { if (n >= PRICE_MIN && n <= PRICE_MAX && price === null) price = n; });
      }
      if (!isPrice && !skip) ns.forEach(function (n) { all.push(n); });
      if (!isPrice && !skip && AMT_LINE.test(ln) && !LIT_LINE.test(ln)) amtC.push(ns[ns.length - 1]);
      if (!isPrice && LIT_LINE.test(ln)) ns.forEach(function (n) { if (n >= 2 && n <= 400) litC.push(n); });
    });

    var ok = function (a, l) { var r = a / l; return a > l && r >= PRICE_MIN && r <= PRICE_MAX; };
    var amount = null, litres = null, confidence = 'low';

    // 1) labelled pair
    outer:
    for (var i = amtC.length - 1; i >= 0; i--) {
      for (var j = 0; j < litC.length; j++) {
        if (ok(amtC[i], litC[j])) { amount = amtC[i]; litres = litC[j]; confidence = 'high'; break outer; }
      }
    }
    // 2) amount + unit price known → litres = amount / price (accept if a candidate is close, else suggest the computed value)
    if (amount === null && price !== null) {
      var A = amtC.length ? amtC[amtC.length - 1] : null;
      if (A !== null) {
        var near = litC.concat(all).filter(function (l) { return Math.abs(l - A / price) < 0.35; })[0];
        amount = A; litres = near !== undefined ? near : Math.round(A / price * 1000) / 1000;
        confidence = near !== undefined ? 'high' : 'medium';
      }
    }
    // 3) any believable pair among all numbers (prefer pairs near the printed unit price)
    if (amount === null) {
      var bestScore = -1e9, pair = null;
      all.forEach(function (a) {
        all.forEach(function (l) {
          if (!ok(a, l) || l < 3 || a > 1500) return;
          var r = a / l, s = -Math.abs(r - (price || 2.4));
          if (litC.indexOf(l) !== -1) s += 1;
          if (amtC.indexOf(a) !== -1) s += 1;
          if (s > bestScore) { bestScore = s; pair = [a, l]; }
        });
      });
      if (pair) { amount = pair[0]; litres = pair[1]; confidence = 'medium'; }
    }
    // confidence downgrade when the price per litre looks odd
    if (amount !== null && litres) {
      var rr = amount / litres;
      if (confidence === 'high' && (rr < 1.5 || rr > 4.5)) confidence = 'medium';
    }
    return {
      amount: amount, litres: litres, price: (amount && litres) ? Math.round(amount / litres * 1000) / 1000 : null,
      date: parseDate(t), confidence: confidence, raw: String(text || '')
    };
  }

  /* ---------------- image → text ---------------- */
  function loadScript(src) {
    return new Promise(function (res, rej) {
      if (root.Tesseract) return res();
      var s = document.createElement('script'); s.src = src; s.async = true;
      s.onload = function () { res(); }; s.onerror = function () { rej(new Error('Tidak dapat memuatkan pembaca resit (rangkaian).')); };
      document.head.appendChild(s);
    });
  }

  /** Down-scale, grey-scale and stretch the contrast: thermal-paper receipts read much better after this. */
  function prepare(file) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var max = 1800, k = Math.min(1, max / Math.max(img.width, img.height));
        var c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        var ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        try {
          var d = ctx.getImageData(0, 0, c.width, c.height), px = d.data, lo = 255, hi = 0, i, g;
          for (i = 0; i < px.length; i += 4) { g = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114; px[i] = g; if (g < lo) lo = g; if (g > hi) hi = g; }
          var span = Math.max(40, hi - lo);
          for (i = 0; i < px.length; i += 4) { g = Math.max(0, Math.min(255, (px[i] - lo) * 255 / span)); px[i] = px[i + 1] = px[i + 2] = g; }
          ctx.putImageData(d, 0, 0);
        } catch (e) { /* tainted/unsupported → use the plain image */ }
        res(c);
      };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('Gambar tidak dapat dibaca.')); };
      img.src = url;
    });
  }

  function read(file, onProgress) {
    var work = loadScript(TESS_URL).then(function () { return prepare(file); }).then(function (canvas) {
      return root.Tesseract.createWorker('eng', 1, {
        logger: function (m) { if (onProgress && m && m.status === 'recognizing text') onProgress(Math.round((m.progress || 0) * 100)); }
      }).then(function (worker) {
        return worker.setParameters({ tessedit_pageseg_mode: '6' })
          .then(function () { return worker.recognize(canvas); })
          .then(function (r) { return worker.terminate().then(function () { return parse(r.data.text); }); });
      });
    });
    var timeout = new Promise(function (_, rej) { setTimeout(function () { rej(new Error('Bacaan resit mengambil masa terlalu lama.')); }, 60000); });
    return Promise.race([work, timeout]);
  }

  root.SiagaReceipt = { read: read, parse: parse };
  if (typeof module !== 'undefined') module.exports = root.SiagaReceipt;
})(typeof window !== 'undefined' ? window : globalThis);
