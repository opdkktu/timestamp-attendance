/* SIAGA — Face ID / Touch ID helper: tells the user WHY it did not work (instead of failing silently).
 *   SiagaBio.check()      → { ok, reason }   can this phone / browser do it at all?
 *   SiagaBio.explain(err) → { code, text }   a plain Malay message for a WebAuthn error
 * Used by login.html, profile.html and my-checkin.html. */
(function () {
  var ua = navigator.userAgent || '';
  var inApp = /FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|TikTok|Snapchat|GSA\/|; wv\)|WebView/i.test(ua);

  function explain(err) {
    var n = (err && err.name) || 'Error';
    var t;
    if (n === 'NotAllowedError') t = 'Pengesahan dibatalkan atau tamat masa. Tekan butang sekali lagi dan sahkan dengan Face ID / cap jari / kunci skrin apabila diminta (jangan tutup tetingkap itu).';
    else if (n === 'SecurityError') t = 'Pelayar tidak membenarkan ciri ini di sini. Buka SIAGA dalam Chrome / Safari atau aplikasi SIAGA yang dipasang di skrin utama (bukan dari dalam WhatsApp / Facebook).';
    else if (n === 'InvalidStateError') t = 'Face ID / Touch ID sudah didaftarkan pada telefon ini. Cuba log masuk dengan Face ID, atau padam dahulu "passkey" SIAGA dalam tetapan telefon.';
    else if (n === 'NotSupportedError') t = 'Telefon / pelayar ini tidak menyokong Face ID / Touch ID untuk SIAGA. Kemas kini pelayar, atau guna kata laluan.';
    else if (n === 'AbortError') t = 'Pengesahan dihentikan. Cuba sekali lagi.';
    else if (n === 'TypeError') t = 'Pelayar ini tidak lengkap menyokong ciri ini. Kemas kini pelayar anda.';
    else t = 'Tidak berjaya. Pastikan telefon anda mempunyai kunci skrin / Face ID / cap jari yang telah ditetapkan, kemudian cuba lagi.';
    if (inApp && n !== 'AbortError') t += ' Anda kelihatan membuka dari dalam aplikasi lain — buka dalam Chrome / Safari.';
    return { code: n, text: t };
  }

  function check() {
    if (!window.isSecureContext) return Promise.resolve({ ok: false, reason: 'Laman ini mesti dibuka melalui HTTPS.' });
    if (!window.PublicKeyCredential || !navigator.credentials || !navigator.credentials.create) return Promise.resolve({ ok: false, reason: 'Pelayar ini tidak menyokong Face ID / Touch ID. Kemas kini Chrome / Safari.' });
    if (inApp) return Promise.resolve({ ok: false, reason: 'Buka SIAGA dalam Chrome / Safari (bukan dari dalam WhatsApp / Facebook) untuk menggunakan Face ID / Touch ID.' });
    return PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().then(function (v) {
      return v ? { ok: true, reason: '' } : { ok: false, reason: 'Telefon ini belum menetapkan Face ID / cap jari / kunci skrin. Tetapkan dalam Tetapan telefon, kemudian cuba lagi.' };
    }).catch(function () { return { ok: false, reason: 'Tidak dapat menyemak sokongan Face ID / Touch ID pada telefon ini.' }; });
  }

  window.SiagaBio = { explain: explain, check: check, inApp: inApp };
})();
