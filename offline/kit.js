/*
 * Star Trek: Kobayashi Maru — offline restoration kit
 * ===================================================
 *
 * The archived game client (main.js) is used verbatim; nothing in it is
 * patched. It expects two services that no longer exist:
 *
 *   1. The Facebook JS SDK  (connect.facebook.net/en_US/sdk.js, app 281194753044874)
 *      used for the "Please, login to continue" gate, for the cadet name shown on
 *      the leaderboard, and for the share buttons.
 *   2. The game API          (https://api.kobayashimaru.com/v1... sorry, /game etc.)
 *      used to open a run, sync the clock, submit a victory and read the leaderboard.
 *
 * This kit provides both locally:
 *
 *   - window.FB       : a small stub implementing exactly the calls main.js makes
 *                       (init / AppEvents / getLoginStatus / login / api / ui).
 *   - window.fetch    : requests aimed at api.kobayashimaru.com are answered from a
 *                       tiny in-browser API that keeps runs + leaderboard entries in
 *                       localStorage. Every other request is passed through.
 *   - cadet registration modal: replaces the Facebook login popup.
 *   - share panel: replaces FB.ui() / the twitter.com intent link, showing the real
 *                   share artwork + the original share copy so it can be copied.
 *   - optional HUD badge (?kmhud=on): shows which cadet is registered and clears the
 *                   local save. Off by default; it is a diagnostic, not part of the game.
 *
 * This kit deliberately touches NO gameplay. It never writes story variables, never
 * hooks the engine, never patches the bundle. In particular it does not touch $death:
 * the DEATHS counter is implemented in the archived story data itself (see the note on
 * reportedDeaths), so anything the kit did there would only double count.
 *
 * Nothing here phones home: there are no network requests to the original
 * services, and the local save lives in this browser's localStorage only.
 *
 * Flags: ?kmhud=on  ?kmshare=off  ?kmname=JANICE
 */
(function () {
  'use strict';

  var API_ORIGIN = 'https://api.kobayashimaru.com';
  var STORE_KEY = 'km-offline-v1';
  var params = new URLSearchParams(location.search);

  var config = {
    hud: params.get('kmhud') === 'on',
    localShare: params.get('kmshare') !== 'off',
    cadetName: params.get('kmname'),
  };

  function log() {
    var args = ['%c KM offline ', 'background:#12305c;color:#8fd3ff;border-radius:3px'].concat([].slice.call(arguments));
    console.log.apply(console, args);
  }

  /* ------------------------------------------------------------------ storage */

  function blank() {
    return { v: 1, cadet: null, runs: {}, entries: [], seq: 1, savedAt: 0 };
  }

  var db = blank();
  try {
    var raw = localStorage.getItem(STORE_KEY);
    if (raw) db = Object.assign(blank(), JSON.parse(raw));
  } catch (err) {
    console.warn('[KM offline] could not read local save, starting fresh:', err);
  }

  function save() {
    db.savedAt = Date.now();
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(db));
    } catch (err) {
      console.warn('[KM offline] could not write local save:', err);
    }
  }

  function newId(prefix) {
    db.seq = (db.seq || 0) + 1;
    return prefix + '-' + Date.now().toString(36) + '-' + db.seq + '-' + Math.random().toString(36).slice(2, 6);
  }

  function ensureCadet(name) {
    var clean = String(name == null ? '' : name).trim().replace(/\s+/g, ' ').slice(0, 24);
    if (!clean) return null;
    db.cadet = { id: (db.cadet && db.cadet.id) || newId('cadet'), name: clean, since: Date.now() };
    save();
    renderHud();
    return db.cadet;
  }

  /* -------------------------------------------------------------- fake game API */

  function runTime(run) {
    return Math.max(0, Date.now() - run.createdAt);
  }

  /**
   * The DEATHS number the player is looking at. This is the *game's own* counter: the
   * archived story data drives it, no help from the kit -
   *   passage "Start"       <<set $death to -1>>
   *   passage "Sim Spinup"  ... <<else>> <<set $death += 1>>   (only when dev notes are off)
   *   bundle                getDeathCount() = Math.max(0, parseInt(variables.death))
   * i.e. it counts simulator re-spins, offset by -1 so the first attempt reads 0. The
   * kit reads it and never writes it, so it cannot double count.
   *
   * The dead service presumably received this same number; we hand it back unchanged.
   */
  function reportedDeaths() {
    try {
      return window.Engine && window.Engine.state ? window.Engine.state.getDeathCount() : 0;
    } catch (err) {
      return 0;
    }
  }

  function leaderboardRows(facebookId) {
    var rows = db.entries.slice().sort(function (a, b) {
      return a.deaths - b.deaths || a.timeMs - b.timeMs || a.createdAt - b.createdAt;
    });
    return rows.slice(0, 10).map(function (e, i) {
      return {
        id: e.id,
        facebookId: e.facebookId,
        displayName: e.displayName,
        deaths: e.deaths,
        time: e.timeMs,
        rank: i + 1,
        isCurrentUser: !!facebookId && e.facebookId === facebookId,
        submittedAt: e.createdAt,
        contest: e.contact || null,
      };
    });
  }

  function route(pathname, method, body, query) {
    var runId = null, m;

    if (pathname === '/game' && method === 'POST') {
      var run = {
        id: newId('run'),
        facebookId: body.facebookId || (db.cadet && db.cadet.id) || 'anonymous',
        displayName: body.displayName || (db.cadet && db.cadet.name) || 'CADET',
        createdAt: Date.now(),
        steps: [],
        victory: null,
      };
      db.runs[run.id] = run;
      db.currentRun = run.id;
      save();
      log('POST /game ->', run.id, 'for', run.displayName);
      return { status: 201, body: { gameId: run.id, id: run.id } };
    }

    if ((m = pathname.match(/^\/game\/([\w-]+)$/))) {
      runId = m[1];
      var r = db.runs[runId];
      if (!r) return { status: 404, body: { message: 'unknown game' } };
      if (method === 'PUT') {
        var step = (body && body.gameStepVar) || {};
        r.steps.push({ nodeName: String(step.nodeName || ''), selectedChoice: step.selectedChoice || 'unknown', at: Date.now() });
        r.updatedAt = Date.now();
        save();
        // The real service returned the authoritative clock; `deaths` was read by
        // the client but never applied (dead code in the shipped bundle).
        return { status: 200, body: { deaths: reportedDeaths(), gameTime: runTime(r), steps: r.steps.length } };
      }
      if (method === 'GET') return { status: 200, body: { id: r.id, deaths: reportedDeaths(), gameTime: runTime(r) } };
    }

    if (pathname === '/submission' && method === 'POST') {
      var src = db.runs[body.gameId] || db.runs[db.currentRun] || null;
      var entry = {
        id: newId('entry'),
        gameId: body.gameId || (src && src.id) || null,
        facebookId: body.facebookId || (src && src.facebookId) || (db.cadet && db.cadet.id) || 'anonymous',
        displayName: body.displayName || (db.cadet && db.cadet.name) || 'CADET',
        deaths: reportedDeaths(),
        timeMs: src ? runTime(src) : Number(body.gameTime || body.time || 0),
        createdAt: Date.now(),
        contact: null,
      };
      db.entries.push(entry);
      if (src) src.victory = entry.id;
      save();
      log('POST /submission ->', entry.id, entry.displayName, entry.deaths + ' deaths', Math.round(entry.timeMs / 1000) + 's');
      toast('Run recorded locally: ' + entry.deaths + ' deaths, ' + Math.round(entry.timeMs / 1000) + 's');
      return { status: 201, body: { id: entry.id, submissionId: entry.id } };
    }

    if ((m = pathname.match(/^\/submission\/([\w-]+)$/))) {
      var e = db.entries.find(function (x) { return x.id === m[1]; });
      if (!e) return { status: 404, body: { message: 'unknown submission' } };
      if (method === 'PUT' || method === 'POST') {
        e.contact = Object.assign({}, body, { savedAt: Date.now() });
        save();
        toast('Contest entry saved locally (the contest itself ended in 2021).');
        return { status: 200, body: { id: e.id } };
      }
      return { status: 200, body: e };
    }

    if (pathname === '/submission' && method === 'GET') {
      return { status: 200, body: { results: leaderboardRows(query.get('facebookId')) } };
    }

    if (pathname === '/submissions' && method === 'GET') {
      return { status: 200, body: { results: leaderboardRows(query.get('facebookId')) } };
    }

    return { status: 404, body: { message: 'offline API has no route for ' + method + ' ' + pathname } };
  }

  var realFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : input && input.url || String(input);
    if (url.indexOf(API_ORIGIN) !== 0) {
      if (realFetch) return realFetch(input, init);
      return Promise.reject(new TypeError('offline restoration: no network for ' + url));
    }
    var u = new URL(url);
    var method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    var body = {};
    try {
      body = JSON.parse((init && init.body) || (input && input.body) || '{}');
    } catch (err) { /* the client always sends JSON, but be forgiving */ }
    var res = route(u.pathname, method, body, u.searchParams);
    return Promise.resolve(
      new Response(JSON.stringify(res.body), {
        status: res.status,
        statusText: res.status === 200 || res.status === 201 ? 'OK (offline)' : 'Offline',
        headers: { 'Content-Type': 'application/json', 'X-KM-Offline': '1' },
      }),
    );
  };

  /* ------------------------------------------------------------ fake Facebook */

  var listeners = {};

  function authResponse(cadet) {
    return {
      accessToken: 'offline-' + cadet.id,
      expiresIn: 1e9,
      graphDomain: 'facebook',
      signedRequest: 'offline',
      userID: cadet.id,
      ems: [],
    };
  }

  function profileOf(cadet) {
    return {
      id: cadet.id,
      name: cadet.name,
      first_name: cadet.name,
      last_name: '',
      link: location.href,
      picture: { data: { url: 'assets/images/start-screen/icon.png', is_silhouette: false } },
      // main.js does `({id, name, picture} = ...)` then `picture.data.url`.
    };
  }

  function fire(name, payload) {
    (listeners[name] || []).forEach(function (fn) {
      try { fn(payload); } catch (err) { console.warn('[KM offline] FB listener failed:', err); }
    });
  }

  /** Ask for a callsign. Resolves with the cadet, or null if the player cancels. */
  function registerCadet() {
    if (config.cadetName) return Promise.resolve(ensureCadet(config.cadetName));
    if (db.cadet) return Promise.resolve(db.cadet);
    return showModal('cadet').then(function (value) {
      return value ? ensureCadet(value) : null;
    });
  }

  window.FB = {
    __kmOffline: true,
    init: function (opts) { log('FB.init stubbed (appId ' + (opts && opts.appId) + ')'); },
    AppEvents: { logEvent: function () {}, logPageView: function () { log('page view (local)'); } },
    XFBML: { parse: function () {} },
    Event: {
      subscribe: function (name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
      unsubscribe: function () {},
    },
    getLoginStatus: function (cb) {
      var cadet = db.cadet;
      var payload = cadet
        ? { status: 'connected', authResponse: authResponse(cadet) }
        : { status: 'unknown', authResponse: null };
      if (typeof cb === 'function') cb(payload);
      return payload;
    },
    login: function (cb, opts) {
      registerCadet().then(function (cadet) {
        var payload = cadet
          ? { status: 'connected', authResponse: authResponse(cadet) }
          : { status: 'not_connected', authResponse: null };
        fire('authResponseChange', payload);
        if (typeof cb === 'function') cb(payload);
      });
    },
    logout: function (cb) {
      db.cadet = null;
      save();
      renderHud();
      if (typeof cb === 'function') cb({ status: 'not_connected', authResponse: null });
    },
    api: function (path, method, fields, cb) {
      // Signature used by main.js: api('/me', 'GET', {fields:'id,name,picture'}, cb)
      if (typeof method === 'function') { cb = method; }
      else if (typeof fields === 'function') { cb = fields; }
      var cadet = db.cadet;
      var out = null;
      if (String(path).replace(/^\//, '') === 'me' || String(path).indexOf('/me/') === 0) {
        out = cadet ? profileOf(cadet) : { error: { message: 'Offline: no cadet registered', type: 'OAuthException', code: 190 } };
      } else {
        out = { error: { message: 'Offline: no /' + path, type: 'GraphMethodException', code: 110 } };
      }
      if (typeof cb === 'function') cb(out);
      return out;
    },
    ui: function (params, cb) {
      var out = { method: params && params.method, href: params && params.href };
      if (config.localShare) openSharePanel(params || {});
      else toast('Sharing is disabled in this offline build.');
      if (typeof cb === 'function') cb(out);
      return Promise.resolve(out);
    },
  };

  // index.html still defines window.fbAsyncInit; run it once the FB stub exists.
  function runFbAsyncInit() {
    if (typeof window.fbAsyncInit === 'function') {
      try { window.fbAsyncInit(); } catch (err) { console.warn('[KM offline] fbAsyncInit failed:', err); }
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', runFbAsyncInit);
  else runFbAsyncInit();

  // The twitter share button is a hidden <a target="_blank"> to twitter.com.
  // Intercept it so the offline build shows the copy instead of a dead tab.
  document.addEventListener(
    'click',
    function (ev) {
      if (!config.localShare) return;
      var a = ev.target && ev.target.closest && ev.target.closest('a');
      if (!a) return;
      var href = a.href || '';
      if (href.indexOf('https://twitter.com/intent/tweet') === 0) {
        ev.preventDefault();
        ev.stopPropagation();
        var text = new URL(href).searchParams.get('text') || '';
        openSharePanel({ method: 'twitter', text: text, href: location.href });
      }
    },
    true,
  );

  /* ------------------------------------------------------------------- modals */

  var shareTexts = null;
  var shareSlugToNode = {};
  fetch('offline/share-texts.json')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      shareTexts = j || null;
      if (shareTexts) Object.keys(shareTexts).forEach(function (k) { shareSlugToNode[slugOf(k)] = k; });
    })
    .catch(function () {});

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /**
   * Very small modal helper. kind='cadet' shows the callsign form,
   * kind='share' shows the share artwork + copy buttons.
   */
  function showModal(kind, options) {
    options = options || {};
    return new Promise(function (resolve) {
      var old = document.getElementById('km-offline-modal');
      if (old && old.parentNode) old.parentNode.removeChild(old);

      var wrap = el('div', 'km-offline-modal');
      wrap.id = 'km-offline-modal';
      var box = el('div', 'km-window');

      var head = el('header', null, kind === 'cadet' ? 'STARFLEET REGISTRATION' : 'SHARE THIS RUN');
      box.appendChild(head);

      var done = function (value) {
        document.removeEventListener('keydown', onKey);
        if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
        resolve(value);
      };

      if (kind === 'cadet') {
        var p = el('p', 'km-copy');
        p.innerHTML =
          'The original simulation signed cadets in through Facebook. That service is gone, ' +
          'so this restoration registers you <b>locally</b>: your callsign, your run stats and ' +
          'the leaderboard live in this browser only.';
        box.appendChild(p);

        var input = el('input', 'km-input');
        input.type = 'text';
        input.maxLength = 24;
        input.placeholder = 'CADET CALLSIGN';
        input.value = (db.cadet && db.cadet.name) || randomCallsign();
        input.spellcheck = false;
        box.appendChild(input);

        var row = el('div', 'km-row');
        var ok = el('button', 'km-btn km-primary', 'REPORT FOR DUTY');
        var no = el('button', 'km-btn km-ghost', 'NOT TODAY');
        row.appendChild(ok);
        row.appendChild(no);
        box.appendChild(row);

        var note = el('p', 'km-note', 'Saved in localStorage under "' + STORE_KEY + '".');
        box.appendChild(note);

        var submit = function () { done(input.value.trim() || null); };
        ok.addEventListener('click', submit);
        no.addEventListener('click', function () { done(null); });
        input.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter') submit();
          if (ev.key === 'Escape') done(null);
        });
        setTimeout(function () { input.focus(); input.select(); }, 30);
      } else {
        var img = el('img', 'km-share-img');
        img.src = options.image || 'assets/images/share.jpg';
        img.alt = '';
        box.appendChild(img);

        var txt = el('textarea', 'km-input km-share-text');
        txt.rows = 4;
        txt.value = options.text || 'I faced the Kobayashi Maru simulation: ' + location.href;
        box.appendChild(txt);

        var row2 = el('div', 'km-row');
        var copy = el('button', 'km-btn km-primary', 'COPY TEXT');
        var close = el('button', 'km-btn km-ghost', 'CLOSE');
        row2.appendChild(copy);
        row2.appendChild(close);
        box.appendChild(row2);

        var hint = el('p', 'km-note');
        hint.textContent =
          'The original share buttons pointed at facebook.com / twitter.com and at per-node pages ' +
          '(share/' + (options.slug || '<node>') + '.html) that no longer exist. This panel keeps the ' +
          'artwork and the original wording so you can post them yourself.';
        box.appendChild(hint);

        copy.addEventListener('click', function () {
          txt.select();
          var finish = function () { toast('Share text copied'); };
          if (navigator.clipboard) navigator.clipboard.writeText(txt.value).then(finish, function () { document.execCommand('copy'); finish(); });
          else { document.execCommand('copy'); finish(); }
        });
        close.addEventListener('click', function () { done(null); });
      }

      wrap.appendChild(box);
      document.body.appendChild(wrap);
      function onKey(ev) { if (ev.key === 'Escape') done(null); }
      document.addEventListener('keydown', onKey);
    });
  }

  function randomCallsign() {
    var first = ['JIM', 'JANICE', 'MARIA', 'PABLO', 'KASRA', 'SAM', 'TREVOR', 'NIOTA', 'AARON', 'LANCE'];
    var last = ['REEVE', 'IMADA', 'MARTINEZ', 'ISIDA', 'GAREB', 'KILEY', 'REEVE', 'ONG', 'TARK'];
    return first[Math.floor(Math.random() * first.length)] + ' ' + last[Math.floor(Math.random() * last.length)];
  }

  function slugOf(value) {
    return String(value || '').replace(/\s+/gi, '-').toLowerCase();
  }

  function openSharePanel(opts) {
    var hrefSlug = opts.href ? String(opts.href).split('share/')[1] : '';
    hrefSlug = (hrefSlug || '').split('?')[0].replace(/\.html$/, '');
    var node = opts.node || shareSlugToNode[hrefSlug] || '';
    var slug = opts.slug || slugOf(node || hrefSlug || '');
    var text = opts.text;
    if (!text && shareTexts) text = shareTexts[node] || shareTexts._default;
    if (!text) text = "I died a completely over-the-top death in the @KobayashiMaru Simulator from @StarTrekFleet. Cadets report to " + location.href + " #KobayashiMaru";
    var image = slug && slug !== 'undefined' ? 'share/' + slug + '.png' : 'assets/images/share.jpg';
    showModal('share', { text: text, image: image, slug: slug });
  }

  /* -------------------------------------------------------------------- toast */

  function toast(message) {
    var t = el('div', 'km-toast', message);
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add('show'); }, 10);
    setTimeout(function () {
      t.classList.remove('show');
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 400);
    }, 4200);
  }

  /* ---------------------------------------------------------------------- HUD */

  var hud = null;
  function renderHud() {
    if (!config.hud) return;
    if (!hud) {
      hud = el('div', 'km-hud');
      hud.innerHTML =
        '<span class="km-hud-label">OFFLINE</span>' +
        '<span class="km-hud-cadet"></span>' +
        '<button class="km-hud-btn" data-act="change">CHANGE</button>' +
        '<button class="km-hud-btn" data-act="reset" title="Clear this browser\'s Kobayashi Maru save">RESET</button>';
      document.body.appendChild(hud);
      hud.addEventListener('click', function (ev) {
        var act = ev.target && ev.target.getAttribute('data-act');
        if (act === 'change') registerCadet();
        if (act === 'reset') {
          if (confirm('Clear the local Kobayashi Maru save (cadet, runs, leaderboard entries)?')) {
            localStorage.removeItem(STORE_KEY);
            location.reload();
          }
        }
      });
    }
    hud.querySelector('.km-hud-cadet').textContent = db.cadet ? db.cadet.name : 'no cadet';
  }

  /* ------------------------------------------------------------------- public */

  window.KM_OFFLINE = {
    config: config,
    storeKey: STORE_KEY,
    stats: function () {
      return {
        cadet: db.cadet,
        runs: Object.keys(db.runs).length,
        runDetail: (function () {
          var r = db.runs[db.currentRun];
          if (!r) return null;
          return { id: r.id, displayName: r.displayName, steps: r.steps.length, lastStep: r.steps.length ? r.steps[r.steps.length - 1].nodeName : null };
        })(),
        entries: db.entries.slice(),
        leaderboard: leaderboardRows(db.cadet && db.cadet.id),
        deaths: reportedDeaths(),
      };
    },
    deaths: reportedDeaths,
    reset: function () { localStorage.removeItem(STORE_KEY); location.reload(); },
    leaderboard: function () { return leaderboardRows(db.cadet && db.cadet.id); },
    setCadet: function (name) { return ensureCadet(name); },
    toast: toast,
  };

  renderHud();
  log('offline kit ready — FB stub, local game API, ' + (db.cadet ? 'cadet ' + db.cadet.name : 'no cadet yet'));
})();
