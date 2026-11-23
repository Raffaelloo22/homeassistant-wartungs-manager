const assert=require('node:assert/strict');
const {fixture}=require('./test_frontend_cleanup.cjs');
const {p,body}=fixture();p.tab='batteries';
const sample=(patch={})=>({id:'d',name:'Türmelder',battery_type:'AA',battery_quantity:2,...patch});
assert.equal(p.batteryUsageDeviceLabel(sample(),'AA'),'Türmelder · 2 Batterien');
assert.equal(p.batteryUsageDeviceLabel(sample({battery_quantity:1}),'AA'),'Türmelder · 1 Batterie');
assert.equal(p.batteryUsageDeviceLabel(sample({battery_quantity:'3'}),'AA'),'Türmelder · 3 Batterien');
assert.equal(p.batteryUsageDeviceLabel(sample({battery_type:'4 × AA',battery_quantity:null}),'AA'),'Türmelder · 4 Batterien');
assert.equal(p.batteryUsageDeviceLabel(sample({battery_type:'2x CR123A Lithium',battery_quantity:undefined}),'CR123A'),'Türmelder · 2 Batterien');
assert.equal(p.batteryUsageDeviceLabel(sample({battery_quantity:undefined}),'AA'),'Türmelder · 1 Batterie','normal device quantity fallback remains one');
for(const device of [sample({battery_type:'AAA'}),sample({battery_type:null}),sample({battery_quantity:0}),sample({battery_quantity:1.5}),sample({battery_quantity:'unknown'})]){
 assert.equal(p.batteryUsageDeviceLabel(device,'AA'),'Türmelder · Anzahl nicht erfasst','manual links of another type and unknown quantities must not invent a count');
}
p.data.devices.d=sample({name:'Türmelder <Zoé & Mara>'});p.data.devices.linked={id:'linked',name:'Manuell verknüpft',battery_type:'AAA',battery_quantity:4};
p.data.settings.battery_inventory={AA:5,AAA:1,CR2032:2};p.data.settings.battery_device_links={AA:['linked']};
const before=JSON.stringify(p.data);p.body();
assert(body.innerHTML.includes('Türmelder &lt;Zoé &amp; Mara&gt; · 2 Batterien'));
assert(body.innerHTML.includes('Manuell verknüpft · Anzahl nicht erfasst'));
assert(body.innerHTML.includes('Manuell verknüpft · 4 Batterien'));
assert(body.innerHTML.includes('data-action="record" data-id="d"'),'device links remain clickable');
const material=p.usageDeviceLinks(['d']);assert(material.includes('Türmelder &lt;Zoé &amp; Mara&gt;'));assert(!material.includes('Batterien')&&!material.includes('Anzahl nicht erfasst'),'other material usage links remain unchanged');
assert.equal(JSON.stringify(p.data),before,'rendering usage quantities must never change device or inventory data');
{
 const {p}=fixture();p.tab='batteries';
 p.data.devices={
  two:{id:'two',name:'Zwei Batterien',battery_type:'AA',battery_quantity:2},
  six:{id:'six',name:'Sechs Batterien',battery_type:'AA',battery_quantity:'6'},
  legacy:{id:'legacy',name:'Legacy-Menge',battery_type:'3 × AA',battery_quantity:null},
  fallback:{id:'fallback',name:'Standardmenge',battery_type:'AA'},
  wrong:{id:'wrong',name:'Anderer Batterietyp',battery_type:'AAA',battery_quantity:4},
  deleted:{id:'deleted',name:'Entfernt',battery_type:'AA',battery_quantity:99,deleted_at:'2026-11-23'},
  archived:{id:'archived',name:'Archiviert',battery_type:'AA',battery_quantity:99,archived:true}
 };
 p.data.settings.battery_inventory={AA:20,AAA:4,CR2032:2};
 p.data.settings.battery_device_links={AA:['two','two','six','missing','deleted']};
 const before=JSON.stringify(p.data),row=p.inventoryItems().find(item=>item.id==='AA');
 assert.equal(row.devices.length,4,'automatic and repeated manual assignments refer to each existing device only once');
 assert.equal(p.inventoryBatteryUsageText(row.devices,'AA'),'4 Geräte benötigen 12 Batterien','quantities are summed rather than multiplied by a single device quantity');
 const card=p.inventoryCard(row),caption='4 Geräte benötigen 12 Batterien';
 assert.equal(card.split(caption).length-1,2,'desktop metadata and compact mobile disclosure show the same device and battery totals');
 assert(card.includes('inventory-usage-desktop">Geräte anzeigen'),'desktop disclosure remains available');
 assert(card.includes('data-action="record" data-id="two"')&&card.includes('data-action="record" data-id="six"'),'device links remain usable');
 assert(!card.includes('Entfernt')&&!card.includes('Archiviert')&&!card.includes('Anderer Batterietyp'),'unassigned, removed and automatically archived devices do not inflate this type’s demand');
 assert.equal(p.inventoryBatteryUsageText([],'CR2032'),'0 Geräte benötigen 0 Batterien');
 assert.equal(p.inventoryBatteryUsageText([{id:'one',name:'Eins',battery_type:'AA',battery_quantity:1}],'AA'),'1 Gerät benötigt 1 Batterie');
 assert.equal(p.inventoryBatteryUsageText([{id:'one',name:'Zwei',battery_type:'AA',battery_quantity:2}],'AA'),'1 Gerät benötigt 2 Batterien');
 assert.equal(JSON.stringify(p.data),before,'calculating and displaying demand never modifies device quantities or stock');
}
{
 const {p}=fixture(),known={id:'known',name:'Bekannt',battery_type:'AA',battery_quantity:6};
 for(const unknown of [
  {id:'wrong',name:'Anderer Typ',battery_type:'AAA',battery_quantity:4},
  {id:'absent',name:'Typ fehlt',battery_type:null,battery_quantity:4},
  {id:'zero',name:'Ungültig null',battery_type:'AA',battery_quantity:0},
  {id:'fraction',name:'Ungültiger Bruch',battery_type:'AA',battery_quantity:1.5},
  {id:'text',name:'Unbekannte Menge',battery_type:'AA',battery_quantity:'unknown'}
 ]){
  assert.equal(p.inventoryBatteryUsageText([known,unknown],'AA'),'2 Geräte benötigen mindestens 6 Batterien · Anzahl bei 1 Gerät nicht erfasst','uncertain or mismatched assignments never become a fabricated zero or a foreign-type quantity');
 }
 const unknown=[{id:'wrong',battery_type:'AAA',battery_quantity:4},{id:'absent',battery_type:null}];
 assert.equal(p.inventoryBatteryUsageText(unknown,'AA'),'2 Geräte · Batterieanzahl nicht erfasst');
 assert.equal(p.inventoryBatteryUsageText([unknown[0]],'AA'),'1 Gerät · Batterieanzahl nicht erfasst');
 p.data.devices={known,wrong:unknown[0],absent:unknown[1],removed:{id:'removed',battery_type:'AA',battery_quantity:50,deleted_at:'2026-11-23'}};
 p.data.settings.battery_inventory={AA:1};p.data.settings.battery_device_links={AA:['known','known','wrong','absent','removed','missing']};
 const before=JSON.stringify(p.data),row=p.inventoryItems().find(item=>item.id==='AA');
 assert.equal(row.devices.length,3);assert.equal(p.inventoryBatteryUsageText(row.devices,'AA'),'3 Geräte benötigen mindestens 6 Batterien · Anzahl bei 2 Geräten nicht erfasst','only actual linked devices contribute, and unknown counts remain explicit');
 assert.equal(JSON.stringify(p.data),before);
}
{
 const {p}=fixture();p.data.settings.battery_inventory={AA:8,CR2032:10};p.data.settings.battery_inventory_hidden_types=['Akku (fest verbaut)'];
 p.data.devices={existing:{id:'existing',name:'Sensor',battery_type:'AAA',battery_quantity:2}};
 const before=JSON.stringify(p.data),options=JSON.parse(JSON.stringify(p.deviceBatteryOptions()));
 assert.deepEqual(options,[['','Keine Batterie'],['AA','AA'],['AAA','AAA'],['CR2032','CR2032']],'device form offers inventory and device-derived types with an explicit empty choice');
 const html=p.deviceFields({id:'current',battery_type:'Akku (fest verbaut)',battery_quantity:1});
 assert(html.includes('<select name="battery_type">')&&!html.includes('<input name="battery_type"'),'device battery type is selected rather than entered freely');
 assert(html.includes('<option value="Akku (fest verbaut)" selected>'),'an existing hidden or legacy type remains selected and cannot be lost on unrelated edits');
 assert.equal(p.deviceBatteryOptions('AA').filter(([type])=>type==='AA').length,1);
 const labels={quantity:{hidden:false},alert:{hidden:false}},events={},type={value:'',addEventListener:(name,handler)=>events[name]=handler},checkbox={checked:false,disabled:false,closest:()=>labels.alert},quantity={disabled:false,closest:()=>labels.quantity};
 p.bindBatteryFields({querySelector:selector=>({'[name=battery_type]':type,'[name=battery_alert_enabled]':checkbox,'[name=battery_quantity]':quantity})[selector]});
 assert(quantity.disabled&&labels.quantity.hidden&&checkbox.disabled&&labels.alert.hidden);
 type.value='AA';events.change();assert(!quantity.disabled&&!labels.quantity.hidden&&checkbox.checked&&!checkbox.disabled,'select changes reveal quantity and activate warnings');
 checkbox.checked=false;type.value='AAA';events.change();assert(!checkbox.checked,'switching between types respects a disabled device warning');
 type.value='';events.change();assert(quantity.disabled&&labels.quantity.hidden&&!checkbox.checked&&checkbox.disabled,'clearing battery selection hides and disables dependent fields');
 assert.equal(JSON.stringify(p.data),before,'building options and changing the unsaved form does not alter stored devices or inventory');
}
console.log('PASS: Batterie-Verwendung zeigt Geräteanzahl mit Singular/Plural, Legacy-Mengen, sicheren manuellen Zuordnungen und unveränderten Materiallinks.');
