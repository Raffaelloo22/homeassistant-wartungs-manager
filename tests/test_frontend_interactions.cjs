const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
let Panel;vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../custom_components/ha_wartung/frontend/panel.js'),'utf8'),{HTMLElement:class{},customElements:{get:()=>null,define:(_,c)=>Panel=c}});
const plain=value=>JSON.parse(JSON.stringify(value));
const panel=()=>Object.create(Panel.prototype);

function categoryFiltering(){
  const p=panel();Object.assign(p,{tab:'devices',query:'',area:'',categoryFilter:'',deviceMode:'active',selected:null,data:{settings:{device_categories:['Licht','Haushalt'],category_aliases:{Buttons:'Licht'}},views:[],rules:{},devices:{lamp:{id:'lamp',name:'Zoé Lampe',area:'OG Zoé',category:'Buttons'},oven:{id:'oven',name:'Backofen',area:'EG Küche',category:'Haushalt'},spare:{id:'spare',name:'Reserve',category:'Licht',in_storage:true},gone:{id:'gone',name:'Entfernt',category:'Licht',deleted_at:'2026-11-22'}}}});
  p.batteryTasks=()=>[];p.inlineStatus=()=>'';p.deviceMetadata=()=>'';
  let output='',renders=0;const clear={hidden:true};p.shadowRoot={querySelector:selector=>selector==='#clearsearch'?clear:null};p.body=()=>{renders++;output=p.deviceList(false);};
  p.body();assert(output.includes('Zoé Lampe')&&output.includes('Backofen'));assert(!output.includes('Reserve')&&!output.includes('Entfernt'));
  p.selected='oven';p.filterChanged('categoryFilter','Licht');assert(output.includes('Zoé Lampe'));assert(!output.includes('Backofen'));assert.equal(p.selected,null);
  const before=renders;p.filterChanged('categoryFilter','Licht');assert.equal(renders,before,'input+change must not render the same selection twice');
  p.filterChanged('query','zoe');assert(output.includes('Zoé Lampe'));assert.equal(clear.hidden,false);
  p.filterChanged('area','EG Küche');assert(output.includes('Keine Geräte.'));p.filterChanged('categoryFilter','');p.filterChanged('query','');assert(output.includes('Backofen'));assert(!output.includes('Zoé Lampe'));
  p.filterChanged('area','');assert(output.includes('Zoé Lampe')&&output.includes('Backofen'));assert.equal(clear.hidden,true);
}

function sortableFixture(type){
  const p=panel(),category=type==='category',key=category?'categoryName':'eventTypeId',ids=['a','b','c'],saved=[];
  p.categories=()=>ids.slice();p.eventTypeOptions=()=>ids.map(id=>[id,id]);
  const rows=ids.map((id,index)=>{const classes=new Set(),handle={setPointerCapture:pointer=>handle.pointer=pointer,focus:()=>handle.focused=true};return {dataset:{[key]:id},handle,classList:{add:value=>classes.add(value),remove:(...values)=>values.forEach(value=>classes.delete(value)),toggle:(value,on)=>on?classes.add(value):classes.delete(value),contains:value=>classes.has(value)},getBoundingClientRect:()=>({top:index*40,height:40}),querySelector:()=>handle,closest(){return this;}};});
  const list={querySelectorAll:()=>rows,contains:row=>rows.includes(row)};
  p.shadowRoot={querySelector:()=>list,elementFromPoint:(_,y)=>rows[Math.floor(y/40)]};
  p[category?'saveCategoryOrder':'saveEventTypeOrder']=async(order,focus)=>saved.push({order:plain(order),focus});
  p[category?'bindCategoryDrag':'bindEventTypeDrag']();
  const event=(extra={})=>({button:0,pointerId:7,clientX:0,clientY:0,preventDefault(){this.prevented=true;},...extra});
  return {p,rows,saved,event};
}

async function dragAndDrop(){
  for(const type of ['category','event']){
    let {p,rows,saved,event}=sortableFixture(type);
    rows[0].handle.onpointerdown(event());rows[0].handle.onpointermove(event({clientY:115}));await rows[0].handle.onpointerup(event());
    assert.deepEqual(saved,[{order:['b','c','a'],focus:undefined}],type+' pointer drop must persist the moved order');assert(rows.every(row=>!row.classList.contains('dragging')&&!row.classList.contains('drop-target')));
    ({p,rows,saved,event}=sortableFixture(type));let dragged;
    const transfer={setData:(mime,id)=>dragged={mime,id}};rows[2].ondragstart(event({target:{closest:()=>null},dataTransfer:transfer}));assert.equal(dragged.id,'c');assert.equal(transfer.effectAllowed,'move');rows[0].ondragover(event({dataTransfer:transfer,clientY:5}));await rows[0].ondrop(event({clientY:5}));assert.deepEqual(saved[0].order,['c','a','b'],type+' native drop above first item');
    ({p,rows,saved,event}=sortableFixture(type));await rows[0].handle.onkeydown(event({key:'ArrowUp'}));assert.equal(saved.length,0,'boundary key is a no-op');await rows[1].handle.onkeydown(event({key:'ArrowDown'}));assert.deepEqual(saved[0],{order:['a','c','b'],focus:'b'});
    ({p,rows,saved,event}=sortableFixture(type));rows[0].handle.onpointerdown(event());rows[0].handle.onpointermove(event({clientY:115}));rows[0].handle.onpointercancel();await rows[0].handle.onpointerup(event());assert.equal(saved.length,0,'cancel must not persist');p.pending=true;rows[0].handle.onpointerdown(event());await rows[0].handle.onkeydown(event({key:'ArrowDown'}));assert.equal(saved.length,0,'pending mutation must block reordering');
    let dialog,focus=false,bodyCalls=0;
    p.shadowRoot={querySelector:()=>dialog};p.body=()=>bodyCalls++;
    const save=categorySave(type);dialog={open:false,querySelectorAll:()=>[{dataset:{[save.key]:'b'},querySelector:()=>({focus:()=>focus=true})}]};
    p.change=async()=>{};await Panel.prototype[save.method].call(p,['a','c','b'],'b');assert(dialog.open&&focus,'saved settings section must stay open and retain focus');
    dialog.open=false;focus=false;p.change=async()=>{throw Error('stale');};await Panel.prototype[save.method].call(p,['a','c','b'],'b');assert.equal(bodyCalls,1);assert(dialog.open&&focus,'failed save must reopen the section after refreshing');
  }
}
function categorySave(type){return type==='category'?{method:'saveCategoryOrder',key:'categoryName'}:{method:'saveEventTypeOrder',key:'eventTypeId'};}

async function shoppingMenus(){
  const p=panel(),menus=[true,false].map((open,index)=>({open,getAttribute:name=>name==='data-preserve-key'?'shopping:'+index:null,classList:{contains:()=>false}})),body={innerHTML:'',querySelectorAll:selector=>selector==='.task-menu'||selector==='details'?menus:selector==='.task-menu[open]'||selector==='details[open]'?menus.filter(menu=>menu.open):[]};
  Object.assign(p,{tab:'tasks',taskPeriod:'now',taskQuery:'',data:{today:'2026-11-22',views:[],devices:{},rules:{},logs:{},settings:{battery_notes:{CR2450:'Auf Packungsgrösse achten'}},shopping:{battery:{id:'battery',name:'CR2450 nachkaufen',battery_type:'CR2450',notes:'Im Fachhandel',quantity_remaining:0},free:{id:'free',name:'Reiniger',notes:'Ohne Duft',requested_quantity:2,requested_unit:'Flaschen'},done:{id:'done',name:'Schon gekauft',done:true}}}});
  p.shadowRoot={querySelector:selector=>selector==='#body'?body:null};p.batteryTasks=()=>[];p.bindCategoryDrag=p.bindEventTypeDrag=p.bindBatteryThresholdControl=()=>{};
  p.body();assert(body.innerHTML.includes('Im Fachhandel')&&body.innerHTML.includes('Auf Packungsgrösse achten')&&body.innerHTML.includes('Ohne Duft'));assert(!body.innerHTML.includes('Schon gekauft'));
  for(const id of ['battery','free'])for(const action of ['bought','editshopping','deleteshopping'])assert(body.innerHTML.includes(`data-action="${action}" data-id="${id}"`),'every open purchase needs all three actions');
  menus[1].open=true;menus[1].ontoggle();assert.equal(menus[0].open,false,'opening a second menu must close the first');
  const writes=[];let modal;p.modal=(title,html,submit,label)=>modal={title,html,submit,label};p.change=async(action,payload)=>writes.push({action,payload:plain(payload)});
  await p.act('editshopping','battery');assert.equal(writes.length,0,'opening edit must not save');assert(modal.html.includes('name="notes"')&&modal.html.includes('Im Fachhandel'));
  await modal.submit(new Map([['quantity','3'],['notes','Neue Notiz']]));assert.deepEqual(writes.pop(),{action:'save_shopping',payload:{value:{id:'battery',name:'CR2450 nachkaufen',notes:'Neue Notiz',requested_quantity:3,requested_unit:'Stück'}}});
  await p.act('editshopping','battery');assert.throws(()=>modal.submit(new Map([['quantity','1.5'],['notes','']])),/gültige positive/);assert.equal(writes.length,0,'fractional battery quantities must be rejected before a mutation');
  await p.act('deleteshopping','free');assert.equal(writes.length,0,'removal needs confirmation');assert(modal.html.includes('Bestand bleibt unverändert'));await modal.submit();const removed=writes.pop();assert.equal(removed.action,'save_shopping');assert.equal(removed.payload.value.id,'free');assert.equal(removed.payload.value.done,true);assert(!('quantity' in removed.payload.value),'removing a purchase must not change stock');
}
(async()=>{categoryFiltering();await dragAndDrop();await shoppingMenus();console.log('PASS: Kategorie-/Bereichsfilter, native/pointer/keyboard Sortierung beider Listen samt Offenhalten, Nachkaufmenüs und Notizbearbeitung.');})().catch(error=>{console.error(error);process.exitCode=1;});

// Lager und Archiv explain their different lifecycles in the actual list view.
{
 const p=panel(),body={innerHTML:'',querySelectorAll:()=>[]};
 Object.assign(p,{tab:'devices',selected:null,data:{devices:{},views:[],settings:{}},deviceList:()=>'<p>Geräte</p>',batteryTasks:()=>[],captureBodyState:()=>({open:[]}),restoreBodyState(){},bindCategoryDrag(){},bindEventTypeDrag(){},bindBatteryThresholdControl(){},shadowRoot:{querySelector:selector=>selector==='#body'?body:null}});
 p.deviceMode='storage';p.body();assert(body.innerHTML.includes('Lagergeräte sind noch vorhanden, aber aktuell nicht im Einsatz.'));assert(body.innerHTML.includes('Automatische Aufgaben und Meldungen sind ausgesetzt.'));
 p.deviceMode='archive';p.body();assert(body.innerHTML.includes('dauerhaft ausser Betrieb'));assert(body.innerHTML.includes('Geräteakte und Historie bleiben erhalten'));
 p.deviceMode='active';p.body();assert(!body.innerHTML.includes('device-mode-hint'));
}
console.log('PASS: Lager und Archiv erklären Aufbewahrung, Reaktivierung und ausgesetzte Aufgaben direkt in der Geräteansicht.');
