import {XMLParser, XMLValidator} from 'fast-xml-parser';
const encoder=new TextEncoder();
const filePattern=/^(_admin-invoices|[a-z0-9-]{1,64})\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const textPattern=/^(?:(?:note|shared-note):[a-z0-9-]{1,64}|ideas:board|calendar:snapshot)$/;
export class StorageConflict extends Error {}
export class StorageUnavailable extends Error {constructor(status,reason='response'){super('Dateispeicher derzeit nicht erreichbar.');if(Number.isInteger(status))this.status=status;this.reason=reason;}}
const storageError=(status,reason)=>new StorageUnavailable(status,reason);
const array=value=>value==null?[]:Array.isArray(value)?value:[value];
const text=value=>typeof value==='string'?value:typeof value?.['#text']==='string'?value['#text']:'';
function namespaces(node,parent={}) {
  const result={...parent};
  for(const [key,value] of Object.entries(node||{})) if(key==='@_xmlns') result['']=value;else if(key.startsWith('@_xmlns:')) result[key.slice(8)]=value;
  return result;
}
function children(node,name,parent) {
  const result=[],ns=namespaces(node,parent);
  for(const [key,value] of Object.entries(node||{})) {
    if(key.startsWith('@_')||key.startsWith('?')||key==='#text') continue;
    const parts=key.split(':'),local=parts.at(-1),prefix=parts.length===2?parts[0]:'';
    if(local!==name) continue;
    for(const child of array(value)) if(namespaces(child,ns)[prefix]==='DAV:') result.push({value:child,ns:namespaces(child,ns)});
  }
  return result;
}
export function davBasenames(xml,collectionUrl) {
  if(/<!DOCTYPE|<!ENTITY/i.test(xml)||XMLValidator.validate(xml)!==true) throw storageError();
  const parsed=new XMLParser({ignoreAttributes:false,parseTagValue:false,trimValues:true}).parse(xml);
  const roots=children(parsed,'multistatus',{});
  if(roots.length!==1) throw storageError();
  const rows=children(roots[0].value,'response',roots[0].ns),names=[];
  const collection=new URL(collectionUrl),prefix=collection.pathname.replace(/\/$/,'')+'/';
  for(const row of rows) {
    const statuses=[...children(row.value,'status',row.ns),...children(row.value,'propstat',row.ns).flatMap(prop=>children(prop.value,'status',prop.ns))];
    const hrefs=children(row.value,'href',row.ns);
    if(!statuses.length||statuses.some(status=>!/^HTTP\/\S+\s+2\d\d(?:\s|$)/.test(text(status.value)))||hrefs.length!==1) throw storageError();
    const href=new URL(text(hrefs[0].value),collection);
    if(href.origin!==collection.origin||href.search||href.hash) throw storageError();
    if(href.pathname.replace(/\/$/,'')===collection.pathname.replace(/\/$/,'')) continue;
    if(!href.pathname.startsWith(prefix)) throw storageError();
    const relative=href.pathname.slice(prefix.length).replace(/\/$/,'');
    if(relative.includes('/')) throw storageError();
    const name=decodeURIComponent(relative);
    if(!name||name==='.'||name==='..'||/[\\/\u0000-\u001f]/.test(name)) throw storageError();
    names.push(name);
  }
  return [...new Set(names)];
}
const strongEtag=value=>typeof value==='string'&&value.length<=1024&&/^"[^"\r\n]*"$/.test(value);
export function davEtag(xml,resourceUrl){
 if(/<!DOCTYPE|<!ENTITY/i.test(xml)||XMLValidator.validate(xml)!==true)throw storageError(207,'etag');
 const parsed=new XMLParser({ignoreAttributes:false,parseTagValue:false,trimValues:true}).parse(xml),roots=children(parsed,'multistatus',{}),expected=new URL(resourceUrl);
 if(roots.length!==1)throw storageError(207,'etag');
 const tags=[];
 for(const row of children(roots[0].value,'response',roots[0].ns)){
  const hrefs=children(row.value,'href',row.ns);if(hrefs.length!==1)continue;
  const href=new URL(text(hrefs[0].value),expected);
  if(href.origin!==expected.origin||href.search||href.hash||decodeURIComponent(href.pathname)!==decodeURIComponent(expected.pathname))continue;
  for(const stat of children(row.value,'propstat',row.ns)){
   const statuses=children(stat.value,'status',stat.ns);if(!statuses.some(s=>/^HTTP\/\S+\s+200\b/.test(text(s.value))))continue;
   for(const prop of children(stat.value,'prop',stat.ns))for(const entry of children(prop.value,'getetag',prop.ns)){const tag=text(entry.value);if(strongEtag(tag))tags.push(tag);}
  }
 }
 if(!tags.length||new Set(tags).size!==1)throw storageError(207,'etag');return tags[0];
}
async function sha256(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value)))].map(v=>v.toString(16).padStart(2,'0')).join('');
}
export class NextcloudStorage {
  constructor(env,fetcher=fetch) {
    this.env=env;this.fetcher=(...args)=>fetcher(...args);
    const url=new URL(env.NEXTCLOUD_WEBDAV_URL);
    if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!env.NEXTCLOUD_USERNAME||!env.NEXTCLOUD_APP_PASSWORD||!/^[\p{L}\p{N}._ -]{1,128}$/u.test(env.NEXTCLOUD_ROOT)||['.','..'].includes(env.NEXTCLOUD_ROOT)) throw new Error('Nextcloud-Konfiguration ist ungültig.');
    this.base=url.href.replace(/\/$/,'');
    this.authorization='Basic '+btoa(String.fromCharCode(...encoder.encode(`${env.NEXTCLOUD_USERNAME}:${env.NEXTCLOUD_APP_PASSWORD}`)));
  }
  url(parts) {
    if(parts.some(part=>typeof part!=='string'||!part||part==='.'||part==='..'||/[\\/\u0000-\u001f]/.test(part))) throw new Error('Ungültiger Speicherpfad.');
    return this.base+'/'+[this.env.NEXTCLOUD_ROOT,...parts].map(encodeURIComponent).join('/');
  }
  file(key) {
    const match=filePattern.exec(key);if(!match) throw new Error('Ungültiger Dateischlüssel.');return [match[1],match[2].toLowerCase()];
  }
  async textPath(key) {
    if(!textPattern.test(key)) throw new Error('Ungültiger Textschlüssel.');return ['text',await sha256(key)+'.txt'];
  }
  async request(method,parts,body,headers={}) {
    const options={method,headers:{authorization:this.authorization,...headers},redirect:'manual',signal:AbortSignal.timeout(method==='PUT'||method==='GET'?120000:15000)};
    if(body!=null) {options.body=body;if(body instanceof ReadableStream) options.duplex='half';}
    const response=await this.fetcher(this.url(parts),options);
    if(response.status===412) {await response.body?.cancel();throw new StorageConflict('Die Daten wurden inzwischen geändert. Bitte neu laden.');}
    return response;
  }
  async success(response) {
    if(!response.ok) {await response.body?.cancel();throw storageError(response.status);}
    return response;
  }
  async ensure(parts) {
    const response=await this.request('MKCOL',parts);
    if(response.status!==201&&response.status!==405) await this.success(response);
    await response.body?.cancel();
  }
  async ensureBase() {for(const parts of [[],['files'],['metadata'],['text']]) await this.ensure(parts);}
  async readText(key) {
    const response=await this.request('GET',await this.textPath(key));
    if(response.status===404) {await response.body?.cancel();return {value:null,etag:null};}
    await this.success(response);
    // Some WebDAV gateways strip or weaken the HTTP ETag header. Read the DAV
    // property, then conditionally fetch the body so it cannot belong to an older
    // revision than the ETag used for a later write.
    let etag=response.headers.get('etag');
    if(strongEtag(etag))return {value:await response.text(),etag};
    await response.body?.cancel();
    const parts=await this.textPath(key),properties=await this.request('PROPFIND',parts,'<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getetag/></d:prop></d:propfind>',{depth:'0','content-type':'application/xml; charset=utf-8'});
    if(properties.status!==207){await properties.body?.cancel();throw storageError(properties.status,'etag');}
    etag=davEtag(await properties.text(),this.url(parts));
    const current=await this.request('GET',parts,null,{'if-match':etag});
    if(current.status===404){await current.body?.cancel();throw new StorageConflict('Die Wolkendaten wurden inzwischen geändert. Bitte neu laden.');}
    await this.success(current);return {value:await current.text(),etag};
  }
  async writeText(key,value,etag) {
    await this.ensureBase();
    const condition=etag?{'if-match':etag}:{'if-none-match':'*'};
    const response=await this.success(await this.request('PUT',await this.textPath(key),value,{'content-type':'application/json; charset=utf-8',...condition}));
    await response.body?.cancel();
  }
  async metadata(key) {
    const [folder,id]=this.file(key),response=await this.request('GET',['metadata',folder,id+'.json']);
    if(response.status===404) {await response.body?.cancel();return null;}
    await this.success(response);const metadata=await response.json();
    if(!metadata||typeof metadata.name!=='string'||typeof metadata.type!=='string'||!Number.isSafeInteger(metadata.size)||metadata.size<0||typeof metadata.uploadedAt!=='string') throw storageError();
    return metadata;
  }
  async putFile(key,body,metadata,expectedSize=metadata.size) {
    const [folder,id]=this.file(key);
    await this.ensureBase();await this.ensure(['files',folder]);await this.ensure(['metadata',folder]);
    let size=0;
    const input=body instanceof ReadableStream?body:new Blob([body]).stream();
    let stream=input.pipeThrough(new TransformStream({transform(chunk,controller){size+=chunk.byteLength;controller.enqueue(chunk);}}));
    // Workers drops Content-Length on ordinary transformed streams. Preserve it
    // explicitly: some WebDAV servers accept chunked PUTs but store empty files.
    if(typeof FixedLengthStream==='function'&&Number.isSafeInteger(expectedSize)&&expectedSize>=0)stream=stream.pipeThrough(new FixedLengthStream(expectedSize));
    const uploaded=await this.success(await this.request('PUT',['files',folder,id],stream,{'content-type':'application/octet-stream','if-none-match':'*'}));
    await uploaded.body?.cancel();
    try {
      if(size===0) throw new Error('Leere Datei.');
      const next={...metadata,size};
      const response=await this.success(await this.request('PUT',['metadata',folder,id+'.json'],JSON.stringify(next),{'content-type':'application/json','if-none-match':'*'}));
      await response.body?.cancel();return next;
    } catch(error) {
      // A failed metadata publication must not leave a downloadable orphan.
      const response=await this.request('DELETE',['files',folder,id]);await response.body?.cancel();throw error;
    }
  }
  async delete(key) {
    const [folder,id]=this.file(key);
    for(const path of [['files',folder,id],['metadata',folder,id+'.json']]) {
      const response=await this.request('DELETE',path);
      if(response.status!==404) await this.success(response);await response.body?.cancel();
    }
  }
  async list({prefix}={}) {
    const match=/^(_admin-invoices|[a-z0-9-]{1,64})\/$/.exec(prefix||'');if(!match) throw new Error('Ungültiger Speicherbereich.');
    const parts=['metadata',match[1]],response=await this.request('PROPFIND',parts,'<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>',{depth:'1','content-type':'application/xml; charset=utf-8'});
    if(response.status===404) {await response.body?.cancel();return {keys:[],list_complete:true};}
    if(response.status!==207) {await response.body?.cancel();throw storageError();}
    const names=davBasenames(await response.text(),this.url(parts)),keys=[];
    for(const name of names) {
      if(!/^[0-9a-f-]{36}\.json$/i.test(name)) continue;
      const key=prefix+name.slice(0,-5);this.file(key);
      const metadata=await this.metadata(key);if(metadata) keys.push({name:key,metadata});
    }
    return {keys,list_complete:true};
  }
  async getWithMetadata(key,type) {
    const metadata=await this.metadata(key);if(!metadata) return {value:null,metadata:null};
    const [folder,id]=this.file(key),response=await this.request('GET',['files',folder,id]);
    if(response.status===404) {await response.body?.cancel();return {value:null,metadata:null};}
    await this.success(response);
    return {value:type==='stream'?response.body:await response.arrayBuffer(),metadata};
  }
}
