/**
 * KKAH HR Portal — version badge + "update available" banner.
 * Include AFTER version.js on every page: it reads APP_VERSION from there.
 * Browser-only (uses document/window) — never loaded by sw.js.
 */

function getCopyrightLine(){
  return '© ' + new Date().getFullYear() + ' ' + COPYRIGHT_HOLDER + '. All rights reserved.';
}

/** Small fixed-position version tag, visible from the moment the page paints — not just while loading. */
function mountVersionBadge(){
  if(document.getElementById('appVersionBadge')) return;
  const el = document.createElement('div');
  el.id = 'appVersionBadge';
  el.style.cssText = 'position:fixed;bottom:8px;right:10px;font-size:10px;color:#5B6B68;' +
    'opacity:.55;font-family:Inter,sans-serif;z-index:40;pointer-events:none;letter-spacing:.02em;';
  el.textContent = 'v' + APP_VERSION;
  document.body.appendChild(el);
}

/**
 * Fetches THIS SAME version.js fresh (cache:'no-store' bypasses the browser
 * HTTP cache entirely, independent of the service worker) and compares its
 * APP_VERSION to what this device last saw. Different = a new deploy
 * happened since this device last loaded the app, so show a banner rather
 * than silently leaving them on a stale cached copy.
 */
async function checkForUpdate(){
  try{
    const res = await fetch('./version.js?t=' + Date.now(), { cache: 'no-store' });
    const text = await res.text();
    const match = text.match(/APP_VERSION\s*=\s*'([^']+)'/);
    const liveVersion = match ? match[1] : null;
    if(!liveVersion) return;

    const seen = localStorage.getItem('kkah_seen_version');
    if(seen && seen !== liveVersion){
      showUpdateBanner(liveVersion);
    }else if(!seen){
      localStorage.setItem('kkah_seen_version', liveVersion);
    }
  }catch(err){
    // Offline or request blocked — fail silently, not worth alarming staff over.
  }
}

function showUpdateBanner(newVersion){
  if(document.getElementById('updateBanner')) return;
  const el = document.createElement('div');
  el.id = 'updateBanner';
  el.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#0B3D3A;color:#fff;' +
    'text-align:center;padding:10px 16px;font-size:13px;font-family:Inter,sans-serif;z-index:100;cursor:pointer;';
  el.textContent = '🔄 A new version (' + newVersion + ') is available — tap to refresh';
  el.onclick = function(){
    localStorage.setItem('kkah_seen_version', newVersion);
    if('caches' in window){
      caches.keys()
        .then(function(names){ return Promise.all(names.map(function(n){ return caches.delete(n); })); })
        .finally(function(){ window.location.reload(); });
    }else{
      window.location.reload();
    }
  };
  document.body.appendChild(el);
}

window.addEventListener('DOMContentLoaded', function(){
  mountVersionBadge();
  checkForUpdate();
});
