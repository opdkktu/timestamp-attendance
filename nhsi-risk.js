/* nhsi-risk.js — shared by nhsi.html (doctor) and nhsi-result.html (client).
 * 1) 10-year general cardiovascular risk: Framingham BMI-based model (D'Agostino et al., Circulation 2008), valid age 30-74.
 *    risk = 1 - S0 ^ exp(sum(beta*x) - mean).   A SCREENING ESTIMATE only — the doctor decides.
 * 2) Contributing factors from the screening results.
 * 3) Malaysia statistics — EDIT HERE when newer figures are published. */
(function (root) {
  'use strict';
  var MEN = { age: 3.11296, bmi: 0.79277, sbpU: 1.85508, sbpT: 1.92672, smoke: 0.70953, dm: 0.53160, s0: 0.88431, mean: 23.9388 };
  var WOMEN = { age: 2.72107, bmi: 0.51125, sbpU: 2.81291, sbpT: 2.88267, smoke: 0.61868, dm: 0.77763, s0: 0.94833, mean: 26.0145 };
  var CUT = { mid: 10, high: 20 };               // % — <10 low, 10–20 intermediate, >20 high

  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : NaN; }

  /** in: {age, gender:'Lelaki'|'Perempuan', bmi, sbp, treated, smoker, diabetes}  → {ok, pct, level:0|1|2, reason} */
  function cvdRisk(i) {
    var age = num(i.age), bmi = num(i.bmi), sbp = num(i.sbp);
    if (!(age >= 30 && age <= 74)) return { ok: false, reason: 'age' };
    if (!(bmi > 10) || !(sbp > 50)) return { ok: false, reason: 'data' };
    var m = i.gender === 'Lelaki' ? MEN : WOMEN;
    var s = m.age * Math.log(age) + m.bmi * Math.log(bmi) + (i.treated ? m.sbpT : m.sbpU) * Math.log(sbp) +
            (i.smoker ? m.smoke : 0) + (i.diabetes ? m.dm : 0);
    var p = (1 - Math.pow(m.s0, Math.exp(s - m.mean))) * 100;
    p = Math.round(Math.min(p, 60) * 10) / 10;
    return { ok: true, pct: p, level: p < CUT.mid ? 0 : p < CUT.high ? 1 : 2 };
  }

  /** Build the risk inputs from a client record (staff list row or public result). */
  function inputsOf(c) {
    var hist = String(c.history || (c.hist || []).join('; ')), g = num(c.glucose), gt = c.glucoseType || c.gt, cfg = c.cfg || {};
    var dmGlu = g > 0 && (gt === 'Puasa' ? g >= (cfg.fbs_high || 7) : g >= (cfg.rbs_high || 11.1));
    var sm = c.smoking || c.sm;
    var cig = (c.smokeType || c.st) === 'Rokok' || (c.smokeType || c.st) === 'Kedua-duanya' || (sm === 'Perokok' && !(c.smokeType || c.st));
    return { age: c.age, gender: c.gender, bmi: c.bmi, sbp: c.sbp, treated: /Darah tinggi/.test(hist),
             smoker: sm === 'Perokok' && cig, diabetes: /Kencing manis/.test(hist) || dmGlu };
  }

  /** Contributing factors. level 0 fine, 1 watch, 2 high. mod = can be changed. */
  function factors(c) {
    var cfg = c.cfg || {}, out = [], age = num(c.age), bmi = num(c.bmi), sbp = num(c.sbp), dbp = num(c.dbp),
        g = num(c.glucose), gt = c.glucoseType, ch = num(c.chol), hist = String(c.history || '');
    function add(k, lv, mod) { out.push({ k: k, lv: lv, mod: mod }); }
    if (age >= 55) add('age', 2, false); else if (age >= 40) add('age', 1, false);
    add('sex', c.gender === 'Lelaki' && age >= 45 ? 1 : 0, false);
    if (isFinite(bmi)) add('bmi', bmi >= (cfg.bmi_obese || 27.5) ? 2 : bmi >= (cfg.bmi_over || 23) ? 1 : 0, true);
    if (isFinite(sbp)) add('bp', (sbp >= (cfg.bp_sys_high || 140) || dbp >= (cfg.bp_dia_high || 90) || /Darah tinggi/.test(hist)) ? 2 : (sbp >= 130 || dbp >= 85) ? 1 : 0, true);
    if (isFinite(g)) { var hi = gt === 'Puasa' ? g >= (cfg.fbs_high || 7) : g >= (cfg.rbs_high || 11.1), mid = gt === 'Puasa' ? g >= (cfg.fbs_ifg || 6.1) : g >= (cfg.rbs_border || 7.8);
      add('glucose', hi || /Kencing manis/.test(hist) ? 2 : mid ? 1 : 0, true); }
    else if (/Kencing manis/.test(hist)) add('glucose', 2, true);
    if (isFinite(ch)) add('chol', ch >= (cfg.chol_high || 6.2) ? 2 : ch >= (cfg.chol_border || 5.2) ? 1 : 0, true);
    var sm = c.smoking, st = c.smokeType;
    add('smoke', sm === 'Perokok' ? 2 : sm === 'Bekas perokok' ? 1 : 0, true);
    if (/Penyakit jantung|Strok/.test(hist)) add('hx', 2, false);
    return out;
  }


  /** Result levels for each measurement. {lv:0..3, lab:i18n key}. */
  function levels(c) {
    var cfg = c.cfg || {}, o = {}, bmi = num(c.bmi), sbp = num(c.sbp), dbp = num(c.dbp), pul = num(c.pulse), g = num(c.glucose), ch = num(c.chol);
    var L = ['l_0', 'l_1', 'l_2', 'l_3'];
    if (c.bmiCat) { var m = { 'Kurang berat badan': [1, 'c_under'], 'Normal': [0, 'c_normal'], 'Berat badan berlebihan': [1, 'c_over'], 'Obes': [2, 'c_obese'] }[c.bmiCat]; if (m) o.bmi = { lv: m[0], lab: m[1] }; }
    if (c.s2 && isFinite(sbp) && isFinite(dbp)) { var v = (sbp >= (cfg.bp_sys_urgent || 180) || dbp >= (cfg.bp_dia_urgent || 110)) ? 3 : (sbp >= (cfg.bp_sys_high || 140) || dbp >= (cfg.bp_dia_high || 90)) ? 2 : 0; o.bp = { lv: v, lab: L[v] }; }
    if (c.s2 && isFinite(pul)) o.pulse = pul < (cfg.pulse_low || 60) ? { lv: 1, lab: 'l_low' } : pul > (cfg.pulse_high || 100) ? { lv: 1, lab: 'l_2' } : { lv: 0, lab: 'l_0' };
    if (c.s2 && isFinite(g)) { var f = c.glucoseType === 'Puasa', x = f ? (g >= (cfg.fbs_high || 7) ? 2 : g >= (cfg.fbs_ifg || 6.1) ? 1 : 0) : (g >= (cfg.rbs_high || 11.1) ? 2 : g >= (cfg.rbs_border || 7.8) ? 1 : 0); o.glucose = { lv: x, lab: L[x] }; }
    if (c.s2 && isFinite(ch)) { var y = ch >= (cfg.chol_high || 6.2) ? 2 : ch >= (cfg.chol_border || 5.2) ? 1 : 0; o.chol = { lv: y, lab: L[y] }; }
    return o;
  }

  /** pack-years from cigarettes/day and years (cigarettes only). */
  function packYears(perDay, years) { var a = num(perDay), y = num(years); return a > 0 && y > 0 ? Math.round(a / 20 * y * 10) / 10 : 0; }

  /** Malaysia figures. Percent unless noted. Keep sources in sync. */
  var STATS = {
    year: 2023,
    obese: 21.8, overweight: 32.6, overweightObese: 54.4, abdominal: 54.5,
    hypertension: 29.2, diabetes: 15.6, cholesterol: 33.3, smoker: 19.0, vape: 5.0,
    ihdDeathPct: 13, ihdDeaths: 17421, certDeaths: 133844, deathYear: 2024,
    src: [
      { t: 'NHMS 2023 — Institute for Public Health, MOH', u: 'https://iku.moh.gov.my/images/nhms2023/fact-sheet-nhms-2023.pdf' },
      { t: 'DOSM — Statistics on Causes of Death, Malaysia 2024', u: 'https://www.dosm.gov.my/portal-main/release-content/statistics-on-causes-of-death-malaysia-2024' }
    ]
  };

  var api = { levels: levels, cvdRisk: cvdRisk, inputsOf: inputsOf, factors: factors, packYears: packYears, STATS: STATS, CUT: CUT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.NHSI_RISK = api;
})(this);
