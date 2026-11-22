const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
let Panel,now=Date.UTC(2026,10,22,12),nextTimer=0,nextOperation=0;const timers=new Map();
class ClockDate extends Date{static now(){return now;}}
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../custom_components/ha_wartung/frontend/panel.js'),'utf8'),{HTMLElement:class{},customElements:{get:()=>null,define:(_,c)=>Panel=c},Date:ClockDate,crypto:{randomUUID:()=>`operation-${++nextOperation}`},setTimeout:(fn,delay)=>{timers.set(++nextTimer,{fn,at:now+delay});return nextTimer;},clearTimeout:id=>timers.delete(id)});
const plain=value=>JSON.parse(JSON.stringify(value));
function tick(ms){now+=ms;for(const [id,timer]of [...timers])if(timer.at<=now){timers.delete(id);timer.fn();}}
function form(values){const map=new Map(Object.entries(values));return {get:key=>map.has(key)?map.get(key):null,has:key=>map.has(key)};}
function fixture(){
  const p=Object.create(Panel.prototype),root={elements:new Map(),addEventListener(){},querySelector(selector){return this.elements.get(selector)||null;},querySelectorAll(){return [];}};
  Object.defineProperty(root,'innerHTML',{set(html){this.html=html;this.elements=new Map(['#notice','#completion-undo','#search','#clearsearch','#categoryfilter','#area','#taskperiod','dialog .errors'].map(selector=>[selector,{hidden:true,innerHTML:'',textContent:''}]));}});
  Object.assign(p,{shadowRoot:root,tab:'tasks',query:'',taskQuery:'',taskPeriod:'now',logQuery:'',area:'',categoryFilter:'',pending:false,data:{revision:12,today:'2026-11-22',devices:{d:{id:'d',name:'Kaffeemaschine'}},settings:{},rules:{r:{id:'r',device_id:'d',kind:'interval',name:'Wasserfilter wechseln'}},views:[{rule_id:'r',name:'Wasserfilter wechseln'}]},body(){},close(){this.closed=(this.closed||0)+1;},notice(message,error){this.lastNotice={message,error};},materialConsumptionQuestion(){return '';}});
  p.draw();return p;
}
async function completionDialog(){
  const p=fixture(),calls=[];let dialog;p.modal=(title,html,submit,label)=>dialog={title,html,submit,label};
  p.api=async(action,payload)=>{calls.push({action,payload:plain(payload||{})});return action==='get'?{...p.data,revision:p.data.revision+1}:{id:'log-1'};};
  await p.act('today','r');assert.equal(calls.length,0,'opening Erledigt must never mutate');assert(dialog.html.includes('Wasserfilter wechseln')&&dialog.html.includes('name="event_date"'));assert.equal(dialog.label,'Erledigung speichern');
  await dialog.submit(form({event_date:'2026-11-20',note:'Ersatzfilter eingesetzt',cost:'',consume_material:'on'}));
  assert.deepEqual(calls.map(call=>call.action),['complete','get']);assert.deepEqual(calls[0].payload,{revision:12,rule_id:'r',operation_id:'operation-1',consume_material:true,event_date:'2026-11-20',note:'Wasserfilter wechseln — Ersatzfilter eingesetzt',cost:null,cycle:null});assert.equal(p.undoEntry.id,'log-1');assert(!p.shadowRoot.querySelector('#completion-undo').hidden,'undo must survive draw after the saved snapshot loads');assert.equal(p.pending,false);
  p.clearCompletionUndo('log-1');p.data.rules.r.kind='measurement';calls.length=0;await p.act('completion','r');await dialog.submit(form({event_date:'2026-11-22',note:'',cost:'3.5',measurement:'42'}));assert.deepEqual(calls.map(call=>call.action),['complete','get'],'optional measurement must be in the same atomic completion request');assert.equal(calls[0].payload.measurement,42);assert.equal(calls[0].payload.note,'Wasserfilter wechseln');assert.equal(calls[0].payload.cost,3.5);
  // Double submission while the first request is in flight must not book twice.
  p.clearCompletionUndo('log-1');let rzoese;calls.length=0;p.api=async(action,payload)=>{calls.push({action,payload:plain(payload||{})});if(action==='complete')return new Promise(resolve=>rzoese=resolve);return p.data;};
  await p.act('today','r');const pending=dialog.submit(form({event_date:'2026-11-22',note:'',cost:''}));await dialog.submit(form({event_date:'2026-11-22',note:'',cost:''}));assert.equal(calls.length,1);assert.equal(p.pending,true);rzoese({id:'log-double'});await pending;assert.deepEqual(calls.map(call=>call.action),['complete','get']);assert.equal(p.undoEntry.id,'log-double');p.clearCompletionUndo('log-double');
}
async function visibilityAndLifetime(){
  const p=fixture();p.offerCompletionUndo('old');const oldTimer=timers.get(p.undoTimer).fn;assert.equal(p.undoEntry.expires,now+30000);assert(p.shadowRoot.querySelector('#completion-undo').innerHTML.includes('data-id="old"'));
  tick(5000);p.offerCompletionUndo('new');oldTimer();assert.equal(p.undoEntry.id,'new','a stale timer cannot remove a newer undo offer');
  p.draw();let el=p.shadowRoot.querySelector('#completion-undo');assert(!el.hidden&&el.innerHTML.includes('data-action="undocomplete" data-id="new"'),'full redraw must recreate the current undo offer');
  await p.act('dismissundo','old');assert.equal(p.undoEntry.id,'new');await p.act('dismissundo','new');assert.equal(p.undoEntry,null);assert(p.shadowRoot.querySelector('#completion-undo').hidden);
  p.offerCompletionUndo('timeout');tick(29999);assert.equal(p.undoEntry.id,'timeout');tick(1);assert.equal(p.undoEntry,null);assert(p.shadowRoot.querySelector('#completion-undo').hidden);
  p.offerCompletionUndo('sleep');now+=30001;p.draw();assert.equal(p.undoEntry,null,'render must expire an offer even if browser timers were suspended');
  p.offerCompletionUndo('refresh');p.api=async()=>({...p.data,revision:99});await p.refresh();assert.equal(p.data.revision,99);assert(!p.shadowRoot.querySelector('#completion-undo').hidden);assert.equal(p.undoEntry.id,'refresh');p.clearCompletionUndo('refresh');
}
async function undoRequests(){
  const p=fixture(),calls=[];p.offerCompletionUndo('log-undo');let rzoese;
  p.api=async(action,payload)=>{calls.push({action,payload:plain(payload||{})});if(action==='undo_completion')return new Promise(resolve=>rzoese=resolve);return {...p.data,revision:13};};
  await p.act('undocomplete','wrong-id');assert.equal(calls.length,0);
  const pending=p.act('undocomplete','log-undo');await p.act('undocomplete','log-undo');assert.deepEqual(calls,[{action:'undo_completion',payload:{revision:12,id:'log-undo'}}]);assert.equal(p.pending,true);
  rzoese({id:'log-undo'});await pending;assert.equal(p.undoEntry,null);assert.equal(p.pending,false);assert(p.shadowRoot.querySelector('#completion-undo').hidden);assert.equal(p.lastNotice.message,'Erledigung rückgängig gemacht.');
  p.offerCompletionUndo('retry');calls.length=0;p.api=async(action,payload)=>{calls.push({action,payload:plain(payload||{})});throw Error('Verbindung unterbrochen');};
  await assert.rejects(p.act('undocomplete','retry'),/Verbindung unterbrochen/);assert.equal(p.undoEntry.id,'retry','failed undo must stay available for a retry');assert.equal(p.pending,false);assert(!p.shadowRoot.querySelector('#completion-undo').hidden);
  calls.length=0;p.api=async(action,payload)=>{calls.push({action,payload:plain(payload||{})});if(action==='undo_completion')throw Error('Zwischenzeitlich geändert');return {...p.data,revision:20};};await assert.rejects(p.act('undocomplete','retry'),/zwischenzeitlich geändert/);assert.equal(p.data.revision,20);assert.equal(p.undoEntry.id,'retry');
  calls.length=0;p.api=async(action,payload)=>{calls.push({action,payload:plain(payload||{})});return action==='get'?{...p.data,revision:21}:{id:'retry'};};await p.act('undocomplete','retry');assert.deepEqual(calls[0],{action:'undo_completion',payload:{revision:20,id:'retry'}});assert.equal(p.undoEntry,null);
}
(async()=>{await completionDialog();await visibilityAndLifetime();await undoRequests();assert.equal(timers.size,0);console.log('PASS: Erledigungsdialog, atomare Messung, doppelte Klicks, Rückgängig mit Revision/Fehlerretry, Refresh, Schliessen und 30-Sekunden-Frist.');})().catch(error=>{console.error(error);process.exitCode=1;});
