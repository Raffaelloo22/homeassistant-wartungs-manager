const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
let Panel;
class FormValues extends Map{constructor(form){super(Object.entries(form.values));}}
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../custom_components/ha_wartung/frontend/panel.js'),'utf8'),{
 HTMLElement:class{},FormData:FormValues,customElements:{get:()=>null,define:(_,value)=>Panel=value}
});
const plain=value=>JSON.parse(JSON.stringify(value));
function fixture(){
 const p=Object.create(Panel.prototype);p.data={today:'2026-11-24',devices:{d:{id:'d',name:'Beispielgerät'}},settings:{},rules:{}};
 p.ruleMaterialFields=()=>'';
 const button={attributes:{'aria-expanded':'false'},focused:0,setAttribute(name,value){this.attributes[name]=value;},focus(){this.focused++;}},help={hidden:true};
 const form={values:{name:'Noch nicht gespeicherte Aufgabe',kind:'interval',months:'3',days:'2',first_due:'01.06.27',sensor_registry_id:'sensor-id',consumable_key:'material:filter'},querySelectorAll:()=>[]};
 const kind={value:'interval'},bookedLabel={hidden:false},booked={closest:()=>bookedLabel},submit={disabled:false},errors={textContent:''};
 const groups=['none','date','interval','season','measurement','rotation','on_demand'].map(value=>({dataset:{kind:value},hidden:false}));
 let markup='',writes=0,saves=0,flushes=0,received;
 const dialog={
  get innerHTML(){return markup;},set innerHTML(value){markup=value;writes++;},
  opens:0,closes:0,showModal(){this.opens++;},close(){this.closes++;},
  querySelector(selector){return ({form,'[type=submit]':submit,'.errors':errors,
   '[data-rule-kind-help-toggle]':markup.includes('data-rule-kind-help-toggle')?button:null,
   '[data-rule-kind-help]':markup.includes('data-rule-kind-help role=')?help:null,
   '[name=kind]':markup.includes('name="kind"')?kind:null,'[name=booked]':booked})[selector]||null;},
  querySelectorAll:selector=>selector==='[data-kind]'?groups:[]
 };
 p.shadowRoot={querySelector:selector=>selector==='dialog'?dialog:null};p.scheduleBackgroundFlush=()=>flushes++;
 for(const method of ['prepareNumberInputs','bindRelatedDeviceEditor','bindTaskDeviceSearch','bindHaDeviceSearch','bindRuleSensorSearch','bindCompletionDate','bindDeviceStatusHint','bindBatteryFields','bindRuleMaterial','normalizeNumberInputs'])p[method]=()=>{};
 const open=html=>p.modal('Wartungsaufgabe',html??p.ruleFields({kind:'interval',name:form.values.name},'d'),values=>{saves++;received=Object.fromEntries(values);});
 const event=key=>({key,prevented:false,stopped:false,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;}});
 const cancel=()=>{const e=event();dialog.oncancel(e);if(!e.prevented)dialog.close();return e;};
 const escape=()=>{const e=event('Escape');dialog.onkeydown?.(e);if(!e.prevented)cancel();return e;};
 return {p,button,help,form,kind,dialog,submit,errors,groups,open,event,cancel,escape,get writes(){return writes;},get saves(){return saves;},get flushes(){return flushes;},get received(){return received;}};
}
(async()=>{
 {
  const f=fixture(),html=f.p.ruleFields({},'d');
  assert(html.includes('<label for="rule-kind-select">Fälligkeitsregel</label><button'),'the help button is next to a real select label, outside that label');
  const select=html.match(/<select id="rule-kind-select" name="kind">([\s\S]*?)<\/select>/)[1];
  assert.deepEqual([...select.matchAll(/<option value="([^"]+)"/g)].map(match=>match[1]),['none','date','interval','season','measurement','rotation','on_demand']);
  assert(select.includes('<option value="date" selected>Termin</option>'),'new tasks still default to Termin');
  assert(f.p.ruleKindField('measurement').includes('<option value="measurement" selected>Messwert</option>'),'editing retains the chosen due rule');
  const button=html.match(/<button[^>]*data-rule-kind-help-toggle[^>]*>/)[0];
  for(const attribute of ['type="button"','aria-label="Hilfe zu den Fälligkeitsregeln"','aria-expanded="false"','aria-controls="rule-kind-help"'])assert(button.includes(attribute));
  assert(!/\bname=/.test(button),'the help button never contributes a form value');
  assert(html.includes('<svg width="18" height="18"')&&html.includes('aria-hidden="true" focusable="false"'),'the small info icon is decorative to screen readers');
  assert(/<section id="rule-kind-help"[^>]*role="region"[^>]*hidden>/.test(html),'help starts collapsed inside the form');
  assert.deepEqual([...html.matchAll(/<dt>([^<]+)<\/dt>/g)].map(match=>match[1]),['Ohne','Termin','Intervall / Einplanen','Jährliche Saison','Messwert','Wartungsrotation','Nach Geräteanzeige']);
  for(const text of ['01.02.27','10.01.27 → nächster Termin 10.04.27','01.11.26 mit Samstag = Sa, 31.10.26','29 % Aufladen fällig, 30 % nicht','beide 0','erneut geplant','neuerer Messwertbericht','Orientierung'])assert(html.includes(text),text+' is explained');
  assert(!/\b\d{2}\.\d{2}\.\d{4}\b/.test(html),'help examples use dd.mm.yy');
  assert(html.includes('nächstgelegenen Wochentag'),'the season label describes nearest, rather than only a later weekday');
  assert(!html.includes('lösen keine Aufgabe aus'),'sensor guidance agrees with the pending-value explanation');
 }
 {
  const f=fixture(),before=plain(f.p.data),values=plain(f.form.values);f.open();
  assert.equal(f.dialog.opens,1);assert.equal(f.p.dialogOpen,true);assert.equal(f.help.hidden,true);
  for(let index=0;index<4;index++){
   f.button.onclick();assert.equal(f.help.hidden,index%2===1);assert.equal(f.button.attributes['aria-expanded'],String(index%2===0));
   assert.equal(f.writes,1,'opening or closing help never recreates the form');assert.equal(f.dialog.opens,1,'help does not open another modal');
   assert.equal(f.saves,0);assert.equal(f.flushes,0);assert.deepEqual(f.form.values,values,'unsaved device, sensor, material and date fields stay intact');assert.deepEqual(plain(f.p.data),before);
  }
  await f.form.onsubmit({preventDefault(){},target:f.form});
  assert.equal(f.saves,1);assert.deepEqual(f.received,values,'the normal explicit save still submits the unchanged draft');assert.equal(f.submit.disabled,false);
 }
 {
  const f=fixture();f.open();f.button.onclick();
  const e=f.escape();assert(e.prevented&&e.stopped,'Escape closes the help before the dialog or outer menus');
  assert.equal(f.help.hidden,true);assert.equal(f.button.attributes['aria-expanded'],'false');assert.equal(f.button.focused,1);
  assert.equal(f.p.dialogOpen,true);assert.equal(f.dialog.closes,0);assert.equal(f.flushes,0);assert.equal(f.saves,0);
  const second=f.escape();assert(!second.prevented&&!second.stopped,'with help closed, Escape keeps its native dialog behavior');
  assert.equal(f.p.dialogOpen,false);assert.equal(f.dialog.closes,1);assert.equal(f.flushes,1);assert.equal(f.saves,0);
 }
 {
  const f=fixture();f.open();f.button.onclick();
  assert.equal(f.cancel().prevented,true,'native cancel requests also close an open help first');assert.equal(f.p.dialogOpen,true);assert.equal(f.dialog.closes,0);
  assert.equal(f.cancel().prevented,false);assert.equal(f.p.dialogOpen,false);assert.equal(f.dialog.closes,1);
 }
 {
  const f=fixture();f.open();f.button.onclick();f.open('<label>Notiz<input name="note"></label>');
  assert.equal(f.dialog.onkeydown,null,'reusing the dialog for another editor removes the old help key handler');
  assert.equal(f.cancel().prevented,false,'dialogs without due-rule help retain normal cancellation');assert.equal(f.p.dialogOpen,false);assert.equal(f.dialog.closes,1);
 }
 console.log('PASS: Fälligkeitsregel-Hilfe erklärt alle sieben Optionen, bleibt zugänglich im Formular und bewahrt Entwürfe, Speichern sowie Escape-Verhalten.');
})().catch(error=>{console.error(error);process.exitCode=1;});
