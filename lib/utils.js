// lib/utils.js — Shared utility functions for DOM, escaping, messaging, and general helpers

/**
 * Strip HTML tags and entities from a string.
 */
export function stripHtml(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:amp|lt|gt|nbsp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (m) => {
      // m is the full entity like "&", "<", "&#65;", "&#x41;"
      switch (m) {
        case '&': return '&';
        case '<': return '<';
        case '>': return '>';
        case '&nbsp;': return ' ';
        case '"': return '"';
        case '&apos;': return "'";
      }
      if (m.startsWith('&#x')) return String.fromCharCode(parseInt(m.slice(3, -1), 16));
      if (m.startsWith('&#')) return String.fromCharCode(parseInt(m.slice(2, -1), 10));
      return m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

// ── DOM helpers ─────────────────────────────────────────────────────────────

/**
 * Shorthand for document.getElementById
 */
export function $(id) {
  return document.getElementById(id);
}

/**
 * Escape HTML for text content
 */
export function esc(str) {
  return String(str || '')
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"');
}

/**
 * Escape HTML for attribute values
 */
export function escAttr(str) {
  return esc(str).replace(/'/g, "'");
}

/**
 * Truncate text to a max length, adding ellipsis if needed
 */
export function truncateText(text, maxLength = 96) {
  const value = String(text || '').trim();
  if (value.length <= maxLength) return value;
  return value.slice(0, maxLength - 1) + '…';
}

/**
 * Generate a stable short ID from a string (for deduping, etc.)
 * Not cryptographically secure; used for UI keys only.
 */
export function stableId(str, length = 8) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  return Math.abs(hash).toString(36).padStart(length, '0');
}

/**
 * Debounce a function call
 */
export function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

/**
 * Throttle a function call
 */
export function throttle(fn, limit) {
  let inThrottle;
  return (...args) => {
    if (!inThrottle) {
      fn(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

/**
 * Deep clone a value (JSON-serializable only)
 */
export function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Check if a value is a plain object
 */
export function isPlainObject(value) {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Sleep for a given number of milliseconds
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
export async function retry(fn, maxAttempts = 3, baseDelay = 1000) {
  let lastError;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts - 1) {
        await sleep(baseDelay * Math.pow(2, attempt));
      }
    }
  }
  throw lastError;
}

/**
 * Group array items by a key function
 */
export function groupBy(array, keyFn) {
  return array.reduce((acc, item) => {
    const key = keyFn(item);
    (acc[key] = acc[key] || []).push(item);
    return acc;
  }, {});
}

/**
 * Unique values from array
 */
export function unique(array) {
  return [...new Set(array)];
}

/**
 * Shuffle array in place (Fisher-Yates)
 */
export function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/**
 * Parse a JSON string safely
 */
export function safeJsonParse(str, fallback = null) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

/**
 * Format a date as YYYY-MM-DD
 */
export function formatDate(date = new Date()) {
  return date.toISOString().split('T')[0];
}

/**
 * Format a date/time as ISO string without milliseconds
 */
export function formatDateTime(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Generate a random string
 */
export function randomString(length = 12) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Format bytes as human readable string
 */
export function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Get URL search params as object
 */
export function getSearchParams(url = window.location.href) {
  const params = new URLSearchParams(new URL(url).search);
  const obj = {};
  for (const [key, value] of params) obj[key] = value;
  return obj;
}

/**
 * Set URL search params from object
 */
export function setSearchParams(params, url = window.location.href) {
  const u = new URL(url);
  u.search = new URLSearchParams(params).toString();
  return u.toString();
}

/**
 * Check if code is running in a Chrome extension context
 */
export function inExtensionContext() {
  return typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id;
}

/**
 * Send a message to the extension background script
 */
export function sendToBackground(message) {
  if (!inExtensionContext()) return Promise.reject(new Error('Not in extension context'));
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve(response);
    });
  });
}

/**
 * Get the current tab URL (background script only)
 */
export async function getCurrentTabUrl() {
  if (!inExtensionContext()) return null;
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.url || null;
}

/**
 * Check if a hostname matches a domain or its subdomains
 * @param {string} hostname
 * @param {string} domain
 * @returns {boolean}
 */
export function matchesDomain(hostname, domain) {
  return hostname === domain || hostname.endsWith('.' + domain);
}

/**
 * Get domain from URL
 */
export function getDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * Normalize URL by removing tracking params, fragments, etc.
 */
export function normalizeUrl(url) {
  try {
    const u = new URL(url);
    // Remove common tracking params
    const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid', 'ref', 'source'];
    for (const param of trackingParams) u.searchParams.delete(param);
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Format a number with commas
 */
export function formatNumber(num) {
  return Number(num).toLocaleString();
}

/**
 * Capitalize first letter of each word
 */
export function titleCase(str) {
  return String(str || '')
    .toLowerCase()
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Convert camelCase to kebab-case
 */
export function camelToKebab(str) {
  return String(str || '').replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

/**
 * Convert kebab-case to camelCase
 */
export function kebabToCamel(str) {
  return String(str || '').replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Deep merge objects
 */
export function deepMerge(target, ...sources) {
  if (!sources.length) return target;
  const source = sources.shift();
  if (isPlainObject(target) && isPlainObject(source)) {
    for (const key of Object.keys(source)) {
      if (isPlainObject(source[key])) {
        if (!target[key]) Object.assign(target, { [key]: {} });
        deepMerge(target[key], source[key]);
      } else {
        Object.assign(target, { [key]: source[key] });
      }
    }
  }
  return deepMerge(target, ...sources);
}

/**
 * Pick specific keys from an object
 */
export function pick(obj, keys) {
  return keys.reduce((acc, key) => {
    if (key in obj) acc[key] = obj[key];
    return acc;
  }, {});
}

/**
 * Omit specific keys from an object
 */
export function omit(obj, keys) {
  const keySet = new Set(keys);
  return Object.fromEntries(Object.entries(obj).filter(([key]) => !keySet.has(key)));
}

/**
 * Check if object has any of the given keys
 */
export function hasAny(obj, keys) {
  return keys.some((key) => key in obj);
}

/**
 * Flatten array one level
 */
export function flatten(array) {
  return array.reduce((acc, val) => acc.concat(Array.isArray(val) ? val : [val]), []);
}

/**
 * Chunk array into smaller arrays
 */
export function chunk(array, size) {
  const result = [];
  for (let i = 0; i < array.length; i += size) result.push(array.slice(i, i + size));
  return result;
}

/**
 * Get random item from array
 */
export function randomItem(array) {
  return array[Math.floor(Math.random() * array.length)];
}

/**
 * Remove falsy values from array
 */
export function compact(array) {
  return array.filter(Boolean);
}

/**
 * Remove duplicates from array (using === comparison)
 */
export function uniq(array) {
  return [...new Set(array)];
}

/**
 * Sort array by key
 */
export function sortBy(array, keyFn, direction = 'asc') {
  const mult = direction === 'desc' ? -1 : 1;
  return [...array].sort((a, b) => {
    const aVal = keyFn(a);
    const bVal = keyFn(b);
    if (aVal < bVal) return -1 * mult;
    if (aVal > bVal) return 1 * mult;
    return 0;
  });
}

/**
 * Get nested property safely
 */
export function get(obj, path, fallback = undefined) {
  if (!obj) return fallback;
  const keys = path.split('.');
  let current = obj;
  for (const key of keys) {
    if (current == null) return fallback;
    current = current[key];
  }
  return current === undefined ? fallback : current;
}

/**
 * Set nested property
 */
export function set(obj, path, value) {
  const keys = path.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!isPlainObject(current[keys[i]])) current[keys[i]] = {};
    current = current[keys[i]];
  }
  current[keys[keys.length - 1]] = value;
  return obj;
}

/**
 * Simple event emitter
 */
export class EventEmitter {
  constructor() {
    this.events = {};
  }
  on(event, listener) {
    (this.events[event] = this.events[event] || []).push(listener);
    return () => this.off(event, listener);
  }
  off(event, listener) {
    if (!this.events[event]) return;
    this.events[event] = this.events[event].filter((l) => l !== listener);
  }
  emit(event, ...args) {
    (this.events[event] || []).forEach((listener) => listener(...args));
  }
  once(event, listener) {
    const wrapper = (...args) => {
      this.off(event, wrapper);
      listener(...args);
    };
    this.on(event, wrapper);
  }
}