/**
 * LIVE PREVIEW for the Dealership Portal editors (Website content, Design & colours).
 * Only added when a page is opened with ?pa_live=1 inside the portal. The portal sends messages:
 *   { pa: 'values', values: { key: text } }   → texts change on the page while typing (nothing is saved)
 *   { pa: 'focus', key, label }               → scrolls to that text and outlines it
 *   { pa: 'colors', colors: { primary: '#…' } } → brand colours change live
 * and the page answers { pa: 'ready', keys: [...] } and { pa: 'pick', key } (a text was clicked).
 */
import { jsonHex } from './php';

export function liveScript(opts: { colorMap: Record<string, string[]>; origins: string[] }): string {
  const cfg = jsonHex({ colorMap: opts.colorMap, origins: opts.origins });
  return `<style id="pa-live-css">
#pa-live-box{position:fixed;z-index:2147483646;pointer-events:none;border:2px solid #2563eb;border-radius:6px;background:rgba(37,99,235,.10);box-shadow:0 0 0 4px rgba(37,99,235,.18);transition:all .18s ease;opacity:0}
#pa-live-box.on{opacity:1;animation:pa-pulse 1.4s ease-out 2}
#pa-live-box span{position:absolute;left:-2px;top:-24px;background:#2563eb;color:#fff;font:600 11px/1 system-ui,-apple-system,Segoe UI,sans-serif;padding:5px 8px;border-radius:5px 5px 5px 0;white-space:nowrap;max-width:320px;overflow:hidden;text-overflow:ellipsis}
#pa-live-box.below span{top:auto;bottom:-24px;border-radius:0 5px 5px 5px}
@keyframes pa-pulse{0%{box-shadow:0 0 0 0 rgba(37,99,235,.45)}100%{box-shadow:0 0 0 14px rgba(37,99,235,0)}}
.pa-live-hover{outline:1px dashed rgba(37,99,235,.7)!important;outline-offset:3px!important;cursor:pointer!important}
</style>
<script>(function(){
var CFG=${cfg};
if(window.parent===window)return;
var T=window.SITE||{};
var focusKey='',focusLabel='',box=null,follow=0;
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');}
function subst(s){return s.replace(/\\{([a-z_]+)\\}/g,function(m,k){return Object.prototype.hasOwnProperty.call(T,k)?String(T[k]==null?'':T[k]):m;});}
function safeUrl(u){u=String(u).replace(/&quot;/g,'"').replace(/&#0?39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').trim();var m=u.match(/^([a-z][a-z0-9+.\\-]*):/i);if(m&&['http','https','mailto','tel','sms'].indexOf(m[1].toLowerCase())<0)return '';return u;}
function links(s){return s.replace(/\\[([^\\]\\n]{1,200})\\]\\(([^)\\s]{1,500})\\)/g,function(m,l,u){u=safeUrl(u);if(!u||u==='#')return l;return '<a href="'+esc(u)+'"'+(/^https?:\\/\\//i.test(u)?' target="_blank" rel="noopener"':'')+'>'+l+'</a>';});}
function fmt(mt,ft,hl,v){
  v=String(v==null?'':v);
  if(ft==='head'&&mt!=='head')v=v.replace(/\\*([^*\\n]+)\\*/g,'$1');
  if(mt==='text')v=v.replace(/\\s*\\n\\s*/g,' ').trim();
  v=subst(v);
  if(mt==='text')return esc(v.replace(/\\n/g,' '));
  if(mt==='para')return links(esc(v)).replace(/(\\r\\n|\\n\\r|\\n|\\r)/g,'<br>$1');
  return esc(v).replace(/\\*([^*\\n]+)\\*/g,function(m,w){return hl==='em'?'<em>'+w+'</em>':'<span class="'+esc(hl!==''?hl:'hl')+'">'+w+'</span>';}).replace(/\\n/g,'<br>');
}
var RS=null,RSat=0;
function R(){var now=Date.now();if(!RS||now-RSat>1500){RS=ranges();RSat=now;}return RS.filter(function(r){return r.start.isConnected&&r.end.isConnected;});}
function ranges(){
  var out=[],w=document.createTreeWalker(document.body,NodeFilter.SHOW_COMMENT),n,stack=[];
  while((n=w.nextNode())){
    var d=n.nodeValue;
    if(d.indexOf('pa:')===0){var p=d.slice(3).split(':');stack.push({start:n,key:p[0],mt:p[1],ft:p[2],hl:decodeURIComponent(p[3]||'')});}
    else if(d==='/pa'&&stack.length){var r=stack.pop();r.end=n;out.push(r);}
  }
  return out;
}
function setRange(r,html){
  var n=r.start.nextSibling;
  while(n&&n!==r.end){var x=n.nextSibling;n.parentNode.removeChild(n);n=x;}
  if(!r.end.parentNode)return;
  var t=document.createElement('template');t.innerHTML=html;
  r.end.parentNode.insertBefore(t.content,r.end);
}
function rectOf(r){
  try{var rg=document.createRange();rg.setStartAfter(r.start);rg.setEndBefore(r.end);var b=rg.getBoundingClientRect();if(b.width||b.height)return b;}catch(e){}
  var el=r.start.parentElement;return el?el.getBoundingClientRect():null;
}
function visible(r){var el=r.start.parentElement;if(!el)return false;var b=rectOf(r);return !!b&&(b.width>0||b.height>0)&&getComputedStyle(el).visibility!=='hidden';}
function findFocus(){if(!focusKey)return null;var rs=R().filter(function(r){return r.key===focusKey;});for(var i=0;i<rs.length;i++)if(visible(rs[i]))return rs[i];return null;}
function place(){
  var r=findFocus();
  if(!box){box=document.createElement('div');box.id='pa-live-box';box.appendChild(document.createElement('span'));document.body.appendChild(box);}
  if(!r){box.className='';return false;}
  var b=rectOf(r);if(!b){box.className='';return false;}
  box.style.left=(b.left-6)+'px';box.style.top=(b.top-6)+'px';box.style.width=(b.width+12)+'px';box.style.height=(b.height+12)+'px';
  box.firstChild.textContent=focusLabel||'Editing';
  box.className='on'+(b.top<40?' below':'');
  return true;
}
function track(ms){var until=Date.now()+ms;cancelAnimationFrame(follow);(function loop(){place();if(Date.now()<until)follow=requestAnimationFrame(loop);})();}
function focus(key,label){
  focusKey=key||'';focusLabel=label||'';
  var r=findFocus();
  if(r){var el=r.start.parentElement;if(el&&el.scrollIntoView)el.scrollIntoView({behavior:'smooth',block:'center'});}
  track(1600);
  send({pa:'focus-result',key:focusKey,found:!!r});
}
function values(v){
  RS=null;R().forEach(function(r){if(Object.prototype.hasOwnProperty.call(v,r.key))setRange(r,fmt(r.mt,r.ft,r.hl,v[r.key]));});
  if(focusKey)track(400);
}
function colors(c){
  var root=document.documentElement.style;
  Object.keys(c||{}).forEach(function(k){var v=c[k],ok=/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(v||'');(CFG.colorMap[k]||(k.indexOf('--')===0?[k]:[])).forEach(function(cv){if(ok)root.setProperty(cv,v);else root.removeProperty(cv);});});
}
function send(m){try{window.parent.postMessage(m,'*');}catch(e){}}
window.addEventListener('message',function(e){
  if(e.source!==window.parent)return;
  if(CFG.origins.indexOf(e.origin)<0&&!/^https?:\\/\\/(localhost|127\\.0\\.0\\.1)(:\\d+)?$/.test(e.origin))return;
  var d=e.data||{};
  if(d.pa==='ping')ready();
  else if(d.pa==='values')values(d.values||{});
  else if(d.pa==='focus')focus(d.key,d.label);
  else if(d.pa==='colors')colors(d.colors||{});
});
window.addEventListener('scroll',function(){if(focusKey)place();},true);
window.addEventListener('resize',function(){if(focusKey)place();});
// hover + click on an editable text → the portal opens that field
var hoverEl=null;
function keyAt(target){
  var rs=R(),best=null;
  for(var i=0;i<rs.length;i++){var el=rs[i].start.parentElement;if(el&&(el===target||el.contains(target))){if(!best||best.el.contains(el))best={key:rs[i].key,el:el};}}
  return best;
}
document.addEventListener('mouseover',function(e){var k=keyAt(e.target);var el=k?k.el:null;if(el===hoverEl)return;if(hoverEl)hoverEl.classList.remove('pa-live-hover');hoverEl=el;if(el)el.classList.add('pa-live-hover');},true);
document.addEventListener('click',function(e){var k=keyAt(e.target);if(!k)return;if(!e.target.closest('a,button,input,select,textarea,label'))e.preventDefault();send({pa:'pick',key:k.key});},true);
function ready(){var keys={};ranges().forEach(function(r){keys[r.key]=1;});send({pa:'ready',keys:Object.keys(keys),path:location.pathname+location.hash});}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready);else ready();
window.addEventListener('hashchange',function(){setTimeout(ready,150);});
})();</script>`;
}
