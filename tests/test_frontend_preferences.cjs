// Preferences change display and the selected HA helper, never existing record amounts.
const assert=require('node:assert/strict');
const {fixture}=require('./test_frontend_cleanup.cjs');
const plain=value=>JSON.parse(JSON.stringify(value));
const DEFAULT='input_number.batterien_schwellwert',CUSTOM='input_number.battery_limit';
function setup(){
 const {p}=fixture();
 p._hass={states:{},callWS:async()=>{throw Error('Unexpected helper write');},callService:async()=>{throw Error('Unexpected service write');}};
 return p;
}
async function run(){
 {
  const p=setup();assert.equal(p.currency(),'CHF');p.data.currency='EUR';assert.equal(p.currency(),'EUR');
  p.data.settings.currency='USD';assert.equal(p.currency(),'USD');
  p.data.logs.l.cost=12.5;const before=JSON.stringify(p.data);
  assert(p.history(p.data.logs.l).includes('USD 12.50'));
  assert.equal(JSON.stringify(p.data),before,'currency formatting must not convert or rewrite amounts');
  let dialog,writes=[];p.modal=(title,html,save)=>dialog={title,html,save};p.change=async(action,payload)=>writes.push({action,payload:plain(payload)});
  for(const [action,id] of [['log','d'],['editlog','l'],['today','r'],['batterylog','d']]){
   await p.act(action,id);assert(dialog.html.includes('Kosten in USD (optional)'),action+' uses configured currency');assert.equal(writes.length,0,'opening a cost dialog is read-only');
  }
  await p.act('log','d');await dialog.save(new Map([['event_date','2026-11-01'],['kind','maintenance'],['note','Test'],['cost','12.5']]));
  assert.equal(writes[0].payload.value.cost,12.5);assert(!Object.hasOwn(writes[0].payload.value,'currency'));
 }
 {
  const p=setup();p.data.settings.currency='EUR';p.data.settings.battery_threshold_entity=CUSTOM;
  p._hass.states={[DEFAULT]:{state:'10'},[CUSTOM]:{state:'35',attributes:{friendly_name:'Warnung <Test> & "Reserve"'}},'sensor.not_a_helper':{state:'15'}};
  let writes=[];const server=plain(p.data);p.data.revision=5;server.revision=5;
  p.api=async(action,payload)=>{if(action==='get')return plain(server);writes.push({action,payload:plain(payload)});Object.assign(server.settings,payload.value);server.revision++;return {};};p.draw=()=>{};p.body=()=>{};p.scheduleBackgroundFlush=()=>{};
  const records=plain({devices:p.data.devices,rules:p.data.rules,logs:p.data.logs}),fields=p.preferencesFields();
  assert.equal(writes.length,0);
  assert(fields.includes('value="'+CUSTOM+'" selected'));assert.equal((fields.match(/value="input_number.batterien_schwellwert"/g)||[]).length,1);
  assert(!fields.includes('sensor.not_a_helper'));assert(fields.includes('Warnung &lt;Test&gt; &amp; &quot;Reserve&quot;'));assert(!fields.includes('Warnung <Test>'));
  assert(fields.includes('rechnen vorhandene Beträge aber nicht um'));
  await p.saveInlineSettings('currency',p.inlineSettingsValues('currency',new Map([['currency',' usd ']])));
  assert.deepEqual(writes,[{action:'preferences',payload:{revision:5,value:{currency:'USD'}}}]);
  assert.equal(p.data.settings.battery_threshold_entity,CUSTOM,'currency autosave does not touch the selected helper');
  assert.deepEqual(plain({devices:p.data.devices,rules:p.data.rules,logs:p.data.logs}),records,'autosave does not alter device or maintenance records');
  p.data.settings.currency='<svg onload="x">';p.data.settings.battery_threshold_entity='input_number.missing"<x>';
  const escapedFields=p.preferencesFields();assert(escapedFields.includes('&lt;svg onload=&quot;x&quot;&gt;'));assert(escapedFields.includes('input_number.missing&quot;&lt;x&gt;'));assert(escapedFields.includes('(derzeit nicht verfügbar)'));assert(!escapedFields.includes('<svg'));
 }
 {
  const p=setup();assert.equal(p.batteryThresholdEntity(),DEFAULT);p.data.settings.battery_threshold_entity=CUSTOM;
  p._hass.states={[DEFAULT]:{state:'10',attributes:{min:0,max:100,step:1}},[CUSTOM]:{state:'35',attributes:{min:5,max:80,step:5}}};
  assert.deepEqual(plain(p.batteryThreshold()),{entity:CUSTOM,value:35,valid:true});assert.deepEqual(plain(p.batteryThresholdLimits()),{min:5,max:80,step:5});
  const html=p.batteryThresholdEditor();assert(html.includes('<code>'+CUSTOM+'</code>'));assert(html.includes('min="5" max="80" step="5" value="35"'));assert(html.includes('bestehender Wert bleibt erhalten'));
  const status={},input={value:'40',min:'5',max:'80',step:'5',disabled:false,checkValidity:()=>true},calls=[];
  p.shadowRoot.querySelector=selector=>selector==='#battery-threshold-status'?status:null;
  p._hass.callService=async(...args)=>calls.push(plain(args));
  await p.saveBatteryThreshold(input);assert.deepEqual(calls,[['input_number','set_value',{entity_id:CUSTOM,value:40}]]);assert.equal(input.disabled,false);assert(status.textContent.includes('40 % gespeichert'));
  input.value='35';await p.saveBatteryThreshold(input);assert.equal(calls.length,1,'same value does not write');
  input.value='42';input.checkValidity=()=>false;await p.saveBatteryThreshold(input);assert.equal(calls.length,1,'invalid helper step does not write');
 }
 {
  const p=setup();p.data.settings.battery_threshold_entity=CUSTOM;
  p._hass.states[DEFAULT]={state:'10'};let writes=0;p._hass.callWS=p._hass.callService=async()=>{writes++;};
  await p.createBatteryThresholdHelper();assert.equal(writes,0,'missing custom helper must never cause creation, deletion or service writes');
  assert(p.helperCheckError.includes('Standardhelfer'));assert.deepEqual(plain(p.batteryThreshold()),{entity:CUSTOM,value:20,valid:false});
  assert(p.batteryThresholdEditor().includes('disabled'));
  const status={};p.shadowRoot.querySelector=selector=>selector==='#battery-threshold-status'?status:null;
  await p.saveBatteryThreshold({value:'25',checkValidity:()=>true});assert.equal(writes,0);assert(status.textContent.includes('nicht verfügbar'));
 }
 {
  const p=setup(),calls=[];p._hass.callWS=async command=>{calls.push(plain(command));if(command.type==='input_number/list')return [];if(command.type==='config/entity_registry/get')throw {code:'not_found'};if(command.type==='input_number/create')return {id:'batterien_schwellwert'};throw Error('Unexpected helper operation');};
  await p.createBatteryThresholdHelper();assert.equal(calls.filter(x=>x.type==='input_number/create').length,1);assert.equal(calls.find(x=>x.type==='input_number/create').initial,20);assert(!calls.some(x=>x.type==='input_number/delete'));
  const existing=setup();existing._hass.states[DEFAULT]={state:'15'};await existing.createBatteryThresholdHelper();assert.equal(existing._hass.states[DEFAULT].state,'15','default existing value is not reset');
 }
 {
  const p=setup();p.data.settings.battery_threshold_entity=CUSTOM;let checks=0;
  p.createBatteryThresholdHelper=async()=>{checks++;};
  for(const name of ['syncBatteryThresholdControl','updateBatteryBadges','updateBatteryWarnings','updateDeviceStatuses','updateBatteryTaskStructure','updateRuleSensorValue'])p[name]=()=>{};
  p.hass={states:{[CUSTOM]:{state:'35'}}};assert.equal(checks,0,'opening panel or HA state updates never create a helper');
  p.hass={states:{[DEFAULT]:{state:'10'}}};assert.equal(checks,0,'missing helper is not created during HA state updates');
 }
 console.log('PASS: Preferences are escaped and read-only until Save; currency changes display only; selected HA helper controls value, limits and writes; helper creation is explicit only.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
