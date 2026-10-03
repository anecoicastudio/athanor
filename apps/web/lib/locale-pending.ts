/**
 * The «locale pending» gate — what replaced the splash as cover for the IT → EN switch.
 *
 * Every public page is prerendered in Italian (lib/default-locale.ts) and an English reader is
 * switched after hydration by components/locale-provider.tsx. Until 2026-10-03 the landing's
 * splash intro hid that switch; with the splash gone the Italian copy was readable for a moment
 * before it turned English. This inline script runs in <head>, before first paint: when the
 * visit resolves to a non-default locale it marks <html>, globals.css hides <body> while the mark
 * is there, and the provider lifts it once the copy has switched. The reader sees a blank page
 * for that moment instead of the wrong language.
 *
 * It resolves the locale the way the provider does — a `?lang=` hint outranks the cookie — and
 * only ever marks for `en`: an Italian reader, a crawler and a browser without JavaScript never
 * see the gate at all. The timeout is the safety net: if hydration fails, the page shows anyway.
 * It never touches `lang`: the provider sets that when the copy actually switches, so a page the
 * timeout reveals still in Italian is still labelled Italian.
 */
export const LOCALE_PENDING_ATTR = 'data-locale-pending';

/** How long the gate may hold before it lifts on its own, hydrated or not. */
export const LOCALE_PENDING_TIMEOUT_MS = 2500;

export const LOCALE_PENDING_SCRIPT = `(function(){try{var d=document.documentElement,p=new URLSearchParams(location.search).get('lang'),c=document.cookie.match(/(?:^|;\\s*)athanor_locale=(it|en)\\b/),l=p==='it'||p==='en'?p:c?c[1]:null;if(l==='en'){d.setAttribute('${LOCALE_PENDING_ATTR}','');setTimeout(function(){d.removeAttribute('${LOCALE_PENDING_ATTR}')},${LOCALE_PENDING_TIMEOUT_MS})}}catch(e){}})();`;
