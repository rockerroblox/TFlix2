import 'whatwg-fetch';
import './navigation.js';
import './ui.js';
import './content.js';
import { initializePerformanceOptimizations } from './performance.js';

// Apply performance optimizations once the page is ready
initializePerformanceOptimizations();
