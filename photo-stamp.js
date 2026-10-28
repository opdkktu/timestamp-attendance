/**
 * SIAGA — proof-photo stamp.
 * Takes the face check-in snapshot from the live <video>, centre-crops it to a square (no squashed faces),
 * and burns the date/time + latitude/longitude into a bottom corner of the saved JPEG, so every proof photo
 * carries its own evidence even after it is moved or downloaded.
 *
 *   const jpegDataUrl = SiagaStamp.capture(videoEl, userLocation, previewCanvasEl);
 *   (userLocation = {lat, lng, acc?}; previewCanvasEl is optional)
 *
 * The preview canvas (what the person sees after the shutter) stays unstamped and small; only the uploaded file is stamped.
 */
(function () {
  var lastCode = { code: '', w: 0 };
  var CORNER = 'left';       // 'left' or 'right' — which bottom corner carries the stamp
  var SIZE = 480;            // saved photo is at most SIZE × SIZE px (≈ 40–60 KB as JPEG)
  var QUALITY = 0.82;

  // Security code: fetched from the server (getProofCode), different for every person and every 5 minutes; printed in the corner.
  var sec = { code: '', w: 0, until: 0 }, timer = 0;
  function prefetch(apiUrl, token) {
    function go() {
      return fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'getProofCode', token: token }) })
        .then(function (r) { return r.json(); })
        .then(function (d) { if (d && d.ok) { sec = { code: d.code, w: d.w, until: Date.now() + d.expiresInSec * 1000 }; clearTimeout(timer); timer = setTimeout(go, Math.max(5000, d.expiresInSec * 1000 - 5000)); } })
        .catch(function () { clearTimeout(timer); timer = setTimeout(go, 8000); });
    }
    return go();
  }
  function current() { return (sec.code && Date.now() < sec.until + 60000) ? { code: sec.code, w: sec.w } : { code: '', w: 0 }; }

  function when() {
    var d = new Date();
    try {
      return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kuala_Lumpur', day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
      }).format(d).replace(',', '');
    } catch (e) {
      var p = function (n) { return (n < 10 ? '0' : '') + n; };
      return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
    }
  }

  function where(loc) {
    if (!loc || typeof loc.lat !== 'number' || typeof loc.lng !== 'number') return 'Lokasi tidak tersedia';
    var s = loc.lat.toFixed(6) + ', ' + loc.lng.toFixed(6);
    if (typeof loc.acc === 'number' && isFinite(loc.acc)) s += '  ±' + Math.round(loc.acc) + 'm';
    return s;
  }

  function capture(video, loc, preview) {
    var vw = video.videoWidth || 480, vh = video.videoHeight || 480;
    var s = Math.min(vw, vh), sx = (vw - s) / 2, sy = (vh - s) / 2;

    if (preview) {
      preview.width = 240; preview.height = 240;
      preview.getContext('2d').drawImage(video, sx, sy, s, s, 0, 0, 240, 240);
    }

    var out = Math.min(s, SIZE);
    var c = document.createElement('canvas');
    c.width = out; c.height = out;
    var ctx = c.getContext('2d');
    ctx.drawImage(video, sx, sy, s, s, 0, 0, out, out);

    // ---- stamp ----
    var fs = Math.max(11, Math.round(out * 0.036));
    var cur = current(); lastCode = cur;
    var lines = [when(), where(loc), 'KOD: ' + (cur.code || '------')];
    ctx.font = '600 ' + fs + 'px Arial, Helvetica, sans-serif';
    ctx.textBaseline = 'alphabetic';
    var w = 0;
    lines.forEach(function (t) { w = Math.max(w, ctx.measureText(t).width); });
    var padX = Math.round(fs * 0.6), padY = Math.round(fs * 0.45), gap = Math.round(fs * 0.25);
    var boxW = Math.ceil(w + padX * 2), boxH = Math.ceil(fs * 3 + gap * 2 + padY * 2);
    var margin = Math.round(out * 0.02);
    var bx = CORNER === 'right' ? out - boxW - margin : margin;
    var by = out - boxH - margin;

    ctx.fillStyle = 'rgba(0,0,0,0.58)';
    ctx.fillRect(bx, by, boxW, boxH);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.fillText(lines[0], bx + padX, by + padY + fs - Math.round(fs * 0.15));
    ctx.fillText(lines[1], bx + padX, by + padY + fs * 2 + gap - Math.round(fs * 0.15));
    ctx.fillStyle = '#ffe066'; ctx.fillText(lines[2], bx + padX, by + padY + fs * 3 + gap * 2 - Math.round(fs * 0.15));

    return c.toDataURL('image/jpeg', QUALITY);
  }

  window.SiagaStamp = { capture: capture, prefetch: prefetch, lastCode: function () { return lastCode; } };
})();
