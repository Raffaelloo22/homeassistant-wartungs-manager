const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {fixture}=require('./test_frontend_cleanup.cjs');
const source=fs.readFileSync(path.join(__dirname,'../custom_components/ha_wartung/frontend/panel.js'),'utf8');
let Panel;
vm.runInNewContext(source,{URL,setTimeout,HTMLElement:class{},FormData:class{constructor(form){return new Map([...form.values].filter(([name])=>!form.controls.find(control=>control.name===name)?.disabled));}},customElements:{get:()=>null,define:(_,value)=>Panel=value},crypto:{randomUUID:()=> 'test-id'}});
const plain=value=>JSON.parse(JSON.stringify(value)),HELPER='input_number.batterien_schwellwert',OTHER='input_number.other_limit';
function form(kind,values){
 const map=new Map(values),names=kind==='currency'?['currency']:kind==='helper'?['battery_threshold_entity']:['enabled','notification_frequency','weekday','monthday','time'];
 const controls=names.map(name=>({name,type:name==='enabled'?'checkbox':name==='monthday'?'number':'text',disabled:false,matches:()=>true,get value(){return map.get(name)||'';},set value(value){map.set(name,String(value));},get checked(){return map.has(name);},set checked(value){if(value)map.set(name,'on');else map.delete(name);}}));
 const reset={type:'reset',hidden:true,disabled:false},status={},rows=['weekly','monthly'].map(frequency=>({dataset:{notificationFrequency:frequency},hidden:false,querySelectorAll:()=>controls.filter(control=>control.name===(frequency==='weekly'?'weekday':'monthday'))}));
 return {dataset:{settingsForm:kind},values:map,controls,reset,status,rows,querySelectorAll:selector=>selector==='[data-notification-frequency]'?rows:controls,querySelector:selector=>selector==='[type=reset]'?reset:selector==='[data-settings-status]'?status:selector==='[name=notification_frequency]'?controls.find(control=>control.name==='notification_frequency'):null};
}
function setup(){
 const {p}=fixture();Object.setPrototypeOf(p,Panel.prototype);p.tab='settings';p.data.timezone='Europe/Zurich';p.data.revision=5;
 p.data.settings={...p.data.settings,currency:'CHF',enabled:false,weekday:0,time:'09:00'};
 p._hass={states:{[HELPER]:{state:'20',attributes:{min:0,max:100,step:1}},[OTHER]:{state:'35',attributes:{min:0,max:100,step:1}}}};
 const currency=form('currency',[['currency','CHF']]),helper=form('helper',[['battery_threshold_entity',HELPER]]),schedule=form('schedule',[['notification_frequency','weekly'],['weekday','0'],['monthday','1'],['time','09:00']]);
 const forms={currency,helper,schedule},input={value:'20',disabled:false},hint={},output={},info={};let draws=0,flushes=0,helperChecks=0;
 p.shadowRoot={activeElement:null,querySelectorAll:selector=>selector==='[data-settings-form]'?Object.values(forms):[],querySelector:selector=>selector==='#battery-threshold-input'?input:selector==='#battery-threshold-hint'?hint:selector==='#battery-threshold-output'?output:selector==='#battery-threshold-helper'?info:null};
 p.draw=()=>draws++;p.scheduleBackgroundFlush=()=>flushes++;p.ensureBatteryThresholdHelper=async()=>helperChecks++;
 const backend=plain(p.data),writes=[];p.api=async(action,payload)=>{
  if(action==='get')return plain(backend);
  assert(['preferences','settings'].includes(action));assert.equal(payload.revision,backend.revision,'each queued write uses the current server revision');
  writes.push({action,payload:plain(payload)});Object.assign(backend.settings,payload.value);backend.revision++;return {revision:backend.revision};
 };
 function edit(kind,name,value){const control=forms[kind].controls.find(control=>control.name===name);if(control.type==='checkbox')control.checked=value;else control.value=value;p.shadowRoot.activeElement=control;forms[kind].oninput();return control;}
 function blur(kind,control,next=null){p.shadowRoot.activeElement=next;return forms[kind].onfocusout({target:control,relatedTarget:next});}
 p.bindInlineSettingsForms();
 return {p,forms,currency,helper,schedule,input,hint,output,info,backend,writes,edit,blur,draws:()=>draws,flushes:()=>flushes,helperChecks:()=>helperChecks};
}
(async()=>{
 {
  const {p,writes}=setup(),before=plain(p.data),card=p.generalSettingsCard(p.data),all=p.settingsView(p.data);
  assert(card.includes('<h2>Allgemeine Einstellungen</h2>'));assert.equal((card.match(/data-settings-form=/g)||[]).length,3);
  assert(card.indexOf('data-settings-form="currency"')<card.indexOf('<h3>Batteriewarnung</h3>'));
  assert(card.indexOf('<h3>Batteriewarnung</h3>')<card.indexOf('name="battery_threshold_entity"'),'helper selection belongs under battery warning');
  assert(!card.includes('type="submit"')&&!card.includes('>Speichern<'));
  assert(card.includes('<h3>Meldung innerhalb Home Assistant</h3>')&&!card.includes('Wochenmeldung'));
  for(const text of ['Täglich','Wöchentlich','Monatlich','name="monthday"','min="1" max="31"','letzten Tag des Monats','Europe/Zurich','Testmeldung anzeigen'])assert(card.includes(text),text);
  assert(all.includes('id="battery-threshold-input"')&&!all.includes('data-action="preferences"')&&!all.includes('data-action="schedule"'));
  assert.equal(writes.length,0);assert.deepEqual(plain(p.data),before,'rendering defaults and binding controls is read-only');
 }
 {
  const {p,currency,writes,edit,blur,draws}=setup();
  assert.equal(p.backgroundBusy(),false);const control=edit('currency','currency','CHF');
  assert.equal(p.backgroundBusy(),true,'focused fields still protect background updates');await blur('currency',control);
  assert.equal(writes.length,0,'leaving an unchanged field or switching tabs never writes');assert.equal(draws(),0);assert.equal(p.backgroundBusy(),false);
  const next={name:'next-field'};edit('currency','currency',' eur ');await blur('currency',control,next);
  assert.deepEqual(writes,[{action:'preferences',payload:{revision:5,value:{currency:'EUR'}}}]);
  assert.equal(p.data.settings.currency,'EUR');assert.equal(currency.controls[0].value,'EUR');assert.equal(p.shadowRoot.activeElement,next);
  assert.equal(draws(),0,'automatic saves do not rebuild the form or steal the next click');assert(currency.controls.every(control=>!control.disabled));
 }
 {
  const {p,schedule,writes,edit,blur}=setup(),frequency=schedule.controls.find(control=>control.name==='notification_frequency');
  assert.equal(schedule.rows.find(row=>row.dataset.notificationFrequency==='weekly').hidden,false);assert.equal(schedule.rows.find(row=>row.dataset.notificationFrequency==='monthly').hidden,true);
  edit('schedule','notification_frequency','daily');assert.equal(writes.length,0,'a selection alone does not save before blur');assert(schedule.rows.every(row=>row.hidden));await blur('schedule',frequency);
  let control=edit('schedule','time','10:15');await blur('schedule',control);
  edit('schedule','notification_frequency','monthly');await blur('schedule',frequency);assert.equal(schedule.rows[1].hidden,false);assert.equal(schedule.rows[0].hidden,true);
  control=edit('schedule','monthday','31');await blur('schedule',control);
  edit('schedule','notification_frequency','weekly');await blur('schedule',frequency);
  assert.deepEqual(writes.map(write=>write.payload.value),[{notification_frequency:'daily'},{time:'10:15'},{notification_frequency:'monthly'},{monthday:31},{notification_frequency:'weekly'}]);
  assert.equal(p.data.settings.monthday,31,'switching modes preserves the other mode’s settings');assert.equal(schedule.rows[0].hidden,false);assert.equal(schedule.rows[1].hidden,true);
  control=edit('schedule','enabled',true);await blur('schedule',control);assert.deepEqual(writes.at(-1).payload.value,{enabled:true});
 }
 {
  const {p,backend,schedule,writes,edit,blur}=setup();delete p.data.settings.weekday;delete backend.settings.weekday;p.data.settings.notification_frequency=backend.settings.notification_frequency='daily';schedule.controls.find(control=>control.name==='notification_frequency').value='daily';p.bindInlineSettingsForms();
  const control=edit('schedule','notification_frequency','weekly');await blur('schedule',control);
  assert.deepEqual(writes[0].payload.value,{notification_frequency:'weekly',weekday:0},'explicitly choosing weekly records the visible weekday if the old data had none');
 }
 {
  const {p,currency,schedule,writes,edit,blur}=setup(),api=p.api;let release;
  p.api=async(action,payload)=>{if(action==='preferences')await new Promise(resolve=>release=resolve);return api(action,payload);};
  const first=blur('currency',edit('currency','currency','EUR'));await Promise.resolve();await Promise.resolve();
  const enabled=edit('schedule','enabled',true),second=blur('schedule',enabled),time=edit('schedule','time','08:30'),third=blur('schedule',time);
  assert(currency.controls.every(control=>!control.disabled)&&schedule.controls.filter(control=>control.name!=='monthday').every(control=>!control.disabled),'saving leaves subsequent fields usable');
  assert.equal(p.pending,true);release();assert.deepEqual(await Promise.all([first,second,third]),[true,true,true]);
  assert.deepEqual(writes.map(write=>write.payload.revision),[5,6,7]);assert.deepEqual(writes.map(write=>write.payload.value),[{currency:'EUR'},{enabled:true},{time:'08:30'}]);assert.equal(p.data.settings.time,'08:30');
 }
 {
  const {p,currency,writes,edit,blur}=setup(),api=p.api;let firstRelease,secondRelease;
  p.api=async(action,payload)=>{if(action==='preferences')await new Promise(resolve=>{if(payload.value.currency==='EUR')firstRelease=resolve;else secondRelease=resolve;});return api(action,payload);};
  const control=edit('currency','currency','EUR'),first=blur('currency',control);await Promise.resolve();await Promise.resolve();
  edit('currency','currency','USD');const second=blur('currency',control);firstRelease();await first;await Promise.resolve();
  assert.equal(p.inlineSettingsDrafts.currency.currency,'USD','an earlier response must retain newer input in the same field');assert.equal(currency.controls[0].value,'USD');
  secondRelease();await second;assert.equal(p.data.settings.currency,'USD');assert(!p.inlineSettingsDrafts.currency);assert.equal(writes.length,2);
 }
 {
  const {p,currency,writes,edit,blur}=setup(),api=p.api;p.api=async(action,payload)=>{if(action==='preferences')throw Error('Ungültige Währung.');return api(action,payload);};
  const control=edit('currency','currency','falsch');assert.equal(await blur('currency',control),false);
  assert.equal(p.inlineSettingsDrafts.currency.currency,'falsch');assert.equal(currency.controls[0].value,'falsch');assert(currency.status.className.includes('errors'));assert(currency.status.textContent.includes('Ungültige Währung'));assert.equal(p.backgroundBusy(),true);
  const requestCount=writes.length;assert.equal(blur('currency',control,currency.reset),undefined,'clicking discard skips the preceding autosave blur');currency.onreset({preventDefault(){}});
  assert(!p.inlineSettingsDrafts.currency);assert.equal(currency.controls[0].value,'CHF');assert.equal(writes.length,requestCount,'discard never commits the rejected draft');assert.equal(p.backgroundBusy(),false);
 }
 {
  const {p,helper,input,hint,info,writes,edit,blur}=setup();let services=0;p._hass.callService=async()=>services++;
  const control=edit('helper','battery_threshold_entity',OTHER);assert.equal(p.pendingBatteryHelperSelection(),true);assert.equal(input.disabled,true);assert(hint.textContent.includes('Verlasse das Feld'));
  await p.saveBatteryThreshold({value:'30'});assert.equal(services,0,'pending helper selection cannot write to the old helper');await blur('helper',control);
  assert.deepEqual(writes[0].payload.value,{battery_threshold_entity:OTHER});assert.equal(input.disabled,false);assert.equal(input.value,'35');assert(info.innerHTML.includes(OTHER));
  edit('helper','battery_threshold_entity',HELPER);blur('helper',control,helper.reset);helper.onreset({preventDefault(){}});assert.equal(input.disabled,false);assert.equal(control.value,OTHER);assert.equal(writes.length,1);
 }
 {
  const {p,backend,writes,edit,blur}=setup(),api=p.api;let conflict=true;
  p.api=async(action,payload)=>{if(action==='preferences'&&conflict){conflict=false;backend.settings.currency='EUR';backend.revision++;throw Error('Daten wurden geändert');}return api(action,payload);};
  const control=edit('currency','currency','USD');assert.equal(await blur('currency',control),false);assert.equal(p.data.revision,6);assert.equal(p.inlineSettingsDrafts.currency.currency,'USD');assert(p.inlineSettingsMessages.currency.text.includes('Verlasse das Feld erneut'));
  assert.equal(await blur('currency',control),true);assert.deepEqual(writes[0].payload,{revision:6,value:{currency:'USD'}});
 }
 console.log('PASS: Einstellungen speichern nur geänderte Felder beim Verlassen; Queue/Revision/Fokus, Fehlereingaben und Verwerfen bleiben sicher, Helfer und drei Meldungsintervalle korrekt.');
})().catch(error=>{console.error(error);process.exitCode=1;});
