const assert=require('node:assert/strict');
const {fixture}=require('./test_frontend_cleanup.cjs');
const decode=text=>text.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
function buttons(html){
 return [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(([,attrs,label])=>{
  const attr=name=>decode(attrs.match(new RegExp('(?:^|\\s)'+name+'="([^"]*)"'))?.[1]||'');
  return {action:attr('data-action'),id:attr('data-id'),label:decode(label.replace(/<[^>]*>/g,'')),aria:attr('aria-label')};
 });
}
function expectAction(rows,action,id,count,label){
 const found=rows.filter(row=>row.action===action&&row.id===id);
 assert.equal(found.length,count,action+'/'+id+' has the intended number of responsive controls');
 if(label!==undefined)for(const row of found)assert.equal(row.label,label);
 return found;
}
{
 const {p}=fixture(),before=JSON.stringify(p.data);
 for(const [kind,id,quantity,name,unit,stockAction,editAction,removeAction] of [
  ['battery','AA" <&>',0,'AA <&>','Stück','batterystock','editbatterytype','deletebatterytype'],
  ['material','salt" <&>',-1.5,'Salz <&>','25 kg Säcke','materialstock','material','deletematerial']
 ]){
  const html=p.inventoryControls(kind,id,quantity,name,unit),rows=buttons(html);
  const stock=expectAction(rows,stockAction,id,1,String(quantity))[0];
  assert(stock.aria.includes(name+': Bestand '+quantity+' '+unit+' ändern'),'quantity remains directly editable with its unit');
  expectAction(rows,'requestpurchase',kind+':'+id,1,'Nachkaufen');
  expectAction(rows,editAction,id,2,'Bearbeiten');
  expectAction(rows,removeAction,id,0,'Entfernen');
  assert(html.includes('inventory-desktop-actions'),'desktop retains its visible edit action');
  assert(/<details\b[^>]*class="[^"]*\btask-menu\b[^"]*\binventory-menu\b/.test(html),'mobile menu uses the shared native task-menu behavior');
  assert(html.includes('task-menu-actions'),'the mobile menu contains the existing action group');
  assert(html.includes('Weitere Aktionen für '+name.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')),'menu has an accessible article-specific name');
  assert(!html.includes('<&>'),'labels and identifiers are escaped before entering markup');
 }
 const html=p.inventoryControls('material','unknown',null,'Unbekannt','kg'),rows=buttons(html);
 assert.equal(expectAction(rows,'materialstock','unknown',1,'?')[0].aria,'Unbekannt: Bestand unbekannt kg ändern','unknown quantity is preserved, not silently turned into zero');
 assert.equal(JSON.stringify(p.data),before,'rendering stock/menu controls never modifies data');
}
{
 const {p,body}=fixture();p.tab='batteries';
 p.data.devices.d.name='Türmelder <Zoé & Mara>';p.data.devices.d.battery_type='AA';p.data.devices.d.battery_quantity=2;
 p.data.devices.linked.name='Manuell verknüpft';p.data.devices.linked.battery_type='AAA';p.data.devices.linked.battery_quantity=4;
 p.data.devices.removed={id:'removed',name:'Nicht anzeigen',deleted_at:'2026-11-21'};
 p.data.settings.battery_inventory={AA:20,CR2032:0};
 p.data.settings.battery_device_links={AA:['linked','linked']};
 p.data.settings.battery_notes={AA:'Batterien <trocken> & kühl lagern'};
 Object.assign(p.data.settings.consumables.salt,{name:'Salz <&>',unit:'25 kg Säcke',quantity:-1.5,threshold:0.5,notes:'Bei <Landi> & Jumbo\nkaufen',device_ids:['d','d','linked','removed','missing']});
 const before=JSON.stringify(p.data);p.body();const html=body.innerHTML,rows=buttons(html);
 assert(html.includes('inventory-item'),'inventory tiles are scoped without changing other view rows');
 assert(html.includes('data-preserve-key="battery-usage:AA"'),'battery disclosure keeps its refresh identity');
 assert(html.includes('data-preserve-key="material-usage:salt"'),'material disclosure keeps its refresh identity');
 assert(html.includes('inventory-usage-desktop')&&html.includes('inventory-usage-mobile'),'one disclosure offers appropriate desktop and compact mobile labels');
 assert(html.includes('Türmelder &lt;Zoé &amp; Mara&gt; · 2 Batterien'),'battery quantity per device is retained');
 assert(html.includes('Manuell verknüpft · Anzahl nicht erfasst'),'manually linked device of another battery type keeps its uncertainty');
 assert(html.includes('Batterien &lt;trocken&gt; &amp; kühl lagern'),'battery note remains readable and escaped');
 assert(html.includes('Bei &lt;Landi&gt; &amp; Jumbo\nkaufen'),'material note retains its content and line breaks');
 assert(html.includes('25 kg Säcke')&&html.includes('Nachkaufen ab 0.5'),'material unit and reorder threshold remain visible');
 assert(!html.includes('Nicht anzeigen'),'removed devices remain excluded');
 assert.equal(rows.filter(row=>row.action==='record'&&row.id==='linked'&&row.label==='Manuell verknüpft').length,1,'material usage links deduplicate existing device IDs');
 assert.equal(rows.filter(row=>row.action==='record'&&row.id==='linked'&&row.label.includes('Anzahl nicht erfasst')).length,1,'battery usage links are not duplicated for different layouts');
 expectAction(rows,'batterystock','AA',1,'20');expectAction(rows,'batterystock','CR2032',1,'0');
 expectAction(rows,'materialstock','salt',1,'-1.5');
 expectAction(rows,'requestpurchase','battery:AA',1,'Nachkaufen');expectAction(rows,'requestpurchase','material:salt',1,'Nachkaufen');
 expectAction(rows,'deletebatterytype','AA',0);expectAction(rows,'deletematerial','salt',0);
 const standard=p.usageDeviceLinks(['d','d','removed','missing']);
 assert(!standard.includes('inventory-usage')&&!standard.includes('material-usage:'),'other usages of the device-links helper keep their existing presentation');
 assert.equal(buttons(standard).filter(row=>row.action==='record'&&row.id==='d').length,1);
 assert.equal(JSON.stringify(p.data),before,'building the compact inventory preserves every stored value');
}
{
 const {p,body}=fixture();p.tab='batteries';
 const first={open:false},second={open:true};let flushes=0;
 body.querySelectorAll=selector=>selector==='.task-menu'?[first,second]:selector==='.task-menu[open]'?[first,second].filter(menu=>menu.open):[];
 p.scheduleBackgroundFlush=()=>flushes++;
 p.body();assert.equal(typeof first.ontoggle,'function','inventory menu attaches to the existing menu behavior');
 first.open=true;first.ontoggle();assert.equal(second.open,false,'opening one menu closes its sibling');
 first.open=false;first.ontoggle();assert.equal(flushes,1,'closing a menu rzoeses deferred refresh work');
}
console.log('PASS: Kompaktes Verbrauchsmaterial bewahrt Bestand, Aktionen, Gerätebedarf, Notizen und Einheiten; Menüs sind zugänglich, sicher und ohne Datenmutation.');
