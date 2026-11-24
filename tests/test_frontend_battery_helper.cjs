const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');let Panel;
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../custom_components/ha_wartung/frontend/panel.js'),'utf8'),{HTMLElement:class{},customElements:{get:()=>null,define:(_,c)=>Panel=c}});
const DEFAULT='input_number.batterien_schwellwert';
const setup=callWS=>Object.assign(Object.create(Panel.prototype),{data:{settings:{}},_hass:{states:{},callWS},helperCheckError:'',shadowRoot:{querySelector:()=>null}});
(async()=>{
 let calls=[];const p=setup(async command=>{calls.push(command);if(command.type==='input_number/list')return [];if(command.type==='config/entity_registry/get')throw {code:'not_found'};if(command.type==='input_number/create')return {id:'batterien_schwellwert'};throw Error('Unexpected call');});
 assert(p.batteryThresholdEditor().includes('data-action="createbatteryhelper"'),'missing default helper exposes an explicit create button');
 assert(p.batteryThresholdEditor().includes('Der Helfer wird nur angelegt'),'the interface explains the explicit action');
 assert.equal(calls.length,0,'rendering the panel does not create or inspect a helper');
 await Promise.all([p.createBatteryThresholdHelper(),p.createBatteryThresholdHelper()]);
 assert.equal(calls.filter(x=>x.type==='input_number/create').length,1,'concurrent explicit clicks create at most one helper');
 assert.equal(calls.find(x=>x.type==='input_number/create').initial,20);
 calls=[];const present=setup(async c=>calls.push(c));present._hass.states[DEFAULT]={state:'15'};assert(!present.batteryThresholdEditor().includes('data-action="createbatteryhelper"'));
 await present.createBatteryThresholdHelper();assert.equal(calls.length,0);assert.equal(present._hass.states[DEFAULT].state,'15','existing helper value is never reset');
 const custom=setup(async c=>calls.push(c));custom.data.settings.battery_threshold_entity='input_number.other';await custom.createBatteryThresholdHelper();assert.equal(calls.length,0,'explicit default-helper action cannot overwrite a custom helper selection');
 const failed=setup(async()=>{throw {code:'connection_lost'}});await failed.createBatteryThresholdHelper();assert(failed.helperCheckError,'creation errors are shown to the user');
 console.log('PASS: Battery threshold helper creation is explicit, duplicate-safe, preserves existing helpers, and reports errors.');
})().catch(e=>{console.error(e);process.exitCode=1});
