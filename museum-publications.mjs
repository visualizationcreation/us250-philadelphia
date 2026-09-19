export const PUBLICATIONS_API='https://orb-astra--star-navigator-informational-dimensions.netlify.app/api/museum-publications';
export const MUSEUM_HOME='https://orbiversity.com/orb-archive/';
export const publicationId=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)?value:null;
export const publicationURL=id=>publicationId(id)?MUSEUM_HOME+'studio.html?publication='+id:null;
const text=(value,max)=>typeof value==='string'?value.trim().slice(0,max):'';
const privateParameter=/^(?:token|access[_-]?token|refresh[_-]?token|api[_-]?key|key|secret|password|authorization|auth|return[_-]?token|navigation[_-]?token|sig|signature|policy|expires|awsaccesskeyid|key-pair-id|x-amz-.+|x-goog-.+)$/i;
export function publicURL(value){
  if(typeof value!=='string'||!value||value.length>2048||/[\s\\\u0000-\u001f\u007f]/.test(value))return null;
  try{const url=new URL(value),host=url.hostname.replace(/\.+$/,'');if(url.protocol!=='https:'||url.username||url.password||!host.includes('.')||/^[\d.]+$/.test(host)||host.includes(':')||/(?:^|\.)(?:local|internal|localhost|test|invalid|lan|home|intranet)$/.test(host))return null;
    for(const key of url.searchParams.keys())if(privateParameter.test(key))return null;
    for(const part of decodeURIComponent(url.hash.slice(1)).split(/[?&#]/)){const index=part.indexOf('=');if(index>=0&&privateParameter.test(part.slice(0,index)))return null;}return url.href;
  }catch{return null;}
}
function holdings(value,max){return Array.isArray(value)?value.slice(0,max).flatMap(item=>{const url=publicURL(item?.url),title=text(item?.title,500);return url&&title?[{title,url,type:text(item.type,40),language:text(item.language,32),durationLabel:text(item.durationLabel,80)}]:[]}):[];}
function metadata(value){
  const out={attribution:value?.attribution==='named'?'named':'anonymous'};
  if(out.attribution==='named'&&text(value?.creator?.displayName,120))out.creator={displayName:text(value.creator.displayName,120)};
  if(value?.contribution)out.contribution={note:text(value.contribution.note,2400),expression:text(value.contribution.expression,2400)};
  out.library=holdings(value?.library,512);out.audio=holdings(value?.audio,2048);
  if(value?.spotlight)out.spotlight={profiles:Array.isArray(value.spotlight.profiles)?value.spotlight.profiles.slice(0,6).flatMap(p=>publicURL(p?.url)?[{label:text(p.label,80),url:publicURL(p.url)}]:[]):[],items:Array.isArray(value.spotlight.items)?value.spotlight.items.slice(0,6).flatMap(p=>p&&['idea','thought','project','design','product'].includes(p.kind)&&text(p.title,180)?[{kind:p.kind,title:text(p.title,180),description:text(p.description,2400),...(publicURL(p.url)?{url:publicURL(p.url)}:{})}]:[]):[]};
  return out;
}
export function normalizeListing(value){
  const id=publicationId(value?.id),title=text(value?.title,500);if(!id||!title)return null;
  const date=text(value.publishedAt||value.firstPublished||value.updated,40),day=/^\d{4}-\d{2}-\d{2}/.test(date)?date.slice(0,10):'',url=publicationURL(id),museum=metadata(value.museum);
  return {id,title,description:text(value.description,2400),category:text(value.category,120)||'Community',tags:Array.isArray(value.tags)?value.tags.slice(0,32).map(v=>text(v,120)).filter(Boolean):[],format:'Published ORB',pointCount:Number.isInteger(value.pointCount)&&value.pointCount>0?value.pointCount:null,firstPublished:day,updated:day,publishedAt:date,url,featuredEdition:id,editions:[{id,label:'Published edition',url,published:day,interface:'Read-only ORB',displayMeta:'Published by its contributor',note:'This edition is preserved as published.'}],museum,availableJourneys:museum.audio.map(item=>({name:item.title,url:item.url,narrationReady:true,language:item.language,durationLabel:item.durationLabel})),parentId:publicationId(value.parentId),reaches:Array.isArray(value.reaches)?value.reaches.slice(0,16):[],community:true};
}
export function listingFromPublication(value){
  const record=value?.record,c=record?.content;
  return normalizeListing({id:value?.id,title:c?.title,description:c?.summary||c?.readings?.[0]?.text,category:record?.museum?.category||c?.domain,tags:record?.museum?.tags||c?.tags,pointCount:c?.readings?.length,museum:record?.museum,reaches:record?.reaches,publishedAt:value?.publishedAt,parentId:value?.parentId});
}
export function mergeCatalog(original,incoming){
  const seen=new Set(original.map(o=>o.id)),added=[];for(const raw of incoming){const entry=normalizeListing(raw);if(entry&&!seen.has(entry.id)){seen.add(entry.id);added.push(entry);}}
  return [...original,...added];
}
export function connectionsFor(orb,catalog){
  const exact=[],seen=new Set([orb.id]),byId=new Map(catalog.map(o=>[o.id,o]));
  for(const reach of Array.isArray(orb.reaches)?orb.reaches.slice(0,16):[]){
    const target=reach?.target;let found=target?.id?byId.get(target.id):null;if(target?.id&&!found)continue;
    if(!found&&publicURL(target?.url))found=catalog.find(o=>(o.editions||[]).some(e=>e.url===target.url)||o.url===target.url);
    if(!found||seen.has(found.id))continue;
    // An ID and URL supplied together must resolve to the same real edition.
    if(target.url&&!(found.editions||[]).some(e=>e.url===target.url)&&found.url!==target.url)continue;
    seen.add(found.id);exact.push({orb:found,reason:text(reach.reason,1000),relation:text(reach.relation,120),kind:'contributor'});
  }
  if(orb.parentId&&byId.has(orb.parentId)&&!seen.has(orb.parentId)){seen.add(orb.parentId);exact.unshift({orb:byId.get(orb.parentId),kind:'previous'});}
  const topic=text(orb.category,120).toLocaleLowerCase();
  const related=topic&&topic!=='community'?catalog.filter(o=>!seen.has(o.id)&&text(o.category,120).toLocaleLowerCase()===topic).slice(0,4).map(o=>({orb:o,kind:'topic'})):[];
  return [...exact,...related];
}
export function savedExploration(record){
  const windows=[{id:'root',content:record?.content,calledOrbs:record?.calledOrbs,path:[]},...(Array.isArray(record?.orbFocus?.windows)?record.orbFocus.windows:[])];
  return windows.map(window=>{
    const authored=Array.isArray(window.content?.neighbors)?window.content.neighbors:[],called=Array.isArray(window.calledOrbs)?window.calledOrbs:[],nodes=[...authored,...called];
    return {id:text(window.id,120),title:text(window.content?.title,500),current:(record?.orbFocus?.current||'root')===window.id,path:(Array.isArray(window.path)?window.path:[]).map(step=>({title:text(step?.title,500),url:publicURL(step?.url)})),nodes:nodes.map((item,index)=>({title:text(item?.title,500),summary:text(item?.summary,2400),bridge:text(item?.bridge,2400),relation:text(item?.relation,120),domain:text(item?.domain,120),url:publicURL(item?.url),parent:index<authored.length||item?.parent===-1?text(window.content?.title,500):Number.isInteger(item?.parent)&&item.parent>=0&&item.parent<index?text(nodes[item.parent]?.title,500):'',authored:index<authored.length}))};
  }).filter(window=>window.title);
}
export async function fetchMuseumJSON(id,{fetchImpl=fetch,signal,timeoutMs=15000}={}){
  if(id!==undefined&&!publicationId(id))throw new Error('This published ORB address is not valid.');
  const controller=new AbortController(),abort=()=>controller.abort();if(signal?.aborted)abort();signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,timeoutMs);
  try{const response=await fetchImpl(PUBLICATIONS_API+(id?'?id='+encodeURIComponent(id):''),{signal:controller.signal,credentials:'omit',headers:{Accept:'application/json'}});
    if(!response.ok){const error=new Error(response.status===404?'This published ORB could not be found.':'The Museum could not load this collection. Please try again.');error.status=response.status;throw error;}
    const limit=(id?5:32)*1024*1024;
    if(Number(response.headers?.get?.('content-length'))>limit)throw new Error('This Museum response is too large to open.');
    // Bound decoded transfer bytes before building a string. Content-Length may
    // be absent, incorrect or describe compressed bytes.
    const reader=response.body?.getReader();if(!reader)throw new Error('The Museum response could not be read. Please try again.');
    const chunks=[];let bytes=0;
    try{while(true){const next=await reader.read();if(next.done)break;bytes+=next.value.byteLength;if(bytes>limit){await reader.cancel();throw new Error('This Museum response is too large to open.');}chunks.push(next.value);}}finally{reader.releaseLock();}
    const combined=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){combined.set(chunk,offset);offset+=chunk.byteLength;}const value=JSON.parse(new TextDecoder().decode(combined));
    if(id){if(value?.id!==id||!value.record?.content||!Array.isArray(value.record.content.readings)||!value.record.content.readings.length)throw new Error('This published ORB is incomplete. Please try again.');}
    else if(value?.schemaVersion!==1||!Array.isArray(value.orbs)||value.orbs.length>5000)throw new Error('The Museum returned an unsupported collection.');
    return value;
  }catch(error){if(error.name==='AbortError')throw new Error('The Museum took too long to respond. Please try again.');throw error;}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
