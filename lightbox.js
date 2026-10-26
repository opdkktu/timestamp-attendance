/**
 * SIAGA lightbox — opens pictures in an overlay inside the page, with "Buka di Drive" at the bottom.
 *   <a href="DRIVE-URL" data-lb="group" data-title="Resit 12 Okt">…</a>   → click opens the overlay (same group = swipe/next through them)
 *   <img src="data:…" data-zoom>                                            → click enlarges a local preview (no Drive link)
 *   SiagaLightbox.open([{ url, title }], startIndex)                        → from code
 * Drive links are shown through Drive's own picture address, so the person must be signed in to a Google account that can open the file
 * (same as opening it in Drive). If the picture cannot be shown here, the overlay says so and the Drive button still works.
 */
(function(){
  if(window.SiagaLightbox) return;
  var css = '#sglb{position:fixed;inset:0;z-index:2000;background:rgba(8,14,13,.94);display:none;flex-direction:column;color:#fff;font-family:Inter,system-ui,sans-serif;touch-action:manipulation}' +
    '#sglb.show{display:flex}' +
    '#sglb .tb{display:flex;align-items:center;gap:10px;padding:max(10px,env(safe-area-inset-top)) 14px 10px}' +
    '#sglb .tt{flex:1;min-width:0;font-weight:700;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '#sglb .ct{font-size:12px;opacity:.7;font-weight:600}' +
    '#sglb button,#sglb a.dv{min-height:46px;border-radius:14px;border:1.5px solid rgba(255,255,255,.28);background:rgba(255,255,255,.12);color:#fff;font:700 14px Inter,system-ui,sans-serif;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;padding:0 16px}' +
    '#sglb .x{width:46px;padding:0;font-size:20px}' +
    '#sglb .stage{position:relative;flex:1;min-height:0;overflow:auto;display:flex;align-items:center;justify-content:center;-webkit-overflow-scrolling:touch}' +
    '#sglb .stage img{max-width:100%;max-height:100%;object-fit:contain;display:block;cursor:zoom-in;user-select:none;-webkit-user-drag:none}' +
    '#sglb .stage.z{align-items:flex-start;justify-content:flex-start}' +
    '#sglb .stage.z img{max-width:none;max-height:none;width:200%;cursor:zoom-out}' +
    '#sglb iframe{width:100%;height:100%;border:0;background:#fff}' +
    '#sglb .msg{padding:24px;text-align:center;line-height:1.6;font-size:14px;opacity:.9;max-width:320px}' +
    '#sglb .sp{width:34px;height:34px;border:4px solid rgba(255,255,255,.25);border-top-color:#fff;border-radius:50%;animation:sglbsp .8s linear infinite}' +
    '@keyframes sglbsp{to{transform:rotate(360deg)}}' +
    '#sglb .nv{position:absolute;top:50%;transform:translateY(-50%);width:46px;height:64px;padding:0;font-size:24px;z-index:2}' +
    '#sglb .pv{left:8px}#sglb .nx{right:8px}' +
    '#sglb .bb{display:flex;justify-content:center;gap:10px;padding:12px 14px max(14px,env(safe-area-inset-bottom))}' +
    '#sglb a.dv{background:#fff;color:#0B3D3A;border-color:#fff;min-width:220px}' +
    '@media (prefers-reduced-motion:reduce){#sglb .sp{animation:none}}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  var root, items = [], idx = 0, pushed = false, tries = 0, zoomed = false;
  function driveId(u){
    var m = /\/file\/d\/([\w-]{10,})/.exec(u) || /[?&]id=([\w-]{10,})/.exec(u) || /\/d\/([\w-]{10,})/.exec(u);
    return m ? m[1] : '';
  }
  function candidates(u){
    if(/^(data:|blob:)/.test(u)) return [u];
    var id = driveId(u);
    if(!id) return [u];
    return ['https://drive.google.com/thumbnail?id=' + id + '&sz=w2000', 'https://lh3.googleusercontent.com/d/' + id + '=w2000'];
  }
  function build(){
    root = document.createElement('div'); root.id = 'sglb'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Paparan gambar');
    root.innerHTML = '<div class="tb"><div class="tt"></div><div class="ct"></div><button type="button" class="x" aria-label="Tutup">✕</button></div>' +
      '<div class="stage" id="sglbStage"></div><div class="bb"><a class="dv" target="_blank" rel="noopener">↗ Buka di Drive</a></div>';
    document.body.appendChild(root);
    root.querySelector('.x').onclick = function(){ close(true); };
    root.addEventListener('click', function(e){ if(e.target === root.querySelector('.stage')) close(true); });
    document.addEventListener('keydown', function(e){
      if(!root.classList.contains('show')) return;
      if(e.key === 'Escape') close(true); else if(e.key === 'ArrowRight') go(1); else if(e.key === 'ArrowLeft') go(-1);
    });
    var sx = null, sy = null, stg = root.querySelector('.stage');
    stg.addEventListener('touchstart', function(e){ if(zoomed || e.touches.length !== 1){ sx = null; return; } sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive:true });
    stg.addEventListener('touchend', function(e){
      if(sx === null) return; var t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy; sx = null;
      if(Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
    }, { passive:true });
    window.addEventListener('popstate', function(){ if(root.classList.contains('show')){ pushed = false; close(false); } });
  }
  function msg(html){ var s = root.querySelector('.stage'); s.className = 'stage'; zoomed = false; s.innerHTML = '<div class="msg">' + html + '</div>'; }
  function show(){
    var it = items[idx], s = root.querySelector('.stage'), url = it.url, c = candidates(url); tries = 0; zoomed = false;
    root.querySelector('.tt').textContent = it.title || '';
    root.querySelector('.ct').textContent = items.length > 1 ? (idx + 1) + ' / ' + items.length : '';
    var dv = root.querySelector('a.dv'), local = /^(data:|blob:)/.test(url);
    dv.style.display = local ? 'none' : ''; if(!local) dv.href = url;
    s.className = 'stage'; s.innerHTML = '<div class="sp" role="status" aria-label="Memuatkan"></div>';
    if(items.length > 1){
      s.insertAdjacentHTML('beforeend', '<button type="button" class="nv pv" aria-label="Sebelum">‹</button><button type="button" class="nv nx" aria-label="Seterusnya">›</button>');
      s.querySelector('.pv').onclick = function(e){ e.stopPropagation(); go(-1); };
      s.querySelector('.nx').onclick = function(e){ e.stopPropagation(); go(1); };
    }
    (function next(){
      if(tries >= c.length){
        var id = driveId(url);
        if(id){                                                    // last resort: Drive's own previewer
          s.innerHTML = '<iframe src="https://drive.google.com/file/d/' + id + '/preview" title="Pratonton Drive" allow="autoplay"></iframe>';
          return;
        }
        msg('Gambar tidak dapat dipaparkan di sini.<br>Ketik “Buka di Drive” di bawah.'); return;
      }
      var im = new Image(), my = idx;
      im.onload = function(){
        if(my !== idx) return; var sp = s.querySelector('.sp'); if(sp) sp.remove();
        im.alt = it.title || 'Gambar'; im.onclick = function(){ zoomed = !zoomed; s.classList.toggle('z', zoomed); };
        s.insertBefore(im, s.firstChild);
      };
      im.onerror = function(){ if(my !== idx) return; tries++; next(); };
      im.src = c[tries];
    })();
  }
  function go(d){ if(items.length < 2) return; idx = (idx + d + items.length) % items.length; show(); }
  function open(list, start){
    if(!root) build();
    items = list; idx = start || 0; show();
    root.classList.add('show'); document.body.style.overflow = 'hidden';
    try{ history.pushState({ sglb:1 }, ''); pushed = true; }catch(e){}
    try{ root.querySelector('.x').focus(); }catch(e){}
  }
  function close(popHistory){
    if(!root) return; root.classList.remove('show'); document.body.style.overflow = ''; root.querySelector('.stage').innerHTML = '';
    if(popHistory && pushed){ pushed = false; try{ history.back(); }catch(e){} }
  }
  document.addEventListener('click', function(e){
    var im = e.target.closest && e.target.closest('img[data-zoom]');
    if(im && im.src){ e.preventDefault(); open([{ url: im.src, title: im.getAttribute('alt') || '' }], 0); return; }
    var a = e.target.closest && e.target.closest('a[data-lb]'); if(!a) return;
    e.preventDefault();
    var g = a.getAttribute('data-lb'), all = Array.prototype.slice.call(document.querySelectorAll('a[data-lb]')).filter(function(x){ return x.getAttribute('data-lb') === g; });
    open(all.map(function(x){ return { url: x.href, title: x.getAttribute('data-title') || x.getAttribute('title') || '' }; }), Math.max(0, all.indexOf(a)));
  });
  window.SiagaLightbox = { open: open, close: function(){ close(true); } };
})();
