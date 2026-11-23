/**
 * <ActivityTracker /> for the dealer websites.
 *
 * The websites are the original theme files rendered by app/[[...path]]/route.ts (app/layout.tsx is never used for
 * them), so the tracker is a small inline script put into the <head> of every public page by finishHtml() — once per
 * page, on every design, without blocking rendering (a few KB, it starts once the page is parsed). Portal previews
 * (pa_live, pa_theme_preview, pa_page_preview) and pages shown inside a frame are never tracked.
 *
 *  · visitorId  vis_<uuid> in localStorage + first-party cookie pa_vid (365 days). api/lead.php reads the cookie, so
 *               every inquiry form (theme forms, test drive / trade-in / financing, Pages & SEO contact forms) carries it.
 *  · events     PAGE_VIEW / VIEW_VDP (vehicle id: from the server on vehicle pages, else #/vehicle/<id>,
 *               #vehicle-<slug>, vehicle.html?id=), SCROLL_DEPTH 25/50/75/100, TIME_SPENT (only while the tab is
 *               visible), WHATSAPP_CLICK, CALL_CLICK (tel:, wa.me, api.whatsapp.com …), FORM_START.
 *               Single-page designs: every view change (pushState / hashchange) is a new page view.
 *  · sending    queued in memory, POST /api/track every 9 s (fetch keepalive), and with navigator.sendBeacon when
 *               the tab is hidden or the page is left.
 */

export interface TrackerConfig {
  /** dealership id (= dealer slug) */
  dealerSlug: string;
  /** vehicle shown on this address (vehicle pages), when the server knows it */
  vehicleId?: string;
  vehicleTitle?: string;
}

const js = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

const RUNTIME = `(function(C){
try{if(window.top!==window.self)return}catch(e){return}
if(window.__paTrk)return;window.__paTrk=1;
var K="pa_vid",RX=/^[A-Za-z0-9_-]{8,80}$/,vid="";
function rc(n){var m=document.cookie.match(new RegExp("(?:^|; )"+n+"=([^;]*)"));return m?decodeURIComponent(m[1]):""}
function uuid(){try{if(window.crypto&&crypto.randomUUID)return crypto.randomUUID()}catch(e){}var b=new Uint8Array(16);try{crypto.getRandomValues(b)}catch(e){for(var i=0;i<16;i++)b[i]=Math.random()*256|0}b[6]=b[6]&15|64;b[8]=b[8]&63|128;var h=[];for(var j=0;j<16;j++)h.push((b[j]+256).toString(16).slice(1));return h.slice(0,4).join("")+"-"+h.slice(4,6).join("")+"-"+h.slice(6,8).join("")+"-"+h.slice(8,10).join("")+"-"+h.slice(10).join("")}
try{vid=localStorage.getItem(K)||""}catch(e){}
if(!RX.test(vid))vid=rc(K);
if(!RX.test(vid))vid="vis_"+uuid();
try{localStorage.setItem(K,vid)}catch(e){}
document.cookie=K+"="+vid+"; Path=/; Max-Age=31536000; SameSite=Lax"+(location.protocol==="https:"?"; Secure":"");
window.PA_VID=vid;
var Q=[],EP="/api/track";
function send(b,beacon){var body=JSON.stringify({dealerSlug:C.d,visitorId:vid,events:b});if(beacon&&navigator.sendBeacon){try{if(navigator.sendBeacon(EP,new Blob([body],{type:"application/json"})))return}catch(e){}}try{fetch(EP,{method:"POST",headers:{"Content-Type":"application/json"},body:body,keepalive:true,credentials:"same-origin"})["catch"](function(){})}catch(e){}}
function flush(beacon){while(Q.length)send(Q.splice(0,25),beacon)}
function push(e){if(!e.pagePath)e.pagePath=cur();Q.push(e);if(Q.length>=25)flush();return e}
function hash(){var h="";try{h=(window.PA_LOC&&window.PA_LOC.hash)||location.hash||""}catch(e){h=location.hash||""}return h}
function cur(){var h=hash();return (location.pathname+location.search+(/^#\\/?[a-z]/i.test(h)?h:"")).slice(0,300)}
var P0=cur();
function vdp(){var p=cur();if(C.v&&p===P0)return{id:C.v,t:C.t};var m=hash().match(/^#\\/?vehicle[\\/-]([^?&#\\/]+)/i);if(m)return{id:decodeURIComponent(m[1])};try{var s=new URLSearchParams(location.search);if(/vehicle/i.test(location.pathname)&&s.get("id"))return{id:s.get("id")}}catch(e){}return null}
var V=null;
function vis(){return document.visibilityState!=="hidden"}
function pause(){if(V&&V.on){V.ms+=Date.now()-V.on;V.on=0}}
function resume(){if(V&&!V.on&&vis())V.on=Date.now()}
function spent(){if(!V)return;pause();var s=Math.round(Math.min(V.ms,1800000)/1000);V.ms=0;if(s>=1)push({eventType:"TIME_SPENT",durationSec:s,vehicleId:V.v||undefined,pagePath:V.p});resume()}
function start(){var p=cur(),i=vdp();
if(V&&p===V.p)return;
if(V&&Date.now()-V.t0<1500&&!V.m[25]&&Q.indexOf(V.ev)>-1){V.p=p;V.ev.pagePath=p;if(i){V.v=i.id;V.ev.eventType="VIEW_VDP";V.ev.vehicleId=i.id;if(i.t)V.ev.vehicleTitle=i.t}return}
if(V)spent();
V={p:p,v:i&&i.id,t0:Date.now(),ms:0,on:vis()?Date.now():0,m:{},f:0};
V.ev=push(i?{eventType:"VIEW_VDP",vehicleId:i.id,vehicleTitle:i.t||undefined}:{eventType:"PAGE_VIEW"})}
function depth(t){if(!V)return;var d=document.documentElement,b=document.body,h=Math.max(d.scrollHeight,b?b.scrollHeight:0),vh=window.innerHeight||d.clientHeight,y=window.pageYOffset||d.scrollTop||0,pct=h>vh+4?Math.round((y+vh)/h*100):0;
if(t&&t.nodeType===1&&t.scrollHeight>t.clientHeight+4){pct=Math.max(pct,Math.round((t.scrollTop+t.clientHeight)/t.scrollHeight*100))}
[25,50,75,100].forEach(function(m){if(pct>=m-1&&!V.m[m]){V.m[m]=1;push({eventType:"SCROLL_DEPTH",scrollDepth:m,vehicleId:V.v||undefined,pagePath:V.p})}})}
var raf=0;document.addEventListener("scroll",function(e){if(raf)return;var t=e.target;raf=requestAnimationFrame(function(){raf=0;depth(t)})},{capture:true,passive:true});
document.addEventListener("click",function(e){var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;if(!a)return;var h=a.getAttribute("href")||"",ev="";
if(/^tel:/i.test(h))ev="CALL_CLICK";else if(/^whatsapp:/i.test(h)||/^(https?:)?\\/\\/(wa\\.me|api\\.whatsapp\\.com|web\\.whatsapp\\.com|chat\\.whatsapp\\.com|(www\\.)?whatsapp\\.com\\/send)/i.test(h))ev="WHATSAPP_CLICK";
if(!ev)return;push({eventType:ev,vehicleId:V&&V.v||undefined});flush(true)},true);
document.addEventListener("focusin",function(e){var el=e.target;if(!V||V.f||!el||!el.tagName||!/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))return;var f=el.form||(el.closest&&el.closest("form"));if(!f)return;
var s=[el.type,el.name,el.id,f.id,f.className,f.getAttribute("role")].join(" ");if(/search|newsletter|subscribe/i.test(s)||el.type==="search")return;
V.f=1;push({eventType:"FORM_START",vehicleId:V.v||undefined})},true);
var tm=0;function route(){clearTimeout(tm);tm=setTimeout(start,60)}
["pushState","replaceState"].forEach(function(k){var o=history[k];if(!o)return;history[k]=function(){var r=o.apply(this,arguments);route();return r}});
window.addEventListener("popstate",route);window.addEventListener("hashchange",route);
document.addEventListener("visibilitychange",function(){if(vis())resume();else{spent();pause();flush(true)}});
window.addEventListener("pagehide",function(){spent();if(V)V.on=0;flush(true)});
setInterval(function(){flush(false)},9000);
var go=function(){start()};if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",go);else go();
})`;

/** the inline <script> for the <head> of a public page */
export function activityTrackerScript(c: TrackerConfig): string {
  if (!c.dealerSlug || process.env.VISITOR_TRACKING === 'off') return '';
  const conf = { d: c.dealerSlug, v: c.vehicleId || '', t: c.vehicleTitle || '' };
  return `<script data-pa-tracker>${RUNTIME}(${js(conf)});</script>`;
}
