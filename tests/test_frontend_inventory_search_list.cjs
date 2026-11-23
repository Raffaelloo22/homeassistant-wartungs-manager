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
 const toolbar=[];p.syncInventoryToolbar=(count,list)=>toolbar.push({count,list});
 return {...f,toolbar};
}
function ids(p){return plain(p.inventoryItems().filter(item=>p.inventoryMatches(item)).map(item=>item.id));}
(async()=>{
 {
  const {p}=inventory(),nodes=new Map(),root={innerHTML:'',querySelector:selector=>nodes.get(selector)||null,querySelectorAll:()=>[],addEventListener(){}};
  for(const selector of ['#search','#clearsearch','#categoryfilter','#area','#taskperiod'])nodes.set(selector,{value:'',hidden:false,focus(){this.focused=true;}});
  p.shadowRoot=root;let bodies=0;p.body=()=>bodies++;p.renderCompletionUndo=()=>{};
  p.draw();assert(root.innerHTML.includes('<div class="toolbar inventory-toolbar" >'),'inventory search, count and layout share one toolbar');
  assert(root.innerHTML.includes('placeholder="Verbrauchsmaterial suchen"'));assert(root.innerHTML.includes('aria-label="Suchbegriff löschen"'));
  assert(root.innerHTML.indexOf('class="searchbox"')<root.innerHTML.indexOf('id="inventory-count"')&&root.innerHTML.indexOf('id="inventory-count"')<root.innerHTML.indexOf('id="inventory-layout"'),'search, count and layout switch appear in that order in the common toolbar');
  assert(root.innerHTML.includes('data-action="inventorylayout" data-id="cards"'));assert(root.innerHTML.includes('data-action="inventorylayout" data-id="list"'));
  const input=nodes.get('#search');input.oninput({target:{value:'zoe'}});assert.equal(p.inventoryQuery,'zoe');assert.equal(bodies,2,'typing filters immediately through the existing body renderer');
  await p.act('clearsearch');assert.equal(p.inventoryQuery,'');assert.equal(input.value,'');assert(input.focused);assert(nodes.get('#clearsearch').hidden);
 }
 {
  const {p}=inventory(),counter={textContent:'4 Artikel'},attributes=[{},{}],cards={setAttribute:(key,value)=>attributes[0][key]=value},list={setAttribute:(key,value)=>attributes[1][key]=value};
  const nodes=new Map([['#inventory-count',counter],['#inventory-layout [data-id="cards"]',cards],['#inventory-layout [data-id="list"]',list]]);
  p.shadowRoot={innerHTML:'Existing toolbar with current search focus',querySelector:selector=>nodes.get(selector)||null};
  const sync=Object.getPrototypeOf(p).syncInventoryToolbar;
  sync.call(p,'1 von 4 Artikeln',true);assert.equal(counter.textContent,'1 von 4 Artikeln');assert.deepEqual(attributes,[{'aria-pressed':'false'},{'aria-pressed':'true'}]);
  sync.call(p,'4 Artikel',false);assert.equal(counter.textContent,'4 Artikel');assert.deepEqual(attributes,[{'aria-pressed':'true'},{'aria-pressed':'false'}]);
  assert.equal(p.shadowRoot.innerHTML,'Existing toolbar with current search focus','updating count and layout state does not rebuild the search toolbar');
  p.shadowRoot.querySelector=()=>null;assert.doesNotThrow(()=>sync.call(p,'0 Artikel',true),'other views do not require inventory controls');
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
  const {p,body,toolbar}=inventory(),before=plain(p.data);
  p.body();assert.deepEqual(toolbar.at(-1),{count:'4 Artikel',list:false});assert(body.innerHTML.includes('device-grid'));assert(body.innerHTML.includes('inventory-intro'),'cards retain their stock explanation');assert(!body.innerHTML.includes('inventory-view-switch'),'the layout toolbar is not duplicated in the body');
  p.filterChanged('inventoryQuery','wasser');assert.equal(toolbar.at(-1).count,'1 von 4 Artikeln');assert(body.innerHTML.includes('Wasserfilter'));assert(!body.innerHTML.includes('Entkalkersalz'));
  await p.act('inventorylayout','list');assert.equal(p.inventoryLayout,'list');assert.equal(p.inventoryQuery,'wasser');
  assert.deepEqual([...body.innerHTML.matchAll(/role="list" aria-label="([^"]+)"/g)].map(match=>match[1]),['Weitere Verbrauchsmaterialien'],'only the group containing the search result is shown');assert.equal((body.innerHTML.match(/role="listitem"/g)||[]).length,1);assert(body.innerHTML.includes('Weitere Verbrauchsmaterialien<span class="tag count-tag">1</span>'),'group counts follow the filtered rows');assert(!body.innerHTML.includes('inventory-intro'),'the stock explanation is hidden in the compact list');
  assert.equal(toolbar.at(-1).list,true);
  assert(body.innerHTML.includes('?')&&body.innerHTML.includes('Stück'),'unknown stock remains visible as text');
  assert(!body.innerHTML.includes('Bestand unbekannt Stück ändern'));assert(!body.innerHTML.includes('Nachkaufen ab'));assert(!body.innerHTML.includes('Für die Küche'),'notes remain searchable without expanding the compact stock list');
  p.filterChanged('inventoryQuery','cr2032');assert.equal(toolbar.at(-1).count,'1 von 4 Artikeln');assert.deepEqual([...body.innerHTML.matchAll(/role="list" aria-label="([^"]+)"/g)].map(match=>match[1]),['Batterien'],'battery-only searches hide the empty material group');
  p.filterChanged('inventoryQuery','nichts');assert.equal(toolbar.at(-1).count,'0 von 4 Artikeln');assert(body.innerHTML.includes('Keine passenden Artikel'));assert(!body.innerHTML.includes('role="listitem"'));assert(!body.innerHTML.includes('role="list"'),'no empty group containers remain for a zero-result search');
  const input={value:'nichts',focus(){this.focused=true;}},clear={hidden:false};
  const old=p.shadowRoot.querySelector;p.shadowRoot.querySelector=selector=>selector==='#search'?input:selector==='#clearsearch'?clear:old(selector);
  await p.act('clearsearch');assert.equal(p.inventoryQuery,'');assert.equal(input.value,'');assert(input.focused);assert(clear.hidden);
  assert.equal((body.innerHTML.match(/role="listitem"/g)||[]).length,4);
  await p.act('inventorylayout','cards');assert(body.innerHTML.includes('class="row inventory-item"'));assert.equal(p.inventoryLayout,'cards');
  assert.deepEqual(plain(p.data),before,'layout switches and clear search must never write inventory data');
 }
 {
  const {p,body}=inventory();p.inventoryLayout='list';
  p.data.devices.linked.name='Mara <Türsensor> & Licht';
  p.data.settings.battery_device_links.AA=['linked','d','linked','missing'];
  const before=plain(p.data);p.body();
  assert.deepEqual([...body.innerHTML.matchAll(/data-action="([^"]+)"/g)].map(match=>match[1]),['editbatterytype','editbatterytype','material','material'],'only article names are interactive in the list, without add or duplicate layout buttons');
  assert.deepEqual([...body.innerHTML.matchAll(/role="list" aria-label="([^"]+)"/g)].map(match=>match[1]),['Batterien','Weitere Verbrauchsmaterialien']);assert.equal((body.innerHTML.match(/role="listitem"/g)||[]).length,4);assert(!body.innerHTML.includes('inventory-intro'));assert.equal((body.innerHTML.match(/class="tag count-tag">2<\/span>/g)||[]).length,2,'each group has the correct article count');
  for(const item of p.inventoryItems()){
   const html=p.inventoryListRow(item);
   assert(html.indexOf('inventory-list-stock')<html.indexOf('inventory-list-name')&&html.indexOf('inventory-list-name')<html.indexOf('inventory-list-devices'),'each compact row reads quantity, article, devices');
   const buttons=[...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];assert.equal(buttons.length,1,'only the article name is clickable');
   const expected=item.kind==='battery'?'editbatterytype':'material';assert(buttons[0][1].includes('data-action="'+expected+'"')&&buttons[0][1].includes('data-id="'+item.id+'"'));assert(buttons[0][1].includes('class="inventory-list-name"'),'the edit trigger keeps its plain article-name styling');assert(buttons[0][1].includes('type="button"')&&buttons[0][1].includes('aria-haspopup="dialog"'),'the name is an explicit accessible dialog trigger');
   assert(!/<(?:a|details)\b/.test(html));assert.equal((html.match(/data-action=/g)||[]).length,1,'no extra or hidden mobile actions return');
   for(const absent of ['Nachkaufen','Bearbeiten','Entfernen','inventory-list-threshold','inventory-usage','inventory-notes','shop-link'])assert(!html.includes(absent),absent+' is reserved for cards and editing');
  }
  const rows=p.inventoryItems(),battery=p.inventoryListRow(rows.find(item=>item.id==='AA')),material=p.inventoryListRow(rows.find(item=>item.id==='salt')),unknown=p.inventoryListRow(rows.find(item=>item.id==='filter'));
  assert(battery.includes('3')&&battery.includes('Stück')&&battery.includes('AA Batterie'));
  assert(battery.includes('Zoé Küchensensor')&&battery.includes('Mara &lt;Türsensor&gt; &amp; Licht'),'all associated device names remain visible and escaped');
  assert(battery.includes(', '),'associated devices are separated on the same line');
  assert.equal((battery.match(/Zoé Küchensensor/g)||[]).length,1,'duplicate automatic/manual device assignments appear only once');
  assert(material.includes('-1.5')&&material.includes('kg')&&material.includes('Entkalkersalz')&&material.includes('—'),'negative quantities and articles without devices stay clear');
  assert(unknown.includes('?')&&unknown.includes('Stück')&&unknown.includes('Wasserfilter'),'unknown quantity is not silently changed to zero');
  assert(!body.innerHTML.includes('Trocken &amp; kühl lagern'));assert(!body.innerHTML.includes('Sack im Keller'));assert(!body.innerHTML.includes('example.invalid'));
  assert.deepEqual(plain(p.data),before,'the compact list does not change stored materials, notes, links or quantities');
  p.data.devices.unclear={id:'unclear',name:'Sensor ohne Batterietyp',battery_type:'unbekannt'};p.body();
  assert.deepEqual([...body.innerHTML.matchAll(/data-action="([^"]+)"/g)].map(match=>match[1]),['editbatterytype','editbatterytype','material','material'],'unresolved battery assignments do not reintroduce device buttons into the stock list');
  await p.act('inventorylayout','cards');assert(body.innerHTML.includes('Batterietyp noch offen'));assert(body.innerHTML.includes('data-action="record" data-id="unclear"'),'unresolved assignments remain manageable in cards');
  const writes=[];let dialog;p.modal=(title,html,save)=>dialog={title,html,save};p.change=async(action,payload)=>writes.push({action,payload:plain(payload)});p.usageDeviceEditor=()=>'';
  const beforeOpen=plain(p.data);
  for(const item of rows){
   const button=p.inventoryListRow(item).match(/<button\b([^>]*)>/)[1],action=button.match(/data-action="([^"]+)"/)[1],id=button.match(/data-id="([^"]+)"/)[1];
   await p.act(action,id);assert.equal(dialog.title,item.kind==='battery'?'Batterietyp bearbeiten':'Verbrauchsmaterial');assert.equal(typeof dialog.save,'function');assert.equal(writes.length,0,'clicking an article name opens its editor without saving');
  }
  assert.deepEqual(plain(p.data),beforeOpen);
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
 {
  const {p}=inventory(),before=plain(p.data),writes=[];let dialog;
  p.modal=(title,html,save,label='Speichern',footer='')=>dialog={title,html,save,label,footer};
  p.change=async(action,payload)=>writes.push({action,payload:plain(payload)});p.usageDeviceEditor=()=>'';
  for(const [editor,id,remove,title,label,expected] of [
   ['material','filter','deletematerial','Verbrauchsmaterial entfernen','Entfernen',{action:'delete_consumable',payload:{id:'filter',confirmed:true}}],
   ['editbatterytype','AA','deletebatterytype','Batterietyp entfernen','Batterietyp entfernen',{action:'battery_inventory',payload:{remove_types:['AA']}}]
  ]){
   await p.act(editor,id);
   const button=dialog.footer.match(/<button\b([^>]*)>([\s\S]*?)<\/button>/);
   assert(button,editor+' places removal in its edit dialog footer');
   assert(button[1].includes('data-action="'+remove+'"')&&button[1].includes('data-id="'+id+'"'));
   assert(button[1].includes('type="button"'),'removal must not accidentally submit edited form values');
   assert(button[1].includes('class="inventory-remove"'));assert.equal(button[2],'Entfernen');
   assert.equal(writes.length,0,'opening an edit dialog must not remove or save anything');
   await p.act(remove,id);assert.equal(dialog.title,title);assert.equal(dialog.label,label);
   assert.equal(dialog.footer,'','confirmation has no recursive remove action');
   assert.equal(writes.length,0,'clicking remove only opens the existing confirmation');
   assert.deepEqual(plain(p.data),before,'both dialog transitions leave all stored data untouched');
   await dialog.save(new Map());assert.deepEqual(writes.pop(),expected,'confirmation retains the existing removal API');
  }
  await p.act('material');assert.equal(dialog.footer,'','a new material has nothing to remove');
  await p.act('addbatterytype');assert.equal(dialog.footer,'','a new battery type has nothing to remove');
  assert.deepEqual(plain(p.data),before);assert.equal(writes.length,0);
 }
 console.log('PASS: Inventarsuche und Listenumschalter bleiben unabhängig und ohne Datenmutation; sichere Shop-Links, Mengen, Aktionen und Formular-/Bestandspayloads bleiben korrekt.');
})().catch(error=>{console.error(error);process.exitCode=1;});
