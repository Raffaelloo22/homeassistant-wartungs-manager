const assert=require('node:assert/strict');
const {fixture}=require('./test_frontend_cleanup.cjs');
const plain=value=>JSON.parse(JSON.stringify(value));

function recurringFixture(ruleExtra={},viewExtra={}){
 const {p,body}=fixture();p.selected='d';p.taskPeriod='all';p.taskQuery='';p.data.shopping={};
 const rule={id:'nuki',device_id:'d',name:'Aufladen',kind:'interval',months:2,days:0,last_completed:'2026-11-22',...ruleExtra};
 const view={rule_id:'nuki',device_id:'d',device_name:p.data.devices.d.name,name:rule.name,status:'scheduled',due:'2027-01-22',booked:null,...viewExtra};
 p.data.rules.nuki=rule;p.data.views.push(view);
 p.data.logs.charge={id:'charge',device_id:'d',rule_id:'nuki',kind:'maintenance',event_date:'2026-11-22',recorded_at:'2026-11-22T18:28:00+01:00',note:'Von 40 % auf 80 % geladen'};
 return {p,body,rule,view};
}
function sections(html){
 const tasks=html.indexOf('<h2>Aufgaben</h2>'),completed=html.indexOf('<details class="completed-tasks"'),history=html.indexOf('<section class="timeline">');
 assert(tasks>=0&&history>tasks);
 return {open:html.slice(tasks,completed<0?history:completed),completed:completed<0?'':html.slice(completed,history),history:html.slice(history)};
}
async function run(){
 {
  const {p,body,view}=recurringFixture(),before=plain(p.data);p.body();const parts=sections(body.innerHTML),card=p.completedTask(view);
  assert(!parts.open.includes('Aufladen'),'completed current cycle leaves the open device-task list');
  assert(parts.completed.includes('Erledigte Aufgaben')&&parts.completed.includes('Aufladen'));
  assert(parts.completed.includes('data-preserve-key="completed-tasks:d"'));
  assert(!/^<details[^>]*\bopen(?:\s|=|>)/.test(parts.completed),'section starts collapsed');
  assert(card.includes('22.11.26'),'completion date stays visible');
  assert(card.includes('Nächster Termin:')&&card.includes('22.01.27'),'next two-month recurrence remains visible');
  for(const action of ['rule','deleterule'])assert(card.includes(`data-action="${action}" data-id="nuki"`));
  for(const action of ['today','completion','batterylog'])assert(!card.includes(`data-action="${action}"`),'completed detail card cannot directly complete again');
  for(const log of Object.values(p.data.logs))assert(parts.history.includes(p.history(log)),'full history markup is unchanged');
  assert.deepEqual(plain(p.data),before,'display does not alter dates, rules, history or stocks');
 }
 {
  const {p,body,view}=recurringFixture();
  for(const [today,status] of [['2027-01-22','due'],['2027-01-23','overdue']]){
   p.data.today=today;view.status=status;p.body();const parts=sections(body.innerHTML);
   assert.equal(p.completedForNow(view),false);assert(parts.open.includes('Aufladen'),'due or overdue recurrence returns to open tasks');assert(!parts.completed.includes('Aufladen'));
  }
 }
 {
  const {p,body,rule,view}=recurringFixture();delete rule.last_completed;p.body();
  assert.equal(p.completedForNow(view),false);assert(sections(body.innerHTML).open.includes('Aufladen'),'undoing the completion returns the rule to the open list');
  rule.last_completed='2026-11-22';
  for(const booked of ['2026-11-22','2026-11-21']){view.booked=booked;assert.equal(p.completedForNow(view),false,'a due/past appointment stays open even when regular due date is later');}
  view.booked='2026-12-01';assert.equal(p.completedForNow(view),true);assert(p.completedTask(view).includes('01.12.26'),'booked execution date takes priority over the calculated due date');
 }
 {
  const {p,rule,view}=recurringFixture({kind:'season',month:11,day:22},{due:'2027-11-22'});
  assert.equal(p.completedForNow(view),true);assert(p.completedTask(view).includes('22.11.27'));
  rule.kind='rotation';rule.name='Pflegefolge';rule.steps=['Entkalken','Reinigen'];rule.rotation_step=1;view.name='Reinigen';view.due='2027-01-22';
  assert.equal(p.completedForNow(view),true);const card=p.completedTask(view);
  assert(card.includes('<div class="task-title">Pflegefolge</div>'),'rotation is shown by rule name, not as if the next step was completed');
  assert(card.includes('Reinigen')&&card.includes('22.01.27'),'next rotation step and its date remain discoverable');
  view.name='<img src=x onerror=alert(1)>';rule.name='<script>Pflege</script>';const escaped=p.completedTask(view);
  assert(!escaped.includes('<img')&&!escaped.includes('<script>'));assert(escaped.includes('&lt;img')&&escaped.includes('&lt;script&gt;'));
 }
 {
  const {p,rule,view}=recurringFixture({months:24,last_completed:'2025-12-31'},{due:'2027-12'});
  assert.equal(p.completedForNow(view),true);
  const card=p.completedTask(view);assert(card.includes('Nächster Termin: 12.27'),'month-precision schedules retain their original precision');
  assert(!card.includes('01.12.27'),'display must not invent an exact day for a monthly schedule');
  p.data.today='2027-12-01';view.status='due';assert.equal(p.completedForNow(view),false,'current due month returns the recurrence to open tasks');
 }
 {
  const {p,body,view}=recurringFixture();p.data.devices.d.archived=true;view.status='archived';p.body();
  assert.equal(p.completedForNow(view),true);assert(sections(body.innerHTML).completed.includes('Aufladen'),'device archiving does not lose the completed cycle');
 }
 {
  const {p,rule,view}=recurringFixture();view.due='2026-11-23';view.status='soon';rule.last_completed='2026-09-23';
  assert.equal(p.completedForNow(view),true,'future recurrence stays completed until its actual date');
  for(const kind of ['measurement','on_demand']){rule.kind=kind;assert.equal(p.completedForNow(view),false,kind+' keeps its existing semantics');}
  rule.kind='interval';rule.months=0;rule.days=0;view.status='planning';view.due=null;assert.equal(p.completedForNow(view),false,'unplanned rules need planning rather than a completed-state assumption');
  rule.kind='date';rule.due_date='2027-01-22';rule.completed_due_date='2026-11-22';view.status='scheduled';view.due='2027-01-22';assert.equal(p.completedForNow(view),false,'a new one-off date is not the old completed occurrence');
 }
 {
  const {p,body,view}=recurringFixture();p.tab='tasks';p.selected=null;p.body();
  assert(body.innerHTML.includes('Aufladen'),'global All view keeps the planned recurrence');assert(!body.innerHTML.includes('completed-tasks'));
  view.status='soon';view.due='2026-11-23';p.taskPeriod='soon';p.body();assert(body.innerHTML.includes('Aufladen'),'global upcoming filter keeps its independent 14-day behaviour');
 }
 {
  const {p,rule}=recurringFixture(),before=plain(p.data),writes=[];let dialog;
  p.modal=(title,html,submit)=>dialog={title,html,submit};p.change=async(action,payload)=>writes.push({action,payload:plain(payload)});p.close=()=>{};
  await p.act('rule','nuki');assert(dialog.html.includes('Aufladen'));assert.equal(writes.length,0);
  await p.act('cancel');assert.deepEqual(plain(p.data),before,'cancel leaves history and recurrence intact');
  await p.act('rule','nuki');await dialog.submit(new Map([['kind','interval'],['name','Aufladen'],['months','3'],['days','0'],['first_due',''],['first_due_period',''],['booked',''],['review_note',''],['consumable_key','']]));
  assert.equal(writes[0].action,'save_rule');assert.equal(writes[0].payload.value.id,rule.id);assert.equal(writes[0].payload.value.months,3,'the recurrence remains fully editable');
 }
 console.log('PASS: Erledigte Wiederholungen separat mit Folgetermin, fällige Termine wieder offen, Undo/Buchung/Saison/Rotation korrekt und Historie unverändert.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
