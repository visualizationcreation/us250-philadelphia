import {collectMuseumMedia} from './museum-media-model.mjs';
import {fetchMuseumJSON,publicationId} from './museum-publications.mjs';
import {loadMuseumMedia} from './museum-media-discovery.mjs';

const make=(tag,text='',className='')=>{const el=document.createElement(tag);el.textContent=text;if(className)el.className=className;return el;};
const records=new Map();
async function publication(id){
  if(!records.has(id)){const pending=fetchMuseumJSON(id).then(value=>value.record).catch(error=>{records.delete(id);throw error;});records.set(id,pending);if(records.size>16)records.delete(records.keys().next().value);}
  return records.get(id);
}
function stylesheet(){if(document.querySelector('link[data-museum-media]'))return;const link=make('link');link.rel='stylesheet';link.href=new URL('./museum-media.css?v=media-20260919',import.meta.url).href;link.dataset.museumMedia='true';document.head.append(link);}

/** Read-only museum viewer. Discovery never changes the published record. */
export function mountMuseumMediaPanel({compact=false,onChoosePoint}={}){
  stylesheet();
  const element=make('section','','museum-media'+(compact?' museum-media-compact':''));element.setAttribute('aria-label','ORB media');
  const header=make('div','','museum-media-heading'),title=make('h3','Inside this ORB'),count=make('span');header.append(title,count);
  const tabs=make('div','','museum-media-filters');tabs.setAttribute('role','group');tabs.setAttribute('aria-label','Media type');
  const picker=make('label','','museum-media-picker'),pickerText=make('span'),select=make('select');picker.append(pickerText,select);select.onchange=()=>choose(Number(select.value));
  const stage=make('div','','museum-media-stage'),caption=make('div','','museum-media-caption'),strip=make('div','','museum-media-strip'),status=make('p','','museum-media-status');status.setAttribute('role','status');
  const reading=make('details','','museum-media-reading');
  element.append(header,tabs,picker,stage,caption,strip,reading,status);
  let items=[],selected=0,filter='all',serial=0,controller=null,currentKey='',currentPoint=null,record=null,listing=null,active=false,disposed=false,lastInput=null,paintedLanguage='',mediaRevision='',stageVersion=0,userSelected=false;
  const es=()=>document.documentElement.lang==='es',tr=(a,b)=>es()?b:a;
  const button=(text,action,cls='')=>{const b=make('button',text,cls);b.type='button';b.onclick=action;return b;};
  const link=(text,url)=>{const a=make('a',text);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;};
  const shown=()=>filter==='all'?items:items.filter(item=>item.kind===filter);
  function stop(){stage.querySelectorAll('audio,video').forEach(p=>p.pause());stage.querySelectorAll('iframe').forEach(p=>p.remove());active=false;}
  function choose(index,{notify=true}={}){stop();if(notify)userSelected=true;selected=index;paint();const item=shown()[selected],indexInRecord=record?.content?.readings?.findIndex((r,i)=>item?.nodes?.includes(r.id||String(i)));if(notify&&indexInRecord>=0)onChoosePoint?.(indexInRecord);}
  function mediaError(item,version){if(disposed||version!==stageVersion||shown()[selected]!==item)return;stage.replaceChildren(make('p',tr('This media link could not load.','No se pudo cargar este contenido.')),link(tr('Open the original source','Abrir la fuente original'),item.source||item.url));}
  function paintStage(item){
    const version=++stageVersion;
    stop();stage.replaceChildren();stage.className='museum-media-stage museum-media-'+item.kind;
    if(item.kind==='image'&&item.access==='direct'){
      const image=make('img');image.src=item.url;image.alt=item.title;image.decoding='async';image.referrerPolicy='no-referrer';image.onerror=()=>mediaError(item,version);stage.append(image);
      const expand=button(tr('View full image','Ver imagen completa'),()=>viewImage(item),'museum-media-expand');stage.append(expand);return;
    }
    if(item.kind==='audio'&&item.access==='direct'){
      stage.append(make('p',tr('Listen to this ORB','Escucha este ORB'),'museum-media-audio-title'));const player=make('audio');player.controls=true;player.preload='none';player.src=item.url;player.onplay=()=>{window.dispatchEvent(new CustomEvent('museum-media-start',{detail:element}));active=true;};player.onerror=()=>mediaError(item,version);stage.append(player);return;
    }
    if(item.kind==='video'&&['embed','direct'].includes(item.access)){
      const play=button('',()=>{window.dispatchEvent(new CustomEvent('museum-media-start',{detail:element}));active=true;const player=make(item.access==='embed'?'iframe':'video');player.title=item.title;
        if(item.access==='embed'){const embed=new URL(item.embed);embed.searchParams.set('autoplay','1');player.src=embed.href;player.allow='autoplay; encrypted-media; picture-in-picture; fullscreen';player.allowFullscreen=true;player.referrerPolicy='strict-origin-when-cross-origin';}
        else{player.src=item.url;player.controls=true;player.playsInline=true;player.preload='metadata';player.onerror=()=>mediaError(item,version);}
        stage.replaceChildren(player);if(item.access==='direct')void player.play().catch(()=>{});
      },'museum-media-play');
      if(item.poster){const poster=make('img');poster.src=item.poster;poster.alt='';poster.loading='lazy';poster.referrerPolicy='no-referrer';poster.onerror=()=>poster.remove();play.append(poster);}
      play.append(make('span',tr('Play video','Reproducir video')));stage.append(play);return;
    }
    stage.append(make('p',item.title),link(tr('Open on ','Abrir en ')+(item.provider||new URL(item.url).hostname),item.url));
  }
  function viewImage(item){
    const dialog=make('dialog','','museum-media-lightbox'),close=button(tr('Close image','Cerrar imagen'),()=>dialog.close()),image=make('img');image.src=item.url;image.alt=item.title;image.referrerPolicy='no-referrer';
    dialog.append(close,image,make('p',item.title));dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});dialog.addEventListener('close',()=>dialog.remove(),{once:true});document.body.append(dialog);dialog.showModal();close.focus();
  }
  function paint(){
    paintedLanguage=document.documentElement.lang;
    const visible=shown();selected=Math.min(selected,Math.max(0,visible.length-1));const item=visible[selected];
    picker.hidden=visible.length<2||visible.length<=12&&item?.kind!=='audio';pickerText.textContent=tr('Choose media','Elige un contenido');select.replaceChildren();if(!picker.hidden){visible.forEach((entry,index)=>{const option=make('option',entry.title);option.value=String(index);select.append(option);});select.value=String(selected);}
    title.textContent=tr('Inside this ORB','Dentro de este ORB');count.textContent=items.length?`${selected+1} / ${visible.length}`:'';
    tabs.replaceChildren();for(const [kind,en,sp]of [['all','All','Todo'],['image','Images','Imágenes'],['video','Video','Video'],['audio','Audio','Audio']]){
      const number=kind==='all'?items.length:items.filter(item=>item.kind===kind).length;if(!number||kind==='all'&&new Set(items.map(item=>item.kind)).size<2)continue;
      const b=button((kind==='all'?tr(en,sp):tr(en,sp)+' '+number),()=>{stop();userSelected=true;filter=kind;selected=0;paint();},'museum-media-filter');b.setAttribute('aria-pressed',String(filter===kind));tabs.append(b);
    }tabs.hidden=tabs.children.length<2;
    caption.replaceChildren();strip.replaceChildren();reading.replaceChildren();reading.hidden=true;
    if(!item){stop();stage.hidden=true;caption.hidden=true;strip.hidden=true;return;}stage.hidden=caption.hidden=false;paintStage(item);
    caption.append(make('h4',item.title));if(item.caption&&item.caption!==item.title)caption.append(make('p',item.caption));
    const itemPoint=record?.content?.readings?.find((r,i)=>item.nodes?.includes(r.id||String(i)));if(!compact&&itemPoint)caption.append(make('p',tr('From: ','De: ')+itemPoint.label,'museum-media-credit'));
    const attribution=make('p','','museum-media-credit');const discovered=item.provenance==='discovered-image'||item.provenances?.includes('discovered-image');
    if(item.generated)attribution.append(document.createTextNode(tr('AI illustration · ','Ilustración de IA · ')));
    if(discovered)attribution.append(document.createTextNode(tr('Related source image · ','Imagen relacionada de una fuente · ')));
    if(item.credit)attribution.append(document.createTextNode(item.credit));
    if(item.license){if(attribution.textContent)attribution.append(document.createTextNode(' · '));attribution.append(item.licenseURL?link(item.license,item.licenseURL):document.createTextNode(item.license));}
    if(item.source){if(attribution.textContent)attribution.append(document.createTextNode(' · '));attribution.append(link(tr('Source','Fuente'),item.source));}
    if(item.kind!=='image'){if(attribution.textContent)attribution.append(document.createTextNode(' · '));attribution.append(link(tr('Open original','Abrir original'),item.url));}caption.append(attribution);
    const start=Math.max(0,Math.min(selected-5,visible.length-12));for(const [offset,media]of visible.slice(start,start+12).entries()){const index=start+offset;
      const thumb=button('',()=>choose(index),'museum-media-thumb');thumb.setAttribute('aria-label',tr('Show ','Mostrar ')+media.title);thumb.setAttribute('aria-pressed',String(index===selected));thumb.title=media.title;
      const src=media.kind==='image'&&media.access==='direct'?media.url:media.poster;if(src){const img=make('img');img.src=src;img.alt='';img.loading='lazy';img.decoding='async';img.referrerPolicy='no-referrer';img.onerror=()=>img.remove();thumb.append(img);}thumb.append(make('span',media.kind==='image'?String(index+1):media.kind==='video'?tr('Video','Video'):tr('Audio','Audio')));strip.append(thumb);
    }strip.hidden=visible.length<2||item.kind==='audio';
    if(compact){const point=record?.content?.readings?.find((r,i)=>item.nodes?.includes(r.id||String(i)));if(point){reading.hidden=false;reading.append(make('summary',point.label));for(const p of point.text.split(/\n\s*\n/))reading.append(make('p',p));}}
  }
  function setItems(next){const prior=userSelected?shown()[selected]?.id:null;items=next.filter(item=>item.kind!=='source').filter(item=>!(item.kind==='image'&&item.access==='external'&&next.some(other=>other.kind==='image'&&other.access==='direct'&&other.source===item.url)));if(!shown().length)filter='all';const r=record?.content?.readings?.[currentPoint],node=r&&(r.id||String(currentPoint));
    const preferred=node?shown().findIndex(item=>item.nodes?.includes(node)):shown().findIndex(item=>item.id===prior);selected=preferred>=0?preferred:0;paint();
  }
  async function update(input={}){
    if(disposed)return;const previousInput=lastInput;lastInput=input;const key=input.record||input.listing?.id||null;currentPoint=Number.isInteger(input.point)?input.point:null;
    const revision=JSON.stringify([input.record?.readingImages,input.record?.presentation,input.record?.worldImages,input.record?.museum?.audio,input.record?.museum?.library,input.record?.content?.sources]);
    if(currentKey===key&&mediaRevision===revision&&input.listing===previousInput?.listing){const r=record?.content?.readings?.[currentPoint],node=r&&(r.id||String(currentPoint));let changed=paintedLanguage!==document.documentElement.lang;if(node&&!shown()[selected]?.nodes?.includes(node)){let index=shown().findIndex(item=>item.nodes?.includes(node));if(index<0&&filter!=='all'){filter='all';changed=true;index=shown().findIndex(item=>item.nodes?.includes(node));}if(index>=0&&index!==selected){selected=index;changed=true;}}if(changed)paint();return;}
    mediaRevision=revision;
    currentKey=key;const run=++serial;controller?.abort();controller=new AbortController();record=input.record||null;listing=input.listing||null;filter='all';items=[];selected=0;userSelected=false;paint();
    if(!key){element.hidden=true;return;}element.hidden=false;status.textContent=tr('Opening saved media…','Abriendo contenido guardado…');
    let failed=false;
    try{
      if(!record&&publicationId(listing?.id)){const loaded=await publication(listing.id);if(run!==serial)return;record=loaded;}
      if(run!==serial)return;
      setItems(collectMuseumMedia(record,{listing}));status.textContent='';
    }catch(error){if(run!==serial)return;failed=true;setItems(collectMuseumMedia(record,{listing}));status.textContent=tr('Some saved media could not load.','No se pudo cargar parte del contenido guardado.');}
    if(run!==serial)return;
    if(!record||!items.some(item=>item.kind==='image'&&item.access==='direct')){
      if(!items.length&&!failed)status.textContent=tr('Looking for a related source image…','Buscando una imagen relacionada…');
      try{const result=await loadMuseumMedia({record,listing,signal:controller.signal});if(run!==serial)return;
        if(result.status==='unavailable')failed=true;
        if(result.items?.length){setItems(result.items);status.textContent='';}
      }catch{failed=true;/* Original media stays browsable when discovery is unavailable. */}
    }
    if(run!==serial)return;
    if(!items.length)status.textContent=failed?tr('Media sources are unavailable right now. You can still explore the ORB’s readings and source links.','Las fuentes de contenido no están disponibles ahora. Puedes explorar las lecturas y los enlaces del ORB.'):tr('No playable media was saved, and no matching source image is available. The ORB’s readings and source links are still ready to explore.','No hay contenido reproducible guardado ni una imagen de fuente coincidente. Las lecturas y los enlaces siguen disponibles.');
    else if(!failed)status.textContent='';
    else status.textContent=tr('Some media sources are unavailable. Saved media remains ready above.','Algunas fuentes no están disponibles. El contenido guardado sigue disponible arriba.');
    if(failed){const retry=button(tr('Retry media','Reintentar contenido'),()=>{currentKey='';void update(lastInput);});status.append(document.createTextNode(' '),retry);}
  }
  function otherStarted(event){if(event.detail!==element&&active){stop();const item=shown()[selected];if(item)paintStage(item);}}
  window.addEventListener('museum-media-start',otherStarted);window.addEventListener('pagehide',stop);
  return {element,update,stop,destroy(){disposed=true;serial++;controller?.abort();stop();window.removeEventListener('museum-media-start',otherStarted);window.removeEventListener('pagehide',stop);element.remove();}};
}
