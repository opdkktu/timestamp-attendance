/* SIAGA — device id (one account = one phone).
 * A random id made once on this phone and kept in localStorage (+ a copy in IndexedDB in case one of them is wiped).
 * login.html sends it with every login:  deviceId: SiagaDevice.id()
 * The id is not secret and not a fingerprint — it only tells the server "this is the same phone as last time". */
(function () {
  var K = 'kkah_device_id', DB = 'kkah_dev', ST = 'kv', mem = '';
  function gen() {
    try { if (crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    var a = new Uint8Array(16); crypto.getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  function lsGet() { try { return localStorage.getItem(K) || ''; } catch (e) { return ''; } }
  function lsSet(v) { try { localStorage.setItem(K, v); } catch (e) {} }
  function idb(cb) {
    try {
      var r = indexedDB.open(DB, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore(ST); };
      r.onsuccess = function () { try { cb(r.result); } catch (e) {} };
      r.onerror = function () {};
    } catch (e) {}
  }
  function idbPut(v) { idb(function (db) { db.transaction(ST, 'readwrite').objectStore(ST).put(v, K); }); }

  function id() {
    var v = lsGet() || mem;
    if (!v) { v = gen(); mem = v; lsSet(v); idbPut(v); }
    return v;
  }

  // On load: if localStorage lost the id but IndexedDB still has it, restore it (so the phone is not treated as new).
  (function restore() {
    if (lsGet()) { idbPut(lsGet()); return; }
    idb(function (db) {
      var q = db.transaction(ST, 'readonly').objectStore(ST).get(K);
      q.onsuccess = function () { if (q.result && !lsGet()) { mem = q.result; lsSet(q.result); } };
    });
  })();

  window.SiagaDevice = { id: id };
})();
