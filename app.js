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
    LYRICS_DELAY:   3,     // seconds — compensate for the stream arriving after station metadata
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
    el.themeToggle   = document.getElementById('displayThemeToggle') ||
               document.getElementById('themeToggle');

    // Player
    el.player        = document.getElementById('radio-player');
    el.visualizer    = document.getElementById('visualizer');
    el.radioArt      = document.getElementById('radioArt');
    el.radioArtFallback = document.getElementById('radioArtFallback');
    el.currentLyric  = document.getElementById('currentLyric');
    el.lyricsSection = document.getElementById('lyricsSection');
    el.lyricsTranscript = document.getElementById('lyricsTranscript');
    el.nowTitle      = document.getElementById('nowTitle');
    el.nowArtist     = document.getElementById('nowArtist');
    el.playBtn       = document.getElementById('playBtn');
    el.playPath      = document.getElementById('playPath');
    el.volume        = document.getElementById('volume');
    el.volumeValue   = document.getElementById('volumeValue');
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
    lyricsKey:      null,
    lyricsTrackKey: null,
    lyricLines:     [],
    lyricsElapsed:  0,
    lyricsDuration: 0,
    lyricsUpdatedAt: 0,
    renderedLyricLine: null,
    activeLyricCharacter: -1,
    lyricsTimer:    null,
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
    if (diff < 60) return 'just now';

    var units = [
      { seconds: 86400, label: 'day' },
      { seconds: 3600, label: 'hour' },
      { seconds: 60, label: 'minute' }
    ];

    for (var i = 0; i < units.length; i++) {
      var amount = Math.floor(diff / units[i].seconds);
      if (amount >= 1) {
        return amount + ' ' + units[i].label + (amount === 1 ? '' : 's') + ' ago';
      }
    }

    return 'just now';
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

  // Theme toggling is handled in the page-level script to prevent double
  // listeners and delayed icon updates.

  /* =======================================================================
     06. ENTRY OVERLAY
     ======================================================================= */

  function enterSite() {
    if (state.isEntered) return;
    state.isEntered = true;

    if (el.entry) el.entry.classList.add('hidden');
    document.body.classList.remove('entry-active');
    if (el.stage) el.stage.classList.add('visible');

    startStream();
    updateStickyBarVisibility();

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
    setLivePill('connecting');
    setStatus('', '');

    try {
      el.audio.src = CONFIG.STREAM_URL + '?t=' + Date.now();
      el.audio.load();
      var volume = el.volume ? parseFloat(el.volume.value) : NaN;
      el.audio.volume = isNaN(volume) ? 0.75 : volume;
      var p = el.audio.play();
      if (p && typeof p.catch === 'function') {
        p.catch(function () {
          setLivePill('ready');
          setStatus('Tap play to listen', '');
          setPlayingUI(false);
        });
      }
    } catch (e) {
      setLivePill('offline');
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
      setStatus('', '');
      hideError();
      setLivePill('live');
    });

    el.audio.addEventListener('pause', function () {
      setPlayingUI(false);
      setStatus('', '');
      setLivePill('paused');
    });

    el.audio.addEventListener('waiting', function () {
      setLivePill('buffering');
      setStatus('Buffering stream…', 'reconnecting');
    });

    el.audio.addEventListener('stalled', function () {
      setLivePill('reconnecting');
      setStatus('Connection interrupted. Retrying…', 'reconnecting');
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
    el.status.hidden = !text;
    el.status.textContent = text;
    if (stateName) el.status.setAttribute('data-state', stateName);
    else el.status.removeAttribute('data-state');
  }

  function setLivePill(stateName) {
    if (el.livePill) el.livePill.setAttribute('data-state', stateName);
    if (!el.liveText) return;
    var labels = {
      ready: 'Ready',
      connecting: 'Connecting',
      buffering: 'Buffering',
      reconnecting: 'Reconnecting',
      live: 'Live',
      paused: 'Paused',
      offline: 'Offline'
    };
    el.liveText.textContent = labels[stateName] || 'Ready';
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
        var initialVolume = parseFloat(el.volume.value);
        el.audio.volume = isNaN(initialVolume) ? 0.75 : initialVolume;
      }
    } catch (e) {
      var fallbackVolume = parseFloat(el.volume.value);
      el.audio.volume = isNaN(fallbackVolume) ? 0.75 : fallbackVolume;
    }
    updateVolumeValue(parseFloat(el.volume.value));

    el.volume.addEventListener('input', function (e) {
      var v = parseFloat(e.target.value);
      if (isNaN(v)) return;
      el.audio.volume = v;
      updateVolumeValue(v);
      try { localStorage.setItem('kyu-volume', String(v)); } catch (err) {}
    });
  }

  function updateVolumeValue(volume) {
    if (!isFinite(volume)) return;
    var value = Math.round(volume * 100) + '%';
    if (el.volumeValue) el.volumeValue.textContent = value;
    if (el.volume) el.volume.style.setProperty('--volume-progress', value);
    if (el.volume) el.volume.setAttribute('aria-valuetext', value);
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

    var nowPlaying = data.now_playing || {};
    var np = nowPlaying.song || {};
    var title  = np.title  || 'Unknown';
    var artist = np.artist || (data.station && data.station.name) || CONFIG.STATION_NAME;
    var art    = np.art    || '';

    updateNowPlayingText(title, artist);
    updateRadioArtwork(art, title, artist);
    updateRadioLyrics(np.lyrics, nowPlaying.elapsed, nowPlaying.duration, np.id || title + '|' + artist);
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

  function parseTimedLyrics(lyrics) {
    var entries = [];
    var timestampPattern = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;

    String(lyrics || '').split(/\r?\n/).forEach(function (line) {
      var hmrcMatch = line.match(/^\s*\[(\d+),\d+\]/);
      if (hmrcMatch) {
        var hmrc = parseHmrcLine(line.slice(hmrcMatch[0].length));
        if (hmrc.text) {
          entries.push({
            time: Number(hmrcMatch[1]) / 1000,
            text: hmrc.text,
            characters: hmrc.characters
          });
        }
        return;
      }

      var timestamps = [];
      var match;

      while ((match = timestampPattern.exec(line)) !== null) {
        var fraction = match[3] ? Number(match[3]) / Math.pow(10, match[3].length) : 0;
        timestamps.push(Number(match[1]) * 60 + Number(match[2]) + fraction);
      }
      timestampPattern.lastIndex = 0;

      var text = stripLyricTimestamps(line);
      if (!text) return;

      timestamps.forEach(function (time) {
        entries.push({ time: time, text: text });
      });
    });

    return entries.sort(function (a, b) { return a.time - b.time; });
  }

  function parseHmrcLine(text) {
    var lyric = String(text || '').split('^')[0];
    var characters = [];
    var timingPattern = /<(\d+),(\d+)>/g;
    var match;

    while ((match = timingPattern.exec(lyric)) !== null) {
      var characterStart = timingPattern.lastIndex;
      var nextTiming = timingPattern.exec(lyric);
      var characterEnd = nextTiming ? nextTiming.index : lyric.length;
      var characterText = lyric.slice(characterStart, characterEnd);
      if (nextTiming) timingPattern.lastIndex = nextTiming.index;

      Array.from(characterText).forEach(function (character) {
        characters.push({
          text: character,
          start: Number(match[1]) / 1000,
          end: (Number(match[1]) + Number(match[2])) / 1000
        });
      });
    }

    return {
      text: characters.map(function (character) { return character.text; }).join('').trim(),
      characters: characters
    };
  }

  function formatHmrcLyricText(text) {
    return String(text || '').split('^')[0].replace(/<\d+,\d+>/g, '').trim();
  }

  function stripLyricTimestamps(lyrics) {
    return String(lyrics || '').split(/\r?\n/).map(function (line) {
      var hmrcMatch = line.match(/^\s*\[(\d+),\d+\]/);
      if (hmrcMatch) return formatHmrcLyricText(line.slice(hmrcMatch[0].length));
      if (/^\s*\[(?:ti|ar|al|by|offset):/i.test(line)) return '';
      return line.replace(/\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/g, '').trim();
    }).filter(function (line) {
      return line.length > 0;
    }).join('\n');
  }

  function updateRadioLyrics(lyrics, elapsed, duration, trackKey) {
    if (!el.lyricsSection) return;

    var text = String(lyrics || '').trim();
    var clockKey = String(trackKey || '') || text;
    var key = clockKey + '\n' + text;
    if (key !== state.lyricsKey) {
      state.lyricsKey = key;
      state.lyricLines = parseTimedLyrics(text);
      el.lyricsSection.hidden = state.lyricLines.length === 0;
      el.lyricsSection.open = false;
      if (el.lyricsTranscript) el.lyricsTranscript.textContent = stripLyricTimestamps(text);
      if (state.lyricLines.length) startLyricsTimer();
      else stopLyricsTimer();
    }

    var now = Date.now();
    var reportedElapsed = Number(elapsed);
    if (clockKey !== state.lyricsTrackKey) {
      state.lyricsTrackKey = clockKey;
      state.lyricsElapsed = Number.isFinite(reportedElapsed) ? Math.max(0, reportedElapsed) : 0;
    } else {
      state.lyricsElapsed += Math.max(0, now - state.lyricsUpdatedAt) / 1000;
    }

    state.lyricsDuration = Number.isFinite(Number(duration)) ? Math.max(0, Number(duration)) : 0;
    state.lyricsUpdatedAt = now;
    renderCurrentLyric();
  }

  function renderCurrentLyric() {
    if (!el.currentLyric || !state.lyricLines.length) {
      if (el.currentLyric) el.currentLyric.hidden = true;
      return;
    }

    var elapsed = state.lyricsElapsed + Math.max(0, Date.now() - state.lyricsUpdatedAt) / 1000 - CONFIG.LYRICS_DELAY;
    if (state.lyricsDuration > 0) elapsed = Math.min(elapsed, state.lyricsDuration);

    var activeLine = null;
    for (var i = 0; i < state.lyricLines.length; i += 1) {
      if (state.lyricLines[i].time > elapsed) break;
      activeLine = state.lyricLines[i];
    }

    el.currentLyric.hidden = !activeLine;
    if (!activeLine) {
      state.renderedLyricLine = null;
      state.activeLyricCharacter = -1;
      return;
    }

    if (activeLine !== state.renderedLyricLine) {
      while (el.currentLyric.firstChild) el.currentLyric.removeChild(el.currentLyric.firstChild);
      if (activeLine.characters && activeLine.characters.length) {
        activeLine.characters.forEach(function (character) {
          var span = document.createElement('span');
          span.className = 'radio-current-lyric-character';
          span.textContent = character.text;
          el.currentLyric.appendChild(span);
        });
      } else {
        el.currentLyric.textContent = activeLine.text;
      }
      state.renderedLyricLine = activeLine;
      state.activeLyricCharacter = -1;
    }

    if (activeLine.characters && activeLine.characters.length) {
      var activeCharacter = -1;
      var lineElapsed = elapsed - activeLine.time;
      for (var j = 0; j < activeLine.characters.length; j += 1) {
        var character = activeLine.characters[j];
        if (lineElapsed >= character.start && lineElapsed < character.end) {
          activeCharacter = j;
          break;
        }
      }
      if (activeCharacter !== state.activeLyricCharacter) {
        var characterNodes = el.currentLyric.children;
        if (state.activeLyricCharacter >= 0 && characterNodes[state.activeLyricCharacter]) {
          characterNodes[state.activeLyricCharacter].classList.remove('is-active');
        }
        if (activeCharacter >= 0 && characterNodes[activeCharacter]) {
          characterNodes[activeCharacter].classList.add('is-active');
        }
        state.activeLyricCharacter = activeCharacter;
      }
    }
  }

  function initRadioLyrics() {
    if (!el.currentLyric) return;
    if (state.lyricLines.length) startLyricsTimer();
  }

  function startLyricsTimer() {
    if (state.lyricsTimer || !el.currentLyric) return;
    state.lyricsTimer = setInterval(renderCurrentLyric, 250);
  }

  function stopLyricsTimer() {
    if (!state.lyricsTimer) return;
    clearInterval(state.lyricsTimer);
    state.lyricsTimer = null;
  }

  function updateRadioArtwork(art, title, artist) {
    if (!el.radioArt) return;

    if (!art) {
      state.currentArt = '';
      el.radioArt.hidden = true;
      el.radioArt.removeAttribute('src');
      if (el.radioArtFallback) el.radioArtFallback.hidden = false;
      return;
    }

    el.radioArt.alt = title + (artist ? ' by ' + artist : '') + ' artwork';
    if (state.currentArt === art) return;

    state.currentArt = art;
    el.radioArt.hidden = true;
    if (el.radioArtFallback) el.radioArtFallback.hidden = false;
    el.radioArt.onload = function () {
      el.radioArt.hidden = false;
      if (el.radioArtFallback) el.radioArtFallback.hidden = true;
    };
    el.radioArt.onerror = function () {
      el.radioArt.hidden = true;
      if (el.radioArtFallback) el.radioArtFallback.hidden = false;
    };
    el.radioArt.src = art;
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
    if (!el.stickyBar || !el.player) return;

    if ('IntersectionObserver' in window) {
      var observer = new IntersectionObserver(updateStickyBarVisibility, {
        threshold: 0,
        rootMargin: '-80px 0px 0px 0px'
      });
      observer.observe(el.player);
    }

    window.addEventListener('scroll', updateStickyBarVisibility, { passive: true });
  }

  function updateStickyBarVisibility() {
    if (!el.stickyBar || !el.player) return;
    var shouldShow = state.isEntered && el.player.getBoundingClientRect().bottom <= 80;
    el.stickyBar.classList.toggle('visible', shouldShow);
    el.stickyBar.setAttribute('aria-hidden', String(!shouldShow));
  }

  /* =======================================================================
     14. ERROR / OFFLINE HANDLING
     ======================================================================= */

  function handleStreamError() {
    setPlayingUI(false);
    setStatus('Stream unavailable. Retrying shortly…', 'error');
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
      if (document.hidden) {
        stopLyricsTimer();
        return;
      }

      if (state.lyricLines.length) startLyricsTimer();
      fetchNowPlaying();
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
      initEntry();
      initAudio();
      initRadioLyrics();
      initVolume();
      initStickyBar();
      initMediaSession();
      initVisibility();

      // Initial now-playing + polling
      fetchNowPlaying();
      state.pollTimer = setInterval(fetchNowPlaying, CONFIG.POLL_INTERVAL);

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