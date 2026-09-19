import {collectMuseumMedia} from './museum-media-model.mjs';
import {publicURL} from './museum-publications.mjs';

const INDEX_URL = new URL('./museum-media-index.json', import.meta.url).href;
const clean = (value, max = 500) => typeof value === 'string' ? value.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0*39;/g, "'").replace(/\s+/g, ' ').trim().slice(0, max) : '';
const normalized = value => clean(value).replaceAll('_', ' ').toLocaleLowerCase();
const abortError = () => new DOMException('Museum selection changed.', 'AbortError');
function check(signal) { if (signal?.aborted) throw signal.reason || abortError(); }

export function wikipediaReference(value) {
  const safe = publicURL(value); if (!safe) return null;
  const url = new URL(safe);
  if (!/^[a-z]{2,12}(?:-[a-z]{2,12})?\.wikipedia\.org$/.test(url.hostname) || url.port) return null;
  let title;
  try { title = url.pathname.startsWith('/wiki/') ? decodeURIComponent(url.pathname.slice(6)).replaceAll('_', ' ') : url.pathname === '/w/index.php' ? url.searchParams.get('title') : ''; } catch { return null; }
  if (!title || title.length > 180 || /[|\u0000-\u001f]/.test(title) || title.includes(':')) return null;
  return {host: url.hostname, title, source: 'https://' + url.hostname + '/wiki/' + encodeURIComponent(title.replaceAll(' ', '_')), cited: true};
}

export function commonsImage(value) {
  const page = Object.values(value?.query?.pages || {})[0], info = page?.imageinfo?.[0], meta = info?.extmetadata;
  if (!info || !meta || !/^image\/(jpeg|png|webp)$/.test(info.mime || '') || meta.Restrictions?.value) return null;
  const src = publicURL(info.thumburl || info.url), source = publicURL(info.descriptionurl), license = clean(meta.LicenseShortName?.value, 100);
  let licenseURL = publicURL(meta.LicenseUrl?.value?.replace(/^http:/, 'https:'));
  if (/^(Public domain|CC0)$/i.test(license)) licenseURL ||= 'https://creativecommons.org/publicdomain/mark/1.0/';
  else if (!/^CC BY(?:-SA)? [1-4]\.0$/i.test(license)) return null;
  if (!src || !['upload.wikimedia.org', 'thumb.wikimedia.org'].includes(new URL(src).hostname) || !source || new URL(source).hostname !== 'commons.wikimedia.org') return null;
  if (!licenseURL || new URL(licenseURL).hostname !== 'creativecommons.org' || !/^\/(licenses\/(by|by-sa)\/[1-4]\.0|publicdomain\/(zero|mark)\/1\.0)\/?(?:deed\.[a-z-]+)?$/.test(new URL(licenseURL).pathname)) return null;
  const credit = clean(meta.Attribution?.value || meta.Artist?.value || (/^(Public domain|CC0)$/i.test(license) ? 'Public domain · Wikimedia Commons' : ''), 800);
  if (!credit) return null;
  return {src, source, title: clean(meta.ImageDescription?.value || page.title?.replace(/^File:/, ''), 260), credit, license, licenseURL, discovered: true};
}

async function json(fetchImpl, url, signal, maximum = 1024 * 1024) {
  check(signal);
  const response = await fetchImpl(url, {signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', headers: {Accept: 'application/json'}});
  if (!response.ok || Number(response.headers?.get?.('content-length')) > maximum) throw Error('Museum media source unavailable.');
  const reader = response.body?.getReader(); if (!reader) throw Error('Museum media source unavailable.');
  const chunks = []; let count = 0;
  try { for (;;) { check(signal); const {done, value} = await reader.read(); if (done) break; count += value.byteLength; if (count > maximum) {await reader.cancel(); throw Error('Museum media response too large.');} chunks.push(value); } } finally {reader.releaseLock();}
  const bytes = new Uint8Array(count); let at = 0; for (const chunk of chunks) {bytes.set(chunk, at); at += chunk.byteLength;}
  check(signal); return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
}

export function createMuseumMediaLoader({fetchImpl = (...args) => fetch(...args), indexURL = INDEX_URL, storage, now = Date.now} = {}) {
  const cache = new Map(); let index;
  const getStorage = () => {try {return storage === undefined ? globalThis.sessionStorage : storage;} catch {return null;}};
  function cached(key) {
    let entry = cache.get(key);
    if (!entry) try {const raw = getStorage()?.getItem('orb-museum-media-v1:' + key); if (raw && raw.length < 30000) entry = JSON.parse(raw);} catch {}
    if (!entry || !Number.isFinite(entry.expires) || entry.expires <= now() || !Array.isArray(entry.images) || entry.images.length > 3) return null;
    // Cached metadata is untrusted too; validate fixed provider locations again.
    if (entry.images.some(image => !image || !publicURL(image.src) || !['upload.wikimedia.org', 'thumb.wikimedia.org'].includes(new URL(image.src).hostname) || !publicURL(image.source) || new URL(image.source).hostname !== 'commons.wikimedia.org' || typeof image.credit !== 'string' || !image.credit || !/^(?:Public domain|CC0|CC BY(?:-SA)? [1-4]\.0)$/i.test(image.license || '') || !publicURL(image.licenseURL) || new URL(image.licenseURL).hostname !== 'creativecommons.org')) return null;
    return entry;
  }
  function remember(key, value) {
    const entry = {...value, expires: now() + (value.status === 'ready' ? 6 * 3600000 : value.status === 'no_match' ? 30 * 60000 : 30000)};
    if (cache.size >= 40) cache.delete(cache.keys().next().value); cache.set(key, entry);
    try {getStorage()?.setItem('orb-museum-media-v1:' + key, JSON.stringify(entry));} catch {}
    return value;
  }
  return async function loadMuseumMedia({record = {}, listing = {}, signal} = {}) {
    record ||= {}; listing ||= {};
    // Each panel owns its selection signal; concurrent panels must not cancel
    // one another merely because they share the safe metadata cache.
    const controller = new AbortController();
    const stop = () => controller.abort(signal.reason || abortError()); if (signal?.aborted) stop(); else signal?.addEventListener('abort', stop, {once: true});
    const timer = setTimeout(() => controller.abort(new DOMException('Museum media lookup timed out.', 'TimeoutError')), 12000);
    const requestSignal = controller.signal;
    let fallbackItems = collectMuseumMedia(record, {listing});
    try {
      check(requestSignal);
      let indexUnavailable = false;
      if (!index) try {const candidate = await json(fetchImpl, indexURL, requestSignal, 2 * 1024 * 1024); if (candidate?.schemaVersion !== 1 || !candidate.orbs || typeof candidate.orbs !== 'object' || Array.isArray(candidate.orbs)) throw Error('Invalid index.'); index = candidate;} catch (error) {if (requestSignal.aborted) throw error; indexUnavailable = true;}
      const saved = index?.orbs && Object.hasOwn(index.orbs, listing.id) ? index.orbs[listing.id] : null, combined = {...listing, ...(saved ? {savedMedia: saved} : {})};
      const items = collectMuseumMedia(record, {listing: combined});
      fallbackItems = items;
      if (items.some(item => item.kind === 'image' && item.access === 'direct')) return {items, status: 'saved'};
      const urls = value => (Array.isArray(value) ? value : []).map(item => item?.url);
      const rawSources = [...urls(record.content?.sources), ...urls(record.museum?.library), ...urls(listing.museum?.library), ...(Array.isArray(saved?.sourceURLs) ? saved.sourceURLs : [])];
      const refs = [], seen = new Set();
      for (const url of rawSources) {const ref = wikipediaReference(url); if (ref && !seen.has(ref.source)) {seen.add(ref.source); refs.push(ref);} if (refs.length === 3) break;}
      const topic = clean(record.content?.title || listing.title, 180);
      if (!refs.length && topic && !/[|:\u0000-\u001f]/.test(topic)) refs.push({host: listing.language === 'es' || record.language === 'es' ? 'es.wikipedia.org' : 'en.wikipedia.org', title: topic, cited: false});
      if (!refs.length) return {items, status: indexUnavailable ? 'unavailable' : 'no_match'};
      const key = JSON.stringify(refs.map(({host, title, cited}) => [host, title, cited]));
      let discovered = cached(key);
      if (!discovered) {
        const images = []; let failed = false;
        for (const ref of refs) {
          check(requestSignal);
          try {
            const wiki = new URL('https://' + ref.host + '/w/api.php');
            wiki.search = new URLSearchParams({action: 'query', format: 'json', origin: '*', prop: 'pageimages', piprop: 'name', pilicense: 'free', redirects: '1', titles: ref.title});
            const data = await json(fetchImpl, wiki.href, requestSignal);
            if (data?.error || !data?.query?.pages || typeof data.query.pages !== 'object') throw Error('Wikipedia image lookup is unavailable.');
            const page = Object.values(data.query.pages)[0];
            if (!page || page.ns !== 0 || !page.pageimage || page.missing !== undefined || !ref.cited && normalized(page.title) !== normalized(ref.title)) continue;
            const commons = new URL('https://commons.wikimedia.org/w/api.php');
            commons.search = new URLSearchParams({action: 'query', format: 'json', origin: '*', prop: 'imageinfo', titles: 'File:' + page.pageimage, iiprop: 'url|size|mime|extmetadata', iiurlwidth: '960'});
            const file = await json(fetchImpl, commons.href, requestSignal);
            if (file?.error || !file?.query?.pages || typeof file.query.pages !== 'object') throw Error('Image credit lookup is unavailable.');
            const image = commonsImage(file);
            if (image && !images.some(item => item.source === image.source)) images.push({...image, node: null});
          } catch (error) {if (requestSignal.aborted) throw error; failed = true;}
        }
        discovered = remember(key, {images, status: images.length ? 'ready' : failed ? 'unavailable' : 'no_match'});
      }
      check(requestSignal);
      return {items: [...items, ...collectMuseumMedia({readingImages: discovered.images})], status: indexUnavailable && discovered.status === 'no_match' ? 'unavailable' : discovered.status};
    } catch (error) {
      if (signal?.aborted) throw abortError();
      if (controller.signal.aborted) return {items: fallbackItems, status: 'unavailable'};
      throw error;
    } finally {clearTimeout(timer); signal?.removeEventListener('abort', stop);}
  };
}

export const loadMuseumMedia = createMuseumMediaLoader();
