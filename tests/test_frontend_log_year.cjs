const assert=require('node:assert/strict');
const {fixture}=require('./test_frontend_cleanup.cjs');
const plain=value=>JSON.parse(JSON.stringify(value));
function logFixture(){
 const f=fixture(),p=f.p;p.tab='log';p.logQuery='';p.logYearFilter='';
 const entry=(id,extra={})=>({id,device_id:'d',kind:'maintenance',note:id,...extra});
 p.data.logs={
  current:entry('Aktuell 2026',{event_date:'2026-11-22',recorded_at:'2024-01-01T10:00:00Z'}),
  prior:entry('Vorjahr 2025',{event_date:'2025-01-02'}),
  period:entry('Periode 2025',{event_period:'Ende 2025',recorded_at:'2026-11-22T11:00:00Z'}),
  month:entry('Monat 2024',{event_period:'2024-06'}),
  dateFirst:entry('Datum vor Zeitraum',{event_date:'2024-01-02',event_period:'Ende 2020'}),
  local:entry('Lokales Datum 2023',{event_date:'22.11.23'}),
  unknown:entry('Unbekanntes Jahr',{event_period:'irgendwann',recorded_at:'2027-01-01T00:00:00Z'}),
  purchase:entry('Kauf ausblenden',{kind:'purchase',event_date:'2041-01-01'}),
  note:entry('Notiz ausblenden',{kind:'note',event_date:'2042-01-01'}),
  deleted:entry('Entfernt ausblenden',{event_date:'2030-01-01',deleted_at:'2026-11-23'}),
  orphan:entry('Ohne Gerät ausblenden',{device_id:'missing',event_date:'2031-01-01'})
 };
 return f;
}
(async()=>{
 {
  const {p}=logFixture(),before=plain(p.data);
  assert.deepEqual(plain(p.logYearOptions()),[['','Alle Jahre'],['2026','2026'],['2025','2025'],['2024','2024'],['2023','2023'],['unknown','Unbekannt']]);
  assert.equal(p.logEventYear(p.data.logs.period),'2025','imprecise event periods retain their actual year');
  assert.equal(p.logEventYear(p.data.logs.dateFirst),'2024','event date takes priority over period');
  assert.equal(p.logEventYear(p.data.logs.unknown),'unknown','recording time must not invent an event year');
  assert.equal(p.logEntries().length,7,'only entries eligible for the existing log contribute years');
  assert.deepEqual(plain(p.data),before,'building year options never modifies stored history');
 }
 {
  const {p,body}=logFixture(),before=plain(p.data);
  p.body();assert(body.innerHTML.includes('Aktuell 2026')&&body.innerHTML.includes('Periode 2025')&&body.innerHTML.includes('Unbekanntes Jahr'));
  for(const absent of ['Kauf ausblenden','Notiz ausblenden','Entfernt ausblenden','Ohne Gerät ausblenden'])assert(!body.innerHTML.includes(absent));
  p.filterChanged('logYearFilter','2025');
  assert(body.innerHTML.includes('Vorjahr 2025')&&body.innerHTML.includes('Periode 2025'));
  for(const absent of ['Aktuell 2026','Monat 2024','Unbekanntes Jahr'])assert(!body.innerHTML.includes(absent));
  assert(body.innerHTML.indexOf('Periode 2025')<body.innerHTML.indexOf('Vorjahr 2025'),'existing chronological sort remains within each year');
  p.filterChanged('logQuery','testlampe periode');assert(body.innerHTML.includes('Periode 2025'));assert(!body.innerHTML.includes('Vorjahr 2025'),'year and accent-insensitive device/text search combine');
  const search={value:p.logQuery,focus(){this.focused=true;}},clear={hidden:false},oldQuery=p.shadowRoot.querySelector;
  p.shadowRoot.querySelector=selector=>selector==='#search'?search:selector==='#clearsearch'?clear:oldQuery(selector);
  await p.act('clearsearch');assert.equal(p.logYearFilter,'2025');assert.equal(p.logQuery,'');assert(search.focused&&clear.hidden);
  assert(body.innerHTML.includes('Vorjahr 2025')&&body.innerHTML.includes('Periode 2025'),'clearing text preserves the selected year');
  p.query='Geräte';p.taskQuery='Aufgaben';p.inventoryQuery='Material';
  p.filterChanged('logYearFilter','unknown');assert(body.innerHTML.includes('Unbekanntes Jahr'));assert(!body.innerHTML.includes('Aktuell 2026'));
  assert.equal(p.query,'Geräte');assert.equal(p.taskQuery,'Aufgaben');assert.equal(p.inventoryQuery,'Material');
  p.filterChanged('logYearFilter','2023');assert(body.innerHTML.includes('Lokales Datum 2023'));assert(!body.innerHTML.includes('Periode 2025'));
  p.filterChanged('logYearFilter','');assert(body.innerHTML.includes('Aktuell 2026')&&body.innerHTML.includes('Unbekanntes Jahr'));
  assert.deepEqual(plain(p.data),before,'filtering and clearing do not modify device or history data');
 }
 {
  const {p,body}=logFixture(),nodes=new Map();
  for(const selector of ['#search','#clearsearch','#categoryfilter','#area','#taskperiod','#logyear'])nodes.set(selector,{value:'',innerHTML:'',hidden:false});
  nodes.set('#body',body);
  const root={innerHTML:'',querySelector:selector=>nodes.get(selector)||null,querySelectorAll:()=>[],addEventListener(){}};
  p.shadowRoot=root;p.renderCompletionUndo=()=>{};
  let renders=0;const render=p.body;p.body=function(){renders++;return render.call(this);};
  p.draw();const yearTag=root.innerHTML.match(/<select id="logyear"[^>]*>/)[0];
  assert(yearTag.includes('aria-label="Jahr filtern"')&&!yearTag.includes('hidden'),'log exposes an accessible year selector');
  assert(root.innerHTML.includes('value="" selected>Alle Jahre</option>'),'default is all years');
  const year=nodes.get('#logyear');year.oninput({target:{value:'2025'}});assert.equal(p.logYearFilter,'2025');assert.equal(renders,2,'choosing a year filters immediately');
  year.onchange({target:{value:'2025'}});assert.equal(renders,2,'duplicate input/change events do not redraw twice');
  p.data.logs.new={id:'new',device_id:'d',kind:'repair',event_date:'2027-02-01',note:'Neue Reparatur'};
  p.syncFilterOptions();assert.equal(p.logYearFilter,'2025');assert.equal(year.value,'2025');assert(year.innerHTML.includes('2027'),'refresh adds new years while retaining a valid selection');
  for(const [id,entry] of Object.entries(p.data.logs))if(p.logEventYear(entry)==='2025')delete p.data.logs[id];
  p.syncFilterOptions();assert.equal(p.logYearFilter,'');assert.equal(year.value,'');assert(!year.innerHTML.includes('2025'),'a removed selected year falls back to all years');
  p.tab='devices';p.logYearFilter='2027';p.draw();assert(root.innerHTML.match(/<select id="logyear"[^>]*>/)[0].includes('hidden'),'year selector stays confined to log');assert.equal(p.logYearFilter,'2027','tab changes preserve the log selection');
  p.tab='log';p.draw();assert(!root.innerHTML.match(/<select id="logyear"[^>]*>/)[0].includes('hidden'));assert(root.innerHTML.includes('value="2027" selected'));
  p.data.logs={};p.syncFilterOptions();assert.equal(p.logYearFilter,'');assert.equal(year.innerHTML,'<option value="" selected>Alle Jahre</option>');
 }
 {
  const {p}=logFixture();p.logYearFilter='2025';let confirm,writes=[];
  p.modal=(title,html,save)=>confirm=save;p.change=async(action,payload)=>writes.push({action,payload:plain(payload)});p.draw=()=>{};
  await p.act('resetalldata');assert.equal(typeof confirm,'function');
  await confirm(new Map([['confirm','on'],['confirmation','DATEN ZURÜCKSETZEN']]));
  assert.equal(p.logYearFilter,'','reset clears the now-invalid year alongside the other local filters');
  assert.deepEqual(writes,[{action:'reset_all_data',payload:{confirmed:true,confirmation:'DATEN ZURÜCKSETZEN'}}]);
 }
 console.log('PASS: Log-Jahresfilter kombiniert Ereignisjahr und Textsuche sofort, erhält gültige Auswahl bei Aktualisierungen und lässt Daten unverändert.');
})().catch(error=>{console.error(error);process.exitCode=1;});
