(function(){
  "use strict";
  var $=function(s,c){return (c||document).querySelector(s);};
  var $$=function(s,c){return Array.prototype.slice.call((c||document).querySelectorAll(s));};
  var esc=function(v){return String(v==null?"":v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;").replace(/'/g,"&#39;");};
  var money=function(v){if(v===null||v===undefined||String(v).trim()==="")return "Contact for price";var n=Number(String(v).replace(/[^0-9.-]/g,""));return Number.isFinite(n)?"$"+Math.round(n).toLocaleString("en-US"):"Contact for price";};
  var num=function(v){if(v===null||v===undefined||String(v).trim()==="")return null;var n=Number(String(v).replace(/[^0-9.-]/g,""));return Number.isFinite(n)?n:null;};
  var str=function(v){return v==null?"":String(v).trim();};
  var PLACEHOLDER="data:image/svg+xml;charset=UTF-8,"+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#171a34"/><stop offset="1" stop-color="#080a16"/></linearGradient></defs><rect width="800" height="600" fill="url(#g)"/><g fill="none" stroke="#ffb547" stroke-width="9" opacity=".8" stroke-linecap="round" stroke-linejoin="round"><path d="M125 380l45-86q12-24 42-24h238q32 0 53 23l66 74 38 13q22 7 22 29v31H118v-26q0-22 7-34z"/><path d="M215 282h230l50 69H175z"/><circle cx="230" cy="440" r="45"/><circle cx="555" cy="440" r="45"/></g><text x="400" y="530" text-anchor="middle" font-family="Arial,sans-serif" font-size="24" fill="#8f97b5" letter-spacing="3">VEHICLE PHOTO</text></svg>');
  function imageUrl(raw){var u=str(raw);if(!u)return PLACEHOLDER;if(/^https?:\/\//i.test(u)||/^data:image\//i.test(u)||u.charAt(0)==='/')return u;return u.replace(/^\.\//,'');}
  function titleV(v){return [str(v.year),str(v.make),str(v.model),str(v.trim)].filter(Boolean).join(" ")||str(v.title)||"Vehicle listing";}
  function bodyOf(v){return str(v.body||v.bodyStyle||v.type).toLowerCase();}
  function kindOf(v){var b=bodyOf(v),t=str(v.type).toLowerCase();if(/suv|crossover|sport utility/.test(b)||/suv/.test(t))return "SUV";if(/truck|pickup/.test(b)||/truck|pickup/.test(t))return "Truck";if(/wagon/.test(b)||/wagon/.test(t))return "Wagon";if(/sedan/.test(b)||/sedan/.test(t))return "Sedan";return "Car";}
  function card(v){var imgs=Array.isArray(v.images)?v.images:[],img=imgs[0];if(img&&typeof img==="object")img=img.url||img.src||img.path||"";var sold=str(v.status).toLowerCase()==="sold",km=num(v.mileage!==undefined?v.mileage:v.miles),detail="vehicle.html?id="+encodeURIComponent(str(v.id));var specs=[];if(km!==null)specs.push(Math.round(km).toLocaleString("en-US")+" mi");if(v.trans||v.transmission)specs.push(v.trans||v.transmission);if(v.drivetrain)specs.push(v.drivetrain);if(v.fuel)specs.push(v.fuel);if(v.body)specs.push(v.body);
    return '<a class="apx-vehicle-card" href="'+esc(detail)+'"><div class="apx-card-media"><img src="'+esc(imageUrl(img))+'" alt="'+esc(titleV(v))+'" loading="lazy" onerror="this.onerror=null;this.src=\''+PLACEHOLDER+'\'"><span class="apx-card-badge '+(sold?'sold':'live')+'">'+(sold?'Sold':'Available')+'</span></div><div class="apx-card-body"><div><div class="apx-card-meta">'+esc([v.year,kindOf(v)].filter(Boolean).join(' · '))+'</div><h3>'+esc(titleV(v))+'</h3></div><div class="apx-spec-row">'+specs.slice(0,3).map(function(x){return '<span class="apx-spec">'+esc(x)+'</span>';}).join('')+'</div><div class="apx-card-foot"><strong class="apx-price">'+esc(money(v.price))+'</strong><span class="apx-card-go" aria-hidden="true">↗</span></div></div></a>';
  }
  function loadInventory(){return fetch('inventory.json',{cache:'no-store',credentials:'same-origin'}).then(function(r){if(!r.ok)throw new Error('Inventory unavailable');return r.json();}).then(function(d){return {vehicles:Array.isArray(d.vehicles)?d.vehicles.filter(function(v){return v&&typeof v==='object'&&str(v.status).toLowerCase()!=='draft';}):[],posts:Array.isArray(d.posts)?d.posts:[]};});}
  function matchesCategory(v,category){var k=kindOf(v),b=bodyOf(v);if(category==='all')return true;if(category==='cars')return k!=='SUV'&&k!=='Truck'&&k!=='Wagon';if(category==='sedans')return k==='Sedan'||/sedan/.test(b);if(category==='suvs')return k==='SUV';if(category==='trucks')return k==='Truck';if(category==='wagons')return k==='Wagon';return true;}
  function filterVehicles(vehicles, category, params){var q=str(params.get('q')).toLowerCase(),type=str(params.get('type')).toLowerCase(),make=str(params.get('make')).toLowerCase(),body=str(params.get('body')).toLowerCase(),fuel=str(params.get('fuel')).toLowerCase(),drive=str(params.get('drivetrain')||params.get('drive')).toLowerCase(),max=num(params.get('max')),feature=str(params.get('feature')).toLowerCase();return vehicles.filter(function(v){var title=titleV(v).toLowerCase(),k=kindOf(v).toLowerCase(),b=bodyOf(v),p=num(v.price);if(!matchesCategory(v,category))return false;if(q&&title.indexOf(q)<0)return false;if(type&&k!==type&&str(v.type).toLowerCase()!==type&&b.indexOf(type)<0)return false;if(make&&str(v.make).toLowerCase()!==make)return false;if(body&&b.indexOf(body)<0&&str(v.bodyStyle).toLowerCase().indexOf(body)<0)return false;if(fuel&&str(v.fuel).toLowerCase().replace(/[ /]/g,'-').indexOf(fuel)<0)return false;if(drive&&str(v.drivetrain).toLowerCase().replace(/[^a-z0-9]/g,'').indexOf(drive.replace(/[^a-z0-9]/g,''))<0)return false;if(max!==null&&(p===null||p>max))return false;if(feature==='luxury'&&!/luxury|premium/i.test([v.make,v.model,v.trim,(v.features||[]).join(' ')].join(' ')))return false;return true;});}
  function sortVehicles(list,sort){var copy=list.slice();if(sort==='price-asc')copy.sort(function(a,b){return (num(a.price)??Infinity)-(num(b.price)??Infinity);});else if(sort==='price-desc')copy.sort(function(a,b){return (num(b.price)??-Infinity)-(num(a.price)??-Infinity);});else if(sort==='year-desc')copy.sort(function(a,b){return (num(b.year)||0)-(num(a.year)||0);});else if(sort==='mileage-asc')copy.sort(function(a,b){return (num(a.mileage)||0)-(num(b.mileage)||0);});else copy.sort(function(a,b){return Number(!!b.featured)-Number(!!a.featured)||(num(b.year)||0)-(num(a.year)||0);});return copy;}
  function bootNav(){var header=$('#apxHeader'),toggle=$('.apx-menu-toggle'),nav=$('#apxNav');if(toggle&&nav){toggle.addEventListener('click',function(){var open=nav.classList.toggle('apx-open');toggle.setAttribute('aria-expanded',open?'true':'false');toggle.setAttribute('aria-label',open?'Close navigation':'Open navigation');toggle.textContent=open?'✕':'☰';});nav.addEventListener('click',function(e){if(e.target.closest('a')&&!e.target.closest('.apx-nav-group .apx-dropdown')){nav.classList.remove('apx-open');toggle.setAttribute('aria-expanded','false');toggle.textContent='☰';}});}var page=document.body.getAttribute('data-page')||'';var map={inventory:'inventory',cars:'cars',sedans:'cars',trucks:'trucks',suvs:'suvs',wagons:'cars',about:'about',contact:'contact',blog:'blog','blog-post':'blog',pages:'pages',vehicle:'inventory'};$$('.apx-nav [data-nav]').forEach(function(a){a.classList.toggle('is-active',a.getAttribute('data-nav')===map[page]);});window.addEventListener('scroll',function(){if(header)header.classList.toggle('apx-scrolled',window.scrollY>10);var prog=$('.apx-nav-progress i');if(prog){var max=document.documentElement.scrollHeight-window.innerHeight;prog.style.width=(max>0?Math.min(100,window.scrollY/max*100):0)+'%';}},{passive:true});}

  var apxMotionObserver = null;
  var apxReducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  function bootApexPageMotion(root){
    var scope=root||document;
    var selectors=[
      '.apx-hero .apx-eyebrow',
      '.apx-hero .apx-title',
      '.apx-hero .apx-lead',
      '.apx-hero .apx-actions',
      '.apx-section-head',
      '.apx-panel',
      '.apx-feature',
      '.apx-directory-group',
      '.apx-toolbar',
      '.apx-results-head',
      '.apx-detail-title',
      '.apx-detail-price',
      '.apx-spec-grid',
      '.apx-gallery-main',
      '.apx-blog-body',
      '.apx-post-body'
    ].join(',');
    var targets=$$(selectors,scope);
    if(scope===document){
      if(apxReducedMotion){targets.forEach(function(el){el.classList.add('apx-motion-in');});return;}
      if('IntersectionObserver' in window&&!apxMotionObserver){
        apxMotionObserver=new IntersectionObserver(function(entries){entries.forEach(function(entry){if(entry.isIntersecting){entry.target.classList.add('apx-motion-in');apxMotionObserver.unobserve(entry.target);}});},{threshold:.14,rootMargin:'0px 0px -4% 0px'});
      }
    }
    if(apxReducedMotion){targets.forEach(function(el){el.classList.add('apx-motion-in');});return;}
    targets.forEach(function(el){
      if(el.dataset.apxMotionBound==='1')return;
      el.dataset.apxMotionBound='1';
      el.classList.add('apx-motion-item');
      var delay='0s';
      if(el.matches('.apx-hero .apx-title,.apx-detail-title'))delay='.10s';
      else if(el.matches('.apx-hero .apx-lead'))delay='.22s';
      else if(el.matches('.apx-hero .apx-actions'))delay='.34s';
      else if(el.matches('.apx-section-head'))delay='.08s';
      el.style.setProperty('--apx-motion-delay',delay);
      if(apxMotionObserver){apxMotionObserver.observe(el);}else{el.classList.add('apx-motion-in');}
    });
    if(apxMotionObserver&&document.body&&!document.body.classList.contains('apx-motion-ready'))document.body.classList.add('apx-motion-ready');
  }
  function bootApexCardEffects(root){
    var scope=root||document;
    var cards=$$('.apx-vehicle-card, .apx-blog-card, .apx-feature',scope);
    var hoverTilt=!!(window.matchMedia&&window.matchMedia('(hover: hover) and (pointer: fine)').matches);
    cards.forEach(function(card,index){
      if(card.dataset.apxCardMotion!=='1'){
        card.dataset.apxCardMotion='1';
        card.classList.add('apx-motion-card');
        card.style.setProperty('--apx-card-delay',Math.min(index,8)*.075+'s');
        card.addEventListener('animationend',function(ev){if(ev.animationName==='apx-card-arrive'){card.classList.remove('apx-motion-card');card.style.removeProperty('--apx-card-delay');}},{once:true});
      }
      if(!hoverTilt||card.dataset.apxTiltBound==='1'||!card.classList.contains('apx-vehicle-card'))return;
      card.dataset.apxTiltBound='1';
      card.addEventListener('pointermove',function(e){
        if(e.pointerType==='touch')return;
        var r=card.getBoundingClientRect();if(!r.width||!r.height)return;
        var x=(e.clientX-r.left)/r.width,y=(e.clientY-r.top)/r.height;
        card.style.setProperty('--apx-ry',((x-.5)*8).toFixed(2)+'deg');
        card.style.setProperty('--apx-rx',((.5-y)*6).toFixed(2)+'deg');
        card.style.setProperty('--apx-gx',(x*100).toFixed(1)+'%');
        card.style.setProperty('--apx-gy',(y*100).toFixed(1)+'%');
      });
      card.addEventListener('pointerleave',function(){card.style.setProperty('--apx-rx','0deg');card.style.setProperty('--apx-ry','0deg');});
    });
  }

  function renderCatalog(data){
    var root=$('[data-apx-kind="catalog"]');if(!root)return;
    var category=root.getAttribute('data-category')||'all',params=new URLSearchParams(location.search),search=$('#apxQuery'),type=$('#apxType'),make=$('#apxMake'),sort=$('#apxSort'),grid=$('#apxVehicleGrid'),count=$('#apxCount'),status=$('#apxResultsStatus');
    var PAGE_SIZE=15;
    var pageFromUrl=parseInt(params.get('page')||'1',10);var currentPage=Number.isFinite(pageFromUrl)&&pageFromUrl>0?pageFromUrl:1;
    var makes=Array.from(new Set(data.vehicles.map(function(v){return str(v.make);}).filter(Boolean))).sort();
    if(make){makes.forEach(function(m){var op=document.createElement('option');op.value=m;op.textContent=m;make.appendChild(op);});}
    if(search)search.value=params.get('q')||'';if(type)type.value=params.get('type')||'';if(make)make.value=params.get('make')||'';if(sort)sort.value=params.get('sort')||'featured';
    var pagination=$('#apxPagination');
    if(grid&&!pagination){pagination=document.createElement('nav');pagination.id='apxPagination';pagination.className='apx-pagination';pagination.setAttribute('aria-label','Inventory pages');pagination.hidden=true;grid.insertAdjacentElement('afterend',pagination);}
    function makeQuery(includePage){
      var q=new URLSearchParams(location.search);
      if(search&&search.value.trim())q.set('q',search.value.trim());else q.delete('q');
      if(type&&type.value)q.set('type',type.value);else q.delete('type');
      if(make&&make.value)q.set('make',make.value);else q.delete('make');
      if(sort&&sort.value!=='featured')q.set('sort',sort.value);else q.delete('sort');
      if(includePage&&currentPage>1)q.set('page',String(currentPage));else q.delete('page');
      return q;
    }
    function syncUrl(){var q=makeQuery(true);history.replaceState(null,'',location.pathname+(q.toString()?'?'+q.toString():''));}
    function draw(resetToFirst){
      if(resetToFirst)currentPage=1;
      var q=makeQuery(false);
      var all=filterVehicles(data.vehicles,category,q);all=sortVehicles(all,sort?sort.value:'featured');
      var totalPages=Math.max(1,Math.ceil(all.length/PAGE_SIZE));
      if(currentPage>totalPages)currentPage=totalPages;
      if(currentPage<1)currentPage=1;
      var from=(currentPage-1)*PAGE_SIZE,to=Math.min(from+PAGE_SIZE,all.length),visible=all.slice(from,to);
      if(grid)grid.innerHTML=visible.length?visible.map(card).join(''):'<div class="apx-empty"><h3>No vehicles match these filters yet.</h3><p>Try another search or browse the full inventory.</p><a class="apx-btn" href="inventory.html">View all inventory →</a></div>';
      if(grid){bootApexPageMotion(grid);bootApexCardEffects(grid);}
      if(count)count.textContent=String(all.length);
      if(status)status.textContent=all.length+' vehicle'+(all.length===1?'':'s')+' found';
      if(pagination){
        if(all.length>PAGE_SIZE){
          var buttons='';
          buttons+='<button type="button" class="apx-page-btn apx-page-prev" data-page="'+Math.max(1,currentPage-1)+'"'+(currentPage===1?' disabled':'')+' aria-label="Previous page">‹ <span>Previous</span></button>';
          var pageStart=Math.max(1,Math.min(currentPage-2,totalPages-4)),pageEnd=Math.min(totalPages,pageStart+4);
          for(var p=pageStart;p<=pageEnd;p++)buttons+='<button type="button" class="apx-page-btn'+(p===currentPage?' is-current':'')+'" data-page="'+p+'"'+(p===currentPage?' aria-current="page"':'')+' aria-label="Page '+p+'">'+p+'</button>';
          if(pageEnd<totalPages)buttons+='<span class="apx-page-ellipsis" aria-hidden="true">…</span><button type="button" class="apx-page-btn" data-page="'+totalPages+'" aria-label="Page '+totalPages+'">'+totalPages+'</button>';
          buttons+='<button type="button" class="apx-page-btn apx-page-next" data-page="'+Math.min(totalPages,currentPage+1)+'"'+(currentPage===totalPages?' disabled':'')+' aria-label="Next page"><span>Next</span> ›</button>';
          pagination.innerHTML='<div class="apx-pagination-summary">Showing <strong>'+String(from+1)+'–'+String(to)+'</strong> of <strong>'+String(all.length)+'</strong> vehicles</div><div class="apx-pagination-controls">'+buttons+'</div>';
          pagination.hidden=false;
        }else{pagination.innerHTML='';pagination.hidden=true;}
      }
      syncUrl();
    }
    var form=$('#apxFilterForm');if(form)form.addEventListener('submit',function(e){e.preventDefault();draw(true);});
    var reset=$('#apxResetFilters');if(reset)reset.addEventListener('click',function(){if(search)search.value='';if(type)type.value='';if(make)make.value='';if(sort)sort.value='featured';draw(true);});
    if(search)search.addEventListener('input',function(){draw(true);});
    if(type)type.addEventListener('change',function(){draw(true);});
    if(make)make.addEventListener('change',function(){draw(true);});
    if(sort)sort.addEventListener('change',function(){draw(true);});
    if(pagination)pagination.addEventListener('click',function(e){var btn=e.target.closest('button[data-page]');if(!btn||btn.disabled)return;var next=parseInt(btn.getAttribute('data-page'),10);if(!Number.isFinite(next)||next<1)return;currentPage=next;draw(false);var y=grid?grid.getBoundingClientRect().top+window.pageYOffset-100:0;window.scrollTo({top:Math.max(0,y),behavior:window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});});
    draw(false);
  }
  /* Vehicle specifications: shows every filled-in field from the dashboard. Known fields come first in a sensible order, any extra fields added later are picked up automatically. */
  function vdSpecList(v){
    var S=function(x){return x==null?'':String(x).trim();};
    var N=function(x){var n=Number(String(x==null?'':x).replace(/[^0-9.\-]/g,''));return String(x==null?'':x).trim()!==''&&isFinite(n)?n:null;};
    var known=[
      ['Year',['year']],['Make',['make']],['Model',['model']],['Trim',['trim']],
      ['Mileage',['mileage','miles'],function(x){var n=N(x);return n!==null?n.toLocaleString('en-US')+' mi':S(x);}],
      ['Condition',['condition']],['Body Style',['body','bodyStyle','body_style']],['Vehicle Type',['type']],
      ['Exterior Color',['ext','exterior','exteriorColor','exterior_color','color']],['Interior Color',['int','interior','interiorColor','interior_color']],
      ['Drivetrain',['drivetrain','drive']],['Transmission',['trans','transmission']],['Engine',['engine']],['Cylinders',['cylinders']],
      ['Horsepower',['hp','horsepower'],function(x){var n=N(x);return n!==null&&/^\s*[0-9.,]+\s*$/.test(String(x))?n+' hp':S(x);}],
      ['Torque',['torque']],['Fuel Type',['fuel','fuelType','fuel_type']],['Fuel Economy',['mpg']],['Fuel Tank',['tank']],
      ['Doors',['doors']],['Seats',['seats','seating']],['Owners',['owners']],['Accidents',['accidents']],['Title',['titleStatus','title_status']],
      ['Stock #',['stock','stockNumber','stock_number']],['VIN',['vin']]
    ];
    var skip={id:1,slug:1,title:1,name:1,price:1,status:1,featured:1,images:1,img:1,image:1,photos:1,gallery:1,description:1,desc:1,features:1,feat:1,safety:1,metaTitle:1,metaDescription:1,seed:1,deal:1,loc:1,dataset:1,left:1,replace:1,created:1,updated:1,created_at:1,updated_at:1,createdAt:1,updatedAt:1,sort:1,order:1,position:1,url:1,link:1,video:1,dealer:1,dealer_id:1,dealerId:1,thumbnail:1,thumb:1,msrp:1,sale_price:1,salePrice:1,oldPrice:1,old_price:1,draft:1,visible:1,hidden:1,published:1};
    var used={},out=[];
    known.forEach(function(k){for(var i=0;i<k[1].length;i++){var key=k[1][i];if(Object.prototype.hasOwnProperty.call(v,key))used[key]=1;}for(var j=0;j<k[1].length;j++){var val=v[k[1][j]];if(val!=null&&typeof val!=='object'&&S(val)!==''){out.push([k[0],k[2]?k[2](val):S(val)]);return;}}});
    var human=function(k){return k.replace(/[_-]+/g,' ').replace(/([a-z0-9])([A-Z])/g,'$1 $2').replace(/\s+/g,' ').trim().replace(/\b\w/g,function(c){return c.toUpperCase();});};
    var addObj=function(o){if(!o)return;if(Array.isArray(o)){o.forEach(function(x){if(x&&typeof x==='object'){var l=S(x.label||x.name||x.key),val=S(x.value!=null?x.value:x.val);if(l&&val)out.push([l,val]);}});return;}if(typeof o==='object')Object.keys(o).forEach(function(k){var val=o[k];if(val!=null&&typeof val!=='object'&&S(val)!=='')out.push([human(k),typeof val==='boolean'?(val?'Yes':'No'):S(val)]);});};
    Object.keys(v||{}).forEach(function(k){if(used[k]||skip[k])return;var val=v[k];if(val==null)return;if(typeof val==='object'){if(/^(specs|specifications|details|attributes|extra|extras|fields|custom|customFields|custom_fields)$/i.test(k))addObj(val);return;}if(S(val)==='')return;out.push([human(k),typeof val==='boolean'?(val?'Yes':'No'):S(val)]);});
    return out;
  }
  function vdFeatureList(v){var a=[];['features','feat','safety','options','equipment'].forEach(function(k){var x=v&&v[k];if(Array.isArray(x))x.forEach(function(f){f=typeof f==='object'&&f?(f.label||f.name||''):f;f=String(f==null?'':f).trim();if(f&&a.indexOf(f)<0)a.push(f);});else if(typeof x==='string'&&x.trim())x.split(/\s*[,;\n]\s*/).forEach(function(f){if(f&&a.indexOf(f)<0)a.push(f);});});return a;}
  function renderVehicle(data){var root=$('[data-apx-kind="vehicle"]');if(!root)return;var id=new URLSearchParams(location.search).get('id')||'',v=data.vehicles.find(function(x){return str(x.id)===id||str(x.slug)===id;});var box=$('#apxVehicleContent');if(!v){box.innerHTML='<div class="apx-empty"><h3>Vehicle not found</h3><p>This listing may no longer be available.</p><a class="apx-btn" href="inventory.html">Browse inventory →</a></div>';return;}
    document.title=titleV(v)+' | '+(window.SITE&&window.SITE.name||'Vehicle inventory');var imgs=Array.isArray(v.images)?v.images.map(function(x){return typeof x==='object'?(x.url||x.src||x.path||''):x;}).filter(Boolean):[];if(!imgs.length)imgs=[''];var spec=vdSpecList(v).map(function(x){var wide=String(x[1]).length>16;return '<div class="apx-spec-item'+(wide?' is-wide':'')+'"><span>'+esc(x[0])+'</span><b>'+esc(x[1])+'</b></div>';}).join('');var feats=vdFeatureList(v);
    var descriptionMarkup='<section class="apx-panel apx-vehicle-description"><div class="apx-description-heading"><p class="apx-section-kicker">THE DETAILS</p><h2>Vehicle description</h2><span class="apx-description-rule" aria-hidden="true"></span></div><div class="apx-editorial-copy">'+(str(v.description)?str(v.description).split(/\n\s*\n/).map(function(x){return '<p>'+esc(x)+'</p>';}).join(''):'<p>Contact the team for more details about this vehicle, its history, and current availability.</p>')+'</div></section>';
    box.innerHTML='<div class="apx-vehicle-detail apx-vehicle-detail-layout"><div class="apx-vehicle-gallery-column"><div class="apx-gallery-main apx-vehicle-frame"><img id="apxMainVehicleImage" src="'+esc(imageUrl(imgs[0]))+'" alt="'+esc(titleV(v))+'" onerror="this.onerror=null;this.src=\''+PLACEHOLDER+'\'"></div><div class="apx-gallery-thumbs" aria-label="Vehicle photos">'+imgs.map(function(im,i){return '<button class="apx-vehicle-thumb" type="button" data-gallery-index="'+i+'" aria-pressed="'+(!i)+'" aria-label="View photo '+(i+1)+'"><img src="'+esc(imageUrl(im))+'" alt="" loading="lazy" onerror="this.onerror=null;this.src=\''+PLACEHOLDER+'\'"></button>';}).join('')+'</div>'+descriptionMarkup+(feats.length?'<section class="apx-panel apx-vehicle-features"><div class="apx-description-heading"><p class="apx-section-kicker">EQUIPMENT</p><h2>Features &amp; options</h2><span class="apx-description-rule" aria-hidden="true"></span></div><ul class="apx-feature-list">'+feats.map(function(f){return '<li>'+esc(f)+'</li>';}).join('')+'</ul></section>':'')+'</div><div class="apx-vehicle-info-column"><div class="apx-vehicle-info-card"><div class="apx-breadcrumbs"><a href="index.html">Home</a> / <a href="inventory.html">Inventory</a> / Vehicle details</div><p class="apx-eyebrow apx-listing-state">'+esc(str(v.status).toLowerCase()==='sold'?'Sold listing':'Current listing')+'</p><h1 class="apx-detail-title">'+esc(titleV(v))+'</h1><p class="apx-card-meta apx-vehicle-identifiers">'+esc([v.stock?'STOCK '+v.stock:'',v.vin?'VIN '+v.vin:''].filter(Boolean).join(' · '))+'</p><div class="apx-vehicle-price-row"><div><span class="apx-price-label">Listed price</span><div class="apx-detail-price">'+esc(money(v.price))+'</div></div><span class="apx-availability-pill '+(str(v.status).toLowerCase()==='sold'?'is-sold':'is-available')+'"><i></i>'+esc(str(v.status).toLowerCase()==='sold'?'Sold':'Available')+'</span></div><p class="apx-spec-heading">Vehicle specifications</p><div class="apx-spec-grid apx-spec-grid-4">'+spec+'</div><div class="apx-actions apx-vehicle-actions"><a class="apx-btn" href="#apxVehicleInquiry">Ask about this vehicle <span aria-hidden="true">↗</span></a><a class="apx-btn ghost" href="inventory.html">Back to inventory</a></div></div><form class="apx-panel apx-inquiry-panel" id="apxVehicleInquiry" data-apx-lead-form data-vehicle-id="'+esc(v.id)+'"><p class="apx-section-kicker">NEXT STEP</p><h2>Interested in this vehicle?</h2><p class="apx-muted">Send a message to '+esc((window.SITE&&window.SITE.name)||'the dealership')+' and ask about availability or arrange a visit.</p><div class="apx-form-grid"><div class="apx-form-field"><label for="apxName">Your name *</label><input class="apx-input" id="apxName" name="name" autocomplete="name" required maxlength="120"></div><div class="apx-form-field"><label for="apxEmail">Email</label><input class="apx-input" id="apxEmail" name="email" type="email" autocomplete="email" maxlength="160"></div><div class="apx-form-field"><label for="apxPhone">Phone</label><input class="apx-input" id="apxPhone" name="phone" autocomplete="tel" maxlength="40"></div><div class="apx-form-field full"><label for="apxMessage">Message *</label><textarea class="apx-textarea" id="apxMessage" name="message" required maxlength="4000">I am interested in the '+esc(titleV(v))+'. Please contact me with more information.</textarea></div><div class="apx-honeypot" aria-hidden="true"><label>Leave this field empty<input name="_honey" tabindex="-1" autocomplete="off"></label></div></div><button class="apx-btn apx-form-submit" type="submit">Send inquiry <span aria-hidden="true">→</span></button><p class="apx-form-status" aria-live="polite"></p></form></div></div>';
    $$('#apxVehicleContent [data-gallery-index]').forEach(function(btn){btn.addEventListener('click',function(){var i=Number(btn.getAttribute('data-gallery-index')),mainImage=$('#apxMainVehicleImage'),counter=$('#apxPhotoCounter');if(!mainImage||!Number.isFinite(i))return;mainImage.classList.add('is-changing');var nextSrc=imageUrl(imgs[i]||'');window.setTimeout(function(){mainImage.onload=function(){mainImage.classList.remove('is-changing');mainImage.classList.add('is-settled');};mainImage.src=nextSrc;if(mainImage.complete)mainImage.classList.remove('is-changing');},110);if(counter)counter.textContent=String(i+1).padStart(2,'0')+' / '+String(imgs.length).padStart(2,'0');$$('#apxVehicleContent [data-gallery-index]').forEach(function(b){b.setAttribute('aria-pressed',b===btn?'true':'false');});});});
    bootApexPageMotion(box);bootApexCardEffects(box);
  }
  function renderBlog(data){var root=$('[data-apx-kind="blog"]');if(!root)return;var posts=data.posts.filter(function(p){return p&&str(p.title)&&p.status!=='draft';});var grid=$('#apxBlogGrid');if(!grid)return;if(!posts.length){grid.innerHTML='<div class="apx-empty"><h3>Articles will appear here</h3><p>When articles are published in the existing admin panel, they will show here automatically.</p></div>';return;}grid.innerHTML=posts.slice().sort(function(a,b){return str(b.date).localeCompare(str(a.date));}).map(function(p){return '<a class="apx-blog-card" href="blog-post.html?id='+encodeURIComponent(str(p.id))+'"><div class="apx-blog-image"><img src="'+esc(imageUrl(p.image))+'" alt="'+esc(p.title)+'" loading="lazy" onerror="this.onerror=null;this.src=\''+PLACEHOLDER+'\'"></div><div class="apx-blog-body"><span class="apx-blog-meta">'+esc(p.tag||'Guide')+(p.date?' · '+esc(p.date):'')+'</span><h2>'+esc(p.title)+'</h2><p>'+esc(p.excerpt||'Read the latest article from '+((window.SITE&&window.SITE.name)||'the dealership')+'.')+'</p><span class="apx-readmore">Read article ↗</span></div></a>';}).join('');bootApexPageMotion(grid);bootApexCardEffects(grid);}
  function renderBlogPost(data){var root=$('[data-apx-kind="blog-post"]');if(!root)return;var id=new URLSearchParams(location.search).get('id')||'';var p=data.posts.find(function(x){return str(x.id)===id;});var box=$('#apxBlogPostContent');if(!p){box.innerHTML='<div class="apx-empty"><h3>Article not found</h3><p>This article may have been removed or unpublished.</p><a class="apx-btn" href="blog.html">Back to blog →</a></div>';return;}document.title=(p.metaTitle||p.title)+' | '+((window.SITE&&window.SITE.name)||'');var articleHeroTitle=$('#apxDynamicHeroTitle'),articleHeroText=$('#apxDynamicHeroText'),articleHeroEyebrow=$('#apxDynamicHeroEyebrow');if(articleHeroTitle)articleHeroTitle.textContent=p.title;if(articleHeroText)articleHeroText.textContent=str(p.excerpt)||'Read this published article and explore the dealership\'s latest information.';if(articleHeroEyebrow)articleHeroEyebrow.textContent=str(p.tag||'FROM THE DEALERSHIP').toUpperCase();var content=str(p.content).split(/\n\s*\n/).filter(Boolean).map(function(p){return '<p>'+esc(p)+'</p>';}).join('');box.innerHTML='<div class="apx-breadcrumbs"><a href="./">Home</a> / <a href="blog.html">Blog</a> / Article</div><article class="apx-two-col"><div><p class="apx-eyebrow">'+esc(p.tag||'Dealership guide')+(p.date?' · '+esc(p.date):'')+'</p><h1 class="apx-title" style="font-size:clamp(2.4rem,5vw,4.8rem);max-width:18ch">'+esc(p.title)+'</h1><p class="apx-lead">'+esc(p.excerpt||'')+'</p>'+(p.image?'<div class="apx-gallery-main" style="margin:28px 0"><img src="'+esc(imageUrl(p.image))+'" alt="'+esc(p.title)+'" onerror="this.onerror=null;this.src=\''+PLACEHOLDER+'\'"></div>':'')+'<div class="apx-post-body">'+content+'</div><a class="apx-btn" href="inventory.html">Explore inventory →</a></div><aside class="apx-panel"><p class="apx-eyebrow">Continue your search</p><h2>Find a vehicle that fits your next journey.</h2><p class="apx-muted">Browse the live inventory or contact the dealership with a question.</p><div class="apx-actions"><a class="apx-btn" href="inventory.html">Browse inventory</a><a class="apx-btn ghost" href="contact-us.html">Contact us</a></div></aside></article>';bootApexPageMotion(box);bootApexCardEffects(box);}  function bootLeadForms(){document.addEventListener('submit',function(e){var form=e.target.closest('[data-apx-lead-form]');if(!form)return;e.preventDefault();var d=new FormData(form),honeypot=str(d.get('_honey'));if(honeypot)return;var name=str(d.get('name')),email=str(d.get('email')),phone=str(d.get('phone')),message=str(d.get('message'));var status=$('.apx-form-status',form),btn=$('button[type="submit"]',form);if(!name||(!email&&!phone)||!message){if(status)status.textContent='Please enter your name, a phone number or email, and a message.';return;}if(btn){btn.disabled=true;btn.style.opacity='.6';}if(status)status.textContent='Sending your message…';fetch('api/lead.php',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name,email:email,phone:phone,topic:form.getAttribute('data-vehicle-id')?'Vehicle inquiry: '+((document.querySelector('.apx-detail-title')||{}).textContent||'vehicle'):(str(d.get('topic'))||'Website inquiry'),message:message,page:location.href,vehicleId:form.getAttribute('data-vehicle-id')||'',_honey:''})}).then(function(r){return r.json().then(function(j){return {ok:r.ok&&!!j.ok,data:j};});}).then(function(res){if(res.ok){form.reset();if(status)status.textContent='Thank you. Your inquiry has been sent to the dealership.';}else{if(status)status.textContent='Your message could not be submitted. Please try again or contact the dealership directly.';}}).catch(function(){if(status)status.textContent='Connection issue. Please try again or contact the dealership directly.';}).finally(function(){if(btn){btn.disabled=false;btn.style.opacity='';}});});}
  function init(){bootNav();bootLeadForms();bootApexPageMotion(document);bootApexCardEffects(document);var kind=document.body.getAttribute('data-apx-kind')||'',heroCount=$('#apxHeroCount');if(!kind&&!heroCount)return;loadInventory().then(function(data){if(heroCount)heroCount.textContent=String(data.vehicles.length);if(kind==='catalog')renderCatalog(data);else if(kind==='vehicle')renderVehicle(data);else if(kind==='blog')renderBlog(data);else if(kind==='blog-post')renderBlogPost(data);}).catch(function(){var place=$('#apxVehicleGrid')||$('#apxVehicleContent')||$('#apxBlogGrid')||$('#apxBlogPostContent');if(place)place.innerHTML='<div class="apx-empty"><h3>Content could not be loaded</h3><p>Please refresh the page. If the problem continues, contact the dealership.</p></div>';if(heroCount)heroCount.textContent='—';});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
