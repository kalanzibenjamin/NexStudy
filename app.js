/* =========================================================================
   KYU RADIO — app.js
   =========================================================================
   Table of contents:
   01. Configuration
   02. DOM references
   03. State
   04. Utilities (escapeHtml, timeAgo, showToast)
   05. Theme system (three modes + Alt+T / Alt+S)
   06. Entry overlay
   07. Audio / stream control
   08. Play button UI
   09. Volume control
   10. Now Playing polling
   11. Song history rendering
   12. Listener count
   13. Sticky bar (mobile)
   14. Error / offline handling
   15. Media Session
   16. Visibility handling
   17. Init
   ========================================================================= */

'use strict';

(function () {
  /* =======================================================================
     01. CONFIGURATION
     ======================================================================= */
  var CONFIG = {
    STREAM_URL:     'https://a10.asurahosting.com/listen/kyu_radio/radio.mp3',
    API_URL:        'https://a10.asurahosting.com/api/nowplaying_static/kyu_radio.json',
    POLL_INTERVAL:  20000,   // ms — now playing refresh
    RECONNECT_DELAY: 3000,   // ms — retry stream after error
    TOAST_DURATION: 3000,    // ms — toast auto-dismiss
    HISTORY_COUNT:  5,       // rows to show in Recently Played
    THEME_KEY:      'kyu-theme',
    STATION_NAME:   'KYU Radio',
    ALBUM_NAME:     'KYU Radio',
    PLAY_ICON_PATH: 'M8 5v14l11-7z',
    PAUSE_ICON_PATH:'M6 5h4v14H6zm8 0h4v14h-4z'
  };

  /* =======================================================================
     02. DOM REFERENCES
     ======================================================================= */
  var el = {};

  function cacheDom() {
    el.html          = document.documentElement;

    // Entry
    el.entry         = document.getElementById('entry');
    el.enterBtn      = document.getElementById('enterBtn');

    // Stage / header
    el.stage         = document.getElementById('stage');
    el.livePill      = document.getElementById('livePill');
    el.liveText      = document.getElementById('liveText');

    // Theme
    el.themeToggle   = document.getElementById('themeToggle');

    // Player
    el.player        = document.getElementById('player');
    el.visualizer    = document.getElementById('visualizer');
    el.nowTitle      = document.getElementById('nowTitle');
    el.nowArtist     = document.getElementById('nowArtist');
    el.playBtn       = document.getElementById('playBtn');
    el.playPath      = document.getElementById('playPath');
    el.volume        = document.getElementById('volume');
    el.status        = document.getElementById('status');

    // Error banner
    el.errorBanner   = document.getElementById('errorBanner');
    el.errorText     = document.getElementById('errorText');

    // Sections
    el.listenerCount = document.getElementById('listenerCount');
    el.historyList   = document.getElementById('historyList');
    el.year          = document.getElementById('year');

    // Sticky bar
    el.stickyBar     = document.getElementById('stickyBar');
    el.sbArt         = document.getElementById('sbArt');
    el.sbTitle       = document.getElementById('sbTitle');
    el.sbArtist      = document.getElementById('sbArtist');
    el.sbBtn         = document.getElementById('sbBtn');
    el.sbPath        = document.getElementById('sbPath');

    // Toasts
    el.toastContainer = document.getElementById('toastContainer');

    // Audio
    el.audio         = document.getElementById('audio');
  }

  /* =======================================================================
     03. STATE
     ======================================================================= */
  var state = {
    isPlaying:      false,
    isEntered:      false,
    currentTitle:   '',
    currentArtist:  '',
    currentArt:     '',
    lastHistoryKey: '',
    themeMode:      'system',   // 'system' | 'light' | 'dark'
    reconnectTimer: null,
    pollTimer:      null,
    fetchController: null
  };

  /* =======================================================================
     04. UTILITIES
     ======================================================================= */

  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  function timeAgo(unixSeconds) {
    if (!unixSeconds) return '';
    var diff = Math.floor(Date.now() / 1000) - unixSeconds;
    if (diff < 0)     return 'now';
    if (diff < 60)    return diff + 's';
    if (diff < 3600)  return Math.floor(diff / 60) + 'm';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h';
    return Math.floor(diff / 86400) + 'd';
  }

  function showToast(message, type) {
    if (!el.toastContainer) return;
    var toast = document.createElement('div');
    toast.className = 'toast' + (type ? ' ' + type : '');
    toast.textContent = message;
    el.toastContainer.appendChild(toast);

    setTimeout(function () {
      toast.classList.add('leaving');
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 250);
    }, CONFIG.TOAST_DURATION);
  }

  /* =======================================================================
     05. THEME SYSTEM
     ======================================================================= */

  function systemPrefersDark() {
    return window.matchMedia &&
           window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function getEffectiveTheme(mode) {
    if (mode === 'light' || mode === 'dark') return mode;
    return systemPrefersDark() ? 'dark' : 'light';
  }

  function updateThemeButton(mode, effective) {
    if (!el.themeToggle) return;
    var label;
    if (mode === 'system') {
      label = 'Switch to ' + (effective === 'dark' ? 'light' : 'dark') + ' theme';
    } else if (mode === 'light') {
      label = 'Switch to dark theme';
    } else {
      label = 'Switch to light theme';
    }
    el.themeToggle.setAttribute('aria-label', label);
  }

  function applyMode(mode, options) {
    options = options || {};
    state.themeMode = mode;
    el.html.setAttribute('data-theme-mode', mode);

    if (mode === 'system') {
      el.html.removeAttribute('data-theme');
    } else {
      el.html.setAttribute('data-theme', mode);
    }

    var effective = getEffectiveTheme(mode);
    updateThemeButton(mode, effective);

    if (!options.silent) {
      try { localStorage.setItem(CONFIG.THEME_KEY, mode); } catch (e) {}
    }
  }

  function readSavedMode() {
    try {
      var m = localStorage.getItem(CONFIG.THEME_KEY);
      if (m === 'light' || m === 'dark' || m === 'system') return m;
    } catch (e) {}
    return 'system';
  }

  function toggleLightDark() {
    var effective = getEffectiveTheme(state.themeMode);
    var next = effective === 'dark' ? 'light' : 'dark';
    applyMode(next);
  }

  function switchToSystem() {
    applyMode('system');
    showToast('Theme: system preference');
  }

  function initTheme() {
    var saved = readSavedMode();
    // The inline head script already set the attributes; keep state in sync.
    applyMode(saved, { silent: true });

    // Click toggle — cycles only Light <-> Dark
    if (el.themeToggle) {
      el.themeToggle.addEventListener('click', toggleLightDark);
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', function (e) {
      if (!e.altKey) return;
      var k = (e.key || '').toLowerCase();
      if (k === 't') {
        e.preventDefault();
        toggleLightDark();
      } else if (k === 's') {
        e.preventDefault();
        switchToSystem();
      }
    });

    // React to OS changes — only when mode is "system"
    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var handler = function () {
        if (state.themeMode === 'system') {
          updateThemeButton('system', getEffectiveTheme('system'));
        }
      };
      if (mq.addEventListener) mq.addEventListener('change', handler);
      else if (mq.addListener) mq.addListener(handler);
    }
  }

  /* =======================================================================
     06. ENTRY OVERLAY
     ======================================================================= */

  function enterSite() {
    if (state.isEntered) return;
    state.isEntered = true;

    if (el.entry) el.entry.classList.add('hidden');
    if (el.stage) el.stage.classList.add('visible');

    startStream();

    // Move focus to play button for keyboard users
    setTimeout(function () {
      if (el.playBtn) el.playBtn.focus({ preventScroll: true });
    }, 500);
  }

  function initEntry() {
    if (el.entry) {
      el.entry.addEventListener('click', enterSite);
      el.entry.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          enterSite();
        }
      });
    }
    if (el.enterBtn) {
      el.enterBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        enterSite();
      });
    }
  }

  /* =======================================================================
     07. AUDIO / STREAM CONTROL
     ======================================================================= */

  function startStream() {
    if (!el.audio) return;
    clearTimeout(state.reconnectTimer);

    try {
      el.audio.src = CONFIG.STREAM_URL + '?t=' + Date.now();
      el.audio.load();
      el.audio.volume = parseFloat(el.volume.value) || 0.75;
      var p = el.audio.play();
      if (p && typeof p.catch === 'function') {
        p.catch(function () {
          setStatus('Tap play to listen', '');
          setPlayingUI(false);
        });
      }
    } catch (e) {
      setStatus('Playback error', 'error');
      setPlayingUI(false);
    }
  }

  function stopStream() {
    if (!el.audio) return;
    try {
      el.audio.pause();
      el.audio.removeAttribute('src');
      el.audio.load();
    } catch (e) {}
    setPlayingUI(false);
  }

  function togglePlay() {
    if (!state.isEntered) {
      enterSite();
      return;
    }
    if (state.isPlaying) stopStream();
    else startStream();
  }

  function initAudio() {
    if (!el.audio) return;

    el.audio.addEventListener('playing', function () {
      setPlayingUI(true);
      setStatus('Live now', 'ok');
      hideError();
      setLivePill('live');
    });

    el.audio.addEventListener('pause', function () {
      setPlayingUI(false);
      setStatus('Paused', '');
      setLivePill('paused');
    });

    el.audio.addEventListener('waiting', function () {
      setStatus('Buffering…', '');
    });

    el.audio.addEventListener('stalled', function () {
      setStatus('Reconnecting…', 'reconnecting');
    });

    el.audio.addEventListener('error', function () {
      handleStreamError();
    });

    if (el.playBtn) {
      el.playBtn.addEventListener('click', togglePlay);
    }
    if (el.sbBtn) {
      el.sbBtn.addEventListener('click', togglePlay);
    }
  }

  /* =======================================================================
     08. PLAY BUTTON UI
     ======================================================================= */

  function setPlayingUI(isPlaying) {
    state.isPlaying = isPlaying;

    var path = isPlaying ? CONFIG.PAUSE_ICON_PATH : CONFIG.PLAY_ICON_PATH;
    if (el.playPath) el.playPath.setAttribute('d', path);
    if (el.sbPath)   el.sbPath.setAttribute('d', path);

    if (el.playBtn) {
      el.playBtn.classList.toggle('playing', isPlaying);
      el.playBtn.setAttribute('aria-label', isPlaying ? 'Pause stream' : 'Play stream');
    }
    if (el.visualizer) {
      el.visualizer.classList.toggle('playing', isPlaying);
    }
    if (el.sbBtn) {
      el.sbBtn.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
    }
  }

  function setStatus(text, stateName) {
    if (!el.status) return;
    el.status.textContent = text;
    if (stateName) el.status.setAttribute('data-state', stateName);
    else el.status.removeAttribute('data-state');
  }

  function setLivePill(stateName) {
    if (el.livePill) el.livePill.setAttribute('data-state', stateName);
    if (!el.liveText) return;
    if (stateName === 'live')    el.liveText.textContent = 'Live';
    else if (stateName === 'paused')  el.liveText.textContent = 'Paused';
    else if (stateName === 'offline') el.liveText.textContent = 'Offline';
  }

  /* =======================================================================
     09. VOLUME CONTROL
     ======================================================================= */

  function initVolume() {
    if (!el.volume || !el.audio) return;

    // Restore saved volume if any
    try {
      var saved = localStorage.getItem('kyu-volume');
      if (saved !== null) {
        var v = parseFloat(saved);
        if (!isNaN(v) && v >= 0 && v <= 1) {
          el.volume.value = String(v);
          el.audio.volume = v;
        }
      } else {
        el.audio.volume = parseFloat(el.volume.value) || 0.75;
      }
    } catch (e) {
      el.audio.volume = parseFloat(el.volume.value) || 0.75;
    }

    el.volume.addEventListener('input', function (e) {
      var v = parseFloat(e.target.value);
      if (isNaN(v)) return;
      el.audio.volume = v;
      try { localStorage.setItem('kyu-volume', String(v)); } catch (err) {}
    });
  }

  /* =======================================================================
     10. NOW PLAYING POLLING
     ======================================================================= */

  function fetchNowPlaying() {
    if (document.hidden) return;

    // Cancel prior request to avoid overlapping responses
    if (state.fetchController && state.fetchController.abort) {
      try { state.fetchController.abort(); } catch (e) {}
    }
    var controller = ('AbortController' in window) ? new AbortController() : null;
    state.fetchController = controller;

    var opts = { cache: 'no-store' };
    if (controller) opts.signal = controller.signal;

    fetch(CONFIG.API_URL, opts)
      .then(function (res) {
        if (!res.ok) throw new Error('Bad response ' + res.status);
        return res.json();
      })
      .then(function (data) {
        applyNowPlaying(data);
      })
      .catch(function (err) {
        if (err && err.name === 'AbortError') return;
        // Silent — keep old data on screen
      });
  }

  function applyNowPlaying(data) {
    if (!data) return;

    var np = (data.now_playing && data.now_playing.song) || {};
    var title  = np.title  || 'Unknown';
    var artist = np.artist || (data.station && data.station.name) || CONFIG.STATION_NAME;
    var art    = np.art    || '';

    updateNowPlayingText(title, artist);
    updateHistory(data.song_history || []);
    updateListenerCount(data.listeners);
    updateMediaSession(title, artist, art);
    updateStickyInfo(title, artist, art);
  }

  function updateNowPlayingText(title, artist) {
    if (title === state.currentTitle && artist === state.currentArtist) return;
    state.currentTitle  = title;
    state.currentArtist = artist;

    if (el.nowTitle)  el.nowTitle.textContent  = title;
    if (el.nowArtist) el.nowArtist.textContent = artist;
  }

  function updateListenerCount(listeners) {
    if (!el.listenerCount || !listeners) return;
    var count = (listeners.current != null)
      ? listeners.current
      : (listeners.total != null ? listeners.total : null);
    if (count != null) el.listenerCount.textContent = String(count);
  }

  /* =======================================================================
     11. SONG HISTORY
     ======================================================================= */

  function updateHistory(history) {
    if (!el.historyList) return;
    if (!history.length) return;

    var rows = history.slice(0, CONFIG.HISTORY_COUNT);

    // Build a light "key" to skip re-render if nothing changed
    var key = rows.map(function (r) {
      var s = r.song || {};
      return (s.title || '') + '|' + (r.played_at || '');
    }).join('~');

    if (key === state.lastHistoryKey) return;
    state.lastHistoryKey = key;

    var html = rows.map(function (r) {
      var s   = r.song || {};
      var t   = escapeHtml(s.title  || 'Unknown');
      var a   = escapeHtml(s.artist || '');
      var art = s.art ? escapeHtml(s.art) : '';
      var bg  = art ? ' style="background-image:url(\'' + art + '\')"' : '';
      var ago = timeAgo(r.played_at);
      return '' +
        '<li class="history-item">' +
          '<div class="history-art"' + bg + '></div>' +
          '<div class="history-text">' +
            '<div class="history-title">' + t + '</div>' +
            '<div class="history-artist">' + a + '</div>' +
          '</div>' +
          '<div class="history-time">' + ago + '</div>' +
        '</li>';
    }).join('');

    el.historyList.innerHTML = html;
  }

  /* =======================================================================
     12. (folded into updateListenerCount above)
     ======================================================================= */

  /* =======================================================================
     13. STICKY BAR
     ======================================================================= */

  function updateStickyInfo(title, artist, art) {
    if (el.sbTitle)  el.sbTitle.textContent  = title;
    if (el.sbArtist) el.sbArtist.textContent = artist;
    if (el.sbArt) {
      if (art) el.sbArt.style.backgroundImage = 'url("' + art + '")';
      else     el.sbArt.style.backgroundImage = '';
    }
  }

  function initStickyBar() {
    if (!el.stickyBar || !el.player || !('IntersectionObserver' in window)) return;

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!state.isEntered) return;
        if (entry.isIntersecting) {
          el.stickyBar.classList.remove('visible');
          el.stickyBar.setAttribute('aria-hidden', 'true');
        } else {
          el.stickyBar.classList.add('visible');
          el.stickyBar.setAttribute('aria-hidden', 'false');
        }
      });
    }, { threshold: 0, rootMargin: '-80px 0px 0px 0px' });

    observer.observe(el.player);
  }

  /* =======================================================================
     14. ERROR / OFFLINE HANDLING
     ======================================================================= */

  function handleStreamError() {
    setPlayingUI(false);
    setStatus('Reconnecting…', 'reconnecting');
    setLivePill('offline');
    showError('The stream is currently unavailable. Trying to reconnect…');

    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = setTimeout(function () {
      if (state.isEntered) startStream();
    }, CONFIG.RECONNECT_DELAY);
  }

  function showError(message) {
    if (!el.errorBanner) return;
    if (message && el.errorText) el.errorText.textContent = message;
    el.errorBanner.classList.remove('hidden');
    if (el.player) el.player.classList.add('offline');
  }

  function hideError() {
    if (el.errorBanner) el.errorBanner.classList.add('hidden');
    if (el.player) el.player.classList.remove('offline');
  }

  /* =======================================================================
     15. MEDIA SESSION
     ======================================================================= */

  function updateMediaSession(title, artist, art) {
    if (!('mediaSession' in navigator)) return;
    try {
      var artwork = art ? [{ src: art, sizes: '512x512', type: 'image/jpeg' }] : [];
      navigator.mediaSession.metadata = new MediaMetadata({
        title:  title,
        artist: artist,
        album:  CONFIG.ALBUM_NAME,
        artwork: artwork
      });
    } catch (e) {}
  }

  function initMediaSession() {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.setActionHandler('play',  startStream);
      navigator.mediaSession.setActionHandler('pause', stopStream);
      navigator.mediaSession.setActionHandler('stop',  stopStream);
    } catch (e) {}
  }

  /* =======================================================================
     16. VISIBILITY HANDLING
     ======================================================================= */

  function initVisibility() {
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) {
        fetchNowPlaying();
      }
    });
  }

  /* =======================================================================
     17. INIT
     ======================================================================= */

  function setYear() {
    if (el.year) el.year.textContent = String(new Date().getFullYear());
  }

  function init() {
    try {
      cacheDom();
      setYear();
      initTheme();
      initEntry();
      initAudio();
      initVolume();
      initStickyBar();
      initMediaSession();
      initVisibility();

      // Initial now-playing + polling
      fetchNowPlaying();
      state.pollTimer = setInterval(fetchNowPlaying, CONFIG.POLL_INTERVAL);

      // Auto-enter if user has already interacted this session
      // (skip the overlay for repeat visits within the same tab session)
      try {
        if (sessionStorage.getItem('kyu-entered') === '1') {
          state.isEntered = true;
          if (el.entry) el.entry.classList.add('hidden');
          if (el.stage) el.stage.classList.add('visible');
        } else {
          sessionStorage.setItem('kyu-entered', '1');
        }
      } catch (e) {}

    } catch (e) {
      // One failure shouldn't kill the page — log and move on
      if (window.console && console.error) console.error('[KYU] init error:', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();