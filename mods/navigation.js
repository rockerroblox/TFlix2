/**
 * TFlix Spatial Navigation
 *
 * Lightweight TV remote navigation for Cineby.at.
 * Uses arrow keys to move focus between clickable elements.
 * Does NOT override native browser navigation — only activates
 * when the page is in "TV mode" (body.tflix-navigation-mode).
 */

var ARROW_KEYS = { 37: 'left', 38: 'up', 39: 'right', 40: 'down' };
var FOCUS_CLASS = 'tflix-focused';

/**
 * Find the best focusable element in a given direction from the current element.
 * Uses center-point distance with axis-weighted scoring.
 */
function findNextElement(currentEl, direction) {
  var candidates = document.querySelectorAll(
    'a[href], button:not([disabled]), input:not([type="hidden"]):not([disabled]), ' +
    'select:not([disabled]), [tabindex]:not([tabindex="-1"]), ' +
    '.movie-card, .content-item, .film-item, .card, .grid-item, .poster'
  );

  var currentRect = currentEl.getBoundingClientRect();
  var currentCX = currentRect.left + currentRect.width / 2;
  var currentCY = currentRect.top + currentRect.height / 2;

  var bestEl = null;
  var bestScore = Infinity;

  for (var i = 0; i < candidates.length; i++) {
    var candidate = candidates[i];
    if (candidate === currentEl) continue;
    if (candidate.offsetWidth === 0 || candidate.offsetHeight === 0) continue;

    var rect = candidate.getBoundingClientRect();
    var cx = rect.left + rect.width / 2;
    var cy = rect.top + rect.height / 2;

    var dx = cx - currentCX;
    var dy = cy - currentCY;

    // Must be in the right direction
    var inDirection = false;
    if (direction === 'up' && dy < -1) inDirection = true;
    if (direction === 'down' && dy > 1) inDirection = true;
    if (direction === 'left' && dx < -1) inDirection = true;
    if (direction === 'right' && dx > 1) inDirection = true;

    if (!inDirection) continue;

    // Axis-weighted distance: prioritize the primary axis
    var score;
    if (direction === 'up' || direction === 'down') {
      score = Math.abs(dy) + Math.abs(dx) * 0.3;
    } else {
      score = Math.abs(dx) + Math.abs(dy) * 0.3;
    }

    if (score < bestScore) {
      bestScore = score;
      bestEl = candidate;
    }
  }

  return bestEl;
}

/**
 * Move focus to the next element in the given direction.
 */
function navigate(direction) {
  var current = document.activeElement || document.body;
  var next = findNextElement(current, direction);

  if (next) {
    // Remove focus from previous element
    var prev = document.querySelector('.' + FOCUS_CLASS);
    if (prev) prev.classList.remove(FOCUS_CLASS);

    // Focus the new element
    next.classList.add(FOCUS_CLASS);
    next.focus({ preventScroll: false });

    // Scroll into view if needed
    var rect = next.getBoundingClientRect();
    if (rect.top < 0 || rect.bottom > window.innerHeight ||
        rect.left < 0 || rect.right > window.innerWidth) {
      next.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }

    return true;
  }

  return false;
}

/**
 * Handle keydown events for spatial navigation.
 */
function handleKeydown(e) {
  // Only handle arrow keys when TV navigation mode is active
  if (!document.body.classList.contains('tflix-navigation-mode')) return;

  var direction = ARROW_KEYS[e.keyCode];
  if (!direction) return;

  // Don't intercept when user is typing in an input
  var active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' ||
      active.isContentEditable)) {
    return;
  }

  if (navigate(direction)) {
    e.preventDefault();
  }
}

/**
 * Initialize spatial navigation.
 */
function initNavigation() {
  document.addEventListener('keydown', handleKeydown);

  // Expose navigate function globally
  window.tflixNavigate = navigate;
}

// Run as soon as this module loads — before DOM is ready so the
// listener is in place when the page starts receiving key events.
initNavigation();
