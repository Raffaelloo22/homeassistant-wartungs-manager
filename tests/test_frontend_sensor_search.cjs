const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
let Panel;vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../custom_components/ha_wartung/frontend/panel.js'),'utf8'),{HTMLElement:class{},customElements:{get:()=>null,define:(_,value)=>Panel=value}});
const plain=value=>JSON.parse(JSON.stringify(value));
function fixture(selectedId='',haDeviceId='ha-room'){
 const p=Object.create(Panel.prototype);p.data={today:'2026-11-22',devices:{room:{id:'room',ha_device_id:haDeviceId}},rules:{}};
 p.reg={sensors:[
  {id:'humidity',name:'Zoé Luftfeuchte',entity_id:'sensor.zoe_humidity',platform:'zigbee',device_id:'ha-room'},
  {id:'temperature',name:'Zoé Temperatur',entity_id:'sensor.zoe_temperature',platform:'zigbee',device_id:'ha-room'},
  {id:'other',name:'Zoé Luftfeuchte anderer Raum',entity_id:'sensor.other_humidity',device_id:'ha-other'},
  {id:'disabled',name:'Zoé Luftfeuchte deaktiviert',entity_id:'sensor.disabled_humidity',device_id:'ha-room',disabled:true},
  {id:'unsafe"',name:'<img src=x onerror=alert(1)>',entity_id:'sensor.unsafe',platform:'<bad>',device_id:'ha-room'}
 ]};
 const input={value:''},selected={value:selectedId},caption={},remove={},status={},output={hidden:true,textContent:''},button={focus(){this.focused=true;}},results={innerHTML:'',querySelector:()=>button};
 const nodes={'[data-rule-sensor-search]':input,'[name=sensor_registry_id]':selected,'[data-rule-sensor-selected]':caption,'[data-rule-sensor-remove]':remove,'[data-rule-sensor-results]':results,'[data-rule-sensor-status]':status,'[data-rule-sensor-value]':output};
 const editor={dataset:{deviceId:'room'},querySelector:selector=>nodes[selector]},dialog={querySelector:selector=>selector==='[data-rule-sensor-editor]'?editor:nodes[selector]||null};
 p.shadowRoot={querySelector:selector=>selector==='dialog'?dialog:null};p._hass={states:{}};
 const bind=()=>p.bindRuleSensorSearch(dialog),search=value=>{input.value=value;input.oninput();},choose=id=>results.onclick({target:{closest:()=>({dataset:{ruleSensorChoice:id}})}}),key=value=>{const event={key:value,preventDefault(){this.prevented=true;}};input.onkeydown(event);return event;};
 return {p,input,selected,caption,remove,results,status,output,dialog,button,bind,search,choose,key};
}
{
 const f=fixture('humidity'),before=plain(f.p.data);f.bind();
 assert.equal(f.selected.value,'humidity','opening an existing rule preserves its registry ID');assert(f.caption.textContent.includes('Zoé Luftfeuchte'));assert.equal(f.remove.hidden,false);assert.equal(f.results.innerHTML,'');
 f.search('zoe luftfeuchte');assert.equal(f.selected.value,'','typing must not submit the previous sensor silently');assert(f.results.innerHTML.includes('data-rule-sensor-choice="humidity"'));assert(!f.results.innerHTML.includes('data-rule-sensor-choice="other"'));assert(!f.results.innerHTML.includes('data-rule-sensor-choice="disabled"'));
 assert.equal(f.key('Enter').prevented,true);assert.equal(f.selected.value,'humidity','one exact search result can be chosen with Enter');assert.equal(f.input.value,'');
 f.search('sensor.zoe_temperature');assert(f.results.innerHTML.includes('data-rule-sensor-choice="temperature"'));assert.equal(f.key('ArrowDown').prevented,true);assert.equal(f.button.focused,true);f.choose('temperature');assert.equal(f.selected.value,'temperature');
 const saved=f.p.readRule(new Map([['kind','measurement'],['name','Temperatur prüfen'],['sensor_registry_id',f.selected.value],['threshold','18'],['max_age_hours','24']]));assert.equal(saved.sensor_registry_id,'temperature','the submitted value stays the registry ID, never the display name');assert.equal(saved.threshold,18);
 f.remove.onclick();assert.equal(f.selected.value,'');assert.equal(f.remove.hidden,true);assert.equal(f.caption.textContent,'Keine Sensor-Anbindung');assert.deepEqual(plain(f.p.data),before,'opening/searching/removing only modifies unsaved form state');
}
{
 const f=fixture();f.bind();f.search('zoe');f.key('Enter');assert.equal(f.selected.value,'','ambiguous results must not choose an arbitrary sensor');assert(f.status.textContent.includes('aus den Treffern'));f.search('not-found');assert.equal(f.results.innerHTML,'');assert.equal(f.status.textContent,'Keine passenden Sensoren gefunden.');
 f.choose('other');assert.equal(f.selected.value,'','a sensor from another HA device cannot be selected');f.choose('disabled');assert.equal(f.selected.value,'','disabled sensors cannot be newly selected');
 f.search('unsafe');assert(f.results.innerHTML.includes('data-rule-sensor-choice="unsafe&quot;"'));assert(f.results.innerHTML.includes('&lt;img'));assert(f.results.innerHTML.includes('&lt;bad&gt;'));assert(!f.results.innerHTML.includes('<img'));
}
{
 for(const selected of ['missing','disabled','other']){const f=fixture(selected);f.bind();assert.equal(f.selected.value,selected,'an existing assignment is preserved until explicitly changed');assert.equal(f.remove.hidden,false);if(selected==='missing')assert(f.caption.textContent.includes('nicht gefunden'));}
 const f=fixture('',null);f.bind();f.search('sensor.other_humidity');f.key('Enter');assert.equal(f.selected.value,'other','a manual device retains access to all active sensors');
}
{
 const f=fixture();f.p.reg.sensors=Array.from({length:20},(_,i)=>({id:'s'+i,name:'Messwert '+i,entity_id:'sensor.value_'+i,device_id:'ha-room'}));f.bind();f.search('Messwert');assert.equal((f.results.innerHTML.match(/data-rule-sensor-choice=/g)||[]).length,15);assert.equal(f.status.textContent,'15 von 20 Sensoren. Suche eingrenzen.');
}
{
 const f=fixture();f.p.ruleMaterialFields=()=>'';const html=f.p.ruleFields({sensor_registry_id:'unsafe"'},'room');assert(html.includes('type="search" data-rule-sensor-search'));assert(html.includes('type="hidden" name="sensor_registry_id" value="unsafe&quot;"'));assert(!html.includes('<select name="sensor_registry_id"'));assert(html.includes('aria-label="Gefundene Sensoren"'));
 f.p.bindRuleSensorSearch({querySelector:()=>null});
}
{
 const f=fixture('humidity'),rule={id:'existing',device_id:'room',kind:'measurement',name:'Messwert prüfen',sensor_registry_id:'humidity',threshold:18.5,max_age_hours:24,timestamp_attribute:'legacy_timestamp',freshness_verified:true};
 f.p.data.rules.existing=rule;const before=plain(f.p.data);f.p.ruleMaterialFields=()=>'';
 const html=f.p.ruleFields(rule,'room');assert(html.includes('data-rule-sensor-search'));assert(html.includes('name="threshold"'));assert(html.includes('value="18.5"'));
 for(const field of ['max_age_hours','timestamp_attribute','freshness_verified'])assert(!html.includes('name="'+field+'"'),field+' has no technical form control');
 assert(!html.includes('verifizierten Messzeitpunkt'));assert(!html.includes('Herkunft dieses Messzeitpunkts geprüft'));assert(!html.includes('Messwert maximal gültig'));
 const values=new Map([['kind','measurement'],['name','Messwert prüfen'],['sensor_registry_id','humidity'],['threshold','18.5'],['max_age_hours','0'],['timestamp_attribute','last_seen'],['freshness_verified','on']]);
 const saved=f.p.readRule(values);assert.deepEqual(plain(saved),{consumables_by_step:{},consumable:null,name:'Messwert prüfen',kind:'measurement',booked:null,review_note:'',sensor_registry_id:'humidity',threshold:18.5},'only sensor and finite threshold are submitted as measurement-specific fields');assert(Number.isFinite(saved.threshold));
 for(const field of ['max_age_hours','timestamp_attribute','freshness_verified']){assert(!Object.hasOwn(saved,field),'legacy technical values are not copied into the payload');values.delete(field);}
 assert.deepEqual(plain(f.p.readRule(values)),plain(saved),'omitting removed fields does not accidentally submit a zero freshness limit');assert.deepEqual(plain(f.p.data),before,'rendering/editing a legacy rule leaves original saved data untouched');
}
{
 const f=fixture('humidity'),before=plain(f.p.data);
 f.p._hass.states['sensor.zoe_humidity']={state:'80',attributes:{unit_of_measurement:'%'}};
 f.p._hass.states['sensor.zoe_temperature']={state:'21.5',attributes:{unit_of_measurement:'°C'}};
 Object.defineProperty(f.output,'innerHTML',{set(){throw Error('Sensor values must only be written through textContent');}});
 f.bind();assert.equal(f.output.hidden,false);assert.equal(f.output.textContent,'Aktueller Wert: 80 %','an existing selection shows the current value and unit immediately');
 f.search('temperature');assert.equal(f.output.hidden,true);assert.equal(f.output.textContent,'','typing removes the previous sensor preview with the old selection');f.key('Enter');assert.equal(f.output.textContent,'Aktueller Wert: 21.5 °C','choosing another sensor updates the preview and keeps decimal points');
 f.p._hass.states['sensor.zoe_temperature']={state:'0',attributes:{unit_of_measurement:'°C'}};f.p.updateRuleSensorValue(f.dialog);assert.equal(f.output.textContent,'Aktueller Wert: 0 °C','zero is a valid current value');
 f.p._hass.states['sensor.zoe_temperature']={state:'not_charging',attributes:{}};f.p.updateRuleSensorValue(f.dialog);assert.equal(f.output.textContent,'Aktueller Wert: not_charging','text states remain visible so a nonnumeric sensor can be identified');
 f.p._hass.states['sensor.zoe_temperature']={state:'unknown',attributes:{unit_of_measurement:'°C'}};f.p.updateRuleSensorValue(f.dialog);assert.equal(f.output.textContent,'Aktueller Wert: unbekannt');
 for(const state of [{state:'unavailable',attributes:{}},{state:'42',attributes:{restored:true}},undefined]){
  f.p._hass.states['sensor.zoe_temperature']=state;f.p.updateRuleSensorValue(f.dialog);assert.equal(f.output.textContent,'Aktueller Wert: nicht verfügbar','unavailable, restored and missing states are explicit');assert.equal(f.output.hidden,false);
 }
 f.p._hass.states['sensor.zoe_temperature']={state:'<img src=x onerror=alert(1)>',attributes:{unit_of_measurement:'<unit>'}};f.p.updateRuleSensorValue(f.dialog);assert.equal(f.output.textContent,'Aktueller Wert: <img src=x onerror=alert(1)> <unit>','untrusted state and unit are plain text');
 f.remove.onclick();assert.equal(f.output.hidden,true);assert.equal(f.output.textContent,'');assert.deepEqual(plain(f.p.data),before,'showing sensor values never changes saved device or task data');
 const missing=fixture('missing');missing.bind();assert.equal(missing.output.textContent,'Aktueller Wert: nicht verfügbar');
 f.p.updateRuleSensorValue({querySelector:()=>null});f.p.shadowRoot=null;f.p.updateRuleSensorValue();
}
{
 const f=fixture('humidity');f.bind();for(const method of ['syncBatteryThresholdControl','updateBatteryBadges','updateBatteryWarnings','updateDeviceStatuses','updateBatteryTaskStructure'])f.p[method]=()=>{};
 f.p.hass={states:{'input_number.batterien_schwellwert':{state:'20'},'sensor.zoe_humidity':{state:'48.5',attributes:{unit_of_measurement:'%'}}}};
 assert.equal(f.output.textContent,'Aktueller Wert: 48.5 %','the HA state setter updates the existing open form without recreating or clearing inputs');assert.equal(f.selected.value,'humidity');
 f.p.hass={states:{'input_number.batterien_schwellwert':{state:'20'},'sensor.zoe_humidity':{state:'49',attributes:{unit_of_measurement:'%'}}}};assert.equal(f.output.textContent,'Aktueller Wert: 49 %');
 const html=f.p.ruleSensorFields({sensor_registry_id:'humidity'},'room');assert(/<output[^>]*data-rule-sensor-value[^>]*>/.test(html),'the preview is a dedicated output element');const outputTag=html.match(/<output[^>]*data-rule-sensor-value[^>]*>/)[0];assert(outputTag.includes('role="status"'));assert(outputTag.includes('aria-live="polite"'));assert(/\shidden(?:[\s=>])/.test(outputTag),'empty previews initially stay hidden');
}
console.log('PASS: Sensor-Suche nach Name und Entitäts-ID, Gerätefilter, vorhandene Zuordnungen, Auswahl/Entfernen, Tastatur und sichere Formularwerte.');
