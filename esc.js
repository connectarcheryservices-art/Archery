/* esc.js — THE shared HTML escaper. One implementation, site-wide.
 *
 * Replaces four inequivalent copies that previously existed in admin.html,
 * account.html, checkout.html and seller.html — none of which escaped `'`,
 * and one of which (community.html) turned 0 into ''.
 *
 * Load this BEFORE any script that interpolates untrusted data into HTML:
 *   <script src="esc.js"></script>
 *
 * Rules (CLAUDE.md §1.7):
 *   • Prefer textContent. Use this only where HTML is genuinely being built.
 *   • Escape EVERY interpolation of data you did not author — including data
 *     from your own database. A seller controls product name/brand/category;
 *     a customer controls their own name; both reach the admin's screen.
 *   • `'` and `` ` `` are escaped too: attribute values in this codebase are
 *     quoted inconsistently, and a template literal can be broken out of.
 *   • Do NOT add an "escape into <script>" helper. Pass data via dataset or
 *     textContent instead; building JS from strings is how this class of bug
 *     comes back.
 */
(function (global) {
  'use strict';

  var MAP = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '`': '&#96;',
    '=': '&#61;'   // blocks unquoted-attribute breakout
  };

  /** Escape a value for interpolation into HTML text or a quoted attribute.
   *  null/undefined -> ''. Note 0 and false are preserved (a previous copy
   *  rendered 0 as an empty string). */
  function esc(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/[&<>"'`=]/g, function (c) { return MAP[c]; });
  }

  /** Escape for a URL used in href/src. Blocks javascript:/data:/vbscript:. */
  function escUrl(v) {
    if (v === null || v === undefined) return '';
    var s = String(v).trim();
    if (/^\s*(javascript|data|vbscript):/i.test(s)) return '';
    return esc(s);
  }

  global.esc = esc;
  global.escA = esc;      // back-compat: admin.html's old name, now correct
  global.escUrl = escUrl;
  if (typeof module !== 'undefined' && module.exports) module.exports = { esc: esc, escUrl: escUrl };
})(typeof window !== 'undefined' ? window : globalThis);
