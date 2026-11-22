const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path'),{execFileSync}=require('node:child_process');
const root=path.join(__dirname,'..');let Panel;const ctx=vm.createContext({HTMLElement:class{},customElements:{get:()=>null,define:(_,c)=>Panel=c}});
vm.runInContext(fs.readFileSync(path.join(root,'custom_components/ha_wartung/frontend/panel.js'),'utf8'),ctx);
const normalize=vm.runInContext('batteryType',ctx),legacy=value=>value.replace(/^\d+\s*[×x]\s*/,'').replace(/^CR123A.*$/i,'CR123A').replace(/^9\s*V$/i,'9V').trim();
for(const prefix of ['',' ','2 × ','3x',' 2x'])for(const type of ['AA','AAA (Lithium)','CR123A Lithium','cr123a','9 V','9V',''])for(const suffix of ['',' ','\n']){const input=prefix+type+suffix;assert.equal(normalize(input),legacy(input),JSON.stringify(input));}
const defaults=JSON.parse(execFileSync('python3',['-c',"import sys,json;sys.path.insert(0,'custom_components/ha_wartung');import engine;print(json.dumps({'categories':engine.DEFAULT_DEVICE_CATEGORIES,'events':engine.DEFAULT_EVENT_TYPES}))"],{cwd:root,encoding:'utf8'}));
assert.equal(JSON.stringify(vm.runInContext('deviceCategories',ctx)),JSON.stringify(defaults.categories));
const panel=Object.create(Panel.prototype);panel.data={settings:{}};assert.equal(JSON.stringify(panel.eventTypes()),JSON.stringify(defaults.events));assert.equal(vm.runInContext('UI_UPCOMING_DAYS',ctx),14);
console.log('PASS: Batterie-Normalisierung bleibt unverändert; Browser- und Backend-Standardkategorien/Ereignisarten stimmen überein.');
