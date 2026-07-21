/**
 * TFlix Performance Optimizer
 * This module implements safe performance optimizations for smoother operation on Tizen TVs.
 * Does NOT monkey-patch global APIs, kill site animations, or allocate garbage memory.
 */

/**
 * Initialize performance optimizations
 */
function initializePerformanceOptimizations() {
  // Apply optimizations once DOM is loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyOptimizations);
  } else {
    applyOptimizations();
  }
}

/**
 * Apply various performance optimizations
 */
function applyOptimizations() {
  // Optimize images and lazy loading
  optimizeImages();

  // Optimize scrolling performance (safe, no over-aggressive GPU hints)
  optimizeScrolling();
}

/**
 * Optimize images with lazy loading and size optimizations
 */
function optimizeImages() {
  // Find all images that don't have loading attribute
  const images = document.querySelectorAll('img:not([loading])');

  images.forEach(img => {
    // Add lazy loading
    img.setAttribute('loading', 'lazy');

    // Add decoding async for better performance
    img.setAttribute('decoding', 'async');

    // Set explicit width/height if missing to avoid layout shifts
    if (!img.hasAttribute('width') && !img.hasAttribute('height')) {
      const computedStyle = window.getComputedStyle(img);
      const width = computedStyle.width;
      const height = computedStyle.height;

      if (width && width !== 'auto' && height && height !== 'auto') {
        img.setAttribute('width', parseInt(width));
        img.setAttribute('height', parseInt(height));
      }
    }
  });

  // Set up intersection observer for better lazy loading
  if ('IntersectionObserver' in window) {
    const imageObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target;
          if (img.dataset.src) {
            img.src = img.dataset.src;
            delete img.dataset.src;
          }
          observer.unobserve(img);
        }
      });
    });

    document.querySelectorAll('img[data-src]').forEach(img => {
      imageObserver.observe(img);
    });
  }
}

/**
 * Optimize scrolling performance — only targets elements with scroll overflow.
 * Does NOT apply aggressive will-change or translate3d hacks that could
 * interfere with the host site's own rendering strategy.
 */
function optimizeScrolling() {
  const scrollableElements = document.querySelectorAll('div, main, section');

  scrollableElements.forEach(el => {
    const style = window.getComputedStyle(el);
    const overflow = style.getPropertyValue('overflow');
    const overflowY = style.getPropertyValue('overflow-y');

    if (overflow === 'auto' || overflow === 'scroll' ||
        overflowY === 'auto' || overflowY === 'scroll') {
      // Use scroll-behavior: auto for instant scrolling on TV (smooth is heavy)
      if (style.getPropertyValue('scroll-behavior') === 'smooth') {
        el.style.scrollBehavior = 'auto';
      }
    }
  });
}

// Export the initialization function
export {
  initializePerformanceOptimizations
};
