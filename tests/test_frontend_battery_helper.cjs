const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');let Panel;
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../custom_components/ha_wartung/frontend/panel.js'),'utf8'),{HTMLElement:class{},customElements:{get:()=>null,define:(_,c)=>Panel=c}});
const setup=callWS=>Object.assign(Object.create(Panel.prototype),{_hass:{states:{},callWS},shadowRoot:{querySelector:()=>null}});
(async()=>{
 let calls=[];const p=setup(async command=>{calls.push(command);if(command.type==='input_number/list')return [];if(command.type==='config/entity_registry/get')throw {code:'not_found'};if(command.type==='input_number/create')return {id:'batterien_schwellwert'};throw Error('Unexpected call');});
 await Promise.all([p.ensureBatteryThresholdHelper(),p.ensureBatteryThresholdHelper()]);assert.equal(calls.filter(x=>x.type==='input_number/create').length,1);assert.equal(calls.find(x=>x.type==='input_number/create').initial,20);assert.equal(p.helperCheckError,'');
 calls=[];const present=setup(async c=>calls.push(c));present._hass.states['input_number.batterien_schwellwert']={state:'15'};await present.ensureBatteryThresholdHelper();assert.equal(calls.length,0);assert.equal(present._hass.states['input_number.batterien_schwellwert'].state,'15');
 const unavailable=setup(async c=>{assert.equal(c.type,'input_number/list');return [{id:'batterien_schwellwert'}]});await unavailable.ensureBatteryThresholdHelper();assert.equal(unavailable.helperCheckError,'');
 const failed=setup(async()=>{throw {code:'connection_lost'}});await failed.ensureBatteryThresholdHelper();assert(failed.helperCheckError);await failed.ensureBatteryThresholdHelper();
 console.log('PASS: App prüft Helfer, legt ihn einmalig mit 20 Prozent an, erhält vorhandene Werte und behandelt Verbindungsfehler.');
})().catch(e=>{console.error(e);process.exitCode=1});
