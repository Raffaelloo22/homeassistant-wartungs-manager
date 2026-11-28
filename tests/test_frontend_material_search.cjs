const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
let Panel;class ChangeEvent{constructor(type,options){this.type=type;Object.assign(this,options);}}
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../custom_components/ha_wartung/frontend/panel.js'),'utf8'),{HTMLElement:class{},customElements:{get:()=>null,define:(_,value)=>Panel=value},Event:ChangeEvent,FormData:class{constructor(form){this.form=form;}getAll(name){return this.form.values(name);}}});
const plain=value=>JSON.parse(JSON.stringify(value));
const choices=[['','Kein Verbrauchsmaterial'],['battery:AA','Batterie · AA'],['battery:AAA (Lithium)','Batterie · AAA (Lithium)'],['material:salt','Entkalkersalz (kg)'],['material:clean','Zoé Reiniger (Liter)'],['material:unsafe"','<img src=x onerror=alert(1)> (<Liter>)']];
function fixture(key='',inherit=false,options=choices){
 const p=Object.create(Panel.prototype);p.data={settings:{},devices:{d:{battery_quantity:2}}};p.materialOptions=()=>options.map(row=>[...row]);
 const changes=[],input={value:''},selected={value:key,dispatchEvent(event){changes.push(event);}},caption={},remove={},status={},button={focus(){this.focused=true;}},results={innerHTML:'',querySelector:()=>button};
 const nodes={'[data-rule-material-search]':input,'input[type=hidden]':selected,'input[name]':selected,'[name]':selected,'[name=consumable_key]':selected,'[name=step_material_key]':selected,'[data-rule-material-selected]':caption,'[data-rule-material-remove]':remove,'[data-rule-material-results]':results,'[data-rule-material-status]':status};
 const editor={dataset:{inherit:String(inherit)},querySelector:selector=>{assert(selector in nodes,'unknown editor selector '+selector);return nodes[selector];}},container={querySelectorAll:selector=>{assert.equal(selector,'[data-rule-material-editor]');return [editor];}};
 const bind=()=>p.bindRuleMaterialSearch(container),search=value=>{input.value=value;input.oninput();},choose=id=>results.onclick({target:{closest:()=>({dataset:{ruleMaterialChoice:id}})}}),keyDown=value=>{const event={key:value,preventDefault(){this.prevented=true;}};input.onkeydown(event);return event;};
 return {p,input,selected,caption,remove,results,status,button,changes,editor,container,bind,search,choose,keyDown};
}
{
 const f=fixture('material:salt'),before=plain(f.p.data);f.bind();assert.equal(f.selected.value,'material:salt');assert(f.input.value.includes('Entkalkersalz'));assert.equal(f.caption.textContent,'','the selected value is shown in the search field without a redundant caption');assert.equal(f.remove.hidden,false);assert.equal(f.results.innerHTML,'');
 f.search('zoe liter');assert.equal(f.selected.value,'material:salt','typing a search does not silently remove the saved link');assert(f.results.innerHTML.includes('material:clean'));assert(!f.results.innerHTML.includes('material:salt'));
 assert.equal(f.keyDown('Enter').prevented,true);assert.equal(f.selected.value,'material:clean');assert(f.input.value.includes('Zoé Reiniger'),'the selected result remains visible in the search field');assert.equal(f.changes.at(-1).type,'change');assert.equal(f.changes.at(-1).bubbles,true,'quantity visibility listens for bubbling changes');
 f.search('AAA lithium');f.choose('battery:AAA (Lithium)');assert.equal(f.selected.value,'battery:AAA (Lithium)');assert(f.input.value.includes('AAA (Lithium)'));assert.equal(f.caption.textContent,'');
 f.search('Entkalkersalz kg');assert.equal(f.keyDown('ArrowDown').prevented,true);assert.equal(f.button.focused,true);f.choose('material:salt');
 const saved=f.p.readRule(new Map([['kind','date'],['name','Salz nachfüllen'],['due_date','2026-12-01'],['consumable_key',f.selected.value],['consumable_quantity','1.5']]));assert.deepEqual(plain(saved.consumable),{kind:'material',id:'salt',quantity:1.5},'IDs and decimal quantities retain the existing storage format');
 f.remove.onclick();assert.equal(f.selected.value,'');assert.equal(f.caption.textContent,'Kein Verbrauchsmaterial');assert.equal(f.remove.hidden,true);assert.equal(f.changes.at(-1).type,'change');assert.equal(f.changes.at(-1).bubbles,true);assert.deepEqual(plain(f.p.data),before,'search/select/remove changes only unsaved form state');
}
{
 const f=fixture();f.bind();f.search('Batterie');assert.equal(f.keyDown('Enter').prevented,true);assert.equal(f.selected.value,'','ambiguous Enter never chooses an arbitrary material or submits the form');f.search('not-found');assert.equal(f.results.innerHTML,'');assert(f.status.textContent.includes('Kein'));f.choose('material:does-not-exist');assert.equal(f.selected.value,'','only current inventory IDs can be selected');
 f.search('unsafe');assert(f.results.innerHTML.includes('material:unsafe&quot;'));assert(f.results.innerHTML.includes('&lt;img'));assert(f.results.innerHTML.includes('&lt;Liter&gt;'));assert(!f.results.innerHTML.includes('<img'));
}
{
 const f=fixture('material:missing');f.bind();assert.equal(f.selected.value,'material:missing');assert(f.caption.textContent.includes('Bisheriges Material (nicht mehr verfügbar)'));f.search('nothing');assert.equal(f.selected.value,'material:missing','missing existing links survive an unsuccessful search');assert.equal(f.changes.length,0);
 const inherited=fixture('material:salt',true);inherited.bind();inherited.remove.onclick();assert.equal(inherited.caption.textContent,'Allgemeine Auswahl');assert.equal(inherited.selected.value,'');assert.equal(inherited.changes.length,1);
}
{
 const options=[['','Kein Verbrauchsmaterial'],...Array.from({length:20},(_,i)=>['material:m'+i,'Reiniger '+i+' (Liter)'])],f=fixture('',false,options);f.bind();f.search('Reiniger');assert.equal((f.results.innerHTML.match(/data-rule-material-choice=/g)||[]).length,15);assert(f.status.textContent.includes('15')&&f.status.textContent.includes('20'));
 const duplicates=fixture('',false,[['','Kein Verbrauchsmaterial'],['material:a','Reiniger (Liter)'],['material:b','Reiniger (Liter)']]);duplicates.bind();duplicates.search('Reiniger');assert.equal((duplicates.results.innerHTML.match(/data-rule-material-choice=/g)||[]).length,2,'equal display names do not merge distinct material IDs');duplicates.keyDown('Enter');assert.equal(duplicates.selected.value,'');
}
{
 const f=fixture(),html=f.p.ruleMaterialSearchField('consumable_key','Bei Erledigung Bestand reduzieren','material:unsafe"');assert(html.includes('data-rule-material-editor'));assert(html.includes('type="search"'));assert(html.includes('name="consumable_key"'));assert(html.includes('material:unsafe&quot;'));assert(!html.includes('<select'));
 const rowHtml=f.p.rotationMaterialFields({steps:['Reinigen <&>','Batterien'],consumables_by_step:{'Reinigen <&>':{kind:'material',id:'salt',quantity:1.5},Batterien:{kind:'battery',id:'AA'}}});assert(!rowHtml.includes('<select'));assert.equal((rowHtml.match(/data-rule-material-editor/g)||[]).length,2);assert(rowHtml.includes('Reinigen &lt;&amp;&gt;'));assert(rowHtml.includes('value="1.5"'));
 const values={step_material_name:['Reinigen','Batterien','Allgemein'],step_material_key:['material:salt','battery:AA',''],step_material_quantity:['1.5','2','3']};const links=f.p.readStepMaterials({getAll:name=>values[name]});assert.deepEqual(plain(links),{Reinigen:{kind:'material',id:'salt',quantity:1.5},Batterien:{kind:'battery',id:'AA'}},'blank step selection inherits the general link; battery quantities remain device-derived');
 const batteryRule=f.p.readRule(new Map([['kind','date'],['name','Batterien wechseln'],['consumable_key','battery:AA'],['consumable_quantity','99']]));assert.deepEqual(plain(batteryRule.consumable),{kind:'battery',id:'AA'});
 f.p.bindRuleMaterialSearch({querySelectorAll:()=>[]});
}
{
 const general=fixture('material:salt'),p=general.p;
 const makeRow=(name,key,quantity)=>{const f=fixture(key,true),label={hidden:false},amount={value:String(quantity),closest:()=>label};return {name,f,label,amount,querySelector:selector=>selector==='[name=step_material_key]'?f.selected:selector==='[name=step_material_quantity]'?amount:null};};
 let rows=[makeRow('Batterien','battery:AA',2),makeRow('Reinigen','material:clean',1.5)],prepared=0,rebuildHtml='';
 const kind={value:'rotation',addEventListener(type,callback){this['on'+type]=callback;}},steps={value:'Batterien\nReinigen',addEventListener(type,callback){this['on'+type]=callback;}};
 const quantity={disabled:false},quantityBox={},batteryHint={},rotationBox={};
 const stepRows={addEventListener(type,callback){this['on'+type]=callback;},querySelectorAll:selector=>selector==='.rotation-material-row'?rows:selector==='[data-rule-material-editor]'?rows.map(row=>row.f.editor):[]};
 const connect=()=>{for(const row of rows)row.f.selected.dispatchEvent=event=>{row.f.changes.push(event);if(event.bubbles)stepRows.onchange?.(event);};};
 Object.defineProperty(stepRows,'innerHTML',{get:()=>rebuildHtml,set:html=>{rebuildHtml=html;const previous=new Map(rows.map(row=>[row.name,row]));rows=[...new Set(steps.value.split('\n').map(value=>value.trim()).filter(Boolean))].map(name=>{const old=previous.get(name);return makeRow(name,old?.f.selected.value||'',old?.amount.value||1);});connect();}});
 const form={values:name=>rows.map(row=>name==='step_material_name'?row.name:name==='step_material_key'?row.f.selected.value:row.amount.value)};
 const nodes={'[name=consumable_key]':general.selected,'[name=kind]':kind,'[name=rotation_steps]':steps,'[data-step-materials]':stepRows,'[data-material-quantity]':quantityBox,'[name=consumable_quantity]':quantity,'[data-battery-quantity-hint]':batteryHint,'[data-rotation-materials]':rotationBox,form};
 const dialog={querySelector:selector=>nodes[selector],querySelectorAll:selector=>selector==='[data-rule-material-editor]'?[general.editor,...rows.map(row=>row.f.editor)]:[]};
 p.prepareNumberInputs=container=>{assert.equal(container,stepRows);prepared++;};general.selected.dispatchEvent=event=>{general.changes.push(event);general.selected.onchange?.(event);};connect();p.bindRuleMaterial(dialog);
 assert.equal(quantityBox.hidden,false);assert.equal(quantity.disabled,false);assert.equal(batteryHint.hidden,true);assert.equal(rows[0].label.hidden,true);assert.equal(rows[1].label.hidden,false);assert.notEqual(rows[0].amount.disabled,true,'battery quantity remains in FormData to keep later quantity indexes aligned');
 general.search('Batterie AA');general.choose('battery:AA');assert.equal(quantityBox.hidden,true);assert.equal(quantity.disabled,true);assert.equal(batteryHint.hidden,false,'choice events update the battery quantity hint immediately');
 rows[1].f.search('Batterie AA');rows[1].f.choose('battery:AA');assert.equal(rows[1].label.hidden,true,'step choice bubbles to the rotation quantity visibility');rows[1].f.search('Reiniger Liter');rows[1].f.choose('material:clean');assert.equal(rows[1].label.hidden,false);assert.equal(rows[1].amount.value,'1.5','switching link kinds keeps the previously entered consumption amount');
 steps.value='Reinigen\nNeu\nBatterien';steps.onchange();assert.equal(prepared,1,'new rotation number inputs use the same number formatting');assert(rebuildHtml.includes('data-rule-material-editor'));assert.deepEqual(rows.map(row=>row.name),['Reinigen','Neu','Batterien']);assert.equal(rows[0].f.selected.value,'material:clean');assert.equal(rows[0].amount.value,'1.5');assert.equal(rows[2].f.selected.value,'battery:AA');assert.equal(rows[2].label.hidden,true);assert.equal(typeof rows[1].f.input.oninput,'function','newly created step search is bound');
 rows[1].f.search('Entkalkersalz');rows[1].f.keyDown('Enter');assert.equal(rows[1].f.selected.value,'material:salt','search remains functional after rebuilding rotation steps');
 const links=p.readStepMaterials({getAll:form.values});assert.deepEqual(plain(links),{Reinigen:{kind:'material',id:'clean',quantity:1.5},Neu:{kind:'material',id:'salt',quantity:1},Batterien:{kind:'battery',id:'AA'}},'reordering steps preserves the right material quantities');
 rows[0].f.remove.onclick();assert.equal(rows[0].f.caption.textContent,'Allgemeine Auswahl');assert(!Object.hasOwn(p.readStepMaterials({getAll:form.values}),'Reinigen'),'removing a step link restores general inheritance');
}
console.log('PASS: Material-Suche für Aufgaben und Rotation, Auswahl/Entfernen, bestehende/fehlende IDs, Mengen, Vererbung, Tastatur und Escaping.');
