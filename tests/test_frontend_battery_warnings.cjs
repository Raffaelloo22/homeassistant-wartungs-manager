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

// Device cards explain the central threshold even above it, without inventing sensor values.
const cards=setup();assert.equal(cards.inlineStatus(cards.data.devices.d),'| Batterie: 19.9 % · Warnschwelle 20 %');
cards._hass.states['sensor.battery'].state='80';assert.equal(cards.inlineStatus(cards.data.devices.d),'| Batterie: 80 % · Warnschwelle 20 %');
cards._hass.states['input_number.batterien_schwellwert'].state='60';assert.equal(cards.inlineStatus(cards.data.devices.d),'| Batterie: 80 % · Warnschwelle 60 %');
cards._hass.states['sensor.battery'].state='unknown';assert.equal(cards.inlineStatus(cards.data.devices.d),'| Batterie: unbekannt · Warnschwelle 60 %');
assert.equal(cards.inlineStatus({id:'no-sensor',battery_type:'AA'}),'| Batterie: kein Sensor · Warnschwelle 60 %');
assert.equal(cards.inlineStatus({id:'no-battery'}),'');
cards._hass.states['input_number.batterien_schwellwert'].state='unavailable';assert.equal(cards.inlineStatus(cards.data.devices.d),'| Batterie: unbekannt · Ersatzschwelle 20 %');
const status={dataset:{inlineStatusDevice:'d'},innerHTML:'old'};cards.shadowRoot={querySelectorAll:selector=>selector==='[data-inline-status-device]'?[status]:[]};
cards.updateDeviceStatuses();assert.equal(status.innerHTML,'| Batterie: unbekannt · Ersatzschwelle 20 %');
cards._hass.states['sensor.battery'].state='50';cards._hass.states['input_number.batterien_schwellwert'].state='60';cards.updateDeviceStatuses();assert.equal(status.innerHTML,'| Batterie: 50 % · Warnschwelle 60 %');
console.log('PASS: Gerätekacheln zeigen Stand und Warnschwelle auch oberhalb der Schwelle, unterscheiden unbekannt/kein Sensor und aktualisieren live.');
