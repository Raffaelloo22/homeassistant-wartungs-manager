const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.join(__dirname,'..');let Panel;const createdButtons=[];
const source=fs.readFileSync(path.join(root,'custom_components/ha_wartung/frontend/panel.js'),'utf8');
vm.runInNewContext(source,{URL,HTMLElement:class{},customElements:{get:()=>null,define:(_,value)=>Panel=value},crypto:{randomUUID:()=> 'new-material'},document:{createElement:()=>{const button={};createdButtons.push(button);return button;}}});
const plain=value=>JSON.parse(JSON.stringify(value));
function fixture(){
 const body={innerHTML:'',querySelectorAll:()=>[]},p=Object.create(Panel.prototype);
 Object.assign(p,{tab:'devices',selected:null,deviceMode:'active',query:'',area:'',categoryFilter:'',reg:{devices:[{id:'ha-d',name:'Lampe (HA)'}],sensors:[]},data:{today:'2026-11-22',settings:{device_categories:['Licht'],consumables:{salt:{id:'salt',name:'Salz',unit:'kg',quantity:2,threshold:1,device_ids:['d']}}},devices:{d:{id:'d',name:'Testlampe & Gerät',manufacturer:'Testmarke',model:'Modell 1',ha_device_id:'ha-d',area:'Wohnzimmer',category:'Licht',purchase_date:'2025-01-02',notes:'Notiz <Test>',related_devices:[{id:'linked'}]},linked:{id:'linked',name:'Verknüpft',category:'Licht',in_storage:true}},rules:{r:{id:'r',device_id:'d',name:'Prüfen',kind:'interval',months:2,consumable:{kind:'material',id:'salt',quantity:1}}},views:[{rule_id:'r',device_id:'d',device_name:'Testlampe & Gerät',name:'Prüfen',status:'due',due:'2026-11-22'}],logs:{l:{id:'l',device_id:'d',kind:'maintenance',event_date:'2025-01-02',note:'Prüfung & Test'}}},shadowRoot:{querySelector:selector=>selector==='#body'?body:null},captureBodyState:()=>({open:[]}),restoreBodyState(){},bindCategoryDrag(){},bindEventTypeDrag(){},bindBatteryThresholdControl(){}});
 return {p,body};
}
async function run(){
 const expected=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/frontend_cleanup_device_html.json'),'utf8'));
 {
  const {p,body}=fixture();p.body();assert.equal(body.innerHTML,expected.list,'device list HTML must remain identical');
  let lists=0;const list=p.deviceList;p.deviceList=function(...args){lists++;return list.apply(this,args);};p.selected='d';p.body();assert.equal(body.innerHTML,expected.detail,'device detail HTML must remain identical');assert.equal(lists,0,'detail rendering must not build and discard the list');
 }
 {
  const {p}=fixture();let metadata=0,counts=0;const meta=p.deviceMetadata,count=p.deviceTaskCount;
  p.deviceMetadata=function(...args){metadata++;return meta.apply(this,args);};p.deviceTaskCount=function(...args){counts++;return count.apply(this,args);};
  p.deviceList(false);assert.equal(metadata,1,'visible device metadata calculated once');assert.equal(counts,1,'visible device task count calculated once');
 }
 {
  const {p}=fixture(),fallback={kind:'material',id:'salt',quantity:1},battery={kind:'battery',id:'AA'};
  const rule={id:'rotation',device_id:'d',name:'Pflegen',kind:'rotation',rotation_step:1,steps:['Reinigen','Wechseln'],consumable:fallback,consumables_by_step:{Wechseln:battery}};
  p.data.devices.d.battery_type='AA';p.data.devices.d.battery_quantity=2;p.data.settings.battery_inventory={AA:5};p.data.rules.rotation=rule;
  assert.deepEqual(plain(p.ruleMaterialLink(rule)),battery);assert.equal(p.taskBatteryDetail({rule_id:'rotation',device_id:'d',name:'Wechseln'}),'2 × AA');assert.equal(p.taskMaterial(rule).name,'AA');
  rule.consumables_by_step.Wechseln=null;assert.equal(p.ruleMaterialLink(rule),null,'explicit null overrides the generic link');assert.equal(p.taskMaterial(rule),null);
  delete rule.consumables_by_step.Wechseln;assert.deepEqual(plain(p.ruleMaterialLink(rule)),fallback);assert.equal(p.taskMaterial(rule).name,'Salz');
  rule.rotation_step=2;assert.deepEqual(plain(p.ruleMaterialLink(rule)),fallback,'rotation wraps to its first step');
  assert.deepEqual(plain(p.ruleMaterialLink({kind:'interval',consumable:fallback})),fallback);
 }
 {
  const {p,body}=fixture();p.data.trash=[{id:'trashed',name:'Altes Gerät'}];p.deviceMode='trash';p.body();
  assert(!body.innerHTML.includes('<h2>Papierkorb'),'trash has no second heading');assert(body.innerHTML.includes('class="small sub device-mode-hint"'));assert(body.innerHTML.includes('Geräte im Papierkorb erscheinen nicht in Aufgaben oder Meldungen.'));
  assert.equal(body.innerHTML.split('Geräte im Papierkorb erscheinen nicht').length-1,1,'explanation appears once');
  for(const action of ['emptytrash','undelete','purgetrashdevice'])assert(body.innerHTML.includes(`data-action="${action}"`),'trash recovery/removal controls remain');
  p.deviceMode='archive';p.body();assert(body.innerHTML.includes('class="small sub device-mode-hint"'));assert(body.innerHTML.includes('dauerhaft ausser Betrieb'));
 }
 {
  const removed=['refresh','batterydevices','categoryup','categorydown','archive','replace','reopen','seed'];
  for(const action of removed){assert(!new RegExp(`action===['"]${action}['"]`).test(source),action+' dead UI handler removed');assert(!new RegExp(`(?:button|act)\\(['"]${action}['"]`).test(source),action+' has no remaining emitter');}
  assert.equal(typeof Panel.prototype.refresh,'function','the background refresh method remains');
  const {p}=fixture();p.data.devices.d.archived=false;let dialog,write;const nativeQuery=p.shadowRoot.querySelector;p.shadowRoot.querySelector=selector=>selector==='dialog'?{querySelector:()=>({insertBefore(){}})}:nativeQuery(selector);p.modal=(title,html,save)=>dialog={title,html,save};p.change=async(action,payload)=>write={action,payload:plain(payload)};p.body=()=>{};await p.act('delete','d');const archive=createdButtons.pop();assert(dialog.title.includes('archivieren')&&archive.textContent==='Archivieren','archive choice in the active removal dialog remains');await archive.onclick();assert.deepEqual(write,{action:'archive_device',payload:{id:'d',date:'2026-11-22'}});
 }
 {
  const {p}=fixture(),material=p.data.settings.consumables.salt;material.quantity=-1;material.notes='Bisherige Notiz';
  let dialog,writes=[];p.modal=(title,html,save)=>dialog={title,html,save};p.change=async(action,payload)=>writes.push({action,payload:plain(payload)});p.usageDeviceEditor=()=>'';p.readRelatedDevices=()=>[];
  await p.act('material','salt');assert.equal(writes.length,0);
  const quantity=dialog.html.match(/<input name="quantity"[^>]*>/)[0],threshold=dialog.html.match(/<input name="threshold"[^>]*>/)[0];
  assert(quantity.includes('min="-100000"')&&quantity.includes('max="100000"')&&quantity.includes('value="-1"'));assert(threshold.includes('min="0"'));
  await dialog.save(new Map([['name','Salz'],['unit','kg'],['quantity','-1'],['threshold','1'],['notes','Nur Notiz geändert']]));
  assert.deepEqual(writes.pop(),{action:'save_consumable',payload:{value:{id:'salt',name:'Salz',unit:'kg',quantity:-1,threshold:1,notes:'Nur Notiz geändert',device_ids:[]}}});
  await p.act('materialstock','salt');assert(dialog.html.includes('min="-100000"'));await dialog.save(new Map([['quantity','-2']]));assert.equal(writes.pop().payload.value.quantity,-2);
  assert(p.field('cost','Kosten',1,'number').includes('min="0"'),'costs remain nonnegative');
 }
 console.log('PASS: Listen-/Detail-HTML unverändert, keine verworfene Übersicht/doppelte Metadaten, Rotationsmaterial-Vorrang, tote UI-Aktionen entfernt, Papierkorbhinweis einheitlich und negative Materialbestände bearbeitbar.');
}
module.exports={fixture};if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
