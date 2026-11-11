/* Velocity — 3D showroom hero (glTF + Draco, drag / touch / arrow-key rotation, auto-spin) */
(function(){
'use strict';
var cv0=document.getElementById('c1');if(!cv0)return;
var VA={cyber:cv0.dataset.cyber,ferrari:cv0.dataset.ferrari,lambo:cv0.dataset.lambo,fallback:'',
  dracoWrapper:cv0.dataset.dracoWrapper,dracoWasm:cv0.dataset.dracoWasm,dracoJs:cv0.dataset.dracoJs};
const $=s=>document.querySelector(s);
const M={x:0,y:0};
addEventListener('mousemove',e=>{M.x=e.clientX/innerWidth*2-1;M.y=e.clientY/innerHeight*2-1},{passive:true});
const store={g:(k,d)=>{try{const v=JSON.parse(localStorage.getItem('vel_'+k));return v==null?d:v}catch(e){return d}},s:(k,v)=>{try{localStorage.setItem('vel_'+k,JSON.stringify(v))}catch(e){}}};
const stops=[];
// ---------- 3D SHOWCASE (hero) — real glTF models, drag/touch rotation, slow/fast auto-spin
// Each car's `src` is either '#id' of an embedded base64 <script type="model/gltf-binary"> block
// at the bottom of this file, or any URL to a .glb/.gltf (e.g. 'models/my-ferrari.glb').
const SHOW={
  cars:[
    {k:'cyber',short:'Cybertruck',name:'Tesla Cybertruck',tag:'Brushed stainless exoskeleton · Electric',src:VA.cyber,len:5.05,prep:prepCyber},
    {k:'ferrari',short:'Ferrari',name:'Ferrari 458 Spider',tag:'Rosso Corsa · 4.5L V8 · Mid-engine',src:VA.ferrari,len:4.45,yaw:Math.PI,prep:prepFerrari},
    {k:'lambo',short:'Lamborghini',name:'Lamborghini Huracán',tag:'Verde metallic · Carbon aero · V10',src:VA.lambo,len:4.45,yaw:Math.PI,prep:prepLambo}],
  speeds:{slow:.2,fast:1.05,off:0},
  sel:0,cache:{},L:null
};
const FB_IMG=VA.fallback||'';
function b64buf(s){const bin=atob(s.replace(/\s+/g,'')),n=bin.length,u=new Uint8Array(n);for(let i=0;i<n;i++)u[i]=bin.charCodeAt(i);return u.buffer}
// Draco geometry decoding: tries the fast background worker first; if the page is opened somewhere that blocks
// workers / WebAssembly (strict previews, some in-app browsers), it automatically decodes on the page instead.
const DRACO={mode:null,main:null,stock:null,preload(){return this},dispose(){},
  getMain(){return this.main||(this.main=new Promise((res,rej)=>{const go=()=>{if(typeof DracoDecoderModule!=='function')return rej(new Error('Draco JS decoder missing'));DracoDecoderModule({onModuleLoaded:m=>res({d:m})})};if(typeof DracoDecoderModule==='function'||!VA.dracoJs)return go();const s=document.createElement('script');s.src=VA.dracoJs;s.onload=go;s.onerror=()=>rej(new Error('Draco JS decoder failed to load'));document.head.appendChild(s)}))},
  decodeMain(buf,ids,types){return this.getMain().then(o=>{const dr=o.d;const dec=new dr.Decoder(),db=new dr.DecoderBuffer(),mesh=new dr.Mesh();
    try{db.Init(new Int8Array(buf),buf.byteLength);const st=dec.DecodeBufferToMesh(db,mesh);if(!st.ok()||mesh.ptr===0)throw new Error('Draco decode failed: '+st.error_msg());
      const g=new THREE.BufferGeometry(),np=mesh.num_points(),DT={Float32Array:dr.DT_FLOAT32,Int8Array:dr.DT_INT8,Int16Array:dr.DT_INT16,Int32Array:dr.DT_INT32,Uint8Array:dr.DT_UINT8,Uint16Array:dr.DT_UINT16,Uint32Array:dr.DT_UINT32};
      for(const name in ids){const T=window[types[name]]||Float32Array,a=dec.GetAttributeByUniqueId(mesh,ids[name]),nc=a.num_components(),len=np*nc,bytes=len*T.BYTES_PER_ELEMENT,ptr=dr._malloc(bytes);
        dec.GetAttributeDataArrayForAllPoints(mesh,a,DT[T.name],bytes,ptr);const arr=new T(dr.HEAPF32.buffer,ptr,len).slice();dr._free(ptr);g.setAttribute(name,new THREE.BufferAttribute(arr,nc))}
      const ni=mesh.num_faces()*3,ip=dr._malloc(ni*4);dec.GetTrianglesUInt32Array(mesh,ni*4,ip);const idx=new Uint32Array(dr.HEAPF32.buffer,ip,ni).slice();dr._free(ip);
      g.setIndex(new THREE.BufferAttribute(np>65535?idx:new Uint16Array(idx),1));return g}finally{dr.destroy(mesh);dr.destroy(db);dr.destroy(dec)}})},
  decodeDracoFile(buf,cb,ids,types){const ty={};for(const k in types)ty[k]=types[k]&&types[k].BYTES_PER_ELEMENT?types[k].name:types[k];
    const viaMain=()=>this.decodeMain(buf,ids,ty);let p;
    if(this.mode==='main'||!this.stock)p=viaMain();
    else{let w;try{w=this.stock.decodeGeometry(buf.slice(0),{attributeIDs:ids,attributeTypes:Object.assign({},ty),useUniqueIDs:true})}catch(e){w=Promise.reject(e)}
      p=Promise.race([w,new Promise((_,rej)=>setTimeout(()=>rej(new Error('Draco worker timeout')),this.mode==='worker'?25000:6000))])
        .then(g=>{this.mode='worker';return g},e=>{if(this.mode!=='main'){this.mode='main';console.info('[VELOCITY] Background decoding is blocked here, so 3D models are decoded on the page instead.',e&&e.message)}return viaMain()})}
    p.then(cb,e=>console.warn('[VELOCITY] 3D geometry decode failed:',e))}};
function showLoader(){if(SHOW.L)return SHOW.L;const L=new THREE.GLTFLoader();
  try{const D=new THREE.DRACOLoader(),W=VA.dracoWrapper,B=VA.dracoWasm;let wb=null;
    D.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.4.1/');const base=D._loadLibrary.bind(D);
    D._loadLibrary=(u,t)=>u==='draco_wasm_wrapper.js'&&W?fetch(W).then(x=>x.text()):u==='draco_decoder.wasm'&&B?(wb=wb||fetch(B).then(x=>x.arrayBuffer())).then(b=>b.slice(0)):base(u,t);
    DRACO.stock=D}catch(e){DRACO.mode='main'}
  L.setDRACOLoader(DRACO);return SHOW.L=L}
const LIN=m=>{m.color.convertSRGBToLinear();m.emissive&&m.emissive.convertSRGBToLinear();return m},PM=o=>LIN(new THREE.MeshPhysicalMaterial(o)),SM=o=>LIN(new THREE.MeshStandardMaterial(o));
function canvasTex(w,h,draw){const c=document.createElement('canvas');c.width=w;c.height=h;draw(c.getContext('2d'),w,h);const t=new THREE.CanvasTexture(c);return t}
let _shadowTex=null,_carbonTex=null;
const shadowTex=()=>_shadowTex||(_shadowTex=canvasTex(256,256,(x,w,h)=>{const g=x.createRadialGradient(w/2,h/2,0,w/2,h/2,w/2);g.addColorStop(0,'rgba(0,0,0,.82)');g.addColorStop(.45,'rgba(0,0,0,.5)');g.addColorStop(1,'rgba(0,0,0,0)');x.fillStyle=g;x.fillRect(0,0,w,h)}));
const carbonTex=()=>{if(_carbonTex)return _carbonTex;const t=canvasTex(64,64,(x,w)=>{x.fillStyle='#0c0e0f';x.fillRect(0,0,w,w);for(let i=0;i<8;i++)for(let j=0;j<8;j++){const v=((i+j)%2)?34:20,gr=x.createLinearGradient(i*8,j*8,i*8+8,j*8+8);gr.addColorStop(0,`rgb(${v},${v+2},${v+4})`);gr.addColorStop(1,`rgb(${v-8},${v-6},${v-4})`);x.fillStyle=gr;x.fillRect(i*8,j*8,8,8)}});t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(10,10);t.encoding=THREE.sRGBEncoding;return _carbonTex=t};
function prepCyber(s){
  const steel=PM({color:0xb7bec1,metalness:1,roughness:.3,envMapIntensity:1.1}),glass=PM({color:0x040605,metalness:.7,roughness:.04,clearcoat:1,clearcoatRoughness:.02}),
    rim=SM({color:0x1d2120,metalness:.75,roughness:.35}),tyre=SM({color:0x0b0c0c,roughness:.95}),bar=new THREE.MeshBasicMaterial({color:0xf2fbff}),panel=SM({color:0x101414,metalness:.4,roughness:.45});
  s.traverse(n=>{if(!n.isMesh)return;n.rotation.set(-Math.PI/2,0,0);const m=n.material.name;n.material=m==='Silver'?steel:m==='Glass'||m==='Black_glass'?glass:m==='Light_white'?bar:m==='Gray'?rim:m==='Black'?tyre:/^SB_/.test(m)?panel:n.material})}
function prepFerrari(s){
  const body=PM({color:0xc4141a,metalness:.5,roughness:.3,clearcoat:1,clearcoatRoughness:.03,envMapIntensity:1.15}),det=PM({color:0x141618,metalness:1,roughness:.32}),glass=PM({color:0x0a0e0d,metalness:.3,roughness:0,transparent:true,opacity:.6,clearcoat:1});
  s.traverse(n=>{if(!n.isMesh)return;if(n.name==='body')n.material=body;else if(/^rim_|^trim$/.test(n.name))n.material=det;else if(n.name==='glass')n.material=glass})}
function prepLambo(s){
  const paint=PM({color:0x0b8a52,metalness:.45,roughness:.32,clearcoat:1,clearcoatRoughness:.04,envMapIntensity:1}),carbon=PM({color:0xffffff,map:carbonTex(),metalness:.3,roughness:.38,clearcoat:1,clearcoatRoughness:.08}),
    cal=PM({color:0x58f07c,roughness:.35,metalness:.15,emissive:0x0b3214});
  s.traverse(n=>{if(!n.isMesh)return;const m=n.material.name;if(m==='Paint1Mtl'){n.material=paint;n.geometry.computeVertexNormals()}else if(m==='LicensePlate1Mtl')n.material=carbon;else if(m==='Meshpart14Mtl')n.material=cal})}
function frameCar(c,s){const p=new THREE.Group();s.rotation.y=c.yaw||0;p.add(s);s.updateMatrixWorld(true);
  const b=new THREE.Box3().setFromObject(s),sz=b.getSize(new THREE.Vector3()),ct=b.getCenter(new THREE.Vector3()),k=c.len/Math.max(sz.x,sz.z);
  s.scale.multiplyScalar(k);s.position.set(-ct.x*k,-b.min.y*k,-ct.z*k);
  const sh=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({map:shadowTex(),transparent:true,depthWrite:false}));sh.rotation.x=-Math.PI/2;sh.position.y=.004;sh.scale.set(sz.x*k*1.3,sz.z*k*1.22,1);sh.renderOrder=-1;p.add(sh);
  const h=new THREE.Group();h.add(p);h.userData.c=c;return h}
function loadCar(i){const c=SHOW.cars[i];if(SHOW.cache[c.k])return SHOW.cache[c.k];
  const pr=new Promise((res,rej)=>{setTimeout(()=>rej(new Error('Timed out loading '+c.name)),60000);const L=showLoader(),ok=g=>{try{c.prep(g.scene);res(frameCar(c,g.scene))}catch(e){rej(e)}};
    try{if(c.src[0]==='#'){const el=document.querySelector(c.src);if(!el)throw new Error('Embedded model '+c.src+' not found');L.parse(b64buf(el.textContent),'',ok,rej)}else L.load(c.src,ok,undefined,rej)}catch(e){rej(e)}});
  SHOW.cache[c.k]=pr;pr.catch(()=>{delete SHOW.cache[c.k]});return pr}
const showUI=()=>`<img class="sh3fb" src="${FB_IMG}" alt="Tesla Cybertruck, Lamborghini and Ferrari side by side" decoding="async">
<div class="shw glass" id="shw"><div class="shw-top"><div class="shw-meta" aria-live="polite"><b id="shwN">${SHOW.cars[SHOW.sel].name}</b><small id="shwT">${SHOW.cars[SHOW.sel].tag}</small></div><span class="shw-st" id="shwS" role="status"></span></div>
<div class="shw-cars" role="group" aria-label="Choose a car to view in 3D">${SHOW.cars.map((c,i)=>`<button type="button" data-car="${i}" aria-pressed="${i===SHOW.sel}">${c.short}</button>`).join('')}</div>
<div class="shw-bot"><div class="seg" role="group" aria-label="Auto-rotation speed"><span>Spin</span>${['slow','fast','off'].map(s=>`<button type="button" data-spd="${s}">${s==='off'?'Pause':s[0].toUpperCase()+s.slice(1)}</button>`).join('')}</div><span class="shw-hint" aria-hidden="true">⟲ Drag to rotate</span></div></div>`;

// dark automotive studio for reflections: black room, overhead softbox, side strip lights, faint emerald bounce
function studioEnv(){const e=new THREE.Scene(),B=new THREE.BoxGeometry(1,1,1),add=(c,sx,sy,sz,x,y,z,ry)=>{const m=new THREE.Mesh(B,new THREE.MeshBasicMaterial({color:new THREE.Color(...c),side:THREE.DoubleSide}));m.scale.set(sx,sy,sz);m.position.set(x,y,z);if(ry)m.rotation.y=ry;e.add(m)};
  const room=new THREE.Mesh(B,new THREE.MeshBasicMaterial({color:new THREE.Color(.018,.024,.021),side:THREE.BackSide}));room.scale.set(30,14,30);room.position.y=5;e.add(room);
  add([2.4,2.4,2.4],7,.1,2.6,0,9,0);add([2.6,2.6,2.6],.1,5,12,-10,4,0);add([2.6,2.6,2.6],.1,5,12,10,4,0);add([1.6,1.6,1.7],10,3,.1,0,3,-12);add([.9,.9,.95],8,1.6,.1,0,2.2,12);add([.05,.55,.3],14,.5,.1,0,.6,-11.5);add([.25,.25,.25],30,.1,30,0,-1.9,0);return e}
function heroScene(){const cv=$('#c1'),hero=$('#hero'),shw=$('#shw');if(!cv)return;
  const RM=matchMedia('(prefers-reduced-motion: reduce)').matches,coarse=matchMedia('(pointer: coarse)').matches;
  let spd=store.g('spd',RM?'off':'slow');if(!SHOW.speeds.hasOwnProperty(spd))spd='slow';
  const st=(t,cls)=>{const e=$('#shwS');if(e){e.textContent=t||'';e.className='shw-st'+(cls?' '+cls:'')}};
  const setUI=i=>{const c=SHOW.cars[i];$('#shwN').textContent=c.name;$('#shwT').textContent=c.tag;shw.querySelectorAll('[data-car]').forEach(b=>b.setAttribute('aria-pressed',+b.dataset.car===i))};
  const setSpd=s=>{spd=s;store.s('spd',s);shw.querySelectorAll('[data-spd]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.spd===s))};
  setSpd(spd);
  const noGL=msg=>{hero.classList.add('nogl');st(msg||'3D view unavailable on this device — showing photo','err')};
  if(!window.THREE||!THREE.GLTFLoader||!THREE.DRACOLoader)return noGL('3D engine could not load — showing photo');
  let r;try{r=new THREE.WebGLRenderer({canvas:cv,antialias:true,alpha:true,powerPreference:'high-performance'});if(!r.getContext())throw 0}catch(e){return noGL()}
  const low=matchMedia('(max-width:860px)').matches||(navigator.hardwareConcurrency||8)<=4||(navigator.deviceMemory||8)<=4;
  r.setPixelRatio(Math.min(devicePixelRatio||1,low?1.35:1.75));r.outputEncoding=THREE.sRGBEncoding;r.toneMapping=THREE.ACESFilmicToneMapping;r.toneMappingExposure=1.05;
  const sc=new THREE.Scene(),cam=new THREE.PerspectiveCamera(28,1,.1,80);
  const pm=new THREE.PMREMGenerator(r),envSc=studioEnv(),envRT=pm.fromScene(envSc,.02);envSc.traverse(o=>{if(o.isMesh){o.geometry.dispose();o.material.dispose()}});sc.environment=envRT.texture;pm.dispose();
  // soft studio lighting: key, emerald rim, cool fill
  sc.add(new THREE.HemisphereLight(0xdfffee,0x06110c,.35));
  const key=new THREE.DirectionalLight(0xffffff,1.15);key.position.set(4,7,5);sc.add(key);
  const rim=new THREE.PointLight(0x43e6a0,2.2,18);rim.position.set(-5,3,-4);sc.add(rim);
  const fill=new THREE.PointLight(0xbfd8ff,.6,20);fill.position.set(5,2,-3);sc.add(fill);
  // stage floor: soft radial pool of light + mint ring
  const ftex=canvasTex(512,512,(x,w,h)=>{const g=x.createRadialGradient(w/2,h/2,0,w/2,h/2,w/2);g.addColorStop(0,'rgba(34,58,46,.85)');g.addColorStop(.35,'rgba(16,25,21,.7)');g.addColorStop(1,'rgba(8,13,11,0)');x.fillStyle=g;x.fillRect(0,0,w,h)});ftex.encoding=THREE.sRGBEncoding;
  const floorM=new THREE.Mesh(new THREE.PlaneGeometry(16,16),new THREE.MeshBasicMaterial({map:ftex,transparent:true,depthWrite:false}));floorM.rotation.x=-Math.PI/2;floorM.renderOrder=-2;sc.add(floorM);
  const ring=new THREE.Mesh(new THREE.RingGeometry(2.85,2.88,120),new THREE.MeshBasicMaterial({color:0x43e6a0,transparent:true,opacity:.35,depthWrite:false}));ring.rotation.x=-Math.PI/2;ring.position.y=.006;sc.add(ring);
  const ring2=new THREE.Mesh(new THREE.RingGeometry(3.12,3.13,120),new THREE.MeshBasicMaterial({color:0xc7aa72,transparent:true,opacity:.18,depthWrite:false}));ring2.rotation.x=-Math.PI/2;ring2.position.y=.006;sc.add(ring2);
  // subtle drifting particles (kept from the original hero, fewer & dimmer)
  let pts=null,pa=null,N=RM?0:(low?110:220);if(N){const pg=new THREE.BufferGeometry();pa=new Float32Array(N*3);for(let i=0;i<N;i++){pa[i*3]=(Math.random()-.5)*18;pa[i*3+1]=Math.random()*7;pa[i*3+2]=(Math.random()-.5)*12}pg.setAttribute('position',new THREE.BufferAttribute(pa,3));pts=new THREE.Points(pg,new THREE.PointsMaterial({color:0x9ff0cc,size:.035,transparent:true,opacity:.45,depthWrite:false}));sc.add(pts)}
  const stage=new THREE.Group();sc.add(stage);
  let alive=1,raf=0,vis=true,clock=0,yaw=-.62,vel=0,hov=0,spin=0,last=-1e9,cur=null,tr=null,want=SHOW.sel,flash=0,wide=true,camX=0,camY=0;
  let dist=11;
  // place & size the car in the free area: right half on desktop, between the text and the controls on mobile
  const resize=()=>{const w=cv.clientWidth||innerWidth,h=cv.clientHeight||innerHeight;r.setSize(w,h,false);wide=w>860;cam.aspect=w/h;cam.fov=30;
    const T=2*Math.tan(cam.fov*Math.PI/360);let cx,cy,tw;
    if(wide){cx=w*.69;cy=h*.47;tw=Math.min(w*.44,h*.95)}
    else{const hr=hero.getBoundingClientRect(),hc=hero.querySelector('.hero-in').getBoundingClientRect(),sp=shw.getBoundingClientRect(),panel=shw.offsetParent!==null&&sp.height>0,top=hc.bottom-hr.top,bot=panel?sp.top-hr.top:h-Math.max(18,h*.03);cx=w/2;cy=top+(bot-top)*(panel?.55:.5);tw=panel?Math.min(w*.9,(bot-top)*2.1):Math.min(w*1.04,(bot-top)*2.7)}
    dist=5.0*.97/(tw/h*T);cam.setViewOffset(w,h,-(cx-w/2),-(cy-h/2),w,h);cam.updateProjectionMatrix();kick()};
  const ro=window.ResizeObserver?new ResizeObserver(resize):null;ro?ro.observe(cv):addEventListener('resize',resize);resize();
  // ----- interaction: mouse hover tilt, click-and-drag, touch drag (vertical swipes still scroll the page), arrow keys
  const P={id:null,x:0,t:0};
  const down=e=>{if(e.button>0)return;P.id=e.pointerId;P.x=e.clientX;P.t=performance.now();vel=0;last=P.t;try{cv.setPointerCapture(e.pointerId)}catch(_){}cv.classList.add('drag')};
  const move=e=>{if(P.id!==e.pointerId)return;const now=performance.now(),dx=e.clientX-P.x,d=dx*(coarse?.011:.0085);yaw+=d;const dt=Math.max((now-P.t)/1000,.008);vel=vel*.4+(d/dt)*.6;P.x=e.clientX;P.t=now;last=now;kick()};
  const up=e=>{if(P.id!==e.pointerId)return;P.id=null;cv.classList.remove('drag');if(performance.now()-P.t>90)vel=0;vel=Math.max(-7,Math.min(7,vel));last=performance.now()};
  const key2=e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();vel+=(e.key==='ArrowLeft'?-1:1)*2.2;last=performance.now();kick()}};
  cv.addEventListener('pointerdown',down);cv.addEventListener('pointermove',move);cv.addEventListener('pointerup',up);cv.addEventListener('pointercancel',up);cv.addEventListener('keydown',key2);
  shw.onclick=e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.car!==undefined)select(+b.dataset.car,1);else if(b.dataset.spd){setSpd(b.dataset.spd);last=-1e9;kick()}};
  // ----- car switching with a smooth scale/spin transition
  function show(h){if(cur===h)return;const from=cur;cur=h;h.rotation.y=0;h.position.y=0;stage.add(h);flash=1;
    if(RM||!from){if(from)stage.remove(from);h.scale.setScalar(1);tr=null}else{h.scale.setScalar(.001);tr={from,to:h,t:0,s:performance.now()}}kick()}
  function select(i,user){want=i;SHOW.sel=i;setUI(i);st('Loading '+SHOW.cars[i].short+'…','ld');hero.classList.remove('mfail');
    loadCar(i).then(h=>{if(!alive||want!==i)return;st('');show(h);if(user)last=performance.now()-1200}).catch(e=>{console.warn('[VELOCITY] 3D model failed to load:',SHOW.cars[i].name,e);if(alive&&want===i){st(SHOW.cars[i].short+' 3D model unavailable','err');if(!cur)hero.classList.add('mfail')}})}
  const E=t=>t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2,B=t=>{const c1=1.4,c3=c1+1;return 1+c3*Math.pow(t-1,3)+c1*Math.pow(t-1,2)},cl=v=>v<0?0:v>1?1:v;
  function loop(now){raf=0;if(!alive||!vis||document.hidden)return;const dt=clock?Math.min((now-clock)/1000,.05):.016;clock=now;
    const dragging=P.id!==null,idle=now-last>2200;
    if(!dragging){yaw+=vel*dt;vel*=Math.exp(-dt*3.2);if(Math.abs(vel)<.002)vel=0}
    spin+=((idle&&!dragging?SHOW.speeds[spd]:0)-spin)*Math.min(dt*2.2,1);yaw+=spin*dt;
    if(!coarse&&!RM){hov+=(M.x*.32-hov)*Math.min(dt*3,1);camX+=(-M.x*.55-camX)*Math.min(dt*2.5,1);camY+=(-M.y*.3-camY)*Math.min(dt*2.5,1)}
    stage.rotation.y=yaw+hov;
    if(tr){tr.t=(now-tr.s)/1050;const a=E(cl(tr.t/.42)),b=cl((tr.t-.32)/.68);tr.from.scale.setScalar(Math.max(1-a,.001));tr.from.position.y=-a*.25;tr.from.rotation.y+=dt*a*5;
      tr.to.scale.setScalar(Math.max(B(b),.001));tr.to.rotation.y=(1-E(b))*-1.6;if(tr.t>=1){stage.remove(tr.from);tr.from.scale.setScalar(1);tr.from.position.y=0;tr.from.rotation.y=0;tr.to.scale.setScalar(1);tr.to.rotation.y=0;tr=null}}
    flash=Math.max(flash-dt*1.4,0);ring.material.opacity=.3+flash*.5;ring.scale.setScalar(1+flash*.06);ring2.rotation.z+=dt*.05;
    if(pts){for(let i=0;i<N;i++){pa[i*3+1]-=dt*2.2;if(pa[i*3+1]<0)pa[i*3+1]=7}pts.geometry.attributes.position.needsUpdate=true}
    cam.position.set(camX*dist/10,dist*.17+camY*dist/10,dist);cam.lookAt(0,.62,0);
    r.render(sc,cam);raf=requestAnimationFrame(loop)}
  function kick(){if(alive&&vis&&!document.hidden&&!raf){clock=0;raf=requestAnimationFrame(loop)}}
  const io=new IntersectionObserver(es=>{vis=es[0].isIntersecting;kick()},{threshold:.01});io.observe(hero);
  const onVis=()=>kick();document.addEventListener('visibilitychange',onVis);
  select(SHOW.sel);
  // warm the cache for the other cars once the first one is on screen
  const warm=()=>SHOW.cars.forEach((c,i)=>{if(i!==SHOW.sel)setTimeout(()=>alive&&loadCar(i).catch(()=>{}),900+i*700)});
  if(shw.offsetParent!==null)(window.requestIdleCallback||setTimeout)(warm,{timeout:2500});
  stops.push(()=>{alive=0;cancelAnimationFrame(raf);io.disconnect();ro?ro.disconnect():removeEventListener('resize',resize);document.removeEventListener('visibilitychange',onVis);
    stage.children.slice().forEach(h=>{stage.remove(h);h.scale.setScalar(1);h.position.y=0;h.rotation.y=0});
    envRT.dispose();ftex.dispose();floorM.geometry.dispose();floorM.material.dispose();[ring,ring2].forEach(m=>{m.geometry.dispose();m.material.dispose()});if(pts){pts.geometry.dispose();pts.material.dispose()}
    r.dispose();try{r.forceContextLoss()}catch(_){}})}


function fail(e){console.warn('[Velocity] 3D showroom unavailable',e);var h=document.getElementById('hero');if(h)h.classList.add('nogl')}
function blobURL(b64,type){return URL.createObjectURL(new Blob([b64buf(b64)],{type:type}))}
function run(){try{if(!window.VEL_DRACO)throw new Error('decoder data missing');
  VA.dracoWasm=blobURL(window.VEL_DRACO,'application/wasm');heroScene()}catch(e){fail(e)}}
function start(){if(window.VEL_DRACO)return run();if(!cv0.dataset.pack)return fail(new Error('no decoder pack'));
  var s=document.createElement('script');s.src=cv0.dataset.pack;s.async=true;s.onload=run;s.onerror=function(){fail(new Error('decoder pack failed to load'))};document.head.appendChild(s)}
if(document.readyState==='complete')start();else addEventListener('load',start);
})();
