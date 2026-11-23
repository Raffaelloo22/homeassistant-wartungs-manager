const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
let Panel;
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../custom_components/ha_wartung/frontend/panel.js'),'utf8'),{HTMLElement:class{},customElements:{get:()=>null,define:(_,c)=>Panel=c}});
const setup=()=>{
  const p=Object.create(Panel.prototype);
  p.data={today:'2026-11-22',devices:{d:{id:'d',name:'Zoé Sensor',battery_entity_id:'sensor.battery',battery_type:'AAA',battery_quantity:2}},rules:{},views:[]};
  p._hass={states:{'input_number.batterien_schwellwert':{state:'20'},'sensor.battery':{state:'19.9',attributes:{unit_of_measurement:'%',device_class:'battery'}}}};
  return p;
};
const p=setup(),auto=()=>p.batteryTasks()[0];
assert.equal(p.batteryTasks().length,1);assert.equal(p.batteryWarning(auto()).text,'19.9 % · Warnschwelle 20 %');
assert.match(p.task(auto()),/19\.9 % · Warnschwelle 20 %/);assert.match(p.task(auto()),/data-battery-task-value="d"/);assert.match(p.task(auto()),/input_number\.batterien_schwellwert/);
p._hass.states['sensor.battery'].state='20';assert.equal(p.batteryTasks().length,0,'strictly below; equality never warns');
assert.equal(p.batteryWarning({automatic_battery:true,device_id:'d'}),null);
p._hass.states['sensor.battery'].state='19.9';
for(const raw of ['', 'unknown', 'unavailable', '-1', '101', '<script>']){
  p._hass.states['input_number.batterien_schwellwert'].state=raw;
  assert.equal(p.batteryTasks().length,1);assert.equal(p.batteryWarning(auto()).text,'19.9 % · Ersatzschwelle 20 %');assert.match(p.batteryWarning(auto()).title,/nicht verfügbar oder ungültig/);
  assert(!p.task(auto()).includes('<script>'));
}
p._hass.states['input_number.batterien_schwellwert'].state='12.5';assert.equal(p.batteryTasks().length,0);
p._hass.states['sensor.battery'].state='12.49';assert.equal(p.batteryWarning(auto()).text,'12.49 % · Warnschwelle 12.5 %','display must not round a just-below value up to the threshold');
for(const raw of ['', 'unknown', 'unavailable', '-1', '101', 'NaN']){
  p._hass.states['sensor.battery'].state=raw;assert.equal(p.batteryTasks().length,0);assert.equal(p.batteryWarning({automatic_battery:true,device_id:'d'}),null);
}
p._hass.states['sensor.battery'].state='12';
for(const patch of [{deleted_at:'today'},{in_storage:true},{archived:true},{archived_at:'2026-01-01'},{battery_alert_enabled:false}]){
  const before={...p.data.devices.d};Object.assign(p.data.devices.d,patch);
  assert.equal(p.batteryTasks().length,0);assert.equal(p.batteryWarning({automatic_battery:true,device_id:'d'}),null);p.data.devices.d=before;
}
// Existing due battery work remains the only task and explains the current warning.
const manual={rule_id:'r',device_id:'d',device_name:'Zoé Sensor',name:'Batterien wechseln',status:'due',due:'2026-11-22'};
p.data.rules.r={id:'r',device_id:'d',name:'Batterien wechseln',kind:'interval'};p.data.views=[manual];
assert.equal(p.batteryTasks().length,0,'existing battery work still suppresses a duplicate');
assert.equal(p.batteryWarning(manual).text,'12 % · Warnschwelle 12.5 %');assert.match(p.task(manual),/12 % · Warnschwelle 12\.5 %/);
assert.equal(p.batteryWarning({...manual,name:'Aufladen'}),null);
assert.equal(p.batteryWarning({...manual,name:'Batterien prüfen'}),null);
p.data.rules.r.consumable={kind:'battery',id:'AAA'};assert(p.batteryWarning({...manual,name:'Zellen ersetzen'}));
// Live value and threshold changes update existing nodes without replacing cards/menus.
const warning={dataset:{batteryWarningDevice:'d',batteryWarningRule:'r',batteryWarningName:manual.name,batteryWarningAutomatic:'false'},textContent:'old',title:'',hidden:true};
const autoValue={dataset:{batteryTaskValue:'d'},textContent:'old'};
p.shadowRoot={querySelectorAll:selector=>selector==='[data-battery-warning-device]'?[warning]:selector==='[data-battery-task-value]'?[autoValue]:[]};
p.updateBatteryWarnings();assert.equal(warning.textContent,'12 % · Warnschwelle 12.5 %');assert.equal(warning.hidden,false);assert.equal(autoValue.textContent,'12 %');
p._hass.states['sensor.battery'].state='12.1';p._hass.states['input_number.batterien_schwellwert'].state='13';p.updateBatteryWarnings();assert.equal(warning.textContent,'12.1 % · Warnschwelle 13 %');assert.equal(autoValue.textContent,'12.1 %');
p._hass.states['sensor.battery'].state='13';p.updateBatteryWarnings();assert.equal(warning.hidden,true);assert.equal(warning.textContent,'');assert.equal(autoValue.textContent,'13 %');
p._hass.states['sensor.battery'].state='unavailable';p.updateBatteryWarnings();assert.equal(warning.hidden,true);assert.equal(autoValue.textContent,'Unbekannt');
console.log('PASS: Batteriewarnungen zeigen Stand und echte/Ersatzschwelle, behalten strikte Grenzen und Deduplizierung, aktualisieren vorhandene DOM-Knoten.');

// Device cards show only the measured percentage, red strictly below the current threshold.
const cards=setup(),low=value=>'| Batterie: <span class="due">'+value+' %</span>',normal=value=>'| Batterie: <span>'+value+' %</span>';
assert.equal(cards.inlineStatus(cards.data.devices.d),low(19.9));
cards._hass.states['sensor.battery'].state='20';assert.equal(cards.inlineStatus(cards.data.devices.d),normal(20),'equality is never red');
cards._hass.states['sensor.battery'].state='80';assert.equal(cards.inlineStatus(cards.data.devices.d),normal(80));
cards._hass.states['input_number.batterien_schwellwert'].state='60';assert.equal(cards.inlineStatus(cards.data.devices.d),normal(80));
cards._hass.states['input_number.batterien_schwellwert'].state='12.5';cards._hass.states['sensor.battery'].state='12.49';
assert.equal(cards.inlineStatus(cards.data.devices.d),low(12.49),'the exact measured value remains below the threshold instead of rounding to equality');
cards._hass.states['sensor.battery'].state='unknown';assert.equal(cards.inlineStatus(cards.data.devices.d),'| Batterie: unbekannt');
assert.equal(cards.inlineStatus({id:'no-sensor',battery_type:'AA'}),'| Batterie: kein Sensor');
assert.equal(cards.inlineStatus({id:'no-battery'}),'');
cards._hass.states['input_number.batterien_schwellwert'].state='unavailable';assert.equal(cards.inlineStatus(cards.data.devices.d),'| Batterie: unbekannt');
cards._hass.states['sensor.battery'].state='19.9';assert.equal(cards.inlineStatus(cards.data.devices.d),low(19.9),'the existing fallback comparison is retained when the helper is unavailable');
const status={dataset:{inlineStatusDevice:'d'},innerHTML:'old'},root={innerHTML:'Existing device cards',querySelectorAll:selector=>selector==='[data-inline-status-device]'?[status]:[]};cards.shadowRoot=root;
for(const method of ['syncBatteryThresholdControl','updateBatteryBadges','updateBatteryWarnings','updateBatteryTaskStructure','updateRuleSensorValue'])cards[method]=()=>{};
const publish=()=>{cards.hass=JSON.parse(JSON.stringify(cards._hass));assert.equal(root.innerHTML,'Existing device cards','live updates replace only the inline battery value');assert(!/Warnschwelle|Ersatzschwelle/.test(status.innerHTML),'device cards never repeat the threshold text');};
cards._hass.states['sensor.battery'].state='24';cards._hass.states['input_number.batterien_schwellwert'].state='25';publish();assert.equal(status.innerHTML,low(24));
cards._hass.states['sensor.battery'].state='25';publish();assert.equal(status.innerHTML,normal(25),'a live sensor update to equality clears the red value');
cards._hass.states['input_number.batterien_schwellwert'].state='26';publish();assert.equal(status.innerHTML,low(25),'a helper-only update can turn the existing value red');
cards._hass.states['input_number.batterien_schwellwert'].state='24';publish();assert.equal(status.innerHTML,normal(25),'a helper-only update also clears red again');
cards.data.settings={battery_threshold_entity:'input_number.custom_threshold'};cards._hass.states['input_number.custom_threshold']={state:'30'};publish();assert.equal(status.innerHTML,low(25),'the selected helper is used rather than a hard-coded default');
for(const raw of ['unknown','unavailable','',undefined,'-1','101']){cards._hass.states['sensor.battery'].state=raw;publish();assert.equal(status.innerHTML,'| Batterie: unbekannt','unknown or invalid sensor readings remain neutral');}
delete cards._hass.states['sensor.battery'];publish();assert.equal(status.innerHTML,'| Batterie: unbekannt','a missing linked sensor has no red placeholder');
delete cards.data.devices.d.battery_entity_id;publish();assert.equal(status.innerHTML,'| Batterie: kein Sensor','a device without a sensor stays neutral');
console.log('PASS: Gerätekacheln zeigen nur den gemessenen Batteriewert, rot strikt unter der Helferschwelle, neutral bei unbekanntem Sensor und live aktualisiert.');
