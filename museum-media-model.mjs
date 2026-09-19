import {publicURL,PUBLICATIONS_API} from './museum-publications.mjs';

const text=(value,max=500)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max):'';
const list=(value,limit)=>Array.isArray(value)?value.slice(0,limit):[];
const kinds=new Set(['image','video','audio','source']);
const nodeId=value=>typeof value==='string'&&value.trim()&&value.length<=120?value.trim():null;
const unique=values=>[...new Set(values.filter(Boolean))];
const assetOrigin=new URL(PUBLICATIONS_API).origin;
const duration=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;

// Native players receive media files only. Provider pages remain links except
// for the two exact iframe providers below; caller-supplied embed HTML is ignored.
export function museumMediaAccess(value,{kind='source',savedImage=false}={}){
 const safe=publicURL(value);if(!safe)return null;
 const u=new URL(safe),host=u.hostname.replace(/^(www\.|m\.)/,''),hint=kinds.has(kind)?kind:'source';
 let id;
 if(host==='youtu.be')id=/^\/([A-Za-z0-9_-]{11})\/?$/.exec(u.pathname)?.[1];
 if(['youtube.com','youtube-nocookie.com'].includes(host))id=u.pathname==='/watch'?u.searchParams.get('v'):/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})\/?$/.exec(u.pathname)?.[1];
 if(id&&/^[A-Za-z0-9_-]{11}$/.test(id))return {kind:'video',url:'https://www.youtube.com/watch?v='+id,access:'embed',provider:'YouTube',embed:'https://www.youtube-nocookie.com/embed/'+id+'?playsinline=1',poster:'https://i.ytimg.com/vi/'+id+'/hqdefault.jpg'};
 const vimeo=host==='vimeo.com'?/^\/(?:channels\/[^/]+\/|groups\/[^/]+\/videos\/)?([1-9]\d{0,11})\/?$/.exec(u.pathname)?.[1]:host==='player.vimeo.com'?/^\/video\/([1-9]\d{0,11})\/?$/.exec(u.pathname)?.[1]:null;
 if(vimeo)return {kind:'video',url:'https://vimeo.com/'+vimeo,access:'embed',provider:'Vimeo',embed:'https://player.vimeo.com/video/'+vimeo,poster:null};
 const providerPage=(host==='commons.wikimedia.org'||/(^|\.)wikipedia\.org$/.test(host))&&(/^\/wiki\//.test(u.pathname)||u.pathname==='/w/index.php')
  ||host==='archive.org'&&u.pathname.startsWith('/details/')
  ||['youtube.com','youtube-nocookie.com','youtu.be','vimeo.com','player.vimeo.com','open.spotify.com','soundcloud.com','facebook.com','fb.watch'].includes(host)
  ||host==='unsplash.com'&&u.pathname.startsWith('/photos/')||host==='pexels.com'&&/\/photo\//.test(u.pathname);
 let detected=providerPage?null:/\.(?:jpe?g|png|gif|webp|avif|svg)$/i.test(u.pathname)?'image':/\.(?:mp4|webm|ogv|m4v)$/i.test(u.pathname)?'video':/\.(?:mp3|m4a|m4b|aac|wav|ogg|oga|opus|flac|weba)$/i.test(u.pathname)?'audio':null;
 // MP4/WebM can also be deliberately supplied as an audio-only recording.
 if(detected==='video'&&hint==='audio')detected='audio';
 const durableAsset=[assetOrigin,'https://www.orbforma.com','https://orbforma.com'].includes(u.origin)&&/^\/api\/(?:museum-asset|illustration-asset)$/.test(u.pathname)&&/^[a-f0-9]{64}$/.test(u.searchParams.get('id')||'');
 let provider=host,externalKind=hint;
 if(['commons.wikimedia.org','upload.wikimedia.org','thumb.wikimedia.org'].includes(host))provider='Wikimedia Commons';
 else if(host==='open.spotify.com'){
  provider='Spotify';const match=/^\/(?:intl-[a-z-]+\/)?(track|episode|album|playlist|show)\/([A-Za-z0-9]{1,64})\/?$/.exec(u.pathname);
  if(match){externalKind='audio';u.pathname='/'+match[1]+'/'+match[2];u.search='';u.hash='';}
 }
 else if(host==='soundcloud.com'){
  provider='SoundCloud';if(u.pathname!=='/')externalKind='audio';u.hostname='soundcloud.com';
  for(const key of [...u.searchParams.keys()])if(/^utm_|^(si|ref)$/i.test(key))u.searchParams.delete(key);
 }
 else if(['facebook.com','fb.watch'].includes(host)){
  provider='Facebook';if(host==='fb.watch'||/^\/(?:reel|watch)(?:\/|$)|\/videos\//.test(u.pathname))externalKind='video';
  const videoID=/^\/reel\/(\d+)\/?$/.exec(u.pathname)?.[1]||/\/videos\/(\d+)\/?$/.exec(u.pathname)?.[1]||(/^\/watch\/?$/.test(u.pathname)&&/^\d+$/.test(u.searchParams.get('v')||'')?u.searchParams.get('v'):null);
  if(videoID){u.hostname='www.facebook.com';u.pathname='/watch/';u.search='?v='+videoID;u.hash='';}
 }
 else if(host==='archive.org')provider='Internet Archive';
 else if(host==='youtube.com'||host==='youtube-nocookie.com'||host==='youtu.be')provider='YouTube';
 else if(host==='vimeo.com'||host==='player.vimeo.com')provider='Vimeo';
 const direct=!providerPage&&(!!detected||savedImage||durableAsset&&hint!=='source');
 if(direct)u.hash='';
 return {kind:detected||(savedImage?'image':externalKind),url:u.href,access:direct?'direct':'external',provider,embed:null,poster:null};
}

/**
 * Normalize saved media without fetching, inferring missing recordings, or
 * executing submitted markup. `nodes` retains every explicit point association;
 * an empty array means edition-wide. `source` is the attribution/source URL.
 */
export function collectMuseumMedia(record,{listing}={}){
 const readings=list(record?.content?.readings,2048),byIndex=readings.map((r,i)=>nodeId(r?.id)||String(i)),items=[],byURL=new Map();
 // The museum mirrors these older, owned GitHub Pages editions. An index must
 // explicitly demonstrate the same directory on both origins before rewriting.
 const from=publicURL(listing?.url),to=publicURL(listing?.savedMedia?.originalURL);
 const fromBase=from?new URL('./',from):null,toBase=to?new URL('./',to):null;
 const alias=fromBase?.origin==='https://visualizationcreation.github.io'&&['https://orbiversity.com','https://www.orbiversity.com'].includes(toBase?.origin)&&fromBase.pathname===toBase.pathname&&fromBase.pathname!=='/';
 const canonical=value=>{
  const safe=publicURL(value);if(!safe||!alias)return safe;
  const url=new URL(safe);if(url.origin===fromBase.origin&&url.pathname.startsWith(fromBase.pathname)){url.host=toBase.host;return url.href;}return safe;
 };
 const readNode=index=>Number.isInteger(index)&&index>=0&&index<byIndex.length?byIndex[index]:null;
 function add(raw,{kind='source',url=raw?.url,provenance='source',nodes=[],savedImage=false}={}){
  if(!raw||typeof raw!=='object'||items.length>=4096)return;
  const access=museumMediaAccess(canonical(url),{kind,savedImage});if(!access)return;
  const associations=unique([nodeId(raw.node),...list(raw.nodes,64).map(nodeId),...nodes]),title=text(raw.title||raw.name)||access.provider;
  const item={id:access.url,...access,title,caption:text(raw.caption||raw.description||raw.publisher,2400),node:associations[0]||null,nodes:associations,source:publicURL(raw.source)||null,credit:text(raw.credit),license:text(raw.license),licenseURL:publicURL(raw.licenseURL)||null,generated:raw.generated===true,provenance,provenances:[provenance],language:text(raw.language,32),durationLabel:text(raw.durationLabel,80),durationSeconds:duration(raw.durationSeconds)};
  const existing=byURL.get(item.url);
  if(existing){
   existing.nodes=unique([...existing.nodes,...item.nodes]);existing.node=existing.nodes[0]||null;existing.provenances=unique([...existing.provenances,provenance]);existing.generated ||= item.generated;
   for(const key of ['caption','source','credit','license','licenseURL','language','durationLabel','durationSeconds'])if(!existing[key]&&item[key])existing[key]=item[key];
   if(existing.title===existing.provider&&item.title!==item.provider)existing.title=item.title;
   if(existing.kind==='source'&&item.kind!=='source'){for(const key of ['kind','access','provider','embed','poster'])existing[key]=item[key];}
   return;
  }
  byURL.set(item.url,item);items.push(item);
 }
 function ingest(value,prefix=''){
  for(const image of list(value?.readingImages,128))add(image,{kind:'image',url:image?.src,provenance:image?.discovered===true?'discovered-image':prefix+'saved-image',savedImage:true});
  for(const media of list(value?.presentation?.media,128))if(kinds.has(media?.kind)&&media.kind!=='source')add(media,{kind:media.kind,provenance:prefix+'attached-media'});
  for(const [key,image]of Object.entries(value?.worldImages&&typeof value.worldImages==='object'?value.worldImages:{}).slice(0,128)){
   const match=/^reading:(\d+):(.+)$/.exec(key),index=match?Number(match[1]):-1;
   const associated=match&&readings[index]?.label===match[2]?readNode(index):null;
   add(image,{kind:'image',url:image?.src,provenance:prefix+'saved-world-image',nodes:associated?[associated]:[],savedImage:true});
  }
  for(const source of list(value?.content?.sources,512))add(source,{provenance:prefix+'source',nodes:list(source?.readings,2048).map(readNode)});
  for(const item of list(value?.museum?.library,512))add(item,{kind:kinds.has(item?.type||item?.kind)?item.type||item.kind:'source',url:item?.url||item?.source,provenance:prefix+'saved-library'});
  for(const item of list(value?.museum?.audio,2048))add(item,{kind:'audio',provenance:prefix+'saved-audio'});
 }
 ingest(record);
 if(listing?.savedMedia&&listing.savedMedia!==record)ingest(listing.savedMedia,'indexed-');
 if(listing){
  for(const item of list(listing.museum?.library,512))add(item,{kind:kinds.has(item?.type||item?.kind)?item.type||item.kind:'source',url:item?.url||item?.source,provenance:'listing-library'});
  for(const item of list(listing.museum?.audio,2048))add(item,{kind:'audio',provenance:'listing-audio'});
  if(listing.videoUrl)add({title:listing.videoTitle||listing.title,url:listing.videoUrl},{kind:'video',provenance:'listing-video'});
  if(listing.filmStudy?.url)add(listing.filmStudy,{kind:'video',provenance:'listing-video'});
  const featured=list(listing.editions,100).find(e=>e.id===listing.featuredEdition)||listing.editions?.[0],editionURL=featured?.url||listing.url;
  for(const journey of list(listing.availableJourneys,2048))if(journey?.narrationReady===true)add({...journey,url:journey.url||editionURL},{kind:'audio',provenance:'listing-journey'});
 }
 return items;
}
