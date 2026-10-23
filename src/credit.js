const CREDIT_STYLE='.pac-credit{position:fixed;right:max(10px,env(safe-area-inset-right));bottom:max(10px,env(safe-area-inset-bottom));z-index:9998;padding:3px 9px;border-radius:999px;font:500 11px/1.4 system-ui,sans-serif;letter-spacing:.01em;color:#4b5563;background:rgba(255,255,255,.72);border:1px solid rgba(0,0,0,.08);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);text-decoration:none;opacity:.6;transition:opacity .2s}.pac-credit:hover,.pac-credit:focus-visible{opacity:1}@media (prefers-color-scheme:dark){.pac-credit{color:#d1d5db;background:rgba(17,24,39,.72);border-color:rgba(255,255,255,.12)}}@media print{.pac-credit{position:static;display:inline-block;margin:8px}}';
const CREDIT_LINK='<a class="pac-credit" href="https://linusfin.de" target="_blank" rel="noopener">© Linus-Fin Leupold</a>';
// Appends the unobtrusive author credit to every HTML page.
export function withCredit(response,{inlineStyle=true}={}) {
  if(typeof HTMLRewriter==='undefined'||!(response.headers.get('content-type')||'').includes('text/html')||!response.body) return response;
  return new HTMLRewriter()
    .on('head',{element(el){if(inlineStyle)el.append(`<style>${CREDIT_STYLE}</style>`,{html:true});}})
    .on('body',{element(el){el.append(CREDIT_LINK,{html:true});}})
    .transform(response);
}
export {CREDIT_STYLE};
