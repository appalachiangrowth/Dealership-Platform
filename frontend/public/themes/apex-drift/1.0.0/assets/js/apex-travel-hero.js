(function(){
  'use strict';
  var reduced=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function initHero(hero){
    var canvas=hero.querySelector('.apx-travel-canvas'),car=hero.querySelector('.apx-travel-car');
    if(!canvas||!car)return;
    var ctx=canvas.getContext('2d'); if(!ctx)return;
    var W=1,H=1,DPR=1,horizon=0,roadBottom=0,t=0,last=0,visible=true,frame=0,buildings=[],streaks=[],lights=[],sky=document.createElement('canvas');
    var wheelA=car.querySelector('#apx-hwA .apx-travel-sp'),wheelB=car.querySelector('#apx-hwB .apx-travel-sp'),trail=car.querySelector('#apx-trail');
    function rngFactory(seed){var s=seed>>>0;return function(){s=(s*1664525+1013904223)>>>0;return s/4294967296;};}
    function size(){DPR=Math.min(window.devicePixelRatio||1,2);W=Math.max(1,hero.clientWidth);H=Math.max(1,hero.clientHeight);canvas.width=Math.round(W*DPR);canvas.height=Math.round(H*DPR);canvas.style.width='100%';canvas.style.height='100%';sky.width=canvas.width;sky.height=canvas.height;horizon=H*.52;roadBottom=H*.94;
      var g=sky.getContext('2d');g.setTransform(DPR,0,0,DPR,0,0);
      var grad=g.createLinearGradient(0,0,0,horizon);grad.addColorStop(0,'#050817');grad.addColorStop(.43,'#0C1236');grad.addColorStop(.7,'#251E52');grad.addColorStop(.9,'#5E2E5E');grad.addColorStop(1,'#B45A4E');g.fillStyle=grad;g.fillRect(0,0,W,horizon+2);
      var r=rngFactory(71+Math.round(W));for(var i=0;i<W*horizon/3000;i++){var sy=r()*horizon*.66;g.fillStyle='rgba(235,238,255,'+((.16+r()*.48)*(1-sy/(horizon*.7)))+')';g.fillRect(r()*W,sy,r()<.08?1.5:1,r()<.08?1.5:1);}
      var sx=W*.70,sr=H*.21,sun=g.createRadialGradient(sx,horizon-H*.08,0,sx,horizon-H*.08,sr*2.8);sun.addColorStop(0,'rgba(255,190,110,.9)');sun.addColorStop(.2,'rgba(255,150,95,.48)');sun.addColorStop(.52,'rgba(255,110,120,.15)');sun.addColorStop(1,'rgba(255,110,120,0)');g.fillStyle=sun;g.fillRect(0,0,W,horizon);g.fillStyle='rgba(255,214,150,.9)';g.beginPath();g.arc(sx,horizon-H*.08,sr*.32,0,Math.PI*2);g.fill();
      var ground=g.createLinearGradient(0,horizon,0,H);ground.addColorStop(0,'#151233');ground.addColorStop(1,'#05060F');g.fillStyle=ground;g.fillRect(0,horizon,W,H-horizon);
      buildings=[];r=rngFactory(19+Math.round(W));var x=-4;while(x<W+50){var bw=22+r()*56,bh=H*(.07+r()*.16),windows=[];for(var k=0;k<7;k++){if(r()>.48)windows.push([r()*Math.max(2,bw-5)+2,r()*Math.max(2,bh-7)+3,.25+r()*.55]);}buildings.push([x,bw,bh,windows]);x+=bw+2;}
      streaks=[];r=rngFactory(311);for(i=0;i<(W<760?10:24);i++)streaks.push({x:r()*W,y:horizon+r()*(roadBottom-horizon),l:40+r()*180,v:.65+r()*1.7,a:.04+r()*.13});
      lights=[];for(x=-80;x<W+200;x+=W<760?240:380)lights.push(x);
      paint(0);
    }
    function wave(x,amp,phase){return Math.sin(x*.008+phase)*amp+Math.sin(x*.019+phase*1.7)*amp*.27;}
    function paint(dt){var spd=(W<760?W*1.28:W*.9);if(reduced)spd=0;t+=dt*spd/1000;ctx.setTransform(DPR,0,0,DPR,0,0);ctx.drawImage(sky,0,0,W,H);
      ctx.save();ctx.beginPath();ctx.moveTo(0,horizon);for(var x=0;x<=W+8;x+=8)ctx.lineTo(x,horizon-H*.08-wave(x+t*.15,H*.08,.7));ctx.lineTo(W,horizon+5);ctx.closePath();ctx.fillStyle='#2A2257';ctx.fill();ctx.restore();
      ctx.beginPath();ctx.moveTo(0,horizon+H*.04);for(x=0;x<=W+8;x+=8)ctx.lineTo(x,horizon+H*.02-wave(x+t*.35,H*.04,2.1));ctx.lineTo(W,horizon+H*.1);ctx.closePath();ctx.fillStyle='#191539';ctx.fill();
      var off=t*.11%Math.max(1,W);for(var rep=0;rep<2;rep++){buildings.forEach(function(b){var bx=b[0]-off+rep*W;if(bx>W||bx+b[1]<0)return;ctx.fillStyle='#100E28';ctx.fillRect(bx,horizon-b[2],b[1],b[2]);b[3].forEach(function(w){ctx.fillStyle='rgba(255,190,110,'+w[2]+')';ctx.fillRect(bx+w[0],horizon-b[2]+w[1],2.2,2.2);});});}
      var rg=ctx.createLinearGradient(0,horizon,0,roadBottom);rg.addColorStop(0,'#1E1A3E');rg.addColorStop(.26,'#100F24');rg.addColorStop(1,'#0A0A18');ctx.fillStyle=rg;ctx.fillRect(0,horizon,W,roadBottom-horizon);
      var sx=W*.70,rf=ctx.createRadialGradient(sx,horizon+(roadBottom-horizon)*.3,0,sx,horizon+(roadBottom-horizon)*.3,H*.8);rf.addColorStop(0,'rgba(255,150,100,.15)');rf.addColorStop(1,'rgba(255,150,100,0)');ctx.fillStyle=rf;ctx.fillRect(0,horizon,W,roadBottom-horizon);ctx.fillStyle='rgba(255,200,150,.32)';ctx.fillRect(0,horizon,W,1.2);
      var gap=W<760?240:380,lo=t*.72%gap,ph=H*.2;for(var lx=-lo;lx<W+gap;lx+=gap){ctx.fillStyle='#0B0A1C';ctx.fillRect(lx,horizon-ph,3,ph+2);ctx.fillRect(lx,horizon-ph,24,3);var lg=ctx.createRadialGradient(lx+22,horizon-ph+4,0,lx+22,horizon-ph+4,32);lg.addColorStop(0,'rgba(255,214,150,.8)');lg.addColorStop(1,'rgba(255,214,150,0)');ctx.fillStyle=lg;ctx.beginPath();ctx.arc(lx+22,horizon-ph+4,32,0,Math.PI*2);ctx.fill();}
      var laneY=horizon+(roadBottom-horizon)*.44,step=W<760?100:155,dash=step*.48,offset=t%step;ctx.fillStyle='rgba(240,236,225,.56)';for(x=-offset;x<W;x+=step)ctx.fillRect(x,laneY,dash,2.2);
      var rail=roadBottom-H*.08;ctx.fillStyle='#24204A';ctx.fillRect(0,rail,W,H*.025);ctx.fillStyle='rgba(255,190,140,.24)';ctx.fillRect(0,rail,W,1);var pg=W<760?64:104,po=(t*1.3)%pg;ctx.fillStyle='#130F2C';for(x=-po;x<W+pg;x+=pg)ctx.fillRect(x,rail,H*.006,H*.11);ctx.fillStyle='#06060E';ctx.fillRect(0,rail+H*.055,W,H-rail);
      ctx.save();ctx.globalCompositeOperation='lighter';streaks.forEach(function(s){s.x-=s.v*spd*dt/1000;if(s.x+s.l<0){s.x=W+Math.random()*180;s.y=horizon+Math.random()*(roadBottom-horizon);};var sg=ctx.createLinearGradient(s.x,0,s.x+s.l,0);sg.addColorStop(0,'rgba(255,220,190,0)');sg.addColorStop(1,'rgba(255,220,190,'+s.a+')');ctx.strokeStyle=sg;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(s.x,s.y);ctx.lineTo(s.x+s.l,s.y);ctx.stroke();});ctx.restore();
      var sec=performance.now()/1000,phase=sec%12,p=.24;if(phase<2)p=.24;else if(phase<4.8)p=.24+(phase-2)/2.8*.12;else if(phase<7.1)p=.36+(phase-4.8)/2.3*.18;else if(phase<9.7)p=.54-(phase-7.1)/2.6*.26;else p=.28;
      var cW=car.offsetWidth,cx=p*W-cW*.32,shake=reduced?0:Math.sin(sec*21)*.45;car.style.transform='translate3d('+Math.round(cx)+'px,'+shake.toFixed(2)+'px,0)';var rotation=(sec*(reduced?0:220))%360;if(wheelA)wheelA.setAttribute('transform','rotate('+rotation.toFixed(1)+' 510 334)');if(wheelB)wheelB.setAttribute('transform','rotate('+rotation.toFixed(1)+' 870 334)');if(trail&&!reduced){var w=170+18*Math.sin(sec*6);trail.setAttribute('width',w.toFixed(0));trail.setAttribute('x',(398-w).toFixed(0));}
    }
    function loop(now){if(!visible)return;var dt=last?Math.min(50,now-last):16;last=now;paint(dt);if(!reduced)frame=requestAnimationFrame(loop);}
    function start(){if(frame)cancelAnimationFrame(frame);last=0;visible=true;if(!reduced)frame=requestAnimationFrame(loop);else paint(0);}
    function stop(){visible=false;if(frame)cancelAnimationFrame(frame);frame=0;last=0;}
    size();if(!reduced)start();else{var cw=car.offsetWidth;car.style.transform='translate3d('+(W*.24-cw*.32)+'px,0,0)';paint(0);}
    var resizeTimer;window.addEventListener('resize',function(){clearTimeout(resizeTimer);resizeTimer=setTimeout(function(){size();if(!reduced&&visible)start();},120);});
    if('IntersectionObserver' in window){new IntersectionObserver(function(entries){var now=entries[0]&&entries[0].isIntersecting;if(now&&!visible)start();else if(!now&&visible)stop();}).observe(hero);}
  }
  function init(){document.querySelectorAll('.apx-travel-hero').forEach(initHero);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
