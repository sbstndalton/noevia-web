// Shared locale defaults for QA browser contexts.
//
// Since #281 the UI follows the browser's language when the account
// preference is 'system'. Playwright's own default locale is en-US, which
// renders American spellings ("Customize") — but most QA scripts assert on
// British labels ("Customise", "Personalisation", ...). Playwright's
// `locale` context option drives navigator.language/navigator.languages and
// the Accept-Language header together, so setting it here once is enough;
// scripts that need a different locale (e.g. i18n-locale.cjs itself) can
// still override it per call.
const QA_LOCALE = 'en-GB';

// Merge QA_LOCALE into a set of browser.newPage()/browser.newContext()
// options without clobbering a locale the caller explicitly set.
function withLocale(opts = {}) {
  return { locale: QA_LOCALE, ...opts };
}

module.exports = { QA_LOCALE, withLocale };
