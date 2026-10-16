import {test} from 'node:test';
import assert from 'node:assert/strict';
import {versionAssets} from '../scripts/asset-versions.mjs';
const encode = text => Buffer.from(text).toString('base64');
function release(script='current code') {
 const assets={'/admin/index.html':encode('<script src="/shared/calendar-model.js" defer></script><script src="/admin/journey-editor.js" defer></script><link rel="stylesheet" href="/admin/admin.css"><a href="/admin">Admin</a>'),'/shared/calendar-model.js':encode('calendar model'),'/admin/journey-editor.js':encode(script),'/admin/admin.css':encode('body{}')};
 versionAssets(assets);
 return Buffer.from(assets['/admin/index.html'],'base64').toString();
}
test('admin HTML requests versioned model, journey editor and stylesheet',()=>{
 const html=release();
 for(const file of ['/shared/calendar-model.js','/admin/journey-editor.js','/admin/admin.css']) assert.ok(html.includes(file+'?v='));
 assert.ok(html.includes('<a href="/admin">Admin</a>'));
});
test('a changed journey editor gets a new URL even if the HTML did not change',()=>{
 const first=release('old code'),second=release('fixed code');
 const url=html=>html.match(/src="(\/admin\/journey-editor.js[^\"]*)"/)[1];
 assert.notEqual(url(first),url(second));
 assert.equal(release('fixed code'),second);
});
test('external and unbundled URLs are left unchanged',()=>{
 const html='<script src="https://example.org/library.js"></script><link href="/missing.css">';
 const assets={'/index.html':encode(html)};versionAssets(assets);
 assert.equal(Buffer.from(assets['/index.html'],'base64').toString(),html);
});
