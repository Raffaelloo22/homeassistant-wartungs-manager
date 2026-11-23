const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {fixture}=require('./test_frontend_cleanup.cjs');
const source=fs.readFileSync(path.join(__dirname,'../custom_components/ha_wartung/frontend/panel.js'),'utf8');
let Panel;
vm.runInNewContext(source,{URL,HTMLElement:class{},FormData:class{constructor(form){return new Map(form.values);}},customElements:{get:()=>null,define:(_,value)=>Panel=value},crypto:{randomUUID:()=> 'test-id'}});
const plain=value=>JSON.parse(JSON.stringify(value)),HELPER='input_number.batterien_schwellwert';
function form(kind,values){
 const reset={type:'reset',disabled:true},controls=[{type:'text',disabled:false},{type:'submit',disabled:false},reset];
 return {dataset:{settingsForm:kind},values:new Map(values),controls,reset,querySelectorAll:()=>controls,querySelector:selector=>selector==='[type=reset]'?reset:null};
}
function setup(){
 const {p}=fixture();Object.setPrototypeOf(p,Panel.prototype);p.tab='settings';p.data.timezone='Europe/Zurich';
 p.data.settings={...p.data.settings,currency:'CHF',enabled:false,weekday:0,time:'09:00'};
 p._hass={states:{[HELPER]:{state:'20',attributes:{min:0,max:100,step:1}}}};
 const preferences=form('preferences',[['currency','CHF'],['battery_threshold_entity',HELPER]]),schedule=form('schedule',[['weekday','0'],['time','09:00']]);
 const forms=[preferences,schedule],statuses={preferences:{},schedule:{}};let draws=0,flushes=0;
 p.shadowRoot={activeElement:null,querySelectorAll:selector=>selector==='[data-settings-form]'?forms:[],querySelector:selector=>{
  const m=selector.match(/^\[data-settings-status="(preferences|schedule)"\]$/);return m?statuses[m[1]]:null;
 }};
 p.draw=()=>{draws++;p.bindInlineSettingsForms();};p.scheduleBackgroundFlush=()=>flushes++;
 return {p,preferences,schedule,statuses,draws:()=>draws,flushes:()=>flushes};
}
(async()=>{
 {
  const {p}=setup(),before=plain(p.data);let writes=0;p.api=async()=>{writes++;};
  const card=p.generalSettingsCard(p.data),all=p.settingsView(p.data);
  assert(card.includes('<h2>Allgemeine Einstellungen</h2>'));
  assert.equal((card.match(/data-settings-form=/g)||[]).length,2);
  assert(card.includes('name="currency"')&&card.includes('name="battery_threshold_entity"'));
  assert(card.includes('id="battery-threshold-input"')&&card.includes('Gespeichert im Home-Assistant-Helfer'));
  assert(card.includes('name="enabled"')&&card.includes('name="weekday"')&&card.includes('name="time"'));
  assert(card.includes('Europe/Zurich')&&card.includes('Testmeldung anzeigen'));
  assert.equal((all.match(/Wochenmeldung innerhalb Home Assistant/g)||[]).length,1,'weekly controls are part of the first card only');
  assert(!all.includes('data-action="preferences"')&&!all.includes('data-action="schedule"'));
  assert(!source.includes("action==='preferences'")&&!source.includes("action==='schedule'"),'obsolete popup routes are removed');
  assert.equal(writes,0);assert.deepEqual(plain(p.data),before,'rendering inline settings never stores defaults or changes the helper');
 }
 {
  const {p,preferences,schedule,draws,flushes}=setup();p.bindInlineSettingsForms();
  assert.equal(p.backgroundBusy(),false);assert(preferences.reset.disabled);
  preferences.values.set('currency','EUR');preferences.oninput();
  assert.equal(p.inlineSettingsDrafts.preferences.currency,'EUR');assert.equal(preferences.reset.disabled,false);
  assert.equal(p.backgroundBusy(),true,'an unsaved setting protects the whole form even after the field loses focus');
  p.tab='devices';assert.equal(p.backgroundBusy(),false,'drafts do not stop polling in other views');p.tab='settings';
  schedule.values.set('weekday','6');schedule.values.set('time','22:45');schedule.values.set('enabled','on');schedule.onchange();
  assert.equal(p.inlineSettingsDrafts.schedule.enabled,true);assert.equal(p.inlineSettingsDrafts.schedule.weekday,'6');
  let prevented=false;preferences.onreset({preventDefault(){prevented=true;}});
  assert(prevented);assert(!p.inlineSettingsDrafts.preferences);assert(p.inlineSettingsDrafts.schedule);
  assert.equal(draws(),1);assert.equal(flushes(),1);assert.equal(p.backgroundBusy(),true,'discarding one form preserves the other unsaved draft');
  schedule.onreset({preventDefault(){}});assert.equal(p.backgroundBusy(),false);
 }
 {
  const {p,statuses}=setup(),writes=[];p.inlineSettingsDrafts={schedule:{enabled:true,weekday:'6',time:'22:45'}};
  p.change=async(action,payload)=>writes.push({action,payload:plain(payload)});
  const values=p.inlineSettingsValues('preferences',new Map([['currency',' eur '],['battery_threshold_entity',HELPER]]));
  assert.equal(await p.saveInlineSettings('preferences',values),true);
  assert.deepEqual(writes,[{action:'preferences',payload:{value:{currency:'EUR',battery_threshold_entity:HELPER}}}]);
  assert(!p.inlineSettingsDrafts.preferences);assert.equal(p.inlineSettingsDrafts.schedule.time,'22:45');
  const card=p.generalSettingsCard(p.data);assert(card.includes('value="6" selected')&&card.includes('value="22:45"')&&card.includes('name="enabled" type="checkbox" checked'));
  assert.equal(statuses.preferences.textContent,'Gespeichert.');
  assert.equal(await p.saveInlineSettings('schedule',{enabled:false,weekday:'0',time:'00:00'}),true);
  assert.deepEqual(writes[1],{action:'settings',payload:{value:{enabled:false,weekday:0,time:'00:00'}}});
  assert.deepEqual(plain(p.inlineSettingsDrafts),{});
 }
 {
  const {p,statuses,preferences}=setup(),before=plain(p.data);
  p.change=async()=>{throw Error('Ungültige Währung. Bitte CHF oder EUR eingeben.');};
  const values={currency:'ungueltig',battery_threshold_entity:HELPER};
  assert.equal(await p.saveInlineSettings('preferences',values),false);
  assert.deepEqual(plain(p.inlineSettingsDrafts.preferences),values,'validation and save errors retain every entered value');
  assert(p.generalSettingsCard(p.data).includes('value="ungueltig"'));assert(statuses.preferences.className.includes('errors'));
  assert(statuses.preferences.textContent.includes('Ungültige Währung'));assert.equal(preferences.controls[0].disabled,false);
  assert.equal(p.backgroundBusy(),true);assert.deepEqual(plain(p.data),before);
 }
 {
  const {p,preferences,schedule}=setup(),writes=[];let release;
  p.change=async(action,payload)=>{writes.push({action,payload:plain(payload)});await new Promise(resolve=>release=resolve);};
  const save=p.saveInlineSettings('preferences',{currency:'USD',battery_threshold_entity:HELPER});
  assert.equal(p.inlineSettingsSaving,true);assert(preferences.controls.every(control=>control.disabled));assert(schedule.controls.every(control=>control.disabled));
  assert.equal(await p.saveInlineSettings('schedule',{enabled:true,weekday:'1',time:'10:00'}),false);assert.equal(writes.length,1,'rapid submits cannot double-write either API');
  let services=0;p._hass.callService=async()=>services++;await p.saveBatteryThreshold({value:'30'});assert.equal(services,0,'the slider cannot race with a helper-selection save');
  preferences.onreset({preventDefault(){}});assert(p.inlineSettingsDrafts.preferences,'discard is ignored while the save is pending');
  release();assert.equal(await save,true);assert.equal(p.inlineSettingsSaving,false);assert.equal(preferences.controls[0].disabled,false);
 }
 {
  const {p,preferences}=setup(),input={value:'20',disabled:false},hint={},output={};let services=0;
  const originalQuery=p.shadowRoot.querySelector;
  p.shadowRoot.querySelector=selector=>selector==='#battery-threshold-input'?input:selector==='#battery-threshold-hint'?hint:selector==='#battery-threshold-output'?output:originalQuery(selector);
  p._hass.callService=async()=>services++;
  p.bindInlineSettingsForms();preferences.values.set('battery_threshold_entity','input_number.other_limit');preferences.onchange();
  assert.equal(p.pendingBatteryHelperSelection(),true);assert.equal(input.disabled,true);
  assert(hint.textContent.includes('zuerst speichern oder verwerfen'));assert(p.batteryThresholdEditor().includes('aria-describedby="battery-threshold-hint" disabled'));
  await p.saveBatteryThreshold({value:'30'});assert.equal(services,0,'an unsaved helper selection cannot change the old helper');
  preferences.values.set('battery_threshold_entity',HELPER);preferences.onchange();
  assert.equal(p.pendingBatteryHelperSelection(),false);assert.equal(input.disabled,false);assert(hint.textContent.includes('Batterieaufgaben erscheinen unter 20'));
  preferences.values.set('battery_threshold_entity','input_number.other_limit');preferences.onchange();
  preferences.onreset({preventDefault(){}});p.syncBatteryThresholdControl();
  assert.equal(p.pendingBatteryHelperSelection(),false);assert.equal(input.disabled,false);assert(!p.batteryThresholdHint().includes('zuerst'));
  assert.equal(services,0);
 }
 console.log('PASS: Inline-Einstellungen und Wochenmeldung speichern getrennt; Formulare und Slider bleiben geschützt, Entwürfe bei Fehlern/Refresh erhalten und Verwerfen verändert keine Daten.');
})().catch(error=>{console.error(error);process.exitCode=1;});
