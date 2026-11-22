const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
let Panel;
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../custom_components/ha_wartung/frontend/panel.js'),'utf8'),{HTMLElement:class{},customElements:{get:()=>null,define:(_,value)=>Panel=value},setTimeout,clearTimeout});
const copy=value=>JSON.parse(JSON.stringify(value));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
const snapshot=revision=>({revision,today:'2026-11-22',version:'1.0.45',devices:{d:{id:'d',name:'Sensor',category:'Sensoren'}},rules:{},logs:{},shopping:{},views:[],settings:{}});
function fixture(){
 const elements=new Map();
 const root={activeElement:null,querySelector(selector){return selector.split(',').map(part=>elements.get(part.trim())).find(Boolean)||null;},querySelectorAll(){return [];}};
 const scroll={scrollTop:271,scrollLeft:13};elements.set('.main',scroll);
 const panel=Object.assign(Object.create(Panel.prototype),{shadowRoot:root,data:snapshot(10),reg:{devices:[],sensors:[],areas:[]},tab:'tasks',pending:false,dialogOpen:false,batteryTaskKey:'[]',taskPeriod:'now',taskQuery:'',query:'',logQuery:'',area:'',categoryFilter:'',deviceMode:'active',draws:0,bodies:0,filterSyncs:0,notices:[],draw(){this.draws++;},body(){this.bodies++;},syncFilterOptions(){this.filterSyncs++;},notice(message,error){this.notices.push({message,error});}});
 return {panel,root,elements,scroll};
}
(async()=>{
 // Polling unchanged data must preserve nodes and leave open reading state untouched.
 {
  const {panel}=fixture();panel.api=async()=>copy(panel.data);await panel.refresh();assert.equal(panel.draws,0,'unchanged snapshots must not rebuild the shadow root');assert.equal(panel.bodies,0,'unchanged snapshots must not rebuild the body');
 }
 // A new snapshot updates view contents without reconstructing header, toolbar or dialog.
 {
  const {panel,scroll}=fixture();panel.api=async()=>snapshot(11);await panel.refresh();assert.equal(panel.data.revision,11);assert.equal(panel.draws,0,'background changes must update the body rather than redraw the whole panel');assert.equal(panel.bodies,1);assert.equal(panel.filterSyncs,1);
 }
 // Multiple simultaneous timer/manual requests share one GET and one redraw.
 {
  const {panel}=fixture(),response=deferred();let requests=0;panel.api=async()=>{requests++;return response.promise;};const first=panel.refresh(),second=panel.refresh();assert.equal(requests,1,'coalesce simultaneous background reads');response.resolve(snapshot(11));await Promise.all([first,second]);assert.equal(panel.bodies,1);assert.equal(panel.draws,0);
 }
 // Never apply an older in-flight read over a newer save or revision.
 {
  const {panel}=fixture(),response=deferred();panel.api=()=>response.promise;const refresh=panel.refresh();panel.data=snapshot(12);response.resolve(snapshot(11));await refresh;assert.equal(panel.data.revision,12);assert.equal(panel.bodies,0);assert.equal(panel.draws,0);
 }
 // The guard is checked again after GET: a dialog opened during the request keeps its data.
 {
  const {panel}=fixture(),response=deferred();panel.api=()=>response.promise;const refresh=panel.refresh();panel.dialogOpen=true;response.resolve(snapshot(11));await refresh;assert.equal(panel.bodies,0);assert.equal(panel.draws,0);assert.equal(panel.data.revision,10,'dialog closures must retain their original revision until the interaction ends');
 }
 // Menus and active input are protected from both polling and delayed responses.
 for(const mode of ['dialog','input','select','textarea','contenteditable','menu','drag','pending','threshold']){
  const {panel,root,elements}=fixture();panel.api=async()=>snapshot(11);
  if(mode==='dialog')panel.dialogOpen=true;
  if(['input','select','textarea','contenteditable'].includes(mode))root.activeElement={id:'editing',tagName:mode==='contenteditable'?'DIV':mode.toUpperCase(),isContentEditable:mode==='contenteditable',matches:()=>true};
  if(mode==='drag')elements.set('.dragging',{className:'dragging'});
  if(mode==='menu')elements.set('.task-menu[open]',{open:true});
  if(mode==='pending')panel.pending=true;
  if(mode==='threshold')panel.thresholdSaving=true;
  await panel.refresh();assert.equal(panel.bodies,0,mode+' must defer background rendering');assert.equal(panel.draws,0,mode+' must not reconstruct the shadow root');
 }
 // A menu opened while GET is in flight also protects the existing action target.
 {
  const {panel,elements}=fixture(),response=deferred();panel.api=()=>response.promise;const refresh=panel.refresh();elements.set('.task-menu[open]',{open:true});response.resolve(snapshot(11));await refresh;assert.equal(panel.bodies,0);assert.equal(panel.data.revision,10);assert.equal(panel.backgroundDeferred,true);
  elements.delete('.task-menu[open]');panel.api=async()=>snapshot(12);await panel.flushBackgroundUpdates();assert.equal(panel.data.revision,12);assert.equal(panel.bodies,1);assert.equal(panel.draws,0);
 }
 // Live battery values update existing fields; only a changed device set requests structure.
 {
  const {panel,elements}=fixture();let rows=[{device_id:'d',battery_value:12}];panel.batteryTasks=()=>rows;
  panel.batteryTaskKey=JSON.stringify(['d']);rows=[{device_id:'d',battery_value:11}];panel.updateBatteryTaskStructure();assert.equal(panel.bodies,0,'one-percent changes must not rebuild task cards');
  elements.set('.task-menu[open]',{open:true});rows=[{device_id:'d',battery_value:11},{device_id:'other',battery_value:5}];panel.updateBatteryTaskStructure();assert.equal(panel.bodies,0);assert.equal(panel.backgroundDeferred,true);assert.equal(panel.batteryTaskKey,JSON.stringify(['d']),'deferred memberships must remain unapplied until safe to redraw');
  elements.delete('.task-menu[open]');panel.updateBatteryTaskStructure();assert.equal(panel.bodies,1);assert.equal(panel.batteryTaskKey,JSON.stringify(['d','other']));
 }
 // Home Assistant state updates keep menus alive while refreshing visible battery text.
 {
  const {panel,elements}=fixture(),menu={open:true};elements.set('.task-menu[open]',menu);let warnings=0,badges=0;
  panel.batteryTaskKey=JSON.stringify(['d']);panel.batteryTasks=()=>[{device_id:'d',battery_value:Number(panel._hass.states['sensor.battery'].state)}];
  panel.syncBatteryThresholdControl=panel.updateDeviceStatuses=()=>{};panel.updateBatteryWarnings=()=>warnings++;panel.updateBatteryBadges=()=>badges++;
  panel.hass={states:{'sensor.battery':{state:'11'},'input_number.batterien_schwellwert':{state:'20'}}};
  assert.equal(panel.bodies,0);assert.equal(panel.draws,0);assert.equal(warnings,1);assert.equal(badges,1);assert.equal(menu.open,true);
 }
 // Stable disclosure keys survive reordering; ordinary action focus and scroll are restored.
 {
  const {panel,root,elements,scroll}=fixture();
  const detail=(key,open=false,css='')=>({open,getAttribute:attr=>attr==='data-preserve-key'?key:null,classList:{contains:name=>name===css}});
  let details=[detail(null,true,'settings-categories'),detail(null,false,'settings-event-types'),detail('battery:AA',true),detail('material:salt',false)];
  const active={dataset:{action:'addtask',id:''}},replacement={dataset:{action:'addtask',id:''},focus(options){this.focused=true;this.options=options;root.activeElement=this;}};
  let buttons=[active],writes=0;
  const body={contains:node=>buttons.includes(node),querySelectorAll:selector=>selector==='details[open]'?details.filter(item=>item.open):selector==='details'?details:selector==='button[data-action]'?buttons:[]};
  Object.defineProperty(body,'innerHTML',{get(){return this.html||'';},set(value){this.html=value;writes++;details=[detail('material:salt'),detail('battery:AA'),detail(null,false,'settings-event-types'),detail(null,false,'settings-categories')];buttons=[replacement];scroll.scrollTop=0;scroll.scrollLeft=0;}});
  elements.set('#body',body);root.activeElement=active;
  panel.bindCategoryDrag=panel.bindEventTypeDrag=panel.bindBatteryThresholdControl=()=>{};
  assert.equal(panel.backgroundBusy(),false,'a normally focused action button must not block polling indefinitely');
  Panel.prototype.body.call(panel);
  assert.equal(scroll.scrollTop,271);assert.equal(scroll.scrollLeft,13);assert(replacement.focused);assert.equal(replacement.options.preventScroll,true);
  assert.deepEqual(details.filter(item=>item.open).map(item=>item.getAttribute('data-preserve-key')||'categories'),['battery:AA','categories']);
  // Opening/closing a native disclosure changes live DOM, not the cached render string.
  details[0].open=true;Panel.prototype.body.call(panel);assert.equal(writes,1,'equivalent body HTML must preserve live nodes and disclosure state');assert(details[0].open);
 }
 // Refresh filter options reflects new categories/areas without resetting valid selections.
 {
  const {panel,elements}=fixture();const category={innerHTML:'',value:''},area={innerHTML:'',value:''};elements.set('#categoryfilter',category);elements.set('#area',area);
  panel.data.settings.device_categories=['Sensoren'];panel.data.devices.d.area='OG Zoé';panel.categoryFilter='Sensoren';panel.area='OG Zoé';
  Panel.prototype.syncFilterOptions.call(panel);assert.equal(category.value,'Sensoren');assert.equal(area.value,'OG Zoé');assert(category.innerHTML.includes('Sensoren'));assert(area.innerHTML.includes('OG Zoé'));
  panel.categoryFilter='Entfernte Kategorie';panel.area='Entfernter Bereich';Panel.prototype.syncFilterOptions.call(panel);assert.equal(panel.categoryFilter,'');assert.equal(panel.area,'');assert.equal(category.value,'');assert.equal(area.value,'');
 }
 // Failed reads preserve content and rzoese the single-flight guard for retries.
 {
  const {panel}=fixture();let fail=true,requests=0;panel.api=async()=>{requests++;if(fail)throw Error('offline');return snapshot(11);};await panel.refresh();assert.equal(panel.data.revision,10);assert.equal(panel.draws,0);assert.equal(panel.notices.length,1);assert.equal(panel.notices[0].error,true);fail=false;await panel.refresh();assert.equal(requests,2);assert.equal(panel.data.revision,11);assert.equal(panel.bodies,1);
 }
 console.log('PASS: Hintergrundaktualisierung ohne unnötigen Neuaufbau, Scroll-Erhalt, Parallel- und Revisionsschutz, Dialog-/Menü-/Eingabeschutz und Fehlerretry.');
})().catch(error=>{console.error(error);process.exitCode=1;});
