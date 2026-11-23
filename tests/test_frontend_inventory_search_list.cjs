const assert=require('node:assert/strict');
const {fixture}=require('./test_frontend_cleanup.cjs');
const plain=value=>JSON.parse(JSON.stringify(value));
function inventory(){
 const f=fixture(),p=f.p;p.tab='batteries';p.inventoryQuery='';p.inventoryLayout='cards';p.inventoryAssignment='all';
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
  p.draw();assert(root.innerHTML.includes('<div class="toolbar inventory-toolbar" >'),'inventory search, count, assignment and layout share one toolbar');
  assert(root.innerHTML.includes('placeholder="Verbrauchsmaterial suchen"'));assert(root.innerHTML.includes('aria-label="Suchbegriff löschen"'));
  const order=['class="searchbox"','id="inventory-count"','class="inventory-assignment-filter"','id="inventory-layout"'].map(marker=>root.innerHTML.indexOf(marker));
  assert(order.every((position,index)=>position>=0&&(!index||order[index-1]<position)),'search, count, assignment and layout switch appear in that order in the common toolbar');
  assert(root.innerHTML.includes('data-action="inventorylayout" data-id="cards"'));assert(root.innerHTML.includes('data-action="inventorylayout" data-id="list"'));
  const input=nodes.get('#search');input.oninput({target:{value:'zoe'}});assert.equal(p.inventoryQuery,'zoe');assert.equal(bodies,2,'typing filters immediately through the existing body renderer');
  await p.act('clearsearch');assert.equal(p.inventoryQuery,'');assert.equal(input.value,'');assert(input.focused);assert(nodes.get('#clearsearch').hidden);
  for(const tab of ['tasks','devices','log','settings','batteries']){
   p.tab=tab;p.draw();const label=root.innerHTML.indexOf('id="inventory-assignment-label"'),start=root.innerHTML.lastIndexOf('<div ',label),wrapper=root.innerHTML.slice(start,root.innerHTML.indexOf('>',start)+1);
   assert.equal(/\shidden(?:\s|>)/.test(wrapper),tab!=='batteries','the inventory assignment wrapper is visible only in its own view: '+tab);
  }
 }
 {
  const {p}=inventory(),counter={textContent:'4 Artikel'},attributes=[{},{}],cards={setAttribute:(key,value)=>attributes[0][key]=value},list={setAttribute:(key,value)=>attributes[1][key]=value};
  const assignmentAttributes={all:{},with:{},without:{}};
  const nodes=new Map([['#inventory-count',counter],['#inventory-layout [data-id="cards"]',cards],['#inventory-layout [data-id="list"]',list],...Object.entries(assignmentAttributes).map(([mode,state])=>['#inventory-assignment [data-id="'+mode+'"]',{setAttribute:(key,value)=>state[key]=value}])]);
  p.shadowRoot={innerHTML:'Existing toolbar with current search focus',querySelector:selector=>nodes.get(selector)||null};
  const sync=Object.getPrototypeOf(p).syncInventoryToolbar;
  sync.call(p,'1 von 4 Artikeln',true);assert.equal(counter.textContent,'1 von 4 Artikeln');assert.deepEqual(attributes,[{'aria-pressed':'false'},{'aria-pressed':'true'}]);
  sync.call(p,'4 Artikel',false);assert.equal(counter.textContent,'4 Artikel');assert.deepEqual(attributes,[{'aria-pressed':'true'},{'aria-pressed':'false'}]);
  assert.deepEqual(assignmentAttributes,{all:{'aria-pressed':'true'},with:{'aria-pressed':'false'},without:{'aria-pressed':'false'}});
  for(const selected of ['with','without','all']){
   p.inventoryAssignment=selected;sync.call(p,'4 Artikel',false);
   for(const mode of ['all','with','without'])assert.equal(assignmentAttributes[mode]['aria-pressed'],String(mode===selected));
  }
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
  p.body();assert.deepEqual(toolbar.at(-1),{count:'4 Artikel',list:false});assert(body.innerHTML.includes('device-grid'));assert(!body.innerHTML.includes('inventory-intro')&&!body.innerHTML.includes('Neue Artikel starten mit Bestand 1')&&!body.innerHTML.includes('Negative Bestände zeigen fehlende Mengen an'),'cards omit the removed inventory explanation');assert(!body.innerHTML.includes('inventory-view-switch'),'the layout toolbar is not duplicated in the body');
  p.filterChanged('inventoryQuery','wasser');assert.equal(toolbar.at(-1).count,'1 von 4 Artikeln');assert(body.innerHTML.includes('Wasserfilter'));assert(!body.innerHTML.includes('Entkalkersalz'));
  await p.act('inventorylayout','list');assert.equal(p.inventoryLayout,'list');assert.equal(p.inventoryQuery,'wasser');
  assert.deepEqual([...body.innerHTML.matchAll(/role="list" aria-label="([^"]+)"/g)].map(match=>match[1]),['Weitere Verbrauchsmaterialien'],'only the group containing the search result is shown');assert.equal((body.innerHTML.match(/role="listitem"/g)||[]).length,1);assert(body.innerHTML.includes('Weitere Verbrauchsmaterialien<span class="tag count-tag">1</span>'),'group counts follow the filtered rows');assert(!body.innerHTML.includes('inventory-intro')&&!body.innerHTML.includes('Neue Artikel starten mit Bestand 1')&&!body.innerHTML.includes('Negative Bestände zeigen fehlende Mengen an'),'the compact list also omits the removed inventory explanation');
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
  const {p,body}=inventory();p.inventoryLayout='list';
  for(const [id,name] of [['z','Zebra'],['ten','Artikel 10'],['two','artikel 2'],['accent','Äpfel']])p.data.settings.consumables[id]={id,name,unit:'Stück',quantity:1,threshold:1,device_ids:[]};
  const before=plain(p.data),original=p.inventoryItems().filter(item=>item.kind==='material').map(item=>item.name);
  p.body();
  const names=[...body.innerHTML.matchAll(/<button\b[^>]*data-action="material"[^>]*class="inventory-list-name"[^>]*>([^<]*)<\/button>/g)].map(match=>match[1]);
  assert.deepEqual(names,['Äpfel','artikel 2','Artikel 10','Entkalkersalz','Wasserfilter','Zebra'],'list materials sort alphabetically with natural numbers and German accents');
  assert.deepEqual(p.inventoryItems().filter(item=>item.kind==='material').map(item=>item.name),original,'sorting the list does not reorder card data');
  assert.deepEqual(plain(p.data),before,'alphabetical presentation never rewrites inventory records');
 }
 {
  const {p,body,toolbar}=inventory();
  p.data.devices.deleted={id:'deleted',name:'Entferntes Gerät',deleted_at:'2026-11-23',battery_type:'CR2450'};
  p.data.settings.battery_inventory.CR2450=1;p.data.settings.battery_device_links.CR2450=['missing','deleted'];
  p.data.settings.consumables.orphan={id:'orphan',name:'Verwaistes Material',quantity:1,threshold:1,unit:'Stück',device_ids:['missing','deleted']};
  const before=plain(p.data);let writes=0;p.api=async()=>{writes++;throw Error('No data writes are expected');};
  p.body();assert.equal(p.inventoryAssignment,'all');assert.equal(ids(p).length,6);assert.equal(toolbar.at(-1).count,'6 Artikel','all assignments are shown by default');
  await p.act('inventoryassignment','with');assert.deepEqual(ids(p),['AA','CR2032','filter']);assert.equal(toolbar.at(-1).count,'3 von 6 Artikeln');
  assert(body.innerHTML.includes('AA Batterie')&&body.innerHTML.includes('CR2032 Batterie')&&body.innerHTML.includes('Wasserfilter'));
  assert(!body.innerHTML.includes('CR2450 Batterie')&&!body.innerHTML.includes('Entkalkersalz')&&!body.innerHTML.includes('Verwaistes Material'),'both batteries and materials without a real device are hidden');
  const items=p.inventoryItems();assert.equal(items.find(item=>item.id==='AA').devices.length,1,'battery-type assignments count');assert.equal(items.find(item=>item.id==='CR2032').devices.length,1,'manual battery-device links count');
  assert.equal(items.find(item=>item.id==='CR2450').devices.length,0);assert.equal(items.find(item=>item.id==='orphan').devices.length,0,'missing or deleted IDs never count as an assignment');
  await p.act('inventorylayout','list');assert.equal(p.inventoryAssignment,'with');assert.equal((body.innerHTML.match(/role="listitem"/g)||[]).length,3);assert.equal(toolbar.at(-1).count,'3 von 6 Artikeln');
  p.filterChanged('inventoryQuery','mara');assert.deepEqual(ids(p),['CR2032']);assert.equal(toolbar.at(-1).count,'1 von 6 Artikeln');assert(body.innerHTML.includes('CR2032 Batterie')&&!body.innerHTML.includes('Wasserfilter'),'text search and device-assignment filter combine');
  p.filterChanged('inventoryQuery','keller');assert.deepEqual(ids(p),[]);assert.equal(toolbar.at(-1).count,'0 von 6 Artikeln');assert(body.innerHTML.includes('inventory-empty'));assert(!body.innerHTML.includes('role="listitem"'));
  p.filterChanged('inventoryQuery','');await p.act('inventoryassignment','without');assert.deepEqual(ids(p),['CR2450','salt','orphan']);assert.equal(toolbar.at(-1).count,'3 von 6 Artikeln');
  assert.equal((body.innerHTML.match(/role="listitem"/g)||[]).length,3);assert(body.innerHTML.includes('CR2450 Batterie')&&body.innerHTML.includes('Entkalkersalz')&&body.innerHTML.includes('Verwaistes Material'));
  assert(!body.innerHTML.includes('AA Batterie')&&!body.innerHTML.includes('Wasserfilter'),'without excludes both automatic and manual assignments in both groups');
  p.filterChanged('inventoryQuery','mara');assert.deepEqual(ids(p),[]);assert.equal(toolbar.at(-1).count,'0 von 6 Artikeln');
  p.filterChanged('inventoryQuery','keller');assert.deepEqual(ids(p),['salt']);assert.equal(toolbar.at(-1).count,'1 von 6 Artikeln');
  p.filterChanged('inventoryQuery','');p.draw=()=>{};await p.act('tab','log');await p.act('tab','batteries');p.body();assert.equal(p.inventoryAssignment,'without','the view filter remains set across tab switches');
  await p.act('inventorylayout','cards');assert.equal(p.inventoryAssignment,'without');assert.equal(toolbar.at(-1).count,'3 von 6 Artikeln');assert(body.innerHTML.includes('CR2450 Batterie')&&body.innerHTML.includes('Verwaistes Material'));assert(!body.innerHTML.includes('Wasserfilter'));
  await p.act('inventoryassignment','all');assert.equal(ids(p).length,6);assert.equal(toolbar.at(-1).count,'6 Artikel');assert(body.innerHTML.includes('Verwaistes Material'));
  assert.equal(writes,0);assert.deepEqual(plain(p.data),before,'filtering and switching views never rewrite assignments or stock');
  for(const device of Object.values(p.data.devices))device.deleted_at='2026-11-23';await p.act('inventoryassignment','with');assert.equal(toolbar.at(-1).count,'0 von 6 Artikeln');assert(body.innerHTML.includes('inventory-empty'));assert(!body.innerHTML.includes('Noch kein Verbrauchsmaterial erfasst'),'a filtered empty result is not mistaken for an empty inventory');
  await p.act('inventoryassignment','without');assert.equal(ids(p).length,6);assert.equal(toolbar.at(-1).count,'6 von 6 Artikeln');
 }
 {
  const {p,body,toolbar}=inventory(),nodes=new Map(),listeners={},states={all:{},with:{},without:{}};
  for(const selector of ['#search','#clearsearch','#categoryfilter','#area','#taskperiod'])nodes.set(selector,{value:'',hidden:false,focus(){}});
  nodes.set('#body',body);
  for(const mode of ['all','with','without'])nodes.set('#inventory-assignment [data-id="'+mode+'"]',{dataset:{action:'inventoryassignment',id:mode},setAttribute:(key,value)=>states[mode][key]=value});
  const root={innerHTML:'',querySelector:selector=>nodes.get(selector)||null,querySelectorAll:()=>[],addEventListener(type,handler){listeners[type]=handler;}};p.shadowRoot=root;p.renderCompletionUndo=()=>{};const before=plain(p.data);
  const nativeSync=Object.getPrototypeOf(p).syncInventoryToolbar;p.syncInventoryToolbar=(count,list)=>{toolbar.push({count,list});nativeSync.call(p,count,list);};
  p.draw();assert(root.innerHTML.includes('id="inventory-assignment"'));assert(root.innerHTML.includes('Gerätezuordnung:'));assert(root.innerHTML.includes('role="group" aria-labelledby="inventory-assignment-label"'));assert(!root.innerHTML.includes('inventory-assigned-only'));
  assert(root.innerHTML.indexOf('id="inventory-count"')<root.innerHTML.indexOf('id="inventory-assignment"')&&root.innerHTML.indexOf('id="inventory-assignment"')<root.innerHTML.indexOf('id="inventory-layout"')&&root.innerHTML.indexOf('id="inventory-layout"')<root.innerHTML.indexOf('id="body"'),'assignment controls share the toolbar between article count and layout switch, outside the changing body');
  for(const [mode,label] of [['all','Alle'],['with','mit'],['without','ohne']])assert(root.innerHTML.includes('data-action="inventoryassignment" data-id="'+mode+'" type="button" aria-pressed="'+(mode==='all')+'">'+label+'</button>'));
  const markup=root.innerHTML,click=mode=>{const button=nodes.get('#inventory-assignment [data-id="'+mode+'"]');root.activeElement=button;listeners.click({target:{closest:()=>button}});assert.equal(root.activeElement,button,'the selected assignment button keeps focus');assert.equal(root.innerHTML,markup,'filter clicks never rebuild the toolbar or assignment group');};
  click('with');assert.equal(p.inventoryAssignment,'with');assert.equal(toolbar.at(-1).count,'3 von 4 Artikeln');assert(!body.innerHTML.includes('Entkalkersalz'));assert.equal(states.with['aria-pressed'],'true');assert.equal(states.all['aria-pressed'],'false');
  const renders=toolbar.length;click('with');assert.equal(toolbar.length,renders,'the selected segment does not redraw twice');
  click('without');assert.equal(p.inventoryAssignment,'without');assert.equal(toolbar.at(-1).count,'1 von 4 Artikeln');assert(body.innerHTML.includes('Entkalkersalz'));assert(!body.innerHTML.includes('Wasserfilter'));assert.equal(states.without['aria-pressed'],'true');assert.equal(states.with['aria-pressed'],'false');
  p.draw();assert(root.innerHTML.includes('data-id="without" type="button" aria-pressed="true"'),'redrawing the view restores the current filter selection');
  await p.act('inventoryassignment','invalid');assert.equal(p.inventoryAssignment,'without','unexpected modes do not alter the filter');
  await p.act('inventoryassignment','all');assert.equal(p.inventoryAssignment,'all');assert.equal(toolbar.at(-1).count,'4 Artikel');assert(body.innerHTML.includes('Entkalkersalz')&&body.innerHTML.includes('Wasserfilter'));assert.equal(states.all['aria-pressed'],'true');assert.equal(states.without['aria-pressed'],'false');
  assert.deepEqual(plain(p.data),before);
  let dialog;p.inventoryAssignment='without';p.modal=(title,html,save)=>dialog={save};p.change=async()=>{};p.draw=()=>{};
  await p.act('resetalldata');await dialog.save(new Map([['confirm','on'],['confirmation','DATEN ZURÜCKSETZEN']]));assert.equal(p.inventoryAssignment,'all','resetting data clears the transient assignment filter');
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
 {
  const {p}=inventory();let dialog,writes=[];p.modal=(title,html,save)=>dialog={title,html,save};p.change=async(action,payload)=>writes.push({action,payload:plain(payload)});p.usageDeviceEditor=()=>'';p.readRelatedDevices=()=>[];
  p.data.settings.battery_no_restock=['AA'];const before=plain(p.data);
  assert(!p.inventoryControls('battery','AA',3,'AA').includes('data-action="requestpurchase"'),'disabled battery types have no reorder action in cards or mobile menus');
  assert(p.inventoryControls('battery','CR2032',0,'CR2032').includes('data-action="requestpurchase"'),'other battery types remain reorderable');
  assert(p.inventoryControls('material','AA',3,'Material AA').includes('data-action="requestpurchase"'),'same-name general materials are unaffected');
  await assert.rejects(()=>p.act('requestpurchase','battery:AA'),/Nachkaufen deaktiviert/);assert.equal(writes.length,0,'a stale reorder control cannot submit a disabled type');
  await p.act('editbatterytype','AA');assert(dialog.html.includes('fields paired-fields battery-restock-fields'));assert(dialog.html.includes('name="no_restock" checked>'));assert(dialog.html.includes('Nicht nachkaufen'));
  await dialog.save(new Map([['battery_type','AA'],['quantity','3'],['threshold','2'],['no_restock','on'],['notes','Akku']]));assert.equal(writes.at(-1).payload.no_restock,true);assert.equal(writes.at(-1).payload.threshold,2,'threshold remains saved while restocking is disabled');
  await dialog.save(new Map([['battery_type','AA'],['quantity','3'],['threshold','2'],['notes','Akku']]));assert.equal(writes.at(-1).payload.no_restock,false,'clearing the checkbox explicitly re-enables restocking');
  assert.deepEqual(plain(p.data),before,'opening or editing the form does not mutate local data before the API saves');
 }
 {
  const {p}=inventory(),before=plain(p.data);p.inventoryAssignment='with';
  const payload=plain(p.inventoryPdfPayload());assert.deepEqual(payload.items.map(item=>item.name),['AA Batterie','CR2032 Batterie','Wasserfilter'],'PDF uses the same filtered and alphabetically grouped rows as the list');
  assert.deepEqual(payload.items[0].devices,['Zoé Küchensensor']);assert.equal(payload.items[2].quantity,null,'unknown stocks remain unknown');assert.equal(payload.assignment_filter,'with');assert(!('assigned_only' in payload),'new exports use the three-way assignment filter');
  assert(!JSON.stringify(payload).includes('example.invalid')&&!JSON.stringify(payload).includes('Trocken'),'export contains stock, names and devices rather than shop links or notes');
  p.inventoryAssignment='without';assert.deepEqual(plain(p.inventoryPdfPayload()).items.map(item=>item.name),['Entkalkersalz']);assert.equal(p.inventoryPdfPayload().assignment_filter,'without');assert.deepEqual(plain(p.inventoryPdfPayload()).items[0].devices,[]);
  p.inventoryQuery='salz';assert.equal(p.inventoryPdfPayload().items[0].quantity,-1.5,'negative and decimal stock values remain exact');p.inventoryQuery='mara';assert.equal(p.inventoryPdfPayload().items.length,0,'text search combines with the unassigned PDF filter');p.inventoryAssignment='with';assert.equal(p.inventoryPdfPayload().items[0].name,'CR2032 Batterie');
  p.inventoryAssignment='all';p.inventoryQuery='';assert.equal(p.inventoryPdfPayload().assignment_filter,'all');assert.equal(p.inventoryPdfPayload().items.length,4,'all includes assigned and unassigned articles in both groups');
  const state={},button={setAttribute:(key,value)=>state[key]=value,removeAttribute:key=>delete state[key]};p.shadowRoot.querySelector=selector=>selector==='[data-action=inventorypdf]'?button:null;let resolve,requests=[],saved=[],notice;
  p.api=(action,request)=>{requests.push({action,request:plain(request)});return new Promise(done=>resolve=done);};p.saveInventoryPdf=result=>saved.push(result);p.notice=message=>notice=message;
  const download=p.act('inventorypdf');assert(button.disabled&&state['aria-busy']==='true');await p.act('inventorypdf');assert.equal(requests.length,1,'repeated clicks share a single read-only PDF request');
  assert.equal(requests[0].action,'inventory_pdf');assert(!('revision' in requests[0].request));resolve({filename:'Verbrauchsmaterial.pdf',content_type:'application/pdf',data:'JVBERi0='});await download;
  assert.equal(saved.length,1);assert(!button.disabled&&!state['aria-busy']);assert(notice.includes('PDF'));assert.equal(p.inventoryLayout,'cards','downloading PDF does not replace the current view');assert.deepEqual(plain(p.data),before,'PDF export never changes stock or associations');
  p.api=async()=>{throw Error('PDF nicht verfügbar');};await assert.rejects(()=>p.act('inventorypdf'),/PDF nicht verfügbar/);assert(!button.disabled&&!p.inventoryPdfPending,'failures release the button for retry');
 }
 console.log('PASS: Inventarsuche und Listenumschalter bleiben unabhängig und ohne Datenmutation; sichere Shop-Links, Mengen, Aktionen und Formular-/Bestandspayloads bleiben korrekt.');
})().catch(error=>{console.error(error);process.exitCode=1;});
