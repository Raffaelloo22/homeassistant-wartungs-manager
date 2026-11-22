const assert=require('node:assert/strict');
const {fixture}=require('./test_frontend_cleanup.cjs');
const plain=value=>JSON.parse(JSON.stringify(value));

function completedFixture(){
 const value=fixture(),{p}=value;p.selected='d';p.data.shopping={};p.taskPeriod='all';p.taskQuery='';
 const add=(id,name,kind,status,extra={})=>{
  p.data.rules[id]={id,device_id:'d',name,kind,...extra};
  p.data.views.push({rule_id:id,device_id:'d',device_name:p.data.devices.d.name,name,status,due:status==='ok'?null:'2026-12-01'});
 };
 add('dated','Firmware Update','date','ok',{due_date:'2026-11-22',completed_due_date:'2026-11-22',last_completed:'2026-11-22'});
 add('once','Einmalige Prüfung','none','ok',{last_completed:'2026-11-21'});
 add('recurring','Regelmässig reinigen','interval','due',{months:2,last_completed:'2026-11-20'});
 p.data.views.find(value=>value.rule_id==='recurring').due=p.data.today;
 add('sensor','Messwert prüfen','measurement','ok',{threshold:20,sensor_registry_id:'s',last_completed:'2026-11-20'});
 add('display','Nach Geräteanzeige pflegen','on_demand','on_demand');
 p.data.logs.firmware={id:'firmware',device_id:'d',rule_id:'dated',kind:'maintenance',event_date:'2026-11-22',recorded_at:'2026-11-22T18:28:37+01:00',note:'Firmware Update — auf Version 2.6.4 aktualisiert'};
 return value;
}
const view=(p,id)=>p.data.views.find(value=>value.rule_id===id);
function sections(html){
 const completed=html.indexOf('<details class="completed-tasks"');
 const history=html.indexOf('<section class="timeline">');
 const tasks=html.indexOf('<h2>Aufgaben</h2>');
 assert(tasks>=0&&history>tasks);
 return {open:html.slice(tasks,completed>=0?completed:history),completed:completed>=0?html.slice(completed,history):'',history:html.slice(history)};
}

async function run(){
 {
  const {p,body}=completedFixture(),before=plain(p.data);
  p.body();const parts=sections(body.innerHTML);
  for(const name of ['Firmware Update','Einmalige Prüfung']){assert(!parts.open.includes(name),name+' must leave the open list');assert(!parts.completed.includes(name),name+' is kept only in history');}
  for(const name of ['Prüfen','Regelmässig reinigen','Messwert prüfen','Nach Geräteanzeige pflegen'])assert(parts.open.includes(name),name+' keeps its previous display');
  assert.equal(parts.completed,'','one-offs alone do not create a completed-task list');
  assert(!p.task(view(p,'dated')).includes('class="task-primary"'),'a completed one-off cannot acquire a direct completion button through a generic task renderer');
  assert(p.task(view(p,'sensor')).includes('class="task-primary"'),'measurement-ok behaviour is not reinterpreted as a completed one-off');
  for(const log of Object.values(p.data.logs))assert(parts.history.includes(p.history(log)),'all history markup is preserved');
  assert.deepEqual(plain(p.data),before,'classification and rendering never mutate persisted records');
 }
 {
  const {p,body}=completedFixture();p.tab='tasks';p.selected=null;p.body();
  assert(!body.innerHTML.includes('Firmware Update')&&!body.innerHTML.includes('Einmalige Prüfung'),'global open tasks still exclude completed one-offs');
  assert(!body.innerHTML.includes('completed-tasks'),'global task view does not acquire a separate closed-rule list');
 }
 {
  const {p,body}=completedFixture(),dated=p.data.rules.dated;
  dated.due_date='2026-12-15';view(p,'dated').status='scheduled';view(p,'dated').due='2026-12-15';p.body();
  let parts=sections(body.innerHTML);assert(parts.open.includes('Firmware Update'),'rescheduling the same rule makes the new date open');assert(!parts.completed.includes('Firmware Update'));assert(parts.history.includes('auf Version 2.6.4 aktualisiert'));
  assert.equal(p.completedOneOff(view(p,'dated')),false,'old completion does not complete a different scheduled date');
  dated.due_date='2026-11-22';view(p,'dated').status='ok';assert.equal(p.completedOneOff(view(p,'dated')),true);
  delete dated.completed_due_date;delete dated.last_completed;view(p,'dated').status='due';view(p,'dated').due='2026-11-22';
  delete p.data.rules.once.last_completed;view(p,'once').status='no_due';p.body();parts=sections(body.innerHTML);
  assert(parts.open.includes('Firmware Update')&&parts.open.includes('Einmalige Prüfung'),'undo completion flags returns rules to the open list');assert.equal(parts.completed,'','no empty completed section remains');
 }
 {
  const {p,body}=completedFixture();p.data.devices.d.archived=true;
  for(const task of p.data.views)task.status='archived';p.body();const parts=sections(body.innerHTML);
  assert(!parts.open.includes('Firmware Update')&&!parts.open.includes('Einmalige Prüfung'),'device archive status does not conceal the underlying completion');
  assert(!parts.completed.includes('Firmware Update')&&!parts.completed.includes('Einmalige Prüfung'));
  assert(parts.history.includes('Firmware Update'),'archiving keeps completed one-off history');
  assert(parts.open.includes('Regelmässig reinigen')&&parts.open.includes('Messwert prüfen'));
 }
 {
  const {p}=completedFixture(),before=plain(p.data),writes=[];let dialog,closed=0;
  p.modal=(title,html,submit)=>dialog={title,html,submit};p.change=async(action,payload)=>writes.push({action,payload:plain(payload)});p.close=()=>closed++;
  await p.act('rule','dated');assert.equal(dialog.title,'Wartungsaufgabe');assert(dialog.html.includes('Firmware Update'));assert(dialog.html.includes('name="due_date"'));assert.equal(writes.length,0,'opening completed rule does not save it');
  await p.act('cancel');assert.equal(closed,1);assert.equal(writes.length,0);assert.deepEqual(plain(p.data),before,'cancel keeps rule and history unchanged');
  await p.act('rule','dated');await dialog.submit(new Map([['kind','date'],['name','Firmware Update'],['due_date','2026-12-15'],['booked',''],['review_note','Nächster Termin'],['consumable_key','']]));
  assert.equal(writes.length,1);assert.equal(writes[0].action,'save_rule');assert.equal(writes[0].payload.value.id,'dated');assert.equal(writes[0].payload.value.device_id,'d');assert.equal(writes[0].payload.value.due_date,'2026-12-15');
 }
 {
  const {p,body}=completedFixture(),dated=view(p,'dated');
  delete p.data.rules.dated.last_completed;assert.equal(p.completedOneOff(dated),true,'scheduled marker still identifies older completed one-off rules');
  p.body();assert(!sections(body.innerHTML).open.includes('Firmware Update'));assert(sections(body.innerHTML).history.includes('Firmware Update'));
 }
 {
  const {p}=completedFixture(),proto=Object.getPrototypeOf(p),main={scrollTop:272,scrollLeft:0};
  const detail=open=>({open,getAttribute:key=>key==='data-preserve-key'?'completed-tasks:d':null,classList:{contains:()=>false}});
  let details=[detail(true)];const body={contains:()=>false,querySelectorAll:selector=>selector==='details[open]'?details.filter(value=>value.open):selector==='details'?details:[]};
  p.shadowRoot={activeElement:null,querySelector:selector=>selector==='#body'?body:selector==='.main'?main:null};
  p.captureBodyState=proto.captureBodyState;p.restoreBodyState=proto.restoreBodyState;
  const state=p.captureBodyState();assert(state.open.includes('completed-tasks:d'));
  details=[detail(false)];main.scrollTop=0;p.restoreBodyState(state);assert.equal(details[0].open,true,'background updates preserve an expanded completed-rules section');assert.equal(main.scrollTop,272);
 }
 {
  const {p}=completedFixture();let dialog;
  p.modal=(title,html)=>dialog={title,html};
  await p.act('newrule','d');let kind=dialog.html.match(/<select name="kind">[\s\S]*?<\/select>/)[0];
  assert(/<option value="date" selected>Termin<\/option>/.test(kind),'new tasks default to Termin');
  await p.act('rule','recurring');kind=dialog.html.match(/<select name="kind">[\s\S]*?<\/select>/)[0];
  assert(/<option value="interval" selected>/.test(kind),'editing an existing recurrence preserves its kind');
 }
 console.log('PASS: Erledigte Einmalaufgaben nur in Historie, offene Regeln unverändert, Replan/Undo/Archiv korrekt und Aufklappzustand erhalten.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
