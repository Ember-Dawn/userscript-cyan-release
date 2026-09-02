// ==UserScript==
// @name         NocoDB 音频播放器
// @namespace    http://tampermonkey.net/
// @homepageURL  https://github.com/Ember-Dawn/userscript-cyan-release
// @supportURL   https://github.com/Ember-Dawn/userscript-cyan-release/issues
// @updateURL    https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-audio-player.user.js
// @downloadURL  https://raw.githubusercontent.com/Ember-Dawn/userscript-cyan-release/main/userscripts/nocodb/nocodb-audio-player.user.js
// @version      0.1.0
// @description  拦截 NocoDB 中指向 Media Manager MP3 的 openURL，在右下角使用深色悬浮播放器播放，并提供进度与键盘快捷键。
// @match        https://nocodb.380782744.xyz/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const AUDIO_ORIGIN = 'https://media.380782744.xyz';
  const AUDIO_PATH_PREFIX = '/media/audio/';
  const SPEED_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  const DEFAULT_SPEED_INDEX = SPEED_STEPS.indexOf(1);
  const SEEK_SECONDS = 5;

  const PLAYER_ID = 'tm-nocodb-audio-player';
  const STYLE_ID = 'tm-nocodb-audio-player-style';

  let player = null;
  let audio = null;
  let titleEl = null;
  let statusEl = null;
  let playButton = null;
  let progress = null;
  let currentTimeEl = null;
  let durationEl = null;
  let speedButton = null;
  let speedIndex = DEFAULT_SPEED_INDEX;
  let currentUrl = '';
  let draggingProgress = false;

  const nativeOpen = window.open.bind(window);

  function isTargetAudioUrl(value) {
    if (!value) return false;

    try {
      const url = new URL(String(value), location.href);
      const path = decodeURIComponent(url.pathname);
      return (
        url.origin === AUDIO_ORIGIN &&
        path.startsWith(AUDIO_PATH_PREFIX) &&
        path.toLowerCase().endsWith('.mp3')
      );
    } catch {
      return false;
    }
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
    const total = Math.floor(seconds);
    const minutes = Math.floor(total / 60);
    const secs = total % 60;
    return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  function filenameFromUrl(url) {
    try {
      const parsed = new URL(url);
      const name = parsed.pathname.split('/').filter(Boolean).pop() || 'audio.mp3';
      return decodeURIComponent(name);
    } catch {
      return 'audio.mp3';
    }
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${PLAYER_ID} {
        position: fixed;
        right: 20px;
        bottom: 20px;
        z-index: 2147483000;
        width: min(390px, calc(100vw - 32px));
        box-sizing: border-box;
        padding: 14px;
        border: 1px solid rgba(255, 255, 255, 0.09);
        border-radius: 14px;
        background: rgba(24, 26, 31, 0.97);
        color: #f4f5f7;
        box-shadow: 0 18px 50px rgba(0, 0, 0, 0.38);
        font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        backdrop-filter: blur(10px);
      }

      #${PLAYER_ID}[hidden] {
        display: none !important;
      }

      #${PLAYER_ID} .tm-nap-header {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
      }

      #${PLAYER_ID} .tm-nap-title-wrap {
        flex: 1;
        min-width: 0;
      }

      #${PLAYER_ID} .tm-nap-title {
        overflow: hidden;
        color: #f7f8fa;
        font-weight: 600;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      #${PLAYER_ID} .tm-nap-status {
        min-height: 16px;
        margin-top: 2px;
        overflow: hidden;
        color: #9ea4ae;
        font-size: 11px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      #${PLAYER_ID} .tm-nap-close,
      #${PLAYER_ID} .tm-nap-button,
      #${PLAYER_ID} .tm-nap-speed {
        border: 0;
        color: #eef0f4;
        background: #343841;
        cursor: pointer;
        transition: background 120ms ease, transform 120ms ease;
      }

      #${PLAYER_ID} .tm-nap-close:hover,
      #${PLAYER_ID} .tm-nap-button:hover,
      #${PLAYER_ID} .tm-nap-speed:hover {
        background: #444955;
      }

      #${PLAYER_ID} .tm-nap-close:active,
      #${PLAYER_ID} .tm-nap-button:active,
      #${PLAYER_ID} .tm-nap-speed:active {
        transform: translateY(1px);
      }

      #${PLAYER_ID} .tm-nap-close {
        flex: 0 0 auto;
        width: 28px;
        height: 28px;
        border-radius: 8px;
        font-size: 18px;
        line-height: 28px;
      }

      #${PLAYER_ID} .tm-nap-controls {
        display: grid;
        grid-template-columns: 38px 42px minmax(0, 1fr) 42px 58px;
        align-items: center;
        gap: 8px;
        margin-top: 12px;
      }

      #${PLAYER_ID} .tm-nap-button {
        width: 38px;
        height: 34px;
        border-radius: 9px;
        font-size: 15px;
      }

      #${PLAYER_ID} .tm-nap-time {
        color: #b7bcc5;
        font-variant-numeric: tabular-nums;
        text-align: center;
      }

      #${PLAYER_ID} .tm-nap-progress {
        width: 100%;
        min-width: 0;
        accent-color: #8d95ff;
        cursor: pointer;
      }

      #${PLAYER_ID} .tm-nap-speed {
        height: 30px;
        border-radius: 8px;
        font-size: 12px;
        font-variant-numeric: tabular-nums;
      }

      #${PLAYER_ID} .tm-nap-hint {
        margin-top: 9px;
        color: #777e89;
        font-size: 10px;
        text-align: center;
      }
    `;
    document.head.appendChild(style);
  }

  function ensurePlayer() {
    if (player?.isConnected) return;

    injectStyle();

    player = document.createElement('section');
    player.id = PLAYER_ID;
    player.hidden = true;
    player.setAttribute('aria-label', 'NocoDB 音频播放器');
    player.innerHTML = `
      <div class="tm-nap-header">
        <div class="tm-nap-title-wrap">
          <div class="tm-nap-title">Audio</div>
          <div class="tm-nap-status">Ready</div>
        </div>
        <button type="button" class="tm-nap-close" title="关闭播放器" aria-label="关闭播放器">×</button>
      </div>
      <div class="tm-nap-controls">
        <button type="button" class="tm-nap-button" title="播放 / 暂停" aria-label="播放 / 暂停">▶</button>
        <span class="tm-nap-time tm-nap-current">00:00</span>
        <input class="tm-nap-progress" type="range" min="0" max="1000" value="0" step="1" aria-label="播放进度">
        <span class="tm-nap-time tm-nap-duration">00:00</span>
        <button type="button" class="tm-nap-speed" title="点击切换倍速">1.00×</button>
      </div>
      <div class="tm-nap-hint">Space 播放/暂停 · ←/→ ±5s · ↑/↓ 倍速</div>
    `;

    document.documentElement.appendChild(player);

    titleEl = player.querySelector('.tm-nap-title');
    statusEl = player.querySelector('.tm-nap-status');
    playButton = player.querySelector('.tm-nap-button');
    progress = player.querySelector('.tm-nap-progress');
    currentTimeEl = player.querySelector('.tm-nap-current');
    durationEl = player.querySelector('.tm-nap-duration');
    speedButton = player.querySelector('.tm-nap-speed');

    audio = document.createElement('audio');
    audio.preload = 'metadata';

    player.querySelector('.tm-nap-close').addEventListener('click', closePlayer);
    playButton.addEventListener('click', togglePlayback);
    speedButton.addEventListener('click', () => changeSpeed(1));

    progress.addEventListener('pointerdown', () => {
      draggingProgress = true;
    });

    progress.addEventListener('input', () => {
      if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
      const ratio = Number(progress.value) / Number(progress.max);
      currentTimeEl.textContent = formatTime(ratio * audio.duration);
    });

    progress.addEventListener('change', () => {
      seekFromProgress();
      draggingProgress = false;
    });

    progress.addEventListener('pointerup', () => {
      seekFromProgress();
      draggingProgress = false;
    });

    audio.addEventListener('loadedmetadata', updateTimeline);
    audio.addEventListener('durationchange', updateTimeline);
    audio.addEventListener('timeupdate', updateTimeline);
    audio.addEventListener('play', updatePlayState);
    audio.addEventListener('pause', updatePlayState);
    audio.addEventListener('ended', updatePlayState);
    audio.addEventListener('waiting', () => setStatus('Loading…'));
    audio.addEventListener('playing', () => setStatus(`${SPEED_STEPS[speedIndex].toFixed(2)}×`));
    audio.addEventListener('error', () => {
      updatePlayState();
      setStatus('Audio unavailable');
    });
  }

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function updatePlayState() {
    if (!playButton || !audio) return;
    playButton.textContent = audio.paused ? '▶' : '❚❚';
    playButton.setAttribute('aria-label', audio.paused ? '播放' : '暂停');
    playButton.title = audio.paused ? '播放' : '暂停';

    if (audio.ended) setStatus('Ended');
    else if (audio.paused && currentUrl) setStatus(`${SPEED_STEPS[speedIndex].toFixed(2)}× · Paused`);
  }

  function updateTimeline() {
    if (!audio || !progress || draggingProgress) return;

    currentTimeEl.textContent = formatTime(audio.currentTime);
    durationEl.textContent = formatTime(audio.duration);

    const ratio = Number.isFinite(audio.duration) && audio.duration > 0
      ? audio.currentTime / audio.duration
      : 0;
    progress.value = String(Math.round(ratio * Number(progress.max)));
  }

  function seekFromProgress() {
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    const ratio = Number(progress.value) / Number(progress.max);
    audio.currentTime = Math.max(0, Math.min(audio.duration, ratio * audio.duration));
    updateTimeline();
  }

  async function safePlay() {
    try {
      await audio.play();
    } catch (error) {
      console.warn('[NocoDB 音频播放器] play failed:', error);
      setStatus('Click play to continue');
    }
  }

  function togglePlayback() {
    if (!audio || !currentUrl) return;

    if (audio.ended) {
      audio.currentTime = 0;
      void safePlay();
      return;
    }

    if (audio.paused) void safePlay();
    else audio.pause();
  }

  function changeSpeed(direction) {
    if (!audio) return;
    speedIndex = Math.max(0, Math.min(SPEED_STEPS.length - 1, speedIndex + direction));
    const speed = SPEED_STEPS[speedIndex];
    audio.playbackRate = speed;
    speedButton.textContent = `${speed.toFixed(2)}×`;
    setStatus(audio.paused ? `${speed.toFixed(2)}× · Paused` : `${speed.toFixed(2)}×`);
  }

  function seekBy(seconds) {
    if (!audio || !Number.isFinite(audio.duration)) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + seconds));
    updateTimeline();
  }

  function closePlayer() {
    if (!player || !audio) return;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    currentUrl = '';
    player.hidden = true;
    titleEl.textContent = 'Audio';
    setStatus('Ready');
    currentTimeEl.textContent = '00:00';
    durationEl.textContent = '00:00';
    progress.value = '0';
    updatePlayState();
  }

  function openAudio(url) {
    ensurePlayer();

    const normalizedUrl = new URL(String(url), location.href).href;
    player.hidden = false;

    if (normalizedUrl === currentUrl) {
      togglePlayback();
      return;
    }

    currentUrl = normalizedUrl;
    titleEl.textContent = filenameFromUrl(normalizedUrl);
    speedIndex = DEFAULT_SPEED_INDEX;
    speedButton.textContent = '1.00×';
    setStatus('Loading…');

    audio.pause();
    audio.src = normalizedUrl;
    audio.playbackRate = SPEED_STEPS[speedIndex];
    audio.load();
    void safePlay();
  }

  function isEditableTarget(target) {
    if (!(target instanceof Element)) return false;
    return Boolean(
      target.closest('input, textarea, select, [contenteditable="true"], .ProseMirror, .monaco-editor')
    );
  }

  document.addEventListener('keydown', (event) => {
    if (!currentUrl || player?.hidden || isEditableTarget(event.target)) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    let handled = true;

    switch (event.key) {
      case ' ':
      case 'Spacebar':
        togglePlayback();
        break;
      case 'ArrowLeft':
        seekBy(-SEEK_SECONDS);
        break;
      case 'ArrowRight':
        seekBy(SEEK_SECONDS);
        break;
      case 'ArrowUp':
        changeSpeed(1);
        break;
      case 'ArrowDown':
        changeSpeed(-1);
        break;
      default:
        handled = false;
    }

    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);

  window.open = function (url, target, features) {
    if (isTargetAudioUrl(url)) {
      openAudio(url);
      return null;
    }

    return nativeOpen(url, target, features);
  };
})();
