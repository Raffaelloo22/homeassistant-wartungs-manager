const assert=require('node:assert/strict');
const {fixture}=require('./test_frontend_cleanup.cjs');
const plain=value=>JSON.parse(JSON.stringify(value));
function setup(){const f=fixture();Object.assign(f.p,{deviceChangePeriod:'all',deviceMode:'active',taskPeriod:'now'});Object.assign(f.p.data,{today:'2026-11-23',timezone:'Europe/Zurich',shopping:{}});return f;}
(async()=>{
 {
  const {p}=setup(),stamp=device_updated_at=>({device_updated_at});
  for(const period of ['today','yesterday','week','month']){
   p.deviceChangePeriod=period;
   for(const device of [{},{device_updated_at:'ungültig'},{device_updated_at:'2026-11-23'},{device_updated_at:'2026-11-23T12:00:00'},{device_updated_at:'2026-11-24T12:00:00Z'}])assert.equal(p.deviceChangeMatches(device),false,'unknown, naive and future change dates are excluded');
  }
  p.deviceChangePeriod='today';assert(p.deviceChangeMatches(stamp('2026-11-22T23:15:00Z')),'HA local day, not UTC day');assert(!p.deviceChangeMatches(stamp('2026-11-22T22:59:59Z')));
  assert(p.deviceChangeMatches({created_at:'2026-11-23T10:00:00+01:00'}),'new devices count without inventing a legacy date');
  p.deviceChangePeriod='yesterday';assert(p.deviceChangeMatches(stamp('2026-11-22T10:00:00Z')));assert(!p.deviceChangeMatches(stamp('2026-11-23T10:00:00Z')));
  p.deviceChangePeriod='week';assert(p.deviceChangeMatches(stamp('2026-11-17T10:00:00Z')));assert(!p.deviceChangeMatches(stamp('2026-11-16T10:00:00Z')));assert(p.deviceChangeMatches(stamp('2026-11-23T10:00:00Z')));
  p.deviceChangePeriod='month';assert(p.deviceChangeMatches(stamp('2026-10-25T10:00:00Z')));assert(!p.deviceChangeMatches(stamp('2026-10-24T10:00:00Z')));
  p.data.today='2026-03-29';p.deviceChangePeriod='today';assert(p.deviceChangeMatches(stamp('2026-03-28T23:30:00Z')));assert(p.deviceChangeMatches(stamp('2026-03-29T21:59:59Z')));assert(!p.deviceChangeMatches(stamp('2026-03-29T22:00:00Z')),'summer-time boundary follows HA timezone');
  p.deviceChangePeriod='all';assert(p.deviceChangeMatches({}),'all preserves old devices with no historical timestamp');
 }
 {
  const {p}=setup();p.data.devices.d.device_updated_at='2026-11-23T10:00:00Z';p.data.devices.linked.device_updated_at='2026-11-23T10:00:00Z';
  p.deviceChangePeriod='today';p.query='testlampe';p.categoryFilter='Licht';p.area='Wohnzimmer';assert(p.deviceList(false).includes('Testlampe &amp; Gerät'));assert(!p.deviceList(false).includes('Verknüpft'));
  p.area='Küche';assert(p.deviceList(false).includes('Keine Geräte.'));p.area='';p.deviceChangePeriod='yesterday';assert(p.deviceList(false).includes('Keine Geräte.'));
  p.data.logs.new={device_id:'d',recorded_at:'2026-11-22T12:00:00Z'};p.data.rules.r.name='Aufgabe geändert';assert(p.deviceList(false).includes('Keine Geräte.'),'task/history timestamps are never a device filter fallback');
  p.deviceChangePeriod='all';assert(p.deviceList(false).includes('Testlampe &amp; Gerät'));
  p.deviceChangePeriod='today';assert(!p.matches({...p.data.devices.d,device_updated_at:undefined,deleted_at:'2026-11-23T12:00:00Z'}),'deleted_at is not a substitute for metadata change date');
 }
 {
  const {p,body}=setup(),nodes=new Map();for(const selector of ['#search','#clearsearch','#categoryfilter','#area','#taskperiod','#logyear','#devicechanges'])nodes.set(selector,{value:'',innerHTML:'',hidden:false});nodes.set('#body',body);
  const root={innerHTML:'',querySelector:selector=>nodes.get(selector)||null,querySelectorAll:()=>[],addEventListener(){}};p.shadowRoot=root;p.renderCompletionUndo=()=>{};
  let renders=0;const render=p.body;p.body=function(){renders++;return render.call(this);};p.draw();
  assert(root.innerHTML.includes('aria-label="Änderungen am Gerät"'));assert(!root.innerHTML.match(/<label class="device-change-filter"[^>]*>/)[0].includes('hidden'));
  const select=nodes.get('#devicechanges');select.oninput({target:{value:'today'}});assert.equal(p.deviceChangePeriod,'today');assert.equal(renders,2,'filter applies on selection');select.onchange({target:{value:'today'}});assert.equal(renders,2,'input/change does not draw twice');assert.equal(p.taskPeriod,'now');
  p.tab='tasks';p.draw();assert(root.innerHTML.match(/<label class="device-change-filter"[^>]*>/)[0].includes('hidden'),'device changes filter is limited to devices');
 }
 {
  const {p,body}=setup();p.selected='d';p.body();const actions=body.innerHTML.match(/<div class="actions">(.*?)<\/div>/s)[1];assert(actions.indexOf('data-action="duplicatedevice"')>0);assert(actions.indexOf('data-action="duplicatedevice"')<actions.indexOf('data-action="delete"'),'Duplizieren immediately precedes Entfernen');
  const original=plain(p.data),writes=[];let modal;
  p.modal=(title,html,submit,label)=>modal={title,html,submit,label};p.change=async(action,payload)=>{writes.push({action,payload:plain(payload)});return {id:'copy-1'};};p.body=()=>{};
  await p.act('duplicatedevice','d');assert.equal(writes.length,0,'opening and cancelling duplication never creates a record');assert.equal(modal.title,'Gerät duplizieren');assert(modal.html.includes('name="name"')&&modal.html.includes('name="notes"'));
  for(const field of ['serial','ha_device_id','device_status','related_self_id','related_device_id','previous_archived_at'])assert(!modal.html.includes('name="'+field+'"'),'physical IDs, lifecycle and graph fields are absent');
  assert(modal.html.includes('Testlampe &amp; Gerät (Kopie)'));assert.equal(modal.label,'Duplikat anlegen');
  const form={get:key=>({name:'Meine Kopie',manufacturer:'Marke',model:'Modell',category:'Licht',notes:'Eigene Notiz',battery_type:'AA',battery_quantity:'2',battery_alert_enabled:'on',purchase_date:'2026-11-23'}[key]??null),getAll:()=>[]};
  await modal.submit(form);assert.equal(writes.length,1);assert.equal(writes[0].action,'duplicate_device');assert.equal(writes[0].payload.id,'d');assert(writes[0].payload.operation_id);assert.deepEqual(writes[0].payload.value,{name:'Meine Kopie',manufacturer:'Marke',model:'Modell',category:'Licht',notes:'Eigene Notiz',battery_type:'AA',battery_quantity:2,battery_alert_enabled:true,purchase_date:'2026-11-23'});assert.equal(p.selected,'copy-1');assert.equal(p.deviceMode,'active');assert.deepEqual(plain(p.data),original,'duplication UI never mutates original snapshot');
  const token=writes[0].payload.operation_id;await modal.submit(form);assert.equal(writes[1].payload.operation_id,token,'a retried save reuses the same idempotence key');
  p.data.devices.copy={id:'copy',name:'Testlampe & Gerät (Kopie)'};await p.act('duplicatedevice','d');assert(modal.html.includes('Testlampe &amp; Gerät (Kopie 2)'),'preview avoids an already existing copy name');
 }
 console.log('PASS: Geräteänderungsfilter mit lokalen Tagesgrenzen und kombinierten Filtern; Duplizieren ohne Identitäten, Aufgaben oder sofortige Speicherung.');
})().catch(error=>{console.error(error);process.exitCode=1;});
