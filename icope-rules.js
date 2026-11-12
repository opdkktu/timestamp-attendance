/* icope-rules.js — ICOPE screening judgement (SUGGESTIONS only; the staff member confirms every domain).
 * Domains follow the paper form "Saringan Asas Kapasiti Intrinsik Kesihatan Warga Emas".
 * Result per domain: 'LULUS' | 'LANJUT' (perlu penilaian lanjut) | 'TB' (tidak berkenaan) | '' (not enough answers yet) */
(function (root) {
  'use strict';
  var SNELLEN = ['6/6', '6/9', '6/12', '6/18', '6/24', '6/36', '6/60', '<6/60'];     // 0..7 ; pass = 6/12 or better
  var NEAR = ['N4', 'N5', 'N6', 'N8', 'N10', 'N12', 'N18', 'N24', 'Tidak dapat'];    // pass = N6 or better
  var DOMAINS = [
    ['cog', 'Kemerosotan kognitif', '🧠'], ['mob', 'Mobiliti terhad', '🚶'], ['nut', 'Malnutrisi', '🍽'], ['vis', 'Penglihatan', '👁'],
    ['hear', 'Pendengaran', '👂'], ['dep', 'Gejala kemurungan', '💭'], ['soc', 'Sokongan sosial & penjagaan', '🏠'], ['care', 'Sokongan kepada penjaga', '🤝'], ['uri', 'Masalah kawalan kencing', '💧']
  ];
  var ORI = ['tarikh', 'bulan', 'tahun', 'hari', 'tempat'], WORDS = ['bunga', 'pintu', 'nasi'];
  var yes = function (v) { return v === 'Y'; }, no = function (v) { return v === 'N'; }, has = function (v) { return v === 'Y' || v === 'N'; };

  /** a = answers object (see icope.html). Returns {cog:{r,why[],note[]}, ...} */
  function suggest(a) {
    a = a || {}; var o = {};
    // 1 cognition: any wrong orientation item, or not all 3 words recalled
    (function () {
      var c = a.cog || {}, ori = c.ori || {}, rec = c.rec || {}, why = [], note = [];
      var oriDone = ORI.every(function (k) { return has(ori[k]); }), recDone = WORDS.every(function (k) { return has(rec[k]); });
      if (!oriDone || !recDone) return (o.cog = { r: '', why: ['Lengkapkan orientasi & 3 perkataan'], note: [] });
      var wrong = ORI.filter(function (k) { return no(ori[k]); }), missed = WORDS.filter(function (k) { return no(rec[k]); });
      if (wrong.length) why.push('Orientasi salah: ' + wrong.join(', '));
      if (missed.length) why.push('Tidak ingat: ' + missed.join(', '));
      if (yes(c.q)) note.push('Pesakit mengadu masalah ingatan');
      o.cog = { r: why.length ? 'LANJUT' : 'LULUS', why: why, note: note };
    })();
    // 2 mobility: chair-rise 5x in <=14 s without hands
    (function () {
      var m = a.mob || {}, sec = parseFloat(m.sec), why = [];
      var ok = isFinite(sec) && m.sec !== '' ? sec <= 14 : (m.ok === 'Y' ? true : m.ok === 'N' ? false : null);
      if (ok === null) return (o.mob = { r: '', why: ['Isi keputusan Chair Rise Test'], note: [] });
      if (!ok) why.push(isFinite(sec) && m.sec !== '' ? 'Chair rise ' + sec + ' saat (>14)' : 'Tidak dapat selesai dalam 14 saat');
      o.mob = { r: ok ? 'LULUS' : 'LANJUT', why: why, note: [] };
    })();
    // 3 nutrition
    (function () {
      var n = a.nut || {}, why = [];
      if (!has(n.loss) || !has(n.appetite)) return (o.nut = { r: '', why: ['Jawab dua soalan'], note: [] });
      if (yes(n.loss)) why.push('Berat badan turun >3 kg / 3 bulan'); if (yes(n.appetite)) why.push('Hilang selera makan');
      o.nut = { r: why.length ? 'LANJUT' : 'LULUS', why: why, note: [] };
    })();
    // 4 vision: distance each eye (pass 6/12 or better WITHOUT pinhole), near N6 or better. Pinhole only explains the cause.
    (function () {
      var v = a.vis || {}, why = [], note = [], idx = function (s) { return SNELLEN.indexOf(s); }, nidx = NEAR.indexOf(v.near);
      if (idx(v.ru) < 0 || idx(v.lu) < 0 || nidx < 0) return (o.vis = { r: '', why: ['Isi penglihatan kanan, kiri (tanpa pinhole) & dekat'], note: [] });
      [['Kanan', 'ru', 'rp'], ['Kiri', 'lu', 'lp']].forEach(function (e) {
        var u = idx(v[e[1]]), p = idx(v[e[2]]);
        if (u > 2) {
          why.push(e[0] + ' ' + v[e[1]] + ' (tanpa pinhole)');
          if (p >= 0) note.push(p <= 2 ? e[0] + ': bertambah baik dengan pinhole (' + v[e[2]] + ') — mungkin kesalahan biasan, rujuk optometri / cermin mata' : e[0] + ': tidak bertambah baik dengan pinhole (' + v[e[2]] + ') — nilai punca lain (katarak, glaukoma, retina)');
          else note.push(e[0] + ': belum diuji dengan pinhole');
        }
      });
      if (nidx > 2) why.push('Penglihatan dekat ' + v.near + ' (lebih teruk daripada N6)');
      if (yes(v.q)) note.push('Pesakit mengadu masalah mata / ada risiko (DM, hipertensi, steroid)');
      o.vis = { r: why.length ? 'LANJUT' : 'LULUS', why: why, note: note };
    })();
    // 5 hearing
    (function () {
      var h = a.hear || {}, why = [], note = [];
      if (h.res !== 'LULUS' && h.res !== 'GAGAL') return (o.hear = { r: '', why: ['Isi keputusan ujian pendengaran'], note: [] });
      if (h.res === 'GAGAL') why.push('Gagal ujian pendengaran' + (h.method ? ' (' + h.method + ')' : ''));
      if (yes(h.q)) note.push('Pesakit mengadu masalah pendengaran');
      o.hear = { r: why.length ? 'LANJUT' : 'LULUS', why: why, note: note };
    })();
    // 6 depression (2 questions, any "Ya")
    (function () {
      var d = a.dep || {}, why = [], note = [];
      if (!has(d.d1) || !has(d.d2)) return (o.dep = { r: '', why: ['Jawab dua soalan'], note: [] });
      if (yes(d.d1)) why.push('Sedih / tertekan / putus asa'); if (yes(d.d2)) why.push('Kehilangan minat / keseronokan');
      if (why.length) note.push('Pertimbang Saringan Minda (PHQ-9) dan tanya risiko keselamatan');
      o.dep = { r: why.length ? 'LANJUT' : 'LULUS', why: why, note: note };
    })();
    // 7 social support (4 questions, any "Ya")
    (function () {
      var s = a.soc || {}, why = [], L = { home: 'Masalah persekitaran rumah', money: 'Kekurangan dana / kewangan', lonely: 'Kesepian / pengasingan sosial', part: 'Sukar meneruskan aktiviti / penglibatan' };
      if (!['home', 'money', 'lonely', 'part'].every(function (k) { return has(s[k]); })) return (o.soc = { r: '', why: ['Jawab empat soalan'], note: [] });
      Object.keys(L).forEach(function (k) { if (yes(s[k])) why.push(L[k]); });
      o.soc = { r: why.length ? 'LANJUT' : 'LULUS', why: why, note: [] };
    })();
    // 8 caregiver support (only when a caregiver exists)
    (function () {
      var c = a.care || {}, why = [];
      if (c.has === 'N') return (o.care = { r: 'TB', why: [], note: ['Tiada penjaga / waris'] });
      if (c.has !== 'Y') return (o.care = { r: '', why: ['Adakah ada penjaga / waris?'], note: [] });
      if (!has(c.support) || !has(c.confident) || !has(c.neg)) return (o.care = { r: '', why: ['Jawab tiga soalan'], note: [] });
      if (no(c.support)) why.push('Penjaga rasa sokongan tidak mencukupi'); if (no(c.confident)) why.push('Penjaga kurang yakin memberi penjagaan'); if (yes(c.neg)) why.push('Kesan negatif terhadap penjaga');
      o.care = { r: why.length ? 'LANJUT' : 'LULUS', why: why, note: [] };
    })();
    // 9 urinary
    (function () {
      var u = a.uri || {};
      if (!has(u.q)) return (o.uri = { r: '', why: ['Jawab soalan'], note: [] });
      o.uri = { r: yes(u.q) ? 'LANJUT' : 'LULUS', why: yes(u.q) ? ['Masalah kawalan kencing'] : [], note: [] };
    })();
    return o;
  }
  /** overall from CONFIRMED domain results: {all: bool (every applicable domain decided), overall:'LULUS'|'LANJUT'|''} */
  function overall(res) {
    var all = true, lanjut = false;
    DOMAINS.forEach(function (d) { var r = res[d[0]]; if (r !== 'LULUS' && r !== 'LANJUT' && r !== 'TB') all = false; if (r === 'LANJUT') lanjut = true; });
    return { all: all, overall: !all ? '' : lanjut ? 'LANJUT' : 'LULUS' };
  }
  var api = { suggest: suggest, overall: overall, DOMAINS: DOMAINS, SNELLEN: SNELLEN, NEAR: NEAR, ORI: ORI, WORDS: WORDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ICOPE = api;
})(this);
