/* Velocity — signature interactions shared by every page:
   intro loader, page wipe, scroll progress, emerald cursor + trail, click ripples,
   magnetic / spotlight buttons, background video and section videos. */
(function(){
'use strict';
var d=document,b=d.body,RM=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches,
    FINE=window.matchMedia&&matchMedia('(hover: hover) and (pointer: fine)').matches;
function $(s){return d.querySelector(s)}

/* intro loader */
var ld=$('#vel-ld');
if(ld){var hide=function(){ld.classList.add('out');setTimeout(function(){ld.remove()},700)};
  try{if(sessionStorage.getItem('vel_seen')){ld.remove();ld=null}else sessionStorage.setItem('vel_seen','1')}catch(e){}
  if(ld)setTimeout(hide,RM?100:1000)}

/* page wipe between pages */
var wipe=$('#vel-wipe');
if(wipe&&!RM){
  try{if(sessionStorage.getItem('vel_wipe')){sessionStorage.removeItem('vel_wipe');wipe.className='vel-wipe hold';requestAnimationFrame(function(){requestAnimationFrame(function(){wipe.className='vel-wipe out'})})}}catch(e){}
  d.addEventListener('click',function(e){
    if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
    var a=e.target.closest&&e.target.closest('a[href]');if(!a||a.target&&a.target!=='_self'||a.hasAttribute('download'))return;
    var h=a.getAttribute('href');if(!h||h.charAt(0)==='#'||/^(mailto:|tel:|sms:|javascript:)/i.test(h))return;
    var u;try{u=new URL(a.href,location.href)}catch(_){return}
    if(u.origin!==location.origin||(u.pathname===location.pathname&&u.search===location.search))return;
    e.preventDefault();try{sessionStorage.setItem('vel_wipe','1')}catch(_){}
    wipe.className='vel-wipe in';setTimeout(function(){location.href=u.href},430)});
  addEventListener('pageshow',function(ev){if(ev.persisted)wipe.className='vel-wipe'});
}

/* scroll progress */
var pg=$('#vel-pg');
if(pg){var tick=0,upd=function(){tick=0;var m=d.documentElement.scrollHeight-innerHeight;pg.style.transform='scaleX('+(m>0?scrollY/m:0)+')'};
  addEventListener('scroll',function(){if(!tick){tick=1;requestAnimationFrame(upd)}},{passive:true});upd()}

/* cursor, ring and trail (desktop pointers only) */
if(FINE&&!RM){
  var cur=d.createElement('div'),ring=d.createElement('div'),tr=d.createElement('div');
  cur.id='vel-cur';ring.id='vel-ring';tr.id='vel-trail';for(var i=0;i<8;i++)tr.appendChild(d.createElement('i'));
  b.appendChild(tr);b.appendChild(cur);b.appendChild(ring);b.classList.add('vel-cursor');
  var px=-99,py=-99,rx=-99,ry=-99,pts=[];for(i=0;i<8;i++)pts.push({x:-99,y:-99});
  addEventListener('mousemove',function(e){px=e.clientX;py=e.clientY},{passive:true});
  (function f(){rx+=(px-rx)*.16;ry+=(py-ry)*.16;cur.style.transform='translate('+px+'px,'+py+'px)';ring.style.transform='translate('+rx+'px,'+ry+'px)';
    var x=px,y=py;for(var k=0;k<pts.length;k++){var p=pts[k];p.x+=(x-p.x)*.35;p.y+=(y-p.y)*.35;var n=tr.children[k];n.style.transform='translate('+p.x+'px,'+p.y+'px) scale('+(1-k/9)+')';n.style.opacity=.5-k*.055;x=p.x;y=p.y}
    requestAnimationFrame(f)})();
  var CARD='.fc,.car,.feat-c,.bs-card,.rev-card,.apx-vehicle-card,.apx-blog-card,.apx-directory-card,.pl-card',
      HIT='a,button,select,input[type=submit],.btn,.apx-btn,[role=button]';
  d.addEventListener('mouseover',function(e){var t=e.target,c=t.closest&&t.closest(CARD),g=t.id==='c1',h=t.closest&&t.closest(HIT);
    ring.className=c||g?'v':h?'b':'';ring.textContent=c?'VIEW':g?'DRAG':'';var z=c||g?76:h?52:36;ring.style.width=ring.style.height=z+'px';ring.style.margin=(-z/2)+'px'});
  d.addEventListener('mousedown',function(e){var r=d.createElement('i');r.className='vel-rp';r.style.left=e.clientX+'px';r.style.top=e.clientY+'px';b.appendChild(r);setTimeout(function(){r.remove()},700)});
  /* spotlight fill follows the pointer; hero CTAs are magnetic */
  d.addEventListener('mousemove',function(e){var t=e.target.closest&&e.target.closest('.btn,.apx-btn');
    if(t){var r=t.getBoundingClientRect();t.style.setProperty('--x',(e.clientX-r.left)+'px');t.style.setProperty('--y',(e.clientY-r.top)+'px')}
    var m=e.target.closest&&e.target.closest('.mag');if(m){var q=m.getBoundingClientRect();m.style.transform='translate('+((e.clientX-q.left-q.width/2)*.28)+'px,'+((e.clientY-q.top-q.height/2)*.38)+'px)'}},{passive:true});
  d.addEventListener('mouseout',function(e){var m=e.target.closest&&e.target.closest('.mag');if(m&&!m.contains(e.relatedTarget))m.style.transform=''});
}

/* videos: film data ships as theme scripts; each video loads after the page is ready,
   plays only while visible, honours reduced motion and falls back to its poster */
var vids=[].slice.call(d.querySelectorAll('video.vel-video[data-media]'));
function b64blob(s,t){var bin=atob(s),n=bin.length,u=new Uint8Array(n);for(var i=0;i<n;i++)u[i]=bin.charCodeAt(i);return URL.createObjectURL(new Blob([u],{type:t}))}
function attach(v){var M=window.VEL_MEDIA&&window.VEL_MEDIA[v.dataset.media];if(!M)return;
  if(M.poster)v.poster=M.poster;if(RM)return;
  try{v.src=b64blob(M.mp4,'video/mp4')}catch(e){v.classList.add('vfail');return}
  v.muted=true;v.playsInline=true;v.addEventListener('error',function(){v.classList.add('vfail')});
  if('IntersectionObserver' in window){new IntersectionObserver(function(es){es.forEach(function(en){if(en.isIntersecting){var p=v.play();p&&p.catch&&p.catch(function(){})}else v.pause()})},{threshold:.01}).observe(v)}
  else{var p=v.play();p&&p.catch&&p.catch(function(){})}}
function loadMedia(v){var key=v.dataset.media;if(window.VEL_MEDIA&&window.VEL_MEDIA[key])return attach(v);
  if(!v.dataset.src)return;var s=d.createElement('script');s.src=v.dataset.src;s.async=true;s.onload=function(){attach(v)};s.onerror=function(){v.classList.add('vfail')};d.head.appendChild(s)}
function startMedia(){vids.forEach(function(v,i){setTimeout(function(){loadMedia(v)},i*300)})}
if(d.readyState==='complete')startMedia();else addEventListener('load',startMedia);

/* header glass state on inner pages (home already handles its own) */
var hdr=d.querySelector('.hdr,.apx-header');
if(hdr){var hs=function(){hdr.classList.toggle('vel-solid',scrollY>40)};addEventListener('scroll',hs,{passive:true});hs()}
})();
