const assert=require('node:assert/strict');
const {fixture}=require('./test_frontend_cleanup.cjs');
const plain=value=>JSON.parse(JSON.stringify(value));
function inventory(){
 const f=fixture(),p=f.p;p.tab='batteries';p.inventoryQuery='';p.inventoryLayout='cards';
 p.data.devices.d.name='Zoé Küchensensor';p.data.devices.d.battery_type='AA';p.data.devices.d.battery_quantity=2;
 p.data.devices.linked.name='Mara Türsensor';
 Object.assign(p.data.settings,{
  battery_inventory:{AA:3,CR2032:0},battery_inventory_thresholds:{AA:2,CR2032:0},
  battery_device_links:{CR2032:['linked']},battery_notes:{AA:'Trocken & kühl lagern'},
  battery_shop_urls:{AA:'https://example.invalid/batteries?pack=2&size=aa'},
  consumables:{
   filter:{id:'filter',name:'Wasserfilter',unit:'Stück',quantity:null,threshold:1,notes:'Für die Küche',device_ids:['d'],shop_url:'https://example.invalid/filters'},
   salt:{id:'salt',name:'Entkalkersalz',unit:'kg',quantity:-1.5,threshold:0.5,notes:'Sack im Keller',device_ids:[]}
  }
 });
 return f;
}
function ids(p){return plain(p.inventoryItems().filter(item=>p.inventoryMatches(item)).map(item=>item.id));}
(async()=>{
 {
  const {p}=inventory(),nodes=new Map(),root={innerHTML:'',querySelector:selector=>nodes.get(selector)||null,querySelectorAll:()=>[],addEventListener(){}};
  for(const selector of ['#search','#clearsearch','#categoryfilter','#area','#taskperiod'])nodes.set(selector,{value:'',hidden:false,focus(){this.focused=true;}});
  p.shadowRoot=root;let bodies=0;p.body=()=>bodies++;p.renderCompletionUndo=()=>{};
  p.draw();assert(root.innerHTML.includes('<div class="toolbar" >'),'inventory search is visible');
  assert(root.innerHTML.includes('placeholder="Verbrauchsmaterial suchen"'));assert(root.innerHTML.includes('aria-label="Suchbegriff löschen"'));
  const input=nodes.get('#search');input.oninput({target:{value:'zoe'}});assert.equal(p.inventoryQuery,'zoe');assert.equal(bodies,2,'typing filters immediately through the existing body renderer');
  await p.act('clearsearch');assert.equal(p.inventoryQuery,'');assert.equal(input.value,'');assert(input.focused);assert(nodes.get('#clearsearch').hidden);
 }
 {
  const {p}=inventory(),before=plain(p.data);
  p.query='Gerätesuche';p.taskQuery='Aufgabensuche';p.logQuery='Logsuche';
  assert.equal(p.searchKey(),'inventoryQuery');assert.equal(p.searchQuery(),'');
  for(const [query,expected] of [
   ['wasser',['filter']],['KUCHE',['AA','filter']],['trocken',['AA']],['zoe',['AA','filter']],
   ['mara',['CR2032']],['example filters',['filter']],['keller',['salt']],['fehlender artikel',[]]
  ]){p.inventoryQuery=query;assert.deepEqual(ids(p),expected,query);}
  p.inventoryQuery='';assert.equal(ids(p).length,4);
  assert.equal(p.query,'Gerätesuche');assert.equal(p.taskQuery,'Aufgabensuche');assert.equal(p.logQuery,'Logsuche');
  assert.deepEqual(plain(p.data),before,'searching must not mutate any records or stock');
 }
 {
  const {p,body}=inventory(),before=plain(p.data);
  p.body();assert(body.innerHTML.includes('4 Artikel'));assert(body.innerHTML.includes('device-grid'));assert(body.innerHTML.includes('data-id="cards" aria-pressed="true"'));
  p.filterChanged('inventoryQuery','wasser');assert(body.innerHTML.includes('1 von 4 Artikeln'));assert(body.innerHTML.includes('Wasserfilter'));assert(!body.innerHTML.includes('Entkalkersalz'));
  await p.act('inventorylayout','list');assert.equal(p.inventoryLayout,'list');assert.equal(p.inventoryQuery,'wasser');
  assert(body.innerHTML.includes('class="inventory-list" role="list"'));assert.equal((body.innerHTML.match(/role="listitem"/g)||[]).length,1);
  assert(body.innerHTML.includes('data-id="list" aria-pressed="true"'));
  assert(body.innerHTML.includes('Bestand unbekannt Stück ändern'));assert(body.innerHTML.includes('Nachkaufen ab'));assert(body.innerHTML.includes('Für die Küche'));
  p.filterChanged('inventoryQuery','nichts');assert(body.innerHTML.includes('0 von 4 Artikeln'));assert(body.innerHTML.includes('Keine passenden Artikel'));assert(!body.innerHTML.includes('role="listitem"'));
  const input={value:'nichts',focus(){this.focused=true;}},clear={hidden:false};
  const old=p.shadowRoot.querySelector;p.shadowRoot.querySelector=selector=>selector==='#search'?input:selector==='#clearsearch'?clear:old(selector);
  await p.act('clearsearch');assert.equal(p.inventoryQuery,'');assert.equal(input.value,'');assert(input.focused);assert(clear.hidden);
  assert.equal((body.innerHTML.match(/role="listitem"/g)||[]).length,4);
  await p.act('inventorylayout','cards');assert(body.innerHTML.includes('class="row inventory-item"'));assert.equal(p.inventoryLayout,'cards');
  assert.deepEqual(plain(p.data),before,'layout switches and clear search must never write inventory data');
 }
 {
  const {p,body}=inventory();p.inventoryLayout='list';p.body();
  for(const [action,id] of [['batterystock','AA'],['editbatterytype','AA'],['deletebatterytype','AA'],['requestpurchase','battery:AA'],['materialstock','salt'],['material','salt'],['deletematerial','salt'],['requestpurchase','material:salt']]){
   assert(body.innerHTML.includes('data-action="'+action+'" data-id="'+id+'"'),action+' remains available in list layout');
  }
  assert(body.innerHTML.includes('inventory-list-stock'));assert(body.innerHTML.includes('-1.5'));assert(body.innerHTML.includes('kg'));assert(body.innerHTML.includes('0.5'));
  assert(body.innerHTML.includes('data-preserve-key="battery-usage:AA"'));assert(body.innerHTML.includes('data-preserve-key="material-usage:filter"'));
  assert(body.innerHTML.includes('Zoé Küchensensor · 2 Batterien'));assert(body.innerHTML.includes('inventory-menu'),'list uses the existing native overflow menu');
 }
 {
  const {p}=inventory();
  for(const url of ['https://example.invalid/path?x=1&y=2','http://example.invalid:8080/products','https://münchen.example/path','http://127.0.0.1:8123/products','https://[::1]:8123/']){
   assert.equal(p.safeShopUrl(url),url,url);
  }
  for(const url of ['javascript:alert(1)','data:text/html,x','file:///tmp/x','//example.invalid','https://user:pass@example.invalid','https://@example.invalid','https://example.invalid\\bad','https://example.invalid/with space','https://example.invalid/\npath','https://_bad.example','https://-bad.example','https://example.invalid:0','https://example.invalid:65536','https://','https://example.invalid/'+ 'x'.repeat(2048),null,12]){
   assert.equal(p.safeShopUrl(url),'',String(url));
  }
  const link=p.shopLink('https://example.invalid/?a="x"&b=2','Salz <Test>');
  assert(link.includes('target="_blank"'));assert(link.includes('rel="noopener noreferrer"'));
  assert(link.includes('href="https://example.invalid/?a=&quot;x&quot;&amp;b=2"'));assert(link.includes('Salz &lt;Test&gt;'));
  assert.equal(p.shopLink('javascript:alert(1)','Unsafe'),'');
  assert(p.shopField('https://example.invalid/?x="y"').includes('type="url" maxlength="2048"'));assert(p.shopField().includes('Shop-Link (optional)'));
  assert.deepEqual(plain(p.shopFormValue(new Map())),{});assert.deepEqual(plain(p.shopFormValue(new Map([['shop_url','  ']]))),{shop_url:''});
  assert.throws(()=>p.shopFormValue(new Map([['shop_url','javascript:alert(1)']])),/gültigen Shop-Link/);
 }
 {
  const {p,body}=inventory();p.body();assert.equal((body.innerHTML.match(/class="shop-link"/g)||[]).length,2,'cards expose valid battery and material shops');
  p.tab='tasks';p.taskPeriod='now';p.taskQuery='';p.data.shopping={b:{id:'b',name:'AA nachkaufen',battery_type:'AA',done:false},m:{id:'m',name:'Filter nachkaufen',consumable_id:'filter',done:false}};p.body();
  assert.equal((body.innerHTML.match(/class="shop-link"/g)||[]).length,2,'purchase cards resolve the linked article shop without copied URLs');
  p.data.settings.battery_shop_urls.AA='javascript:alert(1)';p.data.settings.consumables.filter.shop_url='https://bad host/';p.body();assert(!body.innerHTML.includes('class="shop-link"'),'unsafe stored values never become links');
 }
 {
  const {p}=inventory();let dialog,writes=[];p.modal=(title,html,save)=>dialog={title,html,save};p.change=async(action,payload)=>writes.push({action,payload:plain(payload)});p.usageDeviceEditor=()=>'';p.readRelatedDevices=()=>[];
  await p.act('material','filter');assert(dialog.html.includes('Shop-Link (optional)'));assert(dialog.html.includes('https://example.invalid/filters'));assert.equal(writes.length,0);
  await dialog.save(new Map([['name','Wasserfilter'],['unit','Stück'],['quantity',''],['threshold','1'],['notes','Für die Küche'],['shop_url',' https://example.invalid/new-filter ']]));
  assert.equal(writes.pop().payload.value.shop_url,'https://example.invalid/new-filter');
  await p.act('materialstock','filter');await dialog.save(new Map([['quantity','2.5']]));assert.equal(writes.pop().payload.value.shop_url,'https://example.invalid/filters','stock-only material edit retains shop');
  await p.act('editbatterytype','AA');assert(dialog.html.includes('example.invalid/batteries'));await dialog.save(new Map([['battery_type','AA'],['quantity','3'],['threshold','2'],['notes','Trocken'],['shop_url','']]));
  assert.equal(writes.pop().payload.shop_url,'','clearing the battery field explicitly removes its URL');
  await p.act('batterystock','AA');await dialog.save(new Map([['quantity','4']]));assert.deepEqual(writes.pop(),{action:'battery_inventory',payload:{stocks:{AA:4}}},'stock-only battery changes leave shop settings untouched');
  await p.act('addbatterytype');await dialog.save(new Map([['battery_type','CR2450'],['quantity','1'],['threshold','1'],['notes',''],['shop_url','https://example.invalid/cr2450']]));
  assert.deepEqual(writes.pop().payload.shop_urls,{CR2450:'https://example.invalid/cr2450'});
  await p.act('material');await dialog.save(new Map([['name','Reiniger'],['unit','Liter'],['quantity','1'],['threshold','0'],['notes',''],['shop_url','']]));
  assert.equal(writes.pop().payload.value.shop_url,'');
 }
 console.log('PASS: Inventarsuche und Listenumschalter bleiben unabhängig und ohne Datenmutation; sichere Shop-Links, Mengen, Aktionen und Formular-/Bestandspayloads bleiben korrekt.');
})().catch(error=>{console.error(error);process.exitCode=1;});
