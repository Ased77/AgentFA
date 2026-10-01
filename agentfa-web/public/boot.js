/**
 * Pre-paint language bootstrap.
 *
 * This used to be an inline `<script>` in `index.html`. It lives in its own file
 * because the deployment sets a Content-Security-Policy, and allowing inline
 * scripts (`script-src 'unsafe-inline'`) to keep one small bootstrap would have
 * weakened the policy for the whole app — including the login page.
 *
 * It runs before first paint on purpose: the document is generated in Persian
 * with `dir="rtl"`, so an English visitor would otherwise see the layout flip
 * after hydration. React sets the same attributes again once it mounts; agreeing
 * with it here is what avoids the flash.
 */
(function () {
  var STORAGE_KEY = 'agentfa-lang';
  var ENGLISH_TITLE = 'AgentFa | Persian AI agents';

  var lang = 'fa';
  try {
    var saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'fa' || saved === 'en') lang = saved;
  } catch (error) {
    // Private mode, disabled storage: the default language is a fine answer.
  }

  var root = document.documentElement;
  root.setAttribute('lang', lang);
  root.setAttribute('dir', lang === 'fa' ? 'rtl' : 'ltr');
  if (lang === 'en') document.title = ENGLISH_TITLE;

  // The skip link is injected into the static shell, which cannot reach the
  // string dictionaries the app uses, so its label is applied here by language.
  // Leaving it as hardcoded English put "Skip to content" on every Persian page.
  // The labels themselves come from `vite.config.ts`, which owns the markup, so
  // there is one copy of each string rather than two that can drift.
  function labelSkipLink() {
    var link = document.querySelector('.site-bypass-link');
    if (!link) return;
    var label = link.getAttribute('data-label-' + lang);
    if (label) link.textContent = label;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', labelSkipLink);
  } else {
    labelSkipLink();
  }
})();
