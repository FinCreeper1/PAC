import {createHash} from 'node:crypto';
// Each HTML document points to the exact JS/CSS bytes bundled in this release.
// Existing browser caches cannot substitute assets from an earlier deployment.
export function versionAssets(assets) {
  const revisions = Object.fromEntries(Object.entries(assets).map(([path, value]) =>
    [path, createHash('sha256').update(Buffer.from(value, 'base64')).digest('hex').slice(0,16)]));
  for (const [path, value] of Object.entries(assets)) {
    if (!path.endsWith('.html')) continue;
    const html = Buffer.from(value, 'base64').toString('utf8').replace(
      /\b(src|href)="(\/[^"?#]+\.(?:js|css))(?:\?v=[a-f0-9]+)?"/g,
      (match, attribute, target) => revisions[target] ? `${attribute}="${target}?v=${revisions[target]}"` : match,
    );
    assets[path] = Buffer.from(html).toString('base64');
  }
}
