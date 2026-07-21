/**
 * TFlix Content — detect & enhance content cards, nav, play buttons, search.
 * Runs on load + debounced MutationObserver for SPA page transitions.
 */

import { showToast } from './ui.js';

// ── Content items ───────────────────────────────────────────────────────────

const ITEM_SELECTORS = [
  '.movie-card', '.content-item', '.film-item', '.show-card',
  '.grid-item', '.card', '.poster-container', '.thumbnail',
];

function enhanceContentItems() {
  const items = document.querySelectorAll(ITEM_SELECTORS.join(','));
  items.forEach((el, i) => {
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
    el.setAttribute('data-tflix-item', i);

    el.addEventListener('focus', () => el.classList.add('tflix-focused'));
    el.addEventListener('blur', () => el.classList.remove('tflix-focused'));

    // If it wraps a link, clicking the card should follow the link
    if (el.tagName !== 'A') {
      el.addEventListener('click', () => {
        const a = el.querySelector('a');
        if (a) a.click();
      });
    }
  });
}

// ── Navigation menus ────────────────────────────────────────────────────────

const NAV_SELECTORS = ['nav', 'header nav', '.main-nav', '.navigation', '.menu', '.sidebar'];

function enhanceNavigation() {
  document.querySelectorAll(NAV_SELECTORS.join(',')).forEach(nav => {
    nav.querySelectorAll('a, button').forEach((el, i) => {
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
      el.setAttribute('data-tflix-nav', i);
      el.addEventListener('focus', () => el.classList.add('tflix-focused'));
      el.addEventListener('blur', () => el.classList.remove('tflix-focused'));
    });
  });
}

// ── Play buttons ────────────────────────────────────────────────────────────

/**
 * Check if a button looks like a play/watch button.
 * Avoids case-insensitive CSS selectors (unsupported on Tizen Chromium).
 */
function looksLikePlayButton(el) {
  const text = (el.textContent || '').toLowerCase();
  const aria = (el.getAttribute('aria-label') || '').toLowerCase();
  const cls  = (el.className || '').toLowerCase();
  const id   = (el.id || '').toLowerCase();

  if (text.includes('play') || text.includes('watch')) return true;
  if (aria.includes('play') || aria.includes('watch')) return true;
  if (cls.includes('play') || cls.includes('watch')) return true;
  if (id.includes('play') || id.includes('watch')) return true;

  // Icon-based: check child <i> elements
  for (const icon of el.querySelectorAll('i')) {
    if ((icon.className || '').toLowerCase().includes('play')) return true;
  }

  return false;
}

function enhancePlayButtons() {
  if (!window.location.pathname.includes('/movie/') &&
      !window.location.pathname.includes('/watch/')) return;

  document.querySelectorAll('button, a, [role="button"]').forEach(btn => {
    if (!looksLikePlayButton(btn)) return;

    btn.setAttribute('tabindex', '0');
    btn.setAttribute('data-tflix-play', 'true');
    btn.classList.add('tflix-play-button');

    btn.addEventListener('focus', () => btn.classList.add('tflix-focused'));
    btn.addEventListener('blur', () => btn.classList.remove('tflix-focused'));

    // On click, show feedback and let the site handle playback
    btn.addEventListener('click', () => {
      showToast('Starting playback…', 1500);
    });
  });
}

// ── Search ──────────────────────────────────────────────────────────────────

function enhanceSearch() {
  // Find search inputs (no case-insensitive flag — unsupported on Chrome 47)
  document.querySelectorAll('input[type="search"], input[placeholder]').forEach(el => {
    const ph = (el.getAttribute('placeholder') || '').toLowerCase();
    if (!ph.includes('search') && !ph.includes('find')) return;
    el.setAttribute('tabindex', '0');
    el.setAttribute('data-tflix-search', 'true');
  });

  // Find search links/buttons
  const isSearchEl = (el) => {
    const text = (el.textContent || '').toLowerCase();
    const href = (el.getAttribute('href') || '').toLowerCase();
    const aria = (el.getAttribute('aria-label') || '').toLowerCase();
    return text.includes('search') || href.includes('search') || aria.includes('search');
  };

  document.querySelectorAll('a, button').forEach(el => {
    if (!isSearchEl(el)) return;
    if (el.hasAttribute('data-tflix-search')) return; // already done

    el.setAttribute('tabindex', '0');
    el.setAttribute('data-tflix-search', 'true');
    el.classList.add('tflix-search-element');

    el.addEventListener('focus', () => el.classList.add('tflix-focused'));
    el.addEventListener('blur', () => el.classList.remove('tflix-focused'));
  });
}

// ── Video player (light touch) ──────────────────────────────────────────────

function enhanceVideoPlayer() {
  // Only on pages that likely have a player
  if (!window.location.pathname.includes('/movie/') &&
      !window.location.pathname.includes('/watch/') &&
      !window.location.pathname.includes('/play/')) return;

  const video = document.querySelector('video');
  if (!video) return;

  // Enable native controls as fallback
  if (!video.hasAttribute('controls')) video.controls = true;

  // Expose reference so media-key handler in ui.js can find it
  window.tflixVideo = video;
}

// ── Debounced observer ──────────────────────────────────────────────────────

let debounceTimer = null;

function scanAll() {
  try {
    enhanceContentItems();
    enhanceNavigation();
    enhancePlayButtons();
    enhanceSearch();
    enhanceVideoPlayer();
  } catch (e) {
    // Never break the host page
    if (typeof console !== 'undefined') console.error('TFlix scan error', e);
  }
}

function initObserver() {
  scanAll();

  const observer = new MutationObserver(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(scanAll, 300);
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

// ── Start ───────────────────────────────────────────────────────────────────

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initObserver);
} else {
  initObserver();
}

export { scanAll };
