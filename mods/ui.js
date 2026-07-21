/**
 * TFlix UI — style injection, toasts, media keys, focus.
 *
 * Kept minimal so it doesn't fight the host site's own rendering.
 * Babel + terser transpile this to ES5 for Tizen Chromium compatibility.
 */

import css from './ui.css';

// ── CSS injection ───────────────────────────────────────────────────────────

function injectStyles() {
  const style = document.createElement('style');
  style.id = 'tflix-styles';
  style.textContent = css;
  document.head.appendChild(style);
}

// ── Toast ───────────────────────────────────────────────────────────────────

export function showToast(message, duration = 2000) {
  let toast = document.querySelector('.tflix-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'tflix-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  void toast.offsetWidth;
  toast.classList.add('show');

  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => toast.classList.remove('show'), duration);
}

// ── Media key handling ──────────────────────────────────────────────────────

function findActiveVideo() {
  const videos = document.querySelectorAll('video');
  // Prefer a visible, playing video
  for (const v of videos) {
    if (!v.paused && v.offsetWidth > 0 && v.offsetHeight > 0) return v;
  }
  // Fallback: any visible video
  for (const v of videos) {
    if (v.offsetWidth > 0 && v.offsetHeight > 0) return v;
  }
  return videos.length ? videos[0] : null;
}

const MEDIA_ACTIONS = {
  MediaPlayPause: 'playpause',
  MediaPlay:       'play',
  MediaPause:      'pause',
  MediaStop:       'stop',
  MediaFastForward:'fforward',
  MediaRewind:     'rewind',
  MediaTrackNext:  'fforward',
  MediaTrackPrevious: 'rewind',
};

function handleMediaKey(action) {
  const video = findActiveVideo();
  if (!video) return false;

  switch (action) {
    case 'play':
    case 'playpause':
      if (video.paused) {
        video.play().catch(() => showToast('Press OK to start playback', 3000));
        showToast('▶ Playing', 1000);
      } else {
        video.pause();
        showToast('⏸ Paused', 1000);
      }
      return true;
    case 'pause':
      video.pause();
      showToast('⏸ Paused', 1000);
      return true;
    case 'stop':
      video.pause();
      video.currentTime = 0;
      showToast('⏹ Stopped', 1000);
      return true;
    case 'fforward':
      video.currentTime = Math.min(video.duration || 0, video.currentTime + 10);
      showToast('⏩ +10s', 800);
      return true;
    case 'rewind':
      video.currentTime = Math.max(0, video.currentTime - 10);
      showToast('⏪ -10s', 800);
      return true;
  }
  return false;
}

// ── Global keydown ──────────────────────────────────────────────────────────

const ENTER_LIKE = new Set([13, 32, 461]); // Enter, Space, OK

function onGlobalKeydown(e) {
  // Media keys
  const action = MEDIA_ACTIONS[e.key];
  if (action && handleMediaKey(action)) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }

  // Enter / OK → click the focused element
  if (ENTER_LIKE.has(e.keyCode)) {
    const active = document.activeElement;
    if (active && active !== document.body &&
        active.tagName !== 'INPUT' && active.tagName !== 'TEXTAREA' &&
        !active.isContentEditable) {
      e.preventDefault();
      active.click();
    }
  }
}

// ── Init ────────────────────────────────────────────────────────────────────

function initUI() {
  injectStyles();
  document.body.classList.add('tflix-navigation-mode');
  document.addEventListener('keydown', onGlobalKeydown);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initUI);
} else {
  initUI();
}
