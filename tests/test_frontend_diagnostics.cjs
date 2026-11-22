const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
let Panel;
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../custom_components/ha_wartung/frontend/panel.js'),'utf8'),{HTMLElement:class{},customElements:{get:()=>null,define:(_,c)=>Panel=c}});
const plain=value=>JSON.parse(JSON.stringify(value));
function fixture(){
  const p=Object.create(Panel.prototype),results={innerHTML:''},button={disabled:false},section={open:true},calls=[];
  Object.assign(p,{tab:'settings',data:{revision:7,devices:{d:{id:'d',name:'Zoé Sensor'}},rules:{r:{id:'r',device_id:'d',name:'Batterien wechseln',kind:'interval'}},settings:{},logs:{},views:[]},shadowRoot:{querySelector:selector=>selector==='[data-diagnostics-results]'?results:selector==='[data-check-run]'?button:null}});
  p.change=()=>{throw Error('Datenprüfung darf niemals speichern');};
  p._hass={callWS:async command=>{calls.push(plain(command));assert.equal(command.type,'ha_wartung/request');assert.equal(command.action,'diagnose');return {revision:7,checked_devices:1,checked_rules:1,issues:[]};}};
  return {p,results,button,section,calls};
}
function rendering(){
  const {p}=fixture();assert.match(p.dataCheckResults(),/Noch keine Prüfung durchgeführt/);
  const settings=p.dataCheckSettings();assert.match(settings,/settings-data-check/);assert.match(settings,/data-action="checkdata"/);assert.match(settings,/Es werden keine Daten verändert/);assert(!settings.includes('data-action="save'));
  p.diagnosticsLoading=true;assert.match(p.dataCheckResults(),/Daten werden geprüft/);assert.match(p.dataCheckResults(),/role="status"/);assert.match(p.dataCheckSettings(),/data-check-run disabled/);
  p.diagnosticsLoading=false;p.diagnostics={revision:7,checked_devices:1,checked_rules:1,issues:[]};assert.match(p.dataCheckResults(),/1 Geräte und 1 Aufgaben geprüft/);assert.match(p.dataCheckResults(),/Keine Auffälligkeiten gefunden/);assert(!p.dataCheckResults().includes('Daten seit der Prüfung geändert'));
  p.data.revision=8;assert.match(p.dataCheckResults(),/Daten seit der Prüfung geändert/);
  p.diagnostics={revision:8,checked_devices:1,checked_rules:1,issues:[{title:'Materialzuordnung fehlt',detail:'Batterien zuordnen',device_ids:['d','missing'],rule_id:'r'},{title:'Nur Hinweis',detail:'Keine Verknüpfung',device_ids:['missing'],rule_id:'missing'}]};
  const html=p.dataCheckResults();assert.match(html,/2 Hinweise/);assert.match(html,/data-action="record" data-id="d"/);assert.match(html,/Zoé Sensor/);assert.match(html,/data-action="rule" data-id="r"/);assert.match(html,/Aufgabe bearbeiten/);assert(!html.includes('data-id="missing"'));
  const unsafe='\"><img src=x onerror=alert(1)>';
  p.data.devices[unsafe]={id:unsafe,name:unsafe};p.data.rules[unsafe]={id:unsafe};
  p.diagnostics={revision:8,checked_devices:unsafe,checked_rules:1,issues:[{title:unsafe,detail:unsafe,device_ids:[unsafe],rule_id:unsafe}]};
  const escaped=p.dataCheckResults();assert(!escaped.includes('<img'));assert.match(escaped,/&lt;img/);assert.match(escaped,/data-id="&quot;&gt;&lt;img/);
  p.diagnosticsError=unsafe;assert.match(p.dataCheckResults(),/role="alert"/);assert(!p.dataCheckResults().includes('<img'));assert.match(p.dataCheckResults(),/&lt;img/);
}
async function readOnlyAndSingleflight(){
  const {p,results,button,section,calls}=fixture(),before=plain(p.data);let rzoese;
  p._hass.callWS=command=>{calls.push(plain(command));assert.deepEqual(plain(command),{type:'ha_wartung/request',action:'diagnose',payload:{}});return new Promise(resolve=>rzoese=resolve);};
  const pending=p.act('checkdata');assert.equal(p.diagnosticsLoading,true);assert.equal(button.disabled,true);assert.match(results.innerHTML,/Daten werden geprüft/);
  await p.act('checkdata');await p.runDataCheck();assert.equal(calls.length,1,'repeated clicks while pending share the one diagnosis');assert.deepEqual(plain(p.data),before);
  rzoese({revision:7,checked_devices:1,checked_rules:1,issues:[]});await pending;
  assert.equal(p.diagnosticsLoading,false);assert.equal(button.disabled,false);assert.match(results.innerHTML,/Keine Auffälligkeiten gefunden/);assert.equal(section.open,true);assert.deepEqual(plain(p.data),before);
  let draws=0;p.draw=()=>draws++;await p.act('record','d');assert.equal(p.selected,'d');assert.equal(p.tab,'devices');assert.equal(draws,1);assert.equal(calls.length,1,'opening a result device must not write');
  let modal;p.ruleFields=()=>'<p>Aufgabe</p>';p.modal=(title,html,submit)=>modal={title,html,submit};await p.act('rule','r');assert.equal(modal.title,'Wartungsaufgabe');assert.equal(calls.length,1,'opening task edit must not write');assert.deepEqual(plain(p.data),before);
}
async function failureAndRetry(){
  const {p,results,button,calls}=fixture(),before=plain(p.data);p.diagnostics={revision:7,checked_devices:1,checked_rules:1,issues:[]};
  p._hass.callWS=async command=>{calls.push(plain(command));throw {error:{message:'<img src=x> Verbindung unterbrochen'}};};
  await p.act('checkdata');assert.equal(p.diagnosticsLoading,false);assert.equal(button.disabled,false);assert.match(results.innerHTML,/role="alert"/);assert.match(results.innerHTML,/Verbindung unterbrochen/);assert(!results.innerHTML.includes('<img'));assert.deepEqual(plain(p.data),before);
  p._hass.callWS=async command=>{calls.push(plain(command));assert.equal(p.diagnosticsError,'','retry clears the prior error while loading');return {revision:7,checked_devices:1,checked_rules:1,issues:[{title:'Prüfen',detail:'Ein Hinweis',device_ids:['d']}]};};
  await p.act('checkdata');assert.equal(calls.length,2);assert.equal(p.diagnosticsError,'');assert.equal(p.diagnosticsLoading,false);assert.match(results.innerHTML,/1 Hinweise/);assert(!results.innerHTML.includes('Verbindung unterbrochen'));assert.deepEqual(plain(p.data),before);
}
(async()=>{rendering();await readOnlyAndSingleflight();await failureAndRetry();console.log('PASS: Datenprüfung ist rein lesend, singleflight und fehlertolerant; Ergebnisse, Revisionshinweis, Geräte-/Aufgabenlinks und Texte sind korrekt und escaped.');})().catch(error=>{console.error(error);process.exitCode=1;});
