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
console.log('PASS: Batterie-Verwendung zeigt Geräteanzahl mit Singular/Plural, Legacy-Mengen, sicheren manuellen Zuordnungen und unveränderten Materiallinks.');
