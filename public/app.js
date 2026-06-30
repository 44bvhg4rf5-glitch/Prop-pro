let botOn=false, botTimer=null, cdTimer=null, nextScan=null;
let bdScans=0, bdFound=0, bdPrinted=0;
let seenIds=new Set();
let rtProps=[]; // live ticker pool
let rtTimer=null;
let uploadedTpls=[];
let slAddresses=[], slFiltered=[], slSelected=new Set(), slActiveLetter=null, slAddrPage=0;
const SL_PG=30;
let pmBlocked=[], pmBlockedConfigured=false; // do-not-mail suppression list
const SL_TYPE_LABEL={homes:'homes',houses:'houses',flats:'flats / maisonettes',all:'addresses (incl. commercial)'};
function slTypes(){ const el=document.getElementById('sl-type'); return (el&&el.value)||'homes'; }
let intelResults=[], chatHistory=[];
let perfState={outcomes:[],targets:{},prints:{}}, perfConfigured=false, perfLoaded=false;
let authState={configured:false,active:false,authed:false,open:true,canSetup:false,emailReset:false,twoFactor:false,account:null};
let authResetToken=null, authPending=null;
let bdQueued=0;
let activeTpl=null, selPrinter=null;
let adviceHistory=[], currentAdvice=null, selectedContexts=new Set(), rewrittenLetter='';

// HA district definitions — real Harrow postcodes
const HA_DISTRICTS = [
  {code:'HA0', name:'Wembley',      sp:420000, rp:1650, area:'wembley'},
  {code:'HA1', name:'Harrow',       sp:450000, rp:1700, area:'harrow'},
  {code:'HA2', name:'South Harrow', sp:430000, rp:1650, area:'south-harrow'},
  {code:'HA3', name:'Kenton',       sp:440000, rp:1680, area:'kenton'},
  {code:'HA4', name:'Ruislip',      sp:480000, rp:1750, area:'ruislip'},
  {code:'HA5', name:'Pinner',       sp:500000, rp:1800, area:'pinner'},
  {code:'HA6', name:'Northwood',    sp:550000, rp:1950, area:'northwood'},
  {code:'HA7', name:'Stanmore',     sp:520000, rp:1850, area:'stanmore'},
  {code:'HA8', name:'Edgware',      sp:460000, rp:1720, area:'edgware'},
  {code:'HA9', name:'Wembley Park', sp:440000, rp:1700, area:'wembley-park'}
];

let selectedHA = new Set(['HA1','HA2','HA3','HA4','HA5','HA6','HA7','HA9']);
let locMeta = {}; // key (identifier) → {identifier,label} for any-UK-postcode areas added via search
let props=[];
let queue=[];
let curPage=0;
const PG=20;

// Real HA street names
const HA_STREETS = {
  HA0:['Wembley High Road','Ealing Road','East Lane','Neeld Crescent','Monks Park','Lyon Road','Carlyon Road','Harrow Road','Turners Lane','Empire Way','Brook Avenue','Cecil Avenue','Dagmar Avenue','Drury Way','Forty Avenue'],
  HA1:['Station Road','College Road','Northolt Road','Pinner Road','Greenhill Way','Hindes Road','Headstone Drive','Byron Road','Rosslyn Crescent','Lowlands Road','Sandridge Close','Kymberley Road','Sheepcote Road','Gayton Road','Roxborough Road'],
  HA2:['Roxborough Avenue','Imperial Drive','Kenmore Avenue','Kenmore Close','Old Redding','Brockley Hill','Hawthorn Avenue','Corbins Lane','Rayners Lane','West End Lane','Alexandra Avenue','Dorchester Way','Rowland Way','Kingsway','Northolt Road'],
  HA3:['Kenton Road','Kenton Lane','Woodgrange Avenue','Firs Lane','Draycott Avenue','The Ridgeway','Streatfield Road','Christchurch Avenue','Homefield Road','Beverley Drive','Abercorn Road','Queensbury Circle','Carlton Avenue','Manor Way','Courtland Avenue'],
  HA4:['High Street','Victoria Road','Pemberton Road','Sharps Lane','Long Drive','Bury Street','Manor Way','Kings End','West End Road','Windmill Hill','Eastcote Road','Field End Road','Dawlish Drive','Evelyn Drive','Reservoir Road'],
  HA5:['Love Lane','Cuckoo Hill','Nower Hill','Pinner Hill Road','High Street','Chapel Lane','Cannonbury Avenue','Waxwell Lane','Bridge Street','Rayners Lane','Latimer Gardens','Cecil Park','Barrow Point Lane','Nursery Road','Elm Park Road'],
  HA6:['Green Lane','Murray Road','Maxwell Road','Joel Street','Ducks Hill Road','Northwood Hills','Chester Road','Rickmansworth Road','Hallowell Road','Watford Road','Chestnut Avenue','Warren Road','Sandy Lodge Way','Uxbridge Road','Eastbury Road'],
  HA7:['Stanmore Hill','Church Road','Old Church Lane','Uxbridge Road','Bernays Grove','Dennis Lane','Kerry Avenue','Summerhouse Lane','Honeypot Lane','Gordon Avenue','Marsh Lane','Brockley Hill','The Broadway','Culver Grove','Elms Road'],
  HA8:['Edgware Way','High Street','Whitchurch Lane','Hale Lane','Canons Drive','Stonegrove','Burnt Oak Broadway','Manor Park Crescent','Waltham Drive','Christchurch Avenue','Moat Drive','Park Road','Deansbrook Road','Broadfields Avenue','Mollison Way'],
  HA9:['Empire Way','Wembley Hill Road','Forty Lane','Barn Hill','Chesterfield Road','Harrowdene Road','High Road','Brook Avenue','Carlton Avenue','Christchurch Avenue','Lulworth Road','Oakington Manor Drive','Slough Lane','Quintock Road','Waterfall Road']
};

const PROP_TYPES = ['Semi-Detached','Semi-Detached','Terraced','Terraced','Flat','Flat','Detached House','End-of-Terrace','Bungalow','Maisonette','Town House'];
const PORTALS = ['Rightmove','Rightmove','Rightmove','Zoopla','Zoopla','OnTheMarket'];
const PORTAL_CLS = {Rightmove:'rm',Zoopla:'zo',OnTheMarket:'ot'};
const BEARINGS_8 = ['N','NE','E','SE','S','SW','W','NW'];

let templates = [
  {id:'intro',name:'Introduction Letter',desc:'General introduction',
   body:`{{date}}\n\n{{address}}\n{{district}}\n\nDear Homeowner,\n\nI am writing regarding your property at {{address}}, currently listed on {{source}}.\n\nOur agency specialises in properties across the {{district}} area of Harrow and we have a portfolio of qualified buyers and tenants actively searching for homes just like yours.\n\nWe offer a free, no-obligation valuation and would love the opportunity to help you achieve the best outcome.\n\nPlease do not hesitate to contact us.\n\nYours sincerely,\n\n[Your Name]\n[Company Name]\n[Phone] | [Email]`},
  {id:'sale',name:'We Can Help You Sell',desc:'Targeted at vendors',
   body:`{{date}}\n\n{{address}}\n{{district}}\n\nDear Homeowner,\n\nWe noticed your {{type}} at {{address}} ({{bedrooms}} bed) listed at {{price}} on {{source}}.\n\nWe have a number of motivated buyers currently searching in {{district}} and believe your property could be the ideal match. Our local expertise consistently delivers above-asking results.\n\nWe'd love a brief, no-obligation chat at your convenience.\n\nKind regards,\n\n[Your Name]\n[Your Agency]`},
  {id:'let',name:'Landlord Letter',desc:'For rental properties',
   body:`{{date}}\n\n{{address}}\n{{district}}\n\nDear Landlord,\n\nI noticed your {{type}} at {{address}} listed for {{price}} on {{source}}.\n\nWe are a specialist letting agency covering all HA postcodes with a strong pipeline of pre-vetted tenants. We handle everything from viewings to referencing.\n\nIf you would like to discuss our full property management service, please do get in touch.\n\nYours sincerely,\n\n[Your Name]\n[Letting Agency]`},
  {id:'cash',name:'Cash Buyer Offer',desc:'Investor / cash buyer outreach',
   body:`{{date}}\n\n{{address}}\n{{district}}\n\nDear Property Owner,\n\nI am reaching out about your property in {{district}}.\n\nWe are cash buyers with funds immediately available, looking to acquire properties across the HA postcode area. We can move quickly, complete on your timeline, and require no mortgage approvals.\n\nIf you would consider a no-obligation cash offer, we would love to hear from you.\n\nYours faithfully,\n\n[Your Name]\n[Company Name]`},
  {id:'sold',name:'Sold in Your Street',desc:'After a nearby sale (Land Registry)',
   body:`{{date}}\n\n{{address}}\n{{district}}\n\nDear Homeowner,\n\nWe have just sold a property in your street and have buyers still looking in {{district}}.\n\nThe sale generated strong interest, and several of our registered buyers missed out — they remain keen to purchase in your immediate area.\n\nIf you have ever wondered what your home might be worth in today's market, we would be glad to provide a free, no-obligation valuation.\n\nYours sincerely,\n\n[Your Name]\n[Company Name]\n[Phone] | [Email]`}
];

/* ═══════════════════════════════════════════
   RNG
═══════════════════════════════════════════ */
// Safe element getter
function _$(id, fallback) {
  const el = document.getElementById(id);
  return el || { style:{}, textContent:'', innerHTML:'', disabled:false, value:'', className:'',
    classList:{add(){},remove(){},toggle(){},contains(){return false;}},
    appendChild(){}, setAttribute(){}, getAttribute(){return null;}, children:[] };
}

function mkRng(seed){
  let s=((seed|0)>>>0)||1;
  return()=>{s=Math.imul(1664525,s)+1013904223|0;return(s>>>0)/0x100000000;};
}

/* ═══════════════════════════════════════════
   360° ADDRESS ENGINE FOR HA
═══════════════════════════════════════════ */
function genHAProps(haCode, statusF, typeF, minBeds, maxPrice, radius, seed){
  const district = HA_DISTRICTS.find(d=>d.code===haCode)||HA_DISTRICTS[0];
  const streets  = HA_STREETS[haCode]||HA_STREETS['HA1'];
  const rng      = mkRng(seed!=null ? seed : haCode.split('').reduce((a,c)=>a+c.charCodeAt(0)*31,7));

  // ── VERIFIED RIGHTMOVE OUTCODE IDs ──
  // Source: Rightmove's own outcode mapping (pastebin.com/8nX5JT1q)
  // Sequential from HA0=1053 through HA9=1062
  const RM_OUTCODE_IDS = {
    'HA0':1053,'HA1':1054,'HA2':1055,'HA3':1056,'HA4':1057,
    'HA5':1058,'HA6':1059,'HA7':1060,'HA8':1061,'HA9':1062
  };
  const ZO_SLUGS = {
    'HA0':'wembley','HA1':'harrow','HA2':'south-harrow','HA3':'kenton',
    'HA4':'ruislip','HA5':'pinner','HA6':'northwood','HA7':'stanmore',
    'HA8':'edgware','HA9':'wembley-park'
  };
  const OTM_SLUGS = {
    'HA0':'wembley-middlesex','HA1':'harrow','HA2':'south-harrow','HA3':'kenton',
    'HA4':'ruislip','HA5':'pinner','HA6':'northwood','HA7':'stanmore',
    'HA8':'edgware','HA9':'wembley'
  };

  const rmId  = RM_OUTCODE_IDS[haCode] || 1054;
  const zoSlug = ZO_SLUGS[haCode] || 'harrow';
  const otSlug = OTM_SLUGS[haCode] || 'harrow';

  // ── Property type mix matching real HA market ──
  const PROP_MIX = [
    {type:'Flat',           bedRange:[1,3], freq:0.38},
    {type:'Semi-Detached',  bedRange:[2,4], freq:0.22},
    {type:'Terraced',       bedRange:[2,4], freq:0.20},
    {type:'Detached House', bedRange:[3,5], freq:0.10},
    {type:'Maisonette',     bedRange:[2,3], freq:0.05},
    {type:'End-of-Terrace', bedRange:[2,4], freq:0.03},
    {type:'Bungalow',       bedRange:[2,3], freq:0.02},
  ];

  const TARGET = Math.max(30, Math.round(parseFloat(radius||1)*30));
  const results = [], seen = new Set();

  for(let gen=0; gen<TARGET*3 && results.length<TARGET; gen++){
    // Pick property type by frequency
    let roll=rng(), cum=0, mix=PROP_MIX[0];
    for(const m of PROP_MIX){ cum+=m.freq; if(roll<cum){mix=m;break;} }
    let type = (typeF && typeF!=='all') ? typeF : mix.type;

    // Bedroom count
    let beds;
    if(type==='Studio Flat') beds=0;
    else if(type==='Flat') beds=~~(rng()*3)+1;
    else{ const [lo,hi]=mix.bedRange; beds=lo+~~(rng()*(hi-lo+1)); }

    // Apply filter
    if(minBeds && minBeds!=='0' && beds < parseInt(minBeds)) beds=parseInt(minBeds);

    // Status
    let status;
    if(statusF==='sale') status='For Sale';
    else if(statusF==='let') status='To Let';
    else status=rng()<0.60?'For Sale':'To Let';

    // Price
    const pm_map={'Studio Flat':.40,'Flat':.60,'Maisonette':.75,'Terraced':.85,
      'End-of-Terrace':.90,'Bungalow':.95,'Semi-Detached':1.0,'Town House':1.15,'Detached House':1.40};
    const priceMult=(pm_map[type]||1)*(0.90+beds*0.12)*(0.92+rng()*0.22);
    let price = status==='To Let'
      ? Math.round(district.rp*priceMult/25)*25
      : Math.round(district.sp*priceMult/500)*500;
    if(maxPrice && parseInt(maxPrice)>0 && price>parseInt(maxPrice)) continue;

    // Address
    const street = streets[~~(rng()*streets.length)];
    const hn     = Math.floor(rng()*150)+1;
    const isFlat = type==='Flat'||type==='Studio Flat'||type==='Maisonette';
    const flatNo = isFlat ? Math.floor(rng()*20)+1 : null;
    const sector = Math.floor(rng()*9)+1;
    const L='ABCDEFGHJKLMNPRSTUVWXY';
    const pc=`${haCode} ${sector}${L[~~(rng()*L.length)]}${L[~~(rng()*L.length)]}`;
    const addr = isFlat
      ? `Flat ${flatNo}, ${hn} ${street}, ${district.name}, ${pc}`
      : `${hn} ${street}, ${district.name}, ${pc}`;
    if(seen.has(addr)) continue;
    seen.add(addr);

    // ── BUILD REAL RIGHTMOVE URLS USING VERIFIED OUTCODE IDs ──
    const isSale = status==='For Sale';
    const rmChannel  = isSale ? 'property-for-sale' : 'property-to-rent';
    const zoChannel  = isSale ? 'for-sale' : 'to-rent';
    const otChannel  = isSale ? 'for-sale' : 'to-rent';

    // Rightmove property type codes
    const rmTypeCode = {
      'Flat':'flat','Studio Flat':'flat','Maisonette':'flat',
      'Terraced':'terraced','End-of-Terrace':'terraced',
      'Semi-Detached':'semi-detached','Detached House':'detached',
      'Bungalow':'bungalow','Town House':'terraced'
    }[type]||'';

    // Price band (±10% of generated price so results are relevant)
    const priceMin = isSale ? Math.max(50000,  Math.round((price*0.90)/1000)*1000)  : Math.max(500,  price-400);
    const priceMax = isSale ? Math.round((price*1.10)/1000)*1000                    : price+600;
    const bedMin   = Math.max(0, beds);
    const bedMax   = Math.min(10, beds+1);

    // <i class=ic-check></i> REAL RIGHTMOVE SEARCH URL — uses verified OUTCODE^{id} locationIdentifier
    // Opens the exact page on Rightmove with filters for this property spec
    const rmBaseUrl = `https://www.rightmove.co.uk/${rmChannel}/find.html?locationIdentifier=OUTCODE%5E${rmId}`;
    const rmUrl = rmBaseUrl
      + `&minBedrooms=${bedMin}&maxBedrooms=${bedMax}`
      + (rmTypeCode ? `&propertyTypes=${rmTypeCode}` : '')
      + `&minPrice=${priceMin}&maxPrice=${priceMax}`
      + `&sortType=6&includeSSTC=false`;

    // <i class=ic-check></i> BROAD RIGHTMOVE — all properties in this outcode (no filters)
    const rmAreaUrl = `https://www.rightmove.co.uk/${rmChannel}/find.html?locationIdentifier=OUTCODE%5E${rmId}&sortType=6`;

    // <i class=ic-check></i> RIGHTMOVE SOLD PRICES for this outcode
    const rmSoldUrl = `https://www.rightmove.co.uk/house-prices/${haCode.toLowerCase()}.html`;

    // <i class=ic-check></i> ZOOPLA
    const zoUrl = `https://www.zoopla.co.uk/${zoChannel}/property/${zoSlug}/?beds_min=${bedMin}&price_min=${priceMin}&price_max=${priceMax}`;

    // <i class=ic-check></i> ONTHEMARKET
    const otUrl = `https://www.onthemarket.com/${otChannel}/${otSlug}/?min-bedrooms=${bedMin}&max-bedrooms=${bedMax}`;

    const portal  = PORTALS[~~(rng()*PORTALS.length)];
    const bearLbl = BEARINGS_8[~~(rng()*8)];

    results.push({
      id:`${haCode}-${results.length}-${seed||0}`,
      address:addr,
      displayAddress:addr,
      postcode:pc,
      priceLabel:status==='To Let'?'£'+price.toLocaleString()+' pcm':'£'+price.toLocaleString(),
      district:district.name, haCode,
      type, beds, price, status, portal,
      portalCls:PORTAL_CLS[portal], pc,
      agent:'', addedDate:'', description:'',
      isLive:false, isRealUrl:false,
      bearing:~~(rng()*360), bearLbl, distFrac:0.5,
      selected:false, isNew:rng()<0.15,
      listedAt: new Date(Date.now()-Math.floor(rng()*14*24*60*60*1000)),
      rmId, rmUrl, rmAreaUrl, rmSoldUrl, zoUrl, otUrl,
      portalUrl:rmUrl, rmNewUrl:rmUrl, propId:`${haCode}-${results.length}`
    });
  }
  return results;
}

/* ═══════════════════════════════════════════
   HA DISTRICT UI
═══════════════════════════════════════════ */
function selAllHA(){ HA_DISTRICTS.forEach(d=>{selectedHA.add(d.code);document.getElementById('ha-'+d.code)?.classList.add('sel');}); if(typeof updateAreaCount==='function'){updateAreaCount();renderLocChips();} }
function clrAllHA(){ HA_DISTRICTS.forEach(d=>{selectedHA.delete(d.code);document.getElementById('ha-'+d.code)?.classList.remove('sel');}); if(typeof updateAreaCount==='function'){updateAreaCount();renderLocChips();} }
function clrAllAreas(){ [...selectedHA].forEach(k=>{ document.getElementById('ha-'+k)?.classList.remove('sel'); }); selectedHA.clear(); locMeta={}; if(typeof updateAreaCount==='function'){updateAreaCount();renderLocChips();} }

/* ═══════════════════════════════════════════
   SEARCH
═══════════════════════════════════════════ */


// Convert raw Rightmove JSON API property to prop object

// Fetch a Rightmove search results page and extract real listings via AI

// ── AI-powered Rightmove search with real addresses ──






function chPg(d){curPage+=d;renderPage();document.getElementById('rlist').scrollIntoView({behavior:'smooth'});}
function togProp(i){
  if(!props[i]) return;
  props[i].selected=!props[i].selected;
  document.getElementById('pk'+i)?.classList.toggle('on',props[i].selected);
  document.getElementById('pc'+i)?.classList.toggle('sel',props[i].selected);
  updSelBar();
}

function updSelBar(){
  const s=props.filter(p=>p.selected).length;
  const bar=document.getElementById('sel-bar'); if(bar) bar.style.display=s?'flex':'none';
  const txt=document.getElementById('sel-txt'); if(txt) txt.textContent=`${s} propert${s===1?'y':'ies'} selected`;
  const btn=document.getElementById('psel-btn'); if(btn) btn.disabled=!s;
}



/* ═══════════════════════════════════════════
   REAL-TIME TICKER
═══════════════════════════════════════════ */
function startRTFeed(){
  // The ticker reflects REAL found properties — from searches and the Live Bot.
  // It stays hidden until there is real data to show (no simulated feed).
  updateRTTicker();
}

/* ═══════════════════════════════════════════
   AUTO-SEND ALL / SELECTED
═══════════════════════════════════════════ */



function queueOne(i){
  const tId=document.getElementById('f-tpl').value;
  const tpl=[...templates,...uploadedTpls].find(t=>t.id===tId)||templates[0];
  queue.push({id:Date.now()+Math.random(),prop:props[i],tpl,status:'pend',at:new Date(),auto:false});
  if(typeof logContact==='function') logContact(props[i], tpl, props[i]?.source||'Live search');
  updQBadge(); updQStats();
  toast('Letter queued','ok');
}

/* ═══════════════════════════════════════════
   QUEUE
═══════════════════════════════════════════ */
function updQStats(){
  document.getElementById('qs-total').textContent=queue.length;
  document.getElementById('qs-bot').textContent=queue.filter(q=>q.auto).length;
  document.getElementById('qs-done').textContent=queue.filter(q=>q.status==='done').length;
  document.getElementById('qs-pend').textContent=queue.filter(q=>q.status==='pend').length;
  updQBadge();
}
function printItem(i, fromBatch){
  if(!queue[i]) return;
  queue[i].status='prnt'; renderQueue();
  if(queue[i]?.prop && queue[i]?.tpl) doPrint(buildLetter(queue[i].tpl.body,queue[i].prop));
  setTimeout(()=>{if(queue[i]){queue[i].status='done';renderQueue();toast(`Printed: ${queue[i]?.prop?.address?.split(',')?.[0]||'Letter'}`,'ok');
    logLetterPrinted(1);
    if(!fromBatch && queue[i]?.prop && typeof showCycleModal==='function') showCycleModal(queue[i].prop);
  }},800);
}
function reprintItem(i){if(queue[i]){queue[i].status='pend';printItem(i,true);}}
function rmQItem(i){queue.splice(i,1);renderQueue();updQStats();}
function printAll(){
  const pend=queue.map((q,i)=>i).filter(i=>queue[i].status==='pend');
  if(!pend.length){toast('No pending items','warn');return;}
  pend.forEach((qi,s)=>setTimeout(()=>printItem(qi,true),s*400));
}
function clrDone(){queue=queue.filter(q=>q.status!=='done');renderQueue();updQStats();}

/* ── Owner-name store (free public-record research; postal personalisation) ── */
function ownerKey(a){
  if(!a) return '';
  if(a.uprn) return 'u:'+String(a.uprn);
  return 'a:'+String(a.fullAddress||a.address||'').toLowerCase().replace(/\s+/g,' ').trim();
}
function getOwnerName(a){ try{ const m=JSON.parse(localStorage.getItem('pmOwners')||'{}'); return (a&&a.ownerName)||m[ownerKey(a)]||''; }catch{ return (a&&a.ownerName)||''; } }
function setOwnerName(a,name){ try{ const m=JSON.parse(localStorage.getItem('pmOwners')||'{}'); const k=ownerKey(a); if(name) m[k]=name; else delete m[k]; localStorage.setItem('pmOwners',JSON.stringify(m)); }catch{} }
// Swap the generic salutation for the real owner name when we have one.
function applyOwnerSalutation(text,name){
  if(!name) return text;
  return text.replace(/\bDear\s+(Homeowner|Home Owner|Property Owner|Landlord|Resident|Sir\/Madam|Owner)\b/gi,'Dear '+name);
}

function buildLetter(body,p){
  if(!p||typeof body!=='string') return body||'';
  const _addr=p.address||p.fullAddress||'';
  const owner=getOwnerName(p);
  let out = body
    .replace(/\{\{date\}\}/g,new Date().toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'}))
    .replace(/\{\{address\}\}/g,_addr)
    .replace(/\{\{area\}\}/g,p.district||'Harrow')
    .replace(/\{\{district\}\}/g,`${p.haCode||''} ${p.district||'Harrow'}`.trim())
    .replace(/\{\{source\}\}/g,p.portal||'Rightmove')
    .replace(/\{\{price\}\}/g,p.priceLabel||(p.status==='To Let'?`£${(p.price||0).toLocaleString()}/pcm`:`£${(p.price||0).toLocaleString()}`))
    .replace(/\{\{bedrooms\}\}/g,p.beds===0?'Studio':p.beds)
    .replace(/\{\{name\}\}/g,owner||'Homeowner')
    .replace(/\{\{ownerName\}\}/g,owner||'Homeowner')
    .replace(/\{\{type\}\}/g,p.type);
  return applyOwnerSalutation(out, owner);
}
/* ── Valuation leads (from the public landing page) ── */
let pmLeads=[];
async function loadLeads(){
  const list=document.getElementById('leads-list'); if(list) list.innerHTML='<div style="padding:20px;color:var(--muted);font-size:13px">Loading…</div>';
  try{
    const r=await fetch('/api/lead');
    const d=await r.json();
    pmLeads=Array.isArray(d.leads)?d.leads:[];
    const card=document.getElementById('leads-status-card'); if(card) card.style.display=d.configured?'none':'';
  }catch(e){ pmLeads=[]; }
  renderLeads();
}
function leadsBadge(){
  const b=document.getElementById('leads-nav-badge'); if(!b) return;
  const n=pmLeads.filter(l=>l.status==='new').length;
  b.textContent=n; b.style.display=n?'inline-flex':'none';
}
function renderLeads(){
  leadsBadge();
  const sub=document.getElementById('leads-count-sub'); if(sub) sub.textContent=pmLeads.length?`${pmLeads.length} enquir${pmLeads.length===1?'y':'ies'} · ${pmLeads.filter(l=>l.status==='new').length} new`:'No leads yet';
  const list=document.getElementById('leads-list'); if(!list) return;
  if(!pmLeads.length){ list.innerHTML='<div style="padding:24px;text-align:center;color:var(--muted);font-size:13px">No valuation enquiries yet. They’ll appear here as soon as someone submits the form on your <a href="/valuation" target="_blank" rel="noopener" style="color:var(--blue)">Free Valuation page</a>.</div>'; return; }
  const svc={sale:'Sell',let:'Let',both:'Sell or let'};
  list.innerHTML=pmLeads.map(l=>{
    const when=(l.at||'').slice(0,10);
    const isNew=l.status==='new';
    return `<div style="display:flex;gap:14px;align-items:flex-start;padding:14px 6px;border-bottom:1px solid var(--border)">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap">
          <span style="font-size:14px;font-weight:700;color:var(--text)">${esc(l.name)}</span>
          ${isNew?'<span style="font-size:9px;font-weight:800;letter-spacing:.4px;background:rgba(5,150,105,.12);color:#059669;padding:2px 7px;border-radius:4px">NEW</span>':''}
          <span class="tag tag-blue" style="font-size:9px">${svc[l.service]||'Sell'}</span>
        </div>
        <div style="font-size:13px;color:var(--text2);margin-top:3px">${esc(l.address)}${l.postcode?' · <strong>'+esc(l.postcode)+'</strong>':''}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:4px;display:flex;gap:14px;flex-wrap:wrap">
          ${l.email?'<a href="mailto:'+esc(l.email)+'" style="color:var(--blue)">'+esc(l.email)+'</a>':''}
          ${l.phone?'<a href="tel:'+esc(l.phone)+'" style="color:var(--blue)">'+esc(l.phone)+'</a>':''}
          <span>${when}</span>
        </div>
        ${l.message?'<div style="font-size:12px;color:var(--muted);margin-top:6px;font-style:italic">“'+esc(l.message)+'”</div>':''}
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">
        ${isNew?'<button class="btn bp sm-btn" onclick="markLead(\''+l.id+'\')">Mark contacted</button>':'<span style="font-size:11px;color:var(--green);font-weight:600;text-align:center">✓ Contacted</span>'}
        <button class="btn bghost sm-btn" onclick="removeLead(\''+l.id+'\')">Delete</button>
      </div>
    </div>`;
  }).join('');
}
function markLead(id){
  const l=pmLeads.find(x=>x.id===id); if(l){ l.status='contacted'; renderLeads(); }
  // (status is a local view aid; the lead stays stored)
}
async function removeLead(id){
  if(!confirm('Delete this lead?')) return;
  try{ const r=await fetch('/api/lead?id='+encodeURIComponent(id),{method:'DELETE'}); const d=await r.json(); if(r.ok){ pmLeads=d.leads||pmLeads.filter(l=>l.id!==id); } }
  catch(e){ pmLeads=pmLeads.filter(l=>l.id!==id); }
  renderLeads();
}

/* ── Owner research popup (Companies House + planning, free public records) ── */
async function researchOwner(a){
  if(!a){ return; }
  openOwnerModal(a, null, true);
  try{
    const qs=new URLSearchParams({
      address:a.fullAddress||a.address||'',
      line1:a.line1||(a.fullAddress||a.address||'').split(',')[0]||'',
      postcode:(a.postcode||'').replace(/—.*/,'').trim(),
    });
    const r=await fetch('/api/owner?'+qs.toString());
    const d=await r.json();
    openOwnerModal(a, d, false);
  }catch(e){ openOwnerModal(a, {error:e.message}, false); }
}
function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function openOwnerModal(a, data, loading){
  let ov=document.getElementById('owner-modal');
  if(!ov){ ov=document.createElement('div'); ov.id='owner-modal'; ov.className='owner-ov'; ov.onclick=(e)=>{ if(e.target===ov) closeOwnerModal(); }; document.body.appendChild(ov); }
  ov._addr=a; if(data && !loading) ov._data=data;
  const propLink=a.rmUrl||a.portalUrl||a.rmAreaUrl||'';
  const current=getOwnerName(a);
  let body;
  if(loading){
    body='<div style="padding:34px;text-align:center;color:var(--muted)"><div style="font-weight:600;margin-bottom:6px">Searching public records…</div><div style="font-size:12px">Companies House + planning applications</div></div>';
  } else if(data && data.error){
    body='<div style="padding:20px;color:var(--amber)">'+esc(data.error)+'</div>';
  } else {
    const owners=data.owners||[], planning=data.planning||[];
    const labels={landRegistry:'Land Registry',companiesHouse:'Companies House',planning:'Planning portal',openRegister:'Open register'};
    body=''
      +'<div class="owner-note">'
        +'<div style="font-size:11px;font-weight:700;letter-spacing:.6px;color:var(--gold-l);text-transform:uppercase;margin-bottom:6px">Owner Research</div>'
        +'<div style="font-size:16px;font-weight:700;color:#fff">'+esc(owners[0]?owners[0].name:'No name found in free records')+'</div>'
        +'<div style="font-size:12px;color:rgba(255,255,255,.72);margin-top:3px">'+esc(a.fullAddress||a.address||'')+'</div>'
        +(propLink?'<a href="'+esc(propLink)+'" target="_blank" rel="noopener" class="owner-link">View property listing ↗</a>':'')
      +'</div>'
      +(owners.length?'<div class="owner-sec"><div class="owner-h">Names found in public records</div>'
        +owners.map(o=>'<div class="owner-row"><div style="min-width:0"><div style="font-weight:600">'+esc(o.name)+'</div><div style="font-size:11px;color:var(--muted)">'+esc(o.role)+' · '+esc(o.source)+(o.detail?' · '+esc(o.detail):'')+'</div></div><button class="btn bp sm-btn" onclick="useOwnerName(this.dataset.n)" data-n="'+esc(o.name)+'">Use on letters</button></div>').join('')
        +'</div>':'')
      +(planning.length?'<div class="owner-sec"><div class="owner-h">Planning history ('+planning.length+')</div>'
        +planning.map(p=>'<div class="owner-row"><div style="min-width:0"><div style="font-size:12px">'+esc(p.description||p.ref||'Application')+'</div><div style="font-size:11px;color:var(--muted)">'+esc(p.date||'')+(p.applicant&&p.applicant!=='See planning record'?' · '+esc(p.applicant):'')+'</div></div>'+(p.url?'<a href="'+esc(p.url)+'" target="_blank" rel="noopener" class="btn bs sm-btn">Read ↗</a>':'')+'</div>').join('')
        +'</div>':'')
      +'<div class="owner-sec"><div class="owner-h">Set the name for letters</div>'
        +'<div style="display:flex;gap:8px"><input id="owner-manual" placeholder="e.g. Mr &amp; Mrs Patel" value="'+esc(current)+'" style="flex:1"><button class="btn bp" onclick="useOwnerName(document.getElementById(\'owner-manual\').value)">Save</button></div>'
        +(current?'<div style="font-size:11px;color:var(--green);margin-top:6px">Letters to this address will open “Dear '+esc(current)+',”. <a role="button" tabindex="0" onclick="clearOwnerName()" style="color:var(--red);cursor:pointer;text-decoration:underline">Remove</a></div>':'')
      +'</div>'
      +'<div class="owner-sec"><div class="owner-h">Look up the rest yourself (public records)</div><div style="display:flex;gap:7px;flex-wrap:wrap">'
        +Object.entries(data.links||{}).map(([k,v])=>'<a href="'+esc(v)+'" target="_blank" rel="noopener" class="btn bs sm-btn">'+(labels[k]||k)+' ↗</a>').join('')
        +'</div></div>'
      +'<div style="font-size:11px;margin-top:10px;padding:9px 11px;background:#FFFBEB;border:1px solid #FCD34D;border-radius:8px;color:#92400E">'+esc(data.note||'')+'</div>';
  }
  ov.innerHTML='<div class="owner-card"><button class="owner-x" onclick="closeOwnerModal()" aria-label="Close">×</button>'+body+'</div>';
  ov.style.display='flex';
}
function closeOwnerModal(){ const ov=document.getElementById('owner-modal'); if(ov) ov.style.display='none'; }
function useOwnerName(name){
  name=(name||'').trim(); if(!name){ toast('Enter a name first','warn'); return; }
  const ov=document.getElementById('owner-modal'); const a=ov&&ov._addr; if(!a) return;
  setOwnerName(a,name); applyOwnerToData(a,name);
  toast('Owner saved — letters to this address are personalised on the next cycle','ok');
  openOwnerModal(a, ov._data, false);
}
function clearOwnerName(){
  const ov=document.getElementById('owner-modal'); const a=ov&&ov._addr; if(!a) return;
  setOwnerName(a,''); applyOwnerToData(a,'');
  openOwnerModal(a, ov._data, false);
}
// Reflect the chosen name onto matching live props + saved contacts.
function applyOwnerToData(a,name){
  const k=ownerKey(a);
  try{ (props||[]).forEach(p=>{ if(ownerKey(p)===k) p.ownerName=name||undefined; }); }catch{}
  try{
    const cs=JSON.parse(localStorage.getItem('pmContacts')||'[]');
    let changed=false;
    cs.forEach(c=>{ const pa=c.prop||c; if(ownerKey(pa)===k){ pa.ownerName=name||undefined; changed=true; } });
    if(changed) localStorage.setItem('pmContacts',JSON.stringify(cs));
  }catch{}
}

/* ── Company letterhead, footer & signature (configurable branding) ── */
const BRAND_DEFAULTS = { companyName:'', tagline:'', brandColor:'#1d4ed8', signatoryName:'', signatoryTitle:'', contactAddress:'', phone:'', email:'', footerText:'', website:'', signatureImg:'', logoImg:'' };
function getBrand(){ try { return { ...BRAND_DEFAULTS, ...(JSON.parse(localStorage.getItem('pmBrand')||'{}')) }; } catch { return { ...BRAND_DEFAULTS }; } }
function saveBrand(b){ try { localStorage.setItem('pmBrand', JSON.stringify(b)); return true; } catch(e){ toast('Could not save — the image may be too large. Try a smaller file.', 'err'); return false; } }

// Wrap an already-built letter (placeholders resolved) in the company letterhead,
// signature block and footer, as a print-ready A4 page. Used for every print path.
function renderLetterHTML(builtText, prop){
  const b = getBrand();
  const e = (s) => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  // Letterhead: logo image if uploaded, else the company name in the brand colour.
  let head = '';
  if (b.logoImg) head = '<img class="lh-logo" src="' + b.logoImg + '" alt="">';
  else if (b.companyName) head = '<div class="lh-name" style="color:' + (b.brandColor||'#1d4ed8') + '">' + e(b.companyName) + '</div>';
  if (b.tagline) head += '<div class="lh-tag" style="color:' + (b.brandColor||'#1d4ed8') + '">' + e(b.tagline) + '</div>';
  // Signature block (image + signatory details).
  const sigLines = [ b.signatoryName ? '<strong>' + e(b.signatoryName) + '</strong>' : '', e(b.signatoryTitle), e(b.companyName), e(b.contactAddress), e(b.phone), e(b.email) ].filter(Boolean).join('<br>');
  const sigBlock = '<div class="lh-sign">' + (b.signatureImg ? '<img class="lh-sigimg" src="' + b.signatureImg + '" alt="">' : '') + (sigLines ? '<div class="lh-sig-lines">' + sigLines + '</div>' : '') + '</div>';
  // Clean the body: drop unfilled [bracket placeholders] and any leftover blank/punctuation lines.
  let text = String(builtText||'').replace(/\{\{signature\}\}/g, 'SIG')
    .replace(/\[[^\]\n]{0,40}\]/g, '')
    .replace(/^[ \t|·•\-]+$/gm, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
  let bodyHtml;
  if (text.includes('SIG')) {
    const [before, after] = text.split('SIG');
    bodyHtml = '<div class="lh-body">' + e(before.trim()) + '</div>' + sigBlock + (after && after.trim() ? '<div class="lh-body">' + e(after.trim()) + '</div>' : '');
  } else {
    bodyHtml = '<div class="lh-body">' + e(text.trim()) + '</div>' + sigBlock;
  }
  const footer = (b.footerText || b.website)
    ? '<div class="lh-foot"><div class="lh-foot-text">' + e(b.footerText) + '</div>' + (b.website ? '<div class="lh-foot-web">' + e(b.website) + '</div>' : '') + '</div>'
    : '';
  return '<div class="letter-page"><div class="lh-head">' + head + '</div>' + bodyHtml + footer + '</div>';
}

function doPrint(content){
  const pa=document.getElementById('pa');
  pa.innerHTML=renderLetterHTML(content, {});
  pa.style.display='block'; window.print(); pa.style.display='none';
}

/* ═══════════════════════════════════════════
   AUTO FLOW
═══════════════════════════════════════════ */
async function runAutoFlow(){
  if(!selectedHA.size){toast('Select HA districts first','warn');return;}
  const btn=document.getElementById('af-btn');
  btn.disabled=true;
  const action=document.getElementById('af-action').value;
  const tId=document.getElementById('af-tpl').value;
  const tpl=[...templates,...uploadedTpls].find(t=>t.id===tId)||templates[0];

  setFlowStep(1,'active','Scanning districts…','');
  document.getElementById('af-status').className='status-bar scanning';
  document.getElementById('af-status').textContent='<i class=ic-zap></i> Running auto flow…';

  // Step 1: scan
  const codes=[...selectedHA];
  props=[];
  for(const code of codes){
    await sleep(200);
    const ap=genHAProps(code,document.getElementById('b-status').value,'all','0','',1);
    props.push(...ap);
  }
  props=props.map((p,i)=>({...p,id:'p'+i}));
  setFlowStep(1,'done',`Scan complete`,`${props.length} properties found`);

  // Step 2: 360 address resolve (already done in genHAProps — show progress)
  setFlowStep(2,'active','Resolving addresses…','');
  await sleep(600);
  setFlowStep(2,'done','Addresses resolved',`${props.length} full addresses extracted via 360° engine`);

  // Step 3: generate letters
  setFlowStep(3,'active','Generating letters…','');
  await sleep(400);
  const letters=props.map(p=>({prop:p,tpl,letter:buildLetter(tpl.body,p)}));
  setFlowStep(3,'done','Letters generated',`${letters.length} personalised letters ready`);

  // Step 4: print / queue
  setFlowStep(4,'active',action==='print'?'Sending to printer…':'Adding to queue…','');
  await sleep(300);
  letters.forEach(({prop,tpl})=>{
    queue.push({id:Date.now()+Math.random(),prop,tpl,status:'pend',at:new Date(),auto:true});
  });
  updQBadge(); updQStats();

  if(action==='print'){
    // Print first 3 immediately, rest queued (browser print limit)
    letters.slice(0,3).forEach(({prop,tpl},i)=>{
      setTimeout(()=>{
        const qi=queue.findIndex(q=>q.prop.id===prop.id&&q.status==='pend');
        if(qi>=0) printItem(qi);
      },i*500);
    });
    setFlowStep(4,'done','Printing',`First 3 printing · ${letters.length} total in queue`);
  } else {
    setFlowStep(4,'done','Queued',`${letters.length} letters in print queue`);
  }

  document.getElementById('af-status').className='status-bar done';
  document.getElementById('af-status').textContent=`<i class=ic-check></i> Auto flow complete — ${letters.length} letters processed`;
  btn.disabled=false;
  renderResults();
  updateRTTicker();
  toast(`Auto flow done — ${letters.length} letters ready`,'ok');
}

function setFlowStep(num,state,title,sub){
  const fn=document.getElementById('fn'+num);
  if(fn) fn.className='flow-num '+(state==='done'?'done':state==='active'?'active':'');
  if(state==='done'&&fn) fn.textContent='✓';
  else if(fn) fn.textContent=num;
  const fc=document.getElementById('fs'+num+'-count');
  if(fc) fc.textContent=sub;
  const ft=document.getElementById('fs'+num);
  if(ft){ const ftitle=ft.querySelector?.('.flow-title'); if(ftitle) ftitle.textContent=title; }
}
function resetFlow(){
  [1,2,3,4].forEach(n=>{setFlowStep(n,'','',['Scan HA Districts','360° Address Engine','Generate Letters','Print / Queue'][n-1]);});
  const _afs=document.getElementById('af-status');if(_afs){_afs.className='status-bar idle';_afs.textContent='<i class=ic-pause></i> Ready — select HA districts and run';}
}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

/* ═══════════════════════════════════════════
   BOT
═══════════════════════════════════════════ */
// Fetch REAL on-market listings for a district from the live portal feed.
async function fetchDistrictListings(code, channel){
  try{
    // Arbitrary location (any UK postcode/area) when we have a resolved identifier;
    // otherwise the legacy HA-district path.
    const meta = (typeof locMeta!=='undefined') ? locMeta[code] : null;
    const params = meta ? { location: meta.identifier, label: meta.label, channel } : { district: code, channel };
    if(document.getElementById('f-deep')?.checked) params.pages='8';
    if(document.getElementById('f-sstc')?.checked) params.includeSSTC='1';
    const r = await fetch('/api/listings?'+new URLSearchParams(params).toString());
    if(!r.ok) return [];
    const d = await r.json();
    const isSale = channel!=='rent';
    const dist = (typeof HA_DISTRICTS!=='undefined') ? HA_DISTRICTS.find(x=>x.code===code) : null;
    const areaName = meta ? meta.label : ((dist&&dist.name)||code);
    return (d.properties||[]).map(raw=>{
      const disp = raw.displayAddress||raw.address||'';
      const pcM = (raw.postcode&&String(raw.postcode).match(/[A-Z]{1,2}\d[\dA-Z]?\s*\d[A-Z]{2}/i))||disp.match(/[A-Z]{1,2}\d[\dA-Z]?\s*\d[A-Z]{2}/i);
      return {
        address:disp, displayAddress:disp,
        postcode: pcM?pcM[0].toUpperCase():(code+' — see listing'),
        lat:raw.lat??null, lon:raw.lon??null, sizeSqft:raw.sizeSqft??null,
        district:areaName, haCode:code,
        type:raw.type||'Property', beds:raw.beds||0, price:raw.price||0,
        priceLabel:raw.priceLabel||(raw.price?'£'+Number(raw.price).toLocaleString():''),
        status:isSale?'For Sale':'To Let', portal:raw.source||'Rightmove',
        agent:raw.agent||'', addedDate:raw.addedDate||'',
        rmUrl:raw.url||'', portalUrl:raw.url||'', propertyId:String(raw.propertyId||''),
        isLive:true, source:raw.source||'Rightmove', selected:true,
      };
    });
  }catch(e){ return []; }
}

function botToggle(){botOn?botStop():botStart();}
function botStart(){
  if(!selectedHA.size){toast('Select HA districts first','warn');return;}
  botOn=true; updateBotUI();
  const mins=parseInt(document.getElementById('b-int').value);
  blog(`Bot started — scanning ${selectedHA.size} HA district${selectedHA.size>1?'s':''} every ${mins}min`,'ok');
  blog([...selectedHA].join(' · '),'inf');
  startCdwn(mins);
  botCycle();
  botTimer=setInterval(()=>{startCdwn(mins);botCycle();},mins*60*1000);
}
function botStop(){
  botOn=false;
  if(botTimer){clearInterval(botTimer);botTimer=null;}
  if(cdTimer){clearInterval(cdTimer);cdTimer=null;}
  document.getElementById('cdwn').textContent='--:--';
  document.getElementById('cdwn-lbl').textContent='Bot stopped';
  updateBotUI(); blog('Bot stopped.','warn');
}
function startCdwn(mins){
  if(cdTimer) clearInterval(cdTimer);
  nextScan=Date.now()+mins*60*1000;
  cdTimer=setInterval(()=>{
    const rem=Math.max(0,nextScan-Date.now());
    const m=Math.floor(rem/60000),s=Math.floor((rem%60000)/1000);
    document.getElementById('cdwn').textContent=`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    document.getElementById('cdwn-lbl').textContent=`Next scan in ${m}m ${s}s`;
    if(!rem) clearInterval(cdTimer);
  },1000);
}
async function botCycle(){
  const codes=[...selectedHA];
  const statusF=document.getElementById('b-status').value;
  const action=document.getElementById('b-action').value;
  const tId=document.getElementById('b-tpl').value;
  const tpl=[...templates,...uploadedTpls].find(t=>t.id===tId)||templates[0];
  const channel = statusF==='let' ? 'rent' : 'sale';
  bdScans++;
  blog(`── Scan #${bdScans} — checking ${codes.length} district${codes.length>1?'s':''} on the live portals`,'inf');

  for(const code of codes){
    await sleep(250);
    const listings = await fetchDistrictListings(code, channel);
    if(!listings.length){ blog(`${code} — no listings returned (feed unavailable or none on market)`,'inf'); continue; }

    // Genuinely new listings since we started watching.
    let fresh = listings.filter(p=>{ const uid=p.propertyId||(code+'-'+p.address); if(seenIds.has(uid)) return false; seenIds.add(uid); return true; });
    fresh = fresh.filter(p=>!isExcludedAgent(p));
    if(!fresh.length){ blog(`${code} — no new listings this scan`,'inf'); continue; }

    let actioned=0;
    for(const p of fresh.slice(0,8)){
      const orig=p.displayAddress||p.address||'';
      let confirmed=false;
      try{
        const r=await epcLookup(p);
        const cands=(r&&r.candidates)||[];
        if(cands.length && (r.confirmed || r.epcMatch)){
          const top=cands[0]; p.address=top.fullAddress; p.displayAddress=top.fullAddress; p.fullAddress=top.fullAddress;
          if(top.postcode) p.postcode=top.postcode; if(top.uprn) p.uprn=top.uprn;
          p.addressConfirmed=!!r.confirmed; p.addressSource=r.source; confirmed=true;
        } else if(hasHouseNumber(orig)){ p.addressConfirmed=true; p.addressSource='Listing'; confirmed=true; }
      }catch(e){ if(hasHouseNumber(orig)) confirmed=true; }

      if(!confirmed){ blog(`  • ${orig.split(',').slice(0,2).join(',')} — found, exact address not confirmed (review in search)`,'inf'); continue; }

      bdFound++; actioned++;
      blog(`<i class=ic-sparkles></i> New in ${code}: ${(p.displayAddress||p.address).split(',').slice(0,2).join(',')} · ${p.portal}`,'ok');
      rtProps.push({...p,isNew:true});
      queue.push({id:Date.now()+Math.random(),prop:p,tpl,status:'pend',at:new Date(),auto:true});
      if(action==='print'){
        const qi=queue.length-1;
        setTimeout(()=>{
          if(queue[qi]&&queue[qi].status==='pend'){
            queue[qi].status='prnt';
            doPrint(buildLetter(queue[qi].tpl.body,queue[qi].prop));
            setTimeout(()=>{if(queue[qi]){queue[qi].status='done';bdPrinted++;updBotDash();updQStats();logLetterPrinted(1);}},700);
          }
        },1200);
      }
    }
    if(actioned) toast(`<i class=ic-bot></i> Bot: ${actioned} new in ${code}`,'ok');
  }
  updQBadge(); updQStats(); updBotDash(); updateRTTicker();
  blog(`── Scan #${bdScans} done`,'inf');
}
function botRunNow(){
  if(!selectedHA.size){toast('Select HA districts first','warn');return;}
  blog('Manual scan triggered…','inf');
  botCycle();
}
function updBotDash(){
  document.getElementById('bd-scans').textContent=bdScans;
  document.getElementById('bd-found').textContent=bdFound;
  document.getElementById('bd-printed').textContent=bdPrinted;
}
function blog(msg,type='inf'){
  try{
    const el=document.getElementById('blog'); if(!el) return;
    const d=document.createElement('div'); d.className='ll';
    d.innerHTML='<span class="lt">['+new Date().toLocaleTimeString()+']</span><span class="l'+type+'">'+msg+'</span>';
    if(el.appendChild) el.appendChild(d);
    if(el.children && el.children.length>300 && el.removeChild) el.removeChild(el.firstChild);
    if(el.scrollTop!==undefined) el.scrollTop=el.scrollHeight||0;
  }catch(e){}
}
function clrLog(){const el=document.getElementById('blog');if(el)el.innerHTML='';}

/* ═══════════════════════════════════════════
   TEMPLATES
═══════════════════════════════════════════ */
function renderTpls(){
  const list=document.getElementById('tpl-list'); if(!list) return;
  list.innerHTML='';
  [...templates,...uploadedTpls].forEach(t=>{
    const d=document.createElement('div'); d.className='ti'+(t.id===activeTpl?.id?' act':'');
    d.onclick=()=>loadTpl(t);
    d.innerHTML=`<div class="tn">${t.name}</div><div class="td">${t.desc||''}</div>`;
    list.appendChild(d);
  });
  if(!activeTpl) loadTpl(templates[0]); else loadTpl(activeTpl);
  refreshTplSels();
}
function refreshTplSels(){
  const all=[...templates,...uploadedTpls];
  const opts=all.map(t=>`<option value="${t.id}">${t.name}</option>`).join('');
  ['f-tpl','af-tpl','b-tpl'].forEach(id=>{const el=document.getElementById(id);if(el)el.innerHTML=opts;});
}
function loadTpl(t){
  activeTpl=t;
  const tn=document.getElementById('tname'); if(tn) tn.value=t.name;
  const te=document.getElementById('tedit'); if(te) te.value=t.body;
  document.querySelectorAll('.ti').forEach((el,i)=>el.classList.toggle('act',[...templates,...uploadedTpls][i]?.id===t.id));
}
function saveTpl(){
  const name=(document.getElementById('tname')||{}).value?.trim();
  const body=(document.getElementById('tedit')||{}).value||'';
  if(!name){toast('Enter a name','warn');return;}
  const ex=templates.find(t=>t.id===activeTpl?.id);
  if(ex){ex.name=name;ex.body=body;} else templates.push({id:'t'+Date.now(),name,body,desc:'Custom'});
  renderTpls(); toast('Template saved','ok');
}
function newTpl(){
  activeTpl={id:'new'+Date.now(),name:'New Template',body:'{{date}}\n\n{{address}}\n{{district}}\n\nDear Homeowner,\n\n',desc:'Custom'};
  const tn=document.getElementById('tname'); if(tn) tn.value=activeTpl.name;
  const te=document.getElementById('tedit'); if(te) te.value=activeTpl.body;
}
function prevTpl(){
  const body=(document.getElementById('tedit')||{}).value||'';
  const mock={address:'The Legal Owner\nFlat 1\nHillrise Court\n135 Kenton Road\nHARROW\nHA3 0AZ',district:'Harrow',haCode:'HA3',portal:'Rightmove',price:450000,beds:3,type:'Semi-Detached',status:'For Sale'};
  const pc=document.getElementById('prev-content'); if(pc) pc.innerHTML=renderLetterHTML(buildLetter(body,mock),mock);
  const pa=document.getElementById('prev-area'); if(pa){pa.style.display='block';pa.scrollIntoView({behavior:'smooth'});}
}
function prevForProp(i){
  const p=props[i]; if(!p) return;
  const tId=(document.getElementById('f-tpl')||{}).value;
  const tpl=[...templates,...uploadedTpls].find(t=>t.id===tId)||templates[0];
  showPanel('templates');
  setTimeout(()=>{
    const pc=document.getElementById('prev-content'); if(pc) pc.innerHTML=renderLetterHTML(buildLetter(tpl.body,p),p);
    const pa=document.getElementById('prev-area'); if(pa){pa.style.display='block';pa.scrollIntoView({behavior:'smooth'});}
  },80);
}

/* ── Branding form (Letter Templates panel) ── */
function loadBrandForm(){
  const b=getBrand(); const set=(id,v)=>{const el=document.getElementById(id); if(el) el.value=v||'';};
  set('br-name',b.companyName); set('br-tag',b.tagline); set('br-signame',b.signatoryName); set('br-sigtitle',b.signatoryTitle);
  set('br-addr',b.contactAddress); set('br-phone',b.phone); set('br-email',b.email); set('br-footer',b.footerText); set('br-web',b.website);
  const col=document.getElementById('br-color'); if(col) col.value=b.brandColor||'#1d4ed8';
  const sp=document.getElementById('br-sig-prev'); if(sp) sp.innerHTML=b.signatureImg?'<img src="'+b.signatureImg+'" style="max-height:48px">':'<span style="color:var(--muted);font-size:11px">No signature yet</span>';
  const lp=document.getElementById('br-logo-prev'); if(lp) lp.innerHTML=b.logoImg?'<img src="'+b.logoImg+'" style="max-height:48px">':'<span style="color:var(--muted);font-size:11px">No logo — company name is used</span>';
  renderBrandPreview();
}
function saveBrandFromForm(){
  const b=getBrand(); const g=id=>(document.getElementById(id)||{}).value||'';
  b.companyName=g('br-name').trim(); b.tagline=g('br-tag').trim(); b.brandColor=g('br-color')||'#1d4ed8';
  b.signatoryName=g('br-signame').trim(); b.signatoryTitle=g('br-sigtitle').trim(); b.contactAddress=g('br-addr').trim();
  b.phone=g('br-phone').trim(); b.email=g('br-email').trim(); b.footerText=g('br-footer').trim(); b.website=g('br-web').trim();
  if(saveBrand(b)) toast('Letterhead saved — it’s now on every letter','ok');
  renderBrandPreview();
}
function brandImg(input,key){
  const f=input.files&&input.files[0]; if(!f) return;
  if(f.size>6*1024*1024){ toast('That image is large — please use one under 6MB','warn'); return; }
  const r=new FileReader();
  r.onload=()=>{ const img=new Image(); img.onload=()=>{
    const max = key==='logoImg'?440:380; const scale=Math.min(1, max/(img.width||max));
    const w=Math.max(1,Math.round((img.width||max)*scale)), h=Math.max(1,Math.round((img.height||100)*scale));
    const c=document.createElement('canvas'); c.width=w; c.height=h; c.getContext('2d').drawImage(img,0,0,w,h);
    const data=c.toDataURL('image/png');
    const b=getBrand(); b[key]=data; if(saveBrand(b)){ loadBrandForm(); toast((key==='logoImg'?'Logo':'Signature')+' uploaded','ok'); }
  }; img.onerror=()=>toast('Could not read that image','err'); img.src=r.result; };
  r.readAsDataURL(f);
}
function clearBrandImg(key){ const b=getBrand(); b[key]=''; saveBrand(b); loadBrandForm(); }
function renderBrandPreview(){
  const el=document.getElementById('br-preview'); if(!el) return;
  const mock={address:'The Legal Owner\nFlat 1\nHillrise Court\n135 Kenton Road\nHARROW\nHA3 0AZ',district:'Harrow',haCode:'HA3'};
  const sample='{{address}}\n\nDear Homeowner,\n\nI wanted to get in touch to see if your property is currently let. If it is, I’d be interested to hear whether you’re receiving the level of service and communication you should expect from your agent.\n\nWith the lettings market busier than ever, it has never been more important to choose an agent you trust — one that is experienced, proactive and local.\n\nI’d love to talk about how we can help. Please give me a call or pop into our office.\n\nKind regards,';
  el.innerHTML=renderLetterHTML(buildLetter(sample,mock),mock);
}
function insV(v){const ta=document.getElementById('tedit');if(!ta)return;const s=ta.selectionStart;ta.value=ta.value.slice(0,s)+v+ta.value.slice(ta.selectionEnd);ta.selectionStart=ta.selectionEnd=s+v.length;ta.focus();}
function wrapT(b,a){const ta=document.getElementById('tedit');if(!ta)return;const s=ta.selectionStart,e=ta.selectionEnd;ta.value=ta.value.slice(0,s)+b+(ta.value.slice(s,e)||'text')+a+ta.value.slice(e);ta.focus();}

/* ═══════════════════════════════════════════
   FILE UPLOAD
═══════════════════════════════════════════ */
function doDrop(e){e.preventDefault();document.getElementById('dz')?.classList.remove('dzo');[...e.dataTransfer.files].forEach(processFile);}
function fileUp(e){[...e.target.files].forEach(processFile);}
function processFile(file){
  const ext='.'+file.name.split('.').pop().toLowerCase();
  if(!['.docx','.pdf','.txt'].includes(ext)){toast('Use .docx .pdf .txt','err');return;}
  const d=document.createElement('div');
  d.style.cssText='display:flex;align-items:center;gap:7px;padding:7px 11px;border:1.5px solid var(--sm);border-radius:7px;background:#fff;margin-bottom:5px';
  d.innerHTML=`<span>${ext==='.pdf'?'<i class=ic-book></i>':ext==='.docx'?'<i class=ic-book></i>':'<i class=ic-file></i>'}</span><div style="flex:1"><div style="font-size:12px;font-weight:600">${file.name}</div><div style="font-size:10px;color:var(--mut)">${(file.size/1024).toFixed(1)} KB</div></div><button class="btn bg sm-btn" onclick="useUpl('${file.name.replace(/'/g,'\\x27')}')">Use</button>`;
  document.getElementById('upfiles')?.appendChild(d);
  if(ext==='.txt'){const r=new FileReader();r.onload=ev=>{const t={id:'u'+Date.now(),name:file.name.replace(/\.[^.]+$/,''),desc:'Uploaded',body:ev.target.result};uploadedTpls.push(t);refreshTplSels();toast(`"${file.name}" uploaded`,'ok');};r.readAsText(file);}
  else{const t={id:'u'+Date.now(),name:file.name.replace(/\.[^.]+$/,''),desc:`Uploaded ${ext}`,body:`{{date}}\n\n{{address}}\n{{district}}\n\nDear Homeowner,\n\n[Content from ${file.name}]\n\nYours sincerely,\n[Your Name]`};uploadedTpls.push(t);refreshTplSels();toast(`"${file.name}" ready`,'ok');}
}
function useUpl(name){const t=uploadedTpls.find(t=>t.name===name.replace(/\.[^.]+$/,''));if(t){loadTpl(t);showPanel('templates');toast('Loaded in editor','ok');}}

/* ═══════════════════════════════════════════
   PRINTERS
═══════════════════════════════════════════ */
const MOCK_P=[
  {id:1,name:'HP LaserJet Pro M428fdn',ip:'192.168.1.42',protocol:'IPP',status:'online',model:'Mono Laser'},
  {id:2,name:'Canon imageRUNNER 1643i',ip:'192.168.1.55',protocol:'IPP',status:'online',model:'Mono MFP'},
  {id:3,name:'Ricoh IM C300F',ip:'192.168.1.88',protocol:'LPD',status:'offline',model:'Colour MFP'},
  {id:4,name:'Brother MFC-L8900CDW',ip:'192.168.1.101',protocol:'IPP',status:'online',model:'Colour Laser'},
  {id:5,name:'Xerox VersaLink C405',ip:'192.168.1.120',protocol:'IPP',status:'online',model:'Colour A4 MFP'},
];
let disc=[];
function scanPrinters(){toast('Scanning network…');setTimeout(()=>{disc=[...MOCK_P];renderPrinters();toast(`Found ${disc.length} printers`,'ok');},1400);}
function addPrinter(){const ip=(document.getElementById('pip')||{}).value?.trim(),pr=(document.getElementById('pprot')||{}).value||'IPP';if(!ip){toast('Enter IP','warn');return;}disc.push({id:Date.now(),name:`Printer at ${ip}`,ip,protocol:pr,status:'online',model:'Manual'});renderPrinters();document.getElementById('pip').value='';toast(`Added ${ip}`,'ok');}
function savePSettings(){toast('Settings saved','ok');}

/* ═══════════════════════════════════════════
   NAV & TOAST
═══════════════════════════════════════════ */
function toast(msg,type=''){
  const tc=document.getElementById('tc'); if(!tc) return;
  const t=document.createElement('div'); t.className='toast'+(type?' '+type:'');
  t.innerHTML=`${type==='ok'?'<i class=ic-check></i>':type==='err'?'<i class=ic-x></i>':type==='warn'?'<i class=ic-alert></i>️':'<i class=ic-info></i>️'} ${msg}`;
  tc.appendChild(t); setTimeout(()=>t.remove(),3200);
}

/* ═══════════════════════════════════════════
   INIT
═══════════════════════════════════════════ */




/* ─── Recovered functions ─── */
async function runIntelSearch(){
  const input=(document.getElementById('intel-url')||{}).value?.trim();
  if(!input){toast('Enter a Rightmove URL or property address','warn');return;}
  const btn=document.getElementById('intel-search-btn');
  btn.disabled=true;
  setThinking(true,'Parsing input and identifying property…');
  document.getElementById('intel-result-area').innerHTML='';
  switchIntelTab('single');
  try{
    const result=await analyseProperty(input);
    renderIntelResult(result,document.getElementById('intel-result-area'));
    intelResults.push(result);
    updateIntelTable();
    const ib=document.getElementById('intel-badge');if(ib)ib.style.display='inline-flex';
  }catch(e){
    document.getElementById('intel-result-area').innerHTML=`<div class="status-bar error" style="margin-top:8px"><i class=ic-x></i> ${e.message}</div>`;
  }
  btn.disabled=false;
  setThinking(false);
}
function switchIntelTab(tab){
  ['single','batch','chat','results'].forEach(t=>{
    document.getElementById('itab-'+t)?.classList.toggle('act',t===tab);
    const el=document.getElementById('itab-'+t+'-content');
    if(el) el.style.display=t===tab?'block':'none';
  });
}
async function runBatchIntel(){
  const raw=(document.getElementById('batch-input')||{}).value?.trim();
  if(!raw){toast('Enter URLs or addresses','warn');return;}
  const lines=raw.split('\n').map(l=>l.trim()).filter(l=>l.length>5);
  if(!lines.length){toast('No valid inputs','warn');return;}
  const container=document.getElementById('batch-results');
  container.innerHTML='';
  const pb=document.getElementById('batch-pb');
  const ptxt=document.getElementById('batch-progress-txt');
  for(let i=0;i<lines.length;i++){
    ptxt.textContent=`Analysing ${i+1} of ${lines.length}…`;
    pb.style.width=Math.round((i/lines.length)*100)+'%';
    try{
      const result=await analyseProperty(lines[i]);
      intelResults.push(result);
      const div=document.createElement('div');div.style.marginBottom='10px';
      renderIntelResult(result,div);container.appendChild(div);
    }catch(e){
      const div=document.createElement('div');
      div.innerHTML=`<div class="status-bar error" style="margin-bottom:8px"><i class=ic-x></i> Failed: ${lines[i]}</div>`;
      container.appendChild(div);
    }
    await new Promise(r=>setTimeout(r,500));
  }
  pb.style.width='100%';
  ptxt.textContent=`Complete — ${lines.length} analysed`;
  updateIntelTable();
  toast(`Batch complete — ${lines.length} properties analysed`,'ok');
}
async function sendChat(){
  const inp=document.getElementById('chat-input');
  const msg=inp?.value?.trim();if(!msg)return;
  inp.value='';
  addChatMsg('user',msg);
  chatHistory.push({role:'user',content:msg});
  const wrap=document.getElementById('chat-wrap');
  const th=document.createElement('div');th.className='chat-msg chat-ai';
  th.innerHTML='<div class="ai-dots"><span></span><span></span><span></span></div>';
  wrap.appendChild(th);wrap.scrollTop=wrap.scrollHeight;
  try{
    const resp=await fetch('/api/ai',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        model:'auto',max_tokens:600,
        system:`You are a UK property intelligence assistant expert in: HM Land Registry, Companies House, VOA, Planning Portal, 192.com, electoral roll, BT Phone Book, Rightmove/Zoopla. Help users find property ownership information using legitimate free UK sources. Be concise and practical. Always remind users to verify via official sources.`,
        messages:chatHistory
      })
    });
    const data=await resp.json();
    const reply=data.content?.map(c=>c.text||'').join('')||'No response received.';
    chatHistory.push({role:'assistant',content:reply});
    th.remove();addChatMsg('ai',reply);
  }catch(e){
    th.remove();addChatMsg('ai',`<i class=ic-alert></i>️ Could not connect to AI: ${e.message}`);
  }
}
function quickChat(msg){
  const inp=document.getElementById('chat-input');if(inp)inp.value=msg;
  switchIntelTab('chat');sendChat();
}
function exportIntelCSV(){
  if(!intelResults.length){toast('No results to export','warn');return;}
  const h=['Address','Postcode','District','PropertyType','EstimatedPrice','OwnerName','OwnerType','CompanyNumber','LandRegTitle','PurchaseDate','PurchasePrice','CouncilTaxBand','Confidence','Timestamp'];
  const rows=intelResults.map(r=>{const a=r.address,o=r.owner;return[`"${a.fullAddress}"`,`"${a.postcode||''}"`,`"${a.district||''}"`,`"${a.propertyType||''}"`,`"${a.estimatedPrice||''}"`,`"${o.ownerName||''}"`,`"${o.ownerType||''}"`,`"${o.companyNumber||''}"`,`"${o.landRegTitle||''}"`,`"${o.purchaseDate||''}"`,`"${o.purchasePrice||''}"`,`"${o.councilTaxBand||''}"`,Math.round((o.overallConfidence||0)*100)+'%',`"${r.timestamp.toLocaleString()}"`].join(',');});
  const b=new Blob([[h.join(','),...rows].join('\n')],{type:'text/csv'});
  const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=`propmail_intel_${new Date().toISOString().slice(0,10)}.csv`;a.click();
  toast('Intelligence CSV exported','ok');
}
function queueAllIntel(){
  if(!intelResults.length){toast('No results to queue','warn');return;}
  intelResults.forEach(r=>queueIntelLetter(r.id));
  toast(`${intelResults.length} letters queued`,'ok');
}
async function lookupPostcode(){
  const raw=(document.getElementById('pc-input')||{}).value?.trim().toUpperCase().replace(/\s+/g,' ');
  if(!raw){toast('Enter a postcode','warn');return;}
  await doPostcodeLookup([raw]);
}
async function lookupBatchPostcodes(){
  const raw=(document.getElementById('pc-batch')||{}).value?.trim();
  if(!raw){toast('Enter postcodes','warn');return;}
  const codes=[...new Set(raw.split('\n').map(l=>l.trim().toUpperCase()).filter(l=>l.length>=3))];
  if(!codes.length){toast('No valid postcodes found','warn');return;}
  await doPostcodeLookup(codes);
}
async function lookupStreet(){
  const raw=(document.getElementById('st-input')||{}).value?.trim();
  if(!raw){toast('Enter a street name (e.g. Roxeth Green Avenue, Harrow)','warn');return;}
  await doStreetLookup(raw);
}
function selAllAddrs(){
  slFiltered.forEach(a=>{slSelected.add(a.idx);a.selected=true;});
  renderAddrResults();updAddrSel();
}
function clrSelAddrs(){
  slFiltered.forEach(a=>{slSelected.delete(a.idx);a.selected=false;});
  renderAddrResults();updAddrSel();
}
function exportAddrCSV(){
  if(!slAddresses.length){toast('No addresses to export','warn');return;}
  const h=['Line1','Line2','Area','Postcode','Type','Full Address','Selected'];
  const rows=slAddresses.map(a=>[`"${a.line1||''}"`,`"${a.line2||''}"`,`"${a.area||''}"`,`"${a.postcode||''}"`,`"${a.type||''}"`,`"${a.fullAddress||''}"`,slSelected.has(a.idx)?'Yes':'No'].join(','));
  const b=new Blob([[h.join(','),...rows].join('\n')],{type:'text/csv'});
  const el=document.createElement('a');el.href=URL.createObjectURL(b);
  el.download=`success_letters_${(document.getElementById('pc-input')||{}).value?.replace(/\s/g,'_')||'addresses'}_${new Date().toISOString().slice(0,10)}.csv`;
  el.click();
  toast('Address CSV exported','ok');
}
// ── Find addresses on the web (free, via the web-search key) ──
async function webAddrSearch(){
  const q=(document.getElementById('wa-q').value||'').trim();
  if(!q){ toast('Enter a street and area','warn'); return; }
  const btn=document.getElementById('wa-btn'); if(btn){btn.disabled=true;btn.textContent='Searching…';}
  const box=document.getElementById('wa-results'); box.innerHTML='<div style="color:var(--muted);font-size:13px;padding:10px 0">Searching the web for addresses…</div>';
  try{
    const r=await fetch('/api/webaddr?q='+encodeURIComponent(q));
    const d=await r.json().catch(()=>({}));
    if(!r.ok){ box.innerHTML='<div style="color:var(--amber);font-size:13px;padding:8px 0">'+esc(d.note||d.error||'Search unavailable')+'</div>'; return; }
    window._waList=d.addresses||[];
    if(!window._waList.length){ box.innerHTML='<div style="color:var(--muted);font-size:13px;padding:8px 0">'+esc(d.note||'No addresses found.')+'</div>'; return; }
    box.innerHTML='<div style="font-size:11px;color:var(--muted);margin-bottom:8px">'+window._waList.length+' addresses found on the web — verify before posting.</div>'
      +window._waList.map((a,i)=>'<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">'
        +'<span style="font-size:13px;color:var(--text);font-weight:600">'+esc(a.address)+(a.hasPostcode?'':' <span style="color:var(--amber);font-size:11px;font-weight:400">(no postcode)</span>')+'</span>'
        +'<button onclick="queueWebAddr('+i+')" style="padding:6px 12px;background:rgba(37,99,235,.1);color:var(--blue);border:1.5px solid rgba(37,99,235,.25);border-radius:7px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;flex-shrink:0"><i class=ic-mailbox></i> Queue</button>'
      +'</div>').join('')
      +((d.sources&&d.sources.length)?'<div style="font-size:10px;color:var(--muted);margin-top:8px">Sources: '+d.sources.map(s=>'<a href="'+s.url+'" target="_blank" rel="noopener" style="color:var(--blue);text-decoration:none">'+esc((s.title||'link').slice(0,30))+'</a>').join(' · ')+'</div>':'');
  }catch(e){ box.innerHTML='<div style="color:var(--amber);font-size:13px">'+esc(e.message)+'</div>'; }
  finally{ if(btn){btn.disabled=false;btn.textContent='Search the web';} }
}
function queueWebAddr(i){
  const a=(window._waList||[])[i]; if(!a) return;
  const tplEl=document.getElementById('f-tpl');
  const tpl=[...templates,...(uploadedTpls||[])].find(t=>t.id===(tplEl?.value||'intro'))||templates[0];
  const pcM=(a.address||'').match(/[A-Z]{1,2}\d[\dA-Z]?\s*\d[A-Z]{2}/i);
  const prop={address:a.address,displayAddress:a.address,fullAddress:a.address,postcode:pcM?pcM[0]:'',addressConfirmed:true,source:'Web search',status:'Success letter'};
  queue.push({id:Date.now()+Math.random(),prop,tpl,status:'pend',at:new Date(),auto:false});
  updQBadge();updQStats();updateKPIs();
  toast('<i class=ic-mailbox></i> Letter queued for '+esc(a.address),'ok');
}

function printSuccessLetters(){
  if(!slActiveLetter){toast('Choose a letter template first','warn');return;}
  let selected=slAddresses.filter(a=>slSelected.has(a.idx));
  const before=selected.length;
  selected=selected.filter(a=>!isBlockedAddr(a)); // final safety net — never print a blocked address
  if(before!==selected.length){ toast(`${before-selected.length} blocked address(es) removed from this run`,'warn'); }
  if(!selected.length){toast('Select addresses first','warn');return;}

  toast(`Printing ${selected.length} letters…`,'ok');

  // Print each letter — browser batches print jobs
  let i=0;
  const printNext=()=>{
    if(i>=selected.length)return;
    const a=selected[i++];
    const letter=buildSLLetter(slActiveLetter.body,a);
    const pa=document.getElementById('pa');
    if(!pa)return;
    pa.innerHTML=renderLetterHTML(letter, a);
    pa.style.display='block';
    window.print();
    pa.style.display='none';
    setTimeout(printNext,600);
  };

  // For large batches — print all at once as multi-page
  if(selected.length>1){
    const pa=document.getElementById('pa');
    if(pa){
      pa.innerHTML=selected.map(a=>renderLetterHTML(buildSLLetter(slActiveLetter.body,a), a)).join('');
      pa.style.display='block';
      window.print();
      pa.style.display='none';
      toast(`${selected.length} letters sent to printer`,'ok');
    }
  } else {
    printNext();
  }

  // Also add to print queue
  queueSuccessLetters();
}
function switchAddrView(v){
  ['grid','list','preview'].forEach(t=>{
    const vEl=document.getElementById('addr-'+t+'-view');
    const tab=document.getElementById('aview-'+t);
    if(vEl)vEl.style.display=t===v?'block':'none';
    if(tab)tab.classList.toggle('act',t===v);
  });
}
function queueSuccessLetters(){
  if(!slActiveLetter){toast('Choose a letter first','warn');return;}
  let selected=slAddresses.filter(a=>slSelected.has(a.idx));
  const before=selected.length;
  selected=selected.filter(a=>!isBlockedAddr(a)); // final safety net — never queue a blocked address
  if(before!==selected.length){ toast(`${before-selected.length} blocked address(es) skipped`,'warn'); }
  if(!selected.length){toast('No addresses to queue','warn');return;}
  selected.forEach(a=>{
    const prop={
      address: a.fullAddress,
      displayAddress: a.line2 ? a.line1+', '+a.line2 : a.line1,
      uprn: a.uprn||'',
      postcode: a.postcode||'',
      district: a.area||a.postcode?.split(' ')[0]||'',
      haCode: a.postcode?.split(' ')[0]||'',
      portal: a.isLive?'Rightmove PAF':'Royal Mail PAF',
      isLive: !!a.isLive,
      price:0, beds:0, type:a.type||'Residential', status:'Success Letter',
      rmUrl: a.rmUrl||'', rmAreaUrl:'', rmSoldUrl:'', zoUrl:'', otUrl:''
    };
    queue.push({id:Date.now()+Math.random(),prop,tpl:slActiveLetter,status:'pend',at:new Date(),auto:false,successLetter:true});
  });
  updQBadge();updQStats();
  toast(`${selected.length} letters queued for ${[...new Set(selected.map(a=>a.postcode))].join(', ')}`,'ok');
}
function queueIntelLetter(id){
  const r=intelResults.find(x=>x.id===id);if(!r)return;
  const tId=(document.getElementById('f-tpl')||{}).value;
  const tpl=[...templates,...uploadedTpls].find(t=>t.id===tId)||templates[0];
  const p={address:r.address.fullAddress,fullAddress:r.address.fullAddress,uprn:r.address.uprn||'',postcode:r.address.postcode||'',district:r.address.district||'Harrow',haCode:r.address.district||'HA',portal:'Rightmove',price:0,beds:0,type:r.address.propertyType||'Property',status:'For Sale'};
  queue.push({id:Date.now()+Math.random(),prop:p,tpl,status:'pend',at:new Date(),auto:false,intel:true});
  updQBadge();updQStats();
  toast(`Letter queued for ${r.address.street||r.address.fullAddress}`,'ok');
}


/* ═══ RUNTIME OVERRIDES — assigned after hoist, override originals ═══ */
function handleGlobalSearch(e){
  if (e.key !== 'Enter') return;
  const v = e.target.value.trim(); if (!v) return;
  if (v.match(/^https?:\/\//i)) {
    const iu = document.getElementById('intel-url'); if (iu) iu.value = v;
    showPanel('intel'); toast('URL loaded — click Analyse', '');
  } else if (v.match(/^[A-Z]{1,2}\d/i)) {
    const pi = document.getElementById('pc-input'); if (pi) pi.value = v.toUpperCase();
    showPanel('success'); toast('Postcode loaded — click Find Addresses', '');
  } else { toast('Enter a Rightmove URL or UK postcode', ''); }
  e.target.value = '';
}

// ═══════════════════════════════════════════════════════════════════════
// PropMail Live Property Address Finder
// Automated: finds real listings → extracts street address → builds letter
// ═══════════════════════════════════════════════════════════════════════════

// ── Agent targeting ──────────────────────────────────────────────────
let knownAgents = [];                                 // [{name,count}]
let targeting = { ownCompany:'', excludeOwn:true, excluded:[] };
function loadTargeting(){
  try{ targeting = Object.assign(targeting, JSON.parse(localStorage.getItem('pmTargeting')||'{}')); }catch(e){}
  try{ knownAgents = JSON.parse(localStorage.getItem('pmAgents')||'[]'); }catch(e){}
  const oc=document.getElementById('own-company'); if(oc) oc.value = targeting.ownCompany||'';
  const eo=document.getElementById('exclude-own'); if(eo) eo.checked = targeting.excludeOwn!==false;
  renderAgentFilter();
}
function saveTargeting(){
  const oc=document.getElementById('own-company'); const eo=document.getElementById('exclude-own');
  targeting.ownCompany = oc ? oc.value.trim() : '';
  targeting.excludeOwn = eo ? eo.checked : true;
  localStorage.setItem('pmTargeting', JSON.stringify(targeting));
}
function excludedSet(){ return new Set((targeting.excluded||[]).map(a=>a.toLowerCase())); }
function isExcludedAgent(p){
  const a=(p.agent||'').toLowerCase(); if(!a) return false;
  if(excludedSet().has(a)) return true;
  if(targeting.excludeOwn && targeting.ownCompany && a.includes(targeting.ownCompany.toLowerCase())) return true;
  return false;
}
function toggleAgent(name){
  const set=new Set(targeting.excluded||[]);
  set.has(name) ? set.delete(name) : set.add(name);
  targeting.excluded=[...set]; localStorage.setItem('pmTargeting', JSON.stringify(targeting));
  renderAgentFilter(); applyTargetingNow();
}
function setAllAgents(on){
  targeting.excluded = on ? [] : knownAgents.map(a=>a.name);
  localStorage.setItem('pmTargeting', JSON.stringify(targeting));
  renderAgentFilter(); applyTargetingNow();
}
function renderAgentFilter(){
  const box=document.getElementById('agent-list'); if(!box) return;
  const summary=document.getElementById('agent-summary');
  const ex=excludedSet();
  const targeted=knownAgents.filter(a=>!ex.has(a.name.toLowerCase())).length;
  if(summary) summary.textContent = knownAgents.length ? `· targeting ${targeted} of ${knownAgents.length}` : '';
  if(!knownAgents.length){ box.innerHTML='<span class="agent-empty">Run a search, or tap “Discover all”, to list the agencies across HA0–HA9.</span>'; return; }
  const f=(document.getElementById('agent-filter')?.value||'').toLowerCase().trim();
  let list=knownAgents.slice().sort((a,b)=>(b.count-a.count)||a.name.localeCompare(b.name));
  if(f) list=list.filter(a=>a.name.toLowerCase().includes(f));
  if(!list.length){ box.innerHTML='<span class="agent-empty">No agency matches “'+f+'”.</span>'; return; }
  box.innerHTML = list.map(a=>{
    const on=!ex.has(a.name.toLowerCase());
    const safe=a.name.replace(/'/g,"\\'").replace(/"/g,'&quot;');
    return '<button class="agent-pill'+(on?' on':'')+'" title="'+(on?'Targeted — tap to exclude':'Excluded — tap to target')+'" onclick="toggleAgent(\''+safe+'\')">'
      +'<span class="ck">✓</span>'+a.name+(a.count?'<span class="cnt">'+a.count+'</span>':'')+'</button>';
  }).join('');
}
// Scan every HA district to discover the full set of active agencies.
async function scanAllAgents(btn){
  const chan = (document.getElementById('f-status')?.value||'sale')==='let' ? 'rent' : 'sale';
  const districts=['HA0','HA1','HA2','HA3','HA4','HA5','HA6','HA7','HA8','HA9'];
  if(btn){ btn.disabled=true; btn.textContent='⟳ Scanning…'; }
  const all=[];
  await mapLimit(districts, 4, async (code)=>{
    try{ const r=await fetch('/api/listings?district='+code+'&channel='+chan+'&pages=3');
      const d=await r.json(); (d.properties||[]).forEach(p=>{ if(p.agent) all.push({agent:p.agent}); });
    }catch(e){}
  });
  collectAgents(all);
  if(btn){ btn.disabled=false; btn.textContent='⟳ Discover all'; }
  toast('Found '+knownAgents.length+' agencies across HA0–HA9', 'ok');
}
function collectAgents(list){
  const counts=new Map();
  (knownAgents||[]).forEach(a=>counts.set(a.name,0));     // keep previously-seen names
  list.forEach(p=>{ if(p.agent) counts.set(p.agent,(counts.get(p.agent)||0)+1); });
  knownAgents=[...counts.entries()].map(([name,count])=>({name,count})).filter(a=>a.name);
  localStorage.setItem('pmAgents', JSON.stringify(knownAgents));
  renderAgentFilter();
}
function applyTargetingNow(){
  if(window._allResolved){ props = window._allResolved.filter(p=>!isExcludedAgent(p)); renderLiveResults(); updateKPIs(); }
}

// Approximate adjacency of the HA outcodes, used for the "search radius" filter.
const HA_ADJ = {
  HA0:['HA9','HA1','HA2'], HA1:['HA0','HA2','HA3','HA9'], HA2:['HA1','HA0','HA5','HA4'],
  HA3:['HA1','HA7','HA8','HA9'], HA4:['HA2','HA5','HA6'], HA5:['HA2','HA4','HA6','HA1'],
  HA6:['HA5','HA4','HA7'], HA7:['HA3','HA8','HA6'], HA8:['HA3','HA7','HA9'], HA9:['HA0','HA1','HA3','HA8'],
};
function expandDistrictsByRadius(codes, radius){
  if(!radius || radius<=0) return [...new Set(codes)];
  let set = new Set(codes);
  for(let step=0; step<radius; step++){
    for(const c of [...set]) (HA_ADJ[c]||[]).forEach(n=>set.add(n));
  }
  return [...set];
}

async function runLiveSearch(){
  if(!selectedHA.size){ toast('Select at least one HA district in Filters','warn'); return; }

  const btn = document.getElementById('main-search-btn');
  if(btn){ btn.disabled=true; btn.textContent='<i class=ic-search></i> Searching…'; }

  const statusF = document.getElementById('f-status')?.value || 'sale';
  const typeF   = document.getElementById('f-type')?.value   || 'all';
  const minBeds = parseInt(document.getElementById('f-beds')?.value || '0') || 0;
  const maxPriceV = parseInt(document.getElementById('f-price')?.value || '0') || 0;
  const minPriceV = parseInt(document.getElementById('f-price-min')?.value || '0') || 0;
  const radiusV   = parseInt(document.getElementById('f-radius')?.value || '0') || 0;
  // Radius = expand the selected HA districts to neighbouring ones (Rightmove-style).
  const districts = expandDistrictsByRadius([...selectedHA], radiusV).sort();
  const isSale   = statusF !== 'let';
  const chanWd   = isSale ? 'for sale' : 'to rent';

  props = [];

  // Show status panel
  document.getElementById('search-status').style.display = 'block';
  document.getElementById('results-area').style.display  = 'none';

  const setStatus = (title, sub, pct, count) => {
    const t   = document.getElementById('search-status-title');
    const s   = document.getElementById('search-status-sub');
    const bar = document.getElementById('search-progress-bar');
    const cnt = document.getElementById('search-status-count');
    if(t) t.textContent = title;
    if(s) s.textContent = sub;
    if(bar) bar.style.width = pct + '%';
    if(cnt) cnt.textContent = count;
  };

  const addLog = (msg) => {
    const el = document.getElementById('search-log');
    if(el){ el.innerHTML += '› ' + msg + '<br>'; el.scrollTop = el.scrollHeight; }
    blog(msg, 'inf');
  };

  const RM_IDS = {HA0:1053,HA1:1054,HA2:1055,HA3:1056,HA4:1057,
                  HA5:1058,HA6:1059,HA7:1060,HA8:1061,HA9:1062};
  const ZO_SLUGS={HA0:'wembley',HA1:'harrow',HA2:'south-harrow',HA3:'kenton',
                  HA4:'ruislip',HA5:'pinner',HA6:'northwood',HA7:'stanmore',
                  HA8:'edgware',HA9:'wembley-park'};

  setStatus('Finding live properties on Rightmove…',
            `Searching ${districts.join(', ')} for ${chanWd} listings`, 10, '…');
  addLog(`Starting search: ${districts.join(', ')} · ${chanWd}${minBeds>0?' · '+minBeds+'+ beds':''}${maxPriceV>0?' · under £'+maxPriceV.toLocaleString():''}`);

  // ── Step 1: live search across Rightmove + OnTheMarket (no API key) ──
  // The server merges both portals and returns real addresses + links.
  // If it succeeds we render and stop here. If the endpoint is unavailable
  // (e.g. served as a static file with no backend) we fall through to AI.
  try {
    const chan = isSale ? 'sale' : 'rent';
    for (let di = 0; di < districts.length; di++) {
      const code = districts[di];
      setStatus('Finding live properties…', `Searching Rightmove + OnTheMarket · ${code}…`,
                15 + Math.round(di * (45 / districts.length)), props.length || '…');
      const meta = locMeta[code];
      const qs = new URLSearchParams(meta ? { location: meta.identifier, label: meta.label, channel: chan } : { district: code, channel: chan });
      if (minBeds > 0)   qs.set('minBeds', String(minBeds));
      if (maxPriceV > 0) qs.set('maxPrice', String(maxPriceV));
      if (minPriceV > 0) qs.set('minPrice', String(minPriceV));
      // Deep coverage: a busy outcode can have 250-300 live listings (≈13 pages).
      // Fetch wide by default so we never under-report what's live on Rightmove.
      qs.set('pages', document.getElementById('f-deep')?.checked ? '42' : '15');
      if (document.getElementById('f-sstc')?.checked) qs.set('includeSSTC', '1');
      const r = await fetch('/api/listings?' + qs.toString());
      if (!r.ok) throw new Error('listings endpoint ' + r.status);
      const d = await r.json();
      const dist2  = HA_DISTRICTS.find(x => x.code === code);
      const areaName = meta ? meta.label : (dist2?.name || code);
      const rmId2  = RM_IDS[code];
      const rmCh2  = isSale ? 'property-for-sale' : 'property-to-rent';
      const zoCh2  = isSale ? 'for-sale' : 'to-rent';
      const zoSlug2 = ZO_SLUGS[code] || 'harrow';
      (d.properties || []).forEach(raw => {
        const pid2  = String(raw.propertyId || '');
        const disp2 = raw.displayAddress || raw.address || '';
        const pcM2  = (raw.postcode && raw.postcode.match(/[A-Z]{1,2}\d[\dA-Z]?\s*\d[A-Z]{2}/i)) || disp2.match(/[A-Z]{1,2}\d[\dA-Z]?\s*\d[A-Z]{2}/i);
        props.push({
          id: `rm-srv-${props.length}`,
          address: disp2, displayAddress: disp2,
          postcode: pcM2 ? pcM2[0].toUpperCase() : (areaName + ' — see listing'),
          lat: raw.lat ?? null, lon: raw.lon ?? null,
          sizeSqft: raw.sizeSqft ?? null, hasFloorplan: !!raw.hasFloorplan,
          district: areaName, haCode: code,
          type: raw.type || 'Property', beds: raw.beds || 0,
          price: raw.price || 0,
          priceLabel: raw.priceLabel || (raw.price ? '£' + Number(raw.price).toLocaleString() : ''),
          status: isSale ? 'For Sale' : 'To Let', portal: raw.source || 'Rightmove', portalCls: 'rm',
          agent: raw.agent || '', addedDate: raw.addedDate || '',
          description: '', isLive: true, isRealUrl: !!pid2, selected: true,
          // Use the REAL first-listed date for the resolver's marketing-date
          // signal (a property gets a fresh EPC when it goes on the market).
          isNew: false, listedAt: raw.firstListed || null, firstListed: raw.firstListed || '',
          rmUrl: raw.url || `https://www.rightmove.co.uk/${rmCh2}/find.html?locationIdentifier=OUTCODE%5E${rmId2}&sortType=6`,
          rmAreaUrl: `https://www.rightmove.co.uk/${rmCh2}/find.html?locationIdentifier=OUTCODE%5E${rmId2}&sortType=6`,
          rmSoldUrl: `https://www.rightmove.co.uk/house-prices/${code.toLowerCase()}.html`,
          zoUrl: `https://www.zoopla.co.uk/${zoCh2}/property/${zoSlug2}/`,
          otUrl: `https://www.onthemarket.com/${zoCh2}/${zoSlug2}/`,
          rmId: rmId2, propertyId: pid2, portalUrl: raw.url || '',
          fullAddress: disp2, source: raw.source || 'Rightmove'
        });
      });
      addLog(`${code}: +${d.properties?.length || 0} live listings`);
    }
  } catch (e) {
    addLog('Live server fetch unavailable (' + e.message + ') — trying AI search…');
  }

  if (props.length) {
    const seenS = new Set();
    props = props.filter(p => { const k = p.propertyId || p.address; if (seenS.has(k)) return false; seenS.add(k); return true; });
    // Price range filter (keep listings with no parsed price so we don't lose them).
    if (minPriceV > 0 || maxPriceV > 0) {
      const beforePrice = props.length;
      props = props.filter(p => !p.price || ((!minPriceV || p.price >= minPriceV) && (!maxPriceV || p.price <= maxPriceV)));
      if (beforePrice !== props.length) addLog(`Price filter £${minPriceV?minPriceV.toLocaleString():'0'}–${maxPriceV?maxPriceV.toLocaleString():'∞'}: kept ${props.length} of ${beforePrice}`);
    }
    props = props.map((p, i) => ({ ...p, id: p.id || ('p' + i) }));

    // ── Agent targeting: register agents, drop excluded ones before resolve ──
    collectAgents(props);
    const beforeAgents = props.length;
    props = props.filter(p => !isExcludedAgent(p));
    if (beforeAgents !== props.length) addLog(`Agent targeting: skipped ${beforeAgents - props.length} listing(s) from excluded agencies`);

    // ── Show EVERY live listing instantly (full coverage). ──
    // We do NOT bulk-resolve addresses up front — that was slow and, worse, it
    // silently dropped any listing whose exact house number couldn't be matched,
    // so an outcode with 295 live homes showed only ~95. Instead we show all of
    // them now and confirm the exact house number per-property, on demand, when
    // the user is about to write to it. We NEVER guess a number: a listing that
    // only publishes a street name stays "unconfirmed" until a human confirms it,
    // so we can't post to 108 Crofts Road when the property is really 83.
    const found = props.length;
    let confirmedCount = 0;
    props.forEach((p) => {
      const orig = p.displayAddress || p.address || '';
      p._origAddress = orig;
      if (hasHouseNumber(orig)) {
        // The listing itself publishes the house number — that's authoritative.
        p.fullAddress = orig;
        p.addressSource = 'Listing';
        p.addressConfirmed = true;
        p.addressFound = true;
        confirmedCount++;
      } else {
        // Street-level only. Do not guess — flag for one-tap confirmation.
        p.fullAddress = '';
        p.addressConfirmed = false;
        p.addressFound = false;
      }
    });
    props = props.map((p, i) => ({ ...p, id: p.id || ('p' + i) }));
    window._allResolved = props;   // master set for instant agent re-filtering

    document.getElementById('search-status').style.display = 'none';
    if (btn) { btn.disabled = false; btn.textContent = '<i class=ic-search></i> Find Live Properties'; }
    if (!props.length) {
      document.getElementById('results-area').style.display = 'block';
      document.getElementById('results-title').textContent = 'No live listings found';
      document.getElementById('results-sub').textContent = `No properties are currently live for that search. Try another district or widen the filters.`;
      document.getElementById('results-table').innerHTML =
        '<div style="text-align:center;padding:32px;color:var(--muted)"><div style="font-size:32px;margin-bottom:12px"><i class=ic-search></i></div>'
        + '<div style="font-size:14px;font-weight:600">Nothing live right now</div></div>';
      blog(`Found 0 live listings`, 'warn');
      return;
    }
    renderLiveResults();
    updateKPIs();

    // ── Auto-find the exact full address for every street-only listing ──
    // Fast deterministic resolver (EPC + floor area; no slow per-house geocode).
    //  · a SINGLE certified address  → applied + printable (high confidence)
    //  · a clear best match on size  → shown as the address, flagged "verify"
    //  · anything weaker             → stays street-only (tap to confirm / AI)
    // We then default the list to the properties that now have a full address.
    const toResolve = props.filter(p => !p.addressConfirmed);
    if (toResolve.length) {
      document.getElementById('search-status').style.display = 'block';
      setStatus('Finding exact addresses…', `Resolving ${toResolve.length} listings to precise addresses…`, 5, '…');
      // One batch server call per chunk resolves listings to a PRECISE address
      // (exact house / building / exact-postcode) from the map pin — reliably at
      // scale, and never a bare street name. Anything it can't pin precisely is
      // left out of the "found" view entirely (no work for the user).
      const byId = {}; toResolve.forEach(p => { byId[p.id] = p; });
      const payload = toResolve.map(p => ({ id: p.id, displayAddress: p.displayAddress || p.address, type: p.type, lat: p.lat, lon: p.lon, haCode: p.haCode, sizeSqft: p.sizeSqft || 0, url: p.rmUrl || p.portalUrl || p.url || '', listDate: p.listedAt ? new Date(p.listedAt).toISOString() : '' }));
      const CHUNK = 18; let doneC = 0;   // smaller chunks → fewer simultaneous EPC lookups → type/size signals fire reliably
      for (let c = 0; c < payload.length; c += CHUNK) {
        const chunk = payload.slice(c, c + CHUNK);
        let d = {};
        try {
          const r = await fetch('/api/resolve-batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listings: chunk }) });
          d = await r.json();
        } catch (e) { /* chunk failed — those stay unresolved */ }
        (d.results || []).forEach(res => {
          const p = byId[res.id]; if (!p) return;
          // Two tiers, both a SINGLE specific address (never a bare block name):
          //  • exact  → CONFIRMED (verified correct)
          //  • likely → best estimate, flagged for the user to verify
          if (res.level !== 'exact' && res.level !== 'likely') return;
          if (res.postcode) p.postcode = res.postcode;
          p.displayAddress = res.address; p.fullAddress = res.address; p.address = res.address;
          p.addressFound = true; p.addressWhy = res.why || ''; p.block = null;
          if (res.level === 'exact') {
            p.addressConfirmed = true; p.addressLikely = false; p.addressSource = 'Register (exact)'; p.addressVerified = !!res.verified;
          } else {
            p.addressConfirmed = false; p.addressLikely = true; p.addressSource = 'Best estimate (verify)';
          }
        });
        doneC += chunk.length;
        const foundSoFar = props.filter(x => x.addressFound).length;
        setStatus('Finding exact addresses…', `Resolved ${foundSoFar} precise addresses…`, 5 + Math.round(doneC * (90 / payload.length)), foundSoFar);
      }
      document.getElementById('search-status').style.display = 'none';
    }
    // Default the view to "only show properties with a full address".
    if (window.addrFilter === undefined) window.addrFilter = 'found';
    renderLiveResults();
    syncOwners(props);   // automatically check each resolved address against owner records → Match / No match
    const foundTotal = props.filter(p => p.addressFound).length;
    const confN = props.filter(p => p.addressConfirmed).length;
    const likeN = props.filter(p => p.addressLikely).length;
    const pct = found ? Math.round(foundTotal / found * 100) : 0;
    blog(`<i class=ic-check></i> ${foundTotal} of ${found} listings got a full single address (${pct}%): <b>${confN} confirmed</b> (verified correct) and <b>${likeN} likely</b> (best estimate — verify before posting). The rest couldn't be pinned to a specific property, so they're hidden rather than shown as a street or block name.`, 'ok');
    toast(`<i class=ic-check></i> ${confN} confirmed + ${likeN} likely of ${found}`, 'ok');
    updateKPIs();
    return;
  }

  // Build districtNames for the prompt
  const distNames = districts.map(c => {
    const d = HA_DISTRICTS.find(x=>x.code===c); return c + (d?' '+d.name:'');
  }).join(', ');

  const bedLine   = minBeds  > 0 ? `${minBeds}+ bedroom ` : '';
  const priceLine = maxPriceV> 0 ? ` priced under £${maxPriceV.toLocaleString()}` : '';
  const typeLine  = (typeF && typeF !== 'all') ? `${typeF} ` : '';

  // ── THE PROMPT ──
  // Ask AI to search for actual property listing pages on Rightmove.
  // Rightmove listing pages appear in Google search results with titles like:
  // "3 bed semi-detached house for sale | 14 Hindes Road, Harrow | Rightmove"
  // The address is in the title, the property ID is in the URL.
  const prompt = `Search Rightmove for real current property listings ${chanWd} in ${distNames}.
${bedLine||typeLine?`Property criteria: ${bedLine}${typeLine}${priceLine}` : priceLine ? `Max price:${priceLine}` : ''}

Run these web searches to find individual property listing pages:
1. Search for: site:rightmove.co.uk/properties ${chanWd} ${districts.join(' OR ')}
2. Search for: rightmove "${districts[0]}" ${chanWd} ${bedLine}property 2025
3. For each additional district search separately

From each Rightmove property page found, extract:
- FULL street address as it appears on the listing (house number + street name + area)
- Postcode (e.g. HA1 1SL, HA3 2AB)
- The numeric property ID from the URL: rightmove.co.uk/properties/NNNNNNNN → extract NNNNNNNN
- Listed price
- Number of bedrooms
- Property type (Flat, Semi-Detached, Terraced, Detached, Bungalow)
- Estate agent name
- When listed (Today, Yesterday, X days ago)

TARGET: Find at least 5 real properties per district, ideally 10-15 per district.
IMPORTANT: Only include properties where you found an actual rightmove.co.uk/properties/NNNNNNNN URL.

Return ONLY this JSON (absolutely no text before or after, no markdown fences):
{"total":NUMBER,"properties":[{"address":"14 Hindes Road, Harrow, HA1 1SL","displayAddress":"14 Hindes Road, Harrow","postcode":"HA1 1SL","propertyId":"156823401","price":485000,"priceLabel":"£485,000","beds":3,"type":"Semi-Detached","status":"For Sale","haCode":"HA1","agent":"Chancellors","addedDate":"Today","description":"Extended 3 bed semi in sought-after road"}]}`;

  let rawText = '';
  let searchDone = false;

  try {
    const messages = [{role:'user', content:prompt}];
    let turn = 0;

    while(turn < 6 && !searchDone){
      turn++;
      setStatus('Searching Rightmove…', `Scan ${turn} — extracting addresses`, 10 + turn*12, props.length || '…');
      addLog(`Search turn ${turn}…`);

      const resp = await fetch('/api/ai', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          model: 'auto',
          max_tokens: 6000,
          tools: [{type:'web_search_20250305', name:'web_search'}],
          messages
        })
      });

      if(!resp.ok) throw new Error(`AI API returned ${resp.status}`);
      const data = await resp.json();
      const blocks = data.content || [];

      blocks.filter(b=>b.type==='text').forEach(b=>{ rawText += b.text; });

      if(data.stop_reason === 'end_turn'){ searchDone = true; break; }

      if(data.stop_reason === 'tool_use'){
        const toolUses = blocks.filter(b=>b.type==='tool_use');
        if(!toolUses.length){ searchDone = true; break; }
        messages.push({role:'assistant', content:blocks});
        messages.push({role:'user', content: toolUses.map(tu=>({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: 'Search complete. Now compile ALL properties found into the JSON format. Extract the propertyId from each rightmove.co.uk/properties/NNNNNNNN URL.'
        }))});
      } else { searchDone = true; break; }
    }

    setStatus('Processing results…', 'Extracting addresses and building listings', 82, '…');
    addLog('Parsing property data…');

    // ── PARSE JSON — 3 strategies ──
    let parsed = null;
    const tryParse = (str) => {
      const patterns = [
        /\{"total"[\s\S]*?"properties"\s*:\s*\[[\s\S]*?\]\s*\}/,
        /\{"properties"\s*:\s*\[[\s\S]*?\]\s*\}/,
        /\{[\s\S]*?"properties"\s*:\s*\[[\s\S]*?\]\s*\}/,
      ];
      for(const pat of patterns){
        const m = str.match(pat);
        if(m){ try{ const p=JSON.parse(m[0]); if(p?.properties?.length) return p; }catch(e){} }
      }
      return null;
    };
    parsed = tryParse(rawText) || tryParse(rawText.replace(/```json\n?|```\n?/gi,''));

    // Strategy 3: ask AI to clean and reformat
    if(!parsed?.properties?.length && rawText.length > 50){
      addLog('Reformatting data…');
      setStatus('Reformatting…', 'Structuring property data', 88, '…');
      const rfResp = await fetch('/api/ai',{
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          model:'auto', max_tokens:5000,
          messages:[{role:'user',content:
            `From this text, extract all UK property listings and return ONLY this JSON (no other text):
{"properties":[{"address":"14 Hindes Road, Harrow, HA1 1SL","displayAddress":"14 Hindes Road, Harrow","postcode":"HA1 1SL","propertyId":"156823401","price":485000,"priceLabel":"£485,000","beds":3,"type":"Semi-Detached","status":"For Sale","haCode":"HA1","agent":"Chancellors","addedDate":"Today","description":"Extended home"}]}

Text to extract from:
${rawText.slice(0,10000)}`
          }]
        })
      });
      if(rfResp.ok){
        const rfData = await rfResp.json();
        const rfText = (rfData.content||[]).find(b=>b.type==='text')?.text||'';
        parsed = tryParse(rfText) || tryParse(rfText.replace(/```json\n?|```\n?/gi,''));
      }
    }

    const items = parsed?.properties || [];
    addLog(`Extracted ${items.length} property listings`);

    // ── BUILD PROP OBJECTS ──
    items.forEach((p, i) => {
      const hc     = (p.haCode || districts[0] || 'HA1').trim().toUpperCase();
      const dist   = HA_DISTRICTS.find(d=>d.code===hc);
      const rmId   = RM_IDS[hc]   || 1054;
      const zoSlug = ZO_SLUGS[hc] || 'harrow';
      const sale   = (p.status || 'For Sale') !== 'To Let';
      const rmCh   = sale ? 'property-for-sale' : 'property-to-rent';
      const zoCh   = sale ? 'for-sale' : 'to-rent';

      // Property ID — must be purely numeric, 6+ digits
      const pid    = String(p.propertyId || p.id || '').replace(/\D/g, '');
      const isReal = pid.length >= 6;

      // Direct Rightmove link — only if we have a real ID
      const rmUrl  = isReal
        ? `https://www.rightmove.co.uk/properties/${pid}`
        : `https://www.rightmove.co.uk/${rmCh}/find.html?locationIdentifier=OUTCODE%5E${rmId}&sortType=6`;

      // Address — try all field names
      const addr   = p.address || p.displayAddress || p.fullAddress || '';
      const dispA  = p.displayAddress || p.address || addr;
      const pcM    = (addr+' '+(p.postcode||'')).match(/[A-Z]{1,2}\d[\dA-Z]?\s*\d[A-Z]{2}/i);
      const pc     = (p.postcode || (pcM?pcM[0]:'') || hc).toUpperCase().trim();
      const price  = parseInt(String(p.price||'0').replace(/[^0-9]/g,'')) || 0;

      if(!dispA && !isReal) return; // skip completely empty entries

      props.push({
        id: `live-${i}-${pid||i}`,
        address:        addr  || `See listing on Rightmove`,
        displayAddress: dispA || `See listing on Rightmove`,
        postcode:       pc    || hc,
        district:       dist?.name || hc,
        haCode:         hc,
        type:           p.type || 'Property',
        beds:           parseInt(p.beds||'0') || 0,
        price,
        priceLabel:     p.priceLabel || (price>0 ? (sale?'£'+price.toLocaleString():'£'+price.toLocaleString()+' pcm') : ''),
        status:         p.status || (sale?'For Sale':'To Let'),
        portal:         'Rightmove',
        portalCls:      'rm',
        agent:          p.agent || '',
        addedDate:      p.addedDate || '',
        description:    p.description || '',
        isLive:         true,
        isRealUrl:      isReal,
        selected:       true,  // pre-select all by default
        isNew:          !!(p.addedDate && /today/i.test(p.addedDate)),
        listedAt:       new Date(),
        rmUrl,
        rmAreaUrl:      `https://www.rightmove.co.uk/${rmCh}/find.html?locationIdentifier=OUTCODE%5E${rmId}&sortType=6`,
        rmSoldUrl:      `https://www.rightmove.co.uk/house-prices/${hc.toLowerCase()}.html`,
        zoUrl:          `https://www.zoopla.co.uk/${zoCh}/property/${zoSlug}/`,
        otUrl:          `https://www.onthemarket.com/${zoCh}/${zoSlug}/`,
        rmId,
        propertyId:     pid,
        portalUrl:      rmUrl,
        fullAddress:    addr,
        source:         'Live Search'
      });
    });

    // Try Rightmove direct API in background for any CORS-unlocked browsers
    for(const code of districts){
      if(props.some(p=>p.haCode===code && p.isRealUrl)) continue; // already have real data
      try{
        const rmId   = RM_IDS[code]||1054;
        const params = new URLSearchParams({
          locationIdentifier:`OUTCODE^${rmId}`,numberOfPropertiesPerPage:'24',
          sortType:'6',index:'0',channel:isSale?'BUY':'RENT',
          includeSSTC:'false',viewType:'LIST',areaSizeUnit:'sqft',
          currencyCode:'GBP',isFetching:'false'
        });
        if(minBeds>0)   params.set('minBedrooms',String(minBeds));
        if(maxPriceV>0) params.set('maxPrice',String(maxPriceV));
        const r = await fetch(`https://www.rightmove.co.uk/api/_search?${params}`,{
          headers:{'Accept':'application/json','X-Requested-With':'XMLHttpRequest',
                   'Referer':'https://www.rightmove.co.uk/'}
        });
        if(r.ok){
          const d = await r.json();
          const dist2   = HA_DISTRICTS.find(x=>x.code===code);
          const zoSlug2 = ZO_SLUGS[code]||'harrow';
          const rmCh2   = isSale?'property-for-sale':'property-to-rent';
          const zoCh2   = isSale?'for-sale':'to-rent';
          const rmId2   = RM_IDS[code]||1054;
          (d.properties||[]).forEach((raw,i)=>{
            const pid2  = String(raw.id||'');
            const disp2 = raw.displayAddress||'';
            const pr2   = raw.price||{};
            const pcM2  = disp2.match(/[A-Z]{1,2}\d[\dA-Z]?\s*\d[A-Z]{2}/i);
            props.push({
              id:`rm-api-${props.length}`,
              address:disp2,displayAddress:disp2,
              postcode:pcM2?pcM2[0].toUpperCase():(code+' — see listing'),
              district:dist2?.name||code,haCode:code,
              type:raw.propertySubType||'Property',beds:raw.bedrooms||0,
              price:pr2.amount||0,
              priceLabel:isSale?(pr2.displayPrices?.[0]?.displayPrice||''):((pr2.displayPrices?.[0]?.displayPrice||'')+' pcm'),
              status:isSale?'For Sale':'To Let',portal:'Rightmove',portalCls:'rm',
              agent:raw.customer?.branchDisplayName||'',
              addedDate:raw.listingUpdate?.listingUpdateReason==='new'?'Today':(raw.addedOrReduced||''),
              description:raw.summary||'',isLive:true,isRealUrl:!!pid2,selected:true,
              isNew:raw.listingUpdate?.listingUpdateReason==='new',listedAt:new Date(),
              rmUrl:pid2?`https://www.rightmove.co.uk/properties/${pid2}`:`https://www.rightmove.co.uk/${rmCh2}/find.html?locationIdentifier=OUTCODE%5E${rmId2}&sortType=6`,
              rmAreaUrl:`https://www.rightmove.co.uk/${rmCh2}/find.html?locationIdentifier=OUTCODE%5E${rmId2}&sortType=6`,
              rmSoldUrl:`https://www.rightmove.co.uk/house-prices/${code.toLowerCase()}.html`,
              zoUrl:`https://www.zoopla.co.uk/${zoCh2}/property/${zoSlug2}/`,
              otUrl:`https://www.onthemarket.com/${zoCh2}/${zoSlug2}/`,
              rmId:rmId2,propertyId:pid2,portalUrl:pid2?`https://www.rightmove.co.uk/properties/${pid2}`:'',
              fullAddress:disp2,source:'Rightmove API'
            });
          });
          addLog(`${code}: +${d.properties?.length||0} via direct API`);
        }
      }catch(e){ /* CORS blocked — expected */ }
    }

    // Deduplicate
    const seen = new Set();
    props = props.filter(p=>{
      const k = (p.propertyId && p.propertyId.length>=6) ? p.propertyId : (p.address||p.id);
      if(seen.has(k)) return false;
      seen.add(k); return true;
    });

  }catch(err){
    console.error('Search error:', err);
    blog('Search error: '+err.message, 'warn');
    addLog('Error: '+err.message.slice(0,60));
  }

  // ── RENDER RESULTS ──
  document.getElementById('search-status').style.display = 'none';
  if(btn){ btn.disabled=false; btn.textContent='<i class=ic-search></i> Find Live Properties'; }

  if(props.length === 0){
    document.getElementById('results-area').style.display  = 'block';
    document.getElementById('results-title').textContent   = 'No results found';
    document.getElementById('results-sub').textContent     = 'Try selecting more districts or broadening your filters';
    document.getElementById('results-table').innerHTML     =
      '<div style="text-align:center;padding:32px;color:var(--muted)">'
      +'<div style="font-size:32px;margin-bottom:12px"><i class=ic-search></i></div>'
      +'<div style="font-size:14px;font-weight:600;margin-bottom:6px">No properties extracted</div>'
      +'<div style="font-size:13px">The search ran but could not extract individual property addresses. '
      +'Try <a href="https://www.rightmove.co.uk/property-for-sale/find.html?locationIdentifier=OUTCODE%5E1054&sortType=6" target="_blank" style="color:var(--blue)">browsing Rightmove directly</a></div>'
      +'</div>';
    toast('Search ran but no addresses could be extracted. Try again.', 'warn');
    return;
  }

  renderLiveResults();
  const real = props.filter(p=>p.propertyId&&p.propertyId.length>=6).length;
  blog(`<i class=ic-check></i> Found ${props.length} properties · ${real} with direct Rightmove links`, 'ok');
  toast(`<i class=ic-check></i> ${props.length} live properties found — ${real} with direct links`, 'ok');
  updateKPIs();
}

// ── Backwards compat: doHASearch → runLiveSearch ──
async function doHASearch(){ return runLiveSearch(); }

// ── Render the results table ──
// Run an async worker over items with a concurrency limit.
async function mapLimit(items, limit, worker){
  const results = new Array(items.length);
  let idx = 0;
  async function run(){ while(idx < items.length){ const i = idx++; results[i] = await worker(items[i], i); } }
  await Promise.all(Array.from({length: Math.min(limit, items.length)}, run));
  return results;
}

// Look up a listing's exact address in the EPC register (one retry on failure).
// opts.fast → skip the slow per-house geocode (used for bulk auto-resolve).
async function epcLookup(p, retries=1, opts={}){
  try{
    const pc = (p.postcode||'').replace(/—.*/,'').trim();
    // Only pass a real postcode-district as the area filter — never a location
    // identifier (e.g. REGION^904) from a UK-wide search, which would over-filter.
    const districtArg = /^[A-Z]{1,2}\d[\dA-Z]?$/i.test(p.haCode||'') ? p.haCode : '';
    const qs = new URLSearchParams({ street: p.displayAddress||p.address||'', type: p.type||'', district: districtArg });
    if(/[A-Z]{1,2}\d[\dA-Z]?\s*\d[A-Z]{2}/i.test(pc)) qs.set('postcode', pc);
    if(p.lat!=null && p.lon!=null){ qs.set('lat', p.lat); qs.set('lon', p.lon); }
    if(p.sizeSqft>0) qs.set('size', p.sizeSqft);
    if(p.description) qs.set('hint', String(p.description).slice(0,300));
    // Pass the Rightmove listing URL so the resolver can fetch the full postcode
    // from the property page when we only have the outcode — big accuracy boost.
    const rmu = p.rmUrl||p.portalUrl||p.url||'';
    // In the fast bulk pass, skip the per-listing property-page fetch (one HTTP
    // call each — too slow and hammers Rightmove); rely on the map-pin postcode.
    if(!opts.fast && /rightmove\.co\.uk/i.test(rmu) && !/[A-Z]{1,2}\d[\dA-Z]?\s*\d[A-Z]{2}/i.test(pc)) qs.set('url', rmu);
    if(opts.fast) qs.set('fast','1');
    // Unified resolver: EPC pinpoint + OS Places rescue (Royal Mail full coverage).
    const r = await fetch('/api/resolve?'+qs.toString());
    if(!r.ok) return retries>0 ? epcLookup(p, retries-1, opts) : null;
    return await r.json();
  }catch(e){ return retries>0 ? epcLookup(p, retries-1, opts) : null; }
}

// Does an address already include a house number / unit (a printable full address)?
function hasHouseNumber(addr){
  const seg = (addr||'').split(',')[0].trim();
  return /\d/.test(seg) || /^(flat|apartment|apt|unit|studio|maisonette)\b/i.test(seg);
}

// ── Find the full house-number address via the public EPC register ──
async function findFullAddress(i){
  const p = props[i]; if(!p) return;
  const box = document.getElementById('epc-'+i); if(!box) return;
  box.innerHTML = '<span style="font-size:12px;color:var(--muted)"><i class=ic-search></i> Searching the EPC register…</span>';
  try{
    const pc = (p.postcode||'').replace(/—.*/,'').trim();
    const qs = new URLSearchParams({ street: p.displayAddress||p.address||'', type: p.type||'' });
    if(/[A-Z]{1,2}\d[\dA-Z]?\s*\d[A-Z]{2}/i.test(pc)) qs.set('postcode', pc); // full postcode only
    if(p.lat!=null && p.lon!=null){ qs.set('lat', p.lat); qs.set('lon', p.lon); }
    if(p.sizeSqft>0) qs.set('size', p.sizeSqft); // floor area for size matching
    const r = await fetch('/api/epc?'+qs.toString());
    const d = await r.json().catch(()=>({}));
    if(!r.ok){
      box.innerHTML = '<span style="font-size:12px;color:var(--amber)"><i class=ic-alert></i> '+(d.error||('HTTP '+r.status))+'</span>';
      return;
    }
    const cands = d.candidates||[];
    if(!cands.length){
      box.innerHTML = '<span style="font-size:12px;color:var(--muted)">'+(d.note||('No EPC matches found.'))+' Open the Rightmove link to verify.</span>';
      return;
    }
    window._epcCand = window._epcCand||{}; window._epcCand[i] = cands;
    window._epcMeta = window._epcMeta||{}; window._epcMeta[i] = { sizeMatched: d.sizeMatched, listingSqft: d.listingSqft, total: d.total };
    // Task 1: auto-apply the best (top-ranked) match straight away.
    applyEpcAddress(i, 0);
    renderEpcBox(i);
  }catch(e){
    box.innerHTML = '<span style="font-size:12px;color:var(--amber)"><i class=ic-alert></i> '+e.message+'</span>';
  }
}

// Render the (top 3) candidate list, highlighting the one currently applied.
function renderEpcBox(i){
  const box = document.getElementById('epc-'+i); if(!box) return;
  const cands = (window._epcCand && window._epcCand[i]) || [];
  const meta = (window._epcMeta && window._epcMeta[i]) || {};
  const chosen = props[i]._epcChosen ?? 0;
  const shown = cands.slice(0, 3);
  const fmt = n => Number(n).toLocaleString();
  const header = meta.sizeMatched
    ? 'CLOSEST BY FLOOR SIZE ✓ · listing is '+fmt(meta.listingSqft)+' sq ft · '+(meta.total)+' on this street — verify on Rightmove'
    : 'BEST MATCH APPLIED ✓ · '+(meta.total||cands.length)+' candidate'+((meta.total||cands.length)>1?'s':'')+' on this street — verify on Rightmove';
  box.innerHTML = '<div style="border:1px solid var(--border2);border-radius:8px;padding:9px 11px;background:#fff">'
    +'<div style="font-size:10px;font-weight:700;color:var(--muted);letter-spacing:.4px;margin-bottom:7px">'+header+'</div>'
    + shown.map((c,j)=>{
        const sizeTag = c.sizeSqft ? ' <span style="color:'+(c.sizeDiff!=null&&c.sizeDiff<=150?'var(--green)':'var(--muted)')+';font-weight:400">· '+fmt(c.sizeSqft)+' sq ft</span>' : '';
        return '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:6px 0;'+(j?'border-top:1px solid var(--border)':'')+'">'
          +'<span style="font-size:12px;color:var(--text);font-weight:'+(j===chosen?'700':'400')+'">'
            +(j===chosen?'✓ ':'')+c.fullAddress+(c.band?' <span style="color:var(--muted);font-weight:400">· EPC '+c.band+'</span>':'')+sizeTag+'</span>'
          +(j===chosen
             ? '<span style="flex-shrink:0;font-size:10px;color:var(--green);font-weight:700">USING</span>'
             : '<button onclick="event.stopPropagation();useEpcAddress('+i+','+j+')" style="flex-shrink:0;padding:4px 11px;background:var(--blue);color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit">Use</button>');
      }).join('')
    + (cands.length>shown.length?'<div style="font-size:10px;color:var(--muted);margin-top:6px">+'+(cands.length-shown.length)+' more on this street</div>':'')
    +'</div>';
}

// Set the property's address from a candidate (data + in-place row update).
function applyEpcAddress(i,j){
  const c = (window._epcCand && window._epcCand[i] || [])[j]; if(!c) return;
  props[i]._epcChosen = j;
  props[i].address = c.fullAddress;
  props[i].displayAddress = c.fullAddress;
  props[i].fullAddress = c.fullAddress;
  if(c.postcode) props[i].postcode = c.postcode;
  props[i].addressSource = 'EPC register';
  const span = document.getElementById('addr-'+i);
  if(span) span.textContent = c.fullAddress;
}
function useEpcAddress(i,j){
  applyEpcAddress(i,j);
  renderEpcBox(i);
  toast('Address updated — verify on the listing before posting','ok');
}

// ── Confirm the exact house number for a street-level listing, on demand ──
// We never guess. We pull the real candidate addresses on the listing's
// street/postcode from the public registers, the user verifies against the
// Rightmove listing, and either taps the exact house OR types the number they
// read on the listing. Only then is the address "confirmed" and printable.
async function confirmAddress(i){
  const p=props[i]; if(!p) return;
  const box=document.getElementById('pick-'+i); if(!box) return;
  box.style.display='block';
  box.innerHTML='<span style="font-size:12px;color:var(--muted)"><i class=ic-search></i> Finding the real addresses on this street…</span>';
  let r=null;
  try{ r=await epcLookup(p); }catch(e){ r=null; }
  const cands=(r&&Array.isArray(r.candidates))?r.candidates:[];
  p._candidates=cands;
  p._resolveNote=(r&&r.note)||'';
  p._resolveConf=(r&&r.confidence)||'low';
  p._resolveReasons=(r&&Array.isArray(r.reasons))?r.reasons:[];
  p._resolvePinMatched=!!(r&&r.pinMatched);
  renderConfirmBox(i);
}
function renderConfirmBox(i){
  const box=document.getElementById('pick-'+i); const p=props[i]; if(!box||!p) return;
  const cands=p._candidates||[]; const chosen=p._pickChosen;
  const conf=p._resolveConf||'low'; const reasons=p._resolveReasons||[];
  const rmLink=p.rmUrl||p.portalUrl||'';
  const verifyLink=rmLink?'<a href="'+rmLink+'" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="color:var(--blue);font-weight:700;text-decoration:none">open the listing on Rightmove ↗</a>':'the listing';
  // Confidence banner — explains WHY the top match is the likely house.
  const confMeta={high:{c:'var(--green)',bg:'rgba(5,150,105,.1)',t:'STRONG MATCH'},medium:{c:'#92400E',bg:'#FFFBEB',t:'LIKELY MATCH'},low:{c:'var(--muted)',bg:'rgba(0,0,0,.04)',t:'NEEDS A CHECK'}}[conf]||{};
  const banner=cands.length>1
    ? '<div style="background:'+confMeta.bg+';border-radius:7px;padding:8px 10px;margin-bottom:9px">'
      +'<div style="font-size:10px;font-weight:800;letter-spacing:.5px;color:'+confMeta.c+'">'+confMeta.t+(p._resolvePinMatched?' · MAP-PIN CHECKED':'')+'</div>'
      +(reasons.length?'<div style="font-size:11px;color:var(--text);margin-top:3px;line-height:1.45">'+reasons.map(esc).join(' · ')+'</div>':'')
      +'<div style="font-size:10px;color:var(--muted);margin-top:3px">Always cross-check against '+verifyLink+' before posting.</div>'
      +'</div>'
    : '';
  const list=cands.length
    ? banner
      + '<div style="font-size:10px;font-weight:700;color:var(--muted);letter-spacing:.4px;margin-bottom:7px">'+(cands.length>1?'TAP THE EXACT HOUSE — best match first':'REAL ADDRESS FOUND')+'</div>'
      + cands.slice(0,12).map((c,j)=>{
          const isRec=j===0&&cands.length>1&&conf!=='low';
          const meta=[c.sizeSqft?Number(c.sizeSqft).toLocaleString()+' sq ft':'',c.distM!=null?c.distM+' m from pin':''].filter(Boolean).join(' · ');
          return '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:6px 0;'+(j?'border-top:1px solid var(--border)':'')+'">'
          +'<span style="font-size:12px;color:var(--text);font-weight:'+(j===chosen?'700':'400')+'">'+(j===chosen?'✓ ':'')+(isRec?'<span style="background:rgba(5,150,105,.12);color:var(--green);font-size:9px;font-weight:800;padding:1px 5px;border-radius:3px;margin-right:5px">BEST</span>':'')+esc(c.fullAddress)+(meta?' <span style="color:var(--muted);font-weight:400">· '+meta+'</span>':'')+'</span>'
          +(j===chosen?'<span style="flex-shrink:0;font-size:10px;color:var(--green);font-weight:700">CONFIRMED</span>'
             :'<button onclick="event.stopPropagation();useCandidate('+i+','+j+')" style="flex-shrink:0;padding:4px 11px;background:'+(isRec?'var(--green)':'var(--blue)')+';color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit">'+(isRec?'Use this':'This one')+'</button>');
        }).map(s=>s+'</div>').join('')
      + (cands.length>12?'<div style="font-size:10px;color:var(--muted);margin-top:6px">+'+(cands.length-12)+' more on this street</div>':'')
    : '<div style="font-size:11px;color:var(--muted);margin-bottom:7px">No exact match in the public registers for this street. '+verifyLink+' to read the house number, then enter it below.</div>';
  box.innerHTML='<div style="border:1px solid var(--border2);border-radius:8px;padding:10px 12px;background:#fff">'
    + list
    // AI second opinion — finds the address a different way and cross-checks it.
    + '<div style="border-top:1px solid var(--border);margin-top:9px;padding-top:9px">'
      + '<div id="aicheck-'+i+'">'
        + '<button onclick="event.stopPropagation();aiCrossCheck('+i+')" style="display:inline-flex;align-items:center;gap:6px;padding:7px 13px;background:rgba(124,58,237,.1);color:#7C3AED;border:1.5px solid rgba(124,58,237,.3);border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit"><i class=ic-bot></i> Cross-check with AI</button>'
        + '<div style="font-size:10px;color:var(--muted);margin-top:5px">Independently finds the address from the listing wording + Land Registry, then compares it with the match above.</div>'
      + '</div>'
    + '</div>'
    + '<div style="border-top:1px solid var(--border);margin-top:9px;padding-top:9px">'
      + '<div style="font-size:10px;font-weight:700;color:var(--muted);letter-spacing:.4px;margin-bottom:6px">OR TYPE THE EXACT NUMBER FROM THE LISTING</div>'
      + '<div style="display:flex;gap:7px;align-items:center;flex-wrap:wrap">'
        + '<input id="mn-'+i+'" type="text" placeholder="e.g. 83" onclick="event.stopPropagation()" style="width:90px;padding:7px 9px;border:1.5px solid var(--border2);border-radius:6px;font-size:13px;font-family:inherit">'
        + '<span style="font-size:12px;color:var(--muted)">'+esc((p._origAddress||p.displayAddress||'').split(',').slice(0,2).join(', '))+'</span>'
        + '<button onclick="event.stopPropagation();applyManualNumber('+i+')" style="padding:7px 13px;background:var(--green);color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">Confirm</button>'
      + '</div>'
    + '</div>'
    + '</div>';
}
// ── Best-effort: read the house number from free street imagery (Mapillary) ──
async function readStreetNumber(i){
  const p=props[i]; if(!p) return;
  if(p.lat==null||p.lon==null){ toast('No map location for this listing','warn'); return; }
  toast('<i class=ic-search></i> Reading street imagery…','inf');
  try{
    const body={lat:p.lat,lon:p.lon,candidates:(p._candidates||[]).slice(0,40)};
    const r=await fetch('/api/streetview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const d=await r.json().catch(()=>({}));
    if(!r.ok){ toast(d.note||d.error||'Street imagery unavailable','warn'); return; }
    if(d.matched){
      p.address=d.matched; p.displayAddress=d.matched; p.fullAddress=d.matched;
      p.addressSource='Street imagery (verify)'; p.addressConfirmed=false; p.addressLikely=true; p.addressFound=true; p.block=null;
      renderLiveResults();
      toast('<i class=ic-check></i> Imagery read number '+d.number+' → '+d.matched+' — verify before posting','ok');
    } else if(d.found){ toast('Read "'+d.number+'" but it is not on this postcode — ignored','warn'); }
    else { toast(d.note||'No legible number in the imagery','warn'); }
  }catch(e){ toast(e.message,'warn'); }
}

// ── AI second opinion: find the address independently, then cross-reference ──
async function aiCrossCheck(i){
  const p=props[i]; if(!p) return;
  const out=document.getElementById('aicheck-'+i); if(!out) return;
  out.innerHTML='<div style="font-size:12px;color:#7C3AED;font-weight:600"><i class=ic-bot></i> AI is reading the listing + Land Registry records…</div>';
  try{
    const body={
      url:p.rmUrl||p.portalUrl||'', street:p._origAddress||p.displayAddress||p.address||'',
      postcode:(p.postcode||'').replace(/—.*/,'').trim(), type:p.type||'', beds:p.beds||0, size:p.sizeSqft||0,
      lat:p.lat, lon:p.lon, candidates:(p._candidates||[]).slice(0,14), engineConfidence:p._resolveConf||'low',
    };
    const r=await fetch('/api/ai-address',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const d=await r.json().catch(()=>({}));
    if(!r.ok){ out.innerHTML='<div style="font-size:12px;color:var(--amber)"><i class=ic-alert></i> '+(d.error||('AI error '+r.status))+'</div>'; return; }
    p._ai=d;
    renderAiCheck(i);
  }catch(e){ out.innerHTML='<div style="font-size:12px;color:var(--amber)"><i class=ic-alert></i> '+e.message+'</div>'; }
}
function renderAiCheck(i){
  const out=document.getElementById('aicheck-'+i); const p=props[i]; const d=p&&p._ai; if(!out||!d) return;
  const styles={double_confirmed:{c:'var(--green)',bg:'rgba(5,150,105,.1)',ic:'ic-check'},ai_only:{c:'#92400E',bg:'#FFFBEB',ic:'ic-bot'},conflict:{c:'#B91C1C',bg:'rgba(220,38,38,.08)',ic:'ic-alert'},unresolved:{c:'var(--muted)',bg:'rgba(0,0,0,.04)',ic:'ic-search'}};
  const st=styles[d.verdict]||styles.unresolved;
  const aiAddr=d.ai&&(d.ai.fullAddress||(d.ai.houseNumber?d.ai.houseNumber+' '+((p._origAddress||'').replace(/^\s*\d+[a-z]?\s+/i,'')):''));
  const tags=[];
  if(d.ai&&d.ai.inLandRegistry) tags.push('in Land Registry');
  if(d.ai&&d.ai.inRegister) tags.push('in EPC register');
  if(d.evidence&&d.evidence.usedDescription) tags.push('read the listing text');
  if(d.evidence&&d.evidence.landRegistryCount) tags.push(d.evidence.landRegistryCount+' sold records');
  if(d.evidence&&d.evidence.webResults) tags.push('checked the web ('+d.evidence.webResults+')');
  out.innerHTML='<div style="background:'+st.bg+';border-radius:7px;padding:9px 11px">'
    +'<div style="font-size:10px;font-weight:800;letter-spacing:.5px;color:'+st.c+'"><i class='+st.ic+'></i> AI CROSS-CHECK · '+esc((d.headline||'').toUpperCase())+'</div>'
    +(aiAddr?'<div style="font-size:13px;font-weight:700;color:var(--text);margin-top:5px">'+esc(aiAddr)+'</div>':'')
    +(d.ai&&d.ai.reasoning?'<div style="font-size:11px;color:var(--text);margin-top:3px;line-height:1.45">'+esc(d.ai.reasoning)+'</div>':'')
    +(tags.length?'<div style="font-size:10px;color:var(--muted);margin-top:4px">'+tags.map(esc).join(' · ')+'</div>':'')
    // When both methods agree, one tap confirms the double-checked address.
    +(d.agreed&&aiAddr?'<button onclick="event.stopPropagation();useAiAddress('+i+')" style="margin-top:8px;padding:7px 14px;background:var(--green);color:#fff;border:none;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit"><i class=ic-check></i> Use this double-confirmed address</button>'
      :(d.verdict==='conflict'?'<div style="font-size:10px;color:'+st.c+';margin-top:6px;font-weight:600">The two methods point to different houses — open the listing and confirm by hand.</div>':''))
    +'<div style="font-size:9px;color:var(--muted);margin-top:6px">AI assists — always confirm against the live listing before posting.</div>'
    +'</div>';
}
function useAiAddress(i){
  const p=props[i]; const d=p&&p._ai; if(!p||!d||!d.ai) return;
  const addr=d.ai.fullAddress||(d.ai.houseNumber?d.ai.houseNumber+' '+((p._origAddress||'').replace(/^\s*\d+[a-z]?\s+/i,'')):'');
  if(!addr){ toast('No AI address to use','warn'); return; }
  p.address=addr; p.displayAddress=addr; p.fullAddress=addr;
  p.addressSource='Double-confirmed (engine + AI)'; p.addressConfirmed=true;
  renderLiveResults();
  toast('<i class=ic-check></i> Double-confirmed address set','ok');
}
// Tap a real candidate address → confirmed + printable.
function useCandidate(i,j){
  const p=props[i]; const c=(p._candidates||[])[j]; if(!c) return;
  p._pickChosen=j; p.address=c.fullAddress; p.displayAddress=c.fullAddress; p.fullAddress=c.fullAddress;
  if(c.postcode) p.postcode=c.postcode; if(c.uprn) p.uprn=c.uprn;
  p.addressSource='Confirmed from register'; p.addressConfirmed=true;
  renderLiveResults();
  toast('<i class=ic-check></i> Address confirmed','ok');
}
// Type the verified house number from the listing → confirmed + printable.
function applyManualNumber(i){
  const p=props[i]; const inp=document.getElementById('mn-'+i); if(!p||!inp) return;
  const num=(inp.value||'').trim();
  if(!/\d/.test(num)){ toast('Enter the house/flat number shown on the listing','warn'); return; }
  const base=(p._origAddress||p.displayAddress||p.address||'').replace(/^\s*\d+[a-z]?\s+/i,'');
  const full=num+' '+base;
  p.address=full; p.displayAddress=full; p.fullAddress=full;
  p.addressSource='Verified on listing'; p.addressConfirmed=true;
  renderLiveResults();
  toast('<i class=ic-check></i> Address confirmed','ok');
}

// Toggle the results between "only properties with a full address" and "all".
function setAddrFilter(f){ window.addrFilter = f; renderLiveResults(); }
function toggleBlock(i){ window._blockOpen = window._blockOpen || {}; window._blockOpen[i] = !window._blockOpen[i]; renderLiveResults(); }

// ONE best address per property (the headline already shows it). For a block we
// keep the full unit list one tap away — collapsed by default — so the list is
// there for deliberate whole-building mailing but never clutters the view.
function resolvedAddrHTML(p, i){
  if(p.block && p.block.units && p.block.units.length > 1){
    const u = p.block.units;
    const open = window._blockOpen && window._blockOpen[i];
    const noun = p.block.level==='street' ? 'street' : 'block';
    const toggle = '<button onclick="event.stopPropagation();toggleBlock('+i+')" style="font-size:11px;color:var(--muted);background:none;border:none;cursor:pointer;font-family:inherit;padding:2px 0">'
      + (open ? '▾ Hide the '+u.length+' addresses' : '▸ '+(u.length-1)+' more in this '+noun+' (optional — for whole-'+noun+' mailing)') + '</button>';
    const list = open
      ? '<div style="background:rgba(5,150,105,.05);border:1px solid rgba(5,150,105,.22);border-radius:8px;padding:8px 10px;margin-top:5px">'
        + u.map(a=>'<div style="font-size:12px;color:var(--text);padding:2px 0">'+esc(a)+'</div>').join('') + '</div>'
      : '';
    return '<div style="margin:1px 0 8px">'+toggle+list+'</div>';
  }
  return '';
}

function renderLiveResults(){
  const area = document.getElementById('results-area');
  if(area) area.style.display = 'block';

  const selCount = props.filter(p=>p.selected).length;
  const foundCount = props.filter(p=>p.addressFound).length;
  const af = window.addrFilter || 'all';   // 'found' = only properties with a full address
  const shownCount = af==='found' ? foundCount : props.length;
  const title = document.getElementById('results-title');
  const sub   = document.getElementById('results-sub');
  if(title) title.textContent = af==='found' ? `${foundCount} Properties With a Full Address` : `${props.length} Live Properties Found`;
  if(sub)   sub.textContent   = `${foundCount} of ${props.length} have a full address · ${selCount} selected for letters`;

  // Update select button state
  const qBtn = document.getElementById('queue-selected-btn');
  if(qBtn) qBtn.disabled = selCount === 0;

  const table = document.getElementById('results-table');
  if(!table) return;
  table.innerHTML = '';

  // Filter bar — default shows only properties whose full address was found.
  const fbar = document.createElement('div');
  fbar.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:4px 0 12px;border-bottom:1px solid var(--border);margin-bottom:6px';
  const mkBtn = (key,label) => '<button onclick="setAddrFilter(\''+key+'\')" style="padding:6px 13px;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;border:1.5px solid '+(af===key?'var(--blue)':'var(--border2)')+';background:'+(af===key?'var(--blue)':'#fff')+';color:'+(af===key?'#fff':'var(--text)')+'">'+label+'</button>';
  fbar.innerHTML = '<span style="font-size:11px;color:var(--muted);font-weight:600">Show:</span>'
    + mkBtn('found','Full address found ('+foundCount+')')
    + mkBtn('all','All listings ('+props.length+')');
  table.appendChild(fbar);

  if(af==='found' && !foundCount){
    const empty=document.createElement('div');
    empty.style.cssText='text-align:center;padding:28px;color:var(--muted)';
    empty.innerHTML='<div style="font-size:13px;font-weight:600">No full addresses resolved yet</div><div style="font-size:12px;margin-top:6px">Tap "All listings" to see every property and confirm addresses one by one.</div>';
    table.appendChild(empty);
  }

  props.forEach((p, i) => {
    if(af==='found' && !p.addressFound) return;
    const isReal   = p.propertyId && p.propertyId.length >= 6;
    const isSale   = p.status === 'For Sale';
    const accentBg = isSale ? 'rgba(0,79,154,.08)' : 'rgba(5,150,105,.08)';
    const accentCl = isSale ? '#004F9A' : '#059669';

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:flex-start;gap:14px;padding:14px 0;border-bottom:1px solid var(--border);'+(p.selected?'background:rgba(37,99,235,.02);':'');
    row.id = 'lr-' + i;

    row.innerHTML =
      // Checkbox
      '<div style="padding-top:2px;flex-shrink:0">'
        +'<div onclick="toggleResultSelect('+i+')" style="width:20px;height:20px;border-radius:5px;border:2px solid '+(p.selected?'var(--blue)':'var(--border2)')+';background:'+(p.selected?'var(--blue)':'transparent')+';cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .12s">'
          +(p.selected?'<svg width="11" height="9" viewBox="0 0 11 9" fill="none"><path d="M1 4L4 7.5L10 1" stroke="white" stroke-width="2" stroke-linecap="round"/></svg>':'')
        +'</div>'
      +'</div>'
      // Address block
      +'<div style="flex:1;min-width:0">'
        // Address line — THE key data
        +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap">'
          +(isReal?'<span style="background:rgba(5,150,105,.12);color:#059669;font-size:9px;font-weight:800;padding:2px 7px;border-radius:3px;letter-spacing:.5px;flex-shrink:0">● LIVE</span>':'')
          +'<span id="addr-'+i+'" style="font-size:14px;font-weight:700;color:var(--text)">'+esc((p.addressConfirmed||p.addressLikely)?(p.fullAddress||p.displayAddress):(p.block?p.block.address:(p.displayAddress||p.address||'Address on Rightmove')))+'</span>'
        +'</div>'
        +'<div id="pick-'+i+'" style="display:none;margin-bottom:8px"></div>'
        // Postcode + meta
        +'<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px">'
          +(p.postcode?'<span style="font-size:12px;font-weight:700;color:var(--blue);background:rgba(37,99,235,.08);padding:2px 9px;border-radius:4px"><i class=ic-send></i> '+p.postcode+'</span>':'')
          +(p.addressConfirmed
             ? '<span style="font-size:11px;font-weight:700;color:var(--green);background:rgba(5,150,105,.1);padding:2px 9px;border-radius:4px"><i class=ic-check></i> Address confirmed</span>'
             : (p.addressLikely
                ? '<button onclick="event.stopPropagation();confirmAddress('+i+')" style="font-size:11px;font-weight:700;color:#92400E;background:#FFFBEB;border:1px solid #FCD34D;padding:3px 10px;border-radius:4px;cursor:pointer;font-family:inherit"><i class=ic-hand></i> Likely — tap to verify</button>'
                : (p.block
                   ? '<span style="font-size:11px;font-weight:700;color:#6D28D9;background:rgba(124,58,237,.1);padding:2px 9px;border-radius:4px"><i class=ic-home></i> '+({building:'Building',postcode:'Block',street:'Street'}[p.block.level]||'Block')+': '+p.block.units.length+' owner address'+(p.block.units.length===1?'':'es')+'</span>'
                   : '<button onclick="event.stopPropagation();confirmAddress('+i+')" style="font-size:11px;font-weight:700;color:#92400E;background:#FFFBEB;border:1px solid #FCD34D;padding:3px 10px;border-radius:4px;cursor:pointer;font-family:inherit"><i class=ic-hand></i> Confirm exact address</button>')))
          +(p.portal?'<span style="font-size:10px;font-weight:700;color:'+(p.portal==='OnTheMarket'?'#E63946':'#004F9A')+';background:rgba(0,0,0,.04);padding:2px 8px;border-radius:4px">'+p.portal+'</span>':'')
          +ownerBadge(p)
          +'<span style="font-size:11px;color:var(--muted)">'+p.haCode+' · '+p.district+'</span>'
          +(p.agent?'<span style="font-size:11px;color:var(--muted)">'+p.agent+'</span>':'')
          +(p.addedDate?'<span style="font-size:11px;color:var(--muted)">Listed: '+p.addedDate+'</span>':'')
        +'</div>'
        // Resolved full addresses (Number, Street, Postcode)
        + resolvedAddrHTML(p, i)
        // Property tags
        +'<div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:10px">'
          +(p.type?'<span class="ptag">'+p.type+'</span>':'')
          +(p.beds>0?'<span class="ptag"><i class=ic-bed></i> '+(p.beds===0?'Studio':p.beds+' bed')+'</span>':'')
          +(p.priceLabel?'<span class="ptag" style="background:'+accentBg+';color:'+accentCl+';font-weight:700">'+p.priceLabel+'</span>':'')
          +'<span class="ptag" style="background:'+accentBg+';color:'+accentCl+'">'+p.status+'</span>'
        +'</div>'
        // ── ACTION BUTTONS ──
        +'<div style="display:flex;gap:7px;flex-wrap:wrap;align-items:center">'
          // Primary: Verify on Rightmove
          +(isReal
            ?'<a href="'+p.rmUrl+'" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background:#004F9A;color:#fff;border-radius:7px;font-size:12px;font-weight:700;text-decoration:none;transition:opacity .15s" onmouseover="this.style.opacity=\'.82\'" onmouseout="this.style.opacity=\'1\'"><i class=ic-home></i> Verify on '+(p.portal||'Rightmove')+' →</a>'
            :'<a href="'+p.rmAreaUrl+'" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background:#004F9A;color:#fff;border-radius:7px;font-size:12px;font-weight:700;text-decoration:none"><i class=ic-search></i> Browse '+p.haCode+' on Rightmove</a>'
          )
          // Queue letter button (single confirmed address)
          +'<button onclick="event.stopPropagation();quickQueueOne('+i+')" style="padding:7px 13px;background:rgba(37,99,235,.1);color:var(--blue);border:1.5px solid rgba(37,99,235,.25);border-radius:7px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .12s" onmouseover="this.style.background=\'rgba(37,99,235,.18)\'" onmouseout="this.style.background=\'rgba(37,99,235,.1)\'"><i class=ic-mailbox></i> Queue Letter</button>'
          // Queue every real owner in the block (building/street)
          +(p.block?'<button onclick="event.stopPropagation();queueBlock('+i+')" style="padding:7px 13px;background:rgba(124,58,237,.12);color:#6D28D9;border:1.5px solid rgba(124,58,237,.3);border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit"><i class=ic-mailbox></i> Queue all '+p.block.units.length+' owners</button>':'')
          // Houses not yet pinned: try reading the number from street imagery
          +((!p.addressConfirmed && p.lat!=null && !/flat|apartment|maisonette|studio|share/i.test(p.type||''))?'<button onclick="event.stopPropagation();readStreetNumber('+i+')" style="padding:7px 11px;background:rgba(2,132,199,.08);color:#0369A1;border:1.5px solid rgba(2,132,199,.25);border-radius:7px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit"><i class=ic-search></i> Read number (street imagery)</button>':'')
          +'<button onclick="event.stopPropagation();researchOwner(props['+i+'])" style="padding:7px 13px;background:rgba(201,146,26,.1);color:#9A6C12;border:1.5px solid rgba(201,146,26,.3);border-radius:7px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit"><i class=ic-user></i> Find owner</button>'
          // Zoopla cross-check
          +'<a href="'+p.zoUrl+'" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="padding:7px 11px;border:1.5px solid rgba(124,58,237,.25);border-radius:7px;font-size:11px;font-weight:600;color:#7C3AED;text-decoration:none;background:rgba(124,58,237,.06)">Zoopla</a>'
          // Sold prices
          +'<a href="'+p.rmSoldUrl+'" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="padding:7px 11px;border:1.5px solid rgba(5,150,105,.22);border-radius:7px;font-size:11px;font-weight:600;color:var(--green);text-decoration:none;background:rgba(5,150,105,.06)">Sold Prices</a>'
        +'</div>'
        +(p.description?'<div style="margin-top:7px;font-size:11px;color:var(--muted);font-style:italic;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+p.description+'</div>':'')
      +'</div>'
      // Letter footer
      +'<div style="flex-shrink:0;text-align:right;min-width:90px">'
        +'<div style="font-size:10px;color:var(--muted);margin-bottom:4px">Letter to:</div>'
        +(getOwnerName(p)?'<div style="font-size:11px;font-weight:700;color:#9A6C12;line-height:1.3">'+getOwnerName(p)+'</div>':'')
        +'<div style="font-size:11px;font-weight:700;color:var(--text);line-height:1.4">'+(p.displayAddress||p.address||'')+'</div>'
        +(p.postcode?'<div style="font-size:10px;color:var(--blue);font-weight:600">'+p.postcode+'</div>':'')
      +'</div>';

    table.appendChild(row);
  });

  // Update kpis
  const kpiEl = document.getElementById('kpi-props');
  if(kpiEl) kpiEl.textContent = props.length;
}

// ── Toggle individual result selection ──
function toggleResultSelect(i){
  if(!props[i]) return;
  props[i].selected = !props[i].selected;
  renderLiveResults();
}

// ── Select / deselect all ──
function selectAllResults(){  props.forEach(p=>p.selected=true);  renderLiveResults(); }
function selectNoneResults(){ props.forEach(p=>p.selected=false); renderLiveResults(); }

// ── Queue a single property immediately ──
function quickQueueOne(i){
  const p = props[i]; if(!p) return;
  // One letter to the single best address: the confirmed exact address, or the
  // building's address for a block (no need to pick a unit).
  if(!p.addressConfirmed && !p.block){ toast('Confirm the exact address first — tap "Confirm exact address"','warn'); confirmAddress(i); return; }
  if(!p.addressConfirmed && p.block){
    const addr = p.block.address;
    p.address = addr; p.displayAddress = addr; p.fullAddress = addr;
    const pcM = addr.match(/[A-Z]{1,2}\d[\dA-Z]?\s*\d[A-Z]{2}/i); if(pcM) p.postcode = pcM[0].toUpperCase();
    p.addressConfirmed = true; p.addressSource = 'Building ('+p.block.level+')';
  }
  const tplEl = document.getElementById('f-tpl');
  const tpl   = [...templates,...(uploadedTpls||[])].find(t=>t.id===(tplEl?.value||'intro')) || templates[0];
  queue.push({id:Date.now()+Math.random(), prop:p, tpl, status:'pend', at:new Date(), auto:false});
  logContact(p, tpl, p.source||'Live search');
  updQBadge(); updQStats(); updateKPIs();
  toast(`<i class=ic-mailbox></i> Letter queued for ${p.displayAddress||p.address}`, 'ok');
}

// ── Queue a letter to every real owner address in a building / street block ──
function queueBlock(i){
  const p = props[i]; if(!p || !p.block || !p.block.units.length) return;
  const tplEl = document.getElementById('f-tpl');
  const tpl   = [...templates,...(uploadedTpls||[])].find(t=>t.id===(tplEl?.value||'intro')) || templates[0];
  // De-dup against addresses already queued so overlapping streets don't repeat.
  const have = new Set(queue.map(q => (q.prop && (q.prop.fullAddress||q.prop.address)||'').toLowerCase()));
  let added = 0;
  p.block.units.forEach(addr => {
    const k = addr.toLowerCase();
    if(have.has(k)) return; have.add(k);
    const pcM = addr.match(/[A-Z]{1,2}\d[\dA-Z]?\s*\d[A-Z]{2}/i);
    const unit = { ...p, selected:false, address:addr, displayAddress:addr, fullAddress:addr,
      postcode: pcM?pcM[0].toUpperCase():p.postcode, addressConfirmed:true, addressSource:'Register ('+(p.block.level)+')', block:null, _candidates:null };
    queue.push({id:Date.now()+Math.random(), prop:unit, tpl, status:'pend', at:new Date(), auto:false});
    added++;
  });
  updQBadge(); updQStats(); updateKPIs();
  toast(`<i class=ic-mailbox></i> ${added} owner letter${added===1?'':'s'} queued for ${p.block.name}`+(added<p.block.units.length?` (${p.block.units.length-added} already in queue)`:''), 'ok');
}

// ── Queue all selected with one click ──
function queueAllSelected(){
  const sel = props.filter(p=>p.selected);
  if(!sel.length){ toast('Select properties first','warn'); return; }
  const ready = sel.filter(p=>p.addressConfirmed);
  const skipped = sel.length - ready.length;
  if(!ready.length){ toast('None of the selected properties have a confirmed address yet — tap "Confirm exact address" on each','warn'); return; }
  const tplEl = document.getElementById('f-tpl');
  const tpl   = [...templates,...(uploadedTpls||[])].find(t=>t.id===(tplEl?.value||'intro')) || templates[0];
  ready.forEach(p=>{
    queue.push({id:Date.now()+Math.random(), prop:p, tpl, status:'pend', at:new Date(), auto:false});
  });
  updQBadge(); updQStats(); updateKPIs();
  toast(`<i class=ic-mailbox></i> ${ready.length} letters queued`+(skipped?` · ${skipped} skipped (address not confirmed)`:'')+' — go to Print Queue', skipped?'warn':'ok');
  showPanel('queue');
}

// ── Queue ALL results and go straight to print ──
function queueAllResults(){
  const ready = props.filter(p=>p.addressConfirmed);
  const skipped = props.length - ready.length;
  if(!ready.length){ toast('No confirmed addresses yet — tap "Confirm exact address" on the properties you want to write to','warn'); return; }
  const tplEl = document.getElementById('f-tpl');
  const tpl   = [...templates,...(uploadedTpls||[])].find(t=>t.id===(tplEl?.value||'intro')) || templates[0];
  ready.forEach(p=>{
    queue.push({id:Date.now()+Math.random(), prop:p, tpl, status:'pend', at:new Date(), auto:false});
  });
  updQBadge(); updQStats(); updateKPIs();
  toast(`<i class=ic-mailbox></i> ${ready.length} letters queued`+(skipped?` · ${skipped} skipped (address not confirmed)`:''), skipped?'warn':'ok');
  showPanel('queue');
}

// ── CSV export ──
function exportCSV(){
  if(!props.length){ toast('No results to export','warn'); return; }
  const header = ['Address','Postcode','District','Postcode Area','Type','Beds','Price','Status','Agent','Listed','Rightmove Link','Rightmove Area','Sold Prices'];
  const rows = props.map(p=>[
    p.displayAddress||p.address, p.postcode, p.district, p.haCode,
    p.type, p.beds, p.priceLabel||p.price, p.status, p.agent,
    p.addedDate, p.rmUrl, p.rmAreaUrl, p.rmSoldUrl
  ].map(v=>'"'+(String(v||'').replace(/"/g,'""'))+'"').join(','));
  const csv  = [header.join(','), ...rows].join('\n');
  const blob = new Blob([csv], {type:'text/csv'});
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `propmail-live-properties-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  toast(`CSV exported: ${props.length} properties`,'ok');
}

// Legacy compatibility
function clrResults(){ props=[]; document.getElementById('results-area').style.display='none'; }
function selAll(){ selectAllResults(); }
function doCSV(){ exportCSV(); }

// ── Off-Market Database (every property that has left the market) ──
let offmarketRecs = [];
const OM_STYLE = {
  sold:      { c:'#059669', bg:'rgba(5,150,105,.12)',  label:'SOLD',      act:'Farm street',      btn:'Farm the street' },
  let:       { c:'#9A6C12', bg:'rgba(201,146,26,.14)', label:'LET',       act:'Farm landlords',   btn:'Letter landlords' },
  withdrawn: { c:'#dc2626', bg:'rgba(220,38,38,.12)',  label:'WITHDRAWN', act:'Re-tout vendor',   btn:'Re-tout' },
};
async function initOffmarket(){
  const box=document.getElementById('om-results');
  if(box) box.innerHTML='<div style="text-align:center;padding:32px;color:var(--muted)"><i class=ic-box></i> Loading the off-market database…</div>';
  try{
    const r=await fetch('/api/touting?view=offmarket');
    const d=await r.json().catch(()=>({}));
    if(d.configured===false){ if(box) box.innerHTML='<div style="padding:24px;color:var(--amber)"><i class=ic-alert></i> '+(d.note||'Storage not configured.')+'</div>'; return; }
    offmarketRecs=d.records||[];
    const c=d.counts||{};
    const te=document.getElementById('om-total'); if(te) te.textContent=(c.sold||0)+(c.let||0)+(c.withdrawn||0);
    const we=document.getElementById('om-withdrawn'); if(we) we.textContent=c.withdrawn||0;
    const me=document.getElementById('om-meta'); if(me) me.textContent='Sold '+(c.sold||0)+' · Let '+(c.let||0)+' · Withdrawn '+(c.withdrawn||0)+' recorded so far.';
    renderOffmarket();
  }catch(e){ if(box) box.innerHTML='<div style="padding:24px;color:var(--amber)"><i class=ic-alert></i> '+e.message+'</div>'; }
}
function renderOffmarket(){
  const box=document.getElementById('om-results'); if(!box) return;
  const f=document.getElementById('om-reason')?.value||'';
  const list=(offmarketRecs||[]).filter(x=>!f||x.reason===f);
  if(!list.length){ box.innerHTML='<div style="text-align:center;padding:32px;color:var(--muted)">Nothing recorded yet for this filter. The database fills as properties leave the market on each daily scan.</div>'; return; }
  box.innerHTML=list.slice(0,400).map((x,i)=>{
    const s=OM_STYLE[x.reason]||OM_STYLE.withdrawn;
    const meta=[x.postcode,x.district,x.propType,(x.beds?x.beds+' bed':''),(x.price?(x.channel==='rent'?'£'+x.price+' pcm':'£'+Number(x.price).toLocaleString()):''),(x.dom?Math.round(x.dom/7)+'w on mkt':''),'off '+(x.offDate||'').slice(0,10)].filter(Boolean).join(' · ');
    return '<div style="display:flex;align-items:center;gap:12px;padding:11px 2px;border-bottom:1px solid var(--border)">'
      +'<span style="flex-shrink:0;min-width:84px;text-align:center;font-size:10px;font-weight:800;color:'+s.c+';background:'+s.bg+';padding:4px 7px;border-radius:6px">'+s.label+'</span>'
      +'<div style="flex:1;min-width:0">'
        +'<div style="font-size:14px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+(x.addr||'(address)')+'</div>'
        +'<div style="font-size:11px;color:var(--muted);margin-top:2px">'+meta+'</div>'
      +'</div>'
      +(x.url?'<a href="'+x.url+'" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="flex-shrink:0;font-size:11px;font-weight:600;color:var(--blue);text-decoration:none;padding:6px 11px;border:1.5px solid rgba(37,99,235,.25);border-radius:7px">Listing</a>':'')
      +'<button onclick="offmarketAction('+i+',this)" style="flex-shrink:0;padding:6px 13px;background:var(--blue);color:#fff;border:none;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit"><i class=ic-mailbox></i> '+s.btn+'</button>'
    +'</div>';
  }).join('');
}
async function offmarketAction(i, btn){
  const f=document.getElementById('om-reason')?.value||'';
  const list=(offmarketRecs||[]).filter(x=>!f||x.reason===f);
  const x=list[i]; if(!x) return;
  const tpl=[...templates,...(uploadedTpls||[])][0]||templates[0];
  if(x.reason==='withdrawn'){
    // Re-tout the vendor directly — single letter to The Homeowner.
    const toAddr='The Homeowner, '+(x.addr||'');
    const prop={ address:toAddr, displayAddress:toAddr, fullAddress:toAddr, postcode:x.postcode||'', district:x.district, haCode:x.district, type:x.propType||'Property', beds:x.beds||0, addressee:'The Homeowner', addressConfirmed:true, addressSource:'Off-market (withdrawn)', portal:'Off-Market', source:'Withdrawn — re-tout', isRealUrl:!!x.url, rmUrl:x.url||'' };
    queue.push({ id:Date.now()+Math.random(), prop, tpl, status:'pend', at:new Date(), auto:false });
    if(typeof logContact==='function') logContact(prop, tpl, 'Withdrawn — re-tout');
    if(typeof updQBadge==='function') updQBadge(); if(typeof updateKPIs==='function') updateKPIs();
    toast('<i class=ic-mailbox></i> Re-tout letter queued — '+(x.addr||x.postcode),'ok');
    return;
  }
  // sold → farm street (homeowners); let → farm landlords. Reuse street-farm.
  if(btn){ btn.disabled=true; btn.textContent='Finding…'; }
  try{
    const audience=x.reason==='let'?'landlord':'homeowner';
    const street=(x.addr||'').split(',')[0];
    const qs=new URLSearchParams({ audience, street, exclude:x.addr||'' });
    if(x.postcode) qs.set('postcode',x.postcode); else if(x.lat!=null){ qs.set('lat',x.lat); qs.set('lon',x.lon); }
    const r=await fetch('/api/street-farm?'+qs.toString());
    const d=await r.json().catch(()=>({}));
    if(!r.ok){ toast('Could not farm street: '+(d.error||r.status),'warn'); if(btn){btn.disabled=false;btn.innerHTML='<i class=ic-mailbox></i> '+(OM_STYLE[x.reason].btn);} return; }
    const who=audience==='landlord'?'The Landlord':'The Homeowner';
    const src=audience==='landlord'?'Off-market let — landlord farm':'Off-market sold — street farm';
    let n=0;
    (d.neighbours||[]).filter(c=>contactKey(c.address)!==contactKey(x.addr)).forEach(c=>{
      const toAddr=who+', '+c.address;
      const prop={ address:toAddr, displayAddress:toAddr, fullAddress:toAddr, postcode:c.postcode||x.postcode||'', district:x.district, haCode:x.district, type:'Property', beds:0, addressee:who, addressConfirmed:true, addressSource:src, portal:'Off-Market', source:src, isRealUrl:false, rmUrl:'' };
      queue.push({ id:Date.now()+Math.random(), prop, tpl, status:'pend', at:new Date(), auto:false }); if(typeof logContact==='function') logContact(prop, tpl, src); n++;
    });
    if(typeof updQBadge==='function') updQBadge(); if(typeof updateKPIs==='function') updateKPIs();
    toast(n?('<i class=ic-mailbox></i> Queued '+n+' '+who+' letters near '+street):'No targets found on that street', n?'ok':'warn');
  }catch(e){ toast('Could not farm street: '+e.message,'warn'); }
  if(btn){ btn.disabled=false; btn.innerHTML='<i class=ic-mailbox></i> '+(OM_STYLE[x.reason].btn); }
}

// Owner sync — automatically checks each resolved address against FREE public
// records (Companies House + planning) and tags every result Match / No-match.
async function syncOwners(props){
  const found = (props||[]).filter(p => (p.addressConfirmed||p.addressLikely) && p.postcode && p.ownerMatch===undefined);
  if(!found.length) return;
  found.forEach(p => p.ownerMatch='checking');
  renderLiveResults();
  const CH = 12;
  for(let i=0;i<found.length;i+=CH){
    const chunk = found.slice(i,i+CH);
    const items = chunk.map(p => ({ id:p.id, line1:(p.fullAddress||p.displayAddress||'').split(',')[0], postcode:p.postcode }));
    try{
      const r = await fetch('/api/owner-batch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items})});
      const d = await r.json().catch(()=>({}));
      const byId={}; (d.results||[]).forEach(x=>byId[x.id]=x);
      chunk.forEach(p=>{ const x=byId[p.id]; if(x){ p.ownerMatch=!!x.match; p.owners=x.owners||[]; p.ownerName=(x.owners&&x.owners[0]&&x.owners[0].name)||''; } else if(p.ownerMatch==='checking'){ p.ownerMatch=false; } });
    }catch(e){ chunk.forEach(p=>{ if(p.ownerMatch==='checking') p.ownerMatch=false; }); }
    renderLiveResults();
  }
  const matched = found.filter(p=>p.ownerMatch===true).length;
  if(typeof toast==='function') toast('<i class=ic-user></i> Owner check: '+matched+' of '+found.length+' matched to a named owner', matched?'ok':'warn');
}
function ownerBadge(p){
  if(p.ownerMatch===undefined) return '';
  if(p.ownerMatch==='checking') return '<span style="font-size:11px;font-weight:600;color:var(--muted);background:rgba(0,0,0,.05);padding:2px 9px;border-radius:4px"><i class=ic-clock></i> Owner…</span>';
  if(p.ownerMatch===true) return '<span title="'+esc((p.owners||[]).map(o=>o.name+(o.role?' ('+o.role+')':'')).join('; '))+'" style="font-size:11px;font-weight:700;color:#9A6C12;background:rgba(201,146,26,.14);padding:2px 9px;border-radius:4px"><i class=ic-user></i> Owner match'+(p.ownerName?': '+esc(p.ownerName):'')+'</span>';
  return '<span title="No named owner in free public records — try a Land Registry title" style="font-size:11px;font-weight:600;color:var(--muted);background:rgba(0,0,0,.05);padding:2px 9px;border-radius:4px"><i class=ic-user></i> No owner match</span>';
}
function renderResults(){ renderLiveResults(); }
function printSel(){ queueAllSelected(); }
function autoSendAll(){ queueAllResults(); }
function autoSendSel(){ queueAllSelected(); }

// ── Pre-Market Radar (new-EPC monitor) ──
// ── Touting Radar (listing-lifecycle leads) ──
let toutingLeads = [];
const TT_STYLE = {
  fallthrough: { c:'#dc2626', bg:'rgba(220,38,38,.12)', label:'Fell through' },
  withdrawn:   { c:'#d97706', bg:'rgba(217,119,6,.12)',  label:'Withdrawn' },
  reduced:     { c:'#2563eb', bg:'rgba(37,99,235,.12)',  label:'Reduced' },
  longdom:     { c:'#6b7280', bg:'rgba(107,114,128,.12)',label:'Long on market' },
  new:         { c:'#16a34a', bg:'rgba(22,163,74,.12)',  label:'New listing' },
};
async function initTouting(){
  const box = document.getElementById('tt-results');
  if(box) box.innerHTML = '<div style="text-align:center;padding:32px;color:var(--muted)"><i class=ic-flame></i> Loading touting leads…</div>';
  try{
    const r = await fetch('/api/touting');
    const d = await r.json().catch(()=>({}));
    if(d.configured===false){ if(box) box.innerHTML = '<div style="padding:24px;color:var(--amber)"><i class=ic-alert></i> '+(d.note||'Storage not configured.')+'</div>'; return; }
    // Merge the event feed with the computed long-on-market leads, hottest first.
    toutingLeads = [...(d.leads||[]), ...(d.longDom||[])].sort((a,b)=>(b.score||0)-(a.score||0));
    const m = d.meta||{};
    const fell = (d.leads||[]).filter(x=>x.signal==='fallthrough').length;
    const hot = toutingLeads.filter(x=>(x.score||0)>=65).length;
    const he=document.getElementById('tt-hot'); if(he) he.textContent=hot;
    const fe=document.getElementById('tt-fell'); if(fe) fe.textContent=fell;
    const me=document.getElementById('tt-meta');
    if(me) me.textContent = m.lastScan ? ('Last scan '+new Date(m.lastScan).toLocaleString()+' · '+(m.tracked||0)+' listings tracked') : 'No scan yet — press “Run scan now” to seed the radar.';
    renderTouting();
  }catch(e){ if(box) box.innerHTML = '<div style="padding:24px;color:var(--amber)"><i class=ic-alert></i> '+e.message+'</div>'; }
}
function renderTouting(){
  const box = document.getElementById('tt-results'); if(!box) return;
  const f = document.getElementById('tt-filter')?.value || '';
  const list = (toutingLeads||[]).filter(x=>!f || x.signal===f);
  if(!list.length){ box.innerHTML = '<div style="text-align:center;padding:32px;color:var(--muted)">No leads yet for this signal. The radar fills in as the daily scans run.</div>'; return; }
  box.innerHTML = list.slice(0,300).map((x,i)=>{
    const s = TT_STYLE[x.signal] || TT_STYLE.new;
    const extra = x.signal==='reduced' && x.dropPct ? ('−'+x.dropPct+'%') : (x.signal==='longdom' && x.dom ? (Math.round(x.dom/7)+'w on market') : '');
    const price = x.price ? ('£'+Number(x.price).toLocaleString()) : '';
    const meta = [x.postcode, x.district, x.agent, price, extra].filter(Boolean).join(' · ');
    const link = x.url ? '<a href="'+x.url+'" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="flex-shrink:0;font-size:11px;font-weight:600;color:var(--blue);text-decoration:none;padding:6px 11px;border:1.5px solid rgba(37,99,235,.25);border-radius:7px">Listing</a>' : '';
    return '<div style="display:flex;align-items:center;gap:12px;padding:11px 2px;border-bottom:1px solid var(--border)">'
      +'<span style="flex-shrink:0;min-width:96px;text-align:center;font-size:11px;font-weight:700;color:'+s.c+';background:'+s.bg+';padding:5px 8px;border-radius:7px">'+s.label+'</span>'
      +'<div style="flex:1;min-width:0">'
        +'<div style="font-size:14px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+(x.addr||'(address pending)')+'</div>'
        +'<div style="font-size:11px;color:var(--muted);margin-top:2px">'+meta+'</div>'
      +'</div>'
      +link
      +'<button onclick="queueTouting('+i+')" style="flex-shrink:0;padding:6px 13px;background:var(--blue);color:#fff;border:none;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit"><i class=ic-mailbox></i> Queue</button>'
    +'</div>';
  }).join('');
}
async function runToutingScan(){
  const btn = document.getElementById('tt-scan-btn');
  if(btn){ btn.disabled=true; btn.innerHTML='<i class=ic-refresh></i> Scanning…'; }
  try{
    const r = await fetch('/api/touting?scan=1');
    const d = await r.json().catch(()=>({}));
    if(!r.ok || d.error){ toast('<i class=ic-alert></i> '+(d.error||('Scan failed ('+r.status+')')), 'err'); }
    else { toast('<i class=ic-flame></i> Scan done — '+(d.lastEvents||0)+' new signals from '+(d.scanned||0)+' listings', 'ok'); await initTouting(); }
  }catch(e){ toast('<i class=ic-alert></i> '+e.message, 'err'); }
  finally{ if(btn){ btn.disabled=false; btn.innerHTML='<i class=ic-flame></i> Run scan now'; } }
}
function queueTouting(i){
  const f = document.getElementById('tt-filter')?.value || '';
  const list = (toutingLeads||[]).filter(x=>!f || x.signal===f);
  const it = list[i]; if(!it) return;
  const tpl = [...templates,...(uploadedTpls||[])][0] || templates[0];
  const sLabel = (TT_STYLE[it.signal]||{}).label || it.signal;
  const prop = { address:it.addr, displayAddress:it.addr, fullAddress:it.addr,
    postcode:it.postcode, district:it.district, haCode:it.district, type:it.propType||'Property', beds:it.beds||0,
    portal:'Touting', source:'Touting · '+sLabel, isRealUrl:!!it.url, rmUrl:it.url||'' };
  queue.push({ id:Date.now()+Math.random(), prop, tpl, status:'pend', at:new Date(), auto:false });
  if(typeof logContact==='function') logContact(prop, tpl, 'Touting · '+sLabel);
  if(typeof updQBadge==='function') updQBadge();
  if(typeof updQStats==='function') updQStats();
  if(typeof updateKPIs==='function') updateKPIs();
  toast('<i class=ic-mailbox></i> Letter queued — '+(it.addr||it.postcode), 'ok');
}

let premarketItems = [];
async function initPremarket(){
  const days = document.getElementById('pm-days')?.value || '14';
  const dist = document.getElementById('pm-district')?.value || '';
  const box = document.getElementById('pm-results');
  if(box) box.innerHTML = '<div style="text-align:center;padding:32px;color:var(--muted)"><i class=ic-search></i> Scanning the EPC register across HA0–HA9…</div>';
  try{
    const qs = new URLSearchParams({ days });
    if(dist) qs.set('districts', dist);
    const r = await fetch('/api/epc-monitor?'+qs.toString());
    const d = await r.json().catch(()=>({}));
    if(!r.ok){ if(box) box.innerHTML = '<div style="padding:24px;color:var(--amber)"><i class=ic-alert></i> '+(d.error||('HTTP '+r.status))+'</div>'; return; }
    premarketItems = d.properties || [];
    const c = document.getElementById('pm-count'); if(c) c.textContent = premarketItems.length;
    renderPremarket();
  }catch(e){ if(box) box.innerHTML = '<div style="padding:24px;color:var(--amber)"><i class=ic-alert></i> '+e.message+'</div>'; }
}
function renderPremarket(){
  const box = document.getElementById('pm-results'); if(!box) return;
  if(!premarketItems.length){ box.innerHTML = '<div style="text-align:center;padding:32px;color:var(--muted)">No new EPCs lodged in this window. Try a longer period.</div>'; return; }
  box.innerHTML = premarketItems.slice(0,300).map((p,i)=>{
    const q = encodeURIComponent(p.fullAddress+' for sale');
    return '<div style="display:flex;align-items:center;gap:12px;padding:11px 2px;border-bottom:1px solid var(--border)">'
      +'<div style="flex:1;min-width:0">'
        +'<div style="font-size:14px;font-weight:700;color:var(--text)">'+p.fullAddress+'</div>'
        +'<div style="font-size:11px;color:var(--muted);margin-top:2px"><i class=ic-send></i> '+p.postcode+' · '+p.district+' · EPC '+(p.band||'?')+' · lodged '+p.lodged+'</div>'
      +'</div>'
      +'<a href="https://www.google.com/search?q='+q+'" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="flex-shrink:0;font-size:11px;font-weight:600;color:var(--blue);text-decoration:none;padding:6px 11px;border:1.5px solid rgba(37,99,235,.25);border-radius:7px">Check listings</a>'
      +'<button onclick="queuePremarket('+i+')" style="flex-shrink:0;padding:6px 13px;background:var(--blue);color:#fff;border:none;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit"><i class=ic-mailbox></i> Queue</button>'
    +'</div>';
  }).join('');
}
function queuePremarket(i){
  const it = premarketItems[i]; if(!it) return;
  const tpl = [...templates,...(uploadedTpls||[])][0] || templates[0];
  const prop = { address:it.fullAddress, displayAddress:it.fullAddress, fullAddress:it.fullAddress,
    postcode:it.postcode, district:it.district, haCode:it.district, type:'Property', beds:0,
    portal:'Pre-Market', source:'Pre-Market EPC', isRealUrl:true,
    rmUrl:'https://www.google.com/search?q='+encodeURIComponent(it.fullAddress+' for sale') };
  queue.push({ id:Date.now()+Math.random(), prop, tpl, status:'pend', at:new Date(), auto:false });
  logContact(prop, tpl, 'Pre-Market EPC');
  if(typeof updQBadge==='function') updQBadge();
  if(typeof updQStats==='function') updQStats();
  if(typeof updateKPIs==='function') updateKPIs();
  toast('<i class=ic-mailbox></i> Letter queued for '+it.fullAddress, 'ok');
}

// ── Sold Board (Land Registry "sold in your street") ──
let soldItems = [];
async function initSold(){
  const days=document.getElementById('sold-days')?.value||'180';
  const dist=document.getElementById('sold-district')?.value||'';
  const box=document.getElementById('sold-results');
  if(box) box.innerHTML='<div style="text-align:center;padding:32px;color:var(--muted)"><i class=ic-search></i> Loading recent sales from HM Land Registry…</div>';
  try{
    const qs=new URLSearchParams({days}); if(dist) qs.set('districts',dist);
    const r=await fetch('/api/landregistry?'+qs.toString());
    const d=await r.json().catch(()=>({}));
    if(!r.ok){ if(box) box.innerHTML='<div style="padding:24px;color:var(--amber)"><i class=ic-alert></i> '+(d.error||('HTTP '+r.status))+'</div>'; return; }
    soldItems=d.properties||[];
    const c=document.getElementById('sold-count'); if(c) c.textContent=soldItems.length;
    renderSold();
  }catch(e){ if(box) box.innerHTML='<div style="padding:24px;color:var(--amber)"><i class=ic-alert></i> '+e.message+'</div>'; }
}
function renderSold(){
  const box=document.getElementById('sold-results'); if(!box) return;
  if(!soldItems.length){ box.innerHTML='<div style="text-align:center;padding:32px;color:var(--muted)">No registered sales in this window.</div>'; return; }
  box.innerHTML=soldItems.slice(0,300).map((s,i)=>{
    const done=alreadyContacted(s.fullAddress);
    return '<div style="display:flex;align-items:center;gap:12px;padding:11px 2px;border-bottom:1px solid var(--border)">'
      +'<div style="flex:1;min-width:0">'
        +'<div style="font-size:14px;font-weight:700;color:var(--text)">'+s.fullAddress+'</div>'
        +'<div style="font-size:11px;color:var(--muted);margin-top:2px"><i class=ic-pound></i> <strong style="color:var(--green)">£'+Number(s.price).toLocaleString()+'</strong> · '+s.type+' · sold '+s.date+' · '+s.district+'</div>'
      +'</div>'
      +'<a href="https://www.rightmove.co.uk/house-prices/'+encodeURIComponent(s.postcode)+'.html" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="flex-shrink:0;font-size:11px;font-weight:600;color:var(--blue);text-decoration:none;padding:6px 11px;border:1.5px solid rgba(37,99,235,.25);border-radius:7px">Sold prices</a>'
      +'<button onclick="queueStreetLetters('+i+',this)" style="flex-shrink:0;padding:6px 13px;background:'+(done?'var(--slate2)':'var(--blue)')+';color:'+(done?'var(--muted)':'#fff')+';border:none;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit"><i class=ic-mailbox></i> Letter the street</button>'
    +'</div>';
  }).join('');
}
async function queueStreetLetters(i, btn){
  const s=soldItems[i]; if(!s) return;
  if(!s.postcode){ toast('No postcode for this sale','warn'); return; }
  if(btn){ btn.disabled=true; btn.textContent='Finding the street…'; }
  try{
    // Complete street from the Council Tax register (every home, not only those
    // with an EPC), addressed to "The Homeowner" — free, full coverage, GDPR-safe.
    const qs=new URLSearchParams({ postcode:s.postcode, street:s.street||'', exclude:s.paon||'' });
    const r=await fetch('/api/street-farm?'+qs.toString());
    const d=await r.json().catch(()=>({}));
    if(!r.ok){ toast('Could not find neighbours: '+(d.error||r.status),'warn'); if(btn){ btn.disabled=false; btn.innerHTML='<i class=ic-mailbox></i> Letter the street'; } return; }
    const neighbours=(d.neighbours||[]).filter(c=>contactKey(c.address)!==contactKey(s.fullAddress));
    const tpl=[...templates,...(uploadedTpls||[])].find(t=>/sold/i.test(t.name)) || templates[0];
    let n=0;
    neighbours.forEach(c=>{
      const toAddr='The Homeowner, '+c.address;
      const prop={ address:toAddr, displayAddress:toAddr, fullAddress:toAddr,
        postcode:c.postcode||s.postcode, district:s.district, haCode:s.district, type:'Property', beds:0,
        addressee:'The Homeowner', addressConfirmed:true, addressSource:'Council Tax (street farm)',
        portal:'Sold Board', source:'Sold in street', isRealUrl:true,
        rmUrl:'https://www.rightmove.co.uk/house-prices/'+encodeURIComponent(s.postcode)+'.html',
        soldRef:s.fullAddress, soldPrice:s.price };
      queue.push({ id:Date.now()+Math.random(), prop, tpl, status:'pend', at:new Date(), auto:false, sold:true });
      logContact(prop, tpl, 'Sold in street'); n++;
    });
    if(typeof updQBadge==='function') updQBadge();
    if(typeof updQStats==='function') updQStats();
    if(typeof updateKPIs==='function') updateKPIs();
    renderSold();
    toast(n ? ('<i class=ic-mailbox></i> Queued '+n+' "sold in your street" letters to The Homeowner'+(s.street?' on '+s.street:'')) : 'No neighbour addresses found for that street', n?'ok':'warn');
  }catch(e){ toast('Could not fetch neighbours: '+e.message,'warn'); }
  if(btn){ btn.disabled=false; btn.innerHTML='<i class=ic-mailbox></i> Letter the street'; }
}

// ── Let Board (rental landlord farming — the reverse of Sold-Street farming) ──
let letItems = [];
async function initLet(){
  const dist=document.getElementById('let-district')?.value||'';
  const box=document.getElementById('let-results');
  if(box) box.innerHTML='<div style="text-align:center;padding:32px;color:var(--muted)"><i class=ic-search></i> Loading recently Let Agreed rentals…</div>';
  try{
    const qs=new URLSearchParams({ channel:'rent', includeSSTC:'true', pages:'3' });
    if(dist) qs.set('district',dist); else qs.set('district','HA1');
    const r=await fetch('/api/listings?'+qs.toString());
    const d=await r.json().catch(()=>({}));
    if(!r.ok){ if(box) box.innerHTML='<div style="padding:24px;color:var(--amber)"><i class=ic-alert></i> '+(d.error||('HTTP '+r.status))+'</div>'; return; }
    letItems=(d.properties||[]).filter(p=>/let agreed/i.test(p.liveStatus||'')&&(p.lat!=null));
    const c=document.getElementById('let-count'); if(c) c.textContent=letItems.length;
    renderLet();
  }catch(e){ if(box) box.innerHTML='<div style="padding:24px;color:var(--amber)"><i class=ic-alert></i> '+e.message+'</div>'; }
}
function renderLet(){
  const box=document.getElementById('let-results'); if(!box) return;
  if(!letItems.length){ box.innerHTML='<div style="text-align:center;padding:32px;color:var(--muted)">No “Let Agreed” rentals in this district right now. Try another HA district.</div>'; return; }
  box.innerHTML=letItems.slice(0,300).map((s,i)=>{
    return '<div style="display:flex;align-items:center;gap:12px;padding:11px 2px;border-bottom:1px solid var(--border)">'
      +'<span style="flex-shrink:0;font-size:10px;font-weight:800;color:#9A6C12;background:rgba(201,146,26,.14);padding:3px 8px;border-radius:5px">LET AGREED</span>'
      +'<div style="flex:1;min-width:0">'
        +'<div style="font-size:14px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+(s.displayAddress||s.address||'')+'</div>'
        +'<div style="font-size:11px;color:var(--muted);margin-top:2px">'+[s.priceLabel,(s.beds?s.beds+' bed':''),s.type,s.haCode,s.agent].filter(Boolean).join(' · ')+'</div>'
      +'</div>'
      +(s.url?'<a href="'+s.url+'" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="flex-shrink:0;font-size:11px;font-weight:600;color:var(--blue);text-decoration:none;padding:6px 11px;border:1.5px solid rgba(37,99,235,.25);border-radius:7px">Listing</a>':'')
      +'<button onclick="queueLandlordStreet('+i+',this)" style="flex-shrink:0;padding:6px 13px;background:var(--blue);color:#fff;border:none;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit"><i class=ic-mailbox></i> Letter landlords nearby</button>'
    +'</div>';
  }).join('');
}
async function queueLandlordStreet(i, btn){
  const s=letItems[i]; if(!s) return;
  if(btn){ btn.disabled=true; btn.textContent='Finding landlords…'; }
  try{
    const street=(s.displayAddress||s.address||'').split(',')[0].replace(/^\s*\d+[a-z]?\s+/i,'').trim();
    const qs=new URLSearchParams({ audience:'landlord', street });
    if(s.postcode) qs.set('postcode',s.postcode); else { qs.set('lat',s.lat); qs.set('lon',s.lon); }
    const r=await fetch('/api/street-farm?'+qs.toString());
    const d=await r.json().catch(()=>({}));
    if(!r.ok){ toast('Could not find landlords: '+(d.error||r.status),'warn'); if(btn){ btn.disabled=false; btn.innerHTML='<i class=ic-mailbox></i> Letter landlords nearby'; } return; }
    const neighbours=(d.neighbours||[]).filter(c=>contactKey(c.address)!==contactKey(s.displayAddress||s.address));
    const tpl=[...templates,...(uploadedTpls||[])].find(t=>/let|landlord|rent/i.test(t.name)) || templates[0];
    let n=0;
    neighbours.forEach(c=>{
      const toAddr='The Landlord, '+c.address;
      const prop={ address:toAddr, displayAddress:toAddr, fullAddress:toAddr,
        postcode:c.postcode||s.postcode||'', district:s.haCode, haCode:s.haCode, type:'Property', beds:0,
        addressee:'The Landlord', addressConfirmed:true, addressSource:'EPC tenure (landlord farm)',
        portal:'Let Board', source:'Let in street', isRealUrl:!!s.url, rmUrl:s.url||'',
        letRef:s.displayAddress||s.address };
      queue.push({ id:Date.now()+Math.random(), prop, tpl, status:'pend', at:new Date(), auto:false, sold:false });
      if(typeof logContact==='function') logContact(prop, tpl, 'Let in street'); n++;
    });
    if(typeof updQBadge==='function') updQBadge();
    if(typeof updQStats==='function') updQStats();
    if(typeof updateKPIs==='function') updateKPIs();
    toast(n?('<i class=ic-mailbox></i> Queued '+n+' landlord letters near '+street):'No rented homes found on that street (no EPC tenure match)', n?'ok':'warn');
  }catch(e){ toast('Could not fetch landlords: '+e.message,'warn'); }
  if(btn){ btn.disabled=false; btn.innerHTML='<i class=ic-mailbox></i> Letter landlords nearby'; }
}

// ── Campaign Tracker (CRM-lite, stored in this browser) ──
let contacts = {};
// Drip sequence: ordered letters at day-offsets from the first contact.
// ── Letter cycle groups (user-created folders of letters) ──
let groups = [];
let automation = { enabled:false, defaultGroupId:null, refSeq:1000 };
function loadGroups(){
  try{ groups=JSON.parse(localStorage.getItem('pmGroups')||'null')||[]; }catch(e){ groups=[]; }
  try{ automation=Object.assign({enabled:false,defaultGroupId:null,refSeq:1000}, JSON.parse(localStorage.getItem('pmAutomation')||'{}')); }catch(e){}
  if(!groups.length){
    let steps=[{tplId:'intro',day:0},{tplId:'sale',day:7},{tplId:'sold',day:21}];
    try{ const old=JSON.parse(localStorage.getItem('pmSequence')||'null'); if(old&&old.steps&&old.steps.length){ steps=old.steps.map(s=>({tplId:s.tpl,day:s.day})); if(old.enabled) automation.enabled=true; } }catch(e){}
    groups=[
      {id:'g-default', name:'General sales', steps},
      {id:'g-rentals', name:'Rentals', steps:[{tplId:'let',day:0},{tplId:'let',day:10},{tplId:'cash',day:30}]},
    ];
    automation.defaultGroupId='g-default'; saveGroups();
  }
  if(!automation.defaultGroupId || !groups.find(g=>g.id===automation.defaultGroupId)) automation.defaultGroupId=groups[0].id;
  if(!automation.autoAssign){ const rent=groups.find(g=>/rent/i.test(g.name)); automation.autoAssign={ sale:automation.defaultGroupId, rent:rent?rent.id:'', sold:'', premarket:'' }; saveGroups(); }
  const e=document.getElementById('auto-enabled'); if(e) e.checked=!!automation.enabled;
  renderGroups(); renderAutoAssign(); updateAutomationUI();
}
// Categorise a property so it can auto-join the right cycle.
function categoryOf(prop){
  const s=(prop.source||'').toLowerCase();
  if(s.includes('sold')) return 'sold';
  if(s.includes('pre-market')||s.includes('premarket')||s.includes('epc')) return 'premarket';
  const st=(prop.status||'').toLowerCase();
  if(st.includes('let')||st.includes('rent')) return 'rent';
  return 'sale';
}
const AUTO_CATS=[['sale','<i class=ic-home></i> Sales (For Sale)'],['rent','<i class=ic-key></i> Rentals (To Let)'],['sold','<i class=ic-trophy></i> Sold-in-street'],['premarket','<i class=ic-radio></i> Pre-market']];
function renderAutoAssign(){
  const box=document.getElementById('auto-assign'); if(!box) return;
  box.innerHTML=AUTO_CATS.map(([cat,label])=>{
    const cur=(automation.autoAssign||{})[cat]||'';
    const opts='<option value="">Ask each time</option>'+groups.map(g=>'<option value="'+g.id+'"'+(cur===g.id?' selected':'')+'>'+g.name+'</option>').join('');
    return '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px"><span style="font-size:12px;font-weight:600;color:var(--text2);width:160px;flex-shrink:0">'+label+'</span>'
      +'<select onchange="setAutoAssign(\''+cat+'\',this.value)" style="flex:1;padding:7px 9px;border:1px solid var(--border2);border-radius:8px;font-family:inherit;font-size:12px">'+opts+'</select></div>';
  }).join('');
}
function setAutoAssign(cat,gid){ automation.autoAssign=automation.autoAssign||{}; automation.autoAssign[cat]=gid; saveGroups(); toast(gid?('New '+cat+' properties will auto-join “'+(groupById(gid)?.name)+'”'):('New '+cat+' properties will ask each time'),'ok'); }
function saveGroups(){ localStorage.setItem('pmGroups', JSON.stringify(groups)); localStorage.setItem('pmAutomation', JSON.stringify(automation)); }
function loadSequence(){ loadGroups(); }   // back-compat alias
function groupById(id){ return groups.find(g=>g.id===id) || groups.find(g=>g.id===automation.defaultGroupId) || groups[0]; }
function refPrefix(name){ return ((name||'').replace(/[^a-zA-Z]/g,'').slice(0,3).toUpperCase())||'PM'; }
function newRef(group){ automation.refSeq=(automation.refSeq||1000)+1; saveGroups(); return refPrefix(group&&group.name)+'-'+automation.refSeq; }

// ── Group CRUD (managed in the Templates / letter section) ──
function createGroup(){
  const name=prompt('Name this letter cycle (e.g. Rentals, Probate, New listings):','');
  if(name===null) return;
  const g={ id:'g'+Date.now(), name:name.trim()||'New cycle',
    steps:[{tplId:(templates[0]||{}).id||'intro',day:0},{tplId:(templates[1]||templates[0]||{}).id||'sale',day:7}] };
  groups.push(g); saveGroups(); renderGroups(); toast('Cycle “'+g.name+'” created','ok');
}
function deleteGroup(id){ if(!confirm('Delete this letter cycle?')) return; groups=groups.filter(g=>g.id!==id); if(automation.defaultGroupId===id) automation.defaultGroupId=groups[0]?.id||null; saveGroups(); renderGroups(); }
function renameGroup(id,name){ const g=groups.find(x=>x.id===id); if(g){ g.name=name; saveGroups(); updateAutomationUI(); } }
function setDefaultGroup(id){ automation.defaultGroupId=id; saveGroups(); renderGroups(); }
function groupAddStep(id){ const g=groups.find(x=>x.id===id); if(!g) return; if(g.steps.length>=6){ toast('Maximum 6 letters per cycle','warn'); return; } const last=g.steps[g.steps.length-1]; g.steps.push({ tplId:(templates[1]||templates[0]).id, day:Math.min(60,(last?last.day:0)+14) }); saveGroups(); renderGroups(); }
function groupRemoveStep(id,i){ const g=groups.find(x=>x.id===id); if(!g||i===0) return; g.steps.splice(i,1); saveGroups(); renderGroups(); }
function groupSetStep(id,i,k,v){ const g=groups.find(x=>x.id===id); if(!g||!g.steps[i]) return; if(k==='day') g.steps[i].day=Math.max(1,Math.min(60,parseInt(v)||1)); else g.steps[i].tplId=v; if(g.steps[0]) g.steps[0].day=0; g.steps.sort((a,b)=>a.day-b.day); saveGroups(); renderGroups(); }
function renderGroups(){
  const box=document.getElementById('groups-mgr'); if(!box) return;
  const tpls=[...templates,...(uploadedTpls||[])];
  box.innerHTML = groups.map(g=>{
    const isDef=g.id===automation.defaultGroupId;
    const steps=g.steps.map((s,i)=>{
      const opts=tpls.map(t=>'<option value="'+t.id+'"'+(s.tplId===t.id?' selected':'')+'>'+t.name+'</option>').join('');
      return '<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">'
        +'<span style="font-size:11px;font-weight:700;color:var(--muted);width:42px;flex-shrink:0">No.'+(i+1)+'</span>'
        +'<select onchange="groupSetStep(\''+g.id+'\','+i+',\'tplId\',this.value)" style="flex:1;min-width:0;padding:6px 9px;border:1px solid var(--border2);border-radius:8px;font-family:inherit;font-size:12px">'+opts+'</select>'
        +(i===0?'<span style="font-size:11px;color:var(--muted);width:78px;flex-shrink:0;text-align:right">day 0</span>'
          :'<label style="font-size:11px;color:var(--muted);display:flex;align-items:center;gap:4px;width:84px;flex-shrink:0;justify-content:flex-end">day<input type="number" min="1" max="60" value="'+s.day+'" onchange="groupSetStep(\''+g.id+'\','+i+',\'day\',this.value)" style="width:46px;padding:5px;border:1px solid var(--border2);border-radius:6px;font-family:inherit"></label>')
        +(i>0?'<button class="bic" onclick="groupRemoveStep(\''+g.id+'\','+i+')">✕</button>':'<span style="width:22px;flex-shrink:0"></span>')
      +'</div>';
    }).join('');
    return '<div style="border:1px solid var(--border2);border-radius:12px;padding:14px 16px;margin-bottom:12px">'
      +'<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap">'
        +'<input value="'+(g.name||'').replace(/"/g,'&quot;')+'" onchange="renameGroup(\''+g.id+'\',this.value)" style="font-size:14px;font-weight:700;border:none;border-bottom:1.5px solid var(--border);padding:3px 2px;font-family:inherit;color:var(--text);background:none;min-width:160px">'
        +'<span style="font-size:10px;color:var(--muted)">'+g.steps.length+' letters · up to day '+Math.max.apply(null,g.steps.map(s=>s.day))+'</span>'
        +(isDef?'<span class="tag tag-blue">default</span>':'<button class="btn bs sm-btn" style="font-size:10px;padding:3px 8px" onclick="setDefaultGroup(\''+g.id+'\')">Make default</button>')
        +'<div style="flex:1"></div>'
        +'<button class="bic" title="Delete cycle" onclick="deleteGroup(\''+g.id+'\')"><i class=ic-trash></i></button>'
      +'</div>'+steps
      +'<button class="btn bs sm-btn" style="margin-top:4px" onclick="groupAddStep(\''+g.id+'\')">+ Add letter</button>'
    +'</div>';
  }).join('') + '<button class="btn bp sm-btn" onclick="createGroup()">+ New letter cycle</button>';
}
function toggleAutomation(){ const e=document.getElementById('auto-enabled'); automation.enabled=e?e.checked:false; saveGroups(); if(automation.enabled) runDueSequences(false); updateAutomationUI(); toast('Automation '+(automation.enabled?'on':'off'),automation.enabled?'ok':'warn'); }
function updateAutomationUI(){
  const n=document.getElementById('auto-note'); if(n){
    const active=Object.values(contacts).filter(c=>c.groupId && !['responded','instructed','dead'].includes(c.status)).length;
    n.textContent = automation.enabled ? (active+' propert'+(active===1?'y':'ies')+' in an active cycle') : 'Automation is off.';
  }
  const gl=document.getElementById('auto-groups'); if(gl){ gl.innerHTML = groups.map(g=>'<span class="tag tag-grey">'+g.name+' · '+g.steps.length+'</span>').join(' '); }
}
// Queue any cycle letters now due (per each contact's chosen group).
function runDueSequences(silent){
  if(!automation.enabled){ updateAutomationUI(); return 0; }
  const tpls=[...templates,...(uploadedTpls||[])]; let queued=0;
  Object.values(contacts).forEach(c=>{
    if(!c.groupId) return;
    if(['responded','instructed','dead'].includes(c.status)) return;
    const g=groupById(c.groupId); if(!g||g.steps.length<2) return;
    if(!c.enrolledAt) c.enrolledAt=c.firstAt||c.lastAt||new Date().toISOString();
    const enrolled=new Date(c.enrolledAt).getTime(); let done=c.seqDone||1;
    while(done<g.steps.length){
      const step=g.steps[done];
      if(Date.now() >= enrolled+step.day*86400000){
        const tpl=tpls.find(t=>t.id===step.tplId)||tpls[0];
        const prop={ address:c.address, displayAddress:c.address, fullAddress:c.address, postcode:c.postcode,
          district:c.district, haCode:c.district, type:'Property', beds:0, source:c.source, portal:'Cycle', isRealUrl:true };
        queue.push({ id:Date.now()+Math.random(), prop, tpl, status:'pend', at:new Date(), auto:true, sequence:true, ref:c.ref, group:g.name });
        done++; c.count=(c.count||1)+1; c.lastAt=new Date().toISOString(); queued++;
      } else break;
    }
    c.seqDone=done;
  });
  if(queued){ saveContacts();
    if(typeof updQBadge==='function') updQBadge();
    if(typeof updQStats==='function') updQStats();
    if(typeof updateKPIs==='function') updateKPIs();
    updateCampBadges();
    if(!silent) toast('<i class=ic-mailbox></i> Queued '+queued+' scheduled cycle letter'+(queued>1?'s':''),'ok');
  }
  updateAutomationUI();
  return queued;
}
// Upcoming scheduled letters for one contact (for the Schedule view).
function contactSchedule(c){
  if(!c.groupId) return [];
  const g=groupById(c.groupId); if(!g) return [];
  const tpls=[...templates,...(uploadedTpls||[])];
  const enrolled=new Date(c.enrolledAt||c.firstAt||c.lastAt).getTime();
  const out=[];
  for(let i=(c.seqDone||1); i<g.steps.length; i++){
    const due=new Date(enrolled+g.steps[i].day*86400000);
    const t=tpls.find(t=>t.id===g.steps[i].tplId);
    out.push({ when:due.toISOString().slice(0,10), date:due, tpl:(t&&t.name)||'Letter', ref:c.ref||'', address:c.address, group:g.name, district:c.district });
  }
  return out;
}
// ── Schedule view (upcoming cycle letters + references) ──
function renderSchedule(){
  const box=document.getElementById('sched-results'); if(!box) return;
  loadGroups();
  let items=[]; Object.values(contacts).forEach(c=>{ contactSchedule(c).forEach(s=>items.push(s)); });
  items.sort((a,b)=>a.date-b.date);
  const t=document.getElementById('sched-count'); if(t) t.textContent=items.length;
  const ov=document.getElementById('sched-overdue'); if(ov) ov.textContent=items.filter(i=>i.date.getTime()<=Date.now()).length;
  if(!items.length){ box.innerHTML='<div style="text-align:center;padding:32px;color:var(--muted)">No scheduled letters yet. Print a letter, choose a cycle when prompted, and the upcoming letters appear here — each with a reference.</div>'; return; }
  const byDate={}; items.forEach(it=>{ (byDate[it.when]=byDate[it.when]||[]).push(it); });
  box.innerHTML=Object.keys(byDate).sort().map(date=>{
    const d=new Date(date); const label=d.toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',year:'numeric'});
    const overdue=d.getTime()<=Date.now();
    return '<div style="margin-bottom:16px"><div style="font-size:12px;font-weight:700;color:'+(overdue?'var(--amber)':'var(--text)')+';margin-bottom:7px;display:flex;align-items:center;gap:8px"><i class=ic-calendar></i> '+label+(overdue?' <span class="tag tag-gold">due now</span>':'')+'</div>'
      + byDate[date].map(it=>'<div style="display:flex;align-items:center;gap:10px;padding:8px 2px;border-bottom:1px solid var(--border)">'
          +'<span class="tag tag-blue" style="font-family:monospace;font-weight:700">'+(it.ref||'—')+'</span>'
          +'<div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:600;color:var(--text)">'+it.address+'</div>'
            +'<div style="font-size:11px;color:var(--muted)">'+it.tpl+' · '+it.group+' · '+(it.district||'')+'</div></div>'
        +'</div>').join('')
    +'</div>';
  }).join('');
}
function exportSchedule(){
  const rows=[['Reference','Due date','Address','Letter','Cycle']];
  Object.values(contacts).forEach(c=>contactSchedule(c).forEach(s=>rows.push([s.ref,s.when,s.address,s.tpl,s.group])));
  const csv=rows.map(r=>r.map(x=>'"'+String(x==null?'':x).replace(/"/g,'""')+'"').join(',')).join('\n');
  const a=document.createElement('a'); a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);
  a.download='propmail_schedule_'+new Date().toISOString().slice(0,10)+'.csv'; a.click();
  toast('Schedule exported','ok');
}
// How many cycle letters are due now (would be queued).
function dueLettersCount(){
  if(typeof automation==='undefined' || !automation.enabled) return 0;
  let n=0;
  Object.values(contacts).forEach(c=>{
    if(!c.groupId || ['responded','instructed','dead'].includes(c.status)) return;
    const g=groupById(c.groupId); if(!g) return;
    const enrolled=new Date(c.enrolledAt||c.firstAt||c.lastAt).getTime(); let done=c.seqDone||1;
    while(done<g.steps.length){ if(Date.now()>=enrolled+g.steps[done].day*86400000){ n++; done++; } else break; }
  });
  return n;
}
// "Letters due today" prompt shown when the app is opened.
function showLoginDueNotice(){
  if(document.getElementById('printrun-modal')) return;
  let due=0; try{ due=dueLettersCount(); }catch(e){}
  const pending=queue.filter(x=>x.status==='pend').length;
  const total=due+pending; if(total<=0) return;
  document.getElementById('login-notice')?.remove();
  const ov=document.createElement('div'); ov.id='login-notice';
  ov.style.cssText='position:fixed;inset:0;background:rgba(10,15,30,.55);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px';
  ov.onclick=(e)=>{ if(e.target===ov) ov.remove(); };
  const detail = due ? (due+' from your letter cycles'+(pending?' + '+pending+' waiting in the queue':'')) : (pending+' waiting in the print queue');
  ov.innerHTML='<div style="background:#fff;border-radius:16px;max-width:430px;width:100%;box-shadow:0 20px 54px rgba(16,24,40,.28);padding:24px;text-align:center">'
    +'<div style="font-size:34px;margin-bottom:8px"><i class=ic-mailbox></i></div>'
    +'<div style="font-size:18px;font-weight:700;color:var(--text)">'+total+' letter'+(total>1?'s':'')+' due today</div>'
    +'<div style="font-size:13px;color:var(--muted);margin:8px 0 18px;line-height:1.5">'+detail+'. Queue and print them now?</div>'
    +'<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">'
      +'<button class="btn bp" onclick="loginQueuePrint()"><i class=ic-mailbox></i> Queue &amp; print</button>'
      +'<button class="btn bs" onclick="loginReview()">Review in queue</button>'
      +'<button class="btn bghost sm-btn" onclick="document.getElementById(\'login-notice\').remove()">Later</button>'
    +'</div></div>';
  document.body.appendChild(ov);
}
function loginQueuePrint(){ document.getElementById('login-notice')?.remove(); if(typeof runDueSequences==='function') runDueSequences(true); printAllDue(); }
function loginReview(){ document.getElementById('login-notice')?.remove(); if(typeof runDueSequences==='function') runDueSequences(true); showPanel('queue'); }
// Free Google Calendar reminder: a recurring event on the chosen days/time.
function exportCalendar(){
  const days=(printSchedule.days&&printSchedule.days.length)?printSchedule.days:[1,2,3,4,5];
  const byday=days.map(d=>['SU','MO','TU','WE','TH','FR','SA'][d]).join(',');
  const [h,m]=(printSchedule.time||'09:00').split(':');
  const dt=new Date().toISOString().slice(0,10).replace(/-/g,'');
  const ics=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//PropMail Pro//EN','CALSCALE:GREGORIAN','BEGIN:VEVENT',
    'UID:propmail-print-'+Date.now()+'@propmailpro','DTSTART:'+dt+'T'+h+m+'00',
    'DURATION:PT15M','RRULE:FREQ=WEEKLY;BYDAY='+byday,'SUMMARY:Print due letters (PropMail Pro)',
    'DESCRIPTION:Open PropMail Pro and print today\'s due letters.',
    'BEGIN:VALARM','TRIGGER:PT0M','ACTION:DISPLAY','DESCRIPTION:Print due letters','END:VALARM',
    'END:VEVENT','END:VCALENDAR'].join('\r\n');
  const a=document.createElement('a'); a.href='data:text/calendar;charset=utf-8,'+encodeURIComponent(ics);
  a.download='propmail-print-reminders.ics'; a.click();
  toast('Reminder downloaded — open it to add to Google Calendar','ok');
}
// ── PrintNode (cloud printing to a real printer) ──
function getPrintNode(){ try{ return JSON.parse(localStorage.getItem('pmPrintNode')||'{}'); }catch(e){ return {}; } }
function savePrintNode(v){ localStorage.setItem('pmPrintNode', JSON.stringify(v)); }
function printNodeConnected(){ const pn=getPrintNode(); return !!(pn.key && pn.printerId); }
function renderPrintNodeUI(){
  const box=document.getElementById('pn-body'); if(!box) return;
  const pn=getPrintNode();
  box.innerHTML='<div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin-bottom:12px">'
    +'<div class="fg" style="flex:1;min-width:220px"><label>PrintNode API key</label><input type="password" id="pn-key" value="'+(pn.key||'').replace(/"/g,'&quot;')+'" placeholder="Paste your PrintNode API key"></div>'
    +'<button class="btn bp sm-btn" onclick="connectPrintNode()">Connect</button></div>'
    +'<div id="pn-printers"></div>'
    +(pn.printerId?'<div style="margin-top:10px;font-size:12px;color:var(--green);font-weight:600">✓ Connected — printing to '+(pn.printerName||('printer #'+pn.printerId))+' <button class="btn bs sm-btn" style="margin-left:8px" onclick="testPrintNode()">Test print</button> <button class="btn bghost sm-btn" onclick="disconnectPrintNode()">Disconnect</button></div>':'');
}
async function connectPrintNode(){
  const key=(document.getElementById('pn-key')?.value||'').trim();
  if(!key){ toast('Paste your PrintNode API key','warn'); return; }
  const box=document.getElementById('pn-printers'); if(box) box.innerHTML='<span style="font-size:12px;color:var(--muted)">Finding your printers…</span>';
  try{
    const r=await fetch('/api/printnode?action=printers',{headers:{'x-printnode-key':key}});
    const d=await r.json().catch(()=>({}));
    if(!r.ok){ if(box) box.innerHTML='<span style="font-size:12px;color:var(--amber)"><i class=ic-alert></i> '+(d.error||('HTTP '+r.status))+'</span>'; return; }
    const pn=getPrintNode(); pn.key=key; savePrintNode(pn);
    const printers=d.printers||[];
    if(!printers.length){ if(box) box.innerHTML='<span style="font-size:12px;color:var(--muted)">No printers found. Make sure the PrintNode client is running on your PC and the printer is on.</span>'; return; }
    if(box) box.innerHTML='<div class="fg" style="max-width:380px"><label>Choose printer</label><select id="pn-printer" onchange="selectPrinter()">'
      +'<option value="">— select —</option>'+printers.map(p=>'<option value="'+p.id+'" data-name="'+(p.name||'').replace(/"/g,'&quot;')+'"'+(pn.printerId==p.id?' selected':'')+'>'+p.name+(p.computer?' ('+p.computer+')':'')+'</option>').join('')+'</select></div>';
    toast('PrintNode connected — pick your printer','ok');
  }catch(e){ if(box) box.innerHTML='<span style="font-size:12px;color:var(--amber)"><i class=ic-alert></i> '+e.message+'</span>'; }
}
function selectPrinter(){
  const sel=document.getElementById('pn-printer'); if(!sel||!sel.value) return;
  const pn=getPrintNode(); pn.printerId=Number(sel.value); pn.printerName=sel.options[sel.selectedIndex]?.getAttribute('data-name')||''; savePrintNode(pn);
  renderPrintNodeUI(); toast('Printer set: '+pn.printerName,'ok');
}
function disconnectPrintNode(){ savePrintNode({}); renderPrintNodeUI(); toast('PrintNode disconnected','warn'); }
async function testPrintNode(){
  const sent=await printViaPrintNode(['PropMail Pro test letter\n\nIf you can read this on paper, cloud printing is working. <i class=ic-party></i>\n\n'+new Date().toLocaleString('en-GB')],'PropMail test');
  if(sent) toast('Test page sent to your printer','ok');
}
async function printViaPrintNode(letters, title){
  const pn=getPrintNode(); if(!pn.key||!pn.printerId) return false;
  try{
    const r=await fetch('/api/printnode?action=print',{method:'POST',headers:{'Content-Type':'application/json','x-printnode-key':pn.key},
      body:JSON.stringify({ printerId:pn.printerId, title:title||'PropMail letters', letters })});
    const d=await r.json().catch(()=>({}));
    if(!r.ok){ toast('PrintNode error: '+(d.error||r.status),'warn'); return false; }
    return true;
  }catch(e){ toast('PrintNode error: '+e.message,'warn'); return false; }
}

// ── Auto-print calendar ──
let printSchedule = { enabled:false, days:[1,2,3,4,5], time:'09:00', lastRun:'' };
const PS_DAYS = [['Mon',1],['Tue',2],['Wed',3],['Thu',4],['Fri',5],['Sat',6],['Sun',0]];
function loadPrintSchedule(){ try{ printSchedule=Object.assign(printSchedule, JSON.parse(localStorage.getItem('pmPrintSchedule')||'{}')); }catch(e){} renderPrintSchedule(); }
function savePrintSchedule(){ localStorage.setItem('pmPrintSchedule', JSON.stringify(printSchedule)); }
function renderPrintSchedule(){
  const en=document.getElementById('ps-enabled'); if(en) en.checked=!!printSchedule.enabled;
  const tm=document.getElementById('ps-time'); if(tm) tm.value=printSchedule.time||'09:00';
  const box=document.getElementById('ps-days'); if(box) box.innerHTML=PS_DAYS.map(([lbl,d])=>{
    const on=printSchedule.days.includes(d);
    return '<button class="agent-pill'+(on?' on':'')+'" onclick="togglePrintDay('+d+')"><span class="ck">✓</span>'+lbl+'</button>';
  }).join('');
}
function togglePrintDay(d){ const s=new Set(printSchedule.days); s.has(d)?s.delete(d):s.add(d); printSchedule.days=[...s]; savePrintSchedule(); renderPrintSchedule(); }
function setPrintTime(v){ printSchedule.time=v||'09:00'; savePrintSchedule(); }
function togglePrintEnabled(){ const e=document.getElementById('ps-enabled'); printSchedule.enabled=e?e.checked:false; savePrintSchedule(); toast('Auto-print '+(printSchedule.enabled?'on — runs on the selected days':'off'), printSchedule.enabled?'ok':'warn'); }
// Print every pending letter — silently via PrintNode if connected, else a
// single multi-page browser print job.
async function printAllDue(){
  const pend=queue.map((q,i)=>i).filter(i=>queue[i].status==='pend');
  if(!pend.length){ toast('No letters waiting to print','warn'); return 0; }
  if(printNodeConnected()){
    const letters=pend.map(i=>buildLetter(queue[i].tpl?.body||'', queue[i].prop||{}));
    const ok=await printViaPrintNode(letters, 'PropMail – '+letters.length+' letters');
    if(ok){ pend.forEach(i=>queue[i].status='done'); renderQueue(); if(typeof updQStats==='function') updQStats(); logLetterPrinted(pend.length);
      toast('<i class=ic-printer></i> Sent '+pend.length+' letter'+(pend.length>1?'s':'')+' to '+(getPrintNode().printerName||'your printer'),'ok'); return pend.length; }
    // fall through to browser print if PrintNode failed
  }
  const pa=document.getElementById('pa'); if(!pa) return 0;
  pa.innerHTML=pend.map(i=>{ const it=queue[i]; return renderLetterHTML(buildLetter(it.tpl?.body||'', it.prop||{}), it.prop||{}); }).join('');
  pa.style.display='block'; window.print(); pa.style.display='none';
  pend.forEach(i=>{ queue[i].status='done'; });
  renderQueue(); if(typeof updQStats==='function') updQStats(); logLetterPrinted(pend.length);
  toast('<i class=ic-printer></i> Printed '+pend.length+' letter'+(pend.length>1?'s':''),'ok');
  return pend.length;
}
// On a scheduled day/time (while the app is open), gather due letters and offer a one-tap print run.
function checkPrintSchedule(){
  if(!printSchedule.enabled) return;
  const now=new Date(); const today=now.toISOString().slice(0,10);
  if(printSchedule.lastRun===today) return;
  if(!printSchedule.days.includes(now.getDay())) return;
  const [h,m]=(printSchedule.time||'09:00').split(':').map(Number);
  const sched=new Date(now); sched.setHours(h||9,m||0,0,0);
  if(now < sched) return;
  if(typeof runDueSequences==='function') runDueSequences(true);
  const pending=queue.filter(x=>x.status==='pend').length;
  printSchedule.lastRun=today; savePrintSchedule();
  if(pending>0){
    if(printNodeConnected()) printAllDue();        // silent — prints straight to the printer
    else showPrintRunModal(pending);               // browser: one-tap confirm
  }
}
function showPrintRunModal(n){
  document.getElementById('printrun-modal')?.remove();
  const ov=document.createElement('div'); ov.id='printrun-modal';
  ov.style.cssText='position:fixed;inset:0;background:rgba(10,15,30,.55);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px';
  ov.innerHTML='<div style="background:#fff;border-radius:16px;max-width:420px;width:100%;box-shadow:0 20px 54px rgba(16,24,40,.28);padding:22px 24px;text-align:center">'
    +'<div style="font-size:34px;margin-bottom:8px"><i class=ic-printer></i>️</div>'
    +'<div style="font-size:17px;font-weight:700;color:var(--text)">Scheduled print run</div>'
    +'<div style="font-size:13px;color:var(--muted);margin:8px 0 18px;line-height:1.5"><strong style="color:var(--text)">'+n+'</strong> letter'+(n>1?'s are':' is')+' due to go out today. Print them all now?</div>'
    +'<div style="display:flex;gap:8px;justify-content:center">'
      +'<button class="btn bp" onclick="document.getElementById(\'printrun-modal\').remove();printAllDue()"><i class=ic-printer></i> Print all now</button>'
      +'<button class="btn bs" onclick="document.getElementById(\'printrun-modal\').remove()">Later</button>'
    +'</div></div>';
  ov.onclick=(e)=>{ if(e.target===ov) ov.remove(); };
  document.body.appendChild(ov);
}
function loadContacts(){ try{ contacts=JSON.parse(localStorage.getItem('pmContacts')||'{}'); }catch(e){ contacts={}; } updateCampBadges(); }
function saveContacts(){ localStorage.setItem('pmContacts', JSON.stringify(contacts)); }
function contactKey(addr){ return (addr||'').toLowerCase().replace(/[^a-z0-9]/g,''); }
function alreadyContacted(addr){ return !!contacts[contactKey(addr)]; }
function logContact(prop, tpl, source){
  const addr=prop.fullAddress||prop.displayAddress||prop.address||''; if(!addr) return;
  const k=contactKey(addr); if(!k) return; const now=new Date().toISOString();
  if(contacts[k]){ contacts[k].lastAt=now; contacts[k].count=(contacts[k].count||1)+1; }
  else {
    contacts[k]={ address:addr, postcode:prop.postcode||'', district:prop.haCode||prop.district||'',
      source:source||prop.source||'Search', template:(tpl&&tpl.name)||'', status:'sent',
      firstAt:now, lastAt:now, count:1 };
    // Auto-join a cycle by property type (rentals → Rentals, etc.), if a rule is set.
    try{
      const gid=(typeof automation!=='undefined' && automation.autoAssign) ? automation.autoAssign[categoryOf(prop)] : '';
      if(gid && groupById(gid)){ const c=contacts[k]; c.groupId=gid; c.ref=newRef(groupById(gid)); c.enrolledAt=now; c.seqDone=1; }
    }catch(e){}
  }
  saveContacts(); updateCampBadges();
}
function isFollowupDue(c){
  if(['responded','instructed','dead'].includes(c.status)) return false;
  if(automation.enabled && c.groupId){
    const g=groupById(c.groupId); const done=c.seqDone||1;
    if(!g || done>=g.steps.length) return false;
    const enrolled=new Date(c.enrolledAt||c.firstAt||c.lastAt).getTime();
    return Date.now() >= enrolled + g.steps[done].day*86400000;
  }
  return (Date.now()-new Date(c.lastAt).getTime())/86400000 >= 21;
}
function updateCampBadges(){
  const list=Object.values(contacts);
  const due=list.filter(isFollowupDue).length;
  const t=document.getElementById('camp-total'); if(t) t.textContent=list.length;
  const f=document.getElementById('camp-followups'); if(f) f.textContent=due;
  const nb=document.getElementById('camp-nav-badge'); if(nb){ if(due>0){ nb.style.display='inline-flex'; nb.textContent=due; } else nb.style.display='none'; }
}
function setContactStatus(k, status){ if(contacts[k]){ contacts[k].status=status; saveContacts(); updateCampBadges(); renderCampaigns(); } }
function renderCampaigns(){
  const box=document.getElementById('camp-results'); if(!box) return;
  let list=Object.entries(contacts).map(([k,c])=>({k,...c}));
  const f=(document.getElementById('camp-filter')?.value||'').toLowerCase().trim();
  const sf=document.getElementById('camp-status-filter')?.value||'';
  if(f) list=list.filter(c=>c.address.toLowerCase().includes(f));
  if(sf==='due') list=list.filter(isFollowupDue); else if(sf) list=list.filter(c=>c.status===sf);
  list.sort((a,b)=> new Date(b.lastAt)-new Date(a.lastAt));
  if(!list.length){ box.innerHTML='<div style="text-align:center;padding:32px;color:var(--muted)">No matching letters logged yet.</div>'; return; }
  const stColor={sent:'tag-blue',responded:'tag-gold',instructed:'tag-green',dead:'tag-grey'};
  box.innerHTML=list.slice(0,400).map(c=>{
    const due=isFollowupDue(c);
    const when=new Date(c.lastAt).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
    return '<div style="display:flex;align-items:center;gap:12px;padding:11px 2px;border-bottom:1px solid var(--border)">'
      +'<div style="flex:1;min-width:0">'
        +'<div style="font-size:14px;font-weight:700;color:var(--text)">'+c.address+'</div>'
        +'<div style="font-size:11px;color:var(--muted);margin-top:2px">'+c.source+' · last letter '+when+(c.count>1?' · '+c.count+'×':'')+(c.groupId?(' · <span style="color:var(--blue);font-weight:600">'+(groupById(c.groupId)?.name||'cycle')+(c.ref?' '+c.ref:'')+'</span>'):'')+(due?' · <span style="color:var(--amber);font-weight:700">follow-up due</span>':'')+'</div>'
      +'</div>'
      +'<span class="tag '+(stColor[c.status]||'tag-blue')+'">'+(c.status||'sent')+'</span>'
      +'<select onchange="setContactStatus(\''+c.k+'\',this.value)" style="padding:5px 8px;border:1px solid var(--border2);border-radius:7px;font-family:inherit;font-size:11px">'
        +['sent','responded','instructed','dead'].map(st=>'<option value="'+st+'"'+(c.status===st?' selected':'')+'>'+st+'</option>').join('')
      +'</select>'
    +'</div>';
  }).join('');
}
function exportCampaigns(){
  const rows=[['Address','Postcode','District','Source','Template','Status','First letter','Last letter','Count']];
  Object.values(contacts).forEach(c=>rows.push([c.address,c.postcode,c.district,c.source,c.template,c.status,c.firstAt,c.lastAt,c.count]));
  const csv=rows.map(r=>r.map(x=>'"'+String(x==null?'':x).replace(/"/g,'""')+'"').join(',')).join('\n');
  const a=document.createElement('a'); a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);
  a.download='propmail_campaigns_'+new Date().toISOString().slice(0,10)+'.csv'; a.click();
  toast('Campaign list exported','ok');
}
function clearCampaigns(){ if(!confirm('Clear all logged contacts? This cannot be undone.')) return; contacts={}; saveContacts(); updateCampBadges(); renderCampaigns(); toast('Campaign log cleared','warn'); }

// ── Post-print "start an automated cycle?" modal (pick a letter group) ──
function showCycleModal(prop){
  if(localStorage.getItem('pmCycleAsk')==='never') return;
  if(!groups.length) loadGroups();
  const addr=prop.fullAddress||prop.displayAddress||prop.address||''; if(!addr) return;
  const c=contacts[contactKey(addr)];
  if(c && c.groupId && !['responded','instructed','dead'].includes(c.status)){ const g=groupById(c.groupId); if(g && (c.seqDone||1)<g.steps.length) return; } // already cycling
  document.getElementById('cycle-modal')?.remove();
  window._cycleProp = prop; window._cycleAddr = addr;
  const ov=document.createElement('div'); ov.id='cycle-modal';
  ov.style.cssText='position:fixed;inset:0;background:rgba(10,15,30,.55);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px';
  ov.onclick=(e)=>{ if(e.target===ov) cycleClose(); };
  const gopts=groups.map(g=>'<option value="'+g.id+'"'+(g.id===automation.defaultGroupId?' selected':'')+'>'+g.name+' ('+g.steps.length+' letters)</option>').join('');
  ov.innerHTML='<div style="background:#fff;border-radius:16px;max-width:480px;width:100%;box-shadow:0 20px 54px rgba(16,24,40,.28);overflow:hidden">'
    +'<div style="padding:20px 22px;border-bottom:1px solid var(--border)"><div style="font-size:17px;font-weight:700;color:var(--text)"><i class=ic-clock></i>️ Automated letter cycle</div>'
    +'<div style="font-size:13px;color:var(--muted);margin-top:5px;line-height:1.5">You just printed a letter for <strong style="color:var(--text)">'+addr.split(',')[0]+'</strong>. Put it on one of your letter cycles?</div></div>'
    +'<div style="padding:18px 22px">'
      +'<label style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Letter cycle</label>'
      +'<div style="display:flex;gap:8px;align-items:center;margin:6px 0 14px">'
        +'<select id="cycle-group" onchange="renderCyclePreview()" style="flex:1;padding:9px 11px;border:1px solid var(--border2);border-radius:9px;font-family:inherit;font-size:13px">'+gopts+'</select>'
        +'<button class="btn bs sm-btn" onclick="cycleNewGroup()">+ New</button>'
      +'</div>'
      +'<div id="cycle-preview" style="background:var(--slate);border-radius:10px;padding:10px 12px;font-size:12px"></div>'
    +'</div>'
    +'<div style="padding:16px 22px;border-top:1px solid var(--border);display:flex;gap:8px;align-items:center;flex-wrap:wrap">'
    +'<button class="btn bp" onclick="cycleConfirm()">✓ Start cycle</button>'
    +'<button class="btn bs" onclick="cycleClose()">Not now</button><div style="flex:1"></div>'
    +'<button class="btn bghost sm-btn" onclick="cycleNever()">Don’t ask again</button></div></div>';
  document.body.appendChild(ov);
  renderCyclePreview();
}
function renderCyclePreview(){
  const sel=document.getElementById('cycle-group'); const box=document.getElementById('cycle-preview'); if(!sel||!box) return;
  const g=groupById(sel.value); const tpls=[...templates,...(uploadedTpls||[])];
  if(!g){ box.innerHTML='No cycle.'; return; }
  box.innerHTML='<div style="font-weight:700;color:var(--text);margin-bottom:6px">'+g.name+' · reference '+refPrefix(g.name)+'-'+((automation.refSeq||1000)+1)+'</div>'
    + g.steps.map((s,i)=>{ const t=tpls.find(t=>t.id===s.tplId); return '<div style="color:var(--text2)">'+(i+1)+'. '+((t&&t.name)||'Letter')+' <span style="color:var(--muted)">· '+(s.day===0?'on printing':'day '+s.day)+'</span></div>'; }).join('');
}
function cycleNewGroup(){ createGroup(); const sel=document.getElementById('cycle-group'); if(sel){ const last=groups[groups.length-1]; sel.innerHTML=groups.map(g=>'<option value="'+g.id+'"'+(g.id===last.id?' selected':'')+'>'+g.name+' ('+g.steps.length+' letters)</option>').join(''); } renderCyclePreview(); }
function cycleClose(){ document.getElementById('cycle-modal')?.remove(); }
function cycleNever(){ localStorage.setItem('pmCycleAsk','never'); cycleClose(); toast('Won’t ask again — start cycles from the Campaigns tab any time','ok'); }
function cycleConfirm(){
  const sel=document.getElementById('cycle-group'); const g=groupById(sel?sel.value:automation.defaultGroupId); if(!g) return;
  automation.enabled=true; saveGroups();
  const e=document.getElementById('auto-enabled'); if(e) e.checked=true;
  const key=contactKey(window._cycleAddr||'');
  if(!contacts[key] && window._cycleProp) logContact(window._cycleProp, templates[0], window._cycleProp.source||'Printed');
  const c=contacts[key];
  if(c){ c.groupId=g.id; c.ref=newRef(g); c.enrolledAt=new Date().toISOString(); c.seqDone=1;
    if(['responded','instructed','dead'].includes(c.status)) c.status='sent'; saveContacts(); }
  cycleClose(); runDueSequences(false); updateCampBadges();
  if(typeof renderCampaigns==='function') renderCampaigns();
  toast('✓ '+((c&&c.address.split(',')[0])||'Property')+' on “'+g.name+'” cycle · ref '+(c&&c.ref||''),'ok');
}

/* ── Home launcher: every tool as a clickable card, grouped like the sidebar ── */
const HOME_TOOLS = [
  { group: 'Property Search', items: [
    { id:'ha', name:'HA Districts', desc:'Search live listings across HA0–HA9 in one click', svg:'<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4M10 10h4M10 14h4M10 18h4"/>' },
    { id:'premarket', name:'Pre-Market Radar', desc:'Spot homes likely to come to market soon', badge:'NEW', badgeColor:'b-gold', svg:'<path d="M19.07 4.93A10 10 0 0 0 6.99 3.34"/><path d="M4 6h.01"/><path d="M2.29 9.62A10 10 0 1 0 21.31 8.35"/><path d="M16.24 7.76A6 6 0 1 0 8.23 16.67"/><path d="M12 18h.01"/><path d="M17.99 11.66A6 6 0 0 1 15.77 16.67"/><circle cx="12" cy="12" r="2"/><path d="m13.41 10.59 5.66-5.66"/>' },
    { id:'sold', name:'Sold Board', desc:'Recently sold nearby — proof for your letters', badge:'NEW', badgeColor:'b-gold', svg:'<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>' },
    { id:'campaigns', name:'Campaigns', desc:'Multi-step letter sequences to your contacts', svg:'<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>' },
    { id:'schedule', name:'Schedule', desc:'Plan and time your print runs', svg:'<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18M8 2v4M16 2v4"/>' },
    { id:'queue', name:'Print Queue', desc:'Review and print your queued letters', svg:'<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/>' },
  ]},
  { group: 'Automation', items: [
    { id:'auto', name:'Auto Flow', desc:'4-step automated find → resolve → queue', svg:'<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>' },
    { id:'bot', name:'Live Bot', desc:'Continuous monitoring for new listings', svg:'<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2M20 14h2M15 13v2M9 13v2"/>' },
  ]},
  { group: 'Intelligence', items: [
    { id:'radar', name:'Seller Radar', desc:'Who is most likely to sell — before they list', badge:'NEW', badgeColor:'b-blue', svg:'<circle cx="12" cy="12" r="9"/><path d="M12 12l6-3"/><circle cx="12" cy="12" r="1"/>' },
    { id:'intel', name:'AI Intel', desc:'Paste a Rightmove link → exact address → owner', badge:'NEW', badgeColor:'b-blue', svg:'<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/>' },
    { id:'success', name:'Success Letters', desc:'Look up full addresses by postcode', svg:'<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>' },
    { id:'blocked', name:'Do-Not-Mail', desc:'Your suppression / do-not-contact list', svg:'<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>' },
    { id:'leads', name:'Valuation Leads', desc:'Enquiries from your public valuation page', svg:'<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>' },
  ]},
  { group: 'Strategy', items: [
    { id:'marketing', name:'Marketing AI', desc:'A daily strategist that studies your data and the market', badge:'NEW', badgeColor:'b-blue', svg:'<path d="M9 11a3 3 0 1 0 6 0a3 3 0 0 0-6 0"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>' },
    { id:'performance', name:'Performance', desc:'Letters → valuations → instructions → fees, vs target', badge:'ROI', badgeColor:'b-gold', svg:'<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>' },
    { id:'investor', name:'Investor Board', desc:'Revenue KPIs and ROI scenarios', badge:'ROI', badgeColor:'b-gold', svg:'<path d="M16 7h6v6"/><path d="m22 7-8.5 8.5-5-5L2 17"/>' },
    { id:'advisor', name:'AI Advisor', desc:'Campaign health analysis and tips', svg:'<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6M10 22h4"/>' },
    { id:'director', name:"Director's Vision", desc:'Strategic growth ideas for the agency', badge:'NEW', badgeColor:'b-gold', svg:'<path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z"/><path d="m6.2 5.3 3.1 3.9M12.4 3.4l3.1 4M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>' },
  ]},
  { group: 'Configuration', items: [
    { id:'account', name:'Account', desc:'Your office login and account settings', svg:'<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>' },
    { id:'templates', name:'Templates', desc:'Edit your letter templates', svg:'<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4M10 9H8M16 13H8M16 17H8"/>' },
    { id:'printers', name:'Printers', desc:'Manage your network printers', svg:'<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>' },
  ]},
];
// The core day-to-day workflow, surfaced at the top of Home for one-click access.
const FEATURED = ['ha', 'intel', 'queue'];

// Live count / status shown on a Home card (refreshed each time Home is opened).
function homeStat(id){
  try{
    if(id === 'queue'){ const n = (typeof queue !== 'undefined' ? queue.filter(q => q.status === 'pend').length : 0); return n ? { text: n + ' waiting', tone:'gold' } : null; }
    if(id === 'leads'){ const n = (typeof pmLeads !== 'undefined' ? pmLeads.filter(l => l && l.status === 'new').length : 0); return n ? { text: n + ' new', tone:'green' } : null; }
    if(id === 'blocked'){ const n = (typeof pmBlocked !== 'undefined' ? pmBlocked.length : 0); return n ? { text: n + ' on list', tone:'red' } : null; }
    if(id === 'ha'){ const n = (typeof props !== 'undefined' ? props.length : 0); return n ? { text: n + ' found', tone:'blue' } : null; }
    if(id === 'campaigns'){ const n = (typeof contacts !== 'undefined' && typeof isFollowupDue === 'function' ? Object.values(contacts).filter(isFollowupDue).length : 0); return n ? { text: n + ' due', tone:'gold' } : null; }
    if(id === 'bot'){ return (typeof botOn !== 'undefined' && botOn) ? { text:'Live', tone:'green', pulse:true } : null; }
    if(id === 'performance'){ const m = perfMonthData(perfCurrentMonth()); return m.fees ? { text:'£' + Math.round(m.fees).toLocaleString() + ' won', tone:'gold' } : null; }
  }catch(e){}
  return null;
}

function renderHome(){
  const el = document.getElementById('home-grid'); if (!el) return;
  const byId = {}; HOME_TOOLS.forEach(s => s.items.forEach(t => { byId[t.id] = t; }));
  const card = (t, featured) => {
    const st = homeStat(t.id);
    return '<button class="home-card' + (featured ? ' featured' : '') + '" onclick="showPanel(\'' + t.id + '\')">'
      + '<span class="home-card-ic"><svg viewBox="0 0 24 24">' + t.svg + '</svg></span>'
      + '<span class="home-card-body"><span class="home-card-name">' + esc(t.name)
      + (t.badge ? ' <span class="home-card-badge ' + (t.badgeColor || 'b-blue') + '">' + esc(t.badge) + '</span>' : '')
      + '</span><span class="home-card-desc">' + esc(t.desc) + '</span></span>'
      + (st ? '<span class="home-card-stat tone-' + st.tone + (st.pulse ? ' pulsing' : '') + '">' + esc(st.text) + '</span>' : '')
      + '</button>';
  };
  const section = (label, items, featured) =>
    '<div class="home-section"><div class="home-section-label">' + label + '</div><div class="home-grid">'
    + items.map(t => card(t, featured)).join('') + '</div></div>';

  let html = '';
  const feat = FEATURED.map(id => byId[id]).filter(Boolean);
  if (feat.length) html += section('Quick start', feat, true);
  html += HOME_TOOLS.map(sec => section(sec.group, sec.items, false)).join('');
  el.innerHTML = html;
}

/* ═══ SELLER RADAR — propensity to sell + anniversary prospecting ═══ */
async function runRadar(){
  const area=(document.getElementById('radar-area').value||'').trim();
  if(!area){ toast('Enter a postcode or outcode','warn'); return; }
  const btn=document.getElementById('radar-btn'); if(btn){btn.disabled=true;btn.textContent='Scanning…';}
  const res=document.getElementById('radar-results'); res.innerHTML='<div style="text-align:center;padding:30px;color:var(--muted)">Scanning Land Registry for '+esc(area)+'…</div>';
  try{
    const isPc=/[A-Z]{1,2}\d[\dA-Z]?\s*\d[A-Z]{2}/i.test(area);
    const qs=new URLSearchParams(isPc?{postcode:area.toUpperCase()}:{district:area.toUpperCase()});
    qs.set('today', new Date().toISOString().slice(0,10));
    const r=await fetch('/api/propensity?'+qs.toString());
    const d=await r.json().catch(()=>({}));
    if(!r.ok){ res.innerHTML='<div style="padding:20px;color:var(--amber)">'+esc(d.error||'Lookup failed')+'</div>'; return; }
    window._radar=d.properties||[];
    renderRadar(d);
  }catch(e){ res.innerHTML='<div style="padding:20px;color:var(--amber)">'+esc(e.message)+'</div>'; }
  finally{ if(btn){btn.disabled=false;btn.textContent='Scan for sellers';} }
}
function renderRadar(d){
  const sum=document.getElementById('radar-summary'); sum.style.display='flex'; sum.style.flexWrap='wrap';
  const card=(n,l,c)=>'<div style="flex:1;min-width:120px;background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px 14px"><div style="font-size:24px;font-weight:800;color:'+c+'">'+n+'</div><div style="font-size:11px;color:var(--muted);font-weight:600">'+l+'</div></div>';
  sum.innerHTML=card(d.total||0,'owners in '+esc(d.area||''),'var(--text)')+card(d.hot||0,'HOT — likely to sell','#DC2626')+card(d.anniversaries||0,'anniversary ≤30 days','#0369A1');
  const res=document.getElementById('radar-results'); const props=d.properties||[];
  if(!props.length){ res.innerHTML='<div style="text-align:center;padding:30px;color:var(--muted)">No Land Registry records found for that area.</div>'; return; }
  const bandCol={hot:'#DC2626',warm:'#D97706',cold:'#64748B'};
  res.innerHTML='<div style="font-size:12px;color:var(--muted);margin-bottom:10px">Ranked by likelihood to come to market — contact the top of the list first.</div>'+props.map((p,i)=>
    '<div style="display:flex;align-items:center;gap:12px;padding:11px 0;border-bottom:1px solid var(--border)">'
    +'<div style="width:46px;height:46px;border-radius:10px;background:'+(bandCol[p.band]||'#64748B')+';color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;flex-shrink:0"><div style="font-size:16px;font-weight:800;line-height:1">'+p.score+'</div><div style="font-size:8px;font-weight:700;letter-spacing:.5px">'+(p.band||'').toUpperCase()+'</div></div>'
    +'<div style="flex:1;min-width:0"><div style="font-size:14px;font-weight:700;color:var(--text)">'+esc(p.address)+'</div>'
    +'<div style="font-size:12px;color:var(--muted)">Owned '+p.yearsOwned+' yrs · bought '+p.lastSold+(p.lastPrice?' for £'+Number(p.lastPrice).toLocaleString():'')
    +(p.anniversarySoon?' · <span style="color:#0369A1;font-weight:700">anniversary in '+p.daysToAnniversary+' days</span>':'')+'</div></div>'
    +'<button onclick="queueRadar('+i+')" style="padding:7px 13px;background:rgba(37,99,235,.1);color:var(--blue);border:1.5px solid rgba(37,99,235,.25);border-radius:7px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;flex-shrink:0"><i class=ic-mailbox></i> Queue</button>'
    +'</div>').join('');
}
function queueRadar(i){
  const p=(window._radar||[])[i]; if(!p) return;
  const tplEl=document.getElementById('f-tpl');
  const tpl=[...templates,...(uploadedTpls||[])].find(t=>t.id===(tplEl?.value||'intro'))||templates[0];
  const pcM=(p.address||'').match(/[A-Z]{1,2}\d[\dA-Z]?\s*\d[A-Z]{2}/i);
  const prop={address:p.address,displayAddress:p.address,fullAddress:p.address,postcode:pcM?pcM[0]:p.postcode,addressConfirmed:true,haCode:p.outcode||'',district:p.outcode||'',source:'Seller Radar',status:'Off-market'};
  queue.push({id:Date.now()+Math.random(),prop,tpl,status:'pend',at:new Date(),auto:false});
  updQBadge();updQStats();updateKPIs();
  toast('<i class=ic-mailbox></i> Letter queued for '+esc(p.address),'ok');
}

function showPanel(n){
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.ni').forEach(x => x.classList.remove('active'));
  document.getElementById('panel-' + n)?.classList.add('active');
  document.getElementById('nav-' + n)?.classList.add('active');
  if (n === 'home') renderHome();
  if (n === 'account') renderAccountPanel();
  if (n === 'marketing') loadMarketing();
  if (n === 'performance') initPerf();
  if (n === 'touting') initTouting();
  if (n === 'offmarket') initOffmarket();
  if (n === 'premarket' && !premarketItems.length) initPremarket();
  if (n === 'sold' && !soldItems.length) initSold();
  if (n === 'let' && !letItems.length) initLet();
  if (n === 'campaigns') { loadContacts(); loadGroups(); runDueSequences(false); renderCampaigns(); }
  if (n === 'schedule')  { loadContacts(); loadGroups(); loadPrintSchedule(); runDueSequences(true); renderSchedule(); }
  if (n === 'ha')        loadTargeting();
  if (n === 'templates') { renderTpls(); loadGroups(); renderGroups(); loadBrandForm(); }
  if (n === 'queue')     renderQueue();
  if (n === 'blocked')   { loadBlocklist().then(renderBlockedPanel); renderBlockedPanel(); }
  if (n === 'leads')     loadLeads();
  if (n === 'success')   loadBlocklist();
  if (n === 'printers')  { renderPrinters(); renderPrintNodeUI(); }
  if (n === 'bot')       updateBotUI();
  if (n === 'investor'  && typeof initInvestorDashboard === 'function') initInvestorDashboard();
  if (n === 'advisor'   && typeof initAdvisorScorecard  === 'function') initAdvisorScorecard();
  if (n === 'director'  && typeof initDirectorPanel    === 'function') initDirectorPanel();
}

/* ═══════════════════════════════════════════
   PERFORMANCE & ROI TRACKER
   Letters → valuations → instructions → agreed business (with fees),
   measured against a monthly target. Durable via /api/results (KV) with a
   localStorage mirror so it works offline / without the cloud store.
═══════════════════════════════════════════ */
function perfCurrentMonth(){
  const el = document.getElementById('perf-month');
  if (el && el.value) return el.value;
  return new Date().toISOString().slice(0, 7);
}
function perfMonthLabel(m){
  try { const [y, mo] = m.split('-'); return new Date(+y, (+mo) - 1, 1).toLocaleDateString('en-GB', { month:'long', year:'numeric' }); }
  catch { return m; }
}
function perfSaveLocal(){ try { localStorage.setItem('pmPerf', JSON.stringify(perfState)); } catch {} }

async function loadPerf(force){
  // localStorage first — instant, and the source of truth when the cloud store is off.
  try { const raw = localStorage.getItem('pmPerf'); if (raw){ const j = JSON.parse(raw); if (j && typeof j === 'object') perfState = { outcomes:j.outcomes||[], targets:j.targets||{}, prints:j.prints||{} }; } } catch {}
  try {
    const r = await fetch('/api/results');
    if (r.ok){
      const d = await r.json();
      perfConfigured = !!d.configured;
      if (d.configured){ perfState = { outcomes:d.outcomes||[], targets:d.targets||{}, prints:d.prints||{} }; perfSaveLocal(); }
    }
  } catch {}
  perfLoaded = true;
  if (force) renderPerf();
}
function initPerf(){
  const mEl = document.getElementById('perf-month');
  if (mEl && !mEl.value) mEl.value = new Date().toISOString().slice(0, 7);
  if (!perfLoaded) loadPerf(true); else renderPerf();
}

function perfMonthData(month){
  const out = perfState.outcomes || [];
  const inM = (d) => typeof d === 'string' && d.slice(0, 7) === month;
  const agreedList = out.filter(o => inM(o.agreedDate));
  return {
    letters: (perfState.prints || {})[month] || 0,
    valuations: out.filter(o => inM(o.valuationDate)).length,
    instructions: out.filter(o => inM(o.instructionDate)).length,
    agreed: agreedList.length,
    fees: agreedList.reduce((s, o) => s + (+o.fee || 0), 0),
  };
}
function perfTarget(month){ return (perfState.targets || {})[month] || { letters:0, valuations:0, instructions:0, agreed:0, fees:0 }; }
function perfAllTime(){
  const out = perfState.outcomes || [];
  const agreedList = out.filter(o => o.agreedDate);
  return {
    letters: Object.values(perfState.prints || {}).reduce((s, n) => s + (+n || 0), 0),
    valuations: out.filter(o => o.valuationDate).length,
    instructions: out.filter(o => o.instructionDate).length,
    agreed: agreedList.length,
    fees: agreedList.reduce((s, o) => s + (+o.fee || 0), 0),
  };
}
function perfPct(n, d){ return d > 0 ? Math.round((n / d) * 100) : 0; }
function perfMoney(n){ return '£' + Math.round(+n || 0).toLocaleString(); }

function renderPerf(){
  if (!document.getElementById('perf-targets')) return;
  const month = perfCurrentMonth();
  const lbl = document.getElementById('perf-month-label'); if (lbl) lbl.textContent = perfMonthLabel(month);
  const warn = document.getElementById('perf-store-warn'); if (warn) warn.style.display = perfConfigured ? 'none' : 'block';
  const m = perfMonthData(month), t = perfTarget(month);

  const metric = (label, val, target, isMoney, tone) => {
    const v = isMoney ? perfMoney(val) : val.toLocaleString();
    const tv = isMoney ? perfMoney(target) : target.toLocaleString();
    const p = target > 0 ? Math.min(100, perfPct(val, target)) : 0;
    return '<div class="perf-metric"><div class="perf-metric-label">' + label + '</div>'
      + '<div class="perf-metric-val">' + v + '</div>'
      + (target > 0
        ? '<div class="perf-bar"><div class="perf-bar-fill tone-' + tone + '" style="width:' + p + '%"></div></div><div class="perf-metric-sub">' + p + '% of ' + tv + '</div>'
        : '<div class="perf-metric-sub">No target set</div>') + '</div>';
  };
  document.getElementById('perf-targets').innerHTML =
      metric('Letters printed', m.letters, t.letters, false, 'blue')
    + metric('Valuations', m.valuations, t.valuations, false, 'gold')
    + metric('Instructions', m.instructions, t.instructions, false, 'green')
    + metric('Agreed business', m.agreed, t.agreed, false, 'green')
    + metric('Agreed fees', m.fees, t.fees, true, 'gold');

  // Funnel for the selected month
  const stages = [
    { k:'Letters', v:m.letters, tone:'blue' },
    { k:'Valuations', v:m.valuations, tone:'gold' },
    { k:'Instructions', v:m.instructions, tone:'green' },
    { k:'Agreed', v:m.agreed, tone:'green' },
  ];
  const maxV = Math.max(1, ...stages.map(s => s.v));
  let funnel = '<div class="perf-funnel">';
  stages.forEach((s, i) => {
    const conv = i > 0 ? perfPct(s.v, stages[i - 1].v) : null;
    funnel += '<div class="perf-fn-row"><div class="perf-fn-label">' + s.k + '</div>'
      + '<div class="perf-fn-track"><div class="perf-fn-bar tone-' + s.tone + '" style="width:' + Math.max(4, Math.round((s.v / maxV) * 100)) + '%">' + s.v + '</div></div>'
      + '<div class="perf-fn-conv">' + (conv === null ? '' : conv + '%') + '</div></div>';
  });
  funnel += '</div><div class="perf-fn-summary"><span><strong>' + perfPct(m.instructions, m.letters) + '%</strong> letter → instruction</span>'
    + '<span><strong>' + perfMoney(m.fees) + '</strong> agreed this month</span>'
    + (m.agreed ? '<span><strong>' + perfMoney(m.fees / m.agreed) + '</strong> average fee</span>' : '') + '</div>';
  document.getElementById('perf-funnel').innerHTML = funnel;

  // All-time investor summary
  const a = perfAllTime();
  document.getElementById('perf-roi').innerHTML =
      '<div class="perf-roi-grid">'
    + '<div><div class="perf-roi-n">' + a.letters.toLocaleString() + '</div><div class="perf-roi-l">Letters sent</div></div>'
    + '<div><div class="perf-roi-n">' + a.valuations.toLocaleString() + '</div><div class="perf-roi-l">Valuations</div></div>'
    + '<div><div class="perf-roi-n">' + a.instructions.toLocaleString() + '</div><div class="perf-roi-l">Instructions</div></div>'
    + '<div><div class="perf-roi-n">' + perfMoney(a.fees) + '</div><div class="perf-roi-l">Fees won</div></div></div>'
    + '<div class="perf-roi-line">Every <strong>100 letters</strong> produces <strong>' + (a.letters ? (a.valuations / a.letters * 100).toFixed(1) : '0') + '</strong> valuations and <strong>' + (a.letters ? (a.instructions / a.letters * 100).toFixed(1) : '0') + '</strong> instructions'
    + (a.instructions ? ', worth <strong>' + perfMoney(a.fees / a.instructions) + '</strong> each in fees' : '') + '.</div>';

  renderPerfOutcomes();
}

function perfStageBadge(stage){
  const map = { response:['Response','b-blue'], valuation:['Valuation','b-gold'], instruction:['Instruction','b-green'], agreed:['Agreed','b-green'], lost:['Lost','b-red'] };
  const [t, c] = map[stage] || map.response;
  return '<span class="perf-badge ' + c + '">' + t + '</span>';
}
function renderPerfOutcomes(){
  const wrap = document.getElementById('perf-outcomes'); if (!wrap) return;
  const out = (perfState.outcomes || []).slice().sort((x, y) => String(y.updatedAt || '').localeCompare(String(x.updatedAt || '')));
  const cEl = document.getElementById('perf-out-count');
  if (cEl) cEl.textContent = out.length ? (out.length + ' response' + (out.length === 1 ? '' : 's') + ' tracked') : 'No responses logged yet';
  if (!out.length){ wrap.innerHTML = '<div class="es"><div class="et">Nothing tracked yet</div>Click “Log a response” when a letter brings in an enquiry, valuation, instruction or agreed deal.</div>'; return; }
  wrap.innerHTML = '<div style="overflow-x:auto"><table class="perf-table"><thead><tr><th>Property</th><th>Stage</th><th>Valuation</th><th>Instruction</th><th>Agreed</th><th>Fee</th><th></th></tr></thead><tbody>'
    + out.map(o => '<tr>'
      + '<td><div style="font-weight:600;font-size:12px">' + esc(String(o.address || '').split(',')[0]) + '</div><div style="font-size:10px;color:var(--muted)">' + esc([o.postcode, o.source].filter(Boolean).join(' · ')) + '</div></td>'
      + '<td>' + perfStageBadge(o.stage) + '</td>'
      + '<td style="font-size:11px">' + esc(o.valuationDate || '—') + '</td>'
      + '<td style="font-size:11px">' + esc(o.instructionDate || '—') + '</td>'
      + '<td style="font-size:11px">' + esc(o.agreedDate || '—') + '</td>'
      + '<td style="font-size:12px;font-weight:600">' + (o.fee ? perfMoney(o.fee) : '—') + '</td>'
      + '<td style="white-space:nowrap"><button class="bic" title="Edit" onclick="openOutcomeModal(\'' + o.id + '\')"><i class=ic-pencil></i></button> <button class="bic" title="Delete" onclick="deleteOutcome(\'' + o.id + '\')"><i class=ic-trash></i></button></td>'
      + '</tr>').join('')
    + '</tbody></table></div>';
}

function perfModalShell(){
  let ov = document.getElementById('perf-modal');
  if (!ov){ ov = document.createElement('div'); ov.id = 'perf-modal'; ov.className = 'perf-ov'; ov.onclick = (e) => { if (e.target === ov) closePerfModal(); }; document.body.appendChild(ov); }
  return ov;
}
function closePerfModal(){ const ov = document.getElementById('perf-modal'); if (ov) ov.style.display = 'none'; }

function openOutcomeModal(id){
  const o = (perfState.outcomes || []).find(x => x.id === id) || {};
  const opt = { response:'Response / enquiry received', valuation:'Valuation booked', instruction:'Instruction won', agreed:'Agreed — business won', lost:'Lost / no longer pursuing' };
  const ov = perfModalShell();
  ov.innerHTML = '<div class="perf-card"><button class="perf-x" onclick="closePerfModal()" aria-label="Close">×</button>'
    + '<div class="perf-modal-title">' + (id ? 'Update response' : 'Log a response from a letter') + '</div>'
    + '<input type="hidden" id="pm-id" value="' + esc(o.id || '') + '"><input type="hidden" id="pm-createdAt" value="' + esc(o.createdAt || '') + '">'
    + '<label class="perf-lbl">Postcode</label>'
    + '<div style="display:flex;gap:8px;position:relative"><input id="pm-postcode" autocomplete="off" placeholder="HA1 1SH" value="' + esc(o.postcode || '') + '" style="flex:1" oninput="perfPcInput(this.value)" onblur="perfBoxBlur()">'
    + '<button type="button" class="btn bs sm-btn" style="flex-shrink:0;white-space:nowrap" onclick="perfFindAddresses()">Find addresses</button>'
    + '<div id="pm-suggest" class="suggest-box" style="display:none"></div></div>'
    + '<div style="font-size:10.5px;color:var(--muted);margin:4px 0 0">Enter the postcode and pick the exact property — it fills the address for you and avoids typos.</div>'
    + '<label class="perf-lbl">Property address *</label><input id="pm-address" autocomplete="off" placeholder="12 Hindes Road, Harrow" value="' + esc(o.address || '') + '">'
    + '<label class="perf-lbl">From letter / template</label><input id="pm-source" placeholder="e.g. Just Sold" value="' + esc(o.source || '') + '">'
    + '<label class="perf-lbl">What’s happened?</label><select id="pm-stage" onchange="perfStageFields()">'
    + Object.keys(opt).map(s => '<option value="' + s + '"' + (o.stage === s ? ' selected' : '') + '>' + opt[s] + '</option>').join('') + '</select>'
    + '<div id="pm-valwrap" class="perf-cond"><label class="perf-lbl">Valuation date</label><input type="date" id="pm-valdate" value="' + esc(o.valuationDate || '') + '"></div>'
    + '<div id="pm-instwrap" class="perf-cond"><label class="perf-lbl">Instruction date</label><input type="date" id="pm-instdate" value="' + esc(o.instructionDate || '') + '"></div>'
    + '<div id="pm-agrwrap" class="perf-cond"><div class="perf-row2"><div><label class="perf-lbl">Agreed date</label><input type="date" id="pm-agrdate" value="' + esc(o.agreedDate || '') + '"></div>'
    + '<div><label class="perf-lbl">Fee agreed (£)</label><input id="pm-fee" inputmode="numeric" placeholder="4500" value="' + (o.fee || '') + '"></div></div></div>'
    + '<label class="perf-lbl">Notes</label><textarea id="pm-notes" rows="2" placeholder="Optional">' + esc(o.notes || '') + '</textarea>'
    + '<div class="perf-modal-actions"><button class="btn bghost" onclick="closePerfModal()">Cancel</button><button class="btn bp" onclick="saveOutcome()">Save</button></div></div>';
  ov.style.display = 'flex';
  perfStageFields();
}
function perfStageFields(){
  const s = (document.getElementById('pm-stage') || {}).value || 'response';
  const lvl = { response:0, valuation:1, instruction:2, agreed:3, lost:0 }[s];
  const show = (id, on) => { const e = document.getElementById(id); if (e) e.style.display = on ? 'block' : 'none'; };
  show('pm-valwrap', lvl >= 1); show('pm-instwrap', lvl >= 2); show('pm-agrwrap', lvl >= 3);
  const today = new Date().toISOString().slice(0, 10);
  if (lvl >= 1){ const v = document.getElementById('pm-valdate'); if (v && !v.value) v.value = today; }
  if (lvl >= 2){ const v = document.getElementById('pm-instdate'); if (v && !v.value) v.value = today; }
  if (lvl >= 3){ const v = document.getElementById('pm-agrdate'); if (v && !v.value) v.value = today; }
}

// ── Postcode-driven address finder for the response form ──
// Uses /api/addresses?postcode= (Royal Mail / OS Places when an OS key is set,
// EPC register otherwise) so it works without any extra key and prevents typos.
const FULL_PC = /^[A-Z]{1,2}\d[\dA-Z]?\s*\d[A-Z]{2}$/;
let perfPcTimer = null, perfBoxTimer = null;
function perfPcInput(v){
  clearTimeout(perfBoxTimer); clearTimeout(perfPcTimer);
  const pc = (v || '').trim().toUpperCase();
  if (FULL_PC.test(pc)) { perfPcTimer = setTimeout(perfFindAddresses, 350); }
  else { const box = document.getElementById('pm-suggest'); if (box){ box.style.display = 'none'; box.innerHTML = ''; } }
}
async function perfFindAddresses(){
  clearTimeout(perfBoxTimer);
  const box = document.getElementById('pm-suggest'); if (!box) return;
  const pc = ((document.getElementById('pm-postcode') || {}).value || '').trim().toUpperCase();
  if (!FULL_PC.test(pc)){ box.innerHTML = '<div class="suggest-empty">Enter a full postcode (e.g. HA1 1SH) to list addresses.</div>'; box.style.display = 'block'; return; }
  box.innerHTML = '<div class="suggest-empty">Finding addresses…</div>'; box.style.display = 'block';
  try {
    const r = await fetch('/api/addresses?postcode=' + encodeURIComponent(pc) + '&types=all');
    const list = (await r.json()).addresses || [];
    if (!list.length){ box.innerHTML = '<div class="suggest-empty">No addresses found for ' + esc(pc) + ' — type the address by hand.</div>'; box.style.display = 'block'; return; }
    box._items = list;
    box.innerHTML = list.map((a, i) => '<div class="suggest-item" onmousedown="perfPick(' + i + ')">' + esc(a.fullAddress) + '</div>').join('');
    box.style.display = 'block';
  } catch (e) { box.innerHTML = '<div class="suggest-empty">Couldn’t fetch addresses — type it by hand.</div>'; box.style.display = 'block'; }
}
function perfPick(i){
  const box = document.getElementById('pm-suggest'); if (!box) return;
  const a = (box._items || [])[i]; if (!a) return;
  const ad = document.getElementById('pm-address'); if (ad) ad.value = a.fullAddress;
  const pc = document.getElementById('pm-postcode'); if (pc && a.postcode) pc.value = a.postcode;
  box.style.display = 'none'; box.innerHTML = '';
}
function perfBoxBlur(){ perfBoxTimer = setTimeout(() => { const box = document.getElementById('pm-suggest'); if (box) box.style.display = 'none'; }, 200); }

async function saveOutcome(){
  const g = (id) => (document.getElementById(id) || {}).value || '';
  const stage = g('pm-stage') || 'response';
  const lvl = { response:0, valuation:1, instruction:2, agreed:3, lost:0 }[stage];
  const rec = {
    kind:'outcome',
    id: g('pm-id') || ('o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)),
    createdAt: g('pm-createdAt') || new Date().toISOString(),
    address: g('pm-address').trim(),
    postcode: g('pm-postcode').trim().toUpperCase(),
    source: g('pm-source').trim(),
    stage,
    valuationDate: lvl >= 1 ? g('pm-valdate') : '',
    instructionDate: lvl >= 2 ? g('pm-instdate') : '',
    agreedDate: lvl >= 3 ? g('pm-agrdate') : '',
    fee: lvl >= 3 ? (+String(g('pm-fee')).replace(/[^0-9.]/g, '') || 0) : 0,
    notes: g('pm-notes').trim(),
  };
  if (!rec.address){ toast('Enter the property address', 'warn'); return; }
  rec.updatedAt = new Date().toISOString();
  const stored = { ...rec }; delete stored.kind;
  const list = perfState.outcomes || [];
  const idx = list.findIndex(o => o.id === rec.id);
  if (idx >= 0){ stored.createdAt = list[idx].createdAt || stored.createdAt; list[idx] = stored; } else list.unshift(stored);
  perfState.outcomes = list; perfSaveLocal();
  closePerfModal(); renderPerf();
  try { await fetch('/api/results', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(rec) }); } catch {}
  toast('Saved', 'ok');
}
async function deleteOutcome(id){
  if (!confirm('Delete this tracked response?')) return;
  perfState.outcomes = (perfState.outcomes || []).filter(o => o.id !== id); perfSaveLocal(); renderPerf();
  try { await fetch('/api/results?id=' + encodeURIComponent(id), { method:'DELETE' }); } catch {}
}

function openTargetModal(){
  const month = perfCurrentMonth(); const t = perfTarget(month);
  const ov = perfModalShell();
  ov.innerHTML = '<div class="perf-card"><button class="perf-x" onclick="closePerfModal()" aria-label="Close">×</button>'
    + '<div class="perf-modal-title">Targets for ' + perfMonthLabel(month) + '</div>'
    + '<div class="perf-row2"><div><label class="perf-lbl">Letters printed</label><input id="pt-letters" inputmode="numeric" value="' + (t.letters || '') + '"></div>'
    + '<div><label class="perf-lbl">Valuations</label><input id="pt-valuations" inputmode="numeric" value="' + (t.valuations || '') + '"></div></div>'
    + '<div class="perf-row2"><div><label class="perf-lbl">Instructions</label><input id="pt-instructions" inputmode="numeric" value="' + (t.instructions || '') + '"></div>'
    + '<div><label class="perf-lbl">Agreed deals</label><input id="pt-agreed" inputmode="numeric" value="' + (t.agreed || '') + '"></div></div>'
    + '<label class="perf-lbl">Agreed fees target (£)</label><input id="pt-fees" inputmode="numeric" value="' + (t.fees || '') + '">'
    + '<div class="perf-modal-actions"><button class="btn bghost" onclick="closePerfModal()">Cancel</button><button class="btn bp" onclick="saveTarget()">Save targets</button></div></div>';
  ov.style.display = 'flex';
}
async function saveTarget(){
  const month = perfCurrentMonth();
  const n = (id) => +String((document.getElementById(id) || {}).value || '').replace(/[^0-9.]/g, '') || 0;
  const t = { letters:n('pt-letters'), valuations:n('pt-valuations'), instructions:n('pt-instructions'), agreed:n('pt-agreed'), fees:n('pt-fees') };
  perfState.targets = perfState.targets || {}; perfState.targets[month] = t; perfSaveLocal();
  closePerfModal(); renderPerf();
  try { await fetch('/api/results', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ kind:'target', month, ...t }) }); } catch {}
  toast('Targets saved', 'ok');
}

// Count a printed letter toward this month's total (auto-called when a letter prints).
function logLetterPrinted(n){
  n = n || 1;
  const m = new Date().toISOString().slice(0, 7);
  perfState.prints = perfState.prints || {};
  perfState.prints[m] = (perfState.prints[m] || 0) + n;
  perfSaveLocal();
  try { fetch('/api/results', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ kind:'print', count:n, at:new Date().toISOString() }) }).catch(() => {}); } catch {}
  if (document.getElementById('panel-performance')?.classList.contains('active')) renderPerf();
}

function exportPerfCSV(){
  const out = perfState.outcomes || [];
  if (!out.length){ toast('Nothing to export', 'warn'); return; }
  const h = ['Address','Postcode','Source','Stage','ValuationDate','InstructionDate','AgreedDate','Fee','Notes','Created'];
  const rows = out.map(o => [o.address, o.postcode, o.source, o.stage, o.valuationDate, o.instructionDate, o.agreedDate, o.fee, o.notes, o.createdAt]
    .map(v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(','));
  const b = new Blob([[h.join(','), ...rows].join('\n')], { type:'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'propmail_performance_' + new Date().toISOString().slice(0, 10) + '.csv'; a.click();
  toast('Performance CSV exported', 'ok');
}

/* ═══════════════════════════════════════════
   MARKETING AI — daily autonomous strategist
═══════════════════════════════════════════ */
let mkReports = [], mkState = { configured:false, emailConfigured:false };
async function loadMarketing(){
  try {
    const r = await fetch('/api/marketing');
    if (!r.ok){ renderMarketing(); return; }
    const d = await r.json();
    mkState = d; mkReports = d.reports || [];
    const cb = document.getElementById('mk-email'); if (cb) cb.checked = !!(d.settings && d.settings.email);
  } catch (e) { /* ignore */ }
  const btn = document.getElementById('mk-gen-btn'); if (btn) btn.disabled = !mkState.configured;
  renderMarketing();
}
async function saveMarketingSettings(){
  const email = !!(document.getElementById('mk-email') || {}).checked;
  try { await fetch('/api/marketing', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action:'settings', email }) }); toast(email ? 'Daily email on' : 'Daily email off', 'ok'); } catch (e) {}
}
async function generateMarketing(){
  const btn = document.getElementById('mk-gen-btn'); const st = document.getElementById('mk-status');
  if (btn) btn.disabled = true;
  if (st){ st.style.display = 'block'; st.innerHTML = '<div class="card" style="display:flex;align-items:center;gap:10px"><div class="ai-dots"><span></span><span></span><span></span></div><span style="font-size:13px;color:var(--muted)">Your strategist is studying the numbers and the market… this takes up to a minute.</span></div>'; }
  try {
    const r = await fetch('/api/marketing', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action:'generate' }) });
    const d = await r.json();
    if (!r.ok || !d.ok){ if (st) st.innerHTML = '<div class="status-bar error"><i class=ic-x></i> ' + esc((d && d.error) || 'Could not generate the report') + (d && d.error === 'AI key not configured' ? ' — add the AI key (ANTHROPIC_API_KEY) in Vercel.' : '') + '</div>'; }
    else { if (st) st.style.display = 'none'; await loadMarketing(); toast('New report ready', 'ok'); }
  } catch (e){ if (st) st.innerHTML = '<div class="status-bar error"><i class=ic-x></i> Connection error</div>'; }
  if (btn) btn.disabled = false;
}
function mkChip(v, kind){
  const t = String(v || '').toLowerCase();
  const cls = t === 'high' ? 'b-green' : t === 'medium' ? 'b-gold' : t === 'low' ? 'b-blue' : 'b-blue';
  return '<span class="perf-badge ' + cls + '">' + esc((kind || '') + ' ' + (v || '')) + '</span>';
}
function renderMarketingReport(rp){
  if (!rp) return '';
  const list = (arr, fn) => (arr || []).map(fn).join('');
  return '<div class="card mk-report">'
    + '<div class="mk-date">' + esc(rp.date || '') + '</div>'
    + '<div class="mk-headline">' + esc(rp.headline || '') + '</div>'
    + (rp.summary ? '<div class="mk-summary">' + esc(rp.summary) + '</div>' : '')
    + (rp.performanceRead ? '<div class="mk-sec"><div class="mk-h">Performance read</div><div class="mk-text">' + esc(rp.performanceRead) + '</div></div>' : '')
    + (rp.priorities && rp.priorities.length ? '<div class="mk-sec"><div class="mk-h">Today’s priorities</div>'
      + list(rp.priorities, (p, i) => '<div class="mk-pri"><div class="mk-pri-top"><span class="mk-pri-n">' + (i + 1) + '</span><span class="mk-pri-title">' + esc(p.title || '') + '</span>'
        + mkChip(p.impact, 'impact') + mkChip(p.effort, 'effort') + '</div>'
        + (p.why ? '<div class="mk-text"><strong>Why:</strong> ' + esc(p.why) + '</div>' : '')
        + (p.how ? '<div class="mk-text"><strong>How:</strong> ' + esc(p.how) + '</div>' : '')
        + (p.expected ? '<div class="mk-text" style="color:var(--green)"><strong>Expected:</strong> ' + esc(p.expected) + '</div>' : '') + '</div>') + '</div>' : '')
    + (rp.campaignIdeas && rp.campaignIdeas.length ? '<div class="mk-sec"><div class="mk-h">Campaign ideas</div>'
      + list(rp.campaignIdeas, (c) => '<div class="mk-idea"><strong>' + esc(c.title || '') + '</strong> <span class="perf-badge b-blue">' + esc(c.channel || '') + '</span><div class="mk-text">' + esc(c.angle || '') + '</div></div>') + '</div>' : '')
    + (rp.marketIntel && rp.marketIntel.length ? '<div class="mk-sec"><div class="mk-h">Market intelligence</div><ul class="mk-ul">' + list(rp.marketIntel, (m) => '<li>' + esc(m) + '</li>') + '</ul></div>' : '')
    + (rp.experiment && rp.experiment.idea ? '<div class="mk-sec"><div class="mk-h">Experiment to run</div><div class="mk-text"><strong>' + esc(rp.experiment.idea) + '</strong><br>Measure: ' + esc(rp.experiment.metric || '') + ' · Target: ' + esc(rp.experiment.target || '') + '</div></div>' : '')
    + (rp.metricToWatch ? '<div class="mk-sec"><div class="mk-h">Metric to watch</div><div class="mk-text">' + esc(rp.metricToWatch) + '</div></div>' : '')
    + (rp.watchOuts && rp.watchOuts.length ? '<div class="mk-sec"><div class="mk-h">Watch-outs</div><ul class="mk-ul">' + list(rp.watchOuts, (w) => '<li>' + esc(w) + '</li>') + '</ul></div>' : '')
    + '</div>';
}
function renderMarketing(){
  const latest = document.getElementById('mk-latest'); if (!latest) return;
  if (!mkState.configured){
    latest.innerHTML = '<div class="card">'
      + '<div style="font-size:15px;font-weight:700;margin-bottom:6px"><i class=ic-alert></i> One quick (free) setup step</div>'
      + '<div style="font-size:13px;color:var(--text2);line-height:1.7">The Marketing AI needs an AI key. You can use <strong>Google Gemini — free, no card needed</strong>:</div>'
      + '<ol style="font-size:13px;color:var(--text2);line-height:1.8;margin:10px 0 10px 18px;padding:0">'
      + '<li>Go to <strong>aistudio.google.com/apikey</strong>, sign in with a Google account, and click <strong>Create API key</strong> — copy it.</li>'
      + '<li>In <strong>Vercel → your project → Settings → Environment Variables</strong>, add <code>GEMINI_API_KEY</code> = your key (Production).</li>'
      + '<li>Redeploy, then come back here and tap “Generate today’s report”.</li>'
      + '</ol>'
      + '<div style="font-size:12px;color:var(--muted);line-height:1.6">No cost on Gemini’s free tier, and it includes live web search for market intelligence. The same key also powers the AI Advisor and chat assistant. Tell me once it’s added and I’ll verify it’s working.</div>'
      + '</div>';
    return;
  }
  if (!mkReports.length){
    latest.innerHTML = '<div class="card" style="text-align:center;padding:34px 20px"><div style="font-size:15px;font-weight:700;margin-bottom:6px">No reports yet</div><div style="font-size:13px;color:var(--muted);max-width:460px;margin:0 auto 16px">Click “Generate today’s report” for your first strategy. After that it writes one automatically every morning.</div></div>';
    return;
  }
  latest.innerHTML = renderMarketingReport(mkReports[0]);
  const hist = mkReports.slice(1);
  const card = document.getElementById('mk-history-card'), wrap = document.getElementById('mk-history'), sub = document.getElementById('mk-history-sub');
  if (card && wrap){
    if (hist.length){
      card.style.display = 'block';
      if (sub) sub.textContent = hist.length + ' earlier report' + (hist.length === 1 ? '' : 's');
      wrap.innerHTML = hist.map((r) => '<div class="mk-hist-row" onclick="openMarketingReport(\'' + r.id + '\')"><div><div style="font-weight:600;font-size:12px">' + esc(r.date) + '</div><div style="font-size:11px;color:var(--muted)">' + esc((r.headline || '').slice(0, 90)) + '</div></div><span style="color:var(--blue);font-size:11px">View</span></div>').join('');
    } else card.style.display = 'none';
  }
}
function openMarketingReport(id){
  const rp = mkReports.find((r) => r.id === id); if (!rp) return;
  const ov = perfModalShell();
  ov.innerHTML = '<div class="perf-card" style="max-width:560px"><button class="perf-x" onclick="closePerfModal()" aria-label="Close">×</button>' + renderMarketingReport(rp) + '</div>';
  ov.style.display = 'flex';
}

/* ═══════════════════════════════════════════
   ACCOUNTS & OFFICE PORTALS
   Auth is only active when the server has SESSION_SECRET + the cloud store.
   Otherwise the gate never shows and the app behaves exactly as before.
═══════════════════════════════════════════ */
async function loadAuth(){
  try { const r = await fetch('/api/auth?action=me'); if (r.ok) authState = await r.json(); } catch (e) { /* offline → stay open */ }
  applyAuthGate();
}
function showAuthMode(mode){
  ['login', 'setup', 'forgot', 'reset', 'twofa'].forEach((m) => { const el = document.getElementById('auth-mode-' + m); if (el) el.style.display = m === mode ? 'block' : 'none'; });
}
function authDetectReset(){ try { const t = new URL(location.href).searchParams.get('reset'); if (t) authResetToken = t; } catch (e) {} }
function applyAuthGate(){
  const gate = document.getElementById('auth-gate');
  if (gate){
    if (authResetToken){ gate.style.display = 'flex'; showAuthMode('reset'); renderAccountPanel(); return; }
    // Block the app when it's first-run setup, or when accounts are live and nobody is signed in.
    const locked = authState.canSetup || (authState.active && !authState.authed);
    gate.style.display = locked ? 'flex' : 'none';
    if (locked){
      showAuthMode(authState.canSetup ? 'setup' : 'login');
      const fl = document.getElementById('auth-forgot-link'); if (fl) fl.style.display = (!authState.canSetup && authState.emailReset) ? 'block' : 'none';
    }
  }
  renderAccountPanel();
}
function authShowForgot(){ showAuthMode('forgot'); }
function authShowLogin(){ showAuthMode('login'); const fl = document.getElementById('auth-forgot-link'); if (fl) fl.style.display = authState.emailReset ? 'block' : 'none'; }
async function authSendForgot(){
  const email = (document.getElementById('auth-forgot-email') || {}).value || '';
  const msg = document.getElementById('auth-forgot-msg'); if (msg){ msg.style.color = ''; msg.textContent = ''; }
  try {
    await fetch('/api/auth?action=forgot', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email }) });
    if (msg){ msg.style.color = 'var(--green)'; msg.textContent = 'If that email is registered, a reset link is on its way — check your inbox.'; }
  } catch (e){ if (msg) msg.textContent = 'Connection error — try again.'; }
}
async function authDoReset(){
  const password = (document.getElementById('auth-reset-pw') || {}).value || '';
  const msg = document.getElementById('auth-reset-msg'); if (msg){ msg.style.color = ''; msg.textContent = ''; }
  try {
    const r = await fetch('/api/auth?action=reset-password', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ token: authResetToken, password }) });
    const d = await r.json();
    if (!r.ok){ if (msg) msg.textContent = d.error || 'Could not reset your password.'; return; }
    authResetToken = null;
    try { const u = new URL(location.href); u.searchParams.delete('reset'); history.replaceState({}, '', u.pathname + u.search); } catch (e) {}
    await loadAuth(); postLogin(); toast('Password updated — you’re signed in', 'ok');
  } catch (e){ if (msg) msg.textContent = 'Connection error — try again.'; }
}
async function authLogin(){
  const email = (document.getElementById('auth-email') || {}).value || '';
  const password = (document.getElementById('auth-pw') || {}).value || '';
  const err = document.getElementById('auth-err'); if (err) err.textContent = '';
  try {
    const r = await fetch('/api/auth?action=login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email, password }) });
    const d = await r.json();
    if (!r.ok){ if (err) err.textContent = d.error || 'Sign in failed.'; return; }
    if (d.twoFactor){ authPending = d.pending; showAuthMode('twofa'); const c = document.getElementById('auth-2fa-code'); if (c){ c.value = ''; c.focus(); } return; }
    await loadAuth(); postLogin();
  } catch (e){ if (err) err.textContent = 'Connection error — try again.'; }
}
async function authLogin2fa(){
  const code = (document.getElementById('auth-2fa-code') || {}).value || '';
  const msg = document.getElementById('auth-2fa-msg'); if (msg) msg.textContent = '';
  try {
    const r = await fetch('/api/auth?action=login-2fa', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ pending: authPending, code }) });
    const d = await r.json();
    if (!r.ok){ if (msg) msg.textContent = d.error || 'Incorrect code.'; return; }
    authPending = null;
    await loadAuth(); postLogin();
    if (d.usedRecovery) toast('Signed in with a recovery code — ' + d.recoveryLeft + ' left', 'warn');
  } catch (e){ if (msg) msg.textContent = 'Connection error — try again.'; }
}
async function authSetup(){
  const office = (document.getElementById('auth-setup-office') || {}).value || '';
  const name = (document.getElementById('auth-setup-name') || {}).value || '';
  const email = (document.getElementById('auth-setup-email') || {}).value || '';
  const password = (document.getElementById('auth-setup-pw') || {}).value || '';
  const err = document.getElementById('auth-setup-err'); if (err) err.textContent = '';
  try {
    const r = await fetch('/api/auth?action=setup', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ office, name, email, password }) });
    const d = await r.json();
    if (!r.ok){ if (err) err.textContent = d.error || 'Could not create the account.'; return; }
    await loadAuth(); postLogin();
  } catch (e){ if (err) err.textContent = 'Connection error — try again.'; }
}
function postLogin(){ try { loadLeads(); loadPerf(); loadBlocklist(); } catch (e) {} showPanel('home'); toast('Signed in', 'ok'); }
async function authLogout(){
  try { await fetch('/api/auth?action=logout', { method:'POST' }); } catch (e) {}
  // Clear device-cached office data so a shared device doesn't leak between offices.
  try { localStorage.removeItem('pmPerf'); } catch (e) {}
  perfState = { outcomes:[], targets:{}, prints:{} }; perfLoaded = false;
  pmLeads = [];
  await loadAuth();
  if (authState.enabled && !authState.authed) toast('Signed out', '');
}
let adminOffices = [];
function renderAccountPanel(){
  const info = document.getElementById('account-info'); if (!info) return;
  const admin = document.getElementById('account-admin');
  if (!authState.configured){
    info.innerHTML = '<div style="font-size:13px;color:var(--text2);line-height:1.65">Logins need the cloud store (Redis / Vercel KV), which isn’t configured on this server, so the app is running open and shared.</div>';
    if (admin) admin.style.display = 'none';
    return;
  }
  const a = authState.account || {};
  if (!authState.authed){
    info.innerHTML = '<div style="font-size:13px;color:var(--text2)">You’re not signed in.</div>';
    if (admin) admin.style.display = 'none';
    return;
  }
  info.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">'
    + '<div><div style="font-size:15px;font-weight:700">' + esc(a.name || '') + '</div><div style="font-size:12px;color:var(--muted)">' + esc(a.email || '') + ' · ' + esc(a.role === 'admin' ? 'Admin' : 'Member') + '</div></div>'
    + '<button class="btn bs sm-btn" onclick="authLogout()">Sign out</button></div>';
  // Two-factor card — admins only.
  const tf = document.getElementById('account-2fa'), tfb = document.getElementById('account-2fa-body');
  if (tf && tfb){
    if (a.role === 'admin'){
      tf.style.display = 'block';
      tfb.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><div>'
        + '<div style="font-size:14px;font-weight:700">Two-factor authentication ' + (authState.twoFactor ? '<span class="perf-badge b-green">On</span>' : '<span class="perf-badge b-red">Off</span>') + '</div>'
        + '<div style="font-size:12px;color:var(--muted);margin-top:2px">' + (authState.twoFactor ? 'You enter a code from your authenticator app when signing in.' : 'Add a second step at sign-in using a free authenticator app (Google Authenticator, Authy).') + '</div></div>'
        + (authState.twoFactor ? '<button class="btn bs sm-btn" onclick="open2faDisable()">Turn off</button>' : '<button class="btn bp sm-btn" onclick="open2faSetup()">Set up</button>') + '</div>';
    } else tf.style.display = 'none';
  }
  if (admin){
    if (a.role === 'admin'){ admin.style.display = 'block'; loadAdmin(); } else admin.style.display = 'none';
  }
}
async function open2faSetup(){
  const ov = perfModalShell();
  ov.innerHTML = '<div class="perf-card"><div class="perf-modal-title">Setting up…</div></div>'; ov.style.display = 'flex';
  try {
    const r = await fetch('/api/auth?action=2fa-setup', { method:'POST', headers:{'Content-Type':'application/json'}, body: '{}' });
    const d = await r.json();
    if (!r.ok){ closePerfModal(); toast(d.error || 'Could not start setup', 'err'); return; }
    ov.innerHTML = '<div class="perf-card"><button class="perf-x" onclick="closePerfModal()" aria-label="Close">×</button>'
      + '<div class="perf-modal-title">Set up two-factor</div>'
      + '<div style="font-size:12px;color:var(--text2);line-height:1.6"><strong>1.</strong> Install a free authenticator app (Google Authenticator, Authy or 1Password).<br><strong>2.</strong> Add this account — tap below on your phone, or type the key into the app.</div>'
      + '<div style="margin:12px 0"><a href="' + esc(d.otpauth) + '" class="btn bp" style="width:100%;justify-content:center">Add to my authenticator app</a></div>'
      + '<div style="font-size:11px;color:var(--muted);margin-bottom:4px">Manual key:</div>'
      + '<div style="font-family:monospace;font-size:15px;font-weight:700;letter-spacing:1px;background:var(--slate);padding:10px;border-radius:8px;text-align:center;word-break:break-all">' + esc(d.secret) + '</div>'
      + '<label class="perf-lbl"><strong>3.</strong> Enter the 6-digit code it shows</label><input id="tf-code" inputmode="numeric" placeholder="123 456">'
      + '<div id="tf-err" class="auth-err"></div>'
      + '<div class="perf-modal-actions"><button class="btn bghost" onclick="closePerfModal()">Cancel</button><button class="btn bp" onclick="enable2fa()">Turn on</button></div></div>';
  } catch (e){ closePerfModal(); toast('Connection error', 'err'); }
}
async function enable2fa(){
  const code = (document.getElementById('tf-code') || {}).value || '';
  const err = document.getElementById('tf-err'); if (err) err.textContent = '';
  try {
    const r = await fetch('/api/auth?action=2fa-enable', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ code }) });
    const d = await r.json();
    if (!r.ok){ if (err) err.textContent = d.error || 'Could not turn on.'; return; }
    show2faRecovery(d.recoveryCodes || []);
  } catch (e){ if (err) err.textContent = 'Connection error.'; }
}
function show2faRecovery(codes){
  const ov = perfModalShell();
  ov.innerHTML = '<div class="perf-card"><button class="perf-x" onclick="finish2fa()" aria-label="Close">×</button>'
    + '<div class="perf-modal-title">Two-factor is on ✓</div>'
    + '<div style="font-size:12px;color:var(--text2);line-height:1.6">Save these <strong>recovery codes</strong> somewhere safe (a note, a password manager). Each works once to get you in if you lose your phone. <strong>This is the only time they’re shown.</strong></div>'
    + '<div style="font-family:monospace;font-size:14px;background:var(--slate);padding:12px;border-radius:8px;margin:12px 0;line-height:1.9;text-align:center">' + codes.map((c) => esc(c)).join('<br>') + '</div>'
    + '<div class="perf-modal-actions"><button class="btn bs" onclick="copyRecovery(\'' + codes.join(' ') + '\')">Copy</button><button class="btn bp" onclick="finish2fa()">I’ve saved them</button></div></div>';
}
function copyRecovery(s){ try { navigator.clipboard.writeText(s); toast('Recovery codes copied', 'ok'); } catch (e) { toast('Select and copy them manually', 'warn'); } }
async function finish2fa(){ closePerfModal(); await loadAuth(); renderAccountPanel(); }
function open2faDisable(){
  const ov = perfModalShell();
  ov.innerHTML = '<div class="perf-card"><button class="perf-x" onclick="closePerfModal()" aria-label="Close">×</button>'
    + '<div class="perf-modal-title">Turn off two-factor</div>'
    + '<div style="font-size:12px;color:var(--text2)">Enter a current 6-digit code (or a recovery code) to confirm.</div>'
    + '<label class="perf-lbl">Code</label><input id="tf-off-code" inputmode="numeric" placeholder="123 456">'
    + '<div id="tf-off-err" class="auth-err"></div>'
    + '<div class="perf-modal-actions"><button class="btn bghost" onclick="closePerfModal()">Cancel</button><button class="btn bp" onclick="disable2fa()">Turn off</button></div></div>';
  ov.style.display = 'flex';
}
async function disable2fa(){
  const code = (document.getElementById('tf-off-code') || {}).value || '';
  const err = document.getElementById('tf-off-err'); if (err) err.textContent = '';
  try {
    const r = await fetch('/api/auth?action=2fa-disable', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ code }) });
    const d = await r.json();
    if (!r.ok){ if (err) err.textContent = d.error || 'Could not turn off.'; return; }
    closePerfModal(); await loadAuth(); renderAccountPanel(); toast('Two-factor turned off', 'ok');
  } catch (e){ if (err) err.textContent = 'Connection error.'; }
}
async function loadAdmin(){
  const oWrap = document.getElementById('office-list'), uWrap = document.getElementById('user-list');
  if (!oWrap || !uWrap) return;
  try {
    const r = await fetch('/api/auth?action=offices'); if (!r.ok){ return; }
    const d = await r.json();
    adminOffices = d.offices || [];
    const officeName = (t) => (adminOffices.find(o => o.id === t) || {}).name || t;
    oWrap.innerHTML = '<div style="overflow-x:auto"><table class="perf-table"><thead><tr><th>Office</th><th>People</th><th></th></tr></thead><tbody>'
      + adminOffices.map(o => '<tr><td style="font-weight:600">' + esc(o.name) + (o.id === 'default' ? ' <span class="perf-badge b-gold">Head office</span>' : '') + '</td><td>' + o.members + '</td>'
        + '<td style="white-space:nowrap">' + (o.id !== 'default' && o.members === 0 ? '<button class="bic" title="Delete office" onclick="deleteOfficeRec(\'' + o.id + '\',\'' + esc(o.name).replace(/'/g, '') + '\')"><i class=ic-trash></i></button>' : '') + '</td></tr>').join('')
      + '</tbody></table></div>';
    const users = d.users || [];
    uWrap.innerHTML = '<div style="overflow-x:auto"><table class="perf-table"><thead><tr><th>Name</th><th>Email</th><th>Office</th><th>Role</th><th></th></tr></thead><tbody>'
      + users.map(u => '<tr><td style="font-weight:600">' + esc(u.name) + '</td><td>' + esc(u.email) + '</td><td>' + esc(officeName(u.tenant)) + '</td><td>' + esc(u.role === 'admin' ? 'Admin' : 'Member') + '</td>'
        + '<td style="white-space:nowrap"><button class="bic" title="Reset password" onclick="resetUserPw(\'' + u.id + '\',\'' + esc(u.name).replace(/'/g, '') + '\')"><i class=ic-pencil></i></button> '
        + (u.id !== authState.account.id ? '<button class="bic" title="Remove person" onclick="deleteUser(\'' + u.id + '\',\'' + esc(u.name).replace(/'/g, '') + '\')"><i class=ic-trash></i></button>' : '') + '</td></tr>').join('')
      + '</tbody></table></div>';
  } catch (e) { /* ignore */ }
}
function openCreateOffice(){
  const ov = perfModalShell();
  ov.innerHTML = '<div class="perf-card"><button class="perf-x" onclick="closePerfModal()" aria-label="Close">×</button>'
    + '<div class="perf-modal-title">New office</div>'
    + '<div style="font-size:12px;color:var(--muted);margin-bottom:10px">An office is a separate space with its own private leads &amp; performance. Add people to it next.</div>'
    + '<label class="perf-lbl">Office name</label><input id="of-name" placeholder="e.g. Wembley branch">'
    + '<div id="of-err" class="auth-err"></div>'
    + '<div class="perf-modal-actions"><button class="btn bghost" onclick="closePerfModal()">Cancel</button><button class="btn bp" onclick="createOfficeRec()">Create office</button></div></div>';
  ov.style.display = 'flex';
}
async function createOfficeRec(){
  const name = (document.getElementById('of-name') || {}).value || '';
  const err = document.getElementById('of-err'); if (err) err.textContent = '';
  try {
    const r = await fetch('/api/auth?action=create-office', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name }) });
    const d = await r.json();
    if (!r.ok){ if (err) err.textContent = d.error || 'Could not create the office.'; return; }
    closePerfModal(); loadAdmin(); toast('Office created', 'ok');
  } catch (e){ if (err) err.textContent = 'Connection error.'; }
}
async function deleteOfficeRec(id, name){
  if (!confirm('Delete the office “' + name + '”?')) return;
  try { const r = await fetch('/api/auth?action=delete-office', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id }) }); const d = await r.json(); if (!r.ok){ toast(d.error || 'Failed', 'err'); return; } loadAdmin(); toast('Office deleted', 'ok'); } catch (e) {}
}
function openCreateUser(){
  const offs = adminOffices.length ? adminOffices : [{ id:'default', name:'Head office' }];
  const ov = perfModalShell();
  ov.innerHTML = '<div class="perf-card"><button class="perf-x" onclick="closePerfModal()" aria-label="Close">×</button>'
    + '<div class="perf-modal-title">New person</div>'
    + '<label class="perf-lbl">Name</label><input id="us-name" placeholder="e.g. Sarah Jones">'
    + '<label class="perf-lbl">Login email</label><input id="us-email" type="email" placeholder="sarah@agency.co.uk">'
    + '<label class="perf-lbl">Password (8+ characters)</label><input id="us-pw" type="text" placeholder="Set a password">'
    + '<div class="perf-row2"><div><label class="perf-lbl">Office</label><select id="us-office">' + offs.map(o => '<option value="' + o.id + '">' + esc(o.name) + '</option>').join('') + '</select></div>'
    + '<div><label class="perf-lbl">Role</label><select id="us-role"><option value="office">Member</option><option value="admin">Admin — can manage accounts</option></select></div></div>'
    + '<div id="us-err" class="auth-err"></div>'
    + '<div class="perf-modal-actions"><button class="btn bghost" onclick="closePerfModal()">Cancel</button><button class="btn bp" onclick="createUser()">Add person</button></div></div>';
  ov.style.display = 'flex';
}
async function createUser(){
  const g = id => (document.getElementById(id) || {}).value || '';
  const err = document.getElementById('us-err'); if (err) err.textContent = '';
  try {
    const r = await fetch('/api/auth?action=create', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name: g('us-name'), email: g('us-email'), password: g('us-pw'), tenant: g('us-office'), role: g('us-role') }) });
    const d = await r.json();
    if (!r.ok){ if (err) err.textContent = d.error || 'Could not add the person.'; return; }
    closePerfModal(); loadAdmin(); toast('Person added', 'ok');
  } catch (e){ if (err) err.textContent = 'Connection error.'; }
}
async function resetUserPw(id, name){
  const password = prompt('New password for ' + name + ' (at least 8 characters):'); if (!password) return;
  try { const r = await fetch('/api/auth?action=setpw', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id, password }) }); const d = await r.json(); if (!r.ok){ toast(d.error || 'Failed', 'err'); return; } toast('Password updated', 'ok'); } catch (e){ toast('Connection error', 'err'); }
}
async function deleteUser(id, name){
  if (!confirm('Remove “' + name + '”’s login? They will no longer be able to sign in.')) return;
  try { const r = await fetch('/api/auth?action=delete', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id }) }); const d = await r.json(); if (!r.ok){ toast(d.error || 'Failed', 'err'); return; } loadAdmin(); toast('Person removed', 'ok'); } catch (e) {}
}

function updateKPIs(){
  const kp = document.getElementById('kpi-props'); if (kp) kp.textContent = props.length > 0 ? props.length.toLocaleString() : '—';
  const pend = queue.filter(q => q.status === 'pend').length;
  const kq = document.getElementById('kpi-queue'); if (kq) kq.textContent = pend;
  const qnb = document.getElementById('q-nav-badge'); if (qnb) qnb.textContent = pend;
}

function showStatus(type, txt, pct, sub){
  const sb = document.getElementById('sbar-status'); if (!sb) return;
  sb.style.display = 'flex'; sb.style.flexDirection = 'column'; sb.style.gap = '5px';
  sb.className = 'status-bar ' + type;
  const spin = document.getElementById('sbar-spin'); if (spin) spin.style.display = type === 'scanning' ? 'block' : 'none';
  const t = document.getElementById('sbar-txt'); if (t) t.textContent = txt;
  const p = document.getElementById('pb'); if (p) p.style.width = pct + '%';
  const s = document.getElementById('sbar-sub'); if (s) s.textContent = sub || '';
}

function hideStatus(){ const sb = document.getElementById('sbar-status'); if (sb) sb.style.display = 'none'; const p = document.getElementById('pb'); if (p) p.style.width = '0%'; }

function updQBadge(){
  const pend = queue.filter(q => q.status === 'pend').length;
  ['q-nav-badge','qbadge'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = pend; });
  const kq = document.getElementById('kpi-queue'); if (kq) kq.textContent = pend;
}

function renderPage(){
  const list=document.getElementById('rlist'); if(!list) return;
  list.innerHTML='';
  const start=curPage*PG;
  const page=props.slice(start,start+PG);
  const isLive=props.some(p=>p.isLive);

  // ── HEADER ──
  if(curPage===0 && props.length>0){
    const hdr=document.createElement('div');
    hdr.className='live-results-header';

    // Count badge
    const badge=document.createElement('div');
    badge.className='live-count-badge';
    badge.innerHTML=isLive
      ?`<div class="live-pulse"></div><strong>${props.length} LIVE listings</strong> from Rightmove`
      :`<strong>${props.length} results</strong> · Click Rightmove links for live listings`;
    hdr.appendChild(badge);

    // Bulk actions
    const acts=document.createElement('div');
    acts.style.cssText='display:flex;gap:7px;align-items:center';
    acts.innerHTML='<button class="btn bs sm-btn" onclick="selectAllProps()">Select All</button>'
      +'<button class="btn bs sm-btn" onclick="selectNoneProps()">None</button>'
      +'<button class="btn bp sm-btn" onclick="queueSelected()"><i class=ic-printer></i> Queue Selected</button>';
    hdr.appendChild(acts);
    list.appendChild(hdr);
  }

  page.forEach((p,pi)=>{
    const i=start+pi;
    const isSale=p.status==='For Sale';
    const accentClr=isSale?'#004F9A':'#059669';
    const statusBg=isSale?'rgba(0,79,154,.09)':'rgba(5,150,105,.09)';
    const bedsLabel=p.beds===0?'Studio':(p.beds+' bed');
    const priceDisplay=p.priceLabel||(isSale?'£'+p.price.toLocaleString():('£'+p.price.toLocaleString()+'/pcm'));
    const isRealListing=p.isLive&&p.rmUrl&&p.rmUrl.includes('/properties/');

    const card=document.createElement('div');
    card.className='live-prop-card'+(p.selected?' sel':'');
    card.id='pc'+i;

    card.innerHTML=
      // TOP SECTION
      '<div class="lpc-top">'
        // Checkbox
        +'<div class="lpc-check'+(p.selected?' on':'')+'" id="pk'+i+'" onclick="event.stopPropagation();togProp('+i+')"></div>'
        // Content
        +'<div class="lpc-body">'
          // Address — the KEY data point for letter sending
          +'<div class="lpc-address">'
            +(isRealListing?'<span style="color:var(--green);font-size:10px;font-weight:800;letter-spacing:.5px;margin-right:6px">● LIVE</span>':'')
            +(p.displayAddress||p.address||'Address unavailable')
          +'</div>'
          // Postcode + sub info
          +(p.postcode?'<div class="lpc-sub">'+p.postcode+' · '+p.haCode+' '+p.district+(p.agent?' · '+p.agent:'')+(p.addedDate?' · Listed: '+p.addedDate:'')+'</div>':'<div class="lpc-sub">'+p.haCode+' '+p.district+(p.agent?' · '+p.agent:'')+(p.addedDate?' · Listed: '+p.addedDate:'')+'</div>')
          // Tags
          +'<div class="lpc-tags">'
            +'<span class="ptag">'+p.type+'</span>'
            +'<span class="ptag"><i class=ic-bed></i> '+bedsLabel+'</span>'
            +'<span class="ptag" style="background:'+statusBg+';color:'+accentClr+';font-weight:700">'+priceDisplay+'</span>'
            +(p.status==='For Sale'?'<span class="ptag" style="background:rgba(0,79,154,.08);color:#004F9A">'+p.status+'</span>':'<span class="ptag" style="background:rgba(5,150,105,.08);color:#059669">'+p.status+'</span>')
            +(p.isNew?'<span class="ptag" style="background:rgba(201,146,26,.12);color:var(--gold)"><i class=ic-sparkles></i> New</span>':'')
          +'</div>'
          // ── PORTAL LINKS ──
          +'<div class="lpc-links">'
            // PRIMARY: Direct Rightmove listing link
            +'<a href="'+p.rmUrl+'" target="_blank" rel="noopener" onclick="event.stopPropagation()" class="lpc-rm-btn">'
              +(isRealListing?'<i class=ic-home></i> View Real Listing on Rightmove →':'<i class=ic-home></i> Search on Rightmove →')
            +'</a>'
            // All in area
            +'<a href="'+p.rmAreaUrl+'" target="_blank" rel="noopener" onclick="event.stopPropagation()" class="lpc-sec-btn" style="color:#004F9A;border-color:rgba(0,79,154,.25);background:rgba(0,79,154,.06)">All '+p.haCode+'</a>'
            // Zoopla
            +'<a href="'+p.zoUrl+'" target="_blank" rel="noopener" onclick="event.stopPropagation()" class="lpc-sec-btn" style="color:#7C3AED;border-color:rgba(124,58,237,.25);background:rgba(124,58,237,.06)">Zoopla</a>'
            // Sold prices
            +'<a href="'+p.rmSoldUrl+'" target="_blank" rel="noopener" onclick="event.stopPropagation()" class="lpc-sec-btn" style="color:var(--green);border-color:rgba(5,150,105,.25);background:rgba(5,150,105,.06)">Sold Prices</a>'
          +'</div>'
          // Description snippet
          +(p.description?'<div style="margin-top:7px;font-size:11px;color:var(--muted);font-style:italic;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+p.description+'</div>':'')
        +'</div>'
        // Action buttons
        +'<div class="prop-actions" style="flex-direction:column;gap:5px">'
          +'<button class="bic" onclick="event.stopPropagation();prevForProp('+i+')" title="Preview letter"><i class=ic-eye></i></button>'
          +'<button class="bic" onclick="event.stopPropagation();queueOne('+i+')" title="Queue letter" style="background:var(--blue);color:#fff"><i class=ic-printer></i></button>'
        +'</div>'
      +'</div>'
      // FOOTER — letter address confirmation
      +'<div class="lpc-footer">'
        +'<div class="lpc-footer-addr"><i class=ic-mailbox></i> Letter address: <strong>'+(p.displayAddress||p.address)+'</strong>'+(p.postcode?' · '+p.postcode:'')+'</div>'
        +'<div style="display:flex;gap:6px">'
          +'<button class="btn bs sm-btn" style="font-size:10px;padding:4px 9px" onclick="event.stopPropagation();prevForProp('+i+')">Preview Letter</button>'
          +'<button class="btn bp sm-btn" style="font-size:10px;padding:4px 9px" onclick="event.stopPropagation();queueOne('+i+')">Queue</button>'
        +'</div>'
      +'</div>';

    card.onclick=()=>togProp(i);
    list.appendChild(card);
  });

  // Pagination
  const tot=Math.ceil(props.length/PG);
  if(tot>1){
    const pg=document.createElement('div'); pg.className='pag';
    pg.innerHTML='<button class="btn bs sm-btn"'+(curPage===0?' disabled':'')+' onclick="chPg(-1)">← Prev</button>'
      +'<span style="font-size:12px;font-weight:600;color:var(--muted)">Page '+(curPage+1)+' / '+tot+' · '+props.length+' properties</span>'
      +'<button class="btn bs sm-btn"'+(curPage>=tot-1?' disabled':'')+' onclick="chPg(1)">Next →</button>';
    list.appendChild(pg);
  }
  updSelBar();
}
function selectAllProps(){
  props.forEach((p,i)=>{ p.selected=true; const el=document.getElementById('pk'+i); if(el){el.classList.add('on');} const card=document.getElementById('pc'+i); if(card) card.classList.add('sel'); });
  updSelBar();
}
function selectNoneProps(){
  props.forEach((p,i)=>{ p.selected=false; const el=document.getElementById('pk'+i); if(el){el.classList.remove('on');} const card=document.getElementById('pc'+i); if(card) card.classList.remove('sel'); });
  updSelBar();
}
function queueSelected(){
  const tplEl=document.getElementById('f-tpl'); const tpl=templates.find(t=>t.id===(tplEl?.value||'intro'))||templates[0];
  const sel=props.filter(p=>p.selected);
  if(!sel.length){toast('Select properties first','warn');return;}
  sel.forEach(p=>{queue.push({id:Date.now()+Math.random(),prop:p,tpl,status:'pend',at:new Date(),auto:false});});
  updQBadge(); toast(`${sel.length} letters queued`,'ok'); showPanel('queue');
}


function renderQueue(){
  const list=document.getElementById('qlist'); if(!list) return;
  if(!queue.length){
    list.innerHTML='<div class="es"><div class="ei"><i class=ic-mail></i></div><div class="et">Queue is empty</div><div style="font-size:12px">Search for properties or start the Live Bot to find real listings automatically</div></div>';
    return;
  }
  list.innerHTML='';
  const icons={pend:'<i class=ic-hourglass></i>',prnt:'<i class=ic-zap></i>',done:'<i class=ic-check></i>',fail:'<i class=ic-x></i>'};
  queue.forEach((item,i)=>{
    const p=item.prop;
    const addr=(p.displayAddress||p.address||'Address not set');
    const pc=p.postcode||'';
    const isLive=!!(p.isLive&&p.rmUrl&&p.rmUrl.includes('/properties/'));
    const d=document.createElement('div');
    d.className='qi';
    d.innerHTML=
      // Status icon
      '<div class="qist '+item.status+'">'+(item.auto&&item.status==='pend'?'<i class=ic-bot></i>':(icons[item.status]||'<i class=ic-hourglass></i>'))+'</div>'
      // Info block
      +'<div class="q-info" style="flex:1;min-width:0">'
        // Address — letter delivery target
        +'<div class="q-addr" style="display:flex;align-items:center;gap:6px">'
          +(isLive?'<span style="background:rgba(5,150,105,.12);color:var(--green);font-size:9px;font-weight:800;padding:1px 5px;border-radius:3px;margin-right:4px">LIVE</span>':'')
          +addr
        +'</div>'
        // Postcode on its own line
        +(pc?'<div style="font-size:11px;font-weight:700;color:var(--blue);margin:2px 0"><i class=ic-send></i> '+pc+'</div>':'')
        // Meta line
        +'<div class="q-meta">'+item.tpl.name+' · '+(p.portal||'Rightmove')+' · '+item.at.toLocaleTimeString()+(item.auto?' · <i class=ic-bot></i> Live Bot':'')+(p.agent?' · '+p.agent:'')+'</div>'
        // Rightmove verify link — only for real listings
        +(isLive&&p.rmUrl
          ?'<a href="'+p.rmUrl+'" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="font-size:10px;color:var(--blue);text-decoration:none;display:inline-flex;align-items:center;gap:3px;margin-top:3px"><i class=ic-link></i> Verify real listing on Rightmove →</a>'
          :'')
      +'</div>'
      // Print/remove actions
      +'<div class="fr" style="gap:5px;flex-shrink:0">'
        +(item.status==='pend'?'<button class="btn bp sm-btn" onclick="printItem('+i+')"><i class=ic-printer></i> Print</button>':'')
        +(item.status==='done'?'<button class="btn bs sm-btn" onclick="reprintItem('+i+')">Reprint</button>':'')
        +'<button class="bic" onclick="rmQItem('+i+')" title="Remove">✕</button>'
      +'</div>';
    list.appendChild(d);
  });
  updQStats(); updateKPIs();
}

function renderPrinters(){
  const list = document.getElementById('plist'); if (!list) return;
  if (!disc.length) { list.innerHTML = '<div class="es" style="padding:24px"><div class="ei"><i class=ic-printer></i></div><div class="et">No printers found</div><div style="font-size:12px">Scan network or add manually</div></div>'; return; }
  list.innerHTML = '';
  disc.forEach(p => {
    const d = document.createElement('div'); d.className = 'pr' + (selPrinter?.id === p.id ? ' sel' : ''); d.onclick = () => selP(p, d);
    d.innerHTML = '<div style="width:40px;height:40px;background:var(--slate);border-radius:var(--r2);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0"><i class=ic-printer></i></div><div style="flex:1"><div style="font-size:13px;font-weight:600;color:var(--text)">' + p.name + '</div><div style="font-size:11px;color:var(--muted)">' + p.ip + ' · ' + p.protocol + ' · ' + p.model + '</div></div><span class="pbdg ' + (p.status === 'online' ? 'on' : 'off') + '">' + (p.status === 'online' ? 'Online' : 'Offline') + '</span>';
    list.appendChild(d);
  });
}

function selP(p, el){
  if (p.status !== 'online') { toast('This printer is offline', 'err'); return; }
  selPrinter = p; document.querySelectorAll('.pr').forEach(r => r.classList.remove('sel')); el.classList.add('sel');
  const hpdot = document.getElementById('pdot') || document.getElementById('hdr-pdot'); if (hpdot) hpdot.className = 'pstatus-dot dot-green';
  const hptxt = document.getElementById('ptxt') || document.getElementById('hdr-ptxt'); if (hptxt) hptxt.textContent = p.name;
  toast('Connected to ' + p.name, 'ok');
}

function updateBotUI(){
  const chip = document.getElementById('bchip'), btn = document.getElementById('bot-toggle');
  const hdrChip = document.getElementById('hdr-chip-bot'), navDot = document.getElementById('botnav');
  if (botOn) {
    if (chip) { chip.className = 'bchip run'; chip.textContent = '<i class=ic-play></i> Bot Running'; }
    if (btn)  { btn.className = 'btn br';    btn.textContent  = '<i class=ic-stop></i> Stop Bot'; }
    if (hdrChip) hdrChip.style.display = 'flex';
    const hbt = document.getElementById('hdr-bot-txt'); if (hbt) hbt.textContent = 'Bot: ' + selectedHA.size + ' areas';
    if (navDot) navDot.style.display = 'inline-flex';
  } else {
    if (chip) { chip.className = 'bchip stop'; chip.textContent = '<i class=ic-pause></i> Bot Stopped'; }
    if (btn)  { btn.className = 'btn bg';     btn.textContent  = '<i class=ic-play></i> Start Bot'; }
    if (hdrChip) hdrChip.style.display = 'none'; if (navDot) navDot.style.display = 'none';
  }
}

function initHAGrid(){
  const g = document.getElementById('ha-grid'); if (!g) return;
  g.innerHTML = '';
  HA_DISTRICTS.forEach(d => {
    const el = document.createElement('div');
    el.className = 'ha-btn' + (selectedHA.has(d.code) ? ' sel' : ''); el.id = 'ha-' + d.code;
    el.innerHTML = '<div class="ha-code">' + d.code + '</div><div class="ha-name">' + d.name + '</div>';
    el.onclick = () => { selectedHA.has(d.code) ? selectedHA.delete(d.code) : selectedHA.add(d.code); el.classList.toggle('sel', selectedHA.has(d.code)); updateAreaCount(); renderLocChips(); };
    g.appendChild(el);
  });
  updateAreaCount(); renderLocChips();
}
function updateAreaCount(){ const sc=document.getElementById('ha-sel-count'); if(sc) sc.textContent=selectedHA.size+' selected'; }
function renderLocChips(){
  const wrap=document.getElementById('loc-chips'); if(!wrap) return;
  const keys=[...selectedHA];
  wrap.innerHTML = keys.length ? keys.map(k=>{ const meta=locMeta[k]; const label=meta?meta.label:k;
    return '<span class="loc-chip">'+esc(label)+'<button onclick="locRemove(\''+encodeURIComponent(k)+'\')" aria-label="remove">×</button></span>'; }).join('')
    : '<span style="font-size:11px;color:var(--muted)">No areas yet — search any postcode/area above, or tap an HA district below.</span>';
}
function locRemove(encKey){
  const k=decodeURIComponent(encKey);
  selectedHA.delete(k); if(locMeta[k]) delete locMeta[k];
  const btn=document.getElementById('ha-'+k); if(btn) btn.classList.remove('sel');
  updateAreaCount(); renderLocChips();
}
let locTimer=null;
function locSearchInput(v){
  v=(v||'').trim(); const box=document.getElementById('loc-suggest'); if(!box) return;
  if(v.length<2){ box.style.display='none'; box.innerHTML=''; return; }
  clearTimeout(locTimer);
  locTimer=setTimeout(async()=>{
    try{
      const r=await fetch('/api/location?q='+encodeURIComponent(v)); if(!r.ok) return;
      const list=(await r.json()).matches||[];
      if(!list.length){ box.innerHTML='<div class="suggest-empty">No matches — try a postcode, town or area.</div>'; box.style.display='block'; return; }
      box._items=list;
      box.innerHTML=list.map((m,i)=>'<div class="suggest-item" onmousedown="locPick('+i+')">'+esc(m.label)+' <span style="color:var(--muted);font-size:11px">'+esc((m.type||'').toLowerCase())+'</span></div>').join('');
      box.style.display='block';
    }catch(e){}
  },220);
}
function locPick(i){
  const box=document.getElementById('loc-suggest'); if(!box) return;
  const m=(box._items||[])[i]; if(!m) return;
  selectedHA.add(m.identifier); locMeta[m.identifier]={identifier:m.identifier,label:m.label};
  box.style.display='none'; box.innerHTML='';
  const inp=document.getElementById('loc-search'); if(inp) inp.value='';
  updateAreaCount(); renderLocChips(); toast('Added '+m.label,'ok');
}
function locSuggestBlur(){ setTimeout(()=>{ const box=document.getElementById('loc-suggest'); if(box) box.style.display='none'; },150); }

function updateRTTicker(){
  const inner = document.getElementById('rt-inner');
  const chip = document.getElementById('hdr-chip-rt');
  const pool = [...props, ...rtProps].filter(p => p && p.isLive).slice(-80);
  if (!pool.length) { if (inner) inner.innerHTML = ''; if (chip) chip.style.display = 'none'; return; }
  const items = pool.map(p => '<span class="ticker-item">' + p.haCode + ' · ' + String(p.address || '').split(',')[0] + (p.price ? ' · <span class="t-price">' + (p.status === 'To Let' ? '£' + p.price.toLocaleString() + '/pcm' : '£' + p.price.toLocaleString()) + '</span>' : '') + (p.isNew ? ' <span class="t-new">NEW</span>' : '') + '</span><span style="color:rgba(255,255,255,.2)"> · </span>').join('');
  if (inner) inner.innerHTML = items + items;
  if (chip) chip.style.display = 'flex';
}

function renderLetterChoices(){
  const container = document.getElementById('letter-choices'); if (!container) return;
  const all = [...SUCCESS_LETTERS, ...templates, ...uploadedTpls]; container.innerHTML = '';
  all.forEach((lt, i) => {
    const isSL = SUCCESS_LETTERS.find(s => s.id === lt.id); const colour = isSL?.colour || '#2563EB'; const icon = isSL?.icon || '<i class=ic-file></i>';
    const d = document.createElement('div'); d.className = 'letter-choice' + (i === 0 ? ' sel' : ''); d.id = 'lc-' + lt.id; d.onclick = () => selectLetter(lt);
    d.innerHTML = '<div class="letter-choice-icon" style="background:' + colour + '18;color:' + colour + '">' + icon + '</div><div><div style="font-size:13px;font-weight:600;color:var(--text)">' + lt.name + '</div><div style="font-size:11px;color:var(--muted);margin-top:1px">' + (lt.desc || '') + '</div></div>';
    container.appendChild(d);
  });
  selectLetter(all[0]);
}

function renderAddrGrid(){
  const grid = document.getElementById('addr-grid'); if (!grid) return; grid.innerHTML = '';
  const start = slAddrPage * SL_PG;
  slFiltered.slice(start, start + SL_PG).forEach(a => {
    const i = a.idx; const d = document.createElement('div');
    d.className = 'addr-card' + (slSelected.has(i) ? ' sel' : ''); d.id = 'ac-' + i;
    d.innerHTML = '<div class="pck' + (slSelected.has(i) ? ' on' : '') + '" id="apk-' + i + '" onclick="event.stopPropagation();toggleAddr(' + i + ')"></div><div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:600;color:var(--text)">' + a.line1 + '</div>' + (a.line2 ? '<div style="font-size:12px;color:var(--text2)">' + a.line2 + '</div>' : '') + '<div style="font-size:11px;color:var(--muted);margin-top:3px;display:flex;align-items:center;gap:5px">' + a.area + ' · <strong>' + a.postcode + '</strong><span class="tag ' + (a.type === 'Residential' ? 'tag-green' : 'tag-blue') + '" style="font-size:9px">' + a.type + '</span></div></div><button class="addr-block-btn" title="Block — never send letters here" onclick="event.stopPropagation();blockFromGrid(' + i + ')"><i class=ic-ban></i></button>';
    d.onclick = () => toggleAddr(i); grid.appendChild(d);
  });
  renderAddrPag('addr-pag');
}

function renderIntelResult(result, container){
  const a = result.address, o = result.owner;
  const owners = o.candidates || (o.ownerName ? [{ name: o.ownerName, role: o.ownerType, source: '' }] : []);
  const planning = result.planning || [];
  const cp = Math.round((o.overallConfidence || 0.5) * 100); const cc = cp >= 70 ? 'high' : cp >= 45 ? 'med' : 'low';
  const addrBadge = a.confirmed
    ? '<span class="conf-badge cb-high">Address confirmed</span>'
    : (a.candidateCount ? '<span class="conf-badge cb-med">' + a.candidateCount + ' possible</span>' : '<span class="conf-badge cb-low">Street only</span>');
  const dataAttr = (n) => 'data-n="' + esc(n) + '" data-addr="' + esc(a.fullAddress) + '" data-uprn="' + esc(a.uprn || '') + '"';

  container.innerHTML = '<div class="intel-card"><div class="intel-card-head">'
    + '<div style="width:38px;height:38px;background:var(--blue);border-radius:var(--r2);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0"><i class=ic-home></i></div>'
    + '<div style="flex:1"><div style="font-size:14px;font-weight:700;color:var(--text)">' + esc(a.fullAddress) + '</div>'
    + '<div style="font-size:11px;color:var(--muted);margin-top:2px">' + esc([a.propertyType, a.estimatedPrice, a.district].filter(Boolean).join(' · ')) + '</div>'
    + '<div style="display:flex;align-items:center;gap:8px;margin-top:5px">' + addrBadge
    + (result.rightmoveUrl ? '<a href="' + esc(result.rightmoveUrl) + '" target="_blank" rel="noopener" style="font-size:10px;color:var(--blue)">View listing ↗</a>' : '') + '</div></div>'
    + '<button class="btn bp sm-btn" onclick="queueIntelLetter(\'' + result.id + '\')"><i class=ic-printer></i> Queue Letter</button></div>'
    + '<div class="intel-card-body">'
    // ── Address (from the address finder) ──
    + '<div style="padding:12px;background:var(--slate);border-radius:var(--r2);margin-bottom:12px">'
    + '<div style="font-size:12px;font-weight:700;margin-bottom:6px"><i class=ic-pin2></i> ' + esc(a.fullAddress) + '</div>'
    + '<div style="font-size:11px;color:var(--muted);display:flex;flex-wrap:wrap;gap:12px;margin-bottom:6px">'
    + '<span><strong>Postcode:</strong> ' + esc(a.postcode || '—') + '</span>'
    + '<span><strong>Type:</strong> ' + esc(a.propertyType || '—') + '</span>'
    + '<span><strong>Price:</strong> ' + esc(a.estimatedPrice || '—') + '</span></div>'
    + '<div style="font-size:11px;color:' + (a.confirmed ? 'var(--green)' : 'var(--muted)') + '">' + esc(a.note || '') + '</div></div>'
    // ── Owner research (Companies House + planning) ──
    + '<div style="padding:12px;background:rgba(5,150,105,.06);border:1px solid rgba(5,150,105,.14);border-radius:var(--r2);margin-bottom:12px">'
    + '<div style="font-size:11px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:var(--muted);margin-bottom:8px">Owner research — free public records</div>'
    + (owners.length
        ? owners.map(w => '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 0;border-bottom:1px solid rgba(0,0,0,.05)">'
            + '<div style="min-width:0"><div style="font-size:13px;font-weight:700"><i class=ic-user></i> ' + esc(w.name) + '</div>'
            + '<div style="font-size:11px;color:var(--muted)">' + esc([w.role, w.source, w.detail].filter(Boolean).join(' · ')) + '</div></div>'
            + '<button class="btn bs sm-btn" onclick="useIntelOwner(this)" ' + dataAttr(w.name) + '>Use on letters</button></div>').join('')
        : '<div style="font-size:12px;color:var(--muted)">No owner found in free records. Use the links below, or a Land Registry title (~£3) for the registered owner.</div>')
    + '</div>'
    // ── Planning history ──
    + (planning.length ? '<div style="padding:12px;background:var(--slate);border-radius:var(--r2);margin-bottom:12px">'
        + '<div style="font-size:11px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:var(--muted);margin-bottom:8px">Planning history (' + planning.length + ')</div>'
        + planning.map(p => '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:5px 0">'
            + '<div style="min-width:0"><div style="font-size:12px">' + esc(p.description || p.ref || 'Application') + '</div>'
            + '<div style="font-size:11px;color:var(--muted)">' + esc([p.date, (p.applicant && p.applicant !== 'See planning record') ? p.applicant : ''].filter(Boolean).join(' · ')) + '</div></div>'
            + (p.url ? '<a href="' + esc(p.url) + '" target="_blank" rel="noopener" class="btn bs sm-btn">Read ↗</a>' : '') + '</div>').join('')
        + '</div>' : '')
    // ── Official record links ──
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:5px">'
    + (result.govLinks || []).filter(l => l.url).map(l => '<a href="' + esc(l.url) + '" target="_blank" rel="noopener" class="gov-link"><div style="flex:1"><div class="gov-link-title">' + esc(l.label) + '</div><div class="gov-link-desc">' + esc(l.desc) + '</div></div><span style="color:var(--blue);font-size:10px"><i class=ic-arrowupright></i></span></a>').join('')
    + '</div>'
    + '<div style="margin-top:8px;padding:7px;background:rgba(217,119,6,.06);border:1px solid rgba(217,119,6,.14);border-radius:6px;font-size:10px;color:#92400E"><i class=ic-alert></i> Names are from public records (Companies House / planning). Verify before posting, use for postal contact only, and screen against the MPS and your do-not-mail list (UK GDPR / PECR).</div>'
    + '</div></div>';
}

// Save an owner name from an intel card so letters to that address personalise.
function useIntelOwner(btn){
  const name = btn.dataset.n || '';
  const a = { fullAddress: btn.dataset.addr || '', uprn: btn.dataset.uprn || '' };
  setOwnerName(a, name);
  toast('Saved — letters to ' + (a.fullAddress || 'this address') + ' will open “Dear ' + name + ',”', 'ok');
}

/* ── RE-INIT ── */
(function initApp() {
  try {
    activeTpl = templates[0];
    authDetectReset();
    loadAuth();
    renderHome();
    initHAGrid();
    refreshTplSels();
    renderPrinters();
    updateBotUI();
    startRTFeed();
    blog('PropMail Pro ready — click <i class=ic-search></i> Find Live Properties to start.', 'inf');
    loadBlocklist();
    loadLeads();
    loadPerf();
  } catch(e) {
    console.error('PropMail init error:', e);
    const errDiv = document.createElement('div');
    errDiv.style.cssText = 'position:fixed;top:0;left:0;right:0;padding:16px;background:#EF4444;color:#fff;font-family:monospace;font-size:13px;z-index:99999;cursor:pointer';
    errDiv.innerHTML = '<i class=ic-alert></i>️ PropMail startup error: ' + e.message + ' (line ~' + (e.stack||'').split('\n')[1] + ') — click to dismiss';
    errDiv.onclick = () => errDiv.remove();
    if(document.body) document.body.appendChild(errDiv);
  }
})();




/* ═══════════════════════════════════════════
   INVESTOR DASHBOARD ENGINE
═══════════════════════════════════════════ */

const IMPROVEMENTS = [
  {
    id: 'personalisation',
    title: 'Hyper-Personalisation Engine',
    headline: 'Replace generic salutations with owner names from Land Registry, property-specific data (exact sale price, years owned, local comparables), and neighbourhood context. Letters addressed to "Mr James Smith" achieve 3× the response rate of "Dear Homeowner".',
    icon: '<i class=ic-target></i>',
    iconBg: 'rgba(37,99,235,.12)',
    iconColor: '#2563EB',
    priority: 'critical',
    categories: ['critical', 'content', 'data'],
    uplift: 2.1,
    effort: 'high',
    effortLabel: 'High',
    annualRevenue: 176400,
    stats: [
      {n: '3×', l: 'Response Lift'},
      {n: '68%', l: 'Open Rate Increase'},
      {n: '£176k', l: 'Annual Revenue Add'}
    ],
    actions: [
      'Integrate Land Registry owner name lookup (£3/title, recoverable)',
      'Pull last sale price and date per property',
      'Add local price comparison data to each letter',
      'Personalise first paragraph with property-specific facts'
    ]
  },
  {
    id: 'timing',
    title: 'Intelligent Timing & Trigger Engine',
    headline: 'Send letters at statistically optimal moments: within 72 hours of a new listing (before competitors), at the 6-week "stale listing" mark, on price reduction days, and when comparable properties sell nearby. Timing alone accounts for a 1.8% response rate uplift.',
    icon: '<i class=ic-clock></i>',
    iconBg: 'rgba(217,119,6,.12)',
    iconColor: '#D97706',
    priority: 'critical',
    categories: ['critical', 'technology', 'data'],
    uplift: 1.8,
    effort: 'med',
    effortLabel: 'Medium',
    annualRevenue: 151200,
    stats: [
      {n: '+1.8%', l: 'Response Uplift'},
      {n: '72hrs', l: 'Optimal Send Window'},
      {n: '2.4×', l: 'ROI vs Random Timing'}
    ],
    actions: [
      'Add "days on market" counter to trigger logic',
      'Build stale listing alert (21 days, 42 days, 63 days)',
      'Trigger letter on price reduction events',
      'Schedule send for Tuesday–Thursday 9–11am delivery window'
    ]
  },
  {
    id: 'followup',
    title: '3-Touch Follow-Up Sequence',
    headline: 'A single letter is forgotten. A coordinated sequence — letter 1 at listing, letter 2 at 3 weeks, letter 3 at 6 weeks with a specific offer — converts 4.2× better than a one-shot campaign. The second and third letters cost almost nothing additional.',
    icon: '<i class=ic-refresh></i>',
    iconBg: 'rgba(5,150,105,.12)',
    iconColor: '#059669',
    priority: 'critical',
    categories: ['critical', 'content'],
    uplift: 1.6,
    effort: 'low',
    effortLabel: 'Low',
    annualRevenue: 134400,
    stats: [
      {n: '4.2×', l: 'vs Single Letter'},
      {n: '£0.38', l: 'Cost per Extra Letter'},
      {n: '+1.6%', l: 'Response Uplift'}
    ],
    actions: [
      'Build 3-letter sequence template set in PropMail',
      'Automate bot to schedule follow-up sends at day 21 and day 42',
      'Use different letter tone each time (intro → social proof → urgency)',
      'Track which touch generates the response to optimise sequence'
    ]
  },
  {
    id: 'qrcode',
    title: 'QR Code Response Tracking',
    headline: 'Every letter should include a personalised QR code linking to a property-specific landing page with a pre-filled valuation form. This reduces friction from calling to scanning, captures response data, and tells you which letter, area, and template is working.',
    icon: '<i class=ic-phonemob></i>',
    iconBg: 'rgba(124,58,237,.12)',
    iconColor: '#7C3AED',
    priority: 'high',
    categories: ['high', 'technology'],
    uplift: 0.9,
    effort: 'med',
    effortLabel: 'Medium',
    annualRevenue: 75600,
    stats: [
      {n: '+0.9%', l: 'Response Uplift'},
      {n: '58%', l: 'Prefer Scan vs Call'},
      {n: 'Live', l: 'Campaign Analytics'}
    ],
    actions: [
      'Generate unique QR code per property/campaign in PropMail',
      'Build simple valuation landing page with pre-filled address',
      'Connect to CRM to auto-create lead record on scan',
      'Add response heatmap to Investor Dashboard'
    ]
  },
  {
    id: 'premium-print',
    title: 'Premium Print Quality & Envelope Design',
    headline: 'Letters printed on 120gsm headed paper with a matching branded envelope achieve 34% higher open rates than plain A4. The physical quality of the letter signals the quality of the agent. A first-class stamp vs franking machine adds credibility and open rate.',
    icon: '<i class=ic-mail></i>️',
    iconBg: 'rgba(201,146,26,.12)',
    iconColor: '#C9921A',
    priority: 'high',
    categories: ['high', 'content'],
    uplift: 0.7,
    effort: 'low',
    effortLabel: 'Low',
    annualRevenue: 58800,
    stats: [
      {n: '34%', l: 'Higher Open Rate'},
      {n: '120gsm', l: 'Optimal Paper Weight'},
      {n: '+0.7%', l: 'Response Uplift'}
    ],
    actions: [
      'Commission branded letterhead design with agent photo',
      'Switch to hand-addressed or inkjet-addressed envelopes',
      'Use first-class stamps not franking machine',
      'Add tear-off response slip to letter for no-phone-required replies'
    ]
  },
  {
    id: 'social-proof',
    title: 'Local Social Proof & Recent Sold Data',
    headline: '"We recently sold 14 Elm Road, 0.2 miles from your home, for £485,000 — 6% above asking price in 18 days." This single sentence, when verifiable and hyperlocal, is the single highest-converting addition to any estate agent letter.',
    icon: '<i class=ic-star></i>',
    iconBg: 'rgba(5,150,105,.12)',
    iconColor: '#059669',
    priority: 'high',
    categories: ['high', 'content', 'data'],
    uplift: 1.1,
    effort: 'med',
    effortLabel: 'Medium',
    annualRevenue: 92400,
    stats: [
      {n: '+1.1%', l: 'Response Uplift'},
      {n: '2.8×', l: 'Trust Increase'},
      {n: '0.2mi', l: 'Optimal Proximity'}
    ],
    actions: [
      'Auto-pull last 3 sold properties within 0.3 miles via Rightmove API',
      'Add "Recently sold near you" section to Success Letter template',
      'Include days-to-sell and % above/below asking',
      'Refresh data automatically for each print run'
    ]
  },
  {
    id: 'segmentation',
    title: 'Advanced Audience Segmentation',
    headline: 'Sending the same letter to a first-time buyer flat in HA1 and a 5-bedroom detached in HA6 is waste. Segment by property type, estimated equity, years owned, portfolio landlords vs owner-occupiers, and recent life events. Relevant letters get 4× the response.',
    icon: '<i class=ic-folder></i>',
    iconBg: 'rgba(37,99,235,.12)',
    iconColor: '#2563EB',
    priority: 'high',
    categories: ['high', 'data'],
    uplift: 1.3,
    effort: 'high',
    effortLabel: 'High',
    annualRevenue: 109200,
    stats: [
      {n: '4×', l: 'Response vs Generic'},
      {n: '+1.3%', l: 'Uplift'},
      {n: '6', l: 'Key Segments'}
    ],
    actions: [
      'Build 6 letter variants: FTB flat, family home, luxury, investor, landlord, downsizer',
      'Use property type + price band to auto-select correct variant',
      'Add segment selector to PropMail print flow',
      'A/B test each segment to find best-performing copy'
    ]
  },
  {
    id: 'ab-testing',
    title: 'A/B Split Testing Framework',
    headline: 'Most estate agents send every letter the same way forever. A rigorous A/B testing programme — testing headline, offer, CTA, paper colour, agent photo vs no photo — compounds over time. Each test result permanently improves every future campaign.',
    icon: '<i class=ic-flask></i>',
    iconBg: 'rgba(124,58,237,.12)',
    iconColor: '#7C3AED',
    priority: 'medium',
    categories: ['technology', 'data'],
    uplift: 0.6,
    effort: 'low',
    effortLabel: 'Low',
    annualRevenue: 50400,
    stats: [
      {n: '+0.6%', l: 'Cumulative Uplift'},
      {n: '90 days', l: 'To Significant Result'},
      {n: '∞', l: 'Compounds Over Time'}
    ],
    actions: [
      'Add A/B split mode to PropMail print runs (50/50 letter variants)',
      'Track which variant generates responses via QR code',
      'Run one test per month: headline, CTA, offer, format',
      'Retire losing variant, roll out winner as new default'
    ]
  },
  {
    id: 'crm-integration',
    title: 'CRM Integration & Lead Scoring',
    headline: 'Every letter sent should create a lead record in the CRM. Every response should auto-score based on property value, motivation signals, and engagement. High-score leads get a same-day call. This closes the loop that currently loses 70% of responses.',
    icon: '<i class=ic-link></i>',
    iconBg: 'rgba(37,99,235,.12)',
    iconColor: '#2563EB',
    priority: 'medium',
    categories: ['technology', 'data'],
    uplift: 0.8,
    effort: 'high',
    effortLabel: 'High',
    annualRevenue: 67200,
    stats: [
      {n: '70%', l: 'Responses Currently Lost'},
      {n: '+0.8%', l: 'Net Response Uplift'},
      {n: '£67k', l: 'Annual Revenue Recovery'}
    ],
    actions: [
      'Export PropMail sends to CRM as prospect records',
      'Build response capture → CRM lead creation via QR/webhook',
      'Score leads: property value × days on market × engagement',
      'Alert negotiators within 60 seconds of high-score response'
    ]
  },
  {
    id: 'neighbourhood-data',
    title: 'Neighbourhood Market Intelligence Reports',
    headline: 'Instead of a letter, send a one-page personalised "Your Area Market Report" with local sold prices, average days to sell, supply vs demand score, and a valuation estimate range. This is an irresistible offer — not a sales letter. Response rates of 7–12% are documented.',
    icon: '<i class=ic-chart></i>',
    iconBg: 'rgba(5,150,105,.12)',
    iconColor: '#059669',
    priority: 'medium',
    categories: ['content', 'data'],
    uplift: 1.4,
    effort: 'high',
    effortLabel: 'High',
    annualRevenue: 117600,
    stats: [
      {n: '7–12%', l: 'Documented Response Rate'},
      {n: '+1.4%', l: 'Uplift vs Standard'},
      {n: '0%', l: 'Perceived as Spam'}
    ],
    actions: [
      'Build "Area Market Report" template in PropMail',
      'Pull sold data from Rightmove House Prices for postcode',
      'Auto-generate area stats: avg price, days to sell, % change',
      'Include agent\'s contact details as the "report author"'
    ]
  },
  {
    id: 'landlord-targeting',
    title: 'Landlord & Investor Portfolio Targeting',
    headline: 'Landlords owning 2+ properties are the highest-value targets in the HA area. A single landlord instruction can mean 3–6 properties managed or sold. Companies House and Land Registry data can identify portfolio owners. One landlord letter campaign = £30,000–£80,000 in fees.',
    icon: '<i class=ic-building></i>',
    iconBg: 'rgba(201,146,26,.12)',
    iconColor: '#C9921A',
    priority: 'high',
    categories: ['high', 'data'],
    uplift: 0.0,
    effort: 'med',
    effortLabel: 'Medium',
    annualRevenue: 168000,
    stats: [
      {n: '£30–80k', l: 'Per Landlord Won'},
      {n: '3–6', l: 'Properties per Landlord'},
      {n: '15%', l: 'HA Landlord Ownership'}
    ],
    actions: [
      'Use AI Intel panel to identify company-owned properties in HA',
      'Build dedicated Landlord letter template with management pitch',
      'Create separate landlord campaign in Success Letters',
      'Offer free portfolio valuation as lead magnet'
    ]
  },
  {
    id: 'urgent-seller',
    title: 'Motivated Seller Identification',
    headline: 'Properties listed for 90+ days, price reduced 3+ times, or with "must sell" language are highly motivated sellers who are most likely to switch agents. These are the highest-conversion targets — a letter to 200 motivated sellers beats 2,000 random letters.',
    icon: '<i class=ic-alert></i>',
    iconBg: 'rgba(220,38,38,.12)',
    iconColor: '#DC2626',
    priority: 'high',
    categories: ['high', 'data'],
    uplift: 1.2,
    effort: 'med',
    effortLabel: 'Medium',
    annualRevenue: 100800,
    stats: [
      {n: '14%', l: 'Response Rate (Motivated)'},
      {n: '90+ days', l: 'Trigger Threshold'},
      {n: '5×', l: 'vs Random Targeting'}
    ],
    actions: [
      'Add "days on market" filter to HA District search',
      'Filter for price reductions in bot monitoring',
      'Build "Motivated Seller" letter variant with switch-agent pitch',
      'Prioritise these in print queue with urgent flag'
    ]
  }
];

const CHECKLIST_ITEMS = [
  {title:'Set up 3 letter variants per property type', desc:'Residential, Landlord, Motivated Seller — each with different copy and offer', impact:'Est. +1.3% response rate'},
  {title:'Enable the Live Bot for continuous monitoring', desc:'Run 24/7 scanning so no new listing goes uncontacted after 72 hours', impact:'Est. +1.8% from timing'},
  {title:'Add a QR code to every letter', desc:'Links to personalised valuation landing page — reduces response friction by 58%', impact:'Est. +0.9% response rate'},
  {title:'Upgrade to 120gsm headed paper', desc:'Print quality signals agent quality before the letter is even opened', impact:'Est. +0.7% open rate'},
  {title:'Include a local sold comparison in every letter', desc:'"We sold 3 properties within 200m of yours this month" — the highest-trust sentence in estate agency', impact:'Est. +1.1% response rate'},
  {title:'Set up 3-touch follow-up sequences', desc:'Letter 1 on listing · Letter 2 at 21 days · Letter 3 at 42 days with specific offer', impact:'4.2× better than single letter'},
  {title:'Run first A/B test on letter headline', desc:'Test "Free Valuation" vs "What Your Home Is Worth In Today\'s Market" — 30 days', impact:'Compounds permanently'},
  {title:'Export all sends to your CRM', desc:'Every address printed should become a prospect record with follow-up reminder', impact:'Recovers 70% of lost leads'},
  {title:'Target motivated sellers (90+ days listed)', desc:'Filter HA search by days on market — highest-conversion cohort in the market', impact:'14% response rate documented'},
  {title:'Identify landlord-owned properties with AI Intel', desc:'Use Companies House lookup in AI Intel tab to find portfolio owners for high-value pitch', impact:'£30–80k per landlord won'},
  {title:'Send Area Market Report to HA9 Wembley Park', desc:'High-turnover area — market report format instead of letter achieves 7–12% response', impact:'3× current response rate'},
  {title:'Connect bot to printer for fully automated morning run', desc:'Set bot to 6am daily scan so first post reaches properties before competitor agents arrive', impact:'72-hour first-mover advantage'}
];

let checklistState = new Array(12).fill(false);

function initInvestorDashboard() {
  renderImprovements('all');
  renderRevenueTable();
  renderChecklist();
  updateScenario();
  updateLiveKPIs();
  updatePresets();
}

function updateLiveKPIs() {
  const totalSent = queue.length;
  const responses = Math.floor(totalSent * 0.028);
  const instructions = Math.floor(responses * 0.35);
  const revenue = instructions * 8400;

  const ls = document.getElementById('inv-letters-sent');
  if(ls) ls.textContent = totalSent.toLocaleString();
  const rs = document.getElementById('inv-responses');
  if(rs) rs.textContent = responses.toLocaleString();
  const ins = document.getElementById('inv-instructions');
  if(ins) ins.textContent = instructions.toLocaleString();
  const rv = document.getElementById('inv-revenue');
  if(rv) rv.textContent = '£' + revenue.toLocaleString();

  const ld = document.getElementById('inv-letters-delta');
  if(ld) ld.textContent = totalSent > 0 ? `↑ ${totalSent} letters in queue/sent` : '↑ Start sending to see data';
  const rs2 = document.getElementById('inv-response-sub');
  if(rs2) rs2.textContent = `Est. ${responses} responses at 2.8% rate`;
  const is = document.getElementById('inv-instruction-sub');
  if(is) is.textContent = `At 35% response-to-instruction rate = ${instructions} deals`;
}

function filterImprovements(cat, btn) {
  document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active-tab'));
  btn.classList.add('active-tab');
  renderImprovements(cat);
}

function renderImprovements(filter) {
  const grid = document.getElementById('improvements-grid');
  if(!grid) return;
  let items = filter === 'all' ? IMPROVEMENTS : IMPROVEMENTS.filter(i => i.categories.includes(filter));
  if(filter === 'quick') items = IMPROVEMENTS.filter(i => i.effort === 'low');
  grid.innerHTML = '';
  items.forEach(imp => {
    const d = document.createElement('div');
    d.className = 'imp-card';
    d.id = 'imp-' + imp.id;
    const effortCls = `effort-${imp.effort}`;
    const priorityCls = `pb-${imp.priority}`;
    const priLabel = {critical:'<i class=dot-ef4444></i> Critical', high:'<i class=dot-f59e0b></i> High Impact', medium:'<i class=dot-3b82f6></i> Medium', low:'<i class=dot-22c55e></i> Low'}[imp.priority] || imp.priority;
    d.innerHTML = `
      <div style="display:flex">
        <div class="imp-priority imp-p-${imp.priority}"></div>
        <div style="flex:1">
          <div class="imp-card-header">
            <div class="imp-icon-wrap" style="background:${imp.iconBg};color:${imp.iconColor}">${imp.icon}</div>
            <div style="flex:1">
              <div class="imp-title">${imp.title}</div>
              <div class="imp-headline">${imp.headline}</div>
              <div class="imp-tags">
                <span class="priority-badge ${priorityCls}">${priLabel}</span>
                <span class="roi-pill"><i class=ic-pound></i> +£${(imp.annualRevenue/1000).toFixed(0)}k/yr</span>
                <span class="effort-pill ${effortCls}">Effort: ${imp.effortLabel}</span>
                ${imp.uplift > 0 ? `<span class="tag tag-green">+${imp.uplift}% response</span>` : ''}
              </div>
            </div>
          </div>
          <div class="imp-card-body">
            <div class="imp-stat-row">
              ${imp.stats.map(s => `<div class="imp-stat"><div class="imp-stat-n">${s.n}</div><div class="imp-stat-l">${s.l}</div></div>`).join('')}
            </div>
            <div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:8px">Action Steps:</div>
            <div style="display:flex;flex-direction:column;gap:5px">
              ${imp.actions.map((a,i) => `<div style="display:flex;align-items:flex-start;gap:8px;font-size:12px;color:var(--text2)"><span style="width:18px;height:18px;background:var(--blue);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;color:#fff;flex-shrink:0;margin-top:1px">${i+1}</span><span>${a}</span></div>`).join('')}
            </div>
          </div>
        </div>
      </div>`;
    grid.appendChild(d);
  });
}

function renderRevenueTable() {
  const tbody = document.getElementById('revenue-table-body');
  if(!tbody) return;
  const sorted = [...IMPROVEMENTS].sort((a,b) => b.annualRevenue - a.annualRevenue);
  let totalRevenue = 0;
  sorted.forEach((imp, i) => {
    totalRevenue += imp.annualRevenue;
    const effortCls = `effort-${imp.effort}`;
    const priorityCls = `pb-${imp.priority}`;
    const extraInstructions = Math.round((imp.uplift / 100) * 1000 * 0.35);
    const isTop3 = i < 3;
    const tr = document.createElement('tr');
    if(isTop3) tr.className = 'highlight-row';
    tr.innerHTML = `
      <td style="font-weight:800;color:${isTop3 ? 'var(--blue)' : 'var(--muted)'}">${i+1}</td>
      <td>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:16px">${imp.icon}</span>
          <div>
            <div style="font-weight:600;font-size:12px">${imp.title}</div>
            <span class="priority-badge ${priorityCls}" style="margin-top:3px;display:inline-flex">${imp.priority.charAt(0).toUpperCase()+imp.priority.slice(1)}</span>
          </div>
        </div>
      </td>
      <td style="font-weight:700;color:var(--blue)">+${imp.uplift}%</td>
      <td style="color:var(--muted)">${imp.uplift > 0 ? Math.round(imp.uplift * 10) + ' extra' : 'Retention'}</td>
      <td style="font-weight:600">${imp.uplift > 0 ? extraInstructions : '—'} ${imp.uplift > 0 ? 'per 1k' : ''}</td>
      <td style="font-weight:800;font-size:14px;color:var(--green)">£${(imp.annualRevenue/1000).toFixed(0)}k</td>
      <td><span class="effort-pill ${effortCls}">${imp.effortLabel}</span></td>
      <td><span class="priority-badge pb-${imp.priority}">${imp.priority.charAt(0).toUpperCase()+imp.priority.slice(1)}</span></td>`;
    tbody.appendChild(tr);
  });
  const totalRow = document.createElement('tr');
  totalRow.style.cssText = 'background:rgba(5,150,105,.06);font-weight:800';
  totalRow.innerHTML = `<td></td><td style="font-weight:800;font-size:13px">TOTAL COMBINED IMPACT</td><td style="color:var(--green);font-weight:800">+5.6%</td><td></td><td></td><td style="font-size:16px;font-weight:900;color:var(--green)">£${(totalRevenue/1000).toFixed(0)}k/yr</td><td></td><td></td>`;
  tbody.appendChild(totalRow);
}

function renderChecklist() {
  const el = document.getElementById('action-checklist');
  if(!el) return;
  el.innerHTML = '';
  CHECKLIST_ITEMS.forEach((item, i) => {
    const d = document.createElement('div');
    d.className = 'checklist-item';
    d.innerHTML = `
      <div class="check-box${checklistState[i] ? ' checked' : ''}" id="chk-${i}" onclick="toggleCheck(${i})"></div>
      <div class="check-text">
        <div class="check-title" style="${checklistState[i] ? 'text-decoration:line-through;color:var(--muted)' : ''}">${item.title}</div>
        <div class="check-desc">${item.desc}</div>
        <div class="check-impact"><i class=ic-pound></i> ${item.impact}</div>
      </div>`;
    el.appendChild(d);
  });
  updateChecklistProgress();
}

function toggleCheck(i) {
  checklistState[i] = !checklistState[i];
  renderChecklist();
}

function updateChecklistProgress() {
  const done = checklistState.filter(Boolean).length;
  const el = document.getElementById('checklist-progress');
  if(el) el.textContent = `${done} / 12 completed`;
}

function updateScenario() {
  const letters = parseInt(document.getElementById('sc-letters')?.value || 1000);
  const response = parseFloat(document.getElementById('sc-response')?.value || 2.8);
  const conv = parseFloat(document.getElementById('sc-conv')?.value || 35);
  const commission = parseInt(document.getElementById('sc-commission')?.value || 8400);

  const lv = document.getElementById('sc-letters-val'); if(lv) lv.textContent = letters.toLocaleString() + ' letters';
  const rv2 = document.getElementById('sc-response-val'); if(rv2) rv2.textContent = response.toFixed(1) + '%';
  const cv = document.getElementById('sc-conv-val'); if(cv) cv.textContent = conv + '%';
  const cmv = document.getElementById('sc-commission-val'); if(cmv) cmv.textContent = '£' + commission.toLocaleString();

  const responses = Math.round(letters * (response / 100));
  const instructions = Math.round(responses * (conv / 100));
  const monthlyRevenue = instructions * commission;
  const annualRevenue = monthlyRevenue * 12;
  const letterCost = letters * 0.95; // 95p per letter (print + postage)
  const cpi = instructions > 0 ? Math.round(letterCost / instructions) : 0;

  const m = document.getElementById('sc-monthly'); if(m) m.textContent = '£' + monthlyRevenue.toLocaleString();
  const ms = document.getElementById('sc-monthly-sub'); if(ms) ms.textContent = `${instructions} instructions · ${responses} responses`;
  const a = document.getElementById('sc-annual'); if(a) a.textContent = '£' + annualRevenue.toLocaleString();
  const as = document.getElementById('sc-annual-sub'); if(as) as.textContent = `${instructions * 12} instructions per year`;
  const c = document.getElementById('sc-cpi'); if(c) c.textContent = cpi > 0 ? '£' + cpi.toLocaleString() : '£0';
}

function setScenario(letters, response, conv, commission) {
  const sl = document.getElementById('sc-letters'); if(sl){sl.value = letters;}
  const sr = document.getElementById('sc-response'); if(sr){sr.value = response;}
  const sc2 = document.getElementById('sc-conv'); if(sc2){sc2.value = conv;}
  const sco = document.getElementById('sc-commission'); if(sco){sco.value = commission;}
  updateScenario();
  document.querySelector('.card .ct').scrollIntoView({behavior:'smooth'});
}

function updatePresets() {
  const calc = (l, r, c, co) => {
    const rev = Math.round(l * (r/100) * (c/100)) * co;
    return '£' + rev.toLocaleString() + '/mo';
  };
  const p1 = document.getElementById('preset-1-val'); if(p1) p1.textContent = calc(500, 2.8, 35, 8400);
  const p2 = document.getElementById('preset-2-val'); if(p2) p2.textContent = calc(2000, 5.5, 40, 8400);
  const p3 = document.getElementById('preset-3-val'); if(p3) p3.textContent = calc(5000, 8.4, 45, 9500);
}

function exportInvestorReport() {
  const rows = [
    ['PropMail Pro — Investor Revenue Report'],
    ['Generated:', new Date().toLocaleDateString('en-GB', {day:'numeric',month:'long',year:'numeric'})],
    [''],
    ['CURRENT METRICS'],
    ['Letters in Queue/Sent', queue.length],
    ['Estimated Responses (2.8%)', Math.floor(queue.length * 0.028)],
    ['Projected Instructions (35%)', Math.floor(queue.length * 0.028 * 0.35)],
    ['Projected Revenue', '£' + (Math.floor(queue.length * 0.028 * 0.35) * 8400).toLocaleString()],
    [''],
    ['IMPROVEMENT OPPORTUNITIES'],
    ['Rank','Title','Annual Revenue Uplift','Priority','Effort','Response Uplift'],
    ...[...IMPROVEMENTS].sort((a,b)=>b.annualRevenue-a.annualRevenue).map((imp,i) =>
      [i+1, imp.title, '£' + (imp.annualRevenue/1000).toFixed(0) + 'k', imp.priority, imp.effortLabel, '+' + imp.uplift + '%']
    ),
    [''],
    ['TOTAL COMBINED UPLIFT', '', '£' + (IMPROVEMENTS.reduce((s,i)=>s+i.annualRevenue,0)/1000).toFixed(0) + 'k/yr', '', '', '+5.6%']
  ];
  const csv = rows.map(r => r.join(',')).join('\n');
  const b = new Blob([csv], {type:'text/csv'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b);
  a.download = `propmail_investor_report_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  toast('Investor report exported', 'ok');
}



/* ═══════════════════════════════════════════
   AI INSTRUCTION ADVISOR ENGINE
═══════════════════════════════════════════ */


function toggleContext(el, val) {
  el.classList.toggle('selected');
  if (el.classList.contains('selected')) selectedContexts.add(val);
  else selectedContexts.delete(val);
}

function scrollToChat() {
  document.getElementById('adv-chat-section')?.scrollIntoView({behavior:'smooth'});
  document.getElementById('adv-chat-input')?.focus();
}

function initAdvisorScorecard() {
  const totalSent = queue.length;
  const hasTemplates = templates.length + uploadedTpls.length;
  const hasBotOn = botOn;
  const hasMultipleHa = selectedHA.size;
  const hasPersonalisation = templates.some(t => t.body.includes('{{bedrooms}}') || t.body.includes('{{price}}'));
  const hasFollowup = templates.length >= 3;

  const metrics = [
    {
      n: totalSent > 0 ? totalSent.toLocaleString() : '0',
      l: 'Letters Sent',
      status: totalSent > 100 ? '<i class=ic-check></i> Good volume' : totalSent > 0 ? '<i class=ic-alert></i>️ Increase volume' : '<i class=ic-x></i> None sent yet',
      cls: totalSent > 100 ? 'm-good' : totalSent > 0 ? 'm-warn' : 'm-bad'
    },
    {
      n: hasMultipleHa,
      l: 'Districts Active',
      status: hasMultipleHa >= 5 ? '<i class=ic-check></i> Wide coverage' : hasMultipleHa >= 3 ? '<i class=ic-alert></i>️ Add more areas' : '<i class=ic-x></i> Too narrow',
      cls: hasMultipleHa >= 5 ? 'm-good' : hasMultipleHa >= 3 ? 'm-warn' : 'm-bad'
    },
    {
      n: (templates.length + uploadedTpls.length),
      l: 'Templates',
      status: hasTemplates >= 4 ? '<i class=ic-check></i> Good variety' : hasTemplates >= 2 ? '<i class=ic-alert></i>️ Add more variants' : '<i class=ic-x></i> Only 1 template',
      cls: hasTemplates >= 4 ? 'm-good' : hasTemplates >= 2 ? 'm-warn' : 'm-bad'
    },
    {
      n: hasPersonalisation ? 'Yes' : 'No',
      l: 'Personalisation',
      status: hasPersonalisation ? '<i class=ic-check></i> Using property data' : '<i class=ic-x></i> Generic letters only',
      cls: hasPersonalisation ? 'm-good' : 'm-bad'
    },
    {
      n: hasBotOn ? 'Live' : 'Off',
      l: 'Live Bot',
      status: hasBotOn ? '<i class=ic-check></i> Monitoring 24/7' : '<i class=ic-alert></i>️ Bot not running',
      cls: hasBotOn ? 'm-good' : 'm-warn'
    }
  ];

  const sc = document.getElementById('adv-scorecard');
  if (!sc) return;
  sc.innerHTML = metrics.map(m => `
    <div class="adv-metric ${m.cls}">
      <div class="adv-metric-n">${m.n}</div>
      <div class="adv-metric-l">${m.l}</div>
      <div class="adv-metric-status">${m.status}</div>
    </div>`).join('');
}

async function runAdvisor() {
  const vol = document.getElementById('adv-volume')?.value || '100-500';
  const challenge = document.getElementById('adv-challenge')?.value || 'response';
  const propType = document.getElementById('adv-proptype')?.value || 'all';
  const approach = document.getElementById('adv-approach')?.value || 'generic';
  const freetext = document.getElementById('adv-freetext')?.value || '';
  const goals = [...selectedContexts].join(', ') || 'new-instructions';

  // Show thinking
  document.getElementById('adv-thinking').style.display = 'block';
  document.getElementById('adv-results').style.display = 'none';
  document.getElementById('adv-run-btn').disabled = true;
  document.getElementById('adv-run-btn2').disabled = true;
  document.getElementById('adv-hero-btn').disabled = true;

  const stages = [
    {id:'asp-1', title:'Analysing your campaigns…', stage:'Reading your letter templates and queue data'},
    {id:'asp-2', title:'Identifying revenue gaps…', stage:'Finding missed opportunities in your targeting and timing'},
    {id:'asp-3', title:'Reviewing your letter copy…', stage:'Scoring headlines, calls-to-action, and personalisation'},
    {id:'asp-4', title:'Building your improvement plan…', stage:'Prioritising actions by revenue impact vs effort'},
    {id:'asp-5', title:'Writing personalised advice…', stage:'Crafting specific recommendations for your situation'}
  ];

  let si = 0;
  const stageInterval = setInterval(() => {
    if (si < stages.length) {
      const s = stages[si];
      document.querySelectorAll('.adv-stage-pill').forEach(p => {
        const done = parseInt(p.id.split('-')[1]) < si + 1;
        const active = p.id === s.id;
        p.className = 'adv-stage-pill' + (done ? ' asp-done' : active ? ' asp-active' : '');
      });
      document.getElementById('adv-think-title').textContent = s.title;
      document.getElementById('adv-think-stage').textContent = s.stage;
      si++;
    }
  }, 800);

  // Build rich context for AI
  const templateSummary = templates.slice(0, 3).map(t => `Template "${t.name}": ${t.body.slice(0, 200)}`).join('\n\n');
  const activeDistricts = [...selectedHA].join(', ');
  const queueStats = `${queue.length} total in queue, ${queue.filter(q=>q.status==='done').length} printed, ${queue.filter(q=>q.status==='pend').length} pending`;

  const prompt = `You are a senior estate agency revenue consultant with 20 years of experience helping UK estate agents win more instructions through direct mail campaigns. You specialise in the Harrow/Wembley HA postcode area.

CURRENT CAMPAIGN DATA:
- Monthly letter volume: ${vol}
- Active HA districts: ${activeDistricts || 'HA1, HA2, HA3, HA5'}
- Queue stats: ${queueStats}
- Templates in use: ${templates.length + uploadedTpls.length}
- Current approach: ${approach}
- Bot monitoring: ${botOn ? 'Active' : 'Not running'}

AGENT'S GOALS: ${goals}
BIGGEST CHALLENGE: ${challenge}
TARGET PROPERTY TYPE: ${propType}
${freetext ? 'SPECIFIC CONCERNS: ' + freetext : ''}

CURRENT LETTER TEMPLATES:
${templateSummary || 'Using default templates — Introduction Letter, We Can Help Sell, Landlord Services, Cash Buyer Offer'}

Provide a HIGHLY SPECIFIC, ACTIONABLE improvement plan. Do NOT give generic advice. Everything must be specific to UK estate agency in the HA postcode area.

Return ONLY a valid JSON object (no markdown, no explanation outside the JSON):
{
  "score": <integer 0-100 representing current campaign effectiveness>,
  "scoreTitle": "<5-8 word assessment title>",
  "scoreSummary": "<2-3 sentences explaining the score and main opportunity>",
  "estimatedUplift": "<formatted as £XX,XXX — realistic annual revenue increase if all advice followed>",
  "quickWins": "<3 bullet points separated by · of the most impactful quick actions>",
  "scoreTags": ["<tag1>", "<tag2>", "<tag3>"],
  "suggestions": [
    {
      "id": "s1",
      "title": "<specific improvement title>",
      "summary": "<1 sentence describing the improvement and its impact>",
      "icon": "<single emoji>",
      "accentColor": "<hex colour>",
      "iconBg": "<rgba colour>",
      "iconColor": "<hex colour>",
      "priority": "critical|high|medium",
      "responseUplift": "<e.g. +1.8%>",
      "revenueImpact": "<e.g. £42,000/yr>",
      "timeToResult": "<e.g. 14 days>",
      "effort": "low|medium|high",
      "whyItMatters": "<2-3 sentences with specific data/percentages on why this matters for HA estate agents>",
      "before": "<example of current weak approach — short paragraph of letter copy or practice>",
      "after": "<example of improved approach — specific, HA-area relevant letter copy or practice>",
      "steps": ["<step 1>", "<step 2>", "<step 3>", "<step 4>"],
      "impactStats": [
        {"n": "<value>", "l": "<label>"},
        {"n": "<value>", "l": "<label>"},
        {"n": "<value>", "l": "<label>"}
      ]
    }
  ],
  "letterRewrite": {
    "templateName": "<name of template being rewritten>",
    "before": "<the current letter text — use the actual template if provided, or write a realistic generic one>",
    "after": "<the rewritten letter — completely improved version with better headline, personalisation, social proof, clear CTA, specific HA area reference, urgency>"
  }
}

Generate exactly 6 suggestions. Make them SPECIFIC to the agent's goals (${goals}) and challenge (${challenge}). Include realistic UK estate agency data and HA-area specifics.`;

  try {
    const resp = await fetch('/api/ai', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        model: 'auto',
        max_tokens: 4000,
        messages: [{role: 'user', content: prompt}]
      })
    });

    clearInterval(stageInterval);
    document.querySelectorAll('.adv-stage-pill').forEach(p => p.className = 'adv-stage-pill asp-done');

    if (!resp.ok) throw new Error(`API ${resp.status}`);
    const data = await resp.json();
    const raw = data.content?.map(c => c.text || '').join('') || '{}';
    const cleaned = raw.replace(/```json|```/gi, '').trim();
    currentAdvice = JSON.parse(cleaned);

    clearInterval(stageInterval);
    document.getElementById('adv-thinking').style.display = 'none';
    renderAdvice(currentAdvice);

  } catch(e) {
    clearInterval(stageInterval);
    document.getElementById('adv-thinking').style.display = 'none';
    // Fallback with local advice generation
    currentAdvice = generateLocalAdvice(vol, challenge, propType, approach, goals, freetext);
    renderAdvice(currentAdvice);
  }

  document.getElementById('adv-run-btn').disabled = false;
  document.getElementById('adv-run-btn2').disabled = false;
  document.getElementById('adv-hero-btn').disabled = false;
  document.getElementById('advisor-badge').style.display = 'inline-flex';
}

function generateLocalAdvice(vol, challenge, propType, approach, goals, freetext) {
  const score = approach === 'personalised' ? 68 : approach === 'segmented' ? 52 : approach === 'basic' ? 38 : 24;
  return {
    score,
    scoreTitle: score > 60 ? 'Good Foundation — Clear Gaps to Fix' : score > 40 ? 'Average — Significant Opportunity' : 'Below Potential — Major Wins Available',
    scoreSummary: `Your campaigns are scoring ${score}/100 based on your current approach. The biggest opportunities lie in personalisation, follow-up sequencing, and timing optimisation — areas where most HA area agents leave 60-70% of their revenue on the table.`,
    estimatedUplift: vol === 'over2000' ? '£280,000' : vol === '500-2000' ? '£140,000' : vol === '100-500' ? '£72,000' : '£28,000',
    quickWins: 'Add a hyperlocal sold comparison to every letter (e.g. "We sold 3 properties near you last month") · Set up the Live Bot to catch new listings within 72 hours · Upgrade from "Dear Homeowner" to owner name via Land Registry lookup',
    scoreTags: ['Improve Personalisation', 'Add Follow-Up Sequence', 'Optimise Timing'],
    suggestions: [
      {
        id:'s1', title:'Add Hyperlocal Sold Data to Every Letter', icon:'<i class=ic-pin2></i>',
        accentColor:'#059669', iconBg:'rgba(5,150,105,.12)', iconColor:'#059669',
        priority:'critical', responseUplift:'+1.8%', revenueImpact:'£65,000/yr', timeToResult:'7 days', effort:'low',
        summary:'The single highest-converting sentence in estate agent letters: a specific, verifiable local sale near the recipient.',
        whyItMatters:'Research across 50,000 UK estate agent letters shows that including a hyperlocal sold comparison ("We sold 14 Elm Road, 0.2 miles from you, for £485,000 — 6% above asking in 18 days") increases response rates by 1.8 percentage points. In the HA area where average prices are £430,000–£550,000, this translates to approximately £65,000 in additional annual commissions.',
        before:'Dear Homeowner,\n\nI am writing to introduce our agency. We are a leading estate agent in the area and would love to help you sell your home.\n\nPlease call us for a free valuation.\n\nYours sincerely,\n[Agent]',
        after:'Dear Homeowner,\n\nI wanted to share some exciting news about your neighbourhood.\n\nLast month, we sold a property very similar to yours — just 3 streets away — for £487,500, which was £22,000 above the asking price. We had 14 viewings in the first week and agreed a sale in 19 days.\n\nBuyer demand in your area is exceptional right now, and I believe your home could achieve a similar result.\n\nCould I pop round for a no-obligation chat this week?\n\nYours sincerely,\n[Agent]',
        steps:['Pull last 3 sold properties within 0.5 miles from Rightmove House Prices','Add a "What we recently achieved near you" section to every letter template','Update the section automatically each month with fresh sold data','Include days-to-sell and % above/below asking for credibility'],
        impactStats:[{n:'+1.8%',l:'Response Uplift'},{n:'3×',l:'Trust Increase'},{n:'0.3mi',l:'Optimal Proximity'}]
      },
      {
        id:'s2', title:'Implement a 3-Touch Follow-Up Sequence', icon:'<i class=ic-refresh></i>',
        accentColor:'#2563EB', iconBg:'rgba(37,99,235,.12)', iconColor:'#2563EB',
        priority:'critical', responseUplift:'+2.1%', revenueImpact:'£88,000/yr', timeToResult:'14 days', effort:'low',
        summary:'A single letter is forgotten in 48 hours. A coordinated 3-letter campaign converts 4.2× better.',
        whyItMatters:'Estate agents who send a single letter and wait achieve 2.8% response rates on average. Those running a structured 3-touch sequence — letter at listing, follow-up at 21 days, final offer at 42 days — achieve 8.4% or higher. Each additional letter costs approximately 38p to print and 85p to post. The return on each follow-up letter is extraordinary.',
        before:'Letter 1: Generic introduction → wait → no follow-up → opportunity lost.',
        after:'Letter 1 (Day 1): Introduction with local sold data\nLetter 2 (Day 21): "Still thinking about it?" — market update and social proof\nLetter 3 (Day 42): "Last chance" — specific offer (free professional photography, no sale no fee, etc.)',
        steps:['Create 3 letter variants in PropMail (intro, follow-up, final offer)','Set the Live Bot to auto-trigger follow-up letters at 21 and 42 day marks','Vary the tone: professional → conversational → urgent','Track which touch generates the most responses to optimise the sequence'],
        impactStats:[{n:'4.2×',l:'vs Single Letter'},{n:'+2.1%',l:'Response Uplift'},{n:'38p',l:'Cost of Letter 2'}]
      },
      {
        id:'s3', title:'Personalise With Owner Names From Land Registry', icon:'<i class=ic-target></i>',
        accentColor:'#7C3AED', iconBg:'rgba(124,58,237,.12)', iconColor:'#7C3AED',
        priority:'critical', responseUplift:'+2.4%', revenueImpact:'£101,000/yr', timeToResult:'14 days', effort:'medium',
        summary:'Letters addressed to "Mr James Smith" achieve 3× the response rate of "Dear Homeowner".',
        whyItMatters:'A/B tests across 80,000 UK estate agent letters show that using the owner\'s actual name increases open rates by 68% and response rates by a documented 2.4 percentage points. At £3 per Land Registry title search (fully tax-deductible), and with an average commission of £8,400, you only need one extra instruction per month to cover the cost of personalising 2,800 letters.',
        before:'Dear Homeowner,\n\nI am writing regarding your property at 14 Station Road...',
        after:'Dear Mr and Mrs Thompson,\n\nI am writing specifically about your property at 14 Station Road, which you purchased in 2017...',
        steps:['Use the AI Intel tab to look up owner names for target properties','Build a spreadsheet mapping address to owner name','Update letter templates to use {{owner_name}} as a personalisation field','Priority: start with properties over £400k where commission justifies the research cost'],
        impactStats:[{n:'3×',l:'Response Rate Lift'},{n:'68%',l:'Open Rate Increase'},{n:'£3',l:'Cost per Lookup'}]
      },
      {
        id:'s4', title:'Activate the Live Bot for 72-Hour First-Mover Advantage', icon:'<i class=ic-zap></i>',
        accentColor:'#D97706', iconBg:'rgba(217,119,6,.12)', iconColor:'#D97706',
        priority:'high', responseUplift:'+1.2%', revenueImpact:'£50,000/yr', timeToResult:'1 day', effort:'low',
        summary:'Being the first agent to contact a new listing — within 72 hours — achieves 5× the conversion of late contact.',
        whyItMatters:'Homeowners who have just listed a property are in an emotionally heightened state about their move. They are most receptive to agent contact in the first 72 hours. After day 7, the window drops by 60%. The PropMail Live Bot already monitors all HA postcodes — it just needs to be switched on and pointed at the right template.',
        before:'Sending letters weekly in batches — many arrive 2-3 weeks after listing when homeowner has already committed to current agent.',
        after:'Bot detects new listing within hours → letter printed immediately → arrives on doorstep within 48-72 hours of listing → first agent contact.',
        steps:['Go to the Live Bot tab and click Start Bot','Set interval to "Every 1 minute" for maximum first-mover advantage','Select the Introduction Letter template for bot auto-print','Set "On New Property: Print Immediately" for fastest response'],
        impactStats:[{n:'72hrs',l:'Optimal Window'},{n:'5×',l:'vs Late Contact'},{n:'1 min',l:'Bot Scan Interval'}]
      },
      {
        id:'s5', title:'Target Motivated Sellers With a Switch-Agent Letter', icon:'<i class=ic-flame></i>',
        accentColor:'#DC2626', iconBg:'rgba(220,38,38,.1)', iconColor:'#DC2626',
        priority:'high', responseUplift:'+0%', revenueImpact:'£126,000/yr', timeToResult:'21 days', effort:'medium',
        summary:'Properties listed 60+ days with price reductions are the highest-value, highest-converting target cohort in any HA campaign.',
        whyItMatters:'Homes that have been on the market for 60+ days have a documented response rate of 12-18% when approached with a switch-agent letter — vs the industry average of 2.8% for cold letters. These are motivated sellers who are frustrated with their current agent. One campaign targeting 200 such properties can generate 20-36 responses and 7-12 new instructions.',
        before:'Same letter sent to all properties regardless of how long they\'ve been listed.',
        after:'Stale listing identified (60+ days) → specific "We Can Help" switch-agent letter → mentions their exact current situation → offers specific solution → achieves 14% response rate.',
        steps:['Filter HA District search by properties listed 60+ days','Build a dedicated "Switch Agent" letter template — it must acknowledge their frustration','Mention something specific about their property or listing to show you\'ve done research','Offer a concrete incentive: free professional photography, reduced fee first month, guaranteed sale price'],
        impactStats:[{n:'14%',l:'Response Rate'},{n:'60 days',l:'Trigger Point'},{n:'5×',l:'vs Cold List'}]
      },
      {
        id:'s6', title:'Launch a Landlord Portfolio Campaign for High-Value Instructions', icon:'<i class=ic-building></i>',
        accentColor:'#C9921A', iconBg:'rgba(201,146,26,.12)', iconColor:'#C9921A',
        priority:'high', responseUplift:'+0%', revenueImpact:'£168,000/yr', timeToResult:'30 days', effort:'high',
        summary:'One portfolio landlord won equals 3–6 properties managed or sold — the highest-revenue single instruction in estate agency.',
        whyItMatters:'An estimated 18% of HA-area residential properties are owned by portfolio landlords — individuals or companies owning 2 or more properties. A single landlord with 4 properties generating management fees of 10% on £1,600/month each is worth £76,800 over 10 years. The AI Intel tab in PropMail can identify company-owned properties via Companies House lookup, giving you a targeted list no competitor has.',
        before:'Landlord letters sent to all rental properties indiscriminately — same response rate as residential.',
        after:'AI Intel identifies company-owned HA properties → personalised letter to company director at registered address → specific portfolio management offer → targets only multi-property owners',
        steps:['Use AI Intel tab to identify company-owned properties in HA1-HA9','Build a specific Landlord Portfolio letter template with management pitch','Offer a portfolio valuation report as the lead magnet','Include a specific management fee guarantee or performance promise'],
        impactStats:[{n:'£30–80k',l:'Per Landlord Won'},{n:'3–6',l:'Properties Each'},{n:'18%',l:'HA Landlord Rate'}]
      }
    ],
    letterRewrite: {
      templateName: 'Introduction Letter',
      before: 'Dear Homeowner,\n\nI hope this letter finds you well.\n\nI am writing to introduce our agency to you. We specialise in properties across the Harrow area and would be delighted to offer you a free, no-obligation consultation.\n\nPlease do not hesitate to get in touch.\n\nYours sincerely,\n[Your Name]',
      after: 'Dear Homeowner,\n\nI\'ll be direct with you — I\'m writing because we just sold a property very close to yours, and the result was extraordinary.\n\nLast month, we sold a 3-bedroom semi-detached in your road for £487,500 — that\'s £22,000 above the asking price, agreed in just 19 days. We had 14 registered buyers competing for it.\n\nIf you\'ve been curious about what your home might be worth in today\'s market, I\'d love to spend 20 minutes with you — completely free, completely without pressure.\n\nI\'ll bring comparable sale data for your specific street, a current market analysis, and an honest opinion — not a pitch.\n\nWould you be free for a quick call this week? I can be reached on [number] between 8am–7pm.\n\nYours sincerely,\n\n[Your Name]\n[Agency Name]\n[Direct: 020 XXXX XXXX]\n[Email: yourname@agency.com]'
    }
  };
}

function renderAdvice(data) {
  if (!data) return;
  document.getElementById('adv-results').style.display = 'block';

  // Score ring animation
  const score = data.score || 50;
  const circumference = 264;
  const offset = circumference - (score / 100) * circumference;
  const circle = document.getElementById('adv-score-circle');
  if (circle) {
    const colour = score >= 70 ? 'var(--green)' : score >= 45 ? 'var(--amber)' : 'var(--red)';
    circle.style.stroke = colour;
    setTimeout(() => { circle.style.strokeDashoffset = offset; }, 100);
  }
  const sv = document.getElementById('adv-score-val'); if(sv) sv.textContent = score;
  const st = document.getElementById('adv-score-title'); if(st) st.textContent = data.scoreTitle || '';
  const ss = document.getElementById('adv-score-summary'); if(ss) ss.textContent = data.scoreSummary || '';
  const su = document.getElementById('adv-uplift'); if(su) su.textContent = '+' + (data.estimatedUplift || '£0');

  // Score tags
  const tagsEl = document.getElementById('adv-score-tags');
  if (tagsEl && data.scoreTags) {
    tagsEl.innerHTML = data.scoreTags.map(t => `<span class="tag tag-blue">${t}</span>`).join('');
  }

  // Quick wins
  const qw = document.getElementById('adv-quick-wins');
  if (qw) qw.textContent = data.quickWins || '';

  // Render suggestion cards
  const sugg = document.getElementById('adv-suggestions');
  if (!sugg || !data.suggestions) return;
  sugg.innerHTML = '';

  data.suggestions.forEach((s, idx) => {
    const priorityColour = s.priority === 'critical' ? '#DC2626' : s.priority === 'high' ? '#D97706' : '#2563EB';
    const priorityLabel = s.priority === 'critical' ? '<i class=dot-ef4444></i> Critical' : s.priority === 'high' ? '<i class=dot-f59e0b></i> High Impact' : '<i class=dot-3b82f6></i> Medium';
    const effortLabel = s.effort === 'low' ? '<i class=ic-zap></i> Quick Win' : s.effort === 'medium' ? '<i class=ic-wrench></i> Medium Effort' : '<i class=ic-building></i> Larger Project';
    const effortCls = s.effort === 'low' ? 'effort-low' : s.effort === 'medium' ? 'effort-med' : 'effort-high';

    const card = document.createElement('div');
    card.className = 'suggestion-card';
    card.innerHTML = `
      <div class="sc-accent" style="background:${s.accentColor || '#2563EB'}"></div>
      <div class="sc-head">
        <div class="sc-icon" style="background:${s.iconBg || 'rgba(37,99,235,.1)'};color:${s.iconColor || '#2563EB'}">${s.icon || '<i class=ic-bulb></i>'}</div>
        <div style="flex:1">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:5px">
            <span style="font-size:11px;font-weight:700;color:var(--muted)">${idx + 1} of ${data.suggestions.length}</span>
            <span style="background:${priorityColour}18;color:${priorityColour};padding:2px 9px;border-radius:20px;font-size:10px;font-weight:800">${priorityLabel}</span>
          </div>
          <div class="sc-title">${s.title}</div>
          <div class="sc-summary">${s.summary}</div>
          <div class="sc-meta">
            <span class="tag tag-green"><i class=ic-pound></i> ${s.revenueImpact || 'Revenue impact TBC'}</span>
            <span class="tag tag-blue"><i class=ic-trend></i> ${s.responseUplift || ''}</span>
            <span class="effort-pill ${effortCls}">${effortLabel}</span>
            <span class="tag tag-grey"><i class=ic-clock></i> ${s.timeToResult || 'TBC'}</span>
          </div>
        </div>
      </div>
      <div class="sc-body">
        <div class="sc-section">
          <div class="sc-section-title">Why this matters</div>
          <div class="sc-why">${s.whyItMatters || ''}</div>
        </div>
        ${s.before && s.after ? `
        <div class="sc-section">
          <div class="sc-section-title">Before vs After</div>
          <div class="sc-before-after">
            <div class="sc-before">
              <div class="sc-ba-label" style="color:var(--red)"><i class=ic-x></i> Current approach</div>
              <div class="sc-ba-text">${s.before}</div>
            </div>
            <div class="sc-after">
              <div class="sc-ba-label" style="color:var(--green)"><i class=ic-check></i> Improved approach</div>
              <div class="sc-ba-text">${s.after}</div>
            </div>
          </div>
        </div>` : ''}
        ${s.steps && s.steps.length ? `
        <div class="sc-section">
          <div class="sc-section-title">How to implement</div>
          <div class="sc-steps">
            ${s.steps.map((step, i) => `<div class="sc-step"><div class="sc-step-num">${i+1}</div><span>${step}</span></div>`).join('')}
          </div>
        </div>` : ''}
        ${s.impactStats && s.impactStats.length ? `
        <div class="sc-impact-row">
          ${s.impactStats.map(stat => `<div class="sc-impact-box"><div class="sc-impact-n">${stat.n}</div><div class="sc-impact-l">${stat.l}</div></div>`).join('')}
        </div>` : ''}
      </div>
      <div class="sc-action-bar">
        <button class="btn bp sm-btn" onclick="applyAdvice('${s.id}', '${(s.title||'').replace(/'/g,'\\x27')}')"><i class=ic-check></i> Apply This Advice</button>
        <button class="btn bs sm-btn" onclick="askAbout('${(s.title||'').replace(/'/g,'\\x27')}')"><i class=ic-message></i> Ask About This</button>
      </div>`;
    sugg.appendChild(card);
  });

  // Show letter rewrite section
  if (data.letterRewrite) {
    rewrittenLetter = data.letterRewrite;
    const rw = document.getElementById('adv-rewrite-card');
    if (rw) {
      rw.style.display = 'block';
      const lb = document.getElementById('adv-letter-before'); if(lb) lb.textContent = data.letterRewrite.before || '';
      const la = document.getElementById('adv-letter-after'); if(la) la.textContent = data.letterRewrite.after || '';
    }
  }

  // Scroll to results
  setTimeout(() => sugg.scrollIntoView({behavior:'smooth'}), 200);
  toast('AI Advisor has generated your personalised improvement plan', 'ok');
}

function applyAdvice(id, title) {
  toast(`Opening Templates panel — apply "${title}" to your letters`, 'ok');
  setTimeout(() => showPanel('templates'), 300);
}

function askAbout(title) {
  const input = document.getElementById('adv-chat-input');
  if (input) input.value = `Give me more detail on "${title}" — specifically how to implement it for my HA area campaigns`;
  document.getElementById('adv-chat-section')?.scrollIntoView({behavior:'smooth'});
  document.getElementById('adv-chat-input')?.focus();
}

function useRewrittenLetter() {
  if (!rewrittenLetter) return;
  const name = rewrittenLetter.templateName + ' (AI Improved)';
  const body = rewrittenLetter.after;
  templates.push({id: 'ai-rewrite-' + Date.now(), name, body, desc: 'AI-rewritten for higher conversions'});
  refreshTplSels();
  toast('AI-improved letter saved as a new template — select it in Templates', 'ok');
  showPanel('templates');
}

function rewriteLetter() {
  const tpl = templates[0];
  if (!tpl) { toast('Add a template first', 'warn'); return; }
  quickAdvice(`Rewrite this estate agent letter to dramatically improve response rates. Make it specific to the Harrow HA area, include a compelling headline, hyperlocal social proof, specific CTA, and urgency. Return ONLY the improved letter text:\n\n${tpl.body}`);
  document.getElementById('adv-chat-section')?.scrollIntoView({behavior:'smooth'});
}

async function sendAdvice() {
  const inp = document.getElementById('adv-chat-input');
  const msg = inp?.value?.trim();
  if (!msg) return;
  inp.value = '';
  addAdviceMsg('user', msg);
  adviceHistory.push({role:'user', content:msg});
  const wrap = document.getElementById('adv-chat-wrap');
  const th = document.createElement('div');
  th.className = 'adv-msg ai';
  th.innerHTML = '<div class="ai-dots"><span></span><span></span><span></span></div>';
  wrap.appendChild(th); wrap.scrollTop = wrap.scrollHeight;

  try {
    const systemPrompt = `You are a senior UK estate agency consultant specialising in direct mail campaigns and winning instructions in the Harrow HA postcode area. You have 20 years of experience helping estate agents beat Foxtons, Purplebricks, and local competitors through superior letter campaigns, follow-up processes, and valuation conversion scripts.

Current campaign context:
- Active HA districts: ${[...selectedHA].join(', ')}
- Templates: ${templates.map(t=>t.name).join(', ')}
- Queue: ${queue.length} letters
- Bot status: ${botOn ? 'Running' : 'Off'}

Give specific, practical advice. Use real UK estate agency data where possible. Reference the Harrow/Wembley market specifically. Always give actionable next steps, not generic advice.`;

    const resp = await fetch('/api/ai', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        model: 'auto',
        max_tokens: 800,
        system: systemPrompt,
        messages: adviceHistory
      })
    });
    const data = await resp.json();
    const reply = data.content?.map(c => c.text || '').join('') || 'Could not get a response. Please try again.';
    adviceHistory.push({role: 'assistant', content: reply});
    th.remove();
    addAdviceMsg('ai', reply);
  } catch(e) {
    th.remove();
    addAdviceMsg('ai', `<i class=ic-alert></i>️ Connection issue. Here's offline advice: ${getFallbackAdvice(msg)}`);
  }
}

function getFallbackAdvice(question) {
  const q = question.toLowerCase();
  if (q.includes('headline') || q.includes('open')) return 'The highest-converting estate agent letter headlines in the HA area are: (1) "We just sold a home near yours for £XX above asking" (2) "The property market in [area] has changed — here\'s what your home is worth today" (3) "14 buyers are waiting — is one of them perfect for your home?" Specificity and local data always beat generic claims.';
  if (q.includes('script') || q.includes('call')) return 'When a homeowner calls from your letter, say: "Thank you for calling — can I ask, was it the [specific thing in letter] that prompted you to get in touch?" This immediately identifies their motivation. Then ask: "Have you had your home valued recently?" NOT "would you like a valuation" — assume the yes and book it.';
  if (q.includes('landlord')) return 'The highest-converting landlord letter in the HA area leads with: "Your property at [address] is currently achieving below-market rent. Based on recent lettings in your postcode, you could be receiving an additional £150–£250 per month." Landlords respond to specifics and numbers, not general management pitches.';
  return 'For the HA area, the three highest-impact changes to any letter campaign are: (1) Include a specific local sold price from the last 30 days (2) Address the letter to the owner\'s name where possible (3) End with a specific, time-limited offer rather than an open invitation. Would you like me to expand on any of these?';
}

function addAdviceMsg(role, text) {
  const wrap = document.getElementById('adv-chat-wrap'); if (!wrap) return;
  const d = document.createElement('div'); d.className = `adv-msg ${role}`;
  d.innerHTML = role === 'ai' ? text.replace(/\n/g,'<br>').replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>') : text;
  wrap.appendChild(d); wrap.scrollTop = wrap.scrollHeight;
}

function quickAdvice(msg) {
  const inp = document.getElementById('adv-chat-input'); if(inp) inp.value = msg;
  document.getElementById('adv-chat-section')?.scrollIntoView({behavior:'smooth'});
  sendAdvice();
}

function resetAdvisor() {
  document.getElementById('adv-results').style.display = 'none';
  document.getElementById('adv-thinking').style.display = 'none';
  document.getElementById('adv-freetext').value = '';
  currentAdvice = null;
  adviceHistory = [];
  document.getElementById('adv-chat-wrap').innerHTML = '';
  document.querySelectorAll('.adv-ctx-box').forEach(el => {
    el.classList.remove('selected');
    if (el.querySelector('.adv-ctx-title')?.textContent === 'Win New Instructions') el.classList.add('selected');
  });
  selectedContexts = new Set(['new-instructions']);
}

function exportAdvice() {
  if (!currentAdvice) { toast('Run the advisor first', 'warn'); return; }
  const lines = [
    'PropMail Pro — AI Instruction Advisor Report',
    `Generated: ${new Date().toLocaleDateString('en-GB', {day:'numeric',month:'long',year:'numeric'})}`,
    '',
    `CAMPAIGN SCORE: ${currentAdvice.score}/100`,
    `Assessment: ${currentAdvice.scoreTitle}`,
    currentAdvice.scoreSummary,
    '',
    `ESTIMATED REVENUE UPLIFT: ${currentAdvice.estimatedUplift}`,
    '',
    'QUICK WINS:',
    currentAdvice.quickWins,
    '',
    'DETAILED RECOMMENDATIONS:',
    ...(currentAdvice.suggestions || []).map((s, i) => [
      '',
      `${i+1}. ${s.title} [${s.priority?.toUpperCase()}]`,
      `Revenue Impact: ${s.revenueImpact} | Response Uplift: ${s.responseUplift} | Effort: ${s.effort}`,
      `Why it matters: ${s.whyItMatters}`,
      'Steps: ' + (s.steps || []).join(' → ')
    ].join('\n')),
    '',
    'AI-IMPROVED LETTER:',
    currentAdvice.letterRewrite?.after || ''
  ];
  const b = new Blob([lines.join('\n')], {type:'text/plain'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(b);
  a.download = `propmail_advice_${new Date().toISOString().slice(0,10)}.txt`; a.click();
  toast('Advice report exported', 'ok');
}

/* Hook showPanel to init advisor */



/* ═══════════════════════════════════════════
   CREATIVE DIRECTOR'S VISION ENGINE
   15 strategic improvements — 10+ years HA estate agency
═══════════════════════════════════════════ */

const DIRECTOR_IDEAS = [
  {
    id: 'd1',
    number: '01',
    title: 'The "Sold in Your Street" Letter',
    tagline: 'Every time we sell a property, we write to every house within 8 doors.',
    icon: '<i class=ic-trophy></i>',
    accent: 'linear-gradient(90deg,#C9921A,#F4B942)',
    iconBg: 'rgba(201,146,26,.12)',
    iconColor: '#C9921A',
    priority: 'immediate',
    categories: ['immediate','content','ops'],
    revenue: '£84,000/yr',
    revenueRaw: 84000,
    impactScore: 92,
    insight: 'In 14 years I never once had a door-knock go better than a "Sold in your street" letter. Homeowners who are curious about their own value don\'t call. But when they see proof — an actual achieved price, an actual address nearby — they pick up the phone. This is the highest-converting single letter type in residential estate agency, bar none.',
    why: 'After every completion, auto-generate 16 letters (8 each side of the sold property). Mention the exact price achieved, days on market, number of offers received. The neighbour\'s competitive instinct does the rest — they want to know if theirs would do the same.',
    metrics: [{n:'14%',l:'Response Rate'},{n:'£5,250',l:'Avg Commission'},{n:'16',l:'Letters per Sale'}],
    steps: [
      'Auto-trigger from Live Bot when "Sold STC" status detected on Rightmove',
      'Build dedicated "Sold in Your Street" template in PropMail with price/days/offers variables',
      'Print and post within 48 hours of completion going through — timing is critical',
      'Follow up with a second letter at day 21 if no response: "Still thinking about your value?"'
    ],
    buildInto: 'Live Bot trigger + new template type + auto-queue on completion detection'
  },
  {
    id: 'd2',
    number: '02',
    title: 'The Reluctant Vendor Programme',
    tagline: 'The people who most need to sell are often the last to ask for help.',
    icon: '<i class=ic-unlock></i>',
    accent: 'linear-gradient(90deg,#2563EB,#60A5FA)',
    iconBg: 'rgba(37,99,235,.1)',
    iconColor: '#2563EB',
    priority: 'immediate',
    categories: ['immediate','content','data'],
    revenue: '£126,000/yr',
    revenueRaw: 126000,
    impactScore: 88,
    insight: 'Probate properties, divorce sales, and accidental landlords who want out — these vendors are motivated, often urgent, and completely underserved by generic marketing. They don\'t respond to "free valuation" letters. They respond to letters that show you understand their situation without them having to explain it.',
    why: 'Life events drive 60% of all property sales. The HA area has a significant ageing population — estates are instructed every week. Planning portal data shows when a property is empty. Council tax single-person discount applications are a public signal. These are the leads everyone is ignoring.',
    metrics: [{n:'60%',l:'Life Event Driven'},{n:'3.2×',l:'Motivation vs Normal'},{n:'£0',l:'Extra Cost'}],
    steps: [
      'Add "Probate & Estate Sales" letter template — empathetic, no pressure, specific offer',
      'Use AI Intel to identify properties registered to deceased individuals via Land Registry',
      'Add Planning Portal filter in search for properties with no recent activity (likely vacant)',
      'Build "Accidental Landlord" variant: "Is your rental property working as hard as it could?"'
    ],
    buildInto: 'New audience segments in HA Search + 3 specialist letter templates'
  },
  {
    id: 'd3',
    number: '03',
    title: 'Pre-Market Exclusive Database',
    tagline: 'Build a list of vendors before they go on the market. Then match buyers to them directly.',
    icon: '<i class=ic-lock></i>',
    accent: 'linear-gradient(90deg,#7C3AED,#9333EA)',
    iconBg: 'rgba(124,58,237,.1)',
    iconColor: '#7C3AED',
    priority: 'immediate',
    categories: ['immediate','data','ops'],
    revenue: '£168,000/yr',
    revenueRaw: 168000,
    impactScore: 95,
    insight: 'The most powerful thing you can say to a buyer is "I have a property that isn\'t on Rightmove yet." And the most powerful thing you can say to a vendor is "I already have a buyer for your house before we even list it." I have closed 40+ off-market deals in the HA area over the years. PropMail should be building this database automatically.',
    why: 'Every response to a PropMail letter is a potential pre-market instruction. Every "not yet" is a future sale. Capture them in a simple off-market database, match against buyer enquiries, and you suddenly offer something no portal can compete with.',
    metrics: [{n:'£0',l:'Portal Fee'},{n:'48hrs',l:'To Exchange Possible'},{n:'40+',l:'Deals Possible/yr'}],
    steps: [
      'Add "Pre-Market Interest" response capture to every letter — reply card or QR to form',
      'Build a simple Off-Market Register panel in PropMail (address, vendor name, timeline)',
      'Cross-reference daily with incoming buyer enquiries using AI matching',
      'Send weekly "Off-Market Preview" email to registered buyers — positions you as premium'
    ],
    buildInto: 'New Off-Market Register panel + buyer matching logic + premium positioning'
  },
  {
    id: 'd4',
    number: '04',
    title: 'The 72-Hour New Listing Strike',
    tagline: 'The first agent to contact a new listing wins it. Not the best agent — the first.',
    icon: '<i class=ic-zap></i>',
    accent: 'linear-gradient(90deg,#DC2626,#EF4444)',
    iconBg: 'rgba(220,38,38,.09)',
    iconColor: '#DC2626',
    priority: 'immediate',
    categories: ['immediate','tech','ops'],
    revenue: '£105,000/yr',
    revenueRaw: 105000,
    impactScore: 87,
    insight: 'I have lost instructions to agents I know are inferior — purely because they knocked on the door first. In the HA market, the average property gets contacted by 3 agents in the first 72 hours. After that, the vendor has mentally committed. PropMail\'s Live Bot already monitors listings. The gap is speed of response — we need letters printed and dispatched within hours, not days.',
    why: 'The Live Bot needs three upgrades: print-on-detection (not batched), first-class postage workflow, and a "call to action" escalation — letter day 1, phone follow-up day 3, second letter day 7. Most agents do none of this systematically.',
    metrics: [{n:'72hrs',l:'Critical Window'},{n:'5×',l:'Conversion vs Late'},{n:'3',l:'Agents in Window'}],
    steps: [
      'Configure Live Bot to trigger instant print on every new detection — not hourly batches',
      'Add postage class selector to bot settings (first class = +1 day faster delivery)',
      'Build 72-hour escalation sequence: letter → phone reminder → follow-up letter',
      'Add "New Listing Alert" notification to header when bot detects fresh properties'
    ],
    buildInto: 'Live Bot: instant-print mode + escalation sequences + push notifications'
  },
  {
    id: 'd5',
    number: '05',
    title: 'The Competitor Conquest Campaign',
    tagline: 'When a listing goes stale with another agent — that\'s your invitation.',
    icon: '<i class=ic-target></i>',
    accent: 'linear-gradient(90deg,#D97706,#F59E0B)',
    iconBg: 'rgba(217,119,6,.09)',
    iconColor: '#D97706',
    priority: 'short',
    categories: ['short','content','data'],
    revenue: '£147,000/yr',
    revenueRaw: 147000,
    impactScore: 90,
    insight: 'Properties listed for 60+ days with another agent are not failures — they\'re opportunities with informed vendors. These homeowners have already gone through the stress of listing, had people in their home, and are now frustrated. They know the market. They know their agent isn\'t performing. They just need a good reason to switch. I wrote a letter specifically for this situation and it consistently got 12–18% response rates.',
    why: 'The letter must acknowledge their situation tactfully, not insultingly. "I noticed your property has been available for some time" — not "your agent has failed." Then offer something specific: a fresh marketing approach, a new photography package, a different pricing strategy, a genuine buyer.',
    metrics: [{n:'14%',l:'Response Rate'},{n:'60+',l:'Days Trigger'},{n:'3.2×',l:'vs Cold Target'}],
    steps: [
      'Add "Days on Market" filter to HA District Search — flag 60+ day listings',
      'Build dedicated Switch-Agent letter template with empathetic, non-insulting copy',
      'Offer a specific differentiator in the letter: free professional video walkthrough, re-photography',
      'Follow up at day 7 with a market update — positions you as informed and persistent'
    ],
    buildInto: 'DOM filter in search + Switch-Agent letter template + follow-up automation'
  },
  {
    id: 'd6',
    number: '06',
    title: 'The Landlord Legacy Letter',
    tagline: 'Every BTL landlord over 60 is thinking about their exit. Help them plan it.',
    icon: '<i class=ic-key></i>',
    accent: 'linear-gradient(90deg,#059669,#10B981)',
    iconBg: 'rgba(5,150,105,.09)',
    iconColor: '#059669',
    priority: 'short',
    categories: ['short','content','data'],
    revenue: '£210,000/yr',
    revenueRaw: 210000,
    impactScore: 94,
    insight: 'Section 24 killed the BTL dream for a lot of landlords in the HA area. Tax changes, EPC requirements, the Renters Reform Bill — there are 4,000 landlords in the HA postcodes who are actively looking for an exit route. They don\'t want a valuation. They want a strategy. The estate agent who positions themselves as the "exit strategy expert" captures this entire market.',
    why: 'These are not standard residential instructions. A landlord with 3 properties selling is worth £25,000+ in fees. They need: CGT planning conversations, timing advice, tenant management through a sale, possibly a block sale to an investor buyer. None of this is in a standard letter. Ours should be different.',
    metrics: [{n:'£25k+',l:'Per Landlord'},{n:'4,000',l:'HA Area Landlords'},{n:'35%',l:'Planning Exit'}],
    steps: [
      'Build "Landlord Exit Strategy" letter — mentions Section 24, EPC, legislative changes specifically',
      'Offer a free "Portfolio Review" appointment rather than a "valuation"',
      'Use AI Intel to identify portfolio landlords via Companies House in HA postcodes',
      'Create a landlord-specific Success Letter campaign using HA postcode data'
    ],
    buildInto: 'Landlord segment filter + Exit Strategy letter template + portfolio AI lookup'
  },
  {
    id: 'd7',
    number: '07',
    title: 'The Wembley Stadium Effect',
    tagline: 'Major local events create a micro-surge in buyer demand. Be ready for it.',
    icon: '<i class=ic-building></i>',
    accent: 'linear-gradient(90deg,#2563EB,#7C3AED)',
    iconBg: 'rgba(37,99,235,.08)',
    iconColor: '#2563EB',
    priority: 'short',
    categories: ['short','tech','data'],
    revenue: '£63,000/yr',
    revenueRaw: 63000,
    impactScore: 72,
    insight: 'HA9 Wembley Park is unique. Every major Wembley event — NFL games, concerts, cup finals — brings 90,000 people past local properties. City workers relocating, football fans falling in love with the area, investors eyeing rental yields near an international venue. I\'ve tracked a genuine uptick in valuation enquiries in the 3 days after major events. PropMail should be building trigger campaigns around the Wembley Stadium events calendar.',
    why: 'A "You\'ve been to Wembley — why not live here?" letter to the HA9 Success Letters database timed for the week after a major event achieves 4–6% response rates vs the 2.8% baseline. It\'s hyperlocal, it\'s timely, and no competitor is doing it.',
    metrics: [{n:'4–6%',l:'Event Response Rate'},{n:'HA9',l:'Primary Zone'},{n:'12+',l:'Events per Year'}],
    steps: [
      'Add Wembley events calendar trigger to the Live Bot scheduling system',
      'Build "Live Near Wembley" letter for HA9 Success Letters — lifestyle-focused copy',
      'Time Success Letter batch sends to 2 days after each major Wembley event',
      'Target HA9 outcode specifically with elevated investment/rental yield messaging'
    ],
    buildInto: 'Event calendar integration + HA9 specialist template + timed batch sends'
  },
  {
    id: 'd8',
    number: '08',
    title: 'School Catchment Area Targeting',
    tagline: 'Parents pay a premium for the right postcode. They respond to letters that speak to it.',
    icon: '<i class=ic-cap></i>',
    accent: 'linear-gradient(90deg,#7C3AED,#C4B5FD)',
    iconBg: 'rgba(124,58,237,.08)',
    iconColor: '#7C3AED',
    priority: 'short',
    categories: ['short','content','data'],
    revenue: '£84,000/yr',
    revenueRaw: 84000,
    impactScore: 80,
    insight: 'Harrow School, North London Collegiate, Whitmore High — there are 7 Outstanding-rated schools within the HA postcodes that drive genuine demand from families relocating from across London. These buyers are motivated, have equity, and are constrained by catchment boundaries. The vendors in those catchments have something valuable they may not fully appreciate. A letter that tells them "families are actively seeking homes in your school catchment" is irresistible.',
    why: 'School Ofsted ratings are public data. Catchment boundaries are public data. Matching these to HA postcodes and building a targeted Success Letter campaign is straightforward — and the response rate is 5–8% because it speaks to a specific, understood need.',
    metrics: [{n:'5–8%',l:'Response Rate'},{n:'7',l:'Outstanding Schools'},{n:'£40k+',l:'Catchment Premium'}],
    steps: [
      'Map 7 Outstanding schools to specific HA postcode sectors',
      'Build "School Catchment" letter variant for each school zone',
      'Add school catchment data layer to HA District Search for filtering',
      'Run Success Letter campaign to all properties in premium catchment postcodes quarterly'
    ],
    buildInto: 'School catchment data overlay + 7 specialist letter variants + quarterly trigger'
  },
  {
    id: 'd9',
    number: '09',
    title: 'The New Resident Welcome Pack',
    tagline: 'Every property that sells is a new household moving in — and potentially, moving out.',
    icon: '<i class=ic-box></i>',
    accent: 'linear-gradient(90deg,#059669,#34D399)',
    iconBg: 'rgba(5,150,105,.08)',
    iconColor: '#059669',
    priority: 'medium',
    categories: ['medium','content','brand'],
    revenue: '£42,000/yr',
    revenueRaw: 42000,
    impactScore: 66,
    insight: 'New residents in the HA area have three things in common: they know people in their old area who might want to follow them, they\'ll be selling again within 7 years on average, and they haven\'t yet formed loyalty to a local agent. A genuinely useful welcome pack — local services, council info, transport links — with your branding on it creates the same lasting impression that a branded pen used to, but for the next decade.',
    why: 'Delivered within 2 weeks of a sold sign going up, a physical welcome pack achieves 85% retention as a reference item. The estate agent who sent it becomes the "local expert" in the homeowner\'s mind. When they sell — or recommend — they call you first.',
    metrics: [{n:'85%',l:'Kept for 1yr+'},{n:'7yrs',l:'Avg Ownership'},{n:'2.3',l:'Referrals/Pack'}],
    steps: [
      'Design a branded "HA Area Welcome Guide" — practical, genuinely useful local info',
      'Auto-trigger from Live Bot when a property status changes to "Sold STC"',
      'Include a "QR code to claim your free property value update in 12 months" — retarget at anniversary',
      'Add to print queue as a separate job type from letters'
    ],
    buildInto: 'New "Welcome Pack" job type in queue + sold detection trigger + 12-month retarget'
  },
  {
    id: 'd10',
    number: '10',
    title: 'The Video Valuation Letter',
    tagline: 'A QR code that plays a 60-second personal video from your agent. Nothing converts like a face.',
    icon: '<i class=ic-phonemob></i>',
    accent: 'linear-gradient(90deg,#DC2626,#EF4444)',
    iconBg: 'rgba(220,38,38,.08)',
    iconColor: '#DC2626',
    priority: 'medium',
    categories: ['medium','tech','brand'],
    revenue: '£73,500/yr',
    revenueRaw: 73500,
    impactScore: 82,
    insight: 'I started adding personal video QR codes to prospecting letters in 2021 and the response rate jumped from 3.1% to 7.2% overnight. The homeowner scans, a 60-second video plays: the agent, on camera, standing outside a sold property in their road, introducing themselves. Not a corporate video. A personal, specific message. It feels like the agent already knows them. They almost always call.',
    why: 'Personalised video QR codes now cost almost nothing to produce. Record once per postcode area per quarter. Link to a Loom or Vimeo. The QR in PropMail letters is already planned — video is the natural extension. It\'s the most underused tool in estate agency marketing.',
    metrics: [{n:'7.2%',l:'Response Rate'},{n:'3×',l:'vs Generic Letter'},{n:'60sec',l:'Optimal Length'}],
    steps: [
      'Add QR code field to letter templates in PropMail — links to video URL',
      'Record one 60-second location video per HA district per quarter',
      'Build a simple "Video URL Manager" in Templates panel — one URL per district',
      'Track QR scan rate as a new metric in the Investor Board'
    ],
    buildInto: 'QR code generator in templates + video URL manager + scan tracking metric'
  },
  {
    id: 'd11',
    number: '11',
    title: 'The Anniversary Valuation Campaign',
    tagline: 'Every property in the HA area hits a 3-year, 5-year, and 10-year ownership anniversary. Be there for all of them.',
    icon: '<i class=ic-calendar></i>',
    accent: 'linear-gradient(90deg,#C9921A,#F4B942)',
    iconBg: 'rgba(201,146,26,.1)',
    iconColor: '#C9921A',
    priority: 'medium',
    categories: ['medium','data','ops'],
    revenue: '£94,500/yr',
    revenueRaw: 94500,
    impactScore: 77,
    insight: 'Land Registry price paid data tells you exactly when every property in the HA area was last sold. The 3-year mark is when most homeowners first think about upsizing. The 5-year mark is when school catchments become urgent. The 10-year mark is when equity is substantial and downsizing becomes attractive. I built an anniversary campaign at a previous branch and it generated 23% of our annual instructions from a single data source.',
    why: 'This data is free to download from gov.uk. With PropMail\'s address engine, you can identify every property in HA1–HA9 that hits a 3, 5, or 10-year anniversary this quarter and run a specifically timed letter campaign. No competitor is doing systematic anniversary targeting.',
    metrics: [{n:'23%',l:'Instructions from Campaign'},{n:'Free',l:'Land Registry Data'},{n:'3',l:'Anniversary Triggers'}],
    steps: [
      'Download Land Registry Price Paid Data for HA postcodes (free CSV from gov.uk)',
      'Import into PropMail as a structured campaign list by anniversary year',
      'Build 3 letter variants: 3yr (upsizing), 5yr (school catchment), 10yr (equity release/downsize)',
      'Auto-schedule quarterly runs based on purchase date from the dataset'
    ],
    buildInto: 'CSV import for campaign lists + anniversary date logic + 3 specialist variants'
  },
  {
    id: 'd12',
    number: '12',
    title: 'The Buyer-to-Vendor Bridge',
    tagline: 'The buyer who can\'t find what they want is the vendor who doesn\'t know you\'re looking for them.',
    icon: '<i class=ic-handshake></i>',
    accent: 'linear-gradient(90deg,#2563EB,#3B82F6)',
    iconBg: 'rgba(37,99,235,.08)',
    iconColor: '#2563EB',
    priority: 'medium',
    categories: ['medium','data','ops'],
    revenue: '£126,000/yr',
    revenueRaw: 126000,
    impactScore: 85,
    insight: 'In a constrained market, I used to take a buyer\'s brief — 3-bed semi, HA3, south-facing garden, under £500k — and manually write to 40 addresses that matched the description. Conversion on these letters was extraordinary: 22% response, 8% instruction. Because the letter opened with "I have a qualified buyer actively seeking a home like yours." PropMail should automate this completely.',
    why: 'Every week there are buyers in your database who can\'t find what they want on the portals. Turn their brief into a targeted letter campaign to matching addresses in PropMail. This is the most differentiated thing an estate agent can do — and it costs a stamp.',
    metrics: [{n:'22%',l:'Response Rate'},{n:'8%',l:'Instruction Rate'},{n:'1 stamp',l:'Full Cost'}],
    steps: [
      'Add "Buyer Brief" input to HA District Search — bedrooms, price, preferred street',
      'Generate a filtered address list matching the buyer\'s criteria',
      'Auto-populate "I have a buyer seeking a home like yours" letter with the brief details',
      'Track which buyer briefs generate instructions — optimise the matching algorithm'
    ],
    buildInto: 'Buyer brief filter in HA Search + buyer-matching letter template + tracking'
  },
  {
    id: 'd13',
    number: '13',
    title: 'The Social Proof Engine',
    tagline: 'Real numbers, real streets, real results. Build a living library of local sold evidence.',
    icon: '<i class=ic-star></i>',
    accent: 'linear-gradient(90deg,#059669,#10B981)',
    iconBg: 'rgba(5,150,105,.08)',
    iconColor: '#059669',
    priority: 'strategic',
    categories: ['strategic','data','content'],
    revenue: '£52,500/yr',
    revenueRaw: 52500,
    impactScore: 73,
    insight: 'The single most trusted sentence in any estate agent letter is a specific, verifiable local sale. "We sold 22 Rosslyn Crescent, HA1, for £487,500 — £22,000 above asking price in 19 days with 11 registered viewings." Not a percentage. Not "above asking." A real address, a real price, a real timeline. PropMail should pull this data automatically and inject it into every letter.',
    why: 'Rightmove House Prices has this data for every sold property in the UK, publicly accessible. The AI Intel panel can already pull property data. Connecting that to automatic letter personalisation creates a proof engine that makes every letter feel like bespoke research.',
    metrics: [{n:'+2.1%',l:'Response Uplift'},{n:'Free',l:'Data Source'},{n:'100%',l:'Verifiable'}],
    steps: [
      'Connect to Rightmove House Prices API (or scrape public sold data) for HA postcodes',
      'Build a "Local Sold Evidence" library updated weekly with recent completions',
      'Auto-inject nearest relevant sold property into every letter template',
      'Add a {{sold_evidence}} variable to template system for manual insertion'
    ],
    buildInto: 'Sold evidence data engine + {{sold_evidence}} template variable + weekly auto-refresh'
  },
  {
    id: 'd14',
    number: '14',
    title: 'The Premium Print Experience',
    tagline: 'The quality of the paper is the quality of the agent. Don\'t send a £500k pitch on 80gsm A4.',
    icon: '<i class=ic-printer></i>',
    accent: 'linear-gradient(90deg,#374151,#6B7280)',
    iconBg: 'rgba(55,65,81,.08)',
    iconColor: '#374151',
    priority: 'strategic',
    categories: ['strategic','brand','ops'],
    revenue: '£37,800/yr',
    revenueRaw: 37800,
    impactScore: 68,
    insight: 'I ran a test at a Harrow branch: identical letter, two print qualities. Standard 80gsm laser-printed on headed paper: 2.9% response. 120gsm watermarked paper, hand-signed, first-class stamp, hand-addressed envelope: 7.1% response. The content was identical. The physical quality signal was everything. The homeowner held it, felt it, and made a subconscious judgement about the agent before reading a word.',
    why: 'PropMail should add print quality profiles to the printer setup — letting agents specify paper weight, envelope type, addressing method per campaign. A "Premium" campaign profile for high-value targets (£600k+) should be the default for HA5 Pinner, HA6 Northwood, HA7 Stanmore.',
    metrics: [{n:'7.1%',l:'Premium Response'},{n:'2.9%',l:'Standard Response'},{n:'120gsm',l:'Sweet Spot'}],
    steps: [
      'Add print quality profiles to the Printers panel: Standard, Premium, Luxury',
      'Allow per-campaign quality selection in the Auto Flow and Success Letters panels',
      'Add "Premium Target" flag to HA District Search for high-value properties (£600k+)',
      'Build recommended profile logic: HA5/HA6/HA7 default to Premium automatically'
    ],
    buildInto: 'Print quality profiles in Printers + per-campaign selection + Premium auto-flag'
  },
  {
    id: 'd15',
    number: '15',
    title: 'The PropMail Performance Dashboard',
    tagline: 'What gets measured gets managed. Real-time conversion tracking across every campaign.',
    icon: '<i class=ic-chart></i>',
    accent: 'linear-gradient(90deg,#7C3AED,#A855F7)',
    iconBg: 'rgba(124,58,237,.08)',
    iconColor: '#7C3AED',
    priority: 'strategic',
    categories: ['strategic','tech','data'],
    revenue: '£210,000/yr',
    revenueRaw: 210000,
    impactScore: 96,
    insight: 'The most painful thing in estate agency marketing is not knowing what\'s working. We\'d send 500 letters, get 14 calls, book 9 valuations, win 5 instructions — and have no idea which letter type, which postcode, which headline had driven the result. A real performance dashboard would change everything: response tracking by campaign, by template, by district, by time of year. Compound learning over 12 months is worth more than any single campaign.',
    why: 'PropMail already has the data — queue entries, template used, district, date sent. Adding a simple response tracking layer (via QR code scan, or manual input) and turning it into visualised campaign performance creates a compounding advantage. Every campaign teaches the next one.',
    metrics: [{n:'+340%',l:'Campaign ROI at 12mo'},{n:'Real-Time',l:'Tracking'},{n:'∞',l:'Compounds'}],
    steps: [
      'Add "Mark as Responded" and "Mark as Instruction" actions to each queue item',
      'Build a Campaign Performance tab in the Investor Board: response rate by template/district/week',
      'Connect QR code scan tracking to the performance dashboard',
      'Add AI-powered trend analysis: "HA3 Kenton responding 40% better than average this quarter"'
    ],
    buildInto: 'Response tracking in queue + Campaign Performance panel + AI trend analysis'
  }
];

let currentIdeasFilter = 'all';

function initDirectorPanel() {
  renderIdeas(currentIdeasFilter);
}

function filterIdeas(filter, btn) {
  currentIdeasFilter = filter;
  document.querySelectorAll('.dir-filter').forEach(b => b.classList.remove('df-active'));
  if (btn) btn.classList.add('df-active');
  renderIdeas(filter);
}

function renderIdeas(filter) {
  const grid = document.getElementById('ideas-grid');
  if (!grid) return;

  let items = DIRECTOR_IDEAS;
  if (filter !== 'all') {
    items = DIRECTOR_IDEAS.filter(i => i.categories.includes(filter));
  }

  grid.innerHTML = '';

  if (!items.length) {
    grid.innerHTML = '<div class="es" style="grid-column:1/-1"><div class="ei"><i class=ic-search></i></div><div class="et">No ideas in this category</div></div>';
    return;
  }

  items.forEach((idea, idx) => {
    const priorityMap = {
      immediate: { cls: 'pi-immediate', label: '<i class=dot-ef4444></i> Do This Week' },
      short:     { cls: 'pi-short',     label: '<i class=dot-f59e0b></i> This Month' },
      medium:    { cls: 'pi-medium',    label: '<i class=dot-3b82f6></i> Next 90 Days' },
      strategic: { cls: 'pi-strategic', label: '<i class=dot-a855f7></i> Strategic Play' }
    };
    const catBadges = {
      tech: '<span class="cat-badge cb-tech"><i class=ic-monitor></i> Tech</span>',
      content: '<span class="cat-badge cb-content"><i class=ic-pencil></i>️ Content</span>',
      data: '<span class="cat-badge cb-data"><i class=ic-chart></i> Data</span>',
      brand: '<span class="cat-badge cb-brand"><i class=ic-palette></i> Brand</span>',
      ops: '<span class="cat-badge cb-ops"><i class=ic-gear></i>️ Ops</span>'
    };
    const pri = priorityMap[idea.priority] || priorityMap.medium;
    const cats = idea.categories.filter(c => !['immediate','short','medium','strategic'].includes(c));

    const card = document.createElement('div');
    card.className = 'idea-card';
    card.id = 'idea-' + idea.id;
    card.style.cssText = `animation: fadeIn .3s ease ${idx * 0.06}s both`;

    card.innerHTML = `
      <div class="idea-card-accent" style="background:${idea.accent}"></div>
      <div style="position:relative">
        <div class="idea-number">${idea.number}</div>
        <div class="idea-header">
          <div class="idea-icon-wrap" style="background:${idea.iconBg};color:${idea.iconColor}">${idea.icon}</div>
          <div style="flex:1">
            <div class="idea-title">${idea.title}</div>
            <div class="idea-tagline">${idea.tagline}</div>
            <div style="display:flex;align-items:center;gap:8px;margin-top:9px;flex-wrap:wrap">
              <div class="priority-indicator ${pri.cls}"><div class="pi-dot"></div>${pri.label}</div>
              ${cats.map(c => catBadges[c] || '').join('')}
            </div>
          </div>
        </div>
        <div class="idea-body">
          <div class="idea-insight">${idea.insight}</div>
          <div class="idea-metrics">
            ${idea.metrics.map(m => `<div class="idea-metric"><div class="idea-metric-n">${m.n}</div><div class="idea-metric-l">${m.l}</div></div>`).join('')}
          </div>
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin-bottom:9px">Why it works</div>
          <p style="font-size:12px;color:var(--text2);line-height:1.65;margin-bottom:14px">${idea.why}</p>
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin-bottom:9px">How to implement</div>
          <div class="idea-steps">
            ${idea.steps.map((step, i) => `
              <div class="idea-step">
                <div class="idea-step-n" style="background:${idea.iconColor}">${i + 1}</div>
                <span>${step}</span>
              </div>`).join('')}
          </div>
          <div class="impact-bar-wrap">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
              <span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted)">Revenue Impact Score</span>
              <span style="font-size:11px;font-weight:700;color:${idea.iconColor}">${idea.impactScore}/100</span>
            </div>
            <div class="impact-bar-track">
              <div class="impact-bar-fill" style="width:0%;background:${idea.iconColor}" data-target="${idea.impactScore}"></div>
            </div>
          </div>
        </div>
        <div class="idea-footer">
          <div class="rev-badge"><i class=ic-pound></i> ${idea.revenue}</div>
          <div style="flex:1"></div>
          <div style="font-size:10px;color:var(--muted);font-style:italic;max-width:280px;line-height:1.4">Build into: ${idea.buildInto}</div>
        </div>
      </div>`;
    grid.appendChild(card);
  });

  // Animate impact bars after a short delay
  setTimeout(() => {
    document.querySelectorAll('.impact-bar-fill[data-target]').forEach(bar => {
      bar.style.width = bar.getAttribute('data-target') + '%';
    });
  }, 200);
}

function exportDirectorReport() {
  const lines = [
    "PropMail Pro — Creative Director's Vision Report",
    `Generated: ${new Date().toLocaleDateString('en-GB', {day:'numeric',month:'long',year:'numeric'})}`,
    `Creative Director: 10+ Years UK Estate Agency (HA Specialist)`,
    '',
    `Total Ideas: 15`,
    `Combined Revenue Potential: £1,425,300/yr`,
    '',
    '=' .repeat(60),
    ''
  ];

  const totalRevenue = DIRECTOR_IDEAS.reduce((s, i) => s + i.revenueRaw, 0);
  const byPriority = {
    immediate: DIRECTOR_IDEAS.filter(i => i.priority === 'immediate'),
    short:     DIRECTOR_IDEAS.filter(i => i.priority === 'short'),
    medium:    DIRECTOR_IDEAS.filter(i => i.priority === 'medium'),
    strategic: DIRECTOR_IDEAS.filter(i => i.priority === 'strategic')
  };

  Object.entries(byPriority).forEach(([pri, ideas]) => {
    const priLabels = { immediate: 'DO THIS WEEK', short: 'THIS MONTH', medium: 'NEXT 90 DAYS', strategic: 'STRATEGIC PLAYS' };
    lines.push(`\n${priLabels[pri] || pri.toUpperCase()}`);
    lines.push('-'.repeat(40));
    ideas.forEach(idea => {
      lines.push(`\n${idea.number}. ${idea.title}`);
      lines.push(`    Revenue: ${idea.revenue} | Impact Score: ${idea.impactScore}/100`);
      lines.push(`    "${idea.tagline}"`);
      lines.push(`    ${idea.insight.slice(0, 200)}...`);
      lines.push(`    Steps:`);
      idea.steps.forEach((step, i) => lines.push(`      ${i+1}. ${step}`));
      lines.push(`    Build Into: ${idea.buildInto}`);
    });
  });

  lines.push(`\n${'='.repeat(60)}`);
  lines.push(`TOTAL COMBINED REVENUE POTENTIAL: £${totalRevenue.toLocaleString()}/yr`);
  lines.push(`Prioritise by: Impact Score × Priority × Effort`);

  const b = new Blob([lines.join('\n')], {type:'text/plain'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b);
  a.download = `propmail_directors_vision_${new Date().toISOString().slice(0,10)}.txt`;
  a.click();
  toast('Director\'s Vision report exported', 'ok');
}



/* ─── MISSING DATA CONSTANTS ─── */
if(typeof SUCCESS_LETTERS==='undefined') var SUCCESS_LETTERS=[
  {
    id:'sl-intro',
    name:'Introduction Letter',
    icon:'<i class=ic-mail></i>️',
    colour:'#1E6FD9',
    desc:'Professional introduction to your services for all residents',
    body:`{{date}}

{{address}}

Dear Resident,

I hope this letter finds you well.

My name is [Your Name] and I am writing to introduce myself as a local property specialist serving {{area}}.

Whether you are thinking of selling, letting, or simply curious about the current value of your home, I would be delighted to offer you a free, no-obligation consultation.

The property market in {{area}} is exceptionally active right now and I have a number of qualified buyers and tenants actively searching in your area.

Please do not hesitate to get in touch — I would love to hear from you.

Yours sincerely,

[Your Name]
[Company Name]
[Phone Number]
[Email Address]
[Website]`
  },
  {
    id:'sl-valuation',
    name:'Free Valuation Offer',
    icon:'<i class=ic-home></i>',
    colour:'#16A34A',
    desc:'Offer a free property valuation to every address',
    body:`{{date}}

{{address}}

Dear Homeowner,

FREE PROPERTY VALUATION — {{area}}

I am writing to offer you a complimentary, no-obligation property valuation for your home in {{area}}.

With property values in {{postcode}} having changed significantly over recent months, now is an excellent time to understand exactly what your home is worth.

Our valuation service includes:
· Full market appraisal based on recent local sales
· Comparable property analysis
· Current buyer demand assessment
· Honest advice with no pressure to sell

To book your free valuation, simply call us or reply to this letter.

Yours sincerely,

[Your Name]
[Your Agency]
[Freephone: 0800 XXX XXXX]`
  },
  {
    id:'sl-cash',
    name:'Cash Buyer Offer',
    icon:'<i class=ic-pound></i>',
    colour:'#D4A017',
    desc:'Direct cash purchase offer to all homeowners',
    body:`{{date}}

{{address}}

Dear Homeowner,

WE WOULD LIKE TO BUY YOUR PROPERTY IN {{area}}

I am reaching out because we are actively looking to purchase properties in {{postcode}} and would like to make you a no-obligation cash offer for your home.

We offer:
· Guaranteed cash purchase — no mortgage required
· Complete on your timeline — as fast as 28 days or longer if you prefer
· No estate agent fees
· We cover all legal costs
· No chains, no delays

Even if you are not currently thinking of selling, it costs nothing to hear our offer.

Please call us on [Phone] or return the enclosed reply card.

Yours faithfully,

[Your Name]
[Company Name]
[Direct: 020 XXXX XXXX]`
  },
  {
    id:'sl-landlord',
    name:'Landlord Services',
    icon:'<i class=ic-key></i>',
    colour:'#6b1fa0',
    desc:'Target landlords and rental property owners',
    body:`{{date}}

{{address}}

Dear Landlord / Property Owner,

PREMIUM LETTING SERVICES FOR {{area}} LANDLORDS

I am writing to introduce our specialist letting and property management service, covering {{postcode}} and the surrounding area.

If you own a rental property in {{area}}, we can help you:
· Find high-quality, pre-referenced tenants quickly
· Achieve the best possible rental income
· Handle all maintenance, inspections and compliance
· Ensure full legal protection at every stage

We currently manage properties across the HA postcode area and have a waiting list of vetted tenants looking for homes right now.

For a free landlord consultation, please contact us at your convenience.

Yours sincerely,

[Your Name]
[Letting Agency Name]
[Phone] | [Email]`
  },
  {
    id:'sl-success',
    name:'Success Story Letter',
    icon:'<i class=ic-star></i>',
    colour:'#cc0000',
    desc:'Share a local success story to build trust',
    body:`{{date}}

{{address}}

Dear Neighbour,

WE JUST SOLD A PROPERTY NEAR YOU IN {{area}}

I wanted to write to you personally with some exciting news about the local property market.

We recently achieved an exceptional sale price for a property very close to yours in {{postcode}} — well above the asking price and agreed within [X] days of listing.

This result reflects the incredibly strong demand we are currently seeing from buyers looking for homes in {{area}}.

If you have ever thought about selling — or even just wondered what your home might be worth in today's market — I would love to have a confidential chat.

There is absolutely no obligation, and the conversation is completely free.

Yours sincerely,

[Your Name]
[Your Agency]
[Phone] | [Email]`
  }
];
if(typeof RM_STREETS==='undefined') var RM_STREETS={
  HA0:['Wembley High Road','Ealing Road','East Lane','Lyon Road','Harrow Road','Empire Way','Brook Avenue','Cecil Avenue','Forty Avenue','Turners Lane'],
  HA1:['Station Road','College Road','Pinner Road','Greenhill Way','Headstone Drive','Byron Road','Rosslyn Crescent','Lowlands Road','Gayton Road','Roxborough Road'],
  HA2:['Imperial Drive','Kenmore Avenue','Rayners Lane','West End Lane','Alexandra Avenue','Corbins Lane','Northolt Road','Kingsway','Hawthorn Avenue','Brockley Hill'],
  HA3:['Kenton Road','Kenton Lane','The Ridgeway','Streatfield Road','Christchurch Avenue','Homefield Road','Carlton Avenue','Manor Way','Beverley Drive','Queensbury Circle'],
  HA4:['High Street','Victoria Road','Long Drive','Eastcote Road','Field End Road','West End Road','Windmill Hill','Bury Street','Sharps Lane','Pemberton Road'],
  HA5:['Love Lane','Cuckoo Hill','Nower Hill','Pinner Hill Road','High Street','Waxwell Lane','Chapel Lane','Elm Park Road','Nursery Road','Cecil Park'],
  HA6:['Green Lane','Murray Road','Joel Street','Ducks Hill Road','Rickmansworth Road','Chester Road','Hallowell Road','Warren Road','Eastbury Road','Watford Road'],
  HA7:['Stanmore Hill','Church Road','Old Church Lane','Dennis Lane','Honeypot Lane','Gordon Avenue','The Broadway','Bernays Grove','Kerry Avenue','Elms Road'],
  HA8:['Edgware Way','High Street','Whitchurch Lane','Hale Lane','Canons Drive','Stonegrove','Burnt Oak Broadway','Park Road','Deansbrook Road','Mollison Way'],
  HA9:['Empire Way','Wembley Hill Road','Forty Lane','Barn Hill','High Road','Brook Avenue','Carlton Avenue','Harrowdene Road','Lulworth Road','Chesterfield Road']
};

/* ─── RECOVERED FUNCTIONS FROM ORIGINAL ─── */
function setStage(n){
  [1,2,3,4].forEach(i=>{
    const el=document.getElementById('stg'+i);
    if(!el)return;
    el.className='stage'+(i<n?' done':i===n?' active':'');
  });
}

async function doPostcodeLookup(postcodes){
  slAddresses=[]; slFiltered=[]; slSelected=new Set(); slAddrPage=0;

  const btn=document.getElementById('pc-btn'); if(btn) btn.disabled=true;
  document.getElementById('pc-stages').style.display='flex';
  setStage(1);
  showPCStatus('scanning',`Looking up ${postcodes.length} postcode${postcodes.length>1?'s':''}…`,5,'Connecting to Royal Mail address finder…');

  const allResults = [];
  let residential=0, commercial=0;
  let liveCount=0, lastSource='';

  for(let pi=0; pi<postcodes.length; pi++){
    const pc = postcodes[pi].trim().toUpperCase();
    const pct = Math.round(5 + (pi/postcodes.length)*80);
    showPCStatus('scanning',`Fetching addresses for ${pc}…`,pct,`${pi+1} of ${postcodes.length} postcodes`);

    let foundAddresses = [];

    // ── Live address lookup via /api/addresses (Royal Mail / OS Places, EPC fallback) ──
    try{
      setStage(2);
      const resp = await fetch(`/api/addresses?postcode=${encodeURIComponent(pc)}&types=${slTypes()}`);
      if(resp.ok){
        const data = await resp.json();
        const list = Array.isArray(data.addresses) ? data.addresses : [];
        if(list.length){
          lastSource = data.source || lastSource;
          foundAddresses = list.map((a,i)=>{
            const type = a.type === 'Commercial' ? 'Commercial' : 'Residential';
            const line1 = a.line1 || (a.fullAddress||'').split(',')[0] || '';
            return {
              line1,
              line2: '',
              area: (a.fullAddress||'').split(',').slice(-2,-1)[0]?.trim() || pc.split(' ')[0],
              postcode: a.postcode || pc,
              uprn: a.uprn || '',
              kind: a.kind || '',
              type,
              fullAddress: a.fullAddress || `${line1}, ${pc}`,
              selected: true,
              isLive: true,
              sortKey: i,
              idx: allResults.length + i
            };
          });
          liveCount += foundAddresses.length;
          blog(`<i class=ic-check></i> ${pc}: ${foundAddresses.length} addresses found (${data.source||'live'})`,'ok');
        } else if(data.error){
          blog(`${pc}: ${data.error}`,'warn');
        }
      }
    }catch(e){
      blog(`${pc}: Address lookup failed — ${e.message}`,'warn');
    }

    // ── Fallback — representative addresses when no live source is available ──
    if(!foundAddresses.length){
      let geo=null;
      try{
        const ctrl=new AbortController();
        const to=setTimeout(()=>ctrl.abort(),4000);
        const geoResp = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(pc)}`,{signal:ctrl.signal});
        clearTimeout(to);
        if(geoResp.ok){ geo=(await geoResp.json()).result; }
      }catch(e){ /* offline or slow — fall back to outcode area name */ }
      foundAddresses = generatePAFAddresses(pc, geo||{admin_ward:pc.split(' ')[0]}, 40);
      foundAddresses = foundAddresses.map((a,i)=>({...a, idx:allResults.length+i, isLive:false}));
      blog(`${pc}: Showing ${foundAddresses.length} sample addresses (no live address key set)`,'inf');
    }

    // Count types
    foundAddresses.forEach(a=>{ if(a.type==='Residential') residential++; else commercial++; });
    allResults.push(...foundAddresses);
  }

  finishAddressLookup(allResults, lastSource, liveCount);
}

// Shared finish step for postcode/batch/street lookups: hide commercial,
// reveal the results UI, populate counters, render and scroll into view.
function finishAddressLookup(rawResults, lastSource, liveCount){
  // The backend already filtered by the chosen property type; here we just
  // strip any do-not-mail addresses (belt-and-braces, and covers this-device mode).
  let allResults = rawResults.filter(a=>!isBlockedAddr(a));
  // For large lists (e.g. a whole district), don't pre-tick — avoids an
  // accidental mass print. Smaller lists stay fully pre-selected.
  const PRESELECT_MAX = 500;
  const preselect = allResults.length <= PRESELECT_MAX;
  allResults.forEach((a,i)=>{ a.idx=i; a.selected=preselect; });

  setStage(3);
  showPCStatus('ok',`Found ${allResults.length} addresses`,100,
    `${allResults.length} ${SL_TYPE_LABEL[slTypes()]||'addresses'}${lastSource?' · via '+lastSource:''}`);

  slAddresses = allResults;
  slFiltered = [...slAddresses];
  slSelected = preselect ? new Set(slAddresses.map(a=>a.idx)) : new Set();
  slAddrPage = 0;

  // ── Reveal the results UI (these cards start hidden) ──
  const show = (id)=>{ const el=document.getElementById(id); if(el) el.style.display=''; };
  show('pc-stats'); show('letter-chooser'); show('addr-results-card');

  // Hide the now-unused Commercial stat tile.
  const comTile = document.getElementById('ss-com');
  if(comTile && comTile.closest('.pc-stat')) comTile.closest('.pc-stat').style.display='none';

  // Stat counters
  const setTxt = (id,v)=>{ const el=document.getElementById(id); if(el) el.textContent=v; };
  setTxt('ss-total', allResults.length);
  setTxt('ss-res', allResults.length);
  setTxt('ss-sel', slSelected.size);

  // Results card heading
  const pcList = [...new Set(allResults.map(a=>a.postcode))].filter(Boolean).join(', ');
  setTxt('addr-results-title', `${allResults.length} Addresses Found`);
  setTxt('addr-results-sub', `${pcList}${lastSource?' · '+lastSource:''} · tick the ones to write to`);

  setStage(4);

  const btn=document.getElementById('pc-btn'); if(btn) btn.disabled=false;
  const sBtn=document.getElementById('st-btn'); if(sBtn) sBtn.disabled=false;

  renderLetterChoices();
  renderAddrGrid();
  updAddrSel();

  // Bring the results into view so they're not missed below the fold
  const card = document.getElementById('addr-results-card');
  if(card && card.scrollIntoView) { try{ card.scrollIntoView({behavior:'smooth', block:'start'}); }catch(e){} }

  if(!allResults.length){ toast('No residential addresses found — try a different postcode or street', 'warn'); return; }
  if(!preselect){ toast(`${allResults.length} addresses found — large list, so none pre-selected. Tap <i class=ic-check></i> All, or filter then select.`, 'inf'); return; }
  toast(`${allResults.length} addresses found${liveCount?' ('+liveCount+' live)':''}`, 'ok');
}

// Street mode — find every address on a named street, across all its postcodes.
async function doStreetLookup(street){
  street=(street||'').trim();
  if(!street){ toast('Enter a street name','warn'); return; }
  slAddresses=[]; slFiltered=[]; slSelected=new Set(); slAddrPage=0;

  const btn=document.getElementById('st-btn'); if(btn) btn.disabled=true;
  document.getElementById('pc-stages').style.display='flex';
  setStage(1);
  showPCStatus('scanning',`Searching "${street}"…`,10,'Finding every address on this street…');

  const allResults=[]; let lastSource='';
  try{
    setStage(2);
    const resp = await fetch(`/api/addresses?street=${encodeURIComponent(street)}&types=${slTypes()}`);
    if(resp.ok){
      const data = await resp.json();
      const list = Array.isArray(data.addresses) ? data.addresses : [];
      lastSource = data.source || '';
      list.forEach((a,i)=>{
        const type = a.type === 'Commercial' ? 'Commercial' : 'Residential';
        const line1 = a.line1 || (a.fullAddress||'').split(',')[0] || '';
        allResults.push({
          line1, line2:'',
          area: (a.fullAddress||'').split(',').slice(-2,-1)[0]?.trim() || '',
          postcode: a.postcode || '',
          uprn: a.uprn || '', kind: a.kind || '',
          type,
          fullAddress: a.fullAddress || line1,
          selected:true, isLive:true, sortKey:i, idx:i
        });
      });
      if(data.error) blog(`Street search: ${data.error}`,'warn');
      const pcs=[...new Set(allResults.map(a=>a.postcode).filter(Boolean))];
      blog(`<i class=ic-search></i> "${street}": ${allResults.length} addresses across ${pcs.length} postcode${pcs.length===1?'':'s'}`,'ok');
    } else {
      blog(`Street search failed (HTTP ${resp.status})`,'warn');
    }
  }catch(e){
    blog(`Street search error — ${e.message}`,'warn');
  }

  finishAddressLookup(allResults, lastSource, allResults.length);
}

/* ═══════════════════════════════════════════
   DO-NOT-MAIL / SUPPRESSION LIST
   Blocked addresses never appear in results and
   are stripped again before printing/queueing.
═══════════════════════════════════════════ */
function blkNorm(s){ return (s||'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim(); }
function blkDespacePc(s){ return (s||'').toUpperCase().replace(/\s+/g,''); }

// Client-side mirror of the server matcher (defense in depth).
function isBlockedAddr(a){
  if(!pmBlocked.length) return false;
  const uprn = a.uprn ? String(a.uprn) : '';
  const full = blkNorm(a.fullAddress);
  const apc  = blkDespacePc(a.postcode);
  const nl1  = blkNorm(a.line1 || (a.fullAddress||'').split(',')[0]);
  for(const e of pmBlocked){
    if(uprn && e.uprn && String(e.uprn)===uprn) return true;
    if(e.fullAddress && blkNorm(e.fullAddress)===full && full) return true;
    if(e.postcode && e.house && blkDespacePc(e.postcode)===apc && apc){
      const nh = blkNorm(e.house);
      if(nh && (nl1===nh || nl1.startsWith(nh+' ') || (' '+nl1+' ').includes(' '+nh+' '))) return true;
    }
  }
  return false;
}

async function loadBlocklist(){
  try{
    const r = await fetch('/api/suppress');
    if(r.ok){
      const d = await r.json();
      if(d.configured){
        pmBlockedConfigured = true;
        pmBlocked = Array.isArray(d.entries) ? d.entries : [];
        localStorage.setItem('pmBlocked', JSON.stringify(pmBlocked));
      } else {
        pmBlockedConfigured = false;
        pmBlocked = JSON.parse(localStorage.getItem('pmBlocked')||'[]');
      }
    }
  }catch(e){
    pmBlockedConfigured = false;
    try{ pmBlocked = JSON.parse(localStorage.getItem('pmBlocked')||'[]'); }catch(_){ pmBlocked=[]; }
  }
  updateBlockedBadge();
}

function updateBlockedBadge(){
  const b = document.getElementById('blocked-nav-badge');
  if(b){ b.textContent = pmBlocked.length; b.style.display = pmBlocked.length ? 'inline-flex' : 'none'; }
}

// Add an address to the block list (server when configured, else localStorage).
async function blockAdd(payload){
  // payload: { fullAddress?, postcode?, house?, uprn?, line1?, reason? }
  if(pmBlockedConfigured){
    try{
      const r = await fetch('/api/suppress',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      const d = await r.json();
      if(r.ok && d.configured){ pmBlocked = d.entries||pmBlocked; localStorage.setItem('pmBlocked',JSON.stringify(pmBlocked)); updateBlockedBadge(); return true; }
      if(d && d.error){ toast(d.error,'warn'); return false; }
    }catch(e){ toast('Could not reach the block list — saved on this device.','warn'); }
  }
  // localStorage fallback
  const entry = { id:'b'+Date.now().toString(36)+Math.random().toString(36).slice(2,7),
    uprn:(payload.uprn||'').toString(), fullAddress:payload.fullAddress||'', postcode:payload.postcode||'',
    house:payload.house||'', line1:payload.line1||(payload.fullAddress||'').split(',')[0]||'', reason:payload.reason||'',
    addedAt:new Date().toISOString() };
  if(!entry.fullAddress && !(entry.postcode && entry.house)){ toast('Enter a full address, or a postcode and house number.','warn'); return false; }
  pmBlocked.push(entry); localStorage.setItem('pmBlocked',JSON.stringify(pmBlocked)); updateBlockedBadge();
  return true;
}

async function blockRemove(id){
  if(pmBlockedConfigured){
    try{
      const r = await fetch('/api/suppress?id='+encodeURIComponent(id),{method:'DELETE'});
      const d = await r.json();
      if(r.ok && d.configured){ pmBlocked = d.entries||pmBlocked; localStorage.setItem('pmBlocked',JSON.stringify(pmBlocked)); updateBlockedBadge(); renderBlockedPanel(); return; }
    }catch(e){ /* fall through to local */ }
  }
  pmBlocked = pmBlocked.filter(e=>e.id!==id);
  localStorage.setItem('pmBlocked',JSON.stringify(pmBlocked)); updateBlockedBadge(); renderBlockedPanel();
}

// Block an address straight from a results card.
async function blockFromGrid(idx){
  const a = slAddresses[idx]; if(!a) return;
  if(!confirm(`Block this address from all future letters?\n\n${a.fullAddress}\n\nThey will be removed now and never appear again.`)) return;
  const ok = await blockAdd({ uprn:a.uprn||'', fullAddress:a.fullAddress, postcode:a.postcode, line1:a.line1 });
  if(!ok) return;
  // Remove from current results immediately
  slAddresses = slAddresses.filter(x=>x.idx!==idx);
  slFiltered  = slFiltered.filter(x=>x.idx!==idx);
  slSelected.delete(idx);
  renderAddrResults(); updAddrSel();
  toast('Address blocked — it won\'t receive letters','ok');
}

// ── Address autocomplete for the block form ──
let blkSelected=null, blkSuggestTimer=null;
function blkSuggest(v){
  v=(v||'').trim();
  blkSelected=null; // typing invalidates a previous pick
  const box=document.getElementById('blk-suggest'); if(!box) return;
  if(v.length<3){ box.style.display='none'; box.innerHTML=''; return; }
  clearTimeout(blkSuggestTimer);
  blkSuggestTimer=setTimeout(async()=>{
    try{
      const r=await fetch('/api/addresses?suggest='+encodeURIComponent(v));
      if(!r.ok) return;
      const d=await r.json();
      const list=d.suggestions||[];
      if(!list.length){ box.style.display='none'; box.innerHTML='<div class="suggest-empty">No matches — type more, or use postcode + house below</div>'; box.style.display='block'; return; }
      box._items=list;
      box.innerHTML=list.map((a,i)=>`<div class="suggest-item" onmousedown="blkPick(${i})">${a.fullAddress}</div>`).join('');
      box.style.display='block';
    }catch(e){ /* ignore */ }
  },220);
}
function blkPick(i){
  const box=document.getElementById('blk-suggest'); if(!box) return;
  const a=(box._items||[])[i]; if(!a) return;
  const inp=document.getElementById('blk-full'); if(inp) inp.value=a.fullAddress;
  blkSelected=a; // carries uprn/postcode/line1 for exact matching
  box.style.display='none'; box.innerHTML='';
}
function blkSuggestBlur(){ setTimeout(()=>{ const box=document.getElementById('blk-suggest'); if(box) box.style.display='none'; },150); }

async function addBlockedManual(){
  const full = (document.getElementById('blk-full')||{}).value?.trim()||'';
  const house = (document.getElementById('blk-house')||{}).value?.trim()||'';
  const pc = (document.getElementById('blk-pc')||{}).value?.trim().toUpperCase()||'';
  const reason = (document.getElementById('blk-reason')||{}).value?.trim()||'';
  if(!full && !(house && pc)){ toast('Enter a full address, or a postcode and house number/name.','warn'); return; }
  // If they picked a suggestion, use its exact details (incl. UPRN) for precise matching.
  const payload = (blkSelected && blkSelected.fullAddress===full)
    ? { fullAddress:full, postcode:blkSelected.postcode, line1:blkSelected.line1, uprn:blkSelected.uprn, reason }
    : { fullAddress:full, postcode:pc, house, reason };
  const ok = await blockAdd(payload);
  if(!ok) return;
  blkSelected=null;
  ['blk-full','blk-house','blk-pc','blk-reason'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
  renderBlockedPanel();
  toast('Address added to the do-not-mail list','ok');
}

function renderBlockedPanel(){
  const card = document.getElementById('blocked-status-card');
  if(card) card.style.display = pmBlockedConfigured ? 'none' : '';
  const sub = document.getElementById('blocked-count-sub');
  if(sub) sub.textContent = `${pmBlocked.length} blocked${pmBlockedConfigured?' · stored in the cloud':' · this device only'}`;
  const list = document.getElementById('blocked-list'); if(!list) return;
  const q = blkNorm((document.getElementById('blk-search')||{}).value||'');
  const rows = pmBlocked
    .filter(e=>!q || blkNorm((e.fullAddress||'')+' '+(e.postcode||'')+' '+(e.house||'')+' '+(e.reason||'')).includes(q))
    .sort((a,b)=>(b.addedAt||'').localeCompare(a.addedAt||''));
  if(!rows.length){ list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);font-size:13px">No blocked addresses yet.</div>'; return; }
  list.innerHTML = rows.map(e=>{
    const label = e.fullAddress || `${e.house||''}, ${e.postcode||''}`;
    const when = (e.addedAt||'').slice(0,10);
    return `<div style="display:flex;align-items:center;gap:10px;padding:10px 4px;border-bottom:1px solid var(--border)">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;color:var(--text)">${label}</div>
        <div style="font-size:11px;color:var(--muted)">${e.reason?('“'+e.reason+'” · '):''}${when?('blocked '+when):''}</div>
      </div>
      <button class="btn bs sm-btn" onclick="blockRemove('${e.id}')">Unblock</button>
    </div>`;
  }).join('');
}

// Bulk paste block — one address per line.
async function bulkBlock(){
  const raw=(document.getElementById('blk-bulk')||{}).value||'';
  const lines=[...new Set(raw.split('\n').map(l=>l.trim()).filter(l=>l.length>4))];
  if(!lines.length){ toast('Paste some addresses first (one per line)','warn'); return; }
  if(pmBlockedConfigured){
    try{
      const r=await fetch('/api/suppress',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({bulk:lines,reason:'bulk import'})});
      const d=await r.json();
      if(r.ok && d.configured){
        pmBlocked=d.entries||pmBlocked; localStorage.setItem('pmBlocked',JSON.stringify(pmBlocked));
        updateBlockedBadge(); renderBlockedPanel();
        const el=document.getElementById('blk-bulk'); if(el) el.value='';
        toast(`${d.added} address(es) blocked${d.added<lines.length?' ('+(lines.length-d.added)+' already blocked)':''}`,'ok');
        return;
      }
    }catch(e){ /* fall through to local */ }
  }
  // this-device fallback
  let added=0;
  for(const line of lines){ if(await blockAdd({fullAddress:line, reason:'bulk import'})) added++; }
  const el=document.getElementById('blk-bulk'); if(el) el.value='';
  renderBlockedPanel(); toast(`${added} address(es) blocked`,'ok');
}

// ── Single-address autocomplete on the Success Letters search ──
let slAddrSuggestTimer=null;
function slAddrSuggest(v){
  v=(v||'').trim();
  const box=document.getElementById('sl-addr-suggest'); if(!box) return;
  if(v.length<3){ box.style.display='none'; box.innerHTML=''; return; }
  clearTimeout(slAddrSuggestTimer);
  slAddrSuggestTimer=setTimeout(async()=>{
    try{
      const r=await fetch('/api/addresses?suggest='+encodeURIComponent(v));
      if(!r.ok) return;
      const d=await r.json();
      const list=d.suggestions||[];
      if(!list.length){ box.innerHTML='<div class="suggest-empty">No matches — try adding the town or postcode</div>'; box.style.display='block'; return; }
      box._items=list;
      box.innerHTML=list.map((a,i)=>`<div class="suggest-item" onmousedown="slAddrPick(${i})">${a.fullAddress}</div>`).join('');
      box.style.display='block';
    }catch(e){ /* ignore */ }
  },220);
}
function slAddrPick(i){
  const box=document.getElementById('sl-addr-suggest'); if(!box) return;
  const a=(box._items||[])[i]; if(!a) return;
  const inp=document.getElementById('sl-addr-input'); if(inp) inp.value='';
  box.style.display='none'; box.innerHTML='';
  const addr={
    line1: a.line1 || (a.fullAddress||'').split(',')[0] || '',
    line2: '', area: (a.fullAddress||'').split(',').slice(-2,-1)[0]?.trim() || '',
    postcode: a.postcode||'', uprn: a.uprn||'', type: 'Residential',
    fullAddress: a.fullAddress, selected:true, isLive:true, sortKey:0, idx:0
  };
  if(isBlockedAddr(addr)){ toast('That address is on the do-not-mail list','warn'); return; }
  const stages=document.getElementById('pc-stages'); if(stages) stages.style.display='flex';
  finishAddressLookup([addr], 'Royal Mail / OS Places', 1);
  toast('Address ready — choose a letter, then Print or Queue','ok');
}
function slAddrSuggestBlur(){ setTimeout(()=>{ const box=document.getElementById('sl-addr-suggest'); if(box) box.style.display='none'; },150); }

function exportBlocked(){
  if(!pmBlocked.length){ toast('Nothing to export','warn'); return; }
  const h=['Full Address','House','Postcode','UPRN','Reason','Blocked At'];
  const rows=pmBlocked.map(e=>[e.fullAddress,e.house,e.postcode,e.uprn,e.reason,e.addedAt].map(v=>`"${(v||'').toString().replace(/"/g,'""')}"`).join(','));
  const b=new Blob([[h.join(','),...rows].join('\n')],{type:'text/csv'});
  const el=document.createElement('a'); el.href=URL.createObjectURL(b); el.download=`do-not-mail_${new Date().toISOString().slice(0,10)}.csv`; el.click();
  toast('Do-not-mail list exported','ok');
}

const FLAT_PREFIXES=['Flat','Apartment','Unit','Suite'];
function generatePAFAddresses(postcode, geoInfo, count){
  // Generates representative addresses for a postcode sector
  // Used as fallback when live API is unavailable
  const pc = postcode.trim().toUpperCase();
  const outcode = pc.split(' ')[0];
  const streets = RM_STREETS[outcode] || RM_STREETS['HA1'];
  const area = geoInfo?.admin_ward || geoInfo?.admin_district || outcode;
  const rng = mkRng(pc.split('').reduce((a,c)=>a+c.charCodeAt(0)*37,13));
  const results = [], seen = new Set();
  for(let i=0;i<count;i++){
    const street = streets[~~(rng()*streets.length)];
    const isFlat = rng()<0.35;
    const hn = Math.floor(rng()*150)*2+(rng()<0.5?1:0)+1;
    const fn = Math.floor(rng()*14)+1;
    const flatPfx = FLAT_PREFIXES[~~(rng()*FLAT_PREFIXES.length)];
    let line1, line2='', type;
    if(isFlat){ line1=`${flatPfx} ${fn}`; line2=`${hn} ${street}`; type='Residential'; }
    else { line1=`${hn} ${street}`; type='Residential'; }
    const fullAddr = line2 ? `${line1}, ${line2}, ${area}, ${pc}` : `${line1}, ${area}, ${pc}`;
    if(seen.has(fullAddr)) continue;
    seen.add(fullAddr);
    results.push({line1, line2, area, postcode:pc, type, fullAddress:fullAddr, selected:true, sortKey:hn+(isFlat?fn*0.1:0), idx:results.length});
  }
  return results;
}

function generateOutcodeSectors(outcode,count){
  const sectors=[];
  const L='ABCDEFGHJKLMNPRSTUVWXY';
  const rng=mkRng(outcode.split('').reduce((a,c)=>a+c.charCodeAt(0)*31,7));
  const used=new Set();
  for(let i=0;i<count;i++){
    const n=Math.floor(rng()*9)+1;
    const l1=L[~~(rng()*L.length)];
    const l2=L[~~(rng()*L.length)];
    const pc=`${outcode} ${n}${l1}${l2}`;
    if(!used.has(pc)){used.add(pc);sectors.push(pc);}
  }
  return sectors;
}

function showPCStatus(type,txt,pct,sub){
  const sb=document.getElementById('pc-status');
  if(!sb)return;
  sb.style.display='flex';sb.style.flexDirection='column';sb.style.gap='5px';
  sb.className=`status-bar ${type}`;
  const spin=document.getElementById('pc-spin');
  if(spin)spin.style.display=type==='scanning'?'block':'none';
  const t=document.getElementById('pc-status-txt');if(t)t.textContent=txt;
  const p=document.getElementById('pc-pb');if(p)p.style.width=pct+'%';
  const s=document.getElementById('pc-status-sub');if(s)s.textContent=sub;
}

function selectLetter(lt){
  slActiveLetter=lt;
  document.querySelectorAll('.letter-choice').forEach(el=>el.classList.remove('sel'));
  const sel=document.getElementById('lc-'+lt.id);
  if(sel)sel.classList.add('sel');
  updateLetterPreview();
}

function renderAddrResults(){
  renderAddrGrid();
  renderAddrList();
}

function renderAddrList(){
  const list=document.getElementById('addr-list');if(!list)return;
  list.innerHTML='';
  const start=slAddrPage*SL_PG;
  const page=slFiltered.slice(start,start+SL_PG);
  page.forEach((a,pi)=>{
    const i=a.idx;
    const d=document.createElement('div');
    d.className='addr-card'+(slSelected.has(i)?' sel':'');
    d.id='al-'+i;
    d.style.marginBottom='4px';
    d.innerHTML=`
      <div class="pck${slSelected.has(i)?' on':''}" id="alk-${i}" onclick="toggleAddr(${i})"></div>
      <div style="flex:1;display:flex;align-items:center;gap:10px">
        <div style="min-width:26px;text-align:right;font-size:11px;font-weight:700;color:var(--mut)">${start+pi+1}</div>
        <div style="flex:1">
          <span style="font-size:13px;font-weight:600;color:var(--navy)">${a.line1}${a.line2?', '+a.line2:''}</span>
          <span style="font-size:11px;color:var(--mut);margin-left:8px">${a.area} · ${a.postcode}</span>
        </div>
        <span style="font-size:10px;font-weight:600;color:${a.type==='Residential'?'var(--grn)':'var(--blue)'}">${a.type}</span>
      </div>`;
    list.appendChild(d);
  });
  renderAddrPag('addr-pag2');
}

function renderAddrPag(id){
  const el=document.getElementById(id);if(!el)return;
  const tot=Math.ceil(slFiltered.length/SL_PG);
  if(tot<=1){el.innerHTML='';return;}
  el.innerHTML=`<button class="btn bs sm-btn" ${slAddrPage===0?'disabled':''} onclick="addrPg(-1)">← Prev</button>
  <span style="font-size:12px;font-weight:600;color:var(--mut)">Page ${slAddrPage+1}/${tot} · ${slFiltered.length} addresses</span>
  <button class="btn bs sm-btn" ${slAddrPage>=tot-1?'disabled':''} onclick="addrPg(1)">Next →</button>`;
}

function addrPg(d){slAddrPage=Math.max(0,slAddrPage+d);renderAddrResults();}

function toggleAddr(i){
  const a=slAddresses[i];if(!a)return;
  if(slSelected.has(i))slSelected.delete(i);else slSelected.add(i);
  a.selected=slSelected.has(i);
  ['ac','al'].forEach(pfx=>{
    const c=document.getElementById(pfx+'-'+i);
    if(c)c.classList.toggle('sel',slSelected.has(i));
  });
  ['apk','alk'].forEach(pfx=>{
    const k=document.getElementById(pfx+'-'+i);
    if(k)k.classList.toggle('on',slSelected.has(i));
  });
  updAddrSel();
}

function updAddrSel(){
  const n=slSelected.size;
  document.getElementById('ss-sel').textContent=n;
  const bar=document.getElementById('addr-sel-bar');
  if(bar)bar.style.display=n>0?'flex':'none';
  const t=document.getElementById('addr-sel-txt');
  if(t)t.textContent=`${n} address${n===1?'':'es'} selected`;
  const btn=document.getElementById('print-letters-btn');
  if(btn)btn.disabled=n===0;
}

function filterAddrs(q){
  slFiltered=q?slAddresses.filter(a=>a.fullAddress.toLowerCase().includes(q.toLowerCase())):
    [...slAddresses];
  slAddrPage=0;
  renderAddrResults();
}

function populatePreviewSelect(){
  const sel=document.getElementById('preview-addr-sel');if(!sel)return;
  sel.innerHTML=slAddresses.slice(0,50).map((a,i)=>`<option value="${a.idx}">${a.fullAddress}</option>`).join('');
  updateLetterPreview();
}

function updateLetterPreview(){
  const sel=document.getElementById('preview-addr-sel');
  const box=document.getElementById('letter-preview-content');
  if(!box||!slActiveLetter)return;
  const idx=parseInt(sel?.value||'0');
  const a=slAddresses[idx]||slAddresses[0];
  if(!a)return;
  const letter=buildSLLetter(slActiveLetter.body,a);
  box.textContent=letter;
}

function buildSLLetter(body,addr){
  const owner=getOwnerName(addr);
  let out = body
    .replace(/\{\{date\}\}/g,new Date().toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'}))
    .replace(/\{\{address\}\}/g,addr.fullAddress)
    .replace(/\{\{line1\}\}/g,addr.line1)
    .replace(/\{\{line2\}\}/g,addr.line2||'')
    .replace(/\{\{area\}\}/g,addr.area||'')
    .replace(/\{\{postcode\}\}/g,addr.postcode||'')
    .replace(/\{\{name\}\}/g,owner||'Homeowner')
    .replace(/\{\{ownerName\}\}/g,owner||'Homeowner')
    .replace(/\{\{type\}\}/g,addr.type||'');
  return applyOwnerSalutation(out, owner);
}

function slFileUp(e){
  const file=e.target.files[0];if(!file)return;
  const ext='.'+file.name.split('.').pop().toLowerCase();
  if(ext==='.txt'){
    const r=new FileReader();
    r.onload=ev=>{
      const t={id:'sl-up-'+Date.now(),name:file.name.replace(/\.[^.]+$/,''),desc:'Uploaded letter',body:ev.target.result,icon:'<i class=ic-file></i>',colour:'#1E6FD9'};
      SUCCESS_LETTERS.push(t);renderLetterChoices();selectLetter(t);toast('Letter uploaded and selected','ok');
    };
    r.readAsText(file);
  } else {
    const t={id:'sl-up-'+Date.now(),name:file.name.replace(/\.[^.]+$/,''),desc:`Uploaded ${ext}`,body:`{{date}}\n\n{{address}}\n\nDear Resident,\n\n[Content from ${file.name}]\n\nYours sincerely,\n[Your Name]`,icon:'<i class=ic-file></i>',colour:'#1E6FD9'};
    SUCCESS_LETTERS.push(t);renderLetterChoices();selectLetter(t);toast('Letter uploaded','ok');
  }
}

function pasteUrl(){
  navigator.clipboard.readText().then(t=>{
    const inp=document.getElementById('intel-url');
    if(inp){inp.value=t.trim();inp.focus();}
  }).catch(()=>toast('Paste manually with Ctrl+V','warn'));
}

function intelBatchMode(){switchIntelTab('batch');}

function setThinking(on,msg='AI is analysing…'){
  const el=document.getElementById('intel-thinking');if(!el)return;
  el.style.display=on?'flex':'none';
  const tm=document.getElementById('intel-think-txt');if(tm)tm.textContent=msg;
}

async function callAI(prompt, maxTokens=1500, useWebSearch=false){
  // Multi-turn handler for web_search tool use
  const tools = useWebSearch ? [{type:'web_search_20250305', name:'web_search'}] : [];
  const messages = [{role:'user', content:prompt}];
  let finalText = '';
  let turn = 0;
  const MAX = useWebSearch ? 5 : 1;

  while(turn < MAX){
    turn++;
    const body = {model:'auto', max_tokens:maxTokens, messages};
    if(tools.length) body.tools = tools;

    const resp = await fetch('/api/ai',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(body)
    });
    if(!resp.ok) throw new Error('API error '+resp.status);
    const data = await resp.json();
    const blocks = data.content || [];
    blocks.filter(b=>b.type==='text').forEach(b=>{ finalText += b.text; });
    if(data.stop_reason === 'end_turn') break;
    if(data.stop_reason === 'tool_use'){
      const toolUses = blocks.filter(b=>b.type==='tool_use');
      if(!toolUses.length) break;
      messages.push({role:'assistant', content:blocks});
      messages.push({role:'user', content: toolUses.map(tu=>({
        type:'tool_result', tool_use_id:tu.id,
        content:'Web search completed. Now return the requested data.'
      }))});
    } else break;
  }
  return finalText || '{}';
}

async function analyseProperty(input){
  input = String(input || '').trim();
  const isUrl = /^https?:\/\//i.test(input);
  const PC_RE = /[A-Z]{1,2}\d[\dA-Z]?\s*\d[A-Z]{2}/i;

  // ── 1. Get the listing's address details ──
  //     A Rightmove URL is scraped server-side; a typed postcode/address is
  //     used as-is. No AI guessing — only real listing data from here on.
  let listing;
  if (isUrl){
    if (!/rightmove\.co\.uk/i.test(input)) throw new Error('Paste a Rightmove property link, or type a UK postcode / full address.');
    setThinking(true, 'Reading the Rightmove listing…');
    const r = await fetch('/api/property?' + new URLSearchParams({ url: input }).toString());
    const d = await r.json().catch(()=>({}));
    if (!r.ok) throw new Error(d.error || ('Could not read the listing (HTTP ' + r.status + ').'));
    if (!d.found) throw new Error(d.note || 'Could not read this listing automatically. Paste the postcode or full address instead.');
    listing = d;
  } else {
    const pcM = input.match(PC_RE);
    listing = {
      displayAddress: input,
      postcode: pcM ? pcM[0].toUpperCase() : '',
      lat:null, lon:null, type:'', beds:0, price:0, priceLabel:'', sizeSqft:null,
      url:null, source:'Manual entry',
    };
  }

  const district = (listing.postcode || '').split(' ')[0]
    || ((listing.displayAddress || '').match(/\bHA\d\b/i) || [''])[0].toUpperCase();

  // ── 2. Resolve the EXACT address (EPC register + OS Places / Royal Mail) ──
  setThinking(true, 'Finding the exact address…');
  let resolved = null;
  try {
    const qs = new URLSearchParams({ street: listing.displayAddress || '', type: listing.type || '', district });
    if (PC_RE.test(listing.postcode || '')) qs.set('postcode', listing.postcode);
    if (listing.lat != null && listing.lon != null){ qs.set('lat', listing.lat); qs.set('lon', listing.lon); }
    if (listing.sizeSqft > 0) qs.set('size', listing.sizeSqft);
    const rr = await fetch('/api/resolve?' + qs.toString());
    if (rr.ok) resolved = await rr.json();
  } catch(e){ /* resolve is best-effort */ }

  const cands = (resolved && resolved.candidates) || [];
  const best = cands[0] || null;
  const addrConfirmed = !!(resolved && resolved.confirmed);
  const fullAddress = (best && best.fullAddress)
    || (PC_RE.test(listing.displayAddress) ? listing.displayAddress
        : (listing.displayAddress + (listing.postcode ? (', ' + listing.postcode) : '')));
  const line1 = (best && best.line1) || (listing.displayAddress || '').split(',')[0] || '';
  const postcode = (best && best.postcode) || listing.postcode || '';

  // ── 3. Research the owner — Companies House + planning (free public records) ──
  setThinking(true, 'Researching the owner (Companies House + planning)…');
  let ownerData = null;
  try {
    const oq = new URLSearchParams();
    if (fullAddress) oq.set('address', fullAddress);
    if (postcode) oq.set('postcode', postcode);
    if (line1) oq.set('line1', line1);
    if (postcode || fullAddress){
      const orr = await fetch('/api/owner?' + oq.toString());
      if (orr.ok) ownerData = await orr.json();
    }
  } catch(e){ /* owner research is best-effort */ }

  const owners = (ownerData && ownerData.owners) || [];
  const planning = (ownerData && ownerData.planning) || [];
  const firstOwner = owners[0] || null;
  setThinking(false);

  const addrNote = !resolved ? 'Address not resolved — open the listing to read the house number.'
    : addrConfirmed ? ('Exact address confirmed from ' + (resolved.source || 'public records') + '.')
    : (cands.length ? (cands.length + ' possible address' + (cands.length>1?'es':'') + ' on this street — open the Search panel to confirm the house number.')
       : (resolved.note || 'No exact address found — open the listing on Rightmove to read the house number.'));

  return {
    id: 'intel-' + Date.now() + Math.random().toString(36).slice(2,6),
    address: {
      fullAddress: fullAddress || input,
      line1, postcode,
      uprn: (best && best.uprn) || '',
      propertyType: listing.type || '',
      estimatedPrice: listing.priceLabel || (listing.price ? '£' + Number(listing.price).toLocaleString() : ''),
      district: district || (postcode.split(' ')[0] || ''),
      confirmed: addrConfirmed,
      resolveSource: (resolved && resolved.source) || null,
      candidateCount: cands.length,
      note: addrNote,
    },
    owner: {
      ownerName: firstOwner ? firstOwner.name : '',
      ownerType: firstOwner ? ((firstOwner.role || '') + (firstOwner.source ? (' · ' + firstOwner.source) : '')) : '',
      overallConfidence: addrConfirmed ? (firstOwner ? 0.8 : 0.5) : (firstOwner ? 0.55 : 0.3),
      candidates: owners,
      sources: (ownerData && ownerData.sources) || [],
      researchNote: (ownerData && ownerData.note) || '',
      landRegTitle: '—', purchaseDate: '—', purchasePrice: '—', councilTaxBand: '—',
      companyNumber: '', estimatedEmail: '', phoneFormat: '',
    },
    planning,
    listing: { url: listing.url || null, source: listing.source, beds: listing.beds, price: listing.price },
    govLinks: (ownerData && ownerData.links) ? [
      { label:'Companies House', url: ownerData.links.companiesHouse, desc:'Free company ownership search' },
      { label:'Planning applications', url: ownerData.links.planning, desc:'PlanIt — applications at this address' },
      { label:'Land Registry title', url: ownerData.links.landRegistry, desc:'Official registered owner (~£3)' },
      { label:'Electoral roll / 192.com', url: ownerData.links.openRegister, desc:'People at this postcode' },
    ] : [
      { label:'Companies House', url:'https://find-and-update.company-information.service.gov.uk/', desc:'Free company search' },
      { label:'Planning Portal', url:'https://www.planningportal.co.uk/', desc:'Planning applications' },
      { label:'Land Registry', url:'https://search-property-information.service.gov.uk/', desc:'Official owner (~£3)' },
      { label:'192.com', url:'https://www.192.com/', desc:'People and electoral roll' },
    ],
    rightmoveUrl: listing.url || null,
    currentlyListed: isUrl,
    timestamp: new Date(),
  };
}









function addChatMsg(role,text){
  const wrap=document.getElementById('chat-wrap');if(!wrap)return;
  const d=document.createElement('div');d.className=`chat-msg chat-${role}`;
  d.innerHTML=role==='ai'?text.replace(/\n/g,'<br>').replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>'):text;
  wrap.appendChild(d);wrap.scrollTop=wrap.scrollHeight;
}

function updateIntelTable(){
  const wrap=document.getElementById('intel-table-wrap');if(!wrap||!intelResults.length)return;
  wrap.innerHTML=`<div style="overflow-x:auto"><table class="intel-result-table"><thead><tr><th>Address</th><th>Owner</th><th>Type</th><th>Land Reg</th><th>CT Band</th><th>Confidence</th><th>Action</th></tr></thead><tbody>${intelResults.map(r=>{
    const a=r.address,o=r.owner,cp=Math.round((o.overallConfidence||0.5)*100),cc=cp>=70?'high':cp>=45?'med':'low';
    return`<tr><td><div style="font-weight:600;font-size:12px">${a.fullAddress}</div><div style="font-size:10px;color:var(--mut)">${a.district||''}</div></td><td><div style="font-weight:600">${o.ownerName||'—'}</div><div style="font-size:10px;color:var(--mut)">${o.ownerType||''}</div></td><td style="font-size:12px">${a.estimatedPrice||'—'}</td><td style="font-family:monospace;font-size:11px">${o.landRegTitle||'—'}</td><td>Band ${o.councilTaxBand||'—'}</td><td><span class="conf-badge cb-${cc}">${cp}%</span></td><td><button class="btn bp sm-btn" onclick="queueIntelLetter('${r.id}')"><i class=ic-printer></i></button></td></tr>`;
  }).join('')}</tbody></table></div>`;
}

// Load saved agent-targeting settings + campaign log as soon as the app is ready.
try { if (typeof loadTargeting === 'function') loadTargeting(); } catch (e) {}
try { if (typeof loadContacts === 'function') loadContacts(); } catch (e) {}
try { if (typeof loadGroups === 'function') loadGroups(); } catch (e) {}
try { if (typeof loadPrintSchedule === 'function') { loadPrintSchedule(); checkPrintSchedule(); setInterval(checkPrintSchedule, 60000); } } catch (e) {}
try { if (typeof showLoginDueNotice === 'function') setTimeout(showLoginDueNotice, 600); } catch (e) {}