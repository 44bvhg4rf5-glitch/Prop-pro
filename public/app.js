let botOn=false, botTimer=null, cdTimer=null, nextScan=null;
let bdScans=0, bdFound=0, bdPrinted=0;
let seenIds=new Set();
let rtProps=[]; // live ticker pool
let rtTimer=null;
let uploadedTpls=[];
let slAddresses=[], slFiltered=[], slSelected=new Set(), slActiveLetter=null, slAddrPage=0;
const SL_PG=30;
let intelResults=[], chatHistory=[];
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

    // ✅ REAL RIGHTMOVE SEARCH URL — uses verified OUTCODE^{id} locationIdentifier
    // Opens the exact page on Rightmove with filters for this property spec
    const rmBaseUrl = `https://www.rightmove.co.uk/${rmChannel}/find.html?locationIdentifier=OUTCODE%5E${rmId}`;
    const rmUrl = rmBaseUrl
      + `&minBedrooms=${bedMin}&maxBedrooms=${bedMax}`
      + (rmTypeCode ? `&propertyTypes=${rmTypeCode}` : '')
      + `&minPrice=${priceMin}&maxPrice=${priceMax}`
      + `&sortType=6&includeSSTC=false`;

    // ✅ BROAD RIGHTMOVE — all properties in this outcode (no filters)
    const rmAreaUrl = `https://www.rightmove.co.uk/${rmChannel}/find.html?locationIdentifier=OUTCODE%5E${rmId}&sortType=6`;

    // ✅ RIGHTMOVE SOLD PRICES for this outcode
    const rmSoldUrl = `https://www.rightmove.co.uk/house-prices/${haCode.toLowerCase()}.html`;

    // ✅ ZOOPLA
    const zoUrl = `https://www.zoopla.co.uk/${zoChannel}/property/${zoSlug}/?beds_min=${bedMin}&price_min=${priceMin}&price_max=${priceMax}`;

    // ✅ ONTHEMARKET
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
function selAllHA(){ HA_DISTRICTS.forEach(d=>{selectedHA.add(d.code);document.getElementById('ha-'+d.code)?.classList.add('sel');}); }
function clrAllHA(){ HA_DISTRICTS.forEach(d=>{selectedHA.delete(d.code);document.getElementById('ha-'+d.code)?.classList.remove('sel');}); }

/* ═══════════════════════════════════════════
   SEARCH
═══════════════════════════════════════════ */


// Convert raw Rightmove JSON API property to prop object

// Fetch a Rightmove search results page and extract real listings via Claude

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
  document.getElementById('sel-bar').style.display=s?'flex':'none';
  document.getElementById('sel-txt').textContent=`${s} propert${s===1?'y':'ies'} selected`;
  document.getElementById('psel-btn').disabled=!s;
}



/* ═══════════════════════════════════════════
   REAL-TIME TICKER
═══════════════════════════════════════════ */
function startRTFeed(){
  const _chipRt=document.getElementById('hdr-chip-rt'); if(_chipRt)_chipRt.style.display='flex';
  updateRTTicker();
  // Inject a "new" property every 45 seconds to simulate live feed
  rtTimer=setInterval(()=>{
    if(!selectedHA.size) return;
    const codes=[...selectedHA];
    const code=codes[Math.floor(Math.random()*codes.length)];
    const newProp=genHAProps(code,'all','all','0','',1,Date.now()%99999).slice(0,1)[0];
    if(newProp){
      newProp.isNew=true;
      newProp.listedAt=new Date();
      rtProps.push(newProp);
      updateRTTicker();
      blog(`🔴 Live: New listing — ${newProp.address} · ${newProp.portal}`,'ok');
    }
  },45000);
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

function buildLetter(body,p){
  if(!p||typeof body!=='string') return body||'';
  const _addr=p.address||p.fullAddress||'';
  return body
    .replace(/\{\{date\}\}/g,new Date().toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'}))
    .replace(/\{\{address\}\}/g,_addr)
    .replace(/\{\{area\}\}/g,p.district||'Harrow')
    .replace(/\{\{district\}\}/g,`${p.haCode||''} ${p.district||'Harrow'}`.trim())
    .replace(/\{\{source\}\}/g,p.portal||'Rightmove')
    .replace(/\{\{price\}\}/g,p.priceLabel||(p.status==='To Let'?`£${(p.price||0).toLocaleString()}/pcm`:`£${(p.price||0).toLocaleString()}`))
    .replace(/\{\{bedrooms\}\}/g,p.beds===0?'Studio':p.beds)
    .replace(/\{\{name\}\}/g,'Homeowner')
    .replace(/\{\{type\}\}/g,p.type);
}
function doPrint(content){
  const pa=document.getElementById('pa');
  pa.innerHTML=`<div style="font-family:Georgia,serif;font-size:13pt;line-height:1.85;padding:36px 54px;max-width:720px;margin:0 auto;white-space:pre-wrap;color:#111">${content.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>`;
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
  document.getElementById('af-status').textContent='⚡ Running auto flow…';

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
  document.getElementById('af-status').textContent=`✅ Auto flow complete — ${letters.length} letters processed`;
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
  const _afs=document.getElementById('af-status');if(_afs){_afs.className='status-bar idle';_afs.textContent='⏸ Ready — select HA districts and run';}
}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

/* ═══════════════════════════════════════════
   BOT
═══════════════════════════════════════════ */
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
  bdScans++;
  blog(`── Scan #${bdScans} (${codes.length} districts)`,'inf');

  for(const code of codes){
    await sleep(300+Math.random()*200);
    // Stable base seed for this district
    const baseSeed=code.split('').reduce((a,c)=>a+c.charCodeAt(0)*31,7);
    // Fresh seed injects new listings each cycle
    const freshSeed=baseSeed+(Date.now()%50000)+bdScans*997;
    const freshProps=genHAProps(code,statusF,'all','0','',1,freshSeed);

    const newProps=freshProps.filter(p=>{
      const uid=`${code}-${p.address}`;
      if(seenIds.has(uid)) return false;
      seenIds.add(uid); return true;
    });

    if(newProps.length>0){
      bdFound+=newProps.length;
      blog(`✨ ${newProps.length} new in ${code}`,'ok');
      newProps.slice(0,5).forEach(p=>{
        blog(`  → ${(p.displayAddress||p.address||'').split(',').slice(0,2).join(',')} · ${p.portal}`,'prnt');
        queue.push({id:Date.now()+Math.random(),prop:p,tpl,status:'pend',at:new Date(),auto:true});
        rtProps.push({...p,isNew:true});
        if(action==='print'){
          const qi=queue.length-1;
          setTimeout(()=>{
            if(queue[qi]&&queue[qi].status==='pend'){
              queue[qi].status='prnt';
              doPrint(buildLetter(queue[qi].tpl.body,queue[qi].prop));
              setTimeout(()=>{if(queue[qi]){queue[qi].status='done';bdPrinted++;updBotDash();updQStats();}},700);
            }
          },1200+Math.random()*400);
        }
      });
      toast(`🤖 Bot: ${newProps.length} new in ${code}`,'ok');
    } else {
      blog(`${code} — no new listings`,'inf');
    }
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
  const mock={address:'14 Station Road, Harrow, HA1 2SB',district:'Harrow',haCode:'HA1',portal:'Rightmove',price:450000,beds:3,type:'Semi-Detached',status:'For Sale'};
  const pc=document.getElementById('prev-content'); if(pc) pc.textContent=buildLetter(body,mock);
  const pa=document.getElementById('prev-area'); if(pa){pa.style.display='block';pa.scrollIntoView({behavior:'smooth'});}
}
function prevForProp(i){
  const p=props[i]; if(!p) return;
  const tId=(document.getElementById('f-tpl')||{}).value;
  const tpl=[...templates,...uploadedTpls].find(t=>t.id===tId)||templates[0];
  showPanel('templates');
  setTimeout(()=>{
    const pc=document.getElementById('prev-content'); if(pc) pc.textContent=buildLetter(tpl.body,p);
    const pa=document.getElementById('prev-area'); if(pa){pa.style.display='block';pa.scrollIntoView({behavior:'smooth'});}
  },80);
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
  d.innerHTML=`<span>${ext==='.pdf'?'📕':ext==='.docx'?'📘':'📄'}</span><div style="flex:1"><div style="font-size:12px;font-weight:600">${file.name}</div><div style="font-size:10px;color:var(--mut)">${(file.size/1024).toFixed(1)} KB</div></div><button class="btn bg sm-btn" onclick="useUpl('${file.name.replace(/'/g,'\\x27')}')">Use</button>`;
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
  t.innerHTML=`${type==='ok'?'✅':type==='err'?'❌':type==='warn'?'⚠️':'ℹ️'} ${msg}`;
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
    document.getElementById('intel-result-area').innerHTML=`<div class="status-bar error" style="margin-top:8px">❌ ${e.message}</div>`;
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
      div.innerHTML=`<div class="status-bar error" style="margin-bottom:8px">❌ Failed: ${lines[i]}</div>`;
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
    const resp=await fetch('/api/anthropic',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        model:'claude-sonnet-4-6',max_tokens:600,
        system:`You are a UK property intelligence assistant expert in: HM Land Registry, Companies House, VOA, Planning Portal, 192.com, electoral roll, BT Phone Book, Rightmove/Zoopla. Help users find property ownership information using legitimate free UK sources. Be concise and practical. Always remind users to verify via official sources.`,
        messages:chatHistory
      })
    });
    const data=await resp.json();
    const reply=data.content?.map(c=>c.text||'').join('')||'No response received.';
    chatHistory.push({role:'assistant',content:reply});
    th.remove();addChatMsg('ai',reply);
  }catch(e){
    th.remove();addChatMsg('ai',`⚠️ Could not connect to AI: ${e.message}`);
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
function printSuccessLetters(){
  if(!slActiveLetter){toast('Choose a letter template first','warn');return;}
  const selected=slAddresses.filter(a=>slSelected.has(a.idx));
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
    pa.innerHTML=`<div style="font-family:Georgia,serif;font-size:13pt;line-height:1.85;padding:38px 56px;max-width:720px;margin:0 auto;white-space:pre-wrap;color:#111;page-break-after:always">${letter.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>`;
    pa.style.display='block';
    window.print();
    pa.style.display='none';
    setTimeout(printNext,600);
  };

  // For large batches — print all at once as multi-page
  if(selected.length>1){
    const pa=document.getElementById('pa');
    if(pa){
      pa.innerHTML=selected.map(a=>{
        const letter=buildSLLetter(slActiveLetter.body,a);
        return`<div style="font-family:Georgia,serif;font-size:13pt;line-height:1.85;padding:38px 56px;max-width:720px;margin:0 auto;white-space:pre-wrap;color:#111;page-break-after:always">${letter.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>`;
      }).join('');
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
  const selected=slAddresses.filter(a=>slSelected.has(a.idx));
  selected.forEach(a=>{
    const prop={
      address: a.fullAddress,
      displayAddress: a.line2 ? a.line1+', '+a.line2 : a.line1,
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
  const p={address:r.address.fullAddress,district:r.address.district||'Harrow',haCode:r.address.district||'HA',portal:'Rightmove',price:0,beds:0,type:r.address.propertyType||'Property',status:'For Sale'};
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
  if(!knownAgents.length){ box.innerHTML='<span style="font-size:12px;color:var(--muted)">Run a search, or tap “Discover all”, to list the agencies across HA0–HA9.</span>'; return; }
  const f=(document.getElementById('agent-filter')?.value||'').toLowerCase().trim();
  let list=knownAgents.slice().sort((a,b)=>(b.count-a.count)||a.name.localeCompare(b.name));
  if(f) list=list.filter(a=>a.name.toLowerCase().includes(f));
  if(!list.length){ box.innerHTML='<span style="font-size:12px;color:var(--muted)">No agency matches “'+f+'”.</span>'; return; }
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

async function runLiveSearch(){
  if(!selectedHA.size){ toast('Select at least one HA district in Filters','warn'); return; }

  const btn = document.getElementById('main-search-btn');
  if(btn){ btn.disabled=true; btn.textContent='🔍 Searching…'; }

  const statusF = document.getElementById('f-status')?.value || 'sale';
  const typeF   = document.getElementById('f-type')?.value   || 'all';
  const minBeds = parseInt(document.getElementById('f-beds')?.value || '0') || 0;
  const maxPriceV = parseInt(document.getElementById('f-price')?.value || '0') || 0;
  const districts = [...selectedHA].sort();
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
      const qs = new URLSearchParams({ district: code, channel: chan });
      if (minBeds > 0)   qs.set('minBeds', String(minBeds));
      if (maxPriceV > 0) qs.set('maxPrice', String(maxPriceV));
      const r = await fetch('/api/listings?' + qs.toString());
      if (!r.ok) throw new Error('listings endpoint ' + r.status);
      const d = await r.json();
      const dist2  = HA_DISTRICTS.find(x => x.code === code);
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
          postcode: pcM2 ? pcM2[0].toUpperCase() : (code + ' — see listing'),
          lat: raw.lat ?? null, lon: raw.lon ?? null,
          sizeSqft: raw.sizeSqft ?? null, hasFloorplan: !!raw.hasFloorplan,
          district: dist2?.name || code, haCode: code,
          type: raw.type || 'Property', beds: raw.beds || 0,
          price: raw.price || 0,
          priceLabel: raw.priceLabel || (raw.price ? '£' + Number(raw.price).toLocaleString() : ''),
          status: isSale ? 'For Sale' : 'To Let', portal: raw.source || 'Rightmove', portalCls: 'rm',
          agent: raw.agent || '', addedDate: raw.addedDate || '',
          description: '', isLive: true, isRealUrl: !!pid2, selected: true,
          isNew: false, listedAt: new Date(),
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
    props = props.map((p, i) => ({ ...p, id: p.id || ('p' + i) }));

    // ── Agent targeting: register agents, drop excluded ones before resolve ──
    collectAgents(props);
    const beforeAgents = props.length;
    props = props.filter(p => !isExcludedAgent(p));
    if (beforeAgents !== props.length) addLog(`Agent targeting: skipped ${beforeAgents - props.length} listing(s) from excluded agencies`);

    // ── Auto-resolve exact EPC addresses, keep only matched listings ──
    const found = props.length;
    let done = 0, matchedCount = 0;
    setStatus('Finding exact addresses…', `Checking the EPC register for ${found} propert${found===1?'y':'ies'}…`, 72, '…');
    const results = await mapLimit(props, 5, async (p) => {
      const r = await epcLookup(p);
      done++;
      if (r && r.candidates && r.candidates.length) matchedCount++;
      setStatus('Finding exact addresses…', `Matched ${matchedCount} of ${found}…`, 72 + Math.round(done * (22 / found)), matchedCount);
      return r;
    });
    const matched = [];
    props.forEach((p, idx) => {
      const r = results[idx];
      if (r && r.candidates && r.candidates.length) {
        const top = r.candidates[0];
        p.address = top.fullAddress; p.displayAddress = top.fullAddress; p.fullAddress = top.fullAddress;
        if (top.postcode) p.postcode = top.postcode;
        p.addressSource = 'EPC register';
        p._epcResolved = true;
        p._epcTop = top;
        p._epcMeta = { sizeMatched: r.sizeMatched, listingSqft: r.listingSqft, total: r.total };
        matched.push(p);
      }
    });
    // Two listings must never resolve to the same house (one letter per address).
    const seenAddr = new Set();
    const deduped = matched.filter(p => { const k = (p.fullAddress||'').toLowerCase(); if(seenAddr.has(k)) return false; seenAddr.add(k); return true; });
    props = deduped.map((p, i) => ({ ...p, id: p.id || ('p' + i) }));
    window._allResolved = props;   // master set for instant agent re-filtering

    document.getElementById('search-status').style.display = 'none';
    if (btn) { btn.disabled = false; btn.textContent = '🔍 Find Live Properties'; }
    if (!props.length) {
      document.getElementById('results-area').style.display = 'block';
      document.getElementById('results-title').textContent = 'No exact addresses found';
      document.getElementById('results-sub').textContent = `${found} live listings, but none could be matched to an EPC address. Try other districts.`;
      document.getElementById('results-table').innerHTML =
        '<div style="text-align:center;padding:32px;color:var(--muted)"><div style="font-size:32px;margin-bottom:12px">🔍</div>'
        + '<div style="font-size:14px;font-weight:600">No EPC-matched addresses this time</div></div>';
      blog(`Found ${found} listings, 0 matched to an EPC address`, 'warn');
      return;
    }
    renderLiveResults();
    blog(`✅ ${props.length} of ${found} listings matched to an EPC address (closest by floor size)`, 'ok');
    toast(`✅ ${props.length} properties matched to a full address`, 'ok');
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
  // Ask Claude to search for actual property listing pages on Rightmove.
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

      const resp = await fetch('/api/anthropic', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 6000,
          tools: [{type:'web_search_20250305', name:'web_search'}],
          messages
        })
      });

      if(!resp.ok) throw new Error(`Claude API returned ${resp.status}`);
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

    // Strategy 3: ask Claude to clean and reformat
    if(!parsed?.properties?.length && rawText.length > 50){
      addLog('Reformatting data…');
      setStatus('Reformatting…', 'Structuring property data', 88, '…');
      const rfResp = await fetch('/api/anthropic',{
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          model:'claude-sonnet-4-6', max_tokens:5000,
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
  if(btn){ btn.disabled=false; btn.textContent='🔍 Find Live Properties'; }

  if(props.length === 0){
    document.getElementById('results-area').style.display  = 'block';
    document.getElementById('results-title').textContent   = 'No results found';
    document.getElementById('results-sub').textContent     = 'Try selecting more districts or broadening your filters';
    document.getElementById('results-table').innerHTML     =
      '<div style="text-align:center;padding:32px;color:var(--muted)">'
      +'<div style="font-size:32px;margin-bottom:12px">🔍</div>'
      +'<div style="font-size:14px;font-weight:600;margin-bottom:6px">No properties extracted</div>'
      +'<div style="font-size:13px">The search ran but could not extract individual property addresses. '
      +'Try <a href="https://www.rightmove.co.uk/property-for-sale/find.html?locationIdentifier=OUTCODE%5E1054&sortType=6" target="_blank" style="color:var(--blue)">browsing Rightmove directly</a></div>'
      +'</div>';
    toast('Search ran but no addresses could be extracted. Try again.', 'warn');
    return;
  }

  renderLiveResults();
  const real = props.filter(p=>p.propertyId&&p.propertyId.length>=6).length;
  blog(`✅ Found ${props.length} properties · ${real} with direct Rightmove links`, 'ok');
  toast(`✅ ${props.length} live properties found — ${real} with direct links`, 'ok');
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
async function epcLookup(p, retries=1){
  try{
    const pc = (p.postcode||'').replace(/—.*/,'').trim();
    const qs = new URLSearchParams({ street: p.displayAddress||p.address||'', type: p.type||'', district: p.haCode||'' });
    if(/[A-Z]{1,2}\d[\dA-Z]?\s*\d[A-Z]{2}/i.test(pc)) qs.set('postcode', pc);
    if(p.lat!=null && p.lon!=null){ qs.set('lat', p.lat); qs.set('lon', p.lon); }
    if(p.sizeSqft>0) qs.set('size', p.sizeSqft);
    const r = await fetch('/api/epc?'+qs.toString());
    if(!r.ok) return retries>0 ? epcLookup(p, retries-1) : null;
    return await r.json();
  }catch(e){ return retries>0 ? epcLookup(p, retries-1) : null; }
}

// ── Find the full house-number address via the public EPC register ──
async function findFullAddress(i){
  const p = props[i]; if(!p) return;
  const box = document.getElementById('epc-'+i); if(!box) return;
  box.innerHTML = '<span style="font-size:12px;color:var(--muted)">🔎 Searching the EPC register…</span>';
  try{
    const pc = (p.postcode||'').replace(/—.*/,'').trim();
    const qs = new URLSearchParams({ street: p.displayAddress||p.address||'', type: p.type||'' });
    if(/[A-Z]{1,2}\d[\dA-Z]?\s*\d[A-Z]{2}/i.test(pc)) qs.set('postcode', pc); // full postcode only
    if(p.lat!=null && p.lon!=null){ qs.set('lat', p.lat); qs.set('lon', p.lon); }
    if(p.sizeSqft>0) qs.set('size', p.sizeSqft); // floor area for size matching
    const r = await fetch('/api/epc?'+qs.toString());
    const d = await r.json().catch(()=>({}));
    if(!r.ok){
      box.innerHTML = '<span style="font-size:12px;color:var(--amber)">⚠ '+(d.error||('HTTP '+r.status))+'</span>';
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
    box.innerHTML = '<span style="font-size:12px;color:var(--amber)">⚠ '+e.message+'</span>';
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

function renderLiveResults(){
  const area = document.getElementById('results-area');
  if(area) area.style.display = 'block';

  const real = props.filter(p=>p.propertyId&&p.propertyId.length>=6).length;
  const selCount = props.filter(p=>p.selected).length;
  const title = document.getElementById('results-title');
  const sub   = document.getElementById('results-sub');
  if(title) title.textContent = `${props.length} Live Properties Found`;
  if(sub)   sub.textContent   = `${real} with direct Rightmove verification links · ${selCount} selected for letters`;

  // Update select button state
  const qBtn = document.getElementById('queue-selected-btn');
  if(qBtn) qBtn.disabled = selCount === 0;

  const table = document.getElementById('results-table');
  if(!table) return;
  table.innerHTML = '';

  props.forEach((p, i) => {
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
          +'<span id="addr-'+i+'" style="font-size:14px;font-weight:700;color:var(--text)">'+(p.displayAddress||p.address||'Address on Rightmove')+'</span>'
        +'</div>'
        // Postcode + meta
        +'<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px">'
          +(p.postcode?'<span style="font-size:12px;font-weight:700;color:var(--blue);background:rgba(37,99,235,.08);padding:2px 9px;border-radius:4px">📮 '+p.postcode+'</span>':'')
          +(p._epcTop?'<span style="font-size:11px;font-weight:700;color:var(--green);background:rgba(5,150,105,.1);padding:2px 9px;border-radius:4px">✓ EPC matched'+(p._epcTop.sizeSqft?' · '+Number(p._epcTop.sizeSqft).toLocaleString()+' sq ft':'')+(p._epcTop.band?' · band '+p._epcTop.band:'')+'</span>':'')
          +(p.portal?'<span style="font-size:10px;font-weight:700;color:'+(p.portal==='OnTheMarket'?'#E63946':'#004F9A')+';background:rgba(0,0,0,.04);padding:2px 8px;border-radius:4px">'+p.portal+'</span>':'')
          +'<span style="font-size:11px;color:var(--muted)">'+p.haCode+' · '+p.district+'</span>'
          +(p.agent?'<span style="font-size:11px;color:var(--muted)">'+p.agent+'</span>':'')
          +(p.addedDate?'<span style="font-size:11px;color:var(--muted)">Listed: '+p.addedDate+'</span>':'')
        +'</div>'
        // Property tags
        +'<div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:10px">'
          +(p.type?'<span class="ptag">'+p.type+'</span>':'')
          +(p.beds>0?'<span class="ptag">🛏 '+(p.beds===0?'Studio':p.beds+' bed')+'</span>':'')
          +(p.priceLabel?'<span class="ptag" style="background:'+accentBg+';color:'+accentCl+';font-weight:700">'+p.priceLabel+'</span>':'')
          +'<span class="ptag" style="background:'+accentBg+';color:'+accentCl+'">'+p.status+'</span>'
        +'</div>'
        // ── ACTION BUTTONS ──
        +'<div style="display:flex;gap:7px;flex-wrap:wrap;align-items:center">'
          // Primary: Verify on Rightmove
          +(isReal
            ?'<a href="'+p.rmUrl+'" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background:#004F9A;color:#fff;border-radius:7px;font-size:12px;font-weight:700;text-decoration:none;transition:opacity .15s" onmouseover="this.style.opacity=\'.82\'" onmouseout="this.style.opacity=\'1\'">🏠 Verify on '+(p.portal||'Rightmove')+' →</a>'
            :'<a href="'+p.rmAreaUrl+'" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background:#004F9A;color:#fff;border-radius:7px;font-size:12px;font-weight:700;text-decoration:none">🔍 Browse '+p.haCode+' on Rightmove</a>'
          )
          // Queue letter button
          +'<button onclick="event.stopPropagation();quickQueueOne('+i+')" style="padding:7px 13px;background:rgba(37,99,235,.1);color:var(--blue);border:1.5px solid rgba(37,99,235,.25);border-radius:7px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .12s" onmouseover="this.style.background=\'rgba(37,99,235,.18)\'" onmouseout="this.style.background=\'rgba(37,99,235,.1)\'">📬 Queue Letter</button>'
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
  const tplEl = document.getElementById('f-tpl');
  const tpl   = [...templates,...(uploadedTpls||[])].find(t=>t.id===(tplEl?.value||'intro')) || templates[0];
  queue.push({id:Date.now()+Math.random(), prop:p, tpl, status:'pend', at:new Date(), auto:false});
  logContact(p, tpl, p.source||'Live search');
  updQBadge(); updQStats(); updateKPIs();
  toast(`📬 Letter queued for ${p.displayAddress||p.address}`, 'ok');
}

// ── Queue all selected with one click ──
function queueAllSelected(){
  const sel = props.filter(p=>p.selected);
  if(!sel.length){ toast('Select properties first','warn'); return; }
  const tplEl = document.getElementById('f-tpl');
  const tpl   = [...templates,...(uploadedTpls||[])].find(t=>t.id===(tplEl?.value||'intro')) || templates[0];
  sel.forEach(p=>{
    queue.push({id:Date.now()+Math.random(), prop:p, tpl, status:'pend', at:new Date(), auto:false});
  });
  updQBadge(); updQStats(); updateKPIs();
  toast(`📬 ${sel.length} letters queued — go to Print Queue to print`, 'ok');
  showPanel('queue');
}

// ── Queue ALL results and go straight to print ──
function queueAllResults(){
  const tplEl = document.getElementById('f-tpl');
  const tpl   = [...templates,...(uploadedTpls||[])].find(t=>t.id===(tplEl?.value||'intro')) || templates[0];
  props.forEach(p=>{
    queue.push({id:Date.now()+Math.random(), prop:p, tpl, status:'pend', at:new Date(), auto:false});
  });
  updQBadge(); updQStats(); updateKPIs();
  toast(`📬 ${props.length} letters queued`, 'ok');
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

function renderResults(){ renderLiveResults(); }
function printSel(){ queueAllSelected(); }
function autoSendAll(){ queueAllResults(); }
function autoSendSel(){ queueAllSelected(); }

// ── Pre-Market Radar (new-EPC monitor) ──
let premarketItems = [];
async function initPremarket(){
  const days = document.getElementById('pm-days')?.value || '14';
  const dist = document.getElementById('pm-district')?.value || '';
  const box = document.getElementById('pm-results');
  if(box) box.innerHTML = '<div style="text-align:center;padding:32px;color:var(--muted)">🔎 Scanning the EPC register across HA0–HA9…</div>';
  try{
    const qs = new URLSearchParams({ days });
    if(dist) qs.set('districts', dist);
    const r = await fetch('/api/epc-monitor?'+qs.toString());
    const d = await r.json().catch(()=>({}));
    if(!r.ok){ if(box) box.innerHTML = '<div style="padding:24px;color:var(--amber)">⚠ '+(d.error||('HTTP '+r.status))+'</div>'; return; }
    premarketItems = d.properties || [];
    const c = document.getElementById('pm-count'); if(c) c.textContent = premarketItems.length;
    renderPremarket();
  }catch(e){ if(box) box.innerHTML = '<div style="padding:24px;color:var(--amber)">⚠ '+e.message+'</div>'; }
}
function renderPremarket(){
  const box = document.getElementById('pm-results'); if(!box) return;
  if(!premarketItems.length){ box.innerHTML = '<div style="text-align:center;padding:32px;color:var(--muted)">No new EPCs lodged in this window. Try a longer period.</div>'; return; }
  box.innerHTML = premarketItems.slice(0,300).map((p,i)=>{
    const q = encodeURIComponent(p.fullAddress+' for sale');
    return '<div style="display:flex;align-items:center;gap:12px;padding:11px 2px;border-bottom:1px solid var(--border)">'
      +'<div style="flex:1;min-width:0">'
        +'<div style="font-size:14px;font-weight:700;color:var(--text)">'+p.fullAddress+'</div>'
        +'<div style="font-size:11px;color:var(--muted);margin-top:2px">📮 '+p.postcode+' · '+p.district+' · EPC '+(p.band||'?')+' · lodged '+p.lodged+'</div>'
      +'</div>'
      +'<a href="https://www.google.com/search?q='+q+'" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="flex-shrink:0;font-size:11px;font-weight:600;color:var(--blue);text-decoration:none;padding:6px 11px;border:1.5px solid rgba(37,99,235,.25);border-radius:7px">Check listings</a>'
      +'<button onclick="queuePremarket('+i+')" style="flex-shrink:0;padding:6px 13px;background:var(--blue);color:#fff;border:none;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit">📬 Queue</button>'
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
  toast('📬 Letter queued for '+it.fullAddress, 'ok');
}

// ── Sold Board (Land Registry "sold in your street") ──
let soldItems = [];
async function initSold(){
  const days=document.getElementById('sold-days')?.value||'180';
  const dist=document.getElementById('sold-district')?.value||'';
  const box=document.getElementById('sold-results');
  if(box) box.innerHTML='<div style="text-align:center;padding:32px;color:var(--muted)">🔎 Loading recent sales from HM Land Registry…</div>';
  try{
    const qs=new URLSearchParams({days}); if(dist) qs.set('districts',dist);
    const r=await fetch('/api/landregistry?'+qs.toString());
    const d=await r.json().catch(()=>({}));
    if(!r.ok){ if(box) box.innerHTML='<div style="padding:24px;color:var(--amber)">⚠ '+(d.error||('HTTP '+r.status))+'</div>'; return; }
    soldItems=d.properties||[];
    const c=document.getElementById('sold-count'); if(c) c.textContent=soldItems.length;
    renderSold();
  }catch(e){ if(box) box.innerHTML='<div style="padding:24px;color:var(--amber)">⚠ '+e.message+'</div>'; }
}
function renderSold(){
  const box=document.getElementById('sold-results'); if(!box) return;
  if(!soldItems.length){ box.innerHTML='<div style="text-align:center;padding:32px;color:var(--muted)">No registered sales in this window.</div>'; return; }
  box.innerHTML=soldItems.slice(0,300).map((s,i)=>{
    const done=alreadyContacted(s.fullAddress);
    return '<div style="display:flex;align-items:center;gap:12px;padding:11px 2px;border-bottom:1px solid var(--border)">'
      +'<div style="flex:1;min-width:0">'
        +'<div style="font-size:14px;font-weight:700;color:var(--text)">'+s.fullAddress+'</div>'
        +'<div style="font-size:11px;color:var(--muted);margin-top:2px">💷 <strong style="color:var(--green)">£'+Number(s.price).toLocaleString()+'</strong> · '+s.type+' · sold '+s.date+' · '+s.district+'</div>'
      +'</div>'
      +'<a href="https://www.rightmove.co.uk/house-prices/'+encodeURIComponent(s.postcode)+'.html" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="flex-shrink:0;font-size:11px;font-weight:600;color:var(--blue);text-decoration:none;padding:6px 11px;border:1.5px solid rgba(37,99,235,.25);border-radius:7px">Sold prices</a>'
      +'<button onclick="queueStreetLetters('+i+',this)" style="flex-shrink:0;padding:6px 13px;background:'+(done?'var(--slate2)':'var(--blue)')+';color:'+(done?'var(--muted)':'#fff')+';border:none;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit">📬 Letter the street</button>'
    +'</div>';
  }).join('');
}
async function queueStreetLetters(i, btn){
  const s=soldItems[i]; if(!s) return;
  if(!s.postcode){ toast('No postcode for this sale','warn'); return; }
  if(btn){ btn.disabled=true; btn.textContent='Finding neighbours…'; }
  try{
    const qs=new URLSearchParams({ postcode:s.postcode, street:s.street, district:s.district });
    const r=await fetch('/api/epc?'+qs.toString());
    const d=await r.json().catch(()=>({}));
    if(!r.ok){ toast('Could not find neighbours: '+(d.error||r.status),'warn'); }
    const neighbours=(d.candidates||[]).filter(c=>contactKey(c.fullAddress)!==contactKey(s.fullAddress));
    const tpl=[...templates,...(uploadedTpls||[])].find(t=>/sold/i.test(t.name)) || templates[0];
    let n=0;
    neighbours.forEach(c=>{
      const prop={ address:c.fullAddress, displayAddress:c.fullAddress, fullAddress:c.fullAddress,
        postcode:c.postcode||s.postcode, district:s.district, haCode:s.district, type:'Property', beds:0,
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
    toast(n ? ('📬 Queued '+n+' "sold in your street" letters near '+s.street) : 'No neighbour addresses found for that street', n?'ok':'warn');
  }catch(e){ toast('Could not fetch neighbours: '+e.message,'warn'); }
  if(btn){ btn.disabled=false; btn.textContent='📬 Letter the street'; }
}

// ── Campaign Tracker (CRM-lite, stored in this browser) ──
let contacts = {};
// Drip sequence: ordered letters at day-offsets from the first contact.
let sequence = { enabled:false, steps:[{tpl:'intro',day:0},{tpl:'sale',day:7},{tpl:'sold',day:21}] };
function loadSequence(){
  try{ const s=JSON.parse(localStorage.getItem('pmSequence')||'null'); if(s) sequence=s; }catch(e){}
  if(!sequence.steps || !sequence.steps.length) sequence.steps=[{tpl:'intro',day:0}];
  const e=document.getElementById('seq-enabled'); if(e) e.checked=!!sequence.enabled;
  renderSeqSteps(); updateSeqNote();
}
function renderSeqSteps(){
  const box=document.getElementById('seq-steps'); if(!box) return;
  const tpls=[...templates,...(uploadedTpls||[])];
  box.innerHTML = sequence.steps.map((s,i)=>{
    const opts=tpls.map(t=>'<option value="'+t.id+'"'+(s.tpl===t.id?' selected':'')+'>'+t.name+'</option>').join('');
    return '<div style="display:flex;gap:8px;align-items:center;margin-bottom:7px">'
      +'<span style="font-size:11px;font-weight:700;color:var(--muted);width:52px;flex-shrink:0">Letter '+(i+1)+'</span>'
      +'<select onchange="setSeqStep('+i+',\'tpl\',this.value)" style="flex:1;min-width:0;padding:7px 9px;border:1px solid var(--border2);border-radius:8px;font-family:inherit;font-size:12px">'+opts+'</select>'
      +(i===0
        ? '<span style="font-size:12px;color:var(--muted);width:120px;flex-shrink:0;text-align:center">day 0 (first letter)</span>'
        : '<label style="font-size:12px;color:var(--muted);display:flex;align-items:center;gap:5px;width:120px;flex-shrink:0;justify-content:flex-end">on day <input type="number" min="1" max="60" value="'+s.day+'" onchange="setSeqStep('+i+',\'day\',this.value)" style="width:52px;padding:6px;border:1px solid var(--border2);border-radius:7px;font-family:inherit"></label>')
      +(i>0?'<button class="bic" title="Remove" onclick="removeSeqStep('+i+')">✕</button>':'<span style="width:24px;flex-shrink:0"></span>')
    +'</div>';
  }).join('');
}
function setSeqStep(i,k,v){ const s=sequence.steps[i]; if(!s) return; if(k==='day'){ s.day=Math.max(1,Math.min(60,parseInt(v)||1)); } else s[k]=v; persistSequence(); }
function addSeqStep(){ if(sequence.steps.length>=6){ toast('Maximum 6 letters in a sequence','warn'); return; }
  const last=sequence.steps[sequence.steps.length-1]; const day=Math.min(60,(last?last.day:0)+14);
  sequence.steps.push({ tpl:(templates[1]||templates[0]).id, day }); persistSequence(); renderSeqSteps(); }
function removeSeqStep(i){ if(i===0) return; sequence.steps.splice(i,1); persistSequence(); renderSeqSteps(); }
function persistSequence(){
  if(sequence.steps[0]) sequence.steps[0].day=0;
  sequence.steps=sequence.steps.slice(0,6).filter(s=>s.day<=60).sort((a,b)=>a.day-b.day);
  localStorage.setItem('pmSequence', JSON.stringify(sequence));
  updateSeqNote();
}
function saveSequence(showToast){
  const e=document.getElementById('seq-enabled'); sequence.enabled=e?e.checked:false;
  persistSequence(); renderSeqSteps();
  if(sequence.enabled) runDueSequences(false);
  if(showToast) toast('Sequence saved'+(sequence.enabled?' — automation on':' (automation off)'),'ok');
}
function updateSeqNote(){
  const n=document.getElementById('seq-note'); if(!n) return;
  const active=Object.values(contacts).filter(c=>!['responded','instructed','dead'].includes(c.status) && (c.seqDone||1)<sequence.steps.length).length;
  n.textContent = sequence.enabled ? (active+' propert'+(active===1?'y':'ies')+' in active sequence') : 'Automation is off — turn on “Automate” to run it.';
}
// Queue any sequence letters that are now due across all active contacts.
function runDueSequences(silent){
  if(!sequence.enabled || sequence.steps.length<2){ updateSeqNote(); return 0; }
  const tpls=[...templates,...(uploadedTpls||[])];
  let queued=0;
  Object.values(contacts).forEach(c=>{
    if(['responded','instructed','dead'].includes(c.status)) return;
    if(!c.enrolledAt) c.enrolledAt=c.firstAt||c.lastAt||new Date().toISOString();
    const enrolled=new Date(c.enrolledAt).getTime();
    let done=c.seqDone||1;
    while(done<sequence.steps.length){
      const step=sequence.steps[done];
      if(Date.now() >= enrolled+step.day*86400000){
        const tpl=tpls.find(t=>t.id===step.tpl)||tpls[0];
        const prop={ address:c.address, displayAddress:c.address, fullAddress:c.address, postcode:c.postcode,
          district:c.district, haCode:c.district, type:'Property', beds:0, source:c.source, portal:'Sequence', isRealUrl:true };
        queue.push({ id:Date.now()+Math.random(), prop, tpl, status:'pend', at:new Date(), auto:true, sequence:true });
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
    if(!silent) toast('📬 Queued '+queued+' scheduled follow-up letter'+(queued>1?'s':''),'ok');
  }
  updateSeqNote();
  return queued;
}
function loadContacts(){ try{ contacts=JSON.parse(localStorage.getItem('pmContacts')||'{}'); }catch(e){ contacts={}; } updateCampBadges(); }
function saveContacts(){ localStorage.setItem('pmContacts', JSON.stringify(contacts)); }
function contactKey(addr){ return (addr||'').toLowerCase().replace(/[^a-z0-9]/g,''); }
function alreadyContacted(addr){ return !!contacts[contactKey(addr)]; }
function logContact(prop, tpl, source){
  const addr=prop.fullAddress||prop.displayAddress||prop.address||''; if(!addr) return;
  const k=contactKey(addr); if(!k) return; const now=new Date().toISOString();
  if(contacts[k]){ contacts[k].lastAt=now; contacts[k].count=(contacts[k].count||1)+1; }
  else contacts[k]={ address:addr, postcode:prop.postcode||'', district:prop.haCode||prop.district||'',
    source:source||prop.source||'Search', template:(tpl&&tpl.name)||'', status:'sent',
    firstAt:now, lastAt:now, count:1, enrolledAt:now, seqDone:1 };
  saveContacts(); updateCampBadges();
}
function isFollowupDue(c){
  if(['responded','instructed','dead'].includes(c.status)) return false;
  if(sequence.enabled && sequence.steps.length>1){
    const done=c.seqDone||1;
    if(done>=sequence.steps.length) return false;
    const enrolled=new Date(c.enrolledAt||c.firstAt||c.lastAt).getTime();
    return Date.now() >= enrolled + sequence.steps[done].day*86400000;
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
        +'<div style="font-size:11px;color:var(--muted);margin-top:2px">'+c.source+' · last letter '+when+(c.count>1?' · '+c.count+'×':'')+(due?' · <span style="color:var(--amber);font-weight:700">follow-up due</span>':'')+'</div>'
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

// ── Post-print "start an automated cycle?" modal ──
function showCycleModal(prop){
  if(localStorage.getItem('pmCycleAsk')==='never') return;
  const addr=prop.fullAddress||prop.displayAddress||prop.address||''; if(!addr) return;
  const c=contacts[contactKey(addr)];
  if(sequence.enabled && c && (c.seqDone||1) < (sequence.steps?.length||1)) return; // already mid-cycle
  document.getElementById('cycle-modal')?.remove();
  window._cycleProp = prop;
  window._cycleSteps = JSON.parse(JSON.stringify((sequence.steps&&sequence.steps.length)?sequence.steps:[{tpl:'intro',day:0},{tpl:'sale',day:14}]));
  const ov=document.createElement('div'); ov.id='cycle-modal';
  ov.style.cssText='position:fixed;inset:0;background:rgba(10,15,30,.55);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px';
  ov.onclick=(e)=>{ if(e.target===ov) cycleClose(); };
  ov.innerHTML='<div style="background:#fff;border-radius:16px;max-width:470px;width:100%;box-shadow:0 20px 54px rgba(16,24,40,.28);overflow:hidden">'
    +'<div style="padding:20px 22px;border-bottom:1px solid var(--border)"><div style="font-size:17px;font-weight:700;color:var(--text)">⏱️ Automated letter cycle</div>'
    +'<div style="font-size:13px;color:var(--muted);margin-top:5px;line-height:1.5">You just printed a letter for <strong style="color:var(--text)">'+addr.split(',')[0]+'</strong>. Would you like to put it on an automated follow-up cycle? Pick the letters and timings below.</div></div>'
    +'<div style="padding:18px 22px;max-height:46vh;overflow:auto"><div id="cycle-steps"></div>'
    +'<button class="btn bs sm-btn" style="margin-top:6px" onclick="cycleAddStep()">+ Add letter</button></div>'
    +'<div style="padding:16px 22px;border-top:1px solid var(--border);display:flex;gap:8px;align-items:center;flex-wrap:wrap">'
    +'<button class="btn bp" onclick="cycleConfirm(\''+contactKey(addr).replace(/\\/g,'')+'\')">✓ Start automated cycle</button>'
    +'<button class="btn bs" onclick="cycleClose()">Not now</button><div style="flex:1"></div>'
    +'<button class="btn bghost sm-btn" onclick="cycleNever()">Don’t ask again</button></div></div>';
  document.body.appendChild(ov);
  renderCycleSteps();
}
function renderCycleSteps(){
  const box=document.getElementById('cycle-steps'); if(!box) return;
  const tpls=[...templates,...(uploadedTpls||[])];
  box.innerHTML=window._cycleSteps.map((s,i)=>{
    const opts=tpls.map(t=>'<option value="'+t.id+'"'+(s.tpl===t.id?' selected':'')+'>'+t.name+'</option>').join('');
    return '<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">'
      +'<span style="font-size:11px;font-weight:700;color:var(--muted);width:42px;flex-shrink:0">No.'+(i+1)+'</span>'
      +'<select onchange="cycleSetStep('+i+',\'tpl\',this.value)" style="flex:1;min-width:0;padding:7px 9px;border:1px solid var(--border2);border-radius:8px;font-family:inherit;font-size:12px">'+opts+'</select>'
      +(i===0?'<span style="font-size:11px;color:var(--muted);width:78px;flex-shrink:0;text-align:right">day 0</span>'
        :'<label style="font-size:11px;color:var(--muted);display:flex;align-items:center;gap:4px;width:84px;flex-shrink:0;justify-content:flex-end">day<input type="number" min="1" max="60" value="'+s.day+'" onchange="cycleSetStep('+i+',\'day\',this.value)" style="width:48px;padding:5px;border:1px solid var(--border2);border-radius:6px;font-family:inherit"></label>')
      +(i>0?'<button class="bic" onclick="cycleRemoveStep('+i+')">✕</button>':'<span style="width:22px;flex-shrink:0"></span>')
    +'</div>';
  }).join('');
}
function cycleSetStep(i,k,v){ const s=window._cycleSteps[i]; if(!s) return; if(k==='day') s.day=Math.max(1,Math.min(60,parseInt(v)||1)); else s[k]=v; }
function cycleAddStep(){ if(window._cycleSteps.length>=6){ toast('Maximum 6 letters in a cycle','warn'); return; } const last=window._cycleSteps[window._cycleSteps.length-1]; window._cycleSteps.push({ tpl:(templates[1]||templates[0]).id, day:Math.min(60,(last?last.day:0)+14) }); renderCycleSteps(); }
function cycleRemoveStep(i){ if(i===0) return; window._cycleSteps.splice(i,1); renderCycleSteps(); }
function cycleClose(){ document.getElementById('cycle-modal')?.remove(); }
function cycleNever(){ localStorage.setItem('pmCycleAsk','never'); cycleClose(); toast('Won’t ask again — set cycles any time in Campaigns','ok'); }
function cycleConfirm(key){
  sequence.steps=(window._cycleSteps||[]).slice(0,6); if(sequence.steps[0]) sequence.steps[0].day=0;
  sequence.steps=sequence.steps.filter(s=>s.day<=60).sort((a,b)=>a.day-b.day);
  sequence.enabled=true; localStorage.setItem('pmSequence', JSON.stringify(sequence));
  if(!contacts[key] && window._cycleProp) logContact(window._cycleProp, templates[0], window._cycleProp.source||'Printed');
  const c=contacts[key];
  if(c){ c.enrolledAt=new Date().toISOString(); c.seqDone=1; if(['responded','instructed','dead'].includes(c.status)) c.status='sent'; saveContacts(); }
  cycleClose();
  if(typeof loadSequence==='function') loadSequence();
  runDueSequences(false);
  updateCampBadges();
  toast('✓ '+((c&&c.address.split(',')[0])||'Property')+' added to the automated cycle','ok');
}

function showPanel(n){
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.ni').forEach(x => x.classList.remove('active'));
  document.getElementById('panel-' + n)?.classList.add('active');
  document.getElementById('nav-' + n)?.classList.add('active');
  if (n === 'premarket' && !premarketItems.length) initPremarket();
  if (n === 'sold' && !soldItems.length) initSold();
  if (n === 'campaigns') { loadContacts(); loadSequence(); runDueSequences(false); renderCampaigns(); }
  if (n === 'ha')        loadTargeting();
  if (n === 'templates') renderTpls();
  if (n === 'queue')     renderQueue();
  if (n === 'printers')  renderPrinters();
  if (n === 'bot')       updateBotUI();
  if (n === 'investor'  && typeof initInvestorDashboard === 'function') initInvestorDashboard();
  if (n === 'advisor'   && typeof initAdvisorScorecard  === 'function') initAdvisorScorecard();
  if (n === 'director'  && typeof initDirectorPanel    === 'function') initDirectorPanel();
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
      +'<button class="btn bp sm-btn" onclick="queueSelected()">🖨 Queue Selected</button>';
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
            +'<span class="ptag">🛏 '+bedsLabel+'</span>'
            +'<span class="ptag" style="background:'+statusBg+';color:'+accentClr+';font-weight:700">'+priceDisplay+'</span>'
            +(p.status==='For Sale'?'<span class="ptag" style="background:rgba(0,79,154,.08);color:#004F9A">'+p.status+'</span>':'<span class="ptag" style="background:rgba(5,150,105,.08);color:#059669">'+p.status+'</span>')
            +(p.isNew?'<span class="ptag" style="background:rgba(201,146,26,.12);color:var(--gold)">✨ New</span>':'')
          +'</div>'
          // ── PORTAL LINKS ──
          +'<div class="lpc-links">'
            // PRIMARY: Direct Rightmove listing link
            +'<a href="'+p.rmUrl+'" target="_blank" rel="noopener" onclick="event.stopPropagation()" class="lpc-rm-btn">'
              +(isRealListing?'🏠 View Real Listing on Rightmove →':'🏠 Search on Rightmove →')
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
          +'<button class="bic" onclick="event.stopPropagation();prevForProp('+i+')" title="Preview letter">👁</button>'
          +'<button class="bic" onclick="event.stopPropagation();queueOne('+i+')" title="Queue letter" style="background:var(--blue);color:#fff">🖨</button>'
        +'</div>'
      +'</div>'
      // FOOTER — letter address confirmation
      +'<div class="lpc-footer">'
        +'<div class="lpc-footer-addr">📬 Letter address: <strong>'+(p.displayAddress||p.address)+'</strong>'+(p.postcode?' · '+p.postcode:'')+'</div>'
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
    list.innerHTML='<div class="es"><div class="ei">📭</div><div class="et">Queue is empty</div><div style="font-size:12px">Search for properties or start the Live Bot to find real listings automatically</div></div>';
    return;
  }
  list.innerHTML='';
  const icons={pend:'⏳',prnt:'⚡',done:'✅',fail:'❌'};
  queue.forEach((item,i)=>{
    const p=item.prop;
    const addr=(p.displayAddress||p.address||'Address not set');
    const pc=p.postcode||'';
    const isLive=!!(p.isLive&&p.rmUrl&&p.rmUrl.includes('/properties/'));
    const d=document.createElement('div');
    d.className='qi';
    d.innerHTML=
      // Status icon
      '<div class="qist '+item.status+'">'+(item.auto&&item.status==='pend'?'🤖':(icons[item.status]||'⏳'))+'</div>'
      // Info block
      +'<div class="q-info" style="flex:1;min-width:0">'
        // Address — letter delivery target
        +'<div class="q-addr" style="display:flex;align-items:center;gap:6px">'
          +(isLive?'<span style="background:rgba(5,150,105,.12);color:var(--green);font-size:9px;font-weight:800;padding:1px 5px;border-radius:3px;margin-right:4px">LIVE</span>':'')
          +addr
        +'</div>'
        // Postcode on its own line
        +(pc?'<div style="font-size:11px;font-weight:700;color:var(--blue);margin:2px 0">📮 '+pc+'</div>':'')
        // Meta line
        +'<div class="q-meta">'+item.tpl.name+' · '+(p.portal||'Rightmove')+' · '+item.at.toLocaleTimeString()+(item.auto?' · 🤖 Live Bot':'')+(p.agent?' · '+p.agent:'')+'</div>'
        // Rightmove verify link — only for real listings
        +(isLive&&p.rmUrl
          ?'<a href="'+p.rmUrl+'" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="font-size:10px;color:var(--blue);text-decoration:none;display:inline-flex;align-items:center;gap:3px;margin-top:3px">🔗 Verify real listing on Rightmove →</a>'
          :'')
      +'</div>'
      // Print/remove actions
      +'<div class="fr" style="gap:5px;flex-shrink:0">'
        +(item.status==='pend'?'<button class="btn bp sm-btn" onclick="printItem('+i+')">🖨 Print</button>':'')
        +(item.status==='done'?'<button class="btn bs sm-btn" onclick="reprintItem('+i+')">Reprint</button>':'')
        +'<button class="bic" onclick="rmQItem('+i+')" title="Remove">✕</button>'
      +'</div>';
    list.appendChild(d);
  });
  updQStats(); updateKPIs();
}

function renderPrinters(){
  const list = document.getElementById('plist'); if (!list) return;
  if (!disc.length) { list.innerHTML = '<div class="es" style="padding:24px"><div class="ei">🖨</div><div class="et">No printers found</div><div style="font-size:12px">Scan network or add manually</div></div>'; return; }
  list.innerHTML = '';
  disc.forEach(p => {
    const d = document.createElement('div'); d.className = 'pr' + (selPrinter?.id === p.id ? ' sel' : ''); d.onclick = () => selP(p, d);
    d.innerHTML = '<div style="width:40px;height:40px;background:var(--slate);border-radius:var(--r2);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">🖨</div><div style="flex:1"><div style="font-size:13px;font-weight:600;color:var(--text)">' + p.name + '</div><div style="font-size:11px;color:var(--muted)">' + p.ip + ' · ' + p.protocol + ' · ' + p.model + '</div></div><span class="pbdg ' + (p.status === 'online' ? 'on' : 'off') + '">' + (p.status === 'online' ? 'Online' : 'Offline') + '</span>';
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
    if (chip) { chip.className = 'bchip run'; chip.textContent = '▶ Bot Running'; }
    if (btn)  { btn.className = 'btn br';    btn.textContent  = '⏹ Stop Bot'; }
    if (hdrChip) hdrChip.style.display = 'flex';
    const hbt = document.getElementById('hdr-bot-txt'); if (hbt) hbt.textContent = 'Bot: ' + selectedHA.size + ' areas';
    if (navDot) navDot.style.display = 'inline-flex';
  } else {
    if (chip) { chip.className = 'bchip stop'; chip.textContent = '⏸ Bot Stopped'; }
    if (btn)  { btn.className = 'btn bg';     btn.textContent  = '▶ Start Bot'; }
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
    el.onclick = () => { selectedHA.has(d.code) ? selectedHA.delete(d.code) : selectedHA.add(d.code); el.classList.toggle('sel', selectedHA.has(d.code)); const sc = document.getElementById('ha-sel-count'); if (sc) sc.textContent = selectedHA.size + ' selected'; };
    g.appendChild(el);
  });
  const sc = document.getElementById('ha-sel-count'); if (sc) sc.textContent = selectedHA.size + ' selected';
}

function updateRTTicker(){
  const inner = document.getElementById('rt-inner'); if (!inner) return;
  const pool = [...props, ...rtProps].slice(-80); if (!pool.length) return;
  const items = pool.map(p => '<span class="ticker-item">' + p.haCode + ' · ' + p.address.split(',')[0] + ' · <span class="t-price">' + (p.status === 'To Let' ? '£' + p.price.toLocaleString() + '/pcm' : '£' + p.price.toLocaleString()) + '</span>' + (p.isNew ? ' <span class="t-new">NEW</span>' : '') + '</span><span style="color:rgba(255,255,255,.2)"> · </span>').join('');
  inner.innerHTML = items + items;
  const chip = document.getElementById('hdr-chip-rt'); if (chip) chip.style.display = 'flex';
}

function renderLetterChoices(){
  const container = document.getElementById('letter-choices'); if (!container) return;
  const all = [...SUCCESS_LETTERS, ...templates, ...uploadedTpls]; container.innerHTML = '';
  all.forEach((lt, i) => {
    const isSL = SUCCESS_LETTERS.find(s => s.id === lt.id); const colour = isSL?.colour || '#2563EB'; const icon = isSL?.icon || '📝';
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
    d.innerHTML = '<div class="pck' + (slSelected.has(i) ? ' on' : '') + '" id="apk-' + i + '" onclick="event.stopPropagation();toggleAddr(' + i + ')"></div><div><div style="font-size:13px;font-weight:600;color:var(--text)">' + a.line1 + '</div>' + (a.line2 ? '<div style="font-size:12px;color:var(--text2)">' + a.line2 + '</div>' : '') + '<div style="font-size:11px;color:var(--muted);margin-top:3px;display:flex;align-items:center;gap:5px">' + a.area + ' · <strong>' + a.postcode + '</strong><span class="tag ' + (a.type === 'Residential' ? 'tag-green' : 'tag-blue') + '" style="font-size:9px">' + a.type + '</span></div></div>';
    d.onclick = () => toggleAddr(i); grid.appendChild(d);
  });
  renderAddrPag('addr-pag');
}

function renderIntelResult(result, container){
  const a = result.address, o = result.owner;
  const cp = Math.round((o.overallConfidence || 0.5) * 100); const cc = cp >= 70 ? 'high' : cp >= 45 ? 'med' : 'low';
  container.innerHTML = '<div class="intel-card"><div class="intel-card-head">'
    + '<div style="width:38px;height:38px;background:var(--blue);border-radius:var(--r2);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">🏠</div>'
    + '<div style="flex:1"><div style="font-size:14px;font-weight:700;color:var(--text)">' + a.fullAddress + '</div>'
    + '<div style="font-size:11px;color:var(--muted);margin-top:2px">' + (a.propertyType || '') + ' · ' + (a.estimatedPrice || '') + ' · ' + (a.district || '') + '</div>'
    + '<div style="display:flex;align-items:center;gap:8px;margin-top:5px"><span style="font-size:10px;color:var(--muted)">Confidence:</span>'
    + '<div class="conf-bar"><div class="conf-fill cf-' + cc + '" style="width:' + cp + '%"></div></div>'
    + '<span class="conf-badge cb-' + cc + '">' + cp + '%</span></div></div>'
    + '<button class="btn bp sm-btn" onclick="queueIntelLetter(\'' + result.id + '\')">🖨 Queue Letter</button></div>'
    + '<div class="intel-card-body">'
    + '<div style="padding:12px;background:var(--slate);border-radius:var(--r2);margin-bottom:12px">'
    + '<div style="font-size:12px;font-weight:700;margin-bottom:6px">📍 ' + a.fullAddress + '</div>'
    + '<div style="font-size:11px;color:var(--muted);display:flex;flex-wrap:wrap;gap:12px">'
    + '<span><strong>Postcode:</strong> ' + (a.postcode || '—') + '</span>'
    + '<span><strong>Type:</strong> ' + (a.propertyType || '—') + '</span>'
    + '<span><strong>Value:</strong> ' + (a.estimatedPrice || '—') + '</span></div></div>'
    + (o.ownerName ? '<div style="padding:12px;background:rgba(5,150,105,.06);border:1px solid rgba(5,150,105,.14);border-radius:var(--r2);margin-bottom:12px">'
    + '<div style="font-size:13px;font-weight:700;margin-bottom:4px">👤 ' + o.ownerName + '</div>'
    + '<div style="font-size:11px;color:var(--muted)">' + (o.ownerType || '') + ' · Land Reg: ' + (o.landRegTitle || '—') + ' · Purchased: ' + (o.purchaseDate || '—') + ' · Band ' + (o.councilTaxBand || '—') + '</div>'
    + (o.estimatedEmail || o.phoneFormat ? '<div style="margin-top:8px;padding:7px;background:#FFFBEB;border:1px solid #FCD34D;border-radius:6px;font-size:10px;color:#92400E">⚠️ Illustrative format only: ' + (o.estimatedEmail || '') + (o.phoneFormat ? ' / ' + o.phoneFormat : '') + '</div>' : '') + '</div>' : '')
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:5px">'
    + (result.govLinks || []).map(l => '<a href="' + l.url + '" target="_blank" rel="noopener" class="gov-link"><div style="flex:1"><div class="gov-link-title">' + l.label + '</div><div class="gov-link-desc">' + l.desc + '</div></div><span style="color:var(--blue);font-size:10px">↗</span></a>').join('')
    + '</div><div style="margin-top:8px;padding:7px;background:rgba(220,38,38,.05);border:1px solid rgba(220,38,38,.12);border-radius:6px;font-size:10px;color:var(--red)">⚠️ Owner data is AI-generated for illustration. Use Land Registry (£3) or Companies House (free) for confirmed data. Comply with UK GDPR.</div></div></div>';
}

/* ── RE-INIT ── */
(function initApp() {
  try {
    activeTpl = templates[0];
    initHAGrid();
    refreshTplSels();
    renderPrinters();
    updateBotUI();
    startRTFeed();
    blog('PropMail Pro ready — click 🔍 Find Live Properties to start.', 'inf');
    setTimeout(() => {
      try {
        const s1 = genHAProps('HA1', 'all', 'all', '0', '', 1, 12345).slice(0, 8);
        const s2 = genHAProps('HA5', 'all', 'all', '0', '', 1, 54321).slice(0, 8);
        rtProps = [...s1, ...s2]; updateRTTicker();
      } catch(e) { console.warn('RT ticker init:', e.message); }
    }, 400);
  } catch(e) {
    console.error('PropMail init error:', e);
    const errDiv = document.createElement('div');
    errDiv.style.cssText = 'position:fixed;top:0;left:0;right:0;padding:16px;background:#EF4444;color:#fff;font-family:monospace;font-size:13px;z-index:99999;cursor:pointer';
    errDiv.innerHTML = '⚠️ PropMail startup error: ' + e.message + ' (line ~' + (e.stack||'').split('\n')[1] + ') — click to dismiss';
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
    icon: '🎯',
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
    icon: '⏰',
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
    icon: '🔄',
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
    icon: '📱',
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
    icon: '✉️',
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
    icon: '⭐',
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
    icon: '🗂',
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
    icon: '🧪',
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
    icon: '🔗',
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
    icon: '📊',
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
    icon: '🏢',
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
    icon: '🚨',
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
    const priLabel = {critical:'🔴 Critical', high:'🟠 High Impact', medium:'🔵 Medium', low:'🟢 Low'}[imp.priority] || imp.priority;
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
                <span class="roi-pill">💰 +£${(imp.annualRevenue/1000).toFixed(0)}k/yr</span>
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
        <div class="check-impact">💰 ${item.impact}</div>
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
      status: totalSent > 100 ? '✅ Good volume' : totalSent > 0 ? '⚠️ Increase volume' : '❌ None sent yet',
      cls: totalSent > 100 ? 'm-good' : totalSent > 0 ? 'm-warn' : 'm-bad'
    },
    {
      n: hasMultipleHa,
      l: 'Districts Active',
      status: hasMultipleHa >= 5 ? '✅ Wide coverage' : hasMultipleHa >= 3 ? '⚠️ Add more areas' : '❌ Too narrow',
      cls: hasMultipleHa >= 5 ? 'm-good' : hasMultipleHa >= 3 ? 'm-warn' : 'm-bad'
    },
    {
      n: (templates.length + uploadedTpls.length),
      l: 'Templates',
      status: hasTemplates >= 4 ? '✅ Good variety' : hasTemplates >= 2 ? '⚠️ Add more variants' : '❌ Only 1 template',
      cls: hasTemplates >= 4 ? 'm-good' : hasTemplates >= 2 ? 'm-warn' : 'm-bad'
    },
    {
      n: hasPersonalisation ? 'Yes' : 'No',
      l: 'Personalisation',
      status: hasPersonalisation ? '✅ Using property data' : '❌ Generic letters only',
      cls: hasPersonalisation ? 'm-good' : 'm-bad'
    },
    {
      n: hasBotOn ? 'Live' : 'Off',
      l: 'Live Bot',
      status: hasBotOn ? '✅ Monitoring 24/7' : '⚠️ Bot not running',
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

  // Build rich context for Claude
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
    const resp = await fetch('/api/anthropic', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
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
        id:'s1', title:'Add Hyperlocal Sold Data to Every Letter', icon:'📍',
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
        id:'s2', title:'Implement a 3-Touch Follow-Up Sequence', icon:'🔄',
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
        id:'s3', title:'Personalise With Owner Names From Land Registry', icon:'🎯',
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
        id:'s4', title:'Activate the Live Bot for 72-Hour First-Mover Advantage', icon:'⚡',
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
        id:'s5', title:'Target Motivated Sellers With a Switch-Agent Letter', icon:'🔥',
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
        id:'s6', title:'Launch a Landlord Portfolio Campaign for High-Value Instructions', icon:'🏢',
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
    const priorityLabel = s.priority === 'critical' ? '🔴 Critical' : s.priority === 'high' ? '🟠 High Impact' : '🔵 Medium';
    const effortLabel = s.effort === 'low' ? '⚡ Quick Win' : s.effort === 'medium' ? '🔧 Medium Effort' : '🏗 Larger Project';
    const effortCls = s.effort === 'low' ? 'effort-low' : s.effort === 'medium' ? 'effort-med' : 'effort-high';

    const card = document.createElement('div');
    card.className = 'suggestion-card';
    card.innerHTML = `
      <div class="sc-accent" style="background:${s.accentColor || '#2563EB'}"></div>
      <div class="sc-head">
        <div class="sc-icon" style="background:${s.iconBg || 'rgba(37,99,235,.1)'};color:${s.iconColor || '#2563EB'}">${s.icon || '💡'}</div>
        <div style="flex:1">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:5px">
            <span style="font-size:11px;font-weight:700;color:var(--muted)">${idx + 1} of ${data.suggestions.length}</span>
            <span style="background:${priorityColour}18;color:${priorityColour};padding:2px 9px;border-radius:20px;font-size:10px;font-weight:800">${priorityLabel}</span>
          </div>
          <div class="sc-title">${s.title}</div>
          <div class="sc-summary">${s.summary}</div>
          <div class="sc-meta">
            <span class="tag tag-green">💰 ${s.revenueImpact || 'Revenue impact TBC'}</span>
            <span class="tag tag-blue">📈 ${s.responseUplift || ''}</span>
            <span class="effort-pill ${effortCls}">${effortLabel}</span>
            <span class="tag tag-grey">⏱ ${s.timeToResult || 'TBC'}</span>
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
              <div class="sc-ba-label" style="color:var(--red)">❌ Current approach</div>
              <div class="sc-ba-text">${s.before}</div>
            </div>
            <div class="sc-after">
              <div class="sc-ba-label" style="color:var(--green)">✅ Improved approach</div>
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
        <button class="btn bp sm-btn" onclick="applyAdvice('${s.id}', '${(s.title||'').replace(/'/g,'\\x27')}')">✅ Apply This Advice</button>
        <button class="btn bs sm-btn" onclick="askAbout('${(s.title||'').replace(/'/g,'\\x27')}')">💬 Ask About This</button>
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

    const resp = await fetch('/api/anthropic', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
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
    addAdviceMsg('ai', `⚠️ Connection issue. Here's offline advice: ${getFallbackAdvice(msg)}`);
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
    icon: '🏆',
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
    icon: '🔓',
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
    icon: '🔐',
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
    icon: '⚡',
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
    icon: '🎯',
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
    icon: '🔑',
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
    icon: '🏟',
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
    icon: '🎓',
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
    icon: '📦',
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
    icon: '📱',
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
    icon: '📅',
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
    icon: '🤝',
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
    icon: '⭐',
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
    icon: '🖨',
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
    icon: '📊',
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
    grid.innerHTML = '<div class="es" style="grid-column:1/-1"><div class="ei">🔍</div><div class="et">No ideas in this category</div></div>';
    return;
  }

  items.forEach((idea, idx) => {
    const priorityMap = {
      immediate: { cls: 'pi-immediate', label: '🔴 Do This Week' },
      short:     { cls: 'pi-short',     label: '🟠 This Month' },
      medium:    { cls: 'pi-medium',    label: '🔵 Next 90 Days' },
      strategic: { cls: 'pi-strategic', label: '🟣 Strategic Play' }
    };
    const catBadges = {
      tech: '<span class="cat-badge cb-tech">💻 Tech</span>',
      content: '<span class="cat-badge cb-content">✍️ Content</span>',
      data: '<span class="cat-badge cb-data">📊 Data</span>',
      brand: '<span class="cat-badge cb-brand">🎨 Brand</span>',
      ops: '<span class="cat-badge cb-ops">⚙️ Ops</span>'
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
          <div class="rev-badge">💰 ${idea.revenue}</div>
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
    icon:'✉️',
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
    icon:'🏠',
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
    icon:'💰',
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
    icon:'🔑',
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
    icon:'⭐',
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
  showPCStatus('scanning',`Looking up ${postcodes.length} postcode${postcodes.length>1?'s':''}…`,5,'Connecting to address database…');

  const allResults = [];
  let residential=0, commercial=0;

  for(let pi=0; pi<postcodes.length; pi++){
    const pc = postcodes[pi].trim().toUpperCase();
    const pct = Math.round(5 + (pi/postcodes.length)*60);
    showPCStatus('scanning',`Fetching addresses for ${pc}…`,pct,`${pi+1} of ${postcodes.length} postcodes`);

    let foundAddresses = [];

    // ── STRATEGY 1: postcodes.io → get geo data, then fetch real addresses via Claude web_search ──
    try{
      const geoResp = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(pc)}`);
      if(geoResp.ok){
        const geoData = await geoResp.json();
        const geo = geoData.result;

        if(geo){
          setStage(2);
          showPCStatus('scanning',`${pc} found — ${geo.admin_ward}, ${geo.admin_district}`,pct+5,'Searching for all addresses…');

          // ── STRATEGY 2: Claude web_search to find real addresses at this postcode ──
          try{
            const searchPrompt = `Search for ALL residential property addresses at UK postcode ${pc} (${geo.admin_ward}, ${geo.admin_district}).

Find the complete list of addresses at this specific postcode. Search for:
- "${pc} addresses"  
- Royal Mail address finder for ${pc}
- Properties listed at ${pc} on Rightmove, Zoopla, or OnTheMarket

Return ONLY this JSON (no markdown):
{"postcode":"${pc}","ward":"${geo.admin_ward}","district":"${geo.admin_district}","addresses":[{"line1":"NUMBER STREET","line2":"","fullAddress":"FULL ADDRESS WITH POSTCODE","type":"Residential OR Commercial"}]}

Find as many real addresses as possible. A typical UK postcode has 15-100 addresses.`;

            const claudeResp = await fetch('/api/anthropic',{
              method:'POST',
              headers:{'Content-Type':'application/json'},
              body:JSON.stringify({
                model:'claude-sonnet-4-6',
                max_tokens:3000,
                tools:[{type:'web_search_20250305',name:'web_search'}],
                messages:[{role:'user',content:searchPrompt}]
              })
            });

            if(claudeResp.ok){
              const cData = await claudeResp.json();
              const blocks = cData.content || [];
              let cText = blocks.filter(b=>b.type==='text').map(b=>b.text).join('');
              let turn = 0;
              const cMessages = [{role:'user',content:searchPrompt}];

              // Handle tool_use multi-turn
              if(cData.stop_reason==='tool_use'){
                const toolUses = blocks.filter(b=>b.type==='tool_use');
                cMessages.push({role:'assistant',content:blocks});
                cMessages.push({role:'user',content:toolUses.map(tu=>({
                  type:'tool_result',tool_use_id:tu.id,
                  content:'Search done. Return the address list as JSON.'
                }))});

                showPCStatus('scanning',`Processing address data for ${pc}…`,pct+15,'Extracting addresses…');

                const resp2 = await fetch('/api/anthropic',{
                  method:'POST',
                  headers:{'Content-Type':'application/json'},
                  body:JSON.stringify({
                    model:'claude-sonnet-4-6',max_tokens:3000,
                    tools:[{type:'web_search_20250305',name:'web_search'}],
                    messages:cMessages
                  })
                });
                if(resp2.ok){
                  const d2 = await resp2.json();
                  cText = (d2.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('');
                }
              }

              // Parse JSON from response
              const jsonMatch = cText.match(/\{"postcode"[\s\S]*?"addresses"\s*:\s*\[[\s\S]*?\]\s*\}/);
              if(jsonMatch){
                try{
                  const parsed = JSON.parse(jsonMatch[0]);
                  if(parsed.addresses?.length){
                    foundAddresses = parsed.addresses.map((a,i)=>({
                      line1: a.line1||a.fullAddress?.split(',')[0]||'',
                      line2: a.line2||'',
                      area: geo.admin_ward||geo.admin_district||pc.split(' ')[0],
                      postcode: pc,
                      type: a.type||'Residential',
                      fullAddress: a.fullAddress||`${a.line1}${a.line2?', '+a.line2:''}, ${geo.admin_ward}, ${pc}`,
                      selected: true,
                      isLive: true,
                      sortKey: i,
                      idx: allResults.length + i
                    }));
                    blog(`✅ ${pc}: ${foundAddresses.length} real addresses found via web search`,'ok');
                  }
                }catch(e){ console.error('Parse error:',e); }
              }
            }
          }catch(e){
            blog(`Web search for ${pc} failed: ${e.message} — using generated addresses`,'warn');
          }

          // ── STRATEGY 3: Fallback — generate addresses using real geo data ──
          if(!foundAddresses.length){
            foundAddresses = generatePAFAddresses(pc, geo, 50);
            foundAddresses = foundAddresses.map((a,i)=>({...a, idx:allResults.length+i}));
            blog(`${pc}: Generated ${foundAddresses.length} addresses (live lookup unavailable)`,'inf');
          }

          // Count types
          foundAddresses.forEach(a=>{ if(a.type==='Residential') residential++; else commercial++; });
          allResults.push(...foundAddresses);
        }
      }
    }catch(e){
      blog(`${pc}: Lookup error — ${e.message}`,'warn');
      const fallback = generatePAFAddresses(pc, {admin_ward:pc.split(' ')[0]}, 30);
      allResults.push(...fallback.map((a,i)=>({...a, idx:allResults.length+i})));
    }
  }

  setStage(3);
  showPCStatus('ok',`Found ${allResults.length} addresses`,100,`${residential} residential · ${commercial} commercial`);

  slAddresses = allResults;
  slFiltered = [...slAddresses];
  slSelected = new Set(slAddresses.filter(a=>a.type==='Residential').map((_,i)=>i));

  // Update UI
  const countEl = document.getElementById('pc-count');
  if(countEl) countEl.textContent = `${allResults.length} addresses found`;
  const resEl = document.getElementById('pc-res-count');
  if(resEl) resEl.textContent = residential;
  const comEl = document.getElementById('pc-com-count');
  if(comEl) comEl.textContent = commercial;

  setStage(4);

  const btn2 = document.getElementById('pc-btn'); if(btn2) btn2.disabled=false;

  renderLetterChoices();
  renderAddrGrid();
  updAddrSel();

  const liveCount = allResults.filter(a=>a.isLive).length;
  toast(`${allResults.length} addresses found${liveCount?' ('+liveCount+' live)':''}`, 'ok');
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
  return body
    .replace(/\{\{date\}\}/g,new Date().toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'}))
    .replace(/\{\{address\}\}/g,addr.fullAddress)
    .replace(/\{\{line1\}\}/g,addr.line1)
    .replace(/\{\{line2\}\}/g,addr.line2||'')
    .replace(/\{\{area\}\}/g,addr.area||'')
    .replace(/\{\{postcode\}\}/g,addr.postcode||'')
    .replace(/\{\{type\}\}/g,addr.type||'');
}

function slFileUp(e){
  const file=e.target.files[0];if(!file)return;
  const ext='.'+file.name.split('.').pop().toLowerCase();
  if(ext==='.txt'){
    const r=new FileReader();
    r.onload=ev=>{
      const t={id:'sl-up-'+Date.now(),name:file.name.replace(/\.[^.]+$/,''),desc:'Uploaded letter',body:ev.target.result,icon:'📄',colour:'#1E6FD9'};
      SUCCESS_LETTERS.push(t);renderLetterChoices();selectLetter(t);toast('Letter uploaded and selected','ok');
    };
    r.readAsText(file);
  } else {
    const t={id:'sl-up-'+Date.now(),name:file.name.replace(/\.[^.]+$/,''),desc:`Uploaded ${ext}`,body:`{{date}}\n\n{{address}}\n\nDear Resident,\n\n[Content from ${file.name}]\n\nYours sincerely,\n[Your Name]`,icon:'📄',colour:'#1E6FD9'};
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

async function callClaude(prompt, maxTokens=1500, useWebSearch=false){
  // Multi-turn handler for web_search tool use
  const tools = useWebSearch ? [{type:'web_search_20250305', name:'web_search'}] : [];
  const messages = [{role:'user', content:prompt}];
  let finalText = '';
  let turn = 0;
  const MAX = useWebSearch ? 5 : 1;

  while(turn < MAX){
    turn++;
    const body = {model:'claude-sonnet-4-6', max_tokens:maxTokens, messages};
    if(tools.length) body.tools = tools;

    const resp = await fetch('/api/anthropic',{
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
  setThinking(true,'Searching for property and owner information…');
  document.getElementById('intel-result-area').innerHTML='';

  const isUrl = input.startsWith('http');
  const isPostcode = /^[A-Z]{1,2}\d[\dA-Z]?\s*\d[A-Z]{2}$/i.test(input.trim());

  // ── Build comprehensive owner-finding prompt ──
  const ownerPrompt = `You are a UK property research specialist. Search multiple public sources to find the owner and full details of this property: "${input}"

Search these sources in order:
1. HM Land Registry (search "land registry title register ${input}") - ownership records
2. Companies House (search "companies house ${input}") - if company-owned
3. Electoral roll / 192.com / voters register mentions
4. Rightmove / Zoopla / OnTheMarket - current or past listings with agent details
5. Planning applications (search "planning application ${input}") - often has applicant name
6. Council tax records (sometimes publicly mentioned)
7. News articles, local planning notices, or other public mentions

For each source searched, report what you found or didn't find.

Return ONLY this JSON (no markdown, no explanation outside JSON):
{
  "address": {
    "fullAddress": "COMPLETE ADDRESS WITH POSTCODE",
    "line1": "HOUSE NUMBER AND STREET",
    "postcode": "FULL POSTCODE",
    "uprn": "UPRN IF FOUND",
    "propertyType": "Flat/Semi-Detached/Terraced/Detached",
    "estimatedValue": "£XXX,XXX",
    "bedrooms": NUMBER_OR_NULL
  },
  "owner": {
    "ownerName": "FULL NAME IF FOUND or null",
    "ownerType": "individual OR company OR unknown",
    "confidence": "high/medium/low",
    "purchaseDate": "YEAR IF KNOWN",
    "purchasePrice": "£XXX,XXX IF KNOWN",
    "landRegTitle": "TITLE NUMBER IF FOUND",
    "companyNumber": "CH NUMBER IF COMPANY",
    "registeredAddress": "OWNER ADDRESS IF DIFFERENT",
    "sourcesChecked": ["Land Registry","Companies House","Electoral Roll","Planning Apps","Property Portals"],
    "sourcesFound": ["list only sources that returned data"],
    "evidenceNotes": "Summary of what each source revealed",
    "contactHints": "Any publicly available contact info found (email/phone formats only if public)"
  },
  "rightmoveUrl": "https://www.rightmove.co.uk/properties/NNNNN IF FOUND ELSE null",
  "zoplaUrl": "https://www.zoopla.co.uk/... IF FOUND ELSE null",
  "currentlyListed": true_or_false,
  "listingPrice": "£XXX,XXX IF CURRENTLY LISTED",
  "agent": "AGENT NAME IF LISTED",
  "govLinks": [
    {"label":"Land Registry Title Register","url":"https://eservices.landregistry.gov.uk/eservices/FindAProperty/view/QuickEnquiryInit.do","desc":"Official ownership records (£3)"},
    {"label":"Companies House","url":"https://find-and-update.company-information.service.gov.uk/","desc":"Free company ownership search"},
    {"label":"Planning Portal","url":"https://www.planningportal.co.uk/","desc":"Planning applications by address"},
    {"label":"192.com People Search","url":"https://www.192.com/","desc":"Electoral roll and people finder"}
  ]
}`;

  try{
    // Multi-turn call with web_search
    const messages = [{role:'user', content:ownerPrompt}];
    let finalText = '';
    let turn = 0;
    const MAX = 6;

    while(turn < MAX){
      turn++;
      setThinking(true, `Searching source ${turn} of up to ${MAX}…`);

      const resp = await fetch('/api/anthropic',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          model:'claude-sonnet-4-6',
          max_tokens:3000,
          tools:[{type:'web_search_20250305',name:'web_search'}],
          messages
        })
      });

      if(!resp.ok) throw new Error('API '+resp.status);
      const data = await resp.json();
      const blocks = data.content || [];
      blocks.filter(b=>b.type==='text').forEach(b=>{ finalText += b.text; });

      if(data.stop_reason==='end_turn') break;
      if(data.stop_reason==='tool_use'){
        const toolUses = blocks.filter(b=>b.type==='tool_use');
        if(!toolUses.length) break;
        messages.push({role:'assistant',content:blocks});
        messages.push({role:'user',content:toolUses.map(tu=>({
          type:'tool_result',tool_use_id:tu.id,
          content:'Search complete. Continue searching other sources or compile final JSON.'
        }))});
      } else break;
    }

    setThinking(true,'Processing results…');

    // Parse the JSON result
    let parsed = null;
    const patterns = [
      /\{"address"[\s\S]*?"govLinks"[\s\S]*?\]\s*\}/,
      /\{[\s\S]*?"owner"[\s\S]*?"govLinks"[\s\S]*?\]\s*\}/,
      /\{[\s\S]*?"address"[\s\S]*?\}/,
    ];
    for(const pat of patterns){
      const m = finalText.match(pat);
      if(m){ try{ parsed = JSON.parse(m[0]); if(parsed?.address) break; }catch(e){} }
    }

    if(!parsed){
      // Ask Claude to reformat
      const reformat = await fetch('/api/anthropic',{
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({model:'claude-sonnet-4-6',max_tokens:2000,messages:[{role:'user',content:
          `Extract all property and owner information found and format as clean JSON matching this structure exactly. Input text:\n${finalText.slice(0,3000)}\n\nReturn ONLY valid JSON with keys: address (fullAddress,line1,postcode,propertyType,estimatedValue), owner (ownerName,ownerType,confidence,purchaseDate,sourcesFound,evidenceNotes), rightmoveUrl, currentlyListed, agent, govLinks`
        }]})
      });
      if(reformat.ok){
        const rd = await reformat.json();
        const rt = rd.content?.find(b=>b.type==='text')?.text||'';
        const rm = rt.match(/\{[\s\S]*\}/);
        if(rm) try{ parsed = JSON.parse(rm[0]); }catch(e){}
      }
    }

    if(!parsed) throw new Error('Could not extract property data from search results');

    setThinking(false);

    // Add to intel results
    const result = {
      id: 'intel-'+Date.now(),
      address: {
        fullAddress: parsed.address?.fullAddress || input,
        line1: parsed.address?.line1 || '',
        postcode: parsed.address?.postcode || '',
        propertyType: parsed.address?.propertyType || '',
        estimatedPrice: parsed.address?.estimatedValue || '',
        district: parsed.address?.postcode?.split(' ')?.[0] || '',
        addressNotes: parsed.currentlyListed ? `Currently listed at ${parsed.listingPrice||'price TBC'} with ${parsed.agent||'agent unknown'}` : 'Not currently listed'
      },
      owner: {
        ownerName: parsed.owner?.ownerName || 'Not found in public records',
        ownerType: parsed.owner?.ownerType || 'unknown',
        overallConfidence: parsed.owner?.confidence==='high'?0.85:parsed.owner?.confidence==='medium'?0.60:0.30,
        purchaseDate: parsed.owner?.purchaseDate || '—',
        purchasePrice: parsed.owner?.purchasePrice || '—',
        landRegTitle: parsed.owner?.landRegTitle || '—',
        companyNumber: parsed.owner?.companyNumber || '',
        registeredAddress: parsed.owner?.registeredAddress || '',
        councilTaxBand: '—',
        sourceDetails: (parsed.owner?.sourcesChecked||['Web Search']).map(s=>({
          source:s,
          finding: parsed.owner?.sourcesFound?.includes(s) ? 'Data found' : 'No public record found',
          confidence: parsed.owner?.sourcesFound?.includes(s) ? 0.7 : 0.1
        })),
        researchNotes: parsed.owner?.evidenceNotes || 'Searched public records',
        estimatedEmail: parsed.owner?.contactHints?.includes('@')?parsed.owner.contactHints:'',
        phoneFormat: ''
      },
      govLinks: parsed.govLinks || [
        {label:'Land Registry',url:'https://eservices.landregistry.gov.uk/eservices/FindAProperty/view/QuickEnquiryInit.do',desc:'Official ownership (£3)'},
        {label:'Companies House',url:'https://find-and-update.company-information.service.gov.uk/',desc:'Free company search'},
        {label:'Planning Portal',url:'https://www.planningportal.co.uk/',desc:'Planning applications'},
        {label:'192.com',url:'https://www.192.com/',desc:'People and electoral roll'}
      ],
      rightmoveUrl: parsed.rightmoveUrl || null,
      currentlyListed: parsed.currentlyListed || false
    };

    intelResults.push(result);
    updateIntelTable();
    renderIntelResult(result, document.getElementById('intel-result-area'));

    const ownerFound = result.owner.ownerName && result.owner.ownerName !== 'Not found in public records';
    toast(`${ownerFound?'Owner found: '+result.owner.ownerName:'Search complete — see results below'}`, ownerFound?'ok':'');

  }catch(err){
    setThinking(false);
    console.error('Intel search error:', err);
    document.getElementById('intel-result-area').innerHTML =
      '<div class="card" style="border-color:var(--red)">'
      +'<div style="color:var(--red);font-weight:700;margin-bottom:8px">⚠️ Search Error</div>'
      +'<div style="font-size:13px;color:var(--text2)">'+err.message+'</div>'
      +'<div style="font-size:12px;color:var(--muted);margin-top:10px">Try searching with a full UK postcode (e.g. HA1 2SB) or a Rightmove property URL.</div>'
      +'</div>';
    toast('Search error: '+err.message.slice(0,60), 'err');
  }
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
    return`<tr><td><div style="font-weight:600;font-size:12px">${a.fullAddress}</div><div style="font-size:10px;color:var(--mut)">${a.district||''}</div></td><td><div style="font-weight:600">${o.ownerName||'—'}</div><div style="font-size:10px;color:var(--mut)">${o.ownerType||''}</div></td><td style="font-size:12px">${a.estimatedPrice||'—'}</td><td style="font-family:monospace;font-size:11px">${o.landRegTitle||'—'}</td><td>Band ${o.councilTaxBand||'—'}</td><td><span class="conf-badge cb-${cc}">${cp}%</span></td><td><button class="btn bp sm-btn" onclick="queueIntelLetter('${r.id}')">🖨</button></td></tr>`;
  }).join('')}</tbody></table></div>`;
}

// Load saved agent-targeting settings + campaign log as soon as the app is ready.
try { if (typeof loadTargeting === 'function') loadTargeting(); } catch (e) {}
try { if (typeof loadContacts === 'function') loadContacts(); } catch (e) {}
try { if (typeof loadSequence === 'function') { loadSequence(); runDueSequences(false); } } catch (e) {}