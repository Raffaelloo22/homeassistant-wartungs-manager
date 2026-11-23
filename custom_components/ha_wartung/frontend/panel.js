const operationId = () => typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g,c=>(Number(c)^crypto.getRandomValues(new Uint8Array(1))[0]&15>>Number(c)/4).toString(16));
const E = value => String(value ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dateText = value => String(value??'').replace(/^(\d{4})-(\d{2})-(\d{2})$/,(_,y,m,d)=>`${d}.${m}.${y.slice(-2)}`).replace(/^(\d{4})-(\d{2})$/,(_,y,m)=>`${m}.${y.slice(-2)}`);
// Sort imprecise periods by their stated year/month without changing the displayed precision.
const historySortKey = log => {
  const raw=String(log.event_date||log.event_period||'').trim();
  let m=raw.match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/);
  if(m)return Number(m[1])*10000+Number(m[2]||0)*100+Number(m[3]||0);
  m=raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/);
  if(m)return Number(m[3].length===2?'20'+m[3]:m[3])*10000+Number(m[2])*100+Number(m[1]);
  const year=raw.match(/\b(\d{4})\b/);if(!year)return -1;
  const month=/ende/i.test(raw)?12:/mitte/i.test(raw)?6:/anfang/i.test(raw)?1:0;
  return Number(year[1])*10000+month*100;
};
const compareHistory = (a,b) => historySortKey(b)-historySortKey(a)||(Date.parse(b.recorded_at)||0)-(Date.parse(a.recorded_at)||0)||String(a.id).localeCompare(String(b.id));
const datesInText = value => String(value??'').replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g,(_,y,m,d)=>`${d}.${m}.${y.slice(-2)}`).replace(/\b(\d{2})\.(\d{2})\.(\d{4})\b/g,(_,d,m,y)=>`${d}.${m}.${y.slice(-2)}`);
const dateTimeText = value => new Date(value).toLocaleString('de-CH',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'});
const dateInputValue = (value,kind='date') => {
  const raw=String(value||'').trim();if(!raw)return '';
  let year,month,day=1;
  const iso=raw.match(kind==='month'?/^(\d{4})-(\d{2})$/:/^(\d{4})-(\d{2})-(\d{2})$/);
  if(iso){year=Number(iso[1]);month=Number(iso[2]);day=Number(iso[3]||1);}else{
    const short=raw.match(kind==='month'?/^(\d{2})\.(\d{2})$/:/^(\d{2})\.(\d{2})\.(\d{2})$/);
    if(!short)throw Error(kind==='month'?'Bitte den Monat als mm.yy eingeben.':'Bitte das Datum als dd.mm.yy eingeben.');
    const y=Number(short[kind==='month'?2:3]);year=y+(y>=70?1900:2000);month=Number(short[kind==='month'?1:2]);if(kind!=='month')day=Number(short[1]);
  }
  const test=new Date(Date.UTC(year,month-1,day));if(test.getUTCFullYear()!==year||test.getUTCMonth()!==month-1||test.getUTCDate()!==day)throw Error('Dieses Datum ist ungültig.');
  return `${year}-${String(month).padStart(2,'0')}`+(kind==='month'?'':`-${String(day).padStart(2,'0')}`);
};
const decimalInputText = value => String(value??'').replace(/[’']/g,'').replace(/,/g,'.').replace(/−/g,'-');
const batteryType = value => value.replace(/^\d+\s*[×x]\s*/,'').replace(/^CR123A.*$/i,'CR123A').replace(/^9\s*V$/i,'9V').trim();
const searchText = value => String(value??'').normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase().replace(/[ßẞ]/g,'ss').replace(/æ/g,'ae').replace(/œ/g,'oe').replace(/ø/g,'o').replace(/ł/g,'l').replace(/[đð]/g,'d').replace(/ı/g,'i').replace(/ae/g,'a').replace(/oe/g,'o').replace(/ue/g,'u').replace(/[^\p{L}\p{N}\s]/gu,'').replace(/\s+/g,' ').trim();
const errorMessage = error => {
  if(typeof error === 'string' && error.trim())return error;
  for(const value of [error?.message,error?.error?.message,error?.body?.message,error?.data?.message,error?.error]){
    if(typeof value === 'string' && value.trim())return value;
  }
  if(error?.code==='connection_lost'||error?.code==='not_connected')return 'Verbindung zu Home Assistant unterbrochen. Bitte kurz warten und erneut speichern. Deine Eingaben bleiben erhalten.';
  return 'Die Änderung konnte nicht gespeichert werden. Bitte die Verbindung prüfen und erneut versuchen. Deine Eingaben bleiben erhalten.';
};
const S = {no_due:'Ohne Fälligkeit',planning:'Einplanen',overdue:'Überfällig',due:'Fällig',soon:'Bald fällig',scheduled:'Geplant',measurement_pending:'Messwert ausstehend',ok:'In Ordnung',archived:'Archiviert',on_demand:'Nach Geräteanzeige'};
const UI_UPCOMING_DAYS=14; // Dashboard filter and groups; backend/digest keeps its seven-day window.
const deviceCategories=['Haushalt','Heizung','Internet und WLAN','Netzwerk & Büro','Fahrzeuge','Garten','Licht','Beschattung','Gefahrenmelder','Tür- und Fenstermelder','Bewegungsmelder','Temperatursensoren','Sensoren','Zutritt','Kameras','Audio und Medien','Buttons','Smart Home'];
const order = {overdue:0,due:1,soon:2,planning:3,measurement_pending:4,scheduled:5,ok:6,archived:7,on_demand:8};
class WartungPanel extends HTMLElement {
  constructor(){super();this.attachShadow({mode:'open'});this.tab='tasks';this.query='';this.logQuery='';this.logYearFilter='';this.taskQuery='';this.inventoryQuery='';this.inventoryLayout='cards';this.taskPeriod='now';this.area='';this.categoryFilter='';this.selected=null;this.pending=false;this.deviceMode='active';}
  set hass(value){this._hass=value;if(this.isConnected&&!this.data&&!this.loading)this.boot();else if(this.data){this.syncBatteryThresholdControl();if(!value.states?.[this.batteryThresholdEntity()])void this.ensureBatteryThresholdHelper();this.updateBatteryBadges();this.updateBatteryWarnings();this.updateDeviceStatuses();this.updateBatteryTaskStructure();this.updateRuleSensorValue();}}
  connectedCallback(){if(this._hass&&!this.data)this.boot();this.timer=setInterval(()=>this.refresh(),60000);}
  disconnectedCallback(){clearInterval(this.timer);clearTimeout(this.backgroundTimer);clearTimeout(this.undoTimer);this.undoEntry=null;}
  async api(action,payload={}){return this._hass.callWS({type:'ha_wartung/request',action,payload});}
  async boot(){this.loading=true;try{[this.data,this.reg]=await Promise.all([this.api('get'),this.api('registry')]);this.draw();void this.ensureBatteryThresholdHelper();}catch(e){this.shadowRoot.innerHTML='<p role="alert">'+E(errorMessage(e))+'</p>';}finally{this.loading=false;}}
  backgroundBusy(){
    const root=this.shadowRoot,active=root.activeElement;
    return !!(this.dialogOpen||this.pending||this.inlineSettingsSaving||this.tab==='settings'&&Object.keys(this.inlineSettingsDrafts||{}).length||this.thresholdSaving||root.querySelector('.task-menu[open], .dragging')||active&&(active.matches?.('input,select,textarea,[contenteditable="true"]')));
  }
  scheduleBackgroundFlush(){if(this.backgroundDeferred){clearTimeout(this.backgroundTimer);this.backgroundTimer=setTimeout(()=>this.flushBackgroundUpdates(),0);}}
  flushBackgroundUpdates(){if(this.backgroundDeferred&&!this.backgroundBusy())return this.refresh();}
  updateBatteryTaskStructure(){
    const key=JSON.stringify(this.batteryTasks().map(v=>v.device_id));
    if(key===this.batteryTaskKey)return;
    if(this.backgroundBusy()){this.backgroundDeferred=true;return;}
    if(this.tab==='tasks'||this.tab==='devices'&&this.selected)this.body();
    this.batteryTaskKey=key;
  }
  async refresh(){
    if(this.refreshing)return;
    if(this.backgroundBusy()){this.backgroundDeferred=true;return;}
    this.refreshing=true;
    try{
      const next=await this.api('get');
      if(this.backgroundBusy()){this.backgroundDeferred=true;return;}
      if(next.revision<this.data.revision)return;
      this.backgroundDeferred=false;
      if(JSON.stringify(next)!==JSON.stringify(this.data)){this.data=next;this.syncFilterOptions();this.body();}
      this.updateBatteryBadges();this.updateBatteryWarnings();this.updateDeviceStatuses();this.updateBatteryTaskStructure();
    }catch(e){this.notice(errorMessage(e),true);}finally{this.refreshing=false;}
  }
  syncFilterOptions(){
    const devices=Object.values(this.data.devices),resolved=this.resolveCategory(this.categoryFilter);
    const categories=this.displayedCategories().filter(category=>devices.some(d=>!d.deleted_at&&this.category(d)===category));
    this.categoryFilter=categories.includes(resolved)?resolved:'';
    const areas=[...new Set(devices.map(d=>d.area).filter(Boolean))].sort();if(!areas.includes(this.area))this.area='';
    for(const [id,values,label,value] of [['categoryfilter',categories,'Alle Kategorien',this.categoryFilter],['area',areas,'Alle Bereiche',this.area]]){
      const select=this.shadowRoot.querySelector('#'+id);if(!select)continue;
      const html=[['',label],...values.map(v=>[v,v])].map(([v,text])=>`<option value="${E(v)}" ${v===value?'selected':''}>${E(text)}</option>`).join('');
      if(select.innerHTML!==html)select.innerHTML=html;select.value=value;
    }
    this.syncLogYearFilter();
  }
  logEntries(){return Object.values(this.data.logs||{}).filter(log=>!log.deleted_at&&this.data.devices[log.device_id]&&!['purchase','note'].includes(log.kind));}
  logEventYear(log){const key=historySortKey(log);return key<0?'unknown':String(Math.floor(key/10000));}
  logYearOptions(){
    const years=[...new Set(this.logEntries().map(log=>this.logEventYear(log)))];
    return [['','Alle Jahre'],...years.filter(year=>year!=='unknown').sort((a,b)=>Number(b)-Number(a)).map(year=>[year,year]),...(years.includes('unknown')?[['unknown','Unbekannt']]:[])];
  }
  syncLogYearFilter(){
    const options=this.logYearOptions();if(!options.some(([year])=>year===this.logYearFilter))this.logYearFilter='';
    const select=this.shadowRoot.querySelector('#logyear');if(!select)return;
    const html=options.map(([year,label])=>`<option value="${E(year)}" ${year===this.logYearFilter?'selected':''}>${E(label)}</option>`).join('');
    if(select.innerHTML!==html)select.innerHTML=html;select.value=this.logYearFilter;
  }
  captureBodyState(){
    const main=this.shadowRoot.querySelector('.main'),el=this.shadowRoot.querySelector('#body');
    const active=this.shadowRoot.activeElement,focus=el?.contains?.(active)&&active?.dataset?.action?{action:active.dataset.action,id:active.dataset.id||''}:null;
    return {top:main?.scrollTop||0,left:main?.scrollLeft||0,focus,open:[...(el?.querySelectorAll('details[open]')||[])].map(detail=>this.disclosureKey(detail)).filter(Boolean)};
  }
  disclosureKey(detail){return detail.getAttribute('data-preserve-key')||(detail.classList.contains('settings-categories')?'categories':detail.classList.contains('settings-event-types')?'event-types':detail.classList.contains('settings-data-check')?'data-check':null);}
  restoreBodyState(state){
    for(const detail of this.shadowRoot.querySelector('#body')?.querySelectorAll('details')||[]){const key=this.disclosureKey(detail);if(key)detail.open=state.open.includes(key);}
    if(state.focus)[...(this.shadowRoot.querySelector('#body')?.querySelectorAll('button[data-action]')||[])].find(button=>button.dataset.action===state.focus.action&&(button.dataset.id||'')===state.focus.id)?.focus({preventScroll:true});
    const main=this.shadowRoot.querySelector('.main');if(main){main.scrollTop=state.top;main.scrollLeft=state.left;}
  }
  notice(message,error=false){const el=this.shadowRoot.querySelector('#notice');if(el){el.textContent=message;el.className=error?'error':'success';}}
  async change(action,payload={}){if(this.pending)return;this.pending=true;try{const r=await this.api(action,{revision:this.data.revision,...payload});this.close();if(['complete','battery_replacement'].includes(action))this.offerCompletionUndo(r.id);this.data=await this.api('get');this.draw();this.notice('Gespeichert.');return r;}catch(e){let message=errorMessage(e);if(/Zwischenzeitlich geändert|Daten wurden geändert/.test(message)){try{this.data=await this.api('get');message='Die Daten wurden zwischenzeitlich geändert. Deine Eingaben bleiben erhalten. Bitte prüfe sie und klicke erneut auf Speichern.';}catch{}}this.notice(message,true);const d=this.shadowRoot.querySelector('dialog .errors');if(d)d.textContent=message;throw new Error(message);}finally{this.pending=false;}}
  offerCompletionUndo(id){
    clearTimeout(this.undoTimer);this.undoEntry={id,expires:Date.now()+30000};this.renderCompletionUndo();
    this.undoTimer=setTimeout(()=>this.clearCompletionUndo(id),30000);
  }
  clearCompletionUndo(id){if(this.undoEntry?.id!==id)return;clearTimeout(this.undoTimer);this.undoEntry=null;this.renderCompletionUndo();}
  renderCompletionUndo(){
    const el=this.shadowRoot.querySelector('#completion-undo');if(!el)return;
    const entry=this.undoEntry;if(entry&&entry.expires<=Date.now()){this.undoEntry=null;clearTimeout(this.undoTimer);}
    el.hidden=!this.undoEntry;el.innerHTML=this.undoEntry?`<span>Erledigung gespeichert.</span>${this.button('undocomplete','Rückgängig',this.undoEntry.id)}${this.button('dismissundo','×',this.undoEntry.id,'aria-label="Meldung schliessen"')}`:'';
  }
  button(action,label,id='',extra=''){return `<button data-action="${action}" data-id="${E(id)}" ${extra}>${E(label)}</button>`;}
  inventoryNotes(notes){return typeof notes==='string'&&notes.trim()?'<p class="inventory-notes small" style="white-space:pre-wrap;overflow-wrap:anywhere">'+E(notes)+'</p>':'';}
  safeShopUrl(raw){
    if(typeof raw!=='string')return '';
    const value=raw.trim();
    if(!value||value.length>2048||/[\\\s\u0000-\u001f\u007f]/u.test(value)||!/^https?:\/\//i.test(value))return '';
    try{
      const url=new URL(value),host=url.hostname,authority=value.match(/^https?:\/\/([^/?#]*)/i)?.[1]||'';
      if(!['http:','https:'].includes(url.protocol)||url.username||url.password||authority.includes('@')||!host||url.port&&Number(url.port)<1)return '';
      if(!host.startsWith('[')&&(host.length>254||!host.replace(/\.$/,'').split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))))return '';
      return value;
    }catch{return '';}
  }
  shopLink(raw,name){
    const url=this.safeShopUrl(raw);return url?'<a class="shop-link" href="'+E(url)+'" target="_blank" rel="noopener noreferrer" aria-label="'+E('Shop für '+name+' öffnen (neuer Tab)')+'">Shop <span aria-hidden="true">↗</span></a>':'';
  }
  shopField(value=''){return this.field('shop_url','Shop-Link (optional)',value,'url').replace('type="url"','type="url" maxlength="2048" autocomplete="url"');}
  shopFormValue(form){
    if(!form.has('shop_url'))return {};
    const value=String(form.get('shop_url')??'').trim();
    if(value&&!this.safeShopUrl(value))throw Error('Bitte einen gültigen Shop-Link mit http:// oder https:// ohne Zugangsdaten eingeben.');
    return {shop_url:value};
  }
  shoppingShopUrl(item){return item.battery_type?this.data.settings?.battery_shop_urls?.[item.battery_type]:this.data.settings?.consumables?.[item.consumable_id]?.shop_url;}
  inventoryItems(){
    const settings=this.data.settings||{},devices=ids=>[...new Set(ids)].map(id=>this.data.devices[id]).filter(device=>device&&!device.deleted_at);
    return [
      ...this.batteryInventory().map(row=>({kind:'battery',id:row.type,name:row.type+' Batterie',quantity:row.quantity,unit:'Stück',threshold:settings.battery_inventory_thresholds?.[row.type]??1,notes:settings.battery_notes?.[row.type],shop_url:settings.battery_shop_urls?.[row.type],devices:row.devices})),
      ...Object.values(settings.consumables||{}).map(material=>({...material,kind:'material',devices:devices(material.device_ids||[])}))
    ];
  }
  inventoryMatches(item){return this.searchWordsMatch(this.inventoryQuery||'',[item.name,item.id,item.unit,item.notes,this.safeShopUrl(item.shop_url),...item.devices.flatMap(device=>[device.name,device.area,device.manufacturer,device.model])]);}
  inventoryUsage(item){
    if(item.kind!=='battery')return this.usageDeviceLinks(item.devices.map(device=>device.id),{inventory:true,key:item.id});
    return '<details class="small inventory-usage" data-preserve-key="battery-usage:'+E(item.id)+'"><summary><span class="inventory-usage-desktop">Geräte anzeigen</span><span class="inventory-usage-mobile">'+item.devices.length+' Gerät'+(item.devices.length===1?'':'e')+'</span></summary><div class="usage-device-tags">'+(item.devices.map(device=>this.button('record',this.batteryUsageDeviceLabel(device,item.id),device.id)).join('')||'Kein aktives Gerät zugeordnet')+'</div></details>';
  }
  inventoryCard(item){
    const battery=item.kind==='battery',meta=battery?'Benötigt für '+item.devices.length+' Gerät(e)':E(item.unit)+' · Nachkaufen ab '+E(item.threshold);
    return '<div class="row inventory-item"><div class="info"><strong>'+E(item.name)+'</strong><div class="meta'+(battery?' inventory-device-count':'')+'">'+meta+'</div>'+this.inventoryUsage(item)+this.inventoryNotes(item.notes)+'</div>'+this.inventoryControls(item.kind,item.id,item.quantity,battery?item.id:item.name,item.unit,{shopUrl:item.shop_url})+'</div>';
  }
  inventoryListRow(item){
    const devices=item.devices.map(device=>device.name).join(', ')||'—';
    return '<div class="row inventory-list-row" role="listitem"><div class="inventory-list-stock"><strong'+(item.quantity<0?' class="inventory-stock-low"':'')+'>'+E(item.quantity??'?')+'</strong><span class="small sub">'+E(item.unit)+'</span></div>'+this.button(item.kind==='battery'?'editbatterytype':'material',item.name,item.id,'type="button" class="inventory-list-name" aria-label="'+E(item.name+' bearbeiten')+'" aria-haspopup="dialog"')+'<span class="inventory-list-devices sub">'+E(devices)+'</span></div>';
  }
  syncInventoryToolbar(count,list){
    const counter=this.shadowRoot.querySelector('#inventory-count');if(counter&&counter.textContent!==count)counter.textContent=count;
    for(const layout of ['cards','list'])this.shadowRoot.querySelector('#inventory-layout [data-id="'+layout+'"]')?.setAttribute('aria-pressed',String(list===(layout==='list')));
  }
  inventoryView(){
    const items=this.inventoryItems(),rows=items.filter(item=>this.inventoryMatches(item)),list=this.inventoryLayout==='list',query=!!this.inventoryQuery?.trim();
    const count=query?rows.length+' von '+items.length+' Artikeln':items.length+' Artikel';
    this.syncInventoryToolbar(count,list);
    let html=list?'':'<p class="sub inventory-intro" style="max-width:none">Verbrauchsmaterial: Neue Artikel starten mit Bestand 1. Negative Bestände zeigen fehlende Mengen an.</p>';
    if(list){
      for(const [kind,label] of [['battery','Batterien'],['material','Weitere Verbrauchsmaterialien']]){const group=rows.filter(item=>item.kind===kind);if(group.length)html+='<section class="inventory-list-group"><h3>'+label+'<span class="tag count-tag">'+group.length+'</span></h3><div class="inventory-list" role="list" aria-label="'+label+'">'+group.map(item=>this.inventoryListRow(item)).join('')+'</div></section>';}
    }else{
      html+='<div class="inventory-add-actions">'+this.button('addbatterytype','Batterietyp hinzufügen')+'</div><div class="device-grid">'+rows.filter(item=>item.kind==='battery').map(item=>this.inventoryCard(item)).join('')+'</div>';
      html+='<div class="inventory-add-actions">'+this.button('material','Weiteres Verbrauchsmaterial hinzufügen')+'</div><div class="device-grid">'+rows.filter(item=>item.kind==='material').map(item=>this.inventoryCard(item)).join('')+'</div>';
    }
    if(!rows.length)html+='<p class="inventory-empty" role="status">'+(query?'Keine passenden Artikel. Passe die Suche an oder lösche den Suchbegriff.':'Noch kein Verbrauchsmaterial erfasst.')+'</p>';
    const missing=Object.values(this.data.devices).filter(device=>!device.deleted_at&&!this.archived(device)&&device.battery_type&&/nicht dokumentiert|zu klären|unbekannt/i.test(device.battery_type)&&this.searchWordsMatch(this.inventoryQuery||'',[device.name,device.battery_type]));
    if(!list&&missing.length)html+='<h3>Batterietyp noch offen</h3><p class="small">'+missing.map(device=>this.button('record',device.name,device.id)).join(' ')+'</p>';
    return html;
  }
  inventoryControls(kind,id,quantity,name,unit='Stück',options={}){
    const battery=kind==='battery';
    const stock=this.button(battery?'batterystock':'materialstock',quantity??'?',id,'class="stock-quantity stock-edit '+(quantity<0?'due':'')+'" aria-label="'+E(name+': Bestand '+(quantity??'unbekannt')+' '+unit+' ändern')+'" title="Bestand ändern"');
    const edit=this.button(battery?'editbatterytype':'material','Bearbeiten',id);
    return '<div class="inventory-controls">'+stock+'<div class="actions inventory-actions" role="group" aria-label="'+E('Aktionen für '+name)+'">'+this.shopLink(options.shopUrl,name)+this.button('requestpurchase','Nachkaufen',kind+':'+id,'class="inventory-purchase"')+'<span class="inventory-desktop-actions">'+edit+'</span><details class="task-menu inventory-menu"><summary aria-label="'+E('Weitere Aktionen für '+name)+'" title="Weitere Aktionen">⋯</summary><div class="task-menu-actions" role="group" aria-label="Weitere Aktionen">'+edit+'</div></details></div></div>';
  }
  tabButton(id,label){
    const paths={
      tasks:'<path d="m3 6 2 2 4-4m-6 12 2 2 4-4M12 6h9M12 16h9"/>',
      devices:'<rect x="3" y="3" width="18" height="13" rx="2"/><path d="M8 21h8m-4-5v5"/>',
      batteries:'<path d="m3 7 9-4 9 4v10l-9 4-9-4ZM3 7l9 4 9-4m-9 4v10M7.5 5l9 4"/>',
      log:'<path d="M3 11a9 9 0 1 1 2.7 7M3 4v7h7m2-4v5l3 2"/>',
      settings:'<path d="m9.5 3-.5 2.2-1.5.9-2.2-.6-2 3.5L5 10.6v2.8L3.3 15l2 3.5 2.2-.6 1.5.9.5 2.2h5l.5-2.2 1.5-.9 2.2.6 2-3.5-1.7-1.6v-2.8L20.7 9l-2-3.5-2.2.6-1.5-.9-.5-2.2Z"/><circle cx="12" cy="12" r="3.2"/>'
    };
    return `<button data-action="tab" data-id="${E(id)}" aria-label="${E(label)}" title="${E(label)}" aria-current="${this.tab===id?'page':'false'}"><svg class="tab-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[id]||''}</svg><span>${id==='batteries'?'Verbrauchs&shy;material':id==='settings'?'Einstel&shy;lungen':E(label)}</span></button>`;
  }
  archived(d){return !!(d.archived||d.archived_at);}
  draw(){
    if(!this.data)return;this.categoryFilter=this.resolveCategory(this.categoryFilter);this.syncLogYearFilter();
    const root=this.shadowRoot;
    root.innerHTML=`<style>
      :host{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--primary-text-color,#203646);background:var(--primary-background-color,#f5f8fa);font-family:var(--primary-font-family,Arial,sans-serif);font-size:14px;line-height:1.4}
      *{box-sizing:border-box}header{flex:none;padding:12px 20px 0;background:var(--card-background-color,#fff);border-bottom:1px solid var(--divider-color,#d7e0e5)}h1{font-size:22px;line-height:1.25;margin:0;font-weight:650}h2{font-size:17px;margin:16px 0 8px}h3{font-size:15px;margin:10px 0 6px}p{line-height:1.45;margin:6px 0;max-width:78ch}.sub{color:var(--secondary-text-color,#526875)}nav{display:flex;gap:3px;flex-wrap:wrap;margin-top:8px}
      button{font:inherit;font-size:13px;line-height:1.25;cursor:pointer;border:1px solid var(--divider-color,#b9cbd4);border-radius:5px;padding:5px 9px;min-height:28px;background:var(--card-background-color,#fff);color:inherit}button:hover{border-color:var(--primary-color,#24788c);background:var(--secondary-background-color,#edf4f6)}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,summary:focus-visible{outline:2px solid var(--primary-color,#24788c);outline-offset:2px}button[aria-current="page"],.primary{background:var(--primary-color,#24788c);color:var(--text-primary-color,#fff);border-color:var(--primary-color,#24788c)}nav button{border:0;border-radius:5px 5px 0 0;padding:7px 10px;min-height:32px}
      .toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 20px}.toolbar .searchbox{display:flex;align-items:center;gap:4px;flex:1;min-width:160px;max-width:640px}.searchbox input{flex:1;min-width:0;width:100%}.searchbox button{flex:none;font-size:21px;line-height:1;padding:3px 8px}.searchbox input::-webkit-search-cancel-button{display:none}.main{flex:1;min-height:0;overflow:auto}#body{padding:0 20px 24px}input,select,textarea{font:inherit;color:inherit;background:var(--card-background-color,#fff);border:1px solid var(--divider-color,#b9cbd4);border-radius:5px;padding:6px 8px;max-width:100%;min-height:32px}textarea{min-height:72px;resize:vertical}label{display:flex;flex-direction:column;gap:4px;margin:8px 0}label.check{flex-direction:row;align-items:center}.split{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:20px}.split>section{min-width:0}.record-layout{grid-template-columns:minmax(260px,.8fr) minmax(0,1.4fr)}
      .date-input{display:flex;gap:4px;align-items:center}.date-input>input{min-width:0;width:100%}.date-calendar{position:relative;display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;flex:none;border:1px solid var(--divider-color,#b9cbd4);border-radius:5px}.date-calendar input{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer}.date-calendar:focus-within{outline:2px solid var(--primary-color,#24788c)}
      .row{padding:8px 0;border-bottom:1px solid var(--divider-color,#d7e0e5);display:flex;gap:10px;align-items:center;justify-content:space-between}.row .info{min-width:0;flex:1}.row strong{font-weight:600}.row .meta{margin:3px 0;color:var(--secondary-text-color,#526875);font-size:12px}.actions{display:flex;gap:4px;flex-wrap:wrap;align-items:center}.row>.actions{justify-content:flex-end}.record-layout .row{flex-direction:column;align-items:stretch}.record-layout .row>.actions{max-width:none;justify-content:flex-start}.record-layout .row .info{width:100%}.tag{display:inline-block;padding:2px 6px;border-radius:4px;font-size:11px;line-height:1.35;background:#e3edf2;color:#294f60;white-space:nowrap}.overdue,.due{background:#fae3e3;color:#9e2929}.soon,.planning{background:#f5eccc;color:#71500b}.ok{background:#def0e4;color:#23643d}.measurement_pending{background:#e7e5f5;color:#514a80}.booked{display:inline-block;margin-left:8px;font-size:12px}.empty{padding:14px;border:1px dashed var(--divider-color,#b9cbd4);border-radius:5px}.error{color:var(--error-color,#b33b3b);padding:6px 20px}.success{color:var(--success-color,#277454);padding:6px 20px}#notice:empty,.errors:empty{display:none}.fields{display:grid;grid-template-columns:1fr 1fr;gap:0 12px}
      dialog{width:min(640px,calc(100vw - 24px));max-height:90vh;overflow:auto;border:1px solid var(--divider-color,#a6bbc6);border-radius:8px;padding:16px;background:var(--card-background-color,#fff);color:inherit;font:inherit}dialog::backdrop{background:#112b4470}dialog .footer{display:flex;justify-content:flex-end;padding:12px 0 4px}dialog h2{margin-top:0}.errors{color:var(--error-color,#b33b3b)}a{color:var(--primary-color,#24788c)}.small{font-size:12px}.question{padding:8px 0;border-bottom:1px solid var(--divider-color,#d7e0e5)}.bulkrow{display:grid;grid-template-columns:auto 1fr 1fr;gap:8px;align-items:center;padding:6px 0}.bulkrow label{margin:0}
      .history-row{display:grid;grid-template-columns:100px max-content minmax(0,1fr) auto;gap:8px;align-items:baseline;padding:7px 0;border-bottom:1px solid var(--divider-color,#d7e0e5)}.history-date{font-size:12px;font-weight:600;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.history-text{min-width:0;overflow-wrap:anywhere}.history-note{white-space:pre-line}.history-cost{font-size:12px;white-space:nowrap;color:var(--secondary-text-color,#526875);margin-left:6px}.history-detail summary{cursor:pointer;overflow-wrap:anywhere}.history-detail[open] summary{margin-bottom:5px;color:var(--secondary-text-color,#526875)}.history-detail p{white-space:pre-line}.history-row>button{padding:3px 7px;min-height:26px}.edit-meta{border-top:1px solid var(--divider-color,#d7e0e5);padding-top:8px;margin-top:10px}.task-note{margin-top:4px}.task-note summary{cursor:pointer;color:var(--secondary-text-color,#526875);font-size:12px}.task-note p{font-size:12px}.device-summary{display:flex;gap:6px 14px;flex-wrap:wrap;margin:5px 0 10px;color:var(--secondary-text-color,#526875);font-size:12px}[hidden]{display:none!important}
      .task-tile,.history-row,.row{border:1px solid var(--divider-color,#d7e0e5);border-radius:6px;background:var(--card-background-color,#fff);margin:6px 0;padding:7px 10px}
      .task-tile{display:flex;align-items:center;gap:6px 12px;flex-wrap:wrap}.task-name{flex:1 1 150px;min-width:0;font-weight:600;overflow-wrap:anywhere}.task-device{flex:1 1 160px;min-width:0;font-size:12px;color:var(--secondary-text-color,#526875);overflow-wrap:anywhere}.task-area{font-size:11px}.task-due{display:flex;align-items:center;gap:5px;flex-wrap:wrap}.task-due .booked{margin:0;white-space:nowrap}.task-tile>.actions{flex:none;margin-left:auto;justify-content:flex-end}.task-details{font-size:12px;color:var(--secondary-text-color,#526875)}.task-details summary{cursor:pointer;padding:4px 0}.task-details[open]{flex:1 0 100%;border-top:1px solid var(--divider-color,#d7e0e5);padding-top:4px}.task-details p{white-space:pre-line;max-width:none;margin:4px 0}.record-layout{grid-template-columns:1fr;gap:10px}.history-row{padding:6px 10px}.row .meta{margin-bottom:0}
      .device-name{display:inline;text-align:left;padding:0;min-height:0;border:0;border-radius:2px;background:transparent;color:var(--primary-color,#24788c);font-size:14px;font-weight:600;line-height:1.4;overflow-wrap:anywhere}.device-name:hover{background:transparent;text-decoration:underline;text-underline-offset:3px}
      .task-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;align-items:start}.task-grid>.task-tile{margin:0}.task-tile{display:flex;flex-direction:row;gap:7px;align-items:center;padding:9px 10px}.task-heading{display:flex;align-items:baseline;gap:5px 8px;flex-wrap:wrap;flex:1 0 100%;min-width:0}.task-device-name{font-weight:600;overflow-wrap:anywhere}.task-separator{color:var(--secondary-text-color,#526875)}.task-action{overflow-wrap:anywhere}.task-heading .task-due{display:inline-flex;gap:5px;align-items:baseline}.task-tile>.actions{margin-left:0;justify-content:flex-start;flex-wrap:wrap}.task-details{margin-left:auto}.task-details[open]{margin-left:0}.history-actions{display:flex;gap:4px;align-items:center}.history-actions button{min-height:26px;padding:3px 7px;font-size:12px}
      @media(max-width:850px){.task-grid{grid-template-columns:1fr}}
      @media(max-width:600px){.history-actions{grid-column:3;grid-row:1;flex-wrap:wrap;justify-content:flex-end}.history-actions button{min-height:28px}.task-heading{gap:5px}.history-row{grid-template-columns:85px minmax(0,1fr) auto}}
      .index-switch{display:inline-flex;margin:12px 0 4px;border:1px solid var(--divider-color,#b9cbd4);border-radius:6px;overflow:hidden}.index-switch button{border:0;border-radius:0;padding:6px 12px}.index-switch button+button{border-left:1px solid var(--divider-color,#b9cbd4)}.index-switch button[aria-pressed="true"]{background:var(--primary-color,#24788c);color:var(--text-primary-color,#fff)}.device-grid{column-count:2;column-fill:balance}.device-grid .row{break-inside:avoid;page-break-inside:avoid;margin:0 0 8px;align-items:center}.device-inline-status{font-size:12px;color:var(--secondary-text-color,#526875);line-height:1.5}.device-status{display:inline-flex;gap:4px;flex-wrap:wrap}.device-grid .device-status{flex:1 0 100%}.device-grid .row>div{min-width:0}.stock-quantity{display:inline-block;min-width:2ch;text-align:center;font-size:26px;font-weight:750;line-height:1.1;font-variant-numeric:tabular-nums;border-radius:4px;padding:2px 5px}.battery-level{flex:none;white-space:nowrap;align-self:center}.battery-low{background:#fae3e3;color:#9e2929}.device-summary .battery-level{font-size:11px}
      @media(max-width:760px){.device-grid{column-count:1}.device-grid .row{flex-wrap:nowrap}.device-grid .row>div{flex:1}.battery-level{font-size:11px}}
      @media(max-width:1000px){.record-layout{grid-template-columns:1fr}.row>.actions{max-width:50%}.history-row{grid-template-columns:100px max-content minmax(0,1fr) auto}}
      @media(max-width:600px){.task-tile{gap:6px 8px}.task-name{flex-basis:100%}.task-device{flex-basis:50%}.task-tile>.actions{justify-content:flex-start;margin-left:0;flex-wrap:wrap}header{padding:10px 12px 0}.toolbar{padding:8px 12px}#body{padding:0 12px 18px}.split,.fields{grid-template-columns:1fr;gap:12px}.row{align-items:flex-start;flex-wrap:wrap;gap:6px}.row>.actions{max-width:none}.row .info{flex-basis:100%}.actions{gap:5px}h1{font-size:20px}nav{gap:0}nav button{font-size:12px;padding:7px 8px}.history-row{grid-template-columns:88px minmax(0,1fr) auto;gap:5px 7px}.history-row>.tag{justify-self:start}.history-text{grid-column:1/-1;grid-row:2}.history-row>button{grid-column:3;grid-row:1}.bulkrow{grid-template-columns:auto 1fr}.bulkrow select{grid-column:2}.booked{margin-left:0;margin-top:4px;display:block}}
      @media(pointer:coarse){button,.history-row>button{min-height:36px}input,select{min-height:36px}}

      .stock-stepper{display:flex;align-items:center;justify-content:center;gap:16px;margin:22px 0}.stock-stepper>input{width:160px;min-width:0;text-align:center;font-size:44px;font-weight:750;line-height:1.2;border:0;background:transparent;font-variant-numeric:tabular-nums;appearance:textfield;-moz-appearance:textfield}.stock-stepper>input::-webkit-inner-spin-button,.stock-stepper>input::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}.stock-stepper>button{width:48px;min-height:48px;font-size:28px;line-height:1}
      :host{position:relative;isolation:isolate;--glass-border:color-mix(in srgb,var(--primary-text-color,#203646) 16%,transparent);--glass-surface:color-mix(in srgb,var(--card-background-color,#fff) 78%,transparent)}
      .main{background:radial-gradient(ellipse at 3% 5%,color-mix(in srgb,var(--primary-color,#24788c) 5%,transparent),transparent 58%),radial-gradient(ellipse at 92% 75%,color-mix(in srgb,var(--primary-color,#24788c) 3%,transparent),transparent 60%),color-mix(in srgb,var(--primary-background-color,#f5f8fa) 78%,#fff 22%)}
      header{background:var(--glass-surface);border-color:var(--glass-border)}
      .task-tile,.row,.history-row,.empty,.settings-sheet{background:var(--glass-surface);border-color:var(--glass-border);box-shadow:inset 0 1px 0 color-mix(in srgb,#fff 16%,transparent),0 2px 8px #00000006}
      @supports(backdrop-filter:blur(1px)){header,.toolbar,.task-tile,.row,.history-row,.empty,.settings-sheet,dialog,.task-menu-actions{backdrop-filter:blur(16px) saturate(115%);-webkit-backdrop-filter:blur(16px) saturate(115%)}}
      .toolbar{background:color-mix(in srgb,var(--card-background-color,#fff) 48%,transparent)}
      dialog,.task-menu-actions{background:color-mix(in srgb,var(--card-background-color,#fff) 94%,transparent);border-color:var(--glass-border)}
      input,select,textarea{background:color-mix(in srgb,var(--card-background-color,#fff) 86%,transparent)}
      .settings-sheet{border:1px solid var(--glass-border);border-radius:8px;padding:4px 16px 18px;margin-top:10px}
      .task-stand{font-size:12px;margin:3px 0 12px}.task-section{margin:0 0 22px}.task-section h2{display:flex;align-items:baseline;gap:9px;margin:0 0 8px;font-size:16px}.task-count{font-size:12px;font-weight:400;color:var(--secondary-text-color,#526875)}
      .task-grid{gap:8px}.task-tile{display:grid;grid-template-columns:minmax(0,1fr) 94px auto;gap:10px;align-items:center;padding:10px 12px;position:relative;overflow:visible}.task-tile:has(.task-menu[open]){z-index:4}.task-content{min-width:0}.task-title{line-height:1.5;overflow-wrap:anywhere}.task-title .device-name{font-size:14px}.task-deadline{display:flex;flex-direction:column;gap:2px;font-size:11px;color:var(--secondary-text-color,#526875);text-align:right;white-space:nowrap}.task-deadline strong{font-size:13px;font-weight:600;color:var(--primary-text-color,#203646);font-variant-numeric:tabular-nums}.task-deadline.is-overdue strong,.task-deadline.is-overdue>span{color:var(--error-color,#b33b3b)}
      .task-controls{display:flex;gap:5px;align-items:center;justify-content:flex-end}.task-primary{border-color:color-mix(in srgb,var(--primary-color,#24788c) 55%,transparent);font-weight:600}.task-menu{position:relative;flex:none}.task-menu>summary{list-style:none;cursor:pointer;width:28px;min-height:28px;display:flex;align-items:center;justify-content:center;border-radius:5px;font-size:22px;line-height:1}.task-menu>summary::-webkit-details-marker{display:none}.task-menu>summary:hover{background:var(--secondary-background-color,#edf4f6)}.task-menu-actions{position:absolute;right:0;top:calc(100% + 5px);z-index:8;display:flex;flex-direction:column;gap:3px;min-width:150px;max-width:min(320px,75vw);padding:6px;border:1px solid var(--glass-border);border-radius:7px;box-shadow:0 7px 22px #0003}.task-menu-actions>button{text-align:left;border-color:transparent;background:transparent}.task-menu-note{font-size:12px;padding:5px}.task-menu-note>summary{cursor:pointer}.task-menu-note p{white-space:pre-line;max-height:180px;overflow:auto;min-width:220px;font-size:12px}.task-empty{font-size:13px;color:var(--secondary-text-color,#526875);margin:4px 0}.shopping-reference{border-top:1px solid var(--glass-border);padding-top:12px}
      .category-order{max-width:760px;margin:10px 0}.category-order-row{display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--glass-border);padding:7px 0}.category-order-row>strong{flex:1;min-width:0;font-size:13px;font-weight:500}.category-drag{cursor:grab;font-size:22px;color:var(--secondary-text-color,#526875);padding:0 4px}.category-order-row.dragging{opacity:.45}.category-order-row.drop-target{outline:2px solid var(--primary-color,#24788c);outline-offset:2px}.category-order-row button:disabled{opacity:.35;cursor:default}
      @media(max-width:1150px){.task-tile{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:'content controls' 'deadline controls';gap:4px 8px}.task-content{grid-area:content}.task-deadline{grid-area:deadline;flex-direction:row;text-align:left;gap:5px;white-space:normal}.task-controls{grid-area:controls}}
      @media(max-width:850px){.task-grid{grid-template-columns:1fr}}
      @media(max-width:600px){.settings-sheet{padding:3px 10px 14px}.task-tile{padding:9px 10px}.task-primary{padding:5px 7px}.category-order-row{gap:5px}.category-order-row .actions{flex-wrap:nowrap}.category-order-row button{padding:5px 7px}}
      @media(pointer:coarse){.task-menu>summary{min-height:36px;min-width:32px}}
      @media(prefers-reduced-transparency:reduce){header,.toolbar,.task-tile,.row,.history-row,.empty,.settings-sheet,dialog,.task-menu-actions{background:var(--card-background-color,#fff);backdrop-filter:none;-webkit-backdrop-filter:none}}
      .task-grid>.task-tile,.task-grid>.row{background:linear-gradient(145deg,color-mix(in srgb,var(--card-background-color,#fff) 82%,#b9bec4 18%),color-mix(in srgb,var(--card-background-color,#fff) 93%,#8d959e 7%));box-shadow:inset 0 1px 0 #ffffff24,0 5px 13px #00000020,0 1px 3px #00000012;border-color:color-mix(in srgb,var(--divider-color,#7d8791) 70%,#fff 30%)}
      .task-tile,.task-grid>.row,.device-grid>.row,.log-list>.row{border:0;border-radius:12px;background:linear-gradient(145deg,color-mix(in srgb,var(--card-background-color,#fff) 88%,#b9bec4 12%),color-mix(in srgb,var(--card-background-color,#fff) 95%,#8d959e 5%));box-shadow:0 8px 22px #00000030,0 1px 3px #00000020}.task-grid{gap:12px}
      .log-entry{align-items:baseline;gap:12px}.log-date{flex:0 0 64px;font-size:12px;font-variant-numeric:tabular-nums}.log-entry .info{min-width:0;overflow-wrap:anywhere}.log-entry .small{white-space:pre-line}
      :host{--tile-surface:linear-gradient(90deg,color-mix(in srgb,var(--card-background-color,#fff) 95%,#8d959e 5%),color-mix(in srgb,var(--card-background-color,#fff) 88%,#b9bec4 12%))}
      .task-grid>.task-tile,.task-grid>.row,.device-grid>.row,.log-list>.row,.task-tile,.row,.history-row,.empty,.settings-sheet{background:var(--tile-surface)}
      .header-title{display:flex;align-items:center;gap:8px}.sidebar-toggle{display:inline-flex;align-items:center;justify-content:center;flex:0 0 44px;width:44px;height:44px;min-height:44px;padding:10px;border:0;background:transparent;color:inherit;cursor:pointer}.sidebar-toggle:hover{background:var(--secondary-background-color,#edf4f6)}.sidebar-toggle:focus-visible{outline:2px solid var(--primary-color,#24788c);outline-offset:2px}
      button.stock-edit{font-size:26px;font-weight:750;min-width:44px;min-height:44px;padding:4px 8px;border:0;background:transparent}button.stock-edit:hover{background:color-mix(in srgb,var(--primary-color,#24788c) 12%,transparent)}button.stock-edit:focus-visible{outline:2px solid var(--primary-color,#24788c);outline-offset:2px}
      .inventory-add-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 16px}

/* Approved unified dashboard design. */

:host{container-type:inline-size;--primary-font-family:"Avenir Next","Segoe UI",sans-serif;--primary-text-color:#f4f6f6;--secondary-text-color:#c1c8cc;--primary-background-color:#4a5055;--card-background-color:#252c31;--secondary-background-color:#343e45;--primary-color:#76d0d3;--error-color:#f4a08e;--divider-color:#ffffff14;--glass-surface:#252c31;--glass-border:transparent;--tile-surface:linear-gradient(90deg,#252c31,#30393f);font-family:var(--primary-font-family);font-size:13px;line-height:1.45;background:#4a5055}
*{box-sizing:border-box}header{background:#252d32f5;backdrop-filter:blur(18px);padding:16px max(24px,calc((100% - 1280px)/2));padding-bottom:0;border:0;box-shadow:0 5px 18px #10181c18;z-index:10}.header-title{gap:12px}h1{font-size:24px;letter-spacing:-.8px;font-weight:650}.sidebar-toggle{width:36px;flex-basis:36px;min-height:36px;height:36px;padding:6px}.header-brand{width:32px;height:32px;border-radius:9px;margin-right:1px}
nav{gap:24px;margin-top:14px}nav button{border-radius:0;padding:11px 0 13px;background:transparent;border:0;border-bottom:2px solid transparent;font-size:13px;font-weight:500;opacity:.72}nav button:hover{background:transparent;opacity:1}nav button[aria-current=page]{background:transparent;color:#a6e9e7;border-bottom-color:#76d0d3;opacity:1}
.main{background:#4a5055;padding:24px max(24px,calc((100% - 1280px)/2));scrollbar-color:#728087 transparent}#body{padding:0 0 24px}.toolbar{padding:0;margin-bottom:20px;background:transparent;gap:10px}.toolbar .searchbox{max-width:450px}.searchbox{position:relative}input,select,textarea{background:#30393e;border:1px solid #ffffff12;border-radius:8px;min-height:36px;font-size:13px;padding:8px 10px}input::placeholder{color:#b9c3c7}input:focus,select:focus,textarea:focus{outline:2px solid #76d0d3;outline-offset:2px}.searchbox input{padding-right:36px}.searchbox #clearsearch{position:absolute;right:4px;background:transparent}
h2{font-size:15px;font-weight:650;letter-spacing:-.15px;margin:24px 0 12px}h3{font-size:13px;font-weight:650;margin:20px 0 10px}.task-stand{margin:0 0 18px;font-size:11px;opacity:.85}.task-section{margin:0 0 24px}.task-section h2{margin:0 0 12px}.task-count{font-size:11px;font-weight:500;margin-left:9px;opacity:.7}.small,.sub,.meta{font-size:11px;line-height:1.5}.task-grid{gap:12px;align-items:stretch}.task-tile,.task-grid>.task-tile{display:grid;grid-template-columns:minmax(0,1fr) 84px auto;grid-template-areas:'content deadline controls';min-width:0;gap:12px;padding:13px 14px;min-height:76px;margin:0;border:0;border-radius:10px;background:var(--tile-surface);box-shadow:0 4px 12px #141b202b}.task-content{grid-area:content;min-width:0}.task-title{font-size:13px;line-height:1.55}.task-title .device-name{color:#f4f6f6;font-size:13px;font-weight:650}.task-deadline{grid-area:deadline;font-size:10px;gap:3px;text-align:right;flex-direction:column;white-space:normal}.task-deadline strong{font-size:12px;font-weight:600}.task-controls{grid-area:controls;gap:4px}.task-menu-actions{background:#20292f;box-shadow:0 10px 24px #0004;border:1px solid #ffffff10}.task-primary{background:#254b50;color:#c0f4ef;font-weight:600;white-space:nowrap}.task-primary:hover{background:#2c5a5f}.task-menu>summary{color:#b7c5ca}.task-empty{font-size:12px;color:#cbd2d5}
button{font-family:inherit;font-size:12px;line-height:1.4;min-height:30px;padding:6px 10px;border:0;border-radius:7px;background:#ffffff0c;color:#f4f6f6;cursor:pointer;box-shadow:none}button:hover{background:#ffffff16}button:focus-visible,summary:focus-visible{outline:2px solid #76d0d3;outline-offset:3px}.device-name{color:#b7e9e6;font-weight:600;padding:0;background:transparent;border-radius:2px}.device-name:hover{background:transparent;text-decoration:underline;text-underline-offset:3px}.task-controls .task-primary{background:#254b50;color:#c0f4ef}.task-menu>summary{width:26px;min-height:30px}.actions{gap:6px;align-items:center}.device-inline-status{font-size:11px;color:#bfcbd0}.device-inline-status .due{color:#f4a08e}.device-grid>.row,.row,.history-row,.log-list>.row{border:0;border-radius:10px;background:var(--tile-surface);box-shadow:0 4px 12px #141b202b;padding:13px 14px;margin:0 0 12px;gap:12px;min-width:0}.row .info{min-width:0}.row .meta{margin-top:5px}.device-grid .row{margin-bottom:12px}.device-category{break-inside:avoid}.device-category h3{margin-top:24px}.index-switch{margin:18px 0 4px;padding:3px;gap:2px;border:0;border-radius:8px;background:#313a40}.index-switch button{font-size:12px;padding:6px 12px;border:0!important;border-radius:6px!important;background:transparent}.index-switch button[aria-pressed=true]{background:#536069;color:#fff}.inventory-add-actions{margin:12px 0 18px}.inventory-add-actions button,.actions>[data-action=device]:not([data-id]),[data-action=addcategory]{background:#254b50;color:#c0f4ef}.stock-edit{font-size:30px!important;min-width:48px!important;min-height:44px;font-weight:650!important;color:#fff;background:transparent!important;letter-spacing:-1px}.stock-edit:hover{background:#ffffff10!important}.stock-quantity.due{color:#f4a08e}.device-grid .row>.actions{flex-wrap:nowrap;justify-content:flex-end;max-width:none}.device-grid .row>.actions .stock-edit{margin-right:3px}.tag{background:#ffffff0d;border:0;border-radius:4px;color:#c7d3d8;font-size:10px;padding:3px 6px}.log-entry{gap:18px;align-items:baseline}.log-date{font-size:11px;flex-basis:80px;color:#c6d2d7}.log-entry .info>strong{font-size:13px;font-weight:500}.log-entry .small{margin-top:5px;max-width:80ch}.log-list>.row{padding:13px 16px}.settings-sheet{max-width:960px;margin:0 auto;border:0;border-radius:12px;padding:6px 22px 22px;background:var(--tile-surface);box-shadow:0 4px 12px #141b202b}.settings-sheet>h2:not(:first-child){border-top:1px solid #ffffff0c;padding-top:22px;margin-top:24px}.category-order-row{padding:9px 0;border-bottom:1px solid #ffffff0b;gap:12px;grid-template-columns:16px minmax(0,1fr) auto}.category-order-row strong{font-size:12px;font-weight:500}.category-order-row .small{font-size:11px;color:#aebdc3}.category-drag{color:#9eafb7}.category-order-row button{font-size:11px;min-height:28px;padding:5px 9px}.category-order{margin-bottom:14px}.category-order-row [data-action=deletecategory]{background:transparent;color:#c4cdd2}.category-order-row [data-action=deletecategory]:hover{background:#8d423c40;color:#ffd5cb}.device-summary{border:0;background:var(--tile-surface);padding:16px;border-radius:10px;line-height:1.8}.record-layout{gap:24px}.record-layout h2{margin-top:22px}.history-row{box-shadow:none;background:#2b343a}.history-actions button{font-size:10px}.history-date{font-size:11px}.history-note{font-size:12px}.history-text{line-height:1.55}.history-detail{font-size:12px}
dialog{background:#283239;color:#f4f6f6;border:1px solid #ffffff15;border-radius:14px;padding:22px;box-shadow:0 24px 70px #0007;width:min(600px,calc(100vw - 32px))}dialog::backdrop{background:#111b2266;backdrop-filter:blur(4px)}dialog h2{font-size:19px;margin:0 0 16px}dialog .footer{gap:8px;margin-top:22px}dialog .primary{background:#82cfcd;color:#14343a;font-weight:650}.errors{color:#ffb4a2}.stock-stepper>input{font-size:52px}.stock-stepper>button{background:#ffffff0b;border-radius:50%;width:44px;min-height:44px}.settings-sheet p{max-width:78ch}.settings-sheet>[data-action=digest]{margin-left:8px}.category-order{max-width:none}.record-layout{display:grid;grid-template-columns:minmax(260px,.65fr) minmax(0,1.35fr)}.device-status .tag{background:transparent;padding:0;color:#bdcbd1}.device-summary .device-status{gap:12px;align-self:flex-end;align-items:flex-end}.inventory-controls{display:flex;gap:8px;align-items:center;justify-content:flex-end;flex-wrap:wrap;min-width:0}.inventory-actions{flex-wrap:wrap;justify-content:flex-end}dialog .footer .inventory-remove{margin-right:auto;background:transparent;border:0;box-shadow:none;color:#c4cdd2}dialog .footer .inventory-remove:hover{text-decoration:underline;text-underline-offset:3px;color:#ffd5cb}@container(max-width:700px){dialog .footer .inventory-remove{min-height:44px}}@container(max-width:700px){.inventory-actions>button{min-height:44px}}#notice:empty{display:none}#notice:not(:empty){padding:10px 12px;margin-bottom:14px;background:#234a4c;border-radius:7px;font-size:12px}
@container(max-width:1150px){.task-tile,.task-grid>.task-tile{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:'content controls' 'deadline controls';gap:5px 10px}.task-deadline{flex-direction:row;text-align:left;gap:6px}.task-deadline strong{font-size:11px}}
@container(max-width:700px){header{padding:12px 16px 0}h1{font-size:22px}.header-brand{width:29px;height:29px}nav{gap:19px;overflow-x:auto;flex-wrap:nowrap;scrollbar-width:none;margin-top:12px}nav button{flex:none;font-size:12px;padding-top:8px;padding-bottom:12px}.main{padding:18px 14px}.task-grid{grid-template-columns:minmax(0,1fr)}.task-tile,.task-grid>.task-tile{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:'content content' 'deadline controls';padding:12px 13px;gap:8px}.task-controls{justify-content:flex-end}.task-deadline{align-items:center;flex-wrap:wrap}.task-title .device-name,.task-title{font-size:13px}.task-primary{min-height:36px}.task-menu>summary{width:32px;min-height:36px}.device-grid{column-count:1}.device-grid .row>.actions{max-width:none}.device-grid .row>.info{flex:1 1 auto}.row{flex-wrap:wrap}.row .info{flex-basis:auto}.settings-sheet{padding:4px 14px 18px}.category-order-row{gap:8px;grid-template-columns:14px minmax(0,1fr) auto}.category-order-row .actions{gap:4px}.category-order-row button{padding:5px 6px}.category-order-row .small{display:block}.log-entry{gap:7px}.log-entry .info{flex:1;min-width:0}.log-date{flex:0 0 65px}.toolbar{gap:8px}.toolbar .searchbox{flex-basis:100%;max-width:none}.toolbar select{flex:1;min-width:0}.history-row{padding:10px}.sidebar-toggle{width:44px;flex-basis:44px;min-height:44px;height:44px}.record-layout{grid-template-columns:1fr}.index-switch button{padding:6px 9px}button{touch-action:manipulation}}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}
      nav button{display:inline-flex;align-items:center;justify-content:center;gap:7px}.tab-icon{flex:none}.header-title h1{min-width:0;overflow-wrap:anywhere}@container(max-width:420px){.header-title{gap:8px}.header-title h1{font-size:20px}.header-brand{width:26px;height:26px}nav{gap:16px}nav button{gap:6px}}
      @container(max-width:700px){nav{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:0;overflow:visible}nav button{min-width:0;min-height:44px;padding:10px 0;gap:0}nav button>span{display:none}nav .tab-icon{width:21px;height:21px}}
      .battery-threshold-setting{margin:10px 0 8px;gap:7px;font-size:12px}.battery-threshold-value{display:flex;align-items:center;gap:8px}.battery-threshold-value input{width:110px;font-size:18px;font-weight:650;font-variant-numeric:tabular-nums}#battery-threshold-status:empty{display:none}
      .related-editor{margin-top:20px;padding-top:4px;border-top:1px solid #ffffff12}.related-edit-row{padding:10px 12px;margin:10px 0;background:#ffffff08;border-radius:8px}.related-edit-title{display:flex;align-items:center;justify-content:space-between;gap:10px}.related-edit-title strong{font-size:12px;overflow-wrap:anywhere}.related-edit-title button{flex:none}.related-edit-row label{margin-bottom:0;font-size:12px}.related-search-results{max-height:220px;overflow:auto}.related-search-results>button{display:flex;flex-direction:column;align-items:flex-start;gap:3px;text-align:left;width:100%;margin:4px 0;padding:9px 10px}.related-search-results strong{font-size:12px}.related-editor input[type=search]{width:100%}.device-relations{margin:16px 0}.device-relations p{margin:8px 0}
      .usage-editor .related-edit-row>label{display:none}.material-devices{margin-top:8px}.material-devices[open]>button{display:block;width:100%;text-align:left;margin-top:5px}.device-grid .row>.actions{flex-wrap:wrap}

      .settings-sheet{display:grid;gap:16px;padding:0;background:none;box-shadow:none}.settings-card{min-width:0;padding:20px;border-radius:14px;background:linear-gradient(110deg,#293237,#3b464c);box-shadow:0 8px 20px #10191e30}.settings-card>h2:first-child{margin-top:0}.settings-subsection{margin-top:20px;padding-top:18px;border-top:1px solid #ffffff12}.settings-subsection>h3{font-size:15px;margin:0 0 12px}[data-settings-form]{min-width:0;max-width:100%}[data-settings-form] .fields{grid-template-columns:repeat(2,minmax(0,1fr))}[data-settings-form] .fields>label{min-width:0}[data-settings-form] .fields input,[data-settings-form] .fields select{width:100%;min-width:0}[data-settings-form] .fields>p{grid-column:1/-1}@container(max-width:700px){[data-settings-form] .fields{grid-template-columns:minmax(0,1fr)}}[data-settings-status]:empty{display:none}.settings-categories>summary{cursor:pointer;font-size:17px;font-weight:650;min-height:30px}.settings-categories[open]>summary{margin-bottom:14px}.battery-threshold-value{display:flex;align-items:center;gap:16px;width:min(100%,420px)}.battery-threshold-value input[type=range]{width:100%;min-width:0;flex:1;padding:0;border:0;accent-color:#76d0d3;cursor:pointer}.battery-threshold-value output{min-width:58px;font-size:20px;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}.rotation-material-row{margin-block:10px;padding-block:4px}

      .device-link-tags{display:flex;flex-wrap:wrap;gap:8px}.device-link-tags .device-link-tag{display:inline-flex;align-items:center;min-height:32px;max-width:100%;padding:6px 10px;border-radius:6px;background:#147d8b;color:#ffffff;font-size:12px;line-height:1.4;white-space:normal;overflow-wrap:anywhere;text-align:left}.device-link-tags .device-link-tag:hover{background:#188b99;text-decoration:underline;text-underline-offset:3px}@container(max-width:700px){.device-link-tags .device-link-tag{min-height:44px}}
      a.ha-device-link{display:inline-flex;align-items:center;min-height:32px;max-width:100%;box-sizing:border-box;padding:6px 10px;border-radius:6px;background:#18bcf2;color:#08354a;font-size:12px;line-height:1.4;text-decoration:none;white-space:normal;overflow-wrap:anywhere}a.ha-device-link:hover{background:#42c9f5;text-decoration:underline;text-underline-offset:3px}a.ha-device-link:focus-visible{outline:2px solid #76d0d3;outline-offset:3px}@container(max-width:700px){a.ha-device-link{min-height:44px}}
      .event-type-list{list-style:none;padding:0;margin:12px 0}.event-type-list>li{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid #ffffff12}.event-type-list>li>span{min-width:0;overflow-wrap:anywhere}.event-type-list .actions{flex-shrink:0}@container(max-width:700px){.event-type-list button{min-height:44px}}
      .trash-list{list-style:none;margin:12px 0 0;padding:0}.trash-list>li{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid #ffffff12}.trash-list>li:last-child{border-bottom:0}.trash-list>li>span{min-width:0;overflow-wrap:anywhere}.trash-list>li>button{flex-shrink:0}@container(max-width:700px){.trash-list>li>button{min-height:44px}}
      .settings-card>h2,.settings-card>summary{font-family:inherit;font-size:15px;font-weight:650;line-height:1.5;letter-spacing:-.15px}.settings-card>summary{cursor:pointer;min-height:30px}.settings-card[open]>summary{margin-bottom:14px}.tag.count-tag{font-family:inherit;font-size:11px;font-weight:500;line-height:1.35;font-variant-numeric:tabular-nums;padding:3px 6px;border-radius:4px;background:#ffffff0d;color:#c7d3d8;letter-spacing:normal;opacity:1;vertical-align:middle}
      .settings-card .actions{gap:8px;flex-wrap:wrap}.settings-card>.settings-actions{margin:12px 0}.settings-card>button{margin:8px 8px 8px 0}.settings-card>button:last-child{margin-right:0}.settings-card .category-order-row,.settings-card .event-type-list>li,.settings-card .trash-list>li{gap:12px}
      .actions,.task-controls,.inventory-controls,.inventory-actions,.inventory-add-actions,.history-actions,.task-menu-actions,.usage-device-tags{gap:8px}.history-actions,.device-grid .row>.actions{flex-wrap:wrap}.usage-device-tags{display:flex;flex-wrap:wrap;align-items:center;margin-top:8px}.task-section>[data-action=addtask],.task-section>[data-action=shopping]{margin-top:8px}
      .task-device-results{display:flex;flex-direction:column;gap:8px;max-height:300px;overflow-y:auto;padding:3px}.task-device-results>button{display:flex;flex-direction:column;align-items:flex-start;gap:3px;flex-shrink:0;text-align:left;white-space:normal;overflow-wrap:anywhere;min-height:44px;padding:9px 10px}.task-device-results>button[aria-pressed=true]{background:#254b50;outline:1px solid #76d0d3}.task-device-results+ p{margin-top:8px}
      .ha-device-assignment{margin:14px 0}.ha-device-selection{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:8px 0}.ha-device-selection>span{min-width:0;overflow-wrap:anywhere}.ha-device-selection>button{min-height:36px}.ha-device-assignment input[type=search]{width:100%}@container(max-width:700px){.ha-device-selection>button{min-height:44px}}
      .device-status-hint{grid-column:1/-1;margin:0 0 10px}.event-type-list>.event-type-order-row{display:grid;grid-template-columns:18px minmax(0,1fr) auto;gap:12px}.event-type-drag{cursor:grab;touch-action:none;user-select:none;color:#9eafb7;display:flex;align-items:center;justify-content:center;min-height:36px}.event-type-drag:focus-visible{outline:2px solid #76d0d3;outline-offset:2px}.event-type-order-row.dragging{opacity:.5}.event-type-order-row.drop-target{box-shadow:inset 0 -2px #76d0d3}.index-switch{flex-wrap:wrap;max-width:100%}.trash-view>[data-action=emptytrash]{margin:8px 0 12px}@container(max-width:700px){.event-type-list>.event-type-order-row{grid-template-columns:18px minmax(0,1fr);gap:8px}.event-type-order-row>.actions{grid-column:2;justify-content:flex-start}.event-type-drag{min-height:44px}}
      .fields.history-date-fields{grid-template-columns:repeat(2,minmax(0,1fr));align-items:start;gap:12px}.history-date-fields>label{min-width:0}.history-date-fields input{min-width:0;width:100%}
      dialog .footer{position:static;bottom:auto;background:transparent;border:0;box-shadow:none;flex-wrap:wrap}.fields.paired-fields{grid-template-columns:repeat(2,minmax(0,1fr));align-items:stretch;gap:12px}.paired-fields>label{min-width:0;justify-content:space-between}.paired-fields input{min-width:0;width:100%}
      .record-task-list{display:grid;grid-template-columns:minmax(0,1fr);align-content:start}.record-task-list>.task-tile{margin:0}

      .log-date{display:flex;flex-direction:column;gap:3px}.log-time{font-family:inherit;font-size:10px;font-weight:400;line-height:1.4;white-space:nowrap;color:#aebdc3}
      :host{--tile-gap:9px}.task-grid,.record-task-list{gap:var(--tile-gap)}.settings-sheet{gap:12px}.device-grid{column-gap:var(--tile-gap)}.device-grid>.row,.log-list>.row,.history-row{margin-bottom:var(--tile-gap)}.task-grid>.row,.task-grid>.task-tile{margin:0}.device-notes{margin-block:var(--tile-gap)}
      .shopping-controls{flex-shrink:0}.trash-list>li{flex-wrap:wrap}.trash-list>li>span{flex:1 1 160px}.trash-list>li>.actions{justify-content:flex-end}@container(max-width:700px){.trash-list .actions>button{min-height:44px}}
      .inventory-notes{margin-top:8px}.inventory-notes>summary{cursor:pointer}.inventory-notes>p{white-space:pre-wrap;overflow-wrap:anywhere;margin:6px 0 0}
      .device-manufacturer{font-size:11px;line-height:1.5;color:#bfcbd0}
      .device-grid .row>.device-card-content{flex:1;min-width:0;width:100%}.device-card-heading{display:grid;grid-template-columns:minmax(0,1fr) max-content;align-items:center;gap:12px}.device-card-title{min-width:0;overflow-wrap:anywhere}.device-task-count{font-size:11px;line-height:1.5;white-space:nowrap;text-align:right;color:#bfcbd0}
      .device-notes{margin:var(--tile-gap) 0;padding:14px 16px;border-radius:10px;background:var(--tile-surface);box-shadow:0 4px 12px #141b202b}.device-notes h3{margin:0 0 6px}.device-notes p{margin:0;font-size:13px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}
.category-order-row{display:grid;grid-template-columns:18px minmax(0,1fr) auto}.category-order-row.dragging{opacity:.5}.category-order-row.drop-target{outline:0;box-shadow:inset 0 -2px #76d0d3}@container(max-width:700px){.category-order-row{grid-template-columns:18px minmax(0,1fr);gap:8px}.category-order-row>.actions{grid-column:2;justify-content:flex-start}}
.row:has(.task-menu[open]),.task-tile:has(.task-menu[open]){position:relative;z-index:20;overflow:visible}
.completion-date-stepper{display:flex;align-items:center;justify-content:center;gap:14px;margin:12px 0}.completion-date-stepper button{width:40px;min-height:40px;font-size:22px;padding:4px}.completion-date-stepper output{min-width:8ch;text-align:center;font-size:16px;font-weight:600;font-variant-numeric:tabular-nums}.completion-date-stepper button:disabled{opacity:.3;cursor:default}
.completion-date-picker{position:relative;display:inline-flex;align-items:center;justify-content:center;min-height:40px;padding:4px 8px;border-radius:7px;cursor:pointer}.completion-date-picker:hover{background:#ffffff10}.completion-date-picker:focus-within{outline:2px solid #76d0d3;outline-offset:2px}.completion-date-picker input{position:absolute;inset:0;width:100%;height:100%;min-height:0;opacity:0;cursor:pointer}.completion-date-picker input::-webkit-calendar-picker-indicator{position:absolute;inset:0;width:100%;height:100%;margin:0;padding:0;cursor:pointer}
.event-type-order-row [data-action=deleteeventtype]{background:transparent;border:0;box-shadow:none;color:#c4cdd2}.event-type-order-row [data-action=deleteeventtype]:hover{background:#8d423c40;color:#ffd5cb}
.completed-tasks{margin-top:18px}.completed-tasks>summary{cursor:pointer;font-size:13px;font-weight:600}.completed-tasks[open]>summary{margin-bottom:9px}
.data-check-list{list-style:none;padding:0;margin:12px 0 0}.data-check-list>li{padding:12px 0;border-top:1px solid #ffffff12}.data-check-list>li>strong{font-size:13px}.data-check-list .actions{margin-top:8px}
#completion-undo{position:fixed;z-index:50;bottom:20px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:12px;max-width:calc(100% - 24px);padding:10px 14px;background:#283239;color:#f4f6f6;border-radius:10px;box-shadow:0 8px 28px #0005;font-size:13px}#completion-undo>span{min-width:0}#completion-undo [data-action=undocomplete]{background:#254b50;color:#c0f4ef;font-weight:600;white-space:nowrap}#completion-undo [data-action=dismissundo]{background:transparent;font-size:20px;padding:2px 7px}

.inventory-desktop-actions{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:8px}.inventory-menu,.inventory-usage-mobile{display:none}
@container(max-width:700px){
  .device-grid>.row.inventory-item{display:grid;grid-template-columns:minmax(0,1fr) max-content max-content;grid-template-rows:auto auto auto auto;column-gap:8px;row-gap:0;align-items:start;padding:12px;margin-bottom:9px;overflow:visible}
  .inventory-item>.info,.inventory-item>.inventory-controls,.inventory-item .inventory-actions{display:contents}
  .inventory-item>.info>strong{grid-column:1/3;grid-row:1;align-self:center;min-width:0;min-height:44px;display:flex;align-items:center;font-size:16px;line-height:1.3;overflow-wrap:anywhere}
  .inventory-item .stock-edit{grid-column:3;grid-row:1;justify-self:end;align-self:center;min-height:44px;font-size:32px!important;margin:0;padding:0 2px}
  .inventory-item>.info>.meta{grid-column:1/-1;grid-row:2;margin:2px 0 0;font-size:12px;line-height:1.4;overflow-wrap:anywhere}
  .inventory-item>.info>.inventory-device-count{display:none}
  .inventory-item>.info>.inventory-notes{grid-column:1/-1;grid-row:3;margin:6px 0 3px;font-size:13px;line-height:1.4}
  .inventory-item .inventory-usage{grid-column:1/-1;grid-row:4;min-width:0;margin:4px 0 0}
  .inventory-item .inventory-usage>summary{max-width:calc(100% - 148px);min-height:44px;padding:0;line-height:44px;font-size:13px;cursor:pointer;white-space:nowrap;color:#bfcbd0}
  .inventory-usage-desktop,.inventory-item .inventory-desktop-actions{display:none}
  .inventory-usage-mobile{display:inline}
  .inventory-item .inventory-purchase{grid-column:2;grid-row:4;align-self:start;justify-self:end;min-height:44px;margin-top:4px;padding:0 10px;white-space:nowrap;font-size:13px;position:relative;z-index:1}
  .inventory-item .inventory-menu{display:block;grid-column:3;grid-row:4;align-self:start;justify-self:end;margin-top:4px;z-index:2}
  .inventory-item .inventory-menu>summary{width:44px;min-width:44px;min-height:44px;padding:0}
  .inventory-menu .task-menu-actions{background:#283239;max-width:calc(100vw - 48px)}
  .inventory-menu .task-menu-actions>button{min-height:44px;white-space:nowrap}
  .inventory-item .inventory-usage>.usage-device-tags{display:flex;flex-direction:column;align-items:stretch;gap:4px;width:100%;margin-top:5px}
  .inventory-item .inventory-usage>.usage-device-tags>button{width:100%;min-height:44px;text-align:left;white-space:normal;overflow-wrap:anywhere;font-size:13px;color:#b7e9e6;background:transparent}
}

.toolbar.inventory-toolbar{flex-wrap:nowrap}.toolbar.inventory-toolbar .searchbox{min-width:0}#inventory-count{flex:none;white-space:nowrap}#inventory-layout{flex:none;margin-left:auto}.inventory-view-switch{margin:0}.inventory-add-actions{gap:8px}.shop-link{display:inline-flex;align-items:center;justify-content:center;gap:5px;min-height:32px;padding:5px 9px;border-radius:6px;background:#ffffff08;color:#b7e9e6;font-size:13px;line-height:1.25;text-decoration:none;white-space:nowrap}.shop-link:hover{background:#ffffff12;text-decoration:underline;text-underline-offset:3px}.shopping-controls{flex-wrap:wrap}
.inventory-list-group+.inventory-list-group{margin-top:20px}.inventory-list-group>h3{margin:0 0 10px}.inventory-list{display:grid;grid-template-columns:max-content fit-content(280px) minmax(0,1fr);column-gap:12px;background:var(--tile-surface);border-radius:12px}.inventory-list>.row{display:grid;grid-column:1/-1;grid-template-columns:subgrid;gap:12px;align-items:baseline;min-width:0;margin:0;padding:10px 14px;border:0;border-bottom:1px solid #ffffff12;border-radius:0;box-shadow:none;background:transparent}.inventory-list>.row:first-child{border-radius:12px 12px 0 0}.inventory-list>.row:last-child{border-bottom:0;border-radius:0 0 12px 12px}.inventory-list>.row:only-child{border-radius:12px}.inventory-list-stock{display:flex;align-items:baseline;justify-content:flex-end;gap:5px;white-space:nowrap;font-variant-numeric:tabular-nums}.inventory-list-stock>strong{font-size:16px}.inventory-stock-low{color:#f4a08e}.inventory-list-name{font-size:13px;font-weight:600;line-height:1.5;overflow-wrap:anywhere;min-width:0;min-height:28px;padding:0;background:transparent;border:0;box-shadow:none;text-align:left;color:#b7e9e6;justify-self:start;border-radius:2px}.inventory-list-name:hover{background:transparent;text-decoration:underline;text-underline-offset:3px}.inventory-list-devices{font-size:12px;line-height:1.5;overflow-wrap:anywhere;min-width:0}
@container(max-width:700px){.shop-link{min-height:44px}.inventory-item .shop-link{grid-column:1/-1;grid-row:5;justify-self:start;margin-top:4px}.inventory-list{grid-template-columns:max-content minmax(85px,.9fr) minmax(0,1.1fr);column-gap:8px}.inventory-list>.row{gap:8px;padding:9px 10px}.inventory-list-name{min-height:44px}.inventory-list-stock{flex-direction:column;gap:0;align-items:flex-end;white-space:normal;max-width:70px}.inventory-list-stock .small{font-size:10px;text-align:right}.inventory-view-switch button{min-height:44px;padding:6px 8px}}


.header-title{gap:0}.header-title .sidebar-toggle{flex:0 0 44px;width:44px;height:44px;min-height:44px;padding:10px;box-sizing:border-box}.header-title .header-brand{display:inline-flex;align-items:center;justify-content:center;flex:none;margin-right:12px}.header-title .header-brand>svg{display:block;flex:none;width:100%;height:100%}
</style><header><div class="header-title"><button class="sidebar-toggle" data-action="sidebarmenu" type="button" aria-label="Home-Assistant-Navigation öffnen" title="Home-Assistant-Navigation öffnen"><svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 6h18M3 12h18M3 18h18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button><span class="header-brand"><svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" aria-hidden="true" focusable="false" viewBox="0 0 256 256">
 <rect x="12" y="12" width="232" height="232" rx="56" fill="#147d8b"/>
 <path d="m166 85-38-33-64 55v86h128v-46" fill="none" stroke="#fff" stroke-width="20" stroke-linecap="round" stroke-linejoin="round"/>
 <path d="m192 94 14 8v16l-14 8-14-8v-16Z" fill="#fff"/>
</svg>
</span><h1>Wartungs-Manager</h1></div><nav>${[['tasks','Aufgaben'],['devices','Geräte'],['batteries','Verbrauchsmaterial'],['log','Log'],['settings','Einstellungen']].map(([id,label])=>this.tabButton(id,label)).join('')}</nav></header><div class="main"><div id="notice" role="status" aria-live="polite"></div><div class="toolbar${this.tab==='batteries'?' inventory-toolbar':''}" ${['tasks','devices','batteries','log'].includes(this.tab)?'':'hidden'}><div class="searchbox"><input id="search" type="search" aria-label="Suchen" placeholder="${this.tab==='batteries'?'Verbrauchsmaterial suchen':this.tab==='log'?'Log durchsuchen':'Gerät oder Aufgabe suchen'}" value="${E(this.searchQuery())}"><button data-action="clearsearch" id="clearsearch" type="button" aria-label="Suchbegriff löschen" title="Suchbegriff löschen" ${(this.searchQuery())?'':'hidden'}>×</button></div><span id="inventory-count" class="small sub" role="status" aria-live="polite" ${this.tab==='batteries'?'':'hidden'}></span><div id="inventory-layout" class="index-switch inventory-view-switch" role="group" aria-label="Darstellung" ${this.tab==='batteries'?'':'hidden'}>${this.button('inventorylayout','Kacheln','cards','aria-pressed="'+(this.inventoryLayout!=='list')+'"')}${this.button('inventorylayout','Liste','list','aria-pressed="'+(this.inventoryLayout==='list')+'"')}</div><select id="logyear" aria-label="Jahr filtern" ${this.tab==='log'?'':'hidden'}>${this.logYearOptions().map(([year,label])=>`<option value="${E(year)}" ${year===(this.logYearFilter||'')?'selected':''}>${E(label)}</option>`).join('')}</select><select id="taskperiod" aria-label="Zeitraum" title="Jetzt: fällig oder zu klären · Bald: morgen bis einschließlich in 14 Tagen · Alle: alle offenen Aufgaben" ${this.tab==='tasks'?'':'hidden'}>${[['now','Jetzt'],['soon','Bald'],['all','Alle']].map(([value,label])=>`<option value="${value}" ${this.taskPeriod===value?'selected':''}>${label}</option>`).join('')}</select><select id="categoryfilter" aria-label="Kategorie filtern" ${this.tab==='devices'?'':'hidden'}><option value="">Alle Kategorien</option>${this.displayedCategories().filter(category=>Object.values(this.data.devices).some(d=>!d.deleted_at&&this.category(d)===category)).map(category=>`<option value="${E(category)}" ${this.categoryFilter===category?'selected':''}>${E(category)}</option>`).join('')}</select><select id="area" aria-label="Bereich" ${this.tab==='devices'?'':'hidden'}><option value="">Alle Bereiche</option>${[...new Set(Object.values(this.data.devices).map(d=>d.area).filter(Boolean))].sort().map(a=>`<option value="${E(a)}" ${a===this.area?'selected':''}>${E(a)}</option>`).join('')}</select></div><div id="body"></div></div><div id="completion-undo" role="status" aria-live="polite" hidden></div><dialog aria-label="Bearbeiten"></dialog>`;
    root.addEventListener('click',this.onClick ||= event=>{const b=event.target.closest('button[data-action]');for(const menu of root.querySelectorAll('.task-menu[open]'))if(b||!menu.contains(event.target))menu.open=false;if(b)this.act(b.dataset.action,b.dataset.id).catch(e=>this.notice(errorMessage(e),true));});root.addEventListener('keydown',this.onMenuKey ||= event=>{if(event.key==='Escape'){const menu=root.querySelector('.task-menu[open]');if(menu){menu.open=false;menu.querySelector('summary').focus();event.preventDefault();}}});
    root.querySelector('#search').oninput=e=>this.filterChanged(this.searchKey(),e.target.value);for(const [id,key] of [['categoryfilter','categoryFilter'],['area','area'],['taskperiod','taskPeriod'],['logyear','logYearFilter']]){const select=root.querySelector('#'+id);if(select)select.oninput=select.onchange=e=>this.filterChanged(key,e.target.value);}this.body();this.renderCompletionUndo();root.addEventListener('focusout',this.onBackgroundFocusOut ||= ()=>this.scheduleBackgroundFlush());
  }
  searchKey(){return this.tab==='tasks'?'taskQuery':this.tab==='log'?'logQuery':this.tab==='batteries'?'inventoryQuery':'query';}
  searchQuery(){return this[this.searchKey()]||'';}
  searchWordsMatch(query,values){const text=searchText(values.filter(Boolean).join(' '));return searchText(query).split(' ').every(word=>text.includes(word));}
  taskMatches(v){
    const device=this.data.devices[v.device_id]||{},rule=this.data.rules[v.rule_id]||{};
    if(!this.searchWordsMatch(this.taskQuery,[device.name,v.device_name,v.name,rule.name,this.taskBatteryDetail(v)]))return false;
    if(this.taskPeriod==='all')return true;
    const date=v.booked||v.due,today=this.data.today,limit=new Date(today+'T12:00:00Z');limit.setUTCDate(limit.getUTCDate()+UI_UPCOMING_DAYS);const end=limit.toISOString().slice(0,10);
    if(this.taskPeriod==='soon')return date?date>today&&date<=end:v.status==='soon';
    if(date)return date<=today;
    return !['soon','scheduled','on_demand'].includes(v.status);
  }
  taskGroup(v){
    if(v.booked&&v.booked>=this.data.today)return 'booked';
    if(v.status==='on_demand')return 'on_demand';
    const date=v.booked||v.due;if(date){if(date<=this.data.today)return 'now';const limit=new Date(this.data.today+'T12:00:00Z');limit.setUTCDate(limit.getUTCDate()+UI_UPCOMING_DAYS);return date<=limit.toISOString().slice(0,10)?'soon':'planned';}
    return v.status==='soon'?'soon':v.status==='scheduled'?'planned':'now';
  }
  deviceMaterials(device){
    const ids=new Set();for(const material of Object.values(this.data.settings?.consumables||{}))if((material.device_ids||[]).includes(device.id))ids.add(material.id);
    for(const rule of Object.values(this.data.rules||{}))if(rule.device_id===device.id&&!rule.deleted_at)for(const link of [rule.consumable,...Object.values(rule.consumables_by_step||{})])if(link?.kind==='material')ids.add(link.id);
    return [...ids].map(id=>this.data.settings?.consumables?.[id]).filter(Boolean).sort((a,b)=>a.name.localeCompare(b.name,'de',{sensitivity:'base',numeric:true}));
  }
  deviceMaterialText(device){const names=this.deviceMaterials(device).map(material=>material.name);return names.length?'Verbrauchsmaterial: '+names.join(', '):'';}
  shoppingNotes(item){return [...new Set([item.notes,item.battery_type?this.data.settings?.battery_notes?.[item.battery_type]:this.data.settings?.consumables?.[item.consumable_id]?.notes].filter(note=>typeof note==='string'&&note.trim()))].join('\n\n');}
  shoppingMatches(item){
    const devices=Object.values(this.data.devices).filter(device=>!device.deleted_at&&(item.battery_type&&device.battery_type===item.battery_type||item.consumable_id&&this.deviceMaterials(device).some(material=>material.id===item.consumable_id)||(this.data.settings?.battery_device_links?.[item.battery_type]||[]).includes(device.id)));
    return this.searchWordsMatch(this.taskQuery,[item.name,item.battery_type,...devices.map(device=>device.name)]);
  }
  filterChanged(key,value){if(this[key]===value)return;this[key]=value;if(this.tab==='devices')this.selected=null;const clear=this.shadowRoot.querySelector('#clearsearch');if(clear)clear.hidden=!(this.searchQuery());this.body();}
  matches(d,text=''){const haystack=searchText(`${d.name} ${text} ${d.manufacturer||''} ${d.model||''} ${d.battery_type||''}`);if(this.tab!=='devices')return true;return (this.tab!=='devices'||!this.categoryFilter||this.category(d)===this.categoryFilter)&&(!this.area||searchText(d.area)===searchText(this.area))&&searchText(this.query).split(' ').every(word=>haystack.includes(word));}
  ruleMaterialLink(r){const step=r.kind==='rotation'&&r.steps?.length?r.steps[(r.rotation_step||0)%r.steps.length]:null;return step&&Object.hasOwn(r.consumables_by_step||{},step)?r.consumables_by_step[step]:r.consumable;}
  taskBatteryDetail(v){
    const r=this.data.rules[v.rule_id]||{},d=this.data.devices[v.device_id]||{};
    const link=this.ruleMaterialLink(r);
    if(!v.automatic_battery&&link?.kind!=='battery'&&!/batterie|lithium/i.test(v.name))return '';
    const raw=String(d.battery_type||''),type=link?.kind==='battery'?link.id:batteryType(raw);
    const quantity=d.battery_quantity??(raw.match(/^(\d+)\s*[×x]/)?.[1])??(type?1:null);
    return (quantity?quantity+' × ':'')+(type||'Batterietyp offen');
  }
  batteryWarning(v){
    const device=this.data.devices[v.device_id],rule=this.data.rules[v.rule_id]||{};
    const change=/wechsel|ersetzen|austausch|erneuern/i.test(v.name||rule.name||'');
    const battery=/batterie|lithium/i.test(v.name||rule.name||'')||rule.consumable?.kind==='battery';
    if(!device||device.deleted_at||device.in_storage||this.archived(device)||device.battery_alert_enabled===false||(!v.automatic_battery&&!(change&&battery)))return null;
    const state=this.batteryState(device);if(!state.low)return null;
    const threshold=this.batteryThreshold();
    return {text:`${state.value} % · ${this.batteryThresholdLabel(threshold)}`,title:threshold.valid?`Warnschwelle aus ${threshold.entity}. Die Warnung gilt strikt unter diesem Wert.`:`${threshold.entity} ist nicht verfügbar oder ungültig; Ersatzschwelle 20 %.`};
  }
  updateBatteryWarnings(){
    for(const el of this.shadowRoot.querySelectorAll?.('[data-battery-warning-device]')||[]){
      const warning=this.batteryWarning({device_id:el.dataset.batteryWarningDevice,rule_id:el.dataset.batteryWarningRule,name:el.dataset.batteryWarningName,automatic_battery:el.dataset.batteryWarningAutomatic==='true'});
      const text=warning?.text||'',title=warning?.title||'';
      if(el.textContent!==text)el.textContent=text;if(el.title!==title)el.title=title;el.hidden=!warning;
    }
    for(const el of this.shadowRoot.querySelectorAll?.('[data-battery-task-value]')||[]){
      const device=this.data.devices[el.dataset.batteryTaskValue],state=device?this.batteryState(device):null;
      const text=state?.value!=null?state.value+' %':'Unbekannt';if(el.textContent!==text)el.textContent=text;
    }
  }
  completedOneOff(v){
    const rule=this.data.rules[v.rule_id]||{};
    return rule.kind==='none'?!!rule.last_completed:rule.kind==='date'&&!!rule.due_date&&rule.completed_due_date===rule.due_date;
  }
  completedForNow(v){
    const rule=this.data.rules[v.rule_id]||{},next=v.booked||v.due;
    return !!rule.last_completed&&['interval','season','rotation'].includes(rule.kind)&&['scheduled','soon','archived'].includes(v.status)&&!!next&&next>this.data.today;
  }
  completedTask(v){
    const rule=this.data.rules[v.rule_id],date=dateText(rule.last_completed)||'Datum unbekannt',next=dateText(v.booked||v.due),name=rule.kind==='rotation'?rule.name:v.name;
    return `<article class="task-tile completed-task" aria-label="${E(name+' – erledigt')}"><div class="task-content"><div class="task-title">${E(name)}</div><div class="small sub">Nächster Termin: ${E(next)}${rule.kind==='rotation'?'<br>Nächste Aufgabe: '+E(v.name):''}</div></div><div class="task-deadline"><span>Erledigt</span><strong>${E(date)}</strong></div><div class="task-controls">${this.button('rule','Bearbeiten',v.rule_id)}${this.button('deleterule','Entfernen',v.rule_id)}</div></article>`;
  }
  task(v){
    const r=this.data.rules[v.rule_id]||{},warning=this.batteryWarning(v);
    const observed=v.status==='on_demand'?(v.observed_interval_days!=null?'Beobachteter Abstand: '+v.observed_interval_days+' Tage. Orientierung: '+dateText(v.estimated_due)+'. Maßgeblich bleibt die Geräteanzeige.':'Intervall noch nicht ableitbar: '+(v.observations||0)+' dokumentierte Erledigungen.') : '';
    const note=[r.review_note,observed,v.automatic_battery?`Die Aufgabe bleibt sichtbar, bis Home Assistant mindestens ${this.batteryThreshold().value} % meldet. ${this.batteryThreshold().valid?'Schwellenwert aus '+this.batteryThreshold().entity+'.':'Schwellenwert-Helfer nicht verfügbar; Ersatzwert 20 %.'} Ein erfasster Wechsel bucht die verwendete Menge aus dem Verbrauchsmaterial ab.`:null].filter(Boolean).join('\n');
    const futureBooked=v.booked&&v.booked>=this.data.today;
    const date=v.booked||v.due;
    const late=!!(v.booked?v.booked<this.data.today:v.status==='overdue');
    const caption=v.booked?'Termin':v.automatic_battery?'Batterie':date?(late?'Überfällig seit':'Fällig'):'Status';
    const dateValue=v.automatic_battery?v.battery_value+' %':date?dateText(date):S[v.status];
    let primary='';
    if(v.automatic_battery)primary=this.button('batterylog','Wechsel erfassen',v.device_id,'class="task-primary"');
    else if(v.status!=='archived'&&!this.completedOneOff(v)){const action=v.status==='planning'||v.status==='measurement_pending'?'rule':futureBooked?'completion':'today';const label=v.status==='planning'?'Planen':v.status==='measurement_pending'?'Prüfen':futureBooked?'Erfassen':'Erledigt';primary=this.button(action,label,v.rule_id,'class="task-primary"');}
    const more=v.automatic_battery?this.button('device','Bearbeiten',v.device_id)+this.button('deletebattery','Entfernen',v.device_id):this.button('rule','Bearbeiten',v.rule_id)+this.button('completion','Nachtragen',v.rule_id)+this.button('deleterule','Entfernen',v.rule_id);
    return `<article class="task-tile" aria-label="${E(v.device_name+' – '+v.name)}"><div class="task-content"><div class="task-title">${this.button('record',v.device_name,v.device_id,'class="device-name"')}<span aria-hidden="true"> · </span><span>${E(v.name)}${this.taskBatteryDetail(v)?' · '+E(this.taskBatteryDetail(v)):''}</span></div><div class="small sub battery-warning" data-battery-warning-device="${E(v.device_id)}" data-battery-warning-rule="${E(v.rule_id)}" data-battery-warning-name="${E(v.name)}" data-battery-warning-automatic="${!!v.automatic_battery}" title="${E(warning?.title||'')}" ${warning?'':'hidden'}>${E(warning?.text||'')}</div></div><div class="task-deadline${late?' is-overdue':''}"><span>${E(caption)}</span><strong ${v.automatic_battery?`data-battery-task-value="${E(v.device_id)}"`:''}>${E(dateValue)}</strong></div><div class="task-controls">${primary}<details class="task-menu"><summary aria-label="${E('Weitere Aktionen für '+v.device_name+' – '+v.name)}" title="Weitere Aktionen">⋯</summary><div class="task-menu-actions" role="group" aria-label="Weitere Aktionen">${more}${note?`<details class="task-menu-note"><summary>Hinweise</summary><p>${E(datesInText(note))}</p></details>`:''}</div></details></div></article>`;
  }
  logRecordedTime(log){const value=log.recorded_at,date=typeof value==='string'&&value.trim()?new Date(value):null;if(!date||!Number.isFinite(date.getTime()))return '<span class="log-time">Uhrzeit unbekannt</span>';const timezone=this.data.timezone||'Europe/Zurich',time=date.toLocaleTimeString('de-CH',{timeZone:timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}),full=date.toLocaleString('de-CH',{timeZone:timezone,day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});return `<time class="log-time" datetime="${E(date.toISOString())}" title="${E('Erfasst am '+full)}">${E(time)}</time>`;}
  history(l){
    const kind=l.battery_stock_movement?'Batteriewechsel':this.eventTypeLabel(l.kind);
    const date=dateText(l.event_date||l.event_period)||'Datum unbekannt';
    const note=datesInText(l.note||'');
    const text=note.length>240?`<details class="history-detail" data-preserve-key="history:${E(l.id)}"><summary>${E(note.slice(0,180).replace(/\s+/g,' ').trim())}…</summary><p>${E(datesInText(note))}</p></details>`:`<span class="history-note">${E(note)}</span>`;
    return `<div class="history-row"><time class="history-date" ${l.event_date?`datetime="${E(l.event_date)}"`:''}>${E(date)}</time><span class="tag">${E(kind)}</span><div class="history-text">${text}${l.battery_stock_movement?`<span class="small"> · ${E(l.battery_stock_movement.quantity)} × ${E(l.battery_stock_movement.type)}</span>`:''}${l.material_stock_movement?`<span class="small"> · Verbrauch: ${E(l.material_stock_movement.quantity)} ${E(l.material_stock_movement.unit)} ${E(l.material_stock_movement.name)}</span>`:''}${l.cost!=null?`<span class="history-cost">${E(this.currency())} ${Number(l.cost).toFixed(2)}</span>`:''}</div><div class="history-actions">${this.button('editlog','Bearbeiten',l.id,`aria-label="${E('Historieneintrag vom '+date+' bearbeiten')}"`)}${this.button('deletelog','Entfernen',l.id,`aria-label="${E('Historieneintrag vom '+date+' entfernen')}"`)}</div></div>`;
  }
  body(){const el=this.shadowRoot.querySelector('#body');if(!el)return;const d=this.data;let html='';
    if(this.tab==='tasks'){
      const rows=[...d.views,...this.batteryTasks()].filter(v=>d.devices[v.device_id]&&!d.devices[v.device_id].deleted_at&&!d.devices[v.device_id].in_storage&&!['ok','archived'].includes(v.status)&&this.taskMatches(v));
      const booked=v=>this.taskGroup(v)==='booked';
      const now=rows.filter(v=>this.taskGroup(v)==='now').sort((a,b)=>(order[a.status]??9)-(order[b.status]??9)||(a.booked||a.due||'').localeCompare(b.booked||b.due||''));
      const appointments=rows.filter(booked).sort((a,b)=>a.booked.localeCompare(b.booked));
      const soon=rows.filter(v=>this.taskGroup(v)==='soon').sort((a,b)=>(a.due||'').localeCompare(b.due||''));
      const planned=rows.filter(v=>this.taskGroup(v)==='planned').sort((a,b)=>(a.due||'').localeCompare(b.due||''));
      const onDemand=rows.filter(v=>this.taskGroup(v)==='on_demand');
      html='';
      for(const [label,items] of [['Jetzt erledigen',now],['Termin vereinbart',appointments],['Bald fällig',soon],['Geplant',planned],['Nach Geräteanzeige',onDemand]]){
        if(!items.length&&!(label==='Jetzt erledigen'&&this.taskPeriod!=='soon'))continue;
        html+=`<section class="task-section"><h2>${label}<span class="tag count-tag">${items.length}</span></h2>${items.length?'<div class="task-grid">'+items.map(v=>this.task(v)).join('')+'</div>':'<p class="task-empty">Keine passenden Aufgaben.</p>'}${label==='Jetzt erledigen'?this.button('addtask','Aufgabe hinzufügen'):''}</section>`;
      }
      if(this.taskPeriod==='soon')html+=this.button('addtask','Aufgabe hinzufügen');
      const shopping=Object.values(d.shopping).filter(x=>!x.done&&this.taskPeriod!=='soon'&&this.shoppingMatches(x));
      if(shopping.length||(!this.taskQuery&&this.taskPeriod!=='soon'))html+=`<section class="task-section"><h2>Nachkaufen<span class="tag count-tag">${shopping.length}</span></h2><div class="task-grid">${shopping.map(x=>`<div class="row"><div class="info"><strong>${E(x.name)}</strong>${x.battery_type?`<div class="meta">Vorrat: ${E(x.quantity_remaining??0)} Stück</div>`:''}${this.shoppingNotes(x)?`<p class="small sub shopping-notes" style="white-space:pre-wrap;overflow-wrap:anywhere">${E(this.shoppingNotes(x))}</p>`:''}</div>${x.requested_quantity?`<span class="small sub">${E(x.requested_quantity)} ${E(x.requested_unit||'Stück')}</span>`:''}<div class="task-controls shopping-controls">${this.shopLink(this.shoppingShopUrl(x),x.name)}${this.button('bought','Eingekauft',x.id)}<details class="task-menu"><summary aria-label="${E('Weitere Aktionen für '+x.name)}" title="Weitere Aktionen">⋯</summary><div class="task-menu-actions" role="group" aria-label="Weitere Aktionen">${this.button('editshopping','Bearbeiten',x.id)}${this.button('deleteshopping','Entfernen',x.id)}</div></details></div></div>`).join('')}</div>${shopping.length?'':'<p class="task-empty">Keine offenen Einkäufe.</p>'}${this.button('shopping','Nachkauf hinzufügen')}</section>`;
      if(!rows.length&&!shopping.length)html+='<p class="task-empty">Keine Aufgaben für diese Auswahl.</p>';
    }
    if(this.tab==='devices'){if(this.selected&&d.devices[this.selected]){const a=d.devices[this.selected];const allViews=[...d.views,...this.batteryTasks()].filter(v=>v.device_id===a.id),views=allViews.filter(v=>!this.completedOneOff(v)&&!this.completedForNow(v)),completed=allViews.filter(v=>this.completedForNow(v));const logs=Object.values(d.logs).filter(l=>l.device_id===a.id).sort(compareHistory);html=`${this.button('back','Zurück zur Geräteübersicht')}<h2>${E(a.name)}${this.archived(a)?' (archiviert)':''}</h2><div class="device-summary"><span>Kategorie: ${E(this.category(a))}</span><span>${[a.area,a.manufacturer,a.model].filter(Boolean).map(E).join(' / ')}</span><span>Kaufdatum: ${E(dateText(a.purchase_date||a.purchase_period||'unbekannt'))}${a.serial?' / Seriennummer: '+E(a.serial):''}</span>${a.battery_type?`<span>Batterie: ${E(a.battery_quantity||1)} × ${E(a.battery_type)}</span>`:''}${this.deviceMaterialText(a)?`<span>${E(this.deviceMaterialText(a))}</span>`:''}${this.batteryBadge(a)}</div><div class="actions">${this.button('device','Daten bearbeiten',a.id)}${!this.archived(a)?this.button('newrule','Neue Aufgabe',a.id)+this.button('log','Aufgabe nachtragen',a.id)+(a.battery_type&&!/fest.*verbaut/i.test(a.battery_type)?this.button('batterylog','Batteriewechsel erfassen',a.id):''):''}${a.predecessor_id?this.button('record','Vorgänger',a.predecessor_id):''}${a.successor_id?this.button('record','Nachfolger',a.successor_id):''}${this.button('delete','Entfernen',a.id)}</div>${a.ha_device_id?`<p><a class="tag ha-device-link" href="/config/devices/device/${E(a.ha_device_id)}" target="_blank" rel="noopener">${E(this.haDeviceName(a))} (HA)</a></p>`:'<p class="sub">Manuelle Geräteakte</p>'}${this.deviceNotes(a)}${this.relatedDevices(a)}<div class="split record-layout"><section><h2>Aufgaben</h2><div class="record-task-list">${views.map(v=>this.task(v)).join('')||'<p>Keine offenen Aufgaben.</p>'}</div>${completed.length?`<details class="completed-tasks" data-preserve-key="completed-tasks:${E(a.id)}"><summary>Erledigte Aufgaben <span class="tag count-tag">${completed.length}</span></summary><div class="record-task-list">${completed.map(v=>this.completedTask(v)).join('')}</div></details>`:''}</section><section class="timeline"><h2>Historie</h2>${logs.map(l=>this.history(l)).join('')||'<p>Noch keine Einträge.</p>'}</section></div>`;}else{html=`<div class="actions">${this.button('device','Neues Gerät')}${this.button('initialcapture','Sammelerfassung von Home Assistant Geräten')}</div><div class="index-switch" role="group" aria-label="Gerätebestand">${this.button('devicemode','Aktiv','active',`aria-pressed="${this.deviceMode==='active'}"`)}${this.button('devicemode','Lager','storage',`aria-pressed="${this.deviceMode==='storage'}"`)}${this.button('devicemode','Archiv','archive',`aria-pressed="${this.deviceMode==='archive'}"`)}${this.button('devicemode','Papierkorb','trash',`aria-pressed="${this.deviceMode==='trash'}"`)}</div>${['storage','archive','trash'].includes(this.deviceMode)?`<p class="small sub device-mode-hint">${E(this.deviceModeHint(this.deviceMode))}</p>`:''}<div>${this.deviceMode==='trash'?this.trashView(d):this.deviceList(this.deviceMode==='archive')}</div>`;}}
    if(this.tab==='batteries')html=this.inventoryView();
    if(this.tab==='settings')html=this.settingsView(d);
    if(this.tab==='log'){
      const logs=this.logEntries().filter(l=>!this.logYearFilter||this.logEventYear(l)===this.logYearFilter).filter(l=>{const device=d.devices[l.device_id],title=d.rules[l.rule_id]?.name||'';const text=searchText([device.name,device.area,title,l.note,l.kind,l.battery_stock_movement?'Batterien gewechselt':'',l.battery_stock_movement?.type,l.event_date,l.event_period,dateText(l.event_date||l.event_period)].filter(Boolean).join(' '));return searchText(this.logQuery).split(' ').every(word=>text.includes(word));}).sort(compareHistory);
      html=`<div class="log-list">${logs.map(l=>{const device=d.devices[l.device_id],title=l.battery_stock_movement?'Batterien gewechselt':d.rules[l.rule_id]?.name||this.eventTypeLabel(l.kind);return `<div class="row log-entry"><div class="log-date"><span>${E(dateText(l.event_date||l.event_period||'unbekannt'))}</span>${this.logRecordedTime(l)}</div><div class="info">${this.button('record',device.name,device.id,'class="device-name"')} · <strong>${E(title)}</strong>${l.note?`<div class="small sub">${E(datesInText(l.note))}</div>`:''}${l.material_stock_movement?`<div class="small sub">Verbrauch: ${E(l.material_stock_movement.quantity)} ${E(l.material_stock_movement.unit)} ${E(l.material_stock_movement.name)}</div>`:''}${l.battery_stock_movement?`<div class="small sub">${E(l.battery_stock_movement.quantity)} × ${E(l.battery_stock_movement.type)}</div>`:''}</div></div>`;}).join('')||(this.logQuery?'<p>Keine passenden Einträge.</p>':'<p>Noch keine erledigten Aufträge erfasst.</p>')}</div>`;
    }
    if(this.tab==='settings')html='<section class="settings-sheet">'+html+'</section>';
    this.batteryTaskKey=JSON.stringify(this.batteryTasks().map(v=>v.device_id));
    if(el._wartungHTML===html)return;const state=this.captureBodyState();el.innerHTML=html;el._wartungHTML=html;this.bindCategoryDrag();this.bindEventTypeDrag();this.bindBatteryThresholdControl();this.bindInlineSettingsForms();for(const menu of el.querySelectorAll('.task-menu'))menu.ontoggle=()=>{if(menu.open)for(const other of el.querySelectorAll('.task-menu[open]'))if(other!==menu)other.open=false;if(!menu.open)this.scheduleBackgroundFlush();};this.restoreBodyState(state);
  }
  updateDeviceStatuses(){const elements=this.shadowRoot.querySelectorAll?.('[data-task-count-device]')||[],counts=elements.length?this.deviceTaskCounts():null;for(const el of elements){const device=this.data.devices[el.dataset.taskCountDevice];if(device){const text=this.deviceTaskCount(device,counts);if(el.textContent!==text)el.textContent=text;el.hidden=!text;}}for(const el of this.shadowRoot.querySelectorAll?.('[data-inline-status-device]')||[]){const d=this.data.devices[el.dataset.inlineStatusDevice];if(d){const html=this.inlineStatus(d);if(el.innerHTML!==html)el.innerHTML=html;}}}
  batteryUsageDeviceLabel(device,type){
    const raw=String(device.battery_type||'');
    const quantity=batteryType(raw)===type?Number(device.battery_quantity??raw.match(/^(\d+)\s*[×x]/)?.[1]??1):null;
    const text=Number.isInteger(quantity)&&quantity>0?quantity+' Batterie'+(quantity===1?'':'n'):'Anzahl nicht erfasst';
    return device.name+' · '+text;
  }
  batteryInventory(){
    const stock=this.data.settings?.battery_inventory||{};
    const hidden=new Set(this.data.settings?.battery_inventory_hidden_types||[]);
    const types=new Map(Object.keys(stock).filter(type=>!hidden.has(type)&&!/fest.*verbaut/i.test(type)).map(type=>[type,[]]));
    for(const d of Object.values(this.data.devices)){
      if(d.deleted_at||this.archived(d)||!d.battery_type||/nicht dokumentiert|zu klären|unbekannt|fest.*verbaut/i.test(d.battery_type))continue;
      let type=d.battery_type.replace(/^\d+\s*[×x]\s*/,'').trim();
      if(/^CR123A/i.test(type))type='CR123A';
      if(/^9\s*V$/i.test(type))type='9V';
      if(hidden.has(type))continue;
      if(!types.has(type))types.set(type,[]);types.get(type).push(d);
    }
    for(const [type,ids] of Object.entries(this.data.settings?.battery_device_links||{})){
      if(hidden.has(type)||/fest.*verbaut/i.test(type))continue;
      if(!types.has(type))types.set(type,[]);
      for(const id of ids){const device=this.data.devices[id];if(device&&!device.deleted_at&&!types.get(type).some(existing=>existing.id===id))types.get(type).push(device);}
    }
    return [...types].map(([type,devices])=>({type,devices,quantity:stock[type]??1})).sort((a,b)=>a.type.localeCompare(b.type));
  }
  batteryThresholdLimits(){
    const attrs=this._hass?.states?.[this.batteryThresholdEntity()]?.attributes||{};
    const number=(raw,fallback)=>raw!=null&&String(raw).trim()!==''&&Number.isFinite(Number(raw))?Number(raw):fallback;
    const min=Math.max(0,number(attrs.min,0)),max=Math.min(100,number(attrs.max,100)),step=number(attrs.step,1);
    return {min:min<=max?min:0,max:min<=max?max:100,step:step>0?step:1};
  }
  eventTypes(){return {maintenance:'Wartung',repair:'Reparatur',installation:'Installation',replacement:'Ersatz',purchase:'Kauf / Bestellung',inspection:'Prüfung',note:'Notiz',...this.data.settings?.event_types};}
  eventTypeLabel(kind){return this.eventTypes()[kind]||kind||'Wartung';}
  eventTypeOptions(selected){const hidden=this.data.settings?.hidden_event_types||[];const types=this.eventTypes(),order=[...new Set([...(this.data.settings?.event_type_order||[]),...Object.keys(types)])];const options=order.filter(id=>Object.hasOwn(types,id)&&(!hidden.includes(id)||id===selected)).map(id=>[id,types[id]]);if(selected&&!options.some(([id])=>id===selected))options.push([selected,selected]);return options;}
  eventTypesSettings(){const types=this.eventTypeOptions();return `<details class="settings-card settings-event-types"><summary>Ereignisarten bearbeiten <span class="tag count-tag">${types.length}</span></summary><p class="small sub">Am Griff ziehen, um die Reihenfolge zu ändern. Diese Reihenfolge gilt beim Nachtragen und Bearbeiten einer Aufgabe. Änderungen an Bezeichnungen gelten auch für bestehende Einträge. Entfernte Arten bleiben in bisherigen Einträgen erhalten.</p><ul class="event-type-list">${types.map(([id,label])=>{const count=Object.values(this.data.logs||{}).filter(log=>log.kind===id&&!log.deleted_at).length;return `<li class="event-type-order-row" draggable="true" data-event-type-id="${E(id)}"><span class="event-type-drag" tabindex="0" role="button" aria-label="${E(label+': Reihenfolge mit Pfeiltasten ändern oder ziehen')}">⠿</span><span>${E(label)} <span class="small sub">(${count} ${count===1?'Eintrag':'Einträge'})</span></span><div class="actions">${this.button('editeventtype','Umbenennen',id)}${this.button('deleteeventtype','Entfernen',id)}</div></li>`;}).join('')}</ul>${this.button('addeventtype','Ereignisart hinzufügen')}</details>`;}
  trashView(d){const rows=(d.trash||[]).filter(device=>this.matches(device)).sort((a,b)=>a.name.localeCompare(b.name,'de',{sensitivity:'base',numeric:true}));return `<section class="trash-view">${this.button('emptytrash','Papierkorb leeren','',(d.trash||[]).length?'':'disabled')}${rows.length?'<ul class="trash-list" aria-label="Gelöschte Geräte">'+rows.map(a=>`<li><span>${E(a.name)}</span><div class="actions">${this.button('undelete','Wiederherstellen',a.id)}${this.button('purgetrashdevice','Endgültig entfernen',a.id)}</div></li>`).join('')+'</ul>':(d.trash?.length?'<p>Keine passenden Geräte im Papierkorb.</p>':'<p>Der Papierkorb ist leer.</p>')}</section>`;}
  dataCheckResults(){
    if(this.diagnosticsLoading)return '<p class="small sub" role="status">Daten werden geprüft …</p>';
    if(this.diagnosticsError)return '<p class="error" role="alert">'+E(this.diagnosticsError)+'</p>';
    const result=this.diagnostics;if(!result)return '<p class="small sub">Noch keine Prüfung durchgeführt.</p>';
    const issues=result.issues||[],stale=result.revision!==this.data.revision;
    return `<p class="small sub">${E(result.checked_devices)} Geräte und ${E(result.checked_rules)} Aufgaben geprüft · ${issues.length?E(issues.length)+' Hinweise':'Keine Auffälligkeiten gefunden.'}</p>${stale?'<p class="small sub">Daten seit der Prüfung geändert. Bitte erneut prüfen.</p>':''}${issues.length?'<ul class="data-check-list">'+issues.map(issue=>`<li><strong>${E(issue.title)}</strong><p class="small sub">${E(issue.detail)}</p><div class="actions">${(issue.device_ids||[]).filter(id=>this.data.devices[id]).map(id=>this.button('record',this.data.devices[id].name,id,'class="device-name"')).join('')}${issue.rule_id&&this.data.rules[issue.rule_id]?this.button('rule','Aufgabe bearbeiten',issue.rule_id):''}</div></li>`).join('')+'</ul>':''}`;
  }
  dataCheckSettings(){return `<details class="settings-card settings-data-check"><summary>Datenprüfung</summary><p class="small sub">Prüft Home-Assistant-Verknüpfungen, Verbrauchsmaterial-Zuordnungen, Batteriedaten und mögliche doppelte Geräte. Es werden keine Daten verändert.</p><div class="actions settings-actions">${this.button('checkdata','Daten prüfen','','data-check-run '+(this.diagnosticsLoading?'disabled':''))}</div><div data-diagnostics-results aria-live="polite">${this.dataCheckResults()}</div></details>`;}
  renderDataCheck(){const el=this.shadowRoot.querySelector('[data-diagnostics-results]');if(el)el.innerHTML=this.dataCheckResults();const button=this.shadowRoot.querySelector('[data-check-run]');if(button)button.disabled=!!this.diagnosticsLoading;}
  async runDataCheck(){
    if(this.diagnosticsLoading)return;this.diagnosticsLoading=true;this.diagnosticsError='';this.renderDataCheck();
    try{this.diagnostics=await this.api('diagnose');}catch(e){this.diagnosticsError=errorMessage(e);}finally{this.diagnosticsLoading=false;this.renderDataCheck();}
  }
  currency(){return this.data?.settings?.currency||this.data?.currency||'CHF';}
  batteryThresholdEntity(){return this.data?.settings?.battery_threshold_entity||'input_number.batterien_schwellwert';}
  pendingBatteryHelperSelection(){const entity=this.inlineSettingsDrafts?.preferences?.battery_threshold_entity;return typeof entity==='string'&&entity!==this.batteryThresholdEntity();}
  batteryThresholdHint(threshold=this.batteryThreshold()){return this.pendingBatteryHelperSelection()?'Bitte die geänderte Helfer-Auswahl zuerst speichern oder verwerfen. Der Schieberegler bleibt bis dahin gesperrt.':threshold.valid?'Batterieaufgaben erscheinen unter '+threshold.value+' Prozent. Wird mit Home Assistant synchronisiert.':'Schwellenwert-Helfer nicht verfügbar. Ersatzwert: 20 %. Bearbeiten ist erst wieder möglich, wenn der Helfer verfügbar ist.';}
  preferencesFields(value={}){
    const entity=value.battery_threshold_entity??this.batteryThresholdEntity(),options=[['input_number.batterien_schwellwert','Standard: Batterien Schwellwert (automatisch anlegen)'],...Object.entries(this._hass?.states||{}).filter(([id])=>id.startsWith('input_number.')&&id!=='input_number.batterien_schwellwert').map(([id,state])=>[id,(state.attributes?.friendly_name||id)+' · '+id])];
    if(!options.some(([id])=>id===entity))options.push([entity,entity+' (derzeit nicht verfügbar)']);
    return this.field('currency','Währung (z. B. CHF, EUR, USD)',value.currency??this.currency())+this.field('battery_threshold_entity','Helfer für den Batterieschwellenwert',entity,'text',options)+'<p class="small sub">Währungsänderungen ändern die Anzeige, rechnen vorhandene Beträge aber nicht um. Ein vorhandener Helfer behält seinen Wert; nur der Standardhelfer wird bei Bedarf mit 20 % angelegt.</p>';
  }
  inlineSettingsValues(kind,form){
    return kind==='preferences'?{currency:String(form.get('currency')??''),battery_threshold_entity:String(form.get('battery_threshold_entity')??'')}:{enabled:form.has('enabled'),weekday:String(form.get('weekday')??''),time:String(form.get('time')??'')};
  }
  inlineSettingsActions(kind){return '<div class="actions settings-actions"><button type="submit" class="primary">Speichern</button><button type="reset" '+(this.inlineSettingsDrafts?.[kind]?'':'disabled')+'>Verwerfen</button>'+(kind==='schedule'?this.button('digest','Testmeldung anzeigen','','type="button"'):'')+'</div><p class="small" data-settings-status="'+kind+'" role="status" aria-live="polite"></p>';}
  generalSettingsCard(d){
    const schedule=this.inlineSettingsDrafts?.schedule||d.settings||{};
    return '<section class="settings-card"><h2>Allgemeine Einstellungen</h2><form data-settings-form="preferences" aria-label="Allgemeine Angaben"><div class="fields">'+this.preferencesFields(this.inlineSettingsDrafts?.preferences||{})+'</div>'+this.inlineSettingsActions('preferences')+'</form><section class="settings-subsection">'+this.batteryThresholdEditor().replace('<h2>Batteriewarnung</h2>','<h3>Batteriewarnung</h3>')+'</section><section class="settings-subsection"><h3>Wochenmeldung innerhalb Home Assistant</h3><form data-settings-form="schedule" aria-label="Wochenmeldung"><label class="check"><input name="enabled" type="checkbox" '+(schedule.enabled?'checked':'')+'>Wöchentlich in Home Assistant anzeigen</label><div class="fields">'+this.field('weekday','Wochentag',schedule.weekday??0,'text',['Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag','Sonntag'].map((label,index)=>[index,label]))+this.field('time','Lokale Uhrzeit',schedule.time||'09:00','time')+'</div><p class="small sub">Zeitzone: '+E(d.timezone||'Home Assistant')+'. Die Wochenmeldung erscheint als Benachrichtigung innerhalb von Home Assistant.</p>'+this.inlineSettingsActions('schedule')+'</form></section></section>';
  }
  bindInlineSettingsForms(){
    for(const form of this.shadowRoot.querySelectorAll?.('[data-settings-form]')||[]){
      const kind=form.dataset.settingsForm;
      for(const control of form.querySelectorAll('input,select,button'))control.disabled=!!(this.inlineSettingsSaving||this.pending)||(control.type==='reset'&&!this.inlineSettingsDrafts?.[kind]);
      form.oninput=form.onchange=()=>{this.inlineSettingsDrafts||={};this.inlineSettingsDrafts[kind]=this.inlineSettingsValues(kind,new FormData(form));this.syncBatteryThresholdControl();const discard=form.querySelector('[type=reset]');if(discard)discard.disabled=false;};
      form.onreset=event=>{event.preventDefault();if(this.inlineSettingsSaving||this.pending)return;delete this.inlineSettingsDrafts?.[kind];this.draw();this.scheduleBackgroundFlush();};
      form.onsubmit=event=>{event.preventDefault();return this.saveInlineSettings(kind,this.inlineSettingsValues(kind,new FormData(form)));};
    }
  }
  async saveInlineSettings(kind,values){
    if(this.inlineSettingsSaving||this.pending||this.thresholdSaving)return false;
    this.inlineSettingsDrafts||={};this.inlineSettingsDrafts[kind]=values;this.inlineSettingsSaving=true;
    this.bindInlineSettingsForms();this.syncBatteryThresholdControl();
    let error='';
    try{
      const value=kind==='preferences'?{currency:String(values.currency||'').trim().toUpperCase(),battery_threshold_entity:values.battery_threshold_entity}:{enabled:!!values.enabled,weekday:Number(values.weekday),time:values.time};
      await this.change(kind==='preferences'?'preferences':'settings',{value});delete this.inlineSettingsDrafts[kind];
    }catch(cause){error=errorMessage(cause);}
    finally{
      this.inlineSettingsSaving=false;this.draw();const status=this.shadowRoot.querySelector('[data-settings-status="'+kind+'"]');if(status){status.className=error?'small errors':'small';status.textContent=error||'Gespeichert.';}this.scheduleBackgroundFlush();
    }
    return !error;
  }
  settingsView(d){return `${this.generalSettingsCard(d)}<details class="settings-card settings-categories"><summary>Kategorien bearbeiten <span class="tag count-tag">${this.categories().length}</span></summary>${this.categoryEditor().replace('<h2>Kategorien</h2>','')}</details>${this.eventTypesSettings()}${this.dataCheckSettings()}<section class="settings-card"><h2>Daten exportieren und importieren</h2><p>Alle Wartungsdaten als JSON-Datei speichern oder aus einer solchen Datei wiederherstellen: Geräte inklusive Archiv und Papierkorb, Aufgaben, Historie, Verbrauchsmaterial und Einstellungen.</p><div class="actions settings-actions">${this.button('export','Daten exportieren')}${this.button('restore','Daten importieren')}</div></section><section class="settings-card"><h2>Daten zurücksetzen</h2><p>Geräte, Aufgaben, Historie und Verbrauchsmaterial zurücksetzen. Kategorien, Ereignisarten und allgemeine Einstellungen bleiben erhalten.</p><div class="actions settings-actions">${this.button('resetalldata','Daten zurücksetzen')}</div></section><p class="small sub settings-version">Version ${E(d.version)} / Datenrevision ${d.revision}</p>`;}
  async readDirectoryFile(file){
    if(!file||typeof file.text!=='function'||!file.size)throw Error('Bitte eine Exportdatei auswählen.');
    if(file.size>5000000)throw Error('Die Datei darf höchstens 5 MB gross sein.');
    let value;try{value=JSON.parse(await file.text());}catch{throw Error('Die Datei enthält kein gültiges JSON.');}
    const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
    if(!object(value)||value.schema!==1||!Number.isSafeInteger(value.revision)||value.revision<0||!object(value.settings)||['devices','rules','logs','shopping','imports','operations'].some(key=>!object(value[key])))throw Error('Die Datei ist kein unterstützter vollständiger Wartungs-Manager-Export.');
    return value;
  }
  async initialCapture(){
    this.reg=await this.api('registry');const overview=await this.api('initial_capture_preview');
    this.modal('Sammelerfassung · Gerätetypen', '<p>Welche Gerätetypen möchtest du übernehmen? Die Zuordnung wird aus den HA-Entitäten abgeleitet. Prüfe die Geräte anschliessend in der Vorschau.</p>'+overview.types.filter(type=>type.count).map(type=>`<label class="check"><input type="checkbox" name="capture_type" value="${E(type.id)}"><span>${E(type.name)}<br><span class="small sub">${type.existing_count} bereits erfasst · ${type.new_count} neu${type.conflict_count?' · '+type.conflict_count+' mögliche Dubletten':''}</span></span></label>`).join(''),async form=>{
      const types=form.getAll('capture_type');if(!types.length)throw Error('Bitte mindestens einen Gerätetyp auswählen.');
      const preview=await this.api('initial_capture_preview',{types});this.close();
      if(!preview.candidates.length){this.modal('Sammelerfassung · Vorschau','<p>Keine neuen Geräte für diese Auswahl. Bereits erfasste Geräte und mögliche Dubletten werden übersprungen.</p>'+(preview.skipped.length?'<details><summary>'+preview.skipped.length+' übersprungene Geräte anzeigen</summary>'+preview.skipped.map(device=>'<p class="small"><strong>'+E(device.name)+'</strong> · '+E(device.reason)+'</p>').join('')+'</details>':''),()=>this.close(),'Schliessen');return;}
      const rows=preview.candidates.map(device=>`<label class="check" data-bulk-search="${E([device.name,device.area,device.manufacturer,device.model].filter(Boolean).join(' '))}"><input type="checkbox" name="capture_device" value="${E(device.id)}" checked><span><strong>${E(device.name)}</strong><br><span class="small sub">${E([device.area,device.manufacturer,device.model].filter(Boolean).join(' · '))}</span></span></label>`).join('');
      this.modal('Sammelerfassung · Vorschau','<p><strong>'+preview.candidates.length+' neue Geräte</strong> · '+preview.skipped.length+' bereits erfasste oder mögliche Dubletten übersprungen.</p><p class="small sub">Prüfe die Auswahl. Anders benannte manuelle Geräteakten können nicht zuverlässig erkannt werden; wähle solche Geräte hier ab. Ein Textfilter ändert die Auswahl nicht.</p><label>Geräte filtern<input type="search" data-bulk-filter placeholder="Name, Bereich oder Modell"></label>'+rows+(preview.skipped.length?'<details><summary>Übersprungene Geräte anzeigen</summary>'+preview.skipped.map(device=>'<p class="small"><strong>'+E(device.name)+'</strong> · '+E(device.reason)+'</p>').join('')+'</details>':'')+'<label class="check"><input type="checkbox" name="capture_confirm" required>Ich habe die Auswahl geprüft.</label>',async values=>{
        const ids=values.getAll('capture_device');if(!ids.length)throw Error('Bitte mindestens ein neues Gerät auswählen.');if(!values.has('capture_confirm'))throw Error('Bitte die Auswahl bestätigen.');
        const result=await this.change('initial_capture_commit',{types,device_ids:ids,confirmed:true});if(result)this.notice(result.created+' Geräte erfasst.');
      },'Ausgewählte Geräte erfassen');
    },'Vorschau anzeigen');
  }
  batteryThresholdEditor(){
    const threshold=this.batteryThreshold(),limits=this.batteryThresholdLimits();
    return `<h2>Batteriewarnung</h2><label class="battery-threshold-setting" for="battery-threshold-input"><div class="battery-threshold-value"><input id="battery-threshold-input" type="range" min="${E(limits.min)}" max="${E(limits.max)}" step="${E(limits.step)}" value="${E(threshold.value)}" aria-label="Batterieschwellenwert in Prozent" aria-describedby="battery-threshold-hint" ${threshold.valid&&!this.pendingBatteryHelperSelection()?'':'disabled'}><output id="battery-threshold-output" for="battery-threshold-input">${E(threshold.value)} %</output></div></label><p id="battery-threshold-hint" class="small sub">${E(this.batteryThresholdHint(threshold))}</p><p class="small sub">Gespeichert im Home-Assistant-Helfer <code>${E(threshold.entity)}</code>. ${threshold.entity==='input_number.batterien_schwellwert'?'Die App prüft ihn beim Laden und legt ihn bei Bedarf automatisch mit 20 % an.':'Der ausgewählte Helfer wird verwendet; sein bestehender Wert bleibt erhalten.'}</p><p id="battery-threshold-status" class="small" role="status" aria-live="polite">${E(this.helperCheckError||'')}</p>`;
  }
  syncBatteryThresholdControl(){
    const input=this.shadowRoot.querySelector('#battery-threshold-input');if(!input)return;
    const threshold=this.batteryThreshold(),limits=this.batteryThresholdLimits();
    input.min=String(limits.min);input.max=String(limits.max);input.step=String(limits.step);
    input.disabled=!!(this.thresholdSaving||this.inlineSettingsSaving||this.pendingBatteryHelperSelection()||!threshold.valid);
    if(!this.thresholdSaving&&this.shadowRoot.activeElement!==input)input.value=String(threshold.value);
    const output=this.shadowRoot.querySelector('#battery-threshold-output');if(output)output.textContent=input.value+' %';
    this.shadowRoot.querySelector('#battery-threshold-hint').textContent=this.batteryThresholdHint(threshold);
  }
  bindBatteryThresholdControl(){
    const input=this.shadowRoot.querySelector('#battery-threshold-input');if(!input)return;
    input.oninput=()=>{this.shadowRoot.querySelector('#battery-threshold-output').textContent=input.value+' %';};
    input.onchange=()=>this.saveBatteryThreshold(input);
    input.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();input.blur();}};
  }
  async saveBatteryThreshold(input){
    if(this.thresholdSaving||this.inlineSettingsSaving||this.pending||this.pendingBatteryHelperSelection())return;
    const status=this.shadowRoot.querySelector('#battery-threshold-status'),threshold=this.batteryThreshold(),value=Number(input.value);
    status.className='small';
    if(!threshold.valid){status.textContent='Der Schwellenwert-Helfer ist nicht verfügbar.';return;}
    if(input.value.trim()===''||!Number.isFinite(value)||!input.checkValidity()){status.className='small errors';status.textContent=`Bitte einen Wert zwischen ${input.min} und ${input.max} in Schritten von ${input.step} eingeben.`;return;}
    if(value===threshold.value){status.textContent='';return;}
    this.thresholdSaving=true;input.disabled=true;status.textContent='Wird gespeichert …';
    try{
      await this._hass.callService('input_number','set_value',{entity_id:threshold.entity,value});
      status.textContent=`Schwellenwert auf ${value} % gespeichert.`;
    }catch(error){status.className='small errors';status.textContent=errorMessage(error);}
    finally{this.thresholdSaving=false;input.disabled=!this.batteryThreshold().valid;}
  }
  async ensureBatteryThresholdHelper(){
    const entity=this.batteryThresholdEntity(),id='batterien_schwellwert';
    if(this._hass?.states?.[entity]){this.helperCheckError='';return;}
    if(entity!=='input_number.batterien_schwellwert'){this.helperCheckError='Der ausgewählte Batterieschwellenwert-Helfer ist nicht verfügbar.';return;}
    if(this.helperCheckPromise)return this.helperCheckPromise;
    if(this.helperLastCheck&&Date.now()-this.helperLastCheck<60000)return;
    this.helperLastCheck=Date.now();
    const run=async()=>{
      if(this._hass?.states?.[entity])return;
      const helpers=await this._hass.callWS({type:'input_number/list'});
      if(helpers.some(helper=>helper.id===id))return;
      try{const existing=await this._hass.callWS({type:'config/entity_registry/get',entity_id:entity});if(existing)return;}catch(error){if(!['not_found','entity_not_found'].includes(error?.code))throw error;}
      const created=await this._hass.callWS({type:'input_number/create',name:'Batterien Schwellwert',min:0,max:100,step:1,mode:'slider',unit_of_measurement:'%',initial:20,icon:'mdi:battery-alert'});
      if(created.id!==id){await this._hass.callWS({type:'input_number/delete',input_number_id:created.id});const current=await this._hass.callWS({type:'input_number/list'});if(!current.some(helper=>helper.id===id))throw Error('Der Helfer konnte nicht unter der vorgesehenen Entitäts-ID angelegt werden.');}
    };
    this.helperCheckPromise=(async()=>{try{if(globalThis.navigator?.locks)await navigator.locks.request('wartungs-manager-battery-helper',run);else if(globalThis.__wartungBatteryHelperCheck)await globalThis.__wartungBatteryHelperCheck;else{globalThis.__wartungBatteryHelperCheck=run();try{await globalThis.__wartungBatteryHelperCheck;}finally{delete globalThis.__wartungBatteryHelperCheck;}}this.helperCheckError='';}catch(error){this.helperCheckError='Der Batterieschwellenwert-Helfer konnte nicht geprüft oder angelegt werden: '+errorMessage(error);const status=this.shadowRoot.querySelector('#battery-threshold-status');if(status)status.textContent=this.helperCheckError;}finally{this.helperCheckPromise=null;}})();
    return this.helperCheckPromise;
  }
  batteryThreshold(){
    const entity=this.batteryThresholdEntity();
    const raw=String(this._hass?.states?.[entity]?.state??'').trim();
    const value=raw!==''?Number(raw):NaN;
    const valid=Number.isFinite(value)&&value>=0&&value<=100;
    return {entity,value:valid?value:20,valid};
  }
  batteryThresholdLabel(threshold=this.batteryThreshold()){return `${threshold.valid?'Warnschwelle':'Ersatzschwelle'} ${threshold.value} %`;}
  batteryState(d){
    const entity=d.battery_entity_id;
    const state=entity?this._hass?.states?.[entity]:null;
    const raw=state?.state;
    const value=typeof raw==='string'&&raw.trim()!==''?Number(raw):NaN;
    const percentage=Number.isFinite(value)&&value>=0&&value<=100&&(state?.attributes?.unit_of_measurement==='%'||state?.attributes?.device_class==='battery');
    return {value:percentage?value:null,text:percentage?`Batterie: ${Number(value.toFixed(1))} %`:entity?'Batterie: unbekannt':'Batterie: kein Sensor',low:percentage&&value<this.batteryThreshold().value,title:entity?`Home Assistant: ${entity}${state?.last_updated?' · Aktualisiert: '+dateTimeText(state.last_updated):''}`:'Für dieses Gerät ist kein Batteriestand-Sensor zugeordnet.'};
  }
  batteryTasks(){
    if(!this.data)return [];
    return Object.values(this.data.devices).filter(d=>!d.deleted_at&&!d.in_storage&&!this.archived(d)).flatMap(d=>{
      const b=this.batteryState(d);if(!b.low||d.battery_alert_enabled===false)return [];
      const existing=this.data.views.some(v=>v.device_id===d.id&&['due','overdue','soon'].includes(v.status)&&/batterie/i.test(v.name));
      if(existing)return [];
      return [{rule_id:'battery:'+d.id,device_id:d.id,device_name:d.name,area:d.area,name:'Batterien wechseln',status:'due',due:null,automatic_battery:true,battery_value:b.value}];
    });
  }
  batteryBadge(d){
    if(!d.battery_type&&!d.battery_entity_id)return '';
    const b=this.batteryState(d);
    return `<span class="tag battery-level${b.low?' battery-low':''}" data-battery-device="${E(d.id)}" title="${E(b.title)}">${E(b.text)}</span>`;
  }
  updateBatteryBadges(){
    for(const el of this.shadowRoot.querySelectorAll?.('[data-battery-device]')||[]){
      const d=this.data.devices[el.dataset.batteryDevice];if(!d)continue;
      const b=this.batteryState(d);el.textContent=b.text;el.title=b.title;el.classList.toggle('battery-low',b.low);
    }
  }
  linkedDeviceIds(d){
    return [...new Set([...(d.related_devices||[]).map(link=>link.id),...Object.values(this.data.devices).filter(other=>(other.related_devices||[]).some(link=>link.id===d.id)).map(other=>other.id)])].filter(id=>id!==d.id&&this.data.devices[id]&&!this.data.devices[id].deleted_at).sort((a,b)=>this.data.devices[a].name.localeCompare(this.data.devices[b].name,'de',{sensitivity:'base',numeric:true}));
  }
  haDeviceName(d){return this.reg?.devices?.find(device=>device.id===d.ha_device_id)?.name||d.name;}
  relatedDevices(d){const ids=this.linkedDeviceIds(d);return ids.length?'<section class="device-relations"><h3>Verknüpfte Geräte</h3><div class="device-link-tags">'+ids.map(id=>this.button('record',this.data.devices[id].name,id,'class="tag device-link-tag"')).join('')+'</div></section>':'';}
  bindBatteryFields(dialog){
    const type=dialog.querySelector('[name=battery_type]'),checkbox=dialog.querySelector('[name=battery_alert_enabled]');if(!type||!checkbox)return;
    let hadBattery=!!type.value.trim();const update=()=>{const hasBattery=!!type.value.trim();checkbox.closest('label').hidden=!hasBattery;checkbox.disabled=!hasBattery;const quantity=dialog.querySelector('[name=battery_quantity]');if(quantity){quantity.closest('label').hidden=!hasBattery;quantity.disabled=!hasBattery;}if(!hasBattery)checkbox.checked=false;else if(!hadBattery)checkbox.checked=true;hadBattery=hasBattery;};type.addEventListener('input',update);update();
  }
  relatedDeviceRow(id){
    const target=this.data.devices[id];if(!target||target.deleted_at)return '';
    return `<div class="related-edit-row" data-related-row><div class="related-edit-title"><strong>${E(target.name)}</strong><button type="button" data-related-remove aria-label="${E('Verknüpfung mit '+target.name+' entfernen')}">Entfernen</button></div><input type="hidden" name="related_device_id" value="${E(id)}"></div>`;
  }
  relatedDeviceEditor(d){
    const ids=this.linkedDeviceIds(d);
    return `<section class="related-editor" aria-label="Verknüpfte Geräte bearbeiten"><h3>Verknüpfte Geräte</h3><p class="small sub">Geräte auswählen und verknüpfen. Änderungen werden mit „Speichern“ übernommen.</p><input type="hidden" name="related_self_id" value="${E(d.id||'')}"><div data-related-rows>${ids.map(id=>this.relatedDeviceRow(id)).join('')}</div><label>Gerät suchen<input type="search" data-related-search placeholder="Gerätename, Bereich oder Modell" autocomplete="off"></label><div data-related-results class="related-search-results" aria-live="polite"><p class="small sub">Gerätenamen oder Bereich eingeben.</p></div></section>`;
  }
  bindRelatedDeviceEditor(dialog){
    const editor=dialog.querySelector('.related-editor');if(!editor)return;
    const search=editor.querySelector('[data-related-search]'),rows=editor.querySelector('[data-related-rows]'),results=editor.querySelector('[data-related-results]'),self=editor.querySelector('[name=related_self_id]').value;
    const render=()=>{
      const query=searchText(search.value);if(!query){results.innerHTML='<p class="small sub">Gerätenamen oder Bereich eingeben.</p>';return;}
      const selected=new Set([...rows.querySelectorAll('[name=related_device_id]'),...editor.querySelectorAll('[data-related-exclude]')].map(input=>input.value));
      const found=Object.values(this.data.devices).filter(device=>!device.deleted_at&&device.id!==self&&!selected.has(device.id)&&query.split(' ').every(word=>searchText([device.name,device.area,device.manufacturer,device.model].filter(Boolean).join(' ')).includes(word))).sort((a,b)=>a.name.localeCompare(b.name));
      results.innerHTML=found.slice(0,10).map(device=>`<button type="button" data-related-add="${E(device.id)}"><strong>${E(device.name)}</strong><span class="small sub">${E([device.area,device.manufacturer,device.in_storage?'Lager':this.archived(device)?'Archiv':''].filter(Boolean).join(' / '))}</span></button>`).join('')||(found.length?'':'<p class="small sub">Keine weiteren passenden Geräte gefunden.</p>');
      if(found.length>10)results.innerHTML+='<p class="small sub">10 von '+found.length+' Treffern. Bitte die Suche eingrenzen.</p>';
    };
    search.oninput=render;search.onkeydown=event=>{if(event.key==='Enter')event.preventDefault();};
    editor.onclick=event=>{
      const remove=event.target.closest('[data-related-remove]');if(remove){remove.closest('[data-related-row]').remove();render();return;}
      const add=event.target.closest('[data-related-add]');if(!add)return;
      const id=add.dataset.relatedAdd;if([...editor.querySelectorAll('[data-related-exclude]')].some(input=>input.value===id)||id===self||[...rows.querySelectorAll('[name=related_device_id]')].some(input=>input.value===id))return;
      rows.insertAdjacentHTML('beforeend',this.relatedDeviceRow(id));render();rows.lastElementChild?.querySelector('button')?.focus();
    };
  }
  usageDeviceEditor(ids=[],automatic=[]){
    const auto=new Set(automatic.map(device=>device.id));
    const editor=this.relatedDeviceEditor({related_devices:ids.filter(id=>!auto.has(id)).map(id=>({id}))})
      .replace('<h3>Verknüpfte Geräte</h3>','<h3>Benötigt für</h3>')
      .replace('Geräte auswählen und verknüpfen. Änderungen werden mit „Speichern“ übernommen.','Geräte auswählen, die dieses Verbrauchsmaterial benötigen. Änderungen werden mit „Speichern“ übernommen.');
    return '<div class="usage-editor">'+editor.replace('<div data-related-rows>',automatic.map(device=>`<input type="hidden" data-related-exclude value="${E(device.id)}">`).join('')+(automatic.length?'<p class="small sub">Automatisch über den Batterietyp: '+automatic.map(device=>E(device.name)).join(', ')+'. Diese Zuordnung änderst du in den Gerätedaten.</p>':'')+'<div data-related-rows>')+'</div>';
  }
  usageDeviceLinks(ids=[],options={}){
    const devices=[...new Set(ids)].map(id=>this.data.devices[id]).filter(device=>device&&!device.deleted_at);
    const count=devices.length+' Gerät'+(devices.length===1?'':'e');
    const summary=options.inventory?'<span class="inventory-usage-desktop">Benötigt für '+count+'</span><span class="inventory-usage-mobile">'+count+'</span>':'Benötigt für '+count;
    return '<details class="small material-devices'+(options.inventory?' inventory-usage':'')+'"'+(options.inventory?' data-preserve-key="material-usage:'+E(options.key)+'"':'')+'><summary>'+summary+'</summary><div class="usage-device-tags">'+devices.map(device=>this.button('record',device.name,device.id)).join('')+'</div></details>';
  }
  readRelatedDevices(form){
    const ids=form.getAll('related_device_id'),self=form.get('related_self_id'),seen=new Set();
    return ids.map(id=>{const target=this.data.devices[id];if(!target||target.deleted_at||id===self||seen.has(id))throw Error('Bitte unterschiedliche, vorhandene Geräte verknüpfen.');seen.add(id);return {id};});
  }
  categoryEditor(){return '<h2>Kategorien</h2><p class="sub small">Am Griff ziehen, um die Reihenfolge der Gerätekategorien zu ändern.</p><div class="category-order">'+this.categories().map(name=>{const count=Object.values(this.data.devices).filter(d=>!d.deleted_at&&this.category(d)===name).length;return `<div class="category-order-row" draggable="true" data-category-name="${E(name)}"><span class="category-drag event-type-drag" tabindex="0" role="button" aria-label="${E(name+': Reihenfolge mit Pfeiltasten ändern oder ziehen')}">⠿</span><strong>${E(name)} <span class="small sub">(${count} ${count===1?'Gerät':'Geräte'})</span></strong><div class="actions">${this.button('renamecategory','Umbenennen',name)}${this.button('deletecategory','Entfernen',name)}</div></div>`;}).join('')+'</div>'+this.button('addcategory','Kategorie hinzufügen');}

  async saveEventTypeOrder(order,focusId){
    try{await this.change('save_event_type_order',{order});}catch{this.body();}finally{const section=this.shadowRoot.querySelector('.settings-event-types');if(section){section.open=true;if(focusId)[...section.querySelectorAll('[data-event-type-id]')].find(row=>row.dataset.eventTypeId===focusId)?.querySelector('.event-type-drag')?.focus();}}
  }
  bindEventTypeDrag(){this.bindSortableList({listSelector:'.event-type-list',rowSelector:'[data-event-type-id]',handleSelector:'.event-type-drag',key:'eventTypeId',mime:'application/x-wartung-event-type',getOrder:()=>this.eventTypeOptions().map(([id])=>id),save:(order,focus)=>this.saveEventTypeOrder(order,focus)});}
  bindSortableList({listSelector,rowSelector,handleSelector,key,mime,getOrder,save}){
    const list=this.shadowRoot.querySelector(listSelector);if(!list)return;
    const rows=[...list.querySelectorAll(rowSelector)];let from=null,target=null,after=false;
    const clear=()=>{from=null;target=null;for(const row of rows)row.classList.remove('dragging','drop-target');};
    const mark=(row,y)=>{target=row;after=y>row.getBoundingClientRect().top+row.getBoundingClientRect().height/2;for(const other of rows)other.classList.toggle('drop-target',other===row);};
    const drop=async()=>{const id=from,to=target?.dataset[key],below=after;clear();if(!id||!to||id===to||this.pending)return;const order=getOrder().filter(key=>key!==id);order.splice(order.indexOf(to)+(below?1:0),0,id);await save(order);};
    for(const row of rows){
      row.ondragstart=event=>{if(this.pending||event.target.closest('button')){event.preventDefault();return;}from=row.dataset[key];event.dataTransfer.setData(mime,from);event.dataTransfer.effectAllowed='move';row.classList.add('dragging');};row.ondragend=clear;
      row.ondragover=event=>{if(!from)return;event.preventDefault();event.dataTransfer.dropEffect='move';mark(row,event.clientY);};row.ondrop=async event=>{if(!from)return;event.preventDefault();mark(row,event.clientY);await drop();};
      const handle=row.querySelector(handleSelector);handle.onkeydown=async event=>{if(!['ArrowUp','ArrowDown'].includes(event.key)||this.pending)return;event.preventDefault();const order=getOrder(),index=order.indexOf(row.dataset[key]),next=index+(event.key==='ArrowUp'?-1:1);if(next<0||next>=order.length)return;[order[index],order[next]]=[order[next],order[index]];await save(order,row.dataset[key]);};
      handle.onpointerdown=event=>{if(event.button!==0||this.pending)return;event.preventDefault();from=row.dataset[key];handle.setPointerCapture(event.pointerId);row.classList.add('dragging');};handle.onpointermove=event=>{if(!from)return;const targetRow=this.shadowRoot.elementFromPoint(event.clientX,event.clientY)?.closest(rowSelector);if(targetRow&&list.contains(targetRow))mark(targetRow,event.clientY);};handle.onpointerup=async event=>{if(!from)return;event.preventDefault();await drop();};handle.onpointercancel=clear;
    }
  }
  async saveCategoryOrder(categories,focusName){
    try{await this.change('save_categories',{categories});}catch{this.body();}finally{const section=this.shadowRoot.querySelector('.settings-categories');if(section){section.open=true;if(focusName)[...section.querySelectorAll('[data-category-name]')].find(row=>row.dataset.categoryName===focusName)?.querySelector('.category-drag')?.focus();}}
  }
  bindCategoryDrag(){this.bindSortableList({listSelector:'.category-order',rowSelector:'[data-category-name]',handleSelector:'.category-drag',key:'categoryName',mime:'application/x-wartung-category',getOrder:()=>this.categories(),save:(order,focus)=>this.saveCategoryOrder(order,focus)});}
  categories(){return this.data?.settings?.device_categories||deviceCategories;}
  resolveCategory(value){let result=value;const aliases=this.data?.settings?.category_aliases||{};const seen=new Set();while(aliases[result]&&!seen.has(result)){seen.add(result);result=aliases[result];}return result;}
  category(d){return d.category==='Ohne Kategorie'?'Ohne Kategorie':this.resolveCategory(this.inferCategory(d));}
  displayedCategories(){return [...this.categories(),'Ohne Kategorie'];}
  inferCategory(d){
    if(d.category==='Türmelder')return 'Tür- und Fenstermelder';
    const storedCategory=({'Temperatur und Wetter':'Temperatursensoren','Strom & Smart Home':'Smart Home','Aktoren und Smart Plugs':'Smart Home','Sonos':'Audio und Medien','Audio & Medien':'Audio und Medien','Smart Buttons':'Buttons'})[d.category]||d.category;
    if((deviceCategories.includes(storedCategory)||this.categories().includes(storedCategory)))return storedCategory;
    const text=[d.name,d.model,d.manufacturer].filter(Boolean).join(' ').toLocaleLowerCase();
    if(/heizung|heizkessel|heizkreis|warmwasser|solarthermie|grundfos|cerapur|fw200|ipm1|ism1/.test(text))return 'Heizung';
    if(/asus|sagemcom|connect box/.test(text))return 'Internet und WLAN';
    if(/i-sensys|laserdrucker/.test(text))return 'Netzwerk & Büro';
    if(/shelly|qubino/.test(text)&&/licht|beleuchtung|lampe|leuchte/.test(text))return 'Licht';
    if(/\btv\b|fernseher|homepod|surround|konsole|bildschirm|multimedia|lautsprecher/.test(text))return 'Audio und Medien';
    if(/smart plug|steckdose|inspelning|grillplats/.test(text))return 'Smart Home';
    if(/reolink|kamera|\bcam\b/.test(text))return 'Kameras';
    if(/rauch|gasmelder|gas sensor|gas cng|smoke|pyrexx|protect|careware/.test(text))return 'Gefahrenmelder';
    if(/nuki|schloss|smart lock/.test(text))return 'Zutritt';
    if(/door and window|tür sensor|tuer.*aqara|fenster.*aqara|toerli.*aqara/.test(text))return 'Tür- und Fenstermelder';
    if(/motion|\bpir\b|bewegungsmelder|bewegungssensor/.test(text))return 'Bewegungsmelder';
    if(/smart button|wireless button|4switch|wireless switch with 4 buttons|smart knob|drehknopf|dimmer switch|dimm switch|sound remote/.test(text))return 'Buttons';
    if(/sonos|playbar/.test(text))return 'Audio und Medien';
    if(/storensteuerung|wave shutter/.test(text)||d.device_role==='shutter_controller')return 'Beschattung';
    if(/wetterstation|ecowitt|\bws90\b/.test(text))return 'Garten';
    if(/temperatur|temperature|humidity|feuchtigkeit|timmerflotte/.test(text))return 'Temperatursensoren';
    if(/sensor|wetterstation|ecowitt|vibration/.test(text))return 'Sensoren';
    if(/sonos|symfonisk|playbar|lautsprecher|fernseher/.test(text))return 'Audio und Medien';
    if(/e-bike|ebike|mercedes|peugeot/.test(text))return 'Fahrzeuge';
    if(/automower|husqvarna|wasserventil|rasenmäher/.test(text))return 'Garten';
    if(/shelly|qubino/.test(text))return 'Smart Home';
    if(/lamellenstoren|laden|shutter|rollladen/.test(text))return 'Beschattung';
    if(/lily|hue|licht|dimm|drehknopf/.test(text))return 'Licht';
    if(/wmf|v-zug|miele|bögli|siemens|spülkasten|kaffee|waschmaschine|tumbler|steamer/.test(text))return 'Haushalt';
    return 'Smart Home';
  }
  deviceTaskCounts(){const counts=new Map();for(const v of [...(this.data.views||[]),...this.batteryTasks()])if(['overdue','due','soon','planning','measurement_pending'].includes(v.status))counts.set(v.device_id,(counts.get(v.device_id)||0)+1);return counts;}
  deviceTaskCount(d,counts){if(this.archived(d))return '';const count=(counts||this.deviceTaskCounts()).get(d.id)||0;return count?count+' '+(count===1?'Aufgabe':'Aufgaben'):'';}
  inlineStatus(d){
    if(!d.battery_type&&!d.battery_entity_id)return '';
    return '| '+E(this.batteryState(d).text+' · '+this.batteryThresholdLabel());
  }
  deviceMetadata(d){return [d.ha_device_id?(d.area||'Bereich unbekannt'):null,d.battery_type?'Batterie: '+(d.battery_quantity||1)+' × '+d.battery_type:null,this.deviceMaterialText(d)].filter(Boolean).map(E).join(' / ');}
  deviceList(archived){
    const taskCounts=this.deviceTaskCounts();
    const rows=Object.values(this.data.devices).filter(d=>!d.deleted_at&&this.archived(d)===archived&&(archived||!!d.in_storage===(this.deviceMode==='storage'))&&this.matches(d)).sort((a,b)=>a.name.localeCompare(b.name));
    return this.displayedCategories().map(category=>{const devices=rows.filter(d=>this.category(d)===category);return devices.length?`<section class="device-category"><h3>${E(category)} <span class="tag count-tag">${devices.length}</span></h3><div class="device-grid">${devices.map(d=>{const metadata=this.deviceMetadata(d),taskCount=this.deviceTaskCount(d,taskCounts);return `<div class="row"><div class="device-card-content"><div class="device-card-heading"><div class="device-card-title">${this.button('record',d.name,d.id,'class="device-name"')}${d.manufacturer?` <span class="device-manufacturer">| ${E(d.manufacturer)}</span>`:''} <span class="device-inline-status" data-inline-status-device="${E(d.id)}">${this.inlineStatus(d)}</span></div><span class="tag count-tag device-task-count" data-task-count-device="${E(d.id)}" ${taskCount?'':'hidden'}>${E(taskCount)}</span></div>${metadata?`<div class="meta">${metadata}</div>`:''}</div></div>`;}).join('')}</div></section>`:'';}).join('')||'<p>Keine Geräte.</p>';
  }
  field(name,label,value='',type='text',options=null){if(type==='date'||type==='month')return `<label>${E(label)}<span class="date-input"><input name="${E(name)}" type="text" data-date-format="${type}" value="${E(dateText(value))}" placeholder="${type==='date'?'dd.mm.yy':'mm.yy'}" inputmode="numeric" autocomplete="off"><span class="date-calendar">▦<input type="${type}" value="${E(value||'')}" data-date-picker="${E(name)}" aria-label="${E(label+' im Kalender wählen')}"></span></span></label>`;return `<label>${E(label)}${options?`<select name="${E(name)}">${options.map(o=>{const [v,l]=Array.isArray(o)?o:[o,o];return `<option value="${E(v)}" ${String(v)===String(value??'')?'selected':''}>${E(l)}</option>`;}).join('')}</select>`:type==='textarea'?`<textarea name="${E(name)}">\n${E(value)}</textarea>`:`<input name="${E(name)}" type="${type}" value="${E(value)}" ${type==='number'?'step="any" min="0"':''}>`}</label>`;}
  deviceNotes(d){const notes=typeof d.notes==='string'?d.notes:'';return notes.trim()?'<section class="device-notes" aria-label="Gerätenotizen"><h3>Notizen</h3><p>'+E(notes)+'</p></section>':'';}
  deviceFields(d={}){return `<div class="fields">${this.field('name','Gerätename',d.name)}${this.field('manufacturer','Hersteller',d.manufacturer)}${this.field('model','Modell',d.model)}${this.field('category','Kategorie',d.category?this.category(d):'','text',[['','Automatisch zuordnen'],...this.displayedCategories().map(category=>[category,category])])}${this.field('serial','Seriennummer',d.serial)}${this.field('battery_type','Batterietyp (z. B. AAA oder CR2032)',d.battery_type)}${this.field('battery_quantity','Anzahl Batterien im Gerät',d.battery_quantity??(d.battery_type?Number(d.battery_type.match(/^(\d+)\s*[×x]/)?.[1]||1):''),'number')}<label class="check" ${d.battery_type?.trim()?'':'hidden'}><input type="checkbox" name="battery_alert_enabled" ${d.battery_type?.trim()&&d.battery_alert_enabled!==false?'checked':''} ${d.battery_type?.trim()?'':'disabled'}>Batterieaufgabe unter dem zentralen Schwellenwert (${E(this.batteryThreshold().value)} %) automatisch anzeigen</label>${this.field('device_status','Status',this.archived(d)?'archive':d.in_storage?'storage':'active','text',[['active','Aktiv'],['storage','Lager'],['archive','Archiv'],...(d.id?[['trash','Papierkorb']]:[])])}<p class="small sub device-status-hint" data-device-status-hint aria-live="polite" ${this.archived(d)||d.in_storage?'':'hidden'}>${E(this.deviceStatusHint(this.archived(d)?'archive':d.in_storage?'storage':'active'))}</p><input type="hidden" name="previous_archived_at" value="${E(d.archived_at||'')}">${this.field('purchase_date','Kaufdatum',d.purchase_date,'date')}</div>${this.haDeviceAssignmentFields(d)}${this.field('notes','Notizen',d.notes??'','textarea')}${this.relatedDeviceEditor(d)}`;}
  taskMaterial(r){
    const link=this.ruleMaterialLink(r);if(!link)return null;
    if(link.kind==='battery'){const row=this.batteryInventory().find(row=>row.type===link.id);return {name:link.id,unit:'Stück',quantity:Number(this.data.devices[r.device_id]?.battery_quantity||1),stock:row?.quantity,available:!!row};}
    const m=this.data.settings?.consumables?.[link.id];return {name:m?.name||'Entferntes Material',unit:m?.unit||'Einheiten',quantity:link.quantity??1,stock:m?.quantity,available:!!m};
  }
  materialOptions(){return [['','Kein Verbrauchsmaterial'],...this.batteryInventory().map(row=>['battery:'+row.type,'Batterie · '+row.type]),...Object.values(this.data.settings?.consumables||{}).map(m=>['material:'+m.id,m.name+' ('+m.unit+')'])];}
  ruleMaterialSearchField(name,label,key='',inherit=false){return `<section class="ha-device-assignment" data-rule-material-editor data-inherit="${inherit}"><label>${E(label)}<input type="search" data-rule-material-search placeholder="Batterietyp oder Material suchen" autocomplete="off"></label><input type="hidden" name="${E(name)}" value="${E(key)}"><div class="ha-device-selection"><span data-rule-material-selected class="small" role="status" aria-live="polite"></span><button type="button" data-rule-material-remove>Zuordnung entfernen</button></div><div class="task-device-results" data-rule-material-results role="group" aria-label="Gefundenes Verbrauchsmaterial"></div><p class="small sub" data-rule-material-status role="status" aria-live="polite"></p></section>`;}
  bindRuleMaterialSearch(container){
    const options=this.materialOptions().slice(1).sort((a,b)=>a[1].localeCompare(b[1],'de',{sensitivity:'base',numeric:true}));
    for(const editor of container.querySelectorAll('[data-rule-material-editor]')){
      const input=editor.querySelector('[data-rule-material-search]'),selected=editor.querySelector('input[type=hidden]'),caption=editor.querySelector('[data-rule-material-selected]'),remove=editor.querySelector('[data-rule-material-remove]'),results=editor.querySelector('[data-rule-material-results]'),status=editor.querySelector('[data-rule-material-status]');let matches=[];
      const render=()=>{const current=options.find(option=>option[0]===selected.value);caption.textContent=selected.value?'Zugeordnet: '+(current?current[1]:'Bisheriges Material (nicht mehr verfügbar)'):editor.dataset.inherit==='true'?'Allgemeine Auswahl':'Kein Verbrauchsmaterial';remove.hidden=!selected.value;
        const query=input.value.trim();matches=query?options.filter(option=>this.searchWordsMatch(query,option)):[];results.innerHTML=matches.slice(0,15).map(([key,label])=>`<button type="button" data-rule-material-choice="${E(key)}" aria-pressed="${selected.value===key}"><strong>${E(label)}</strong></button>`).join('');status.textContent=!query?'Verbrauchsmaterial suchen und aus den Treffern auswählen.':!matches.length?'Kein passendes Verbrauchsmaterial gefunden.':matches.length>15?'15 von '+matches.length+' Artikeln. Suche eingrenzen.':'Bitte das passende Verbrauchsmaterial auswählen.';
      };
      const choose=key=>{if(key&&!options.some(option=>option[0]===key))return;selected.value=key;input.value='';render();selected.dispatchEvent(new Event('change',{bubbles:true}));};
      input.oninput=render;results.onclick=event=>{const button=event.target.closest('[data-rule-material-choice]');if(button)choose(button.dataset.ruleMaterialChoice);};remove.onclick=()=>choose('');
      input.onkeydown=event=>{if(event.key==='ArrowDown'){event.preventDefault();results.querySelector('button')?.focus();}else if(event.key==='Enter'){event.preventDefault();if(matches.length===1)choose(matches[0][0]);else status.textContent='Bitte einen Artikel aus den Treffern auswählen.';}};render();
    }
  }
  rotationMaterialFields(r,steps=r.steps||[]){return [...new Set(steps)].map(step=>{const link=r.consumables_by_step?.[step],key=link?link.kind+':'+link.id:'';return '<div class="rotation-material-row"><input type="hidden" name="step_material_name" value="'+E(step)+'">'+this.ruleMaterialSearchField('step_material_key',step,key,true)+this.field('step_material_quantity','Menge (Batterien: Anzahl aus Gerät)',link?.quantity??1,'number')+'</div>';}).join('')||'<p class="small sub">Zuerst die Arbeitsschritte der Rotation eingeben.</p>';}
  readStepMaterials(form){const names=form.getAll('step_material_name'),keys=form.getAll('step_material_key'),quantities=form.getAll('step_material_quantity');return Object.fromEntries(names.map((name,index)=>{const key=String(keys[index]||''),split=key.indexOf(':');return [name,key?{kind:key.slice(0,split),id:key.slice(split+1),...(key.startsWith('material:')?{quantity:Number(quantities[index]||1)}:{})}:null];}).filter(([,link])=>link));}
  ruleMaterialFields(r){
    const key=r.consumable?r.consumable.kind+':'+r.consumable.id:'';
    return '<h3>Verbrauchsmaterial</h3>'+this.ruleMaterialSearchField('consumable_key','Bei Erledigung Bestand reduzieren',key)+'<div data-material-quantity>'+this.field('consumable_quantity','Verbrauchsmenge pro Erledigung',r.consumable?.quantity??1,'number')+'</div><p data-battery-quantity-hint class="small sub">Bei Batterien wird die Anzahl aus den Gerätedaten verwendet. Der Abzug wird beim Erledigen abgefragt.</p><div data-rotation-materials><h4>Verbrauchsmaterial je Arbeitsschritt</h4><p class="small sub">Die Zuordnung je Schritt hat Vorrang vor der allgemeinen Auswahl.</p><div data-step-materials>'+this.rotationMaterialFields(r)+'</div></div>';
  }
  bindRuleMaterial(dialog){
    const selected=dialog.querySelector('[name=consumable_key]');if(!selected)return;
    const kind=dialog.querySelector('[name=kind]'),steps=dialog.querySelector('[name=rotation_steps]'),stepRows=dialog.querySelector('[data-step-materials]');
    const update=()=>{const generic=selected.value.startsWith('material:');dialog.querySelector('[data-material-quantity]').hidden=!generic;dialog.querySelector('[name=consumable_quantity]').disabled=!generic;dialog.querySelector('[data-battery-quantity-hint]').hidden=!selected.value.startsWith('battery:');dialog.querySelector('[data-rotation-materials]').hidden=kind.value!=='rotation';for(const row of stepRows.querySelectorAll('.rotation-material-row')){const battery=row.querySelector('[name=step_material_key]').value.startsWith('battery:');row.querySelector('[name=step_material_quantity]').closest('label').hidden=battery;}};
    selected.onchange=update;kind.addEventListener('change',update);stepRows.addEventListener('change',update);this.bindRuleMaterialSearch(dialog);
    steps.addEventListener('change',()=>{const current=this.readStepMaterials(new FormData(dialog.querySelector('form')));stepRows.innerHTML=this.rotationMaterialFields({consumables_by_step:current},steps.value.split('\n').map(s=>s.trim()).filter(Boolean));this.prepareNumberInputs(stepRows);this.bindRuleMaterialSearch(stepRows);update();});update();
  }
  materialConsumptionQuestion(r){const m=this.taskMaterial(r);if(!m)return '';const usable=m.available&&m.stock!=null;return '<section><h3>Verbrauchsmaterial</h3><label class="check"><input type="checkbox" name="consume_material" '+(usable?'checked':'disabled')+'><span>'+E(m.name)+' um '+E(m.quantity)+' '+E(m.unit)+' reduzieren?</span></label><p class="small sub">'+(usable?'Bestand: '+E(m.stock)+' → '+E(Math.round((m.stock-m.quantity)*1e8)/1e8)+'. Für eine Erledigung ohne Abzug Häkchen entfernen.':'Material oder Bestand nicht verfügbar. Die Aufgabe kann ohne Bestandsabzug erledigt werden.')+'</p></section>';}
  ruleFields(r={},deviceId){return `${this.field('name','Aufgabe',r.name)}${this.field('kind','Fälligkeitsregel',r.kind||'date','text',[['none','Ohne'],['date','Termin'],['interval','Intervall / Einplanen'],['season','Jährliche Saison'],['measurement','Messwert'],['rotation','Wartungsrotation'],['on_demand','Nach Geräteanzeige']])}<div data-kind="none"><p class="small sub">Kein Termin und keine Wiederholung. Nach dem Erledigen ist die Aufgabe abgeschlossen.</p></div><div data-kind="date">${this.field('due_date','Termin',r.due_date,'date')}<p class="small sub">Einmalige Aufgabe an diesem Datum.</p></div><div data-kind="interval" class="fields">${this.field('months','Monate (0 = offen)',r.months||0,'number')}${this.field('days','Zusätzliche Tage',r.days||0,'number')}${this.field('first_due','Erster / einmaliger Plantermin',r.first_due,'date')}${this.field('first_due_period','Alternativ nur erster Planmonat',r.first_due_period,'month')}</div><div data-kind="rotation">${this.field('rotation_steps','Reihenfolge (ein Arbeitsschritt pro Zeile)',(r.steps||[]).join('\n'),'textarea')}${this.field('rotation_months','Monate zwischen den Arbeiten',r.months||2,'number')}${this.field('rotation_first_due','Erster Plantermin',r.first_due,'date')}<p class="small">Nach Erledigung folgt der nächste Schritt ab dem tatsächlichen Datum. Am Ende beginnt die Reihenfolge erneut.</p></div><div data-kind="season" class="fields">${this.field('month','Kalendermonat',r.month||11,'number')}${this.field('day','Kalendertag',r.day||1,'number')}${this.field('first_cycle','Erster Saisonzyklus (Jahr)',r.first_cycle||Number(this.data.today.slice(0,4)),'number')}${this.field('weekday','Termin am nächsten Wochentag zum Kalendertag',r.weekday??'','text',[['','Genau am Kalendertag'],[0,'Montag'],[1,'Dienstag'],[2,'Mittwoch'],[3,'Donnerstag'],[4,'Freitag'],[5,'Samstag'],[6,'Sonntag']])}</div><div data-kind="measurement">${this.ruleSensorFields(r,deviceId)}${this.field('threshold','Fällig unter',r.threshold??20,'number')}<p class="small sub">Verwendet den von Home Assistant gemeldeten Sensorwert. Unbekannte oder nicht verfügbare Werte lösen keine Aufgabe aus.</p></div>${this.field('booked','Gebuchter Ausführungstermin',r.booked,'date')}${this.field('review_note','Hinweis / offene Frage',r.review_note,'textarea')}${this.ruleMaterialFields(r)}`;}
  prepareNumberInputs(dialog){
    for(const input of dialog.querySelectorAll('input[type=number]')){
      const initial=input.getAttribute('value')??input.value;input.type='text';input.inputMode='decimal';input.lang='en';input.dataset.numberFormat='point';input.setAttribute('role','spinbutton');input.value=decimalInputText(initial);
      for(const bound of ['min','max'])if(input.hasAttribute(bound))input.setAttribute('aria-value'+bound,input.getAttribute(bound));
      const sync=()=>{const value=Number(input.value);if(input.value.trim()&&Number.isFinite(value))input.setAttribute('aria-valuenow',String(value));else input.removeAttribute('aria-valuenow');};
      input.addEventListener('input',()=>{const start=input.selectionStart,end=input.selectionEnd,normalized=decimalInputText(input.value);if(normalized!==input.value){const before=input.value;input.value=normalized;if(start!=null&&end!=null)input.setSelectionRange(decimalInputText(before.slice(0,start)).length,decimalInputText(before.slice(0,end)).length);}sync();});
      input.addEventListener('blur',()=>{input.value=decimalInputText(input.value).trim();sync();});
      input.addEventListener('keydown',event=>{if(!['ArrowUp','ArrowDown'].includes(event.key)||input.disabled||input.readOnly)return;event.preventDefault();const current=Number(decimalInputText(input.value)),step=input.step&&input.step!=='any'?Number(input.step):1;if(!Number.isFinite(current)||!Number.isFinite(step))return;let value=Math.round((current+(event.key==='ArrowUp'?step:-step))*1e10)/1e10;if(input.min!=='')value=Math.max(Number(input.min),value);if(input.max!=='')value=Math.min(Number(input.max),value);input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));});sync();
    }
  }
  normalizeNumberInputs(form){
    for(const input of form.querySelectorAll('[data-number-format=point]')){
      if(input.disabled||input.closest('[hidden]'))continue;
      const text=decimalInputText(input.value).replace(/\s/g,'');if(!text){input.value='';continue;}
      const value=Number(text),label=input.getAttribute('aria-label')||input.closest('label')?.textContent.trim()||'Zahl';
      const invalid=()=>{input.focus();throw Error('Bitte bei „'+label+'“ eine gültige Zahl mit Dezimalpunkt eingeben.');};
      if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)||!Number.isFinite(value))invalid();
      if((input.min!==''&&value<Number(input.min))||(input.max!==''&&value>Number(input.max))){input.focus();throw Error('„'+label+'“ muss '+(input.min!==''?'mindestens '+input.min:'')+(input.min!==''&&input.max!==''?' und ':'')+(input.max!==''?'höchstens '+input.max:'')+' sein.');}
      if(input.step&&input.step!=='any'){const steps=(value-Number(input.min||0))/Number(input.step);if(Math.abs(steps-Math.round(steps))>1e-7){input.focus();throw Error('Bitte „'+label+'“ in Schritten von '+input.step+' eingeben.');}}
      input.value=String(value);input.setAttribute('aria-valuenow',input.value);
    }
  }
  modal(title,html,onSave,save='Speichern',footer=''){const d=this.shadowRoot.querySelector('dialog');d.innerHTML=`<form><h2>${E(title)}</h2>${html}<p class="errors" role="alert"></p><div class="footer">${footer}<button type="button" data-action="cancel">Abbrechen</button><button class="primary" type="submit">${E(save)}</button></div></form>`;this.dialogOpen=true;d.showModal();this.prepareNumberInputs(d);this.bindRelatedDeviceEditor(d);this.bindTaskDeviceSearch(d);this.bindHaDeviceSearch(d);this.bindRuleSensorSearch(d);this.bindCompletionDate(d);this.bindDeviceStatusHint(d);this.bindBatteryFields(d);this.bindRuleMaterial(d);d.oncancel=()=>{this.dialogOpen=false;this.scheduleBackgroundFlush();};d.querySelector('form').onsubmit=async e=>{e.preventDefault();const b=d.querySelector('[type=submit]');if(b.disabled)return;b.disabled=true;try{this.normalizeNumberInputs(e.target);const values=new FormData(e.target);for(const input of e.target.querySelectorAll('[data-date-format]'))values.set(input.name,dateInputValue(input.value,input.dataset.dateFormat));await onSave(values);}catch(error){d.querySelector('.errors').textContent=errorMessage(error);}finally{b.disabled=false;}};d.onclick=event=>{const button=event.target.closest('[data-stock-step]');if(button){const input=d.querySelector('[name=quantity]');const value=Number(input.value);input.value=String(Math.max(Number(input.min||-100000),Math.min(Number(input.max||100000),(Number.isFinite(value)?value:0)+Number(button.dataset.stockStep))));input.dispatchEvent(new Event('input',{bubbles:true}));}};d.oninput=event=>{const input=event.target;if(input.hasAttribute('data-bulk-filter')){const words=searchText(input.value).split(' ');for(const row of d.querySelectorAll('[data-bulk-search]'))row.hidden=!words.every(word=>searchText(row.dataset.bulkSearch).includes(word));}if(input.dataset.datePicker){const text=d.querySelector('[name="'+CSS.escape(input.dataset.datePicker)+'"]');if(text)text.value=dateText(input.value);}};const kind=d.querySelector('[name=kind]');if(kind){const update=()=>{d.querySelectorAll('[data-kind]').forEach(el=>el.hidden=el.dataset.kind!==kind.value);const booked=d.querySelector('[name=booked]');if(booked)booked.closest('label').hidden=kind.value==='none';};kind.onchange=update;update();}}
  close(){this.dialogOpen=false;this.shadowRoot.querySelector('dialog')?.close();this.scheduleBackgroundFlush();}
  haDeviceAssignmentFields(d){return `<section class="ha-device-assignment"><label>Home Assistant Gerätezuordnung<input type="search" data-ha-device-search placeholder="Gerätename, Hersteller, Modell oder Bereich suchen" autocomplete="off"></label><input type="hidden" name="ha_device_id" value="${E(d.ha_device_id||'')}"><div class="ha-device-selection"><span data-ha-device-selected class="small" role="status" aria-live="polite"></span><button type="button" data-ha-device-remove>Zuordnung entfernen</button></div><div class="task-device-results" data-ha-device-results role="group" aria-label="Gefundene Home Assistant Geräte"></div><p class="small sub" data-ha-device-status role="status" aria-live="polite"></p></section>`;}
  ruleSensorFields(r,deviceId){return `<section class="ha-device-assignment" data-rule-sensor-editor data-device-id="${E(deviceId)}"><label>Sensor (zu diesem Gerät)<input type="search" data-rule-sensor-search placeholder="Sensorname oder Entitäts-ID suchen" autocomplete="off"></label><input type="hidden" name="sensor_registry_id" value="${E(r.sensor_registry_id||'')}"><div class="ha-device-selection"><span data-rule-sensor-selected class="small" role="status" aria-live="polite"></span><button type="button" data-rule-sensor-remove>Zuordnung entfernen</button></div><output data-rule-sensor-value class="small" role="status" aria-live="polite" hidden></output><div class="task-device-results" data-rule-sensor-results role="group" aria-label="Gefundene Sensoren"></div><p class="small sub" data-rule-sensor-status role="status" aria-live="polite"></p></section>`;}
  updateRuleSensorValue(dialog=this.shadowRoot?.querySelector?.('dialog')){
    const output=dialog?.querySelector('[data-rule-sensor-value]');if(!output)return;
    const id=dialog.querySelector('[name=sensor_registry_id]')?.value;output.hidden=!id;
    if(!id){output.textContent='';return;}
    const sensor=this.reg?.sensors?.find(sensor=>sensor.id===id),state=this._hass?.states?.[sensor?.entity_id];
    const value=String(state?.state??'').trim(),unit=String(state?.attributes?.unit_of_measurement??'').trim();
    const text=!state||!value||state.attributes?.restored===true||value==='unavailable'?'nicht verfügbar':value==='unknown'?'unbekannt':[value,unit].filter(Boolean).join(' ');
    const label='Aktueller Wert: '+text;if(output.textContent!==label)output.textContent=label;
  }
  bindRuleSensorSearch(dialog){
    const editor=dialog.querySelector('[data-rule-sensor-editor]');if(!editor)return;
    const input=editor.querySelector('[data-rule-sensor-search]'),selected=editor.querySelector('[name=sensor_registry_id]'),caption=editor.querySelector('[data-rule-sensor-selected]'),remove=editor.querySelector('[data-rule-sensor-remove]'),results=editor.querySelector('[data-rule-sensor-results]'),status=editor.querySelector('[data-rule-sensor-status]');
    const device=this.data.devices[editor.dataset.deviceId]||{},all=this.reg.sensors||[],sensors=all.filter(sensor=>!sensor.disabled&&(!device.ha_device_id||sensor.device_id===device.ha_device_id)).sort((a,b)=>(a.name||a.entity_id).localeCompare(b.name||b.entity_id,'de',{sensitivity:'base',numeric:true}));let matches=[];
    const render=()=>{const current=all.find(sensor=>sensor.id===selected.value);caption.textContent=selected.value?'Zugeordnet: '+(current?`${current.name||current.entity_id} · ${current.entity_id}`:'Bisheriger Sensor (in Home Assistant nicht gefunden)'):'Keine Sensor-Anbindung';remove.hidden=!selected.value;this.updateRuleSensorValue(dialog);
      const query=input.value.trim();matches=query?sensors.filter(sensor=>this.searchWordsMatch(query,[sensor.name,sensor.entity_id,sensor.platform])):[];results.innerHTML=matches.slice(0,15).map(sensor=>`<button type="button" data-rule-sensor-choice="${E(sensor.id)}" aria-pressed="${selected.value===sensor.id}"><strong>${E(sensor.name||sensor.entity_id)}</strong><span class="small sub">${[sensor.entity_id,sensor.platform].filter(Boolean).map(E).join(' / ')}</span></button>`).join('');status.textContent=!query?'Sensor suchen und aus den Treffern auswählen.':!matches.length?'Keine passenden Sensoren gefunden.':matches.length>15?'15 von '+matches.length+' Sensoren. Suche eingrenzen.':'Bitte den passenden Sensor auswählen.';
    };
    const choose=id=>{if(!sensors.some(sensor=>sensor.id===id))return;selected.value=id;input.value='';render();};
    input.oninput=()=>{selected.value='';render();};results.onclick=event=>{const button=event.target.closest('[data-rule-sensor-choice]');if(button)choose(button.dataset.ruleSensorChoice);};remove.onclick=()=>{selected.value='';input.value='';render();};
    input.onkeydown=event=>{if(event.key==='ArrowDown'){event.preventDefault();results.querySelector('button')?.focus();}else if(event.key==='Enter'){event.preventDefault();if(matches.length===1)choose(matches[0].id);else status.textContent='Bitte einen Sensor aus den Treffern auswählen.';}};render();
  }
  completionDateLabel(value){if(value===this.data.today)return 'Heute';const yesterday=new Date(this.data.today+'T12:00:00Z');yesterday.setUTCDate(yesterday.getUTCDate()-1);if(value===yesterday.toISOString().slice(0,10))return 'Gestern';const day=['So','Mo','Di','Mi','Do','Fr','Sa'][new Date(value+'T12:00:00Z').getUTCDay()];return day+', '+dateText(value);}
  completionDateFields(){return `<div class="completion-date-stepper" role="group" aria-label="Erledigungsdatum"><button type="button" data-completion-step="-1" aria-label="Einen Tag früher">−</button><span class="completion-date-picker"><output data-completion-date aria-live="polite">Heute</output><input type="date" data-completion-picker aria-label="Erledigungsdatum im Kalender auswählen" title="Datum im Kalender auswählen" min="1900-01-01" max="${E(this.data.today)}" value="${E(this.data.today)}"></span><button type="button" data-completion-step="1" aria-label="Einen Tag später" disabled>+</button><input type="hidden" name="event_date" value="${E(this.data.today)}"></div>`;}
  bindCompletionDate(dialog){const group=dialog.querySelector('.completion-date-stepper');if(!group)return;const input=group.querySelector('[name=event_date]'),output=group.querySelector('[data-completion-date]'),picker=group.querySelector('[data-completion-picker]'),plus=group.querySelector('[data-completion-step="1"]'),minus=group.querySelector('[data-completion-step="-1"]');const update=value=>{if(!value||value>this.data.today||value<'1900-01-01'){picker.value=input.value;return;}input.value=picker.value=value;output.textContent=this.completionDateLabel(value);plus.disabled=value>=this.data.today;minus.disabled=value<='1900-01-01';};picker.oninput=picker.onchange=()=>update(picker.value);for(const button of group.querySelectorAll('[data-completion-step]'))button.onclick=()=>{const date=new Date(input.value+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+Number(button.dataset.completionStep));update(date.toISOString().slice(0,10));};}
  bindHaDeviceSearch(dialog){
    const input=dialog.querySelector('[data-ha-device-search]');if(!input)return;
    const selected=dialog.querySelector('[name=ha_device_id]'),caption=dialog.querySelector('[data-ha-device-selected]'),remove=dialog.querySelector('[data-ha-device-remove]'),results=dialog.querySelector('[data-ha-device-results]'),status=dialog.querySelector('[data-ha-device-status]');
    const devices=(this.reg.devices||[]).filter(device=>!device.disabled).sort((a,b)=>a.name.localeCompare(b.name,'de',{sensitivity:'base',numeric:true}));let matches=[];
    const render=()=>{const current=(this.reg.devices||[]).find(device=>device.id===selected.value);caption.textContent=selected.value?'Zugeordnet: '+(current?.name||'Bisheriges Gerät (in Home Assistant nicht gefunden)'):'Keine Zuordnung · Manuelles Gerät';remove.hidden=!selected.value;
      const query=input.value.trim();matches=query?devices.filter(device=>this.searchWordsMatch(query,[device.name,device.manufacturer,device.model,device.area])):[];results.innerHTML=matches.slice(0,15).map(device=>`<button type="button" data-ha-device-choice="${E(device.id)}" aria-pressed="${selected.value===device.id}"><strong>${E(device.name)}</strong>${[device.manufacturer,device.model,device.area].filter(Boolean).length?`<span class="small sub">${[device.manufacturer,device.model,device.area].filter(Boolean).map(E).join(' / ')}</span>`:''}</button>`).join('');status.textContent=!query?'Zum Ändern ein Gerät suchen und auswählen.':!matches.length?'Keine passenden Home Assistant Geräte gefunden.':matches.length>15?'15 von '+matches.length+' Geräten. Suche eingrenzen.':'Bitte das passende Gerät auswählen.';
    };
    const choose=id=>{if(!devices.some(device=>device.id===id))return;selected.value=id;input.value='';render();};
    input.oninput=render;results.onclick=event=>{const button=event.target.closest('[data-ha-device-choice]');if(button)choose(button.dataset.haDeviceChoice);};remove.onclick=()=>{selected.value='';input.value='';render();};
    input.onkeydown=event=>{if(event.key==='ArrowDown'){event.preventDefault();results.querySelector('button')?.focus();}else if(event.key==='Enter'&&input.value.trim()){event.preventDefault();if(matches.length===1)choose(matches[0].id);else status.textContent='Bitte ein Gerät aus den Treffern auswählen.';}};render();
  }
  bindTaskDeviceSearch(dialog){
    const input=dialog.querySelector('[data-task-device-search]');if(!input)return;
    const results=dialog.querySelector('[data-task-device-results]'),selected=dialog.querySelector('[name=device_id]'),status=dialog.querySelector('[data-task-device-status]');
    const devices=Object.values(this.data.devices).filter(device=>!device.deleted_at&&!device.in_storage&&!this.archived(device)).sort((a,b)=>a.name.localeCompare(b.name,'de',{sensitivity:'base',numeric:true}));let matches=[];
    const render=()=>{matches=devices.filter(device=>this.searchWordsMatch(input.value,[device.name,device.area,device.manufacturer,device.model]));results.innerHTML=matches.slice(0,15).map(device=>`<button type="button" data-task-device-choice="${E(device.id)}" aria-pressed="${selected.value===device.id}"><strong>${E(device.name)}</strong>${[device.area,device.model].filter(Boolean).length?`<span class="small sub">${[device.area,device.model].filter(Boolean).map(E).join(' / ')}</span>`:''}</button>`).join('');status.textContent=selected.value?'Ausgewählt: '+devices.find(device=>device.id===selected.value).name:!matches.length?'Keine passenden Geräte gefunden.':matches.length>15?'15 von '+matches.length+' Geräten. Suche eingrenzen.':'Bitte ein Gerät auswählen.';};
    const choose=id=>{const device=devices.find(device=>device.id===id);if(!device)return;selected.value=id;input.value=device.name;render();};
    results.onclick=event=>{const button=event.target.closest('[data-task-device-choice]');if(button)choose(button.dataset.taskDeviceChoice);};
    input.oninput=()=>{selected.value='';render();};input.onkeydown=event=>{if(event.key==='ArrowDown'){event.preventDefault();results.querySelector('button')?.focus();}else if(event.key==='Enter'&&!selected.value&&matches.length===1){event.preventDefault();choose(matches[0].id);}};render();
  }
  deviceModeHint(status){return status==='trash'?'Geräte im Papierkorb erscheinen nicht in Aufgaben oder Meldungen. Ihre Historie bleibt wiederherstellbar. Beim Leeren des Papierkorbs werden die Geräte samt Aufgaben und Historie endgültig entfernt.':this.deviceStatusHint(status);}
  deviceStatusHint(status){return status==='trash'?'Beim Speichern wird das Gerät samt Aufgaben und Historie in den Papierkorb verschoben. Es erscheint nicht mehr in Aufgaben oder Meldungen und kann unter Geräte → Papierkorb wiederhergestellt werden.':status==='storage'?'Lagergeräte sind noch vorhanden, aber aktuell nicht im Einsatz. Sie können später wieder aktiviert werden. Automatische Aufgaben und Meldungen sind ausgesetzt.':status==='archive'?'Archivierte Geräte sind dauerhaft ausser Betrieb, zum Beispiel verkauft, entsorgt oder ersetzt. Geräteakte und Historie bleiben erhalten; automatische Aufgaben und Meldungen entfallen.':'';}
  bindDeviceStatusHint(dialog){const select=dialog.querySelector('[name=device_status]'),hint=dialog.querySelector('[data-device-status-hint]');if(!select||!hint)return;const update=()=>{hint.textContent=this.deviceStatusHint(select.value);hint.hidden=!hint.textContent;};select.oninput=select.onchange=update;update();}
  readDevice(f){const status=f.get('device_status')||'active';if(!['active','storage','archive','trash'].includes(status))throw Error('Bitte einen gültigen Gerätestatus auswählen.');return {device_status:status,notes:String(f.get('notes')??''),related_devices:this.readRelatedDevices(f),...Object.fromEntries(['name','manufacturer','model','serial','battery_type','purchase_date','ha_device_id','category'].map(k=>[k,f.get(k)||null])),battery_quantity:String(f.get('battery_type')||'').trim()?Number(f.get('battery_quantity')||1):null,in_storage:status==='storage',archived:status==='archive',archived_at:status==='archive'?(f.get('previous_archived_at')||this.data.today):null,battery_alert_enabled:!!String(f.get('battery_type')||'').trim()&&f.get('battery_alert_enabled')==='on'};}
  readRule(f){const kind=f.get('kind');const key=String(f.get('consumable_key')||''),split=key.indexOf(':');const r={consumables_by_step:kind==='rotation'?this.readStepMaterials(f):{},consumable:key?{kind:key.slice(0,split),id:key.slice(split+1),...(key.startsWith('material:')?{quantity:Number(f.get('consumable_quantity')||1)}:{})}:null,name:f.get('name'),kind,booked:kind==='none'?null:f.get('booked')||null,review_note:f.get('review_note')||''};if(kind==='date')r.due_date=f.get('due_date')||null;if(kind==='interval')Object.assign(r,{months:Number(f.get('months')),days:Number(f.get('days')),first_due:f.get('first_due')||null,first_due_period:f.get('first_due_period')||null});if(kind==='rotation')Object.assign(r,{steps:String(f.get('rotation_steps')||'').split('\n').map(s=>s.trim()).filter(Boolean),months:Number(f.get('rotation_months')),first_due:f.get('rotation_first_due')||null});if(kind==='season')Object.assign(r,{month:Number(f.get('month')),day:Number(f.get('day')),first_cycle:Number(f.get('first_cycle')),weekday:f.get('weekday')===''||f.get('weekday')===null?null:Number(f.get('weekday'))});if(kind==='measurement')Object.assign(r,{sensor_registry_id:f.get('sensor_registry_id'),threshold:Number(f.get('threshold'))});return r;}
  async act(action,id){const data=this.data;
    if(action==='checkdata'){await this.runDataCheck();return;}
    if(action==='dismissundo'){this.clearCompletionUndo(id);return;}
    if(action==='undocomplete'){
      if(this.pending||this.undoEntry?.id!==id)return;
      const result=await this.change('undo_completion',{id});
      if(result){this.clearCompletionUndo(id);this.notice('Erledigung rückgängig gemacht.');}return;
    }
    if(action==='initialcapture'){await this.initialCapture();return;}
    if(action==='sidebarmenu'){this.dispatchEvent(new CustomEvent('hass-toggle-menu',{bubbles:true,composed:true}));return;}
    if(action==='tab'){this.tab=id;this.selected=null;this.draw();return;}
    if(action==='inventorylayout'){this.inventoryLayout=id==='list'?'list':'cards';this.body();return;}
    if(action==='devicemode'){this.deviceMode=['archive','storage','trash'].includes(id)?id:'active';this.selected=null;this.body();return;}
    if(action==='clearsearch'){this[this.searchKey()]='';const input=this.shadowRoot.querySelector('#search');input.value='';this.shadowRoot.querySelector('#clearsearch').hidden=true;this.body();input.focus();return;}
    if(action==='cancel'){this.close();return;}
    if(action==='record'){this.tab='devices';this.selected=id;this.draw();return;}
    if(action==='back'){this.selected=null;this.body();return;}
    if(action==='device'){const d=data.devices[id]||{};this.modal(id?'Daten bearbeiten':'Gerät anlegen',this.deviceFields(d),async f=>{const value=this.readDevice(f);await this.change('save_device',{value:{...value,...(id?{id}:{})}});this.deviceMode=value.device_status;if(value.device_status==='trash')this.selected=null;this.body();});return;}
    if(action==='addtask'){
      const devices=Object.values(data.devices).filter(device=>!device.deleted_at&&!device.in_storage&&!this.archived(device)).sort((a,b)=>a.name.localeCompare(b.name,'de',{sensitivity:'base',numeric:true}));
      if(!devices.length)throw Error('Bitte zuerst ein Gerät anlegen.');
      this.modal('Aufgabe hinzufügen','<label>Gerät suchen<input type="search" data-task-device-search placeholder="Gerätename, Bereich oder Modell" autocomplete="off"></label><input type="hidden" name="device_id"><div class="task-device-results" data-task-device-results role="group" aria-label="Gefundene Geräte"></div><p class="small sub" data-task-device-status role="status" aria-live="polite"></p>',async form=>{const deviceId=form.get('device_id');if(!devices.some(device=>device.id===deviceId))throw Error('Bitte ein Gerät auswählen.');this.close();await this.act('newrule',deviceId);},'Weiter');return;
    }
    if(action==='rule'||action==='newrule'){const r=data.rules[id]||{};const deviceId=r.device_id||id;this.modal('Wartungsaufgabe',this.ruleFields(r,deviceId),f=>this.change('save_rule',{value:{...this.readRule(f),device_id:deviceId,...(r.id?{id:r.id}:{})}}));return;}
    if(action==='today'||action==='completion'){const r=data.rules[id],v=data.views.find(v=>v.rule_id===id);const operation_id=operationId();this.modal('Erledigung erfassen','<p><strong>'+E(v?.name||r.name)+'</strong></p>'+this.materialConsumptionQuestion(r)+this.completionDateFields()+(r.kind==='season'?this.field('cycle','Zuordnung zum Saisonzyklus',v.cycle,'number'):'')+this.field('note','Notiz','','textarea')+this.field('cost','Kosten in '+this.currency()+' (optional)','','number')+(r.kind==='measurement'?this.field('measurement','Neue Messung bestätigen (optional)','','number'):''),async f=>{await this.change('complete',{rule_id:id,operation_id,consume_material:f.has('consume_material'),event_date:f.get('event_date'),note:r.kind==='rotation'?f.get('note'):[r.name,f.get('note')].filter(Boolean).join(' — '),cost:f.get('cost')===''?null:Number(f.get('cost')),cycle:r.kind==='season'?Number(f.get('cycle')):r.kind==='rotation'?v.cycle:null,...(f.get('measurement')!==null&&f.get('measurement')!==''?{measurement:Number(f.get('measurement'))}:{})});},'Erledigung speichern');return;}
    if(action==='deleterule'){
      const r=data.rules[id];if(!r)throw Error('Aufgabe wurde nicht gefunden.');
      const device=data.devices[r.device_id];
      this.modal('Aufgabe entfernen',`<p>Die Aufgabe «${E(r.name)}» für ${E(device.name)} entfernen?</p><p>Die Geräteakte und die bisherigen Historieneinträge bleiben erhalten. Die Aufgabe erscheint danach nicht mehr in der Aufgabenliste oder Wochenmeldung.</p>`,
        ()=>this.change('delete_rule',{id,confirmed:true}),'Aufgabe entfernen');return;
    }
    if(action==='deletebattery'){
      const device=data.devices[id];if(!device)throw Error('Gerät wurde nicht gefunden.');
      this.modal('Batterieaufgabe entfernen',`<p>Die automatische Batterieaufgabe für ${E(device.name)} deaktivieren?</p><p>Der Batteriestand bleibt sichtbar. Du kannst die automatische Aufgabe in den Stammdaten des Geräts wieder einschalten.</p>`,()=>this.change('save_device',{value:{id,battery_alert_enabled:false}}),'Aufgabe entfernen');return;
    }
    if(action==='material'){
      const m=data.settings?.consumables?.[id]||{};
      this.modal('Verbrauchsmaterial',this.field('name','Bezeichnung',m.name||'')+this.field('unit','Einheit (z. B. Säcke, kg, Stück)',m.unit||'Stück')+this.field('quantity','Aktueller Bestand (leer = unbekannt)',m.quantity??'','number').replace('min="0"','min="-100000" max="100000"')+this.field('threshold','Nachkaufen bei diesem Bestand oder weniger',m.threshold??1,'number')+this.field('notes','Notizen',m.notes??'','textarea')+this.shopField(m.shop_url||'')+this.usageDeviceEditor(m.device_ids||[]),f=>this.change('save_consumable',{value:{id:m.id||operationId(),name:f.get('name'),unit:f.get('unit'),quantity:f.get('quantity')===''?null:Number(f.get('quantity')),threshold:Number(f.get('threshold')),notes:String(f.get('notes')??''),...this.shopFormValue(f),device_ids:this.readRelatedDevices(f).map(link=>link.id)}}),'Speichern',m.id?this.button('deletematerial','Entfernen',m.id,'type="button" class="inventory-remove"'):'');return;
    }
    if(action==='editbatterytype'){
      const row=this.batteryInventory().find(row=>row.type===id);if(!row)throw Error('Batterietyp wurde nicht gefunden.');
      const manual=data.settings?.battery_device_links?.[id]||[];
      const automatic=row.devices.filter(device=>batteryType(String(device.battery_type||''))===id);
      this.modal('Batterietyp bearbeiten',this.field('battery_type','Batterietyp',id)+this.field('quantity','Bestand in Stück',row.quantity,'number').replace('min="0"','min="-100000"')+this.field('threshold','Nachkaufen bei diesem Bestand oder weniger',data.settings?.battery_inventory_thresholds?.[id]??1,'number')+'<p class="small sub">Eine Umbenennung wird bei Geräten, Aufgaben und Bestandsbuchungen übernommen. Bestehende Typen werden nicht zusammengeführt.</p>'+this.field('notes','Notizen',data.settings?.battery_notes?.[id]??'','textarea')+this.shopField(data.settings?.battery_shop_urls?.[id]||'')+this.usageDeviceEditor(manual,automatic),f=>{
        const type=String(f.get('battery_type')||'').trim(),raw=f.get('quantity'),quantity=Number(raw);if(!type)throw Error('Bitte einen Batterietyp angeben.');if(raw===''||!Number.isInteger(quantity)||quantity < -100000||quantity>100000)throw Error('Bitte einen ganzzahligen Bestand angeben.');
        const threshold=Number(f.get('threshold'));if(f.get('threshold')===''||!Number.isInteger(threshold)||threshold<0||threshold>100000)throw Error('Bitte eine gültige Nachkauf-Schwelle eingeben.');return this.change('edit_battery_type',{type:id,new_type:type,quantity,threshold,notes:String(f.get('notes')??''),...this.shopFormValue(f),device_ids:this.readRelatedDevices(f).map(link=>link.id)});
      },'Speichern',this.button('deletebatterytype','Entfernen',id,'type="button" class="inventory-remove"'));return;
    }
    if(action==='deletematerial'){
      const material=data.settings?.consumables?.[id];if(!material)throw Error('Verbrauchsmaterial wurde nicht gefunden.');
      const linked=Object.values(data.rules).filter(rule=>[rule.consumable,...Object.values(rule.consumables_by_step||{})].some(link=>link?.kind==='material'&&link.id===id)).length;
      this.modal('Verbrauchsmaterial entfernen','<p>«'+E(material.name)+'» aus dem Verbrauchsmaterial entfernen?</p>'+(linked?'<p>'+linked+' verknüpfte Aufgabe(n) verlieren diese Materialzuordnung. Die Aufgaben selbst bleiben erhalten.</p>':'')+'<p>Offene Nachkäufe werden geschlossen. Bisherige Bestandsbuchungen und die Historie bleiben erhalten.</p>',()=>this.change('delete_consumable',{id,confirmed:true}),'Entfernen');return;
    }
    if(action==='materialstock'){
      const m=data.settings?.consumables?.[id];if(!m)return;
      this.modal('Bestand ändern',`<p>${E(m.name)} · ${E(m.unit)}</p><div class="stock-stepper"><button type="button" data-stock-step="-1" aria-label="Bestand verringern">−</button><input name="quantity" type="number" min="-100000" max="100000" step="any" value="${E(m.quantity??0)}" aria-label="Bestand"><button type="button" data-stock-step="1" aria-label="Bestand erhöhen">+</button></div>`,f=>this.change('save_consumable',{value:{...m,quantity:Number(f.get('quantity'))}}));return;
    }
    if(action==='addbatterytype'){
      this.modal('Batterietyp hinzufügen',this.field('battery_type','Batterietyp (z. B. CR2025)')+'<div class="fields paired-fields">'+this.field('quantity','Bestand in Stück',1,'number')+this.field('threshold','Nachkaufen bei diesem Bestand oder weniger',1,'number')+'</div>'+this.field('notes','Notizen','','textarea')+this.shopField(),f=>{const type=String(f.get('battery_type')||'').trim(),raw=f.get('quantity'),quantity=Number(raw);if(!type)throw Error('Bitte einen Batterietyp angeben.');if(raw===''||!Number.isInteger(quantity)||quantity<0||quantity>100000)throw Error('Bitte einen gültigen Anfangsbestand angeben.');if(this.batteryInventory().some(row=>row.type.toLocaleLowerCase()===type.toLocaleLowerCase()))throw Error('Dieser Batterietyp existiert bereits. Bitte den Bestand ändern.');const threshold=Number(f.get('threshold'));if(f.get('threshold')===''||!Number.isInteger(threshold)||threshold<0||threshold>100000)throw Error('Bitte eine gültige Nachkauf-Schwelle eingeben.');return this.change('battery_inventory',{stocks:{[type]:quantity},thresholds:{[type]:threshold},notes:{[type]:String(f.get('notes')??'')},...(f.has('shop_url')?{shop_urls:{[type]:this.shopFormValue(f).shop_url}}:{})});});return;
    }
    if(action==='deletebatterytype'){
      this.modal('Batterietyp entfernen',`<p>«${E(id)}» aus dem Verbrauchsmaterial entfernen?</p><p>Geräteangaben und bisherige Batteriewechsel bleiben erhalten. Du kannst den Typ später wieder hinzufügen.</p>`,()=>this.change('battery_inventory',{remove_types:[id]}),'Batterietyp entfernen');return;
    }
    if(action==='batterystock'){
      const row=this.batteryInventory().find(row=>row.type===id);if(!row)throw Error('Batterietyp wurde nicht gefunden.');
      this.modal('Batteriebestand ändern',`<p>${E(row.type)}</p>`+`<div class="stock-stepper"><button type="button" data-stock-step="-1" aria-label="Bestand um eins verringern">−</button><input name="quantity" type="number" step="1" min="-100000" max="100000" value="${E(row.quantity)}" aria-label="Bestand in Stück"><button type="button" data-stock-step="1" aria-label="Bestand um eins erhöhen">+</button></div>`,f=>{const raw=f.get('quantity'),quantity=Number(raw);if(raw===''||!Number.isInteger(quantity)||quantity< -100000||quantity>100000)throw Error('Bitte eine ganze Zahl zwischen -100000 und 100000 eingeben.');return this.change('battery_inventory',{stocks:{[id]:quantity}});});return;
    }
    if(action==='batterylog'){
      const device=data.devices[id];if(!device)throw Error('Gerät wurde nicht gefunden.');
      const operation_id=operationId();const inventory=this.batteryInventory();
      const type=String(device.battery_type||'').replace(/^\d+\s*[×x]\s*/,'').replace(/^CR123A.*$/i,'CR123A');
      const quantity=device.battery_quantity||Number(String(device.battery_type||'').match(/^(\d+)\s*[×x]/)?.[1]||1);
      this.modal('Batteriewechsel erfassen',this.completionDateFields()+this.field('battery_type','Verwendeter Batterietyp',type,'text',[['','Batterietyp auswählen'],...inventory.map(row=>[row.type,`${row.type} (Bestand: ${row.quantity})`])])+this.field('battery_quantity','Verwendete Anzahl',quantity,'number')+this.field('note','Beschreibung','Batterien gewechselt','textarea')+this.field('cost','Kosten in '+this.currency()+' (optional)','','number')+'<p class="small">Die verwendete Anzahl wird beim Speichern vom Bestand abgezogen. Negative Bestände zeigen fehlende Mengen an.</p>',
        f=>{const quantity=Number(f.get('battery_quantity'));if(!f.get('battery_type'))throw Error('Bitte den Batterietyp auswählen.');if(!Number.isInteger(quantity)||quantity<1||quantity>1000)throw Error('Bitte eine ganze Anzahl zwischen 1 und 1000 angeben.');return this.change('battery_replacement',{operation_id,value:{device_id:id,event_date:f.get('event_date'),battery_type:f.get('battery_type'),battery_quantity:quantity,note:f.get('note'),cost:f.get('cost')===''?null:Number(f.get('cost'))}});});return;
    }
    if(action==='deletelog'){
      const l=data.logs[id];if(!l)throw Error('Historieneintrag wurde nicht gefunden.');
      this.modal('Historieneintrag entfernen',`<p>Den Eintrag «${E(l.note||l.kind)}» vom ${E(dateText(l.event_date||l.event_period||'unbekannten Datum'))} entfernen?</p>${l.battery_stock_movement?'<p>Die gebuchte Batteriemenge wird dem Bestand wieder gutgeschrieben.</p>':''}${l.material_stock_movement?'<p>Die gebuchte Verbrauchsmenge wird dem Bestand wieder gutgeschrieben.</p>':''}${l.rule_id?'<p>Die verknüpfte Aufgabe und ihre Fälligkeit werden anhand der verbleibenden Historie aktualisiert.</p>':''}`,
        ()=>this.change('delete_log',{id,confirmed:true}),'Eintrag entfernen');return;
    }
    if(action==='editlog'){
      const l=data.logs[id];if(!l)throw Error('Historieneintrag wurde nicht gefunden.');
      const linked=!!l.rule_id;
      this.modal('Historieneintrag bearbeiten',
        '<div class="fields history-date-fields">'+this.field('event_date','Ereignisdatum (optional)',l.event_date,'date')+
        this.field('event_period','Zeitraum, falls genaues Datum unbekannt',l.event_period,/^\d{4}-\d{2}$/.test(l.event_period||'')?'month':'text')+'</div>'+
        this.field('kind','Ereignis',l.kind||'maintenance','text',this.eventTypeOptions(l.kind))+
        this.field('note','Beschreibung',l.note,'textarea')+
        this.field('cost','Kosten in '+this.currency()+' (optional)',l.cost??'','number')+
        (l.edited_at?`<p class="small sub edit-meta">Zuletzt bearbeitet: ${E(dateTimeText(l.edited_at))}</p>`:'')+
        (linked?'<p class="small">Diese Wartung ist mit einer Aufgabe verknüpft. Eine Datumskorrektur aktualisiert deren Fälligkeit; der Saison- oder Rotationszyklus bleibt erhalten.</p>':''),
        f=>this.change('edit_log',{id,value:{event_date:f.get('event_date')||null,event_period:f.get('event_period')||null,kind:f.get('kind'),note:f.get('note'),cost:f.get('cost')===''?null:Number(f.get('cost'))}}));
      return;
    }
    if(action==='log'){this.modal('Aufgabe nachtragen',this.field('event_date','Ereignisdatum',data.today,'date')+this.field('kind','Ereignis',this.eventTypeOptions()[0]?.[0]||'maintenance','text',this.eventTypeOptions())+this.field('note','Beschreibung','','textarea')+this.field('cost','Kosten in '+this.currency()+' (optional)','','number'),f=>this.change('add_log',{value:{device_id:id,event_date:f.get('event_date'),kind:f.get('kind'),note:f.get('note'),cost:f.get('cost')===''?null:Number(f.get('cost'))}}));return;}
    if(action==='delete'){
      const device=data.devices[id];if(!device)throw Error('Gerät wurde nicht gefunden.');
      const apply=async archive=>{await this.change(archive?'archive_device':'delete_device',archive?{id,date:data.today}:{id,confirmed:true});this.selected=null;this.deviceMode=archive?'archive':'trash';this.body();};
      if(this.archived(device)){this.modal('Gerät entfernen','<p><strong>'+E(device.name)+'</strong></p><p>Das archivierte Gerät in den Papierkorb legen? Beim Leeren des Papierkorbs werden Geräteakte, Aufgaben und Historie endgültig gelöscht.</p>',()=>apply(false),'Entfernen');return;}
      this.modal('In den Papierkorb legen oder archivieren?','<p><strong>'+E(device.name)+'</strong></p><p>Im Archiv bleibt die Geräteakte mit Historie für dauerhaft ausser Betrieb genommene Geräte erhalten. Im Papierkorb wird sie beim Leeren endgültig gelöscht.</p><p class="small sub">Das Gerät erscheint in beiden Fällen nicht mehr in der aktiven Aufgabenliste.</p>',()=>apply(false),'In den Papierkorb legen');
      const dialog=this.shadowRoot.querySelector('dialog'),archive=document.createElement('button');archive.type='button';archive.textContent='Archivieren';archive.onclick=async()=>{if(this.pending)return;archive.disabled=true;try{await apply(true);}catch(error){dialog.querySelector('.errors').textContent=errorMessage(error);}finally{archive.disabled=false;}};dialog.querySelector('.footer').insertBefore(archive,dialog.querySelector('[type=submit]'));return;
    }
    if(action==='addeventtype'||action==='editeventtype'){this.modal(action==='addeventtype'?'Ereignisart hinzufügen':'Ereignisart umbenennen',this.field('name','Bezeichnung',id?this.eventTypeLabel(id):''),form=>this.change('save_event_type',{...(id?{id}:{}),name:form.get('name')}));return;}
    if(action==='deleteeventtype'){const count=Object.values(data.logs).filter(log=>log.kind===id&&!log.deleted_at).length;this.modal('Ereignisart entfernen','<p>«'+E(this.eventTypeLabel(id))+'» aus der Auswahl entfernen?</p><p>'+count+' bestehende Einträge behalten diese Ereignisart.</p>',()=>this.change('delete_event_type',{id,confirmed:true}),'Entfernen');return;}
    if(action==='deletecategory'){
      const devices=Object.values(data.devices).filter(d=>!d.deleted_at&&this.category(d)===id);
      this.modal('Kategorie entfernen',`<p>Die Kategorie «${E(id)}» entfernen?</p><p>${devices.length?`${devices.length} ${devices.length===1?'Gerät ist':'Geräte sind'} zugeordnet. Diese Geräte bleiben erhalten und stehen danach unter „Ohne Kategorie“.`:'Dieser Kategorie sind keine Geräte zugeordnet.'}</p><label class="check"><input name="confirm" type="checkbox" required>Kategorie entfernen bestätigen</label>`,f=>{if(!f.has('confirm'))throw Error('Bitte das Entfernen bestätigen.');return this.change('delete_category',{name:id,device_ids:devices.map(d=>d.id),confirmed:true});},'Kategorie entfernen');return;
    }
    if(action==='renamecategory'){
      this.modal('Kategorie umbenennen',this.field('name','Name',id),f=>{const name=String(f.get('name')||'').trim();if(!name)throw Error('Bitte einen Namen eingeben.');return this.change('save_categories',{categories:this.categories().map(value=>value===id?name:value),rename:{from:id,to:name}});});return;
    }
    if(action==='addcategory'){
      this.modal('Kategorie hinzufügen',this.field('name','Name'),f=>{const name=String(f.get('name')||'').trim();if(!name)throw Error('Bitte einen Namen eingeben.');return this.change('save_categories',{categories:[...this.categories(),name]});});return;
    }
    if(action==='emptytrash'){
      const count=(data.trash||[]).length;if(!count)return;
      this.modal('Papierkorb endgültig leeren',`<p>${E(count)} gelöschte Geräte samt ihren Aufgaben und ihrer Historie endgültig aus dem Wartungsverzeichnis entfernen?</p><p>Danach können diese Geräte hier nicht mehr wiederhergestellt werden.</p><label class="check"><input type="checkbox" name="confirm" required>Endgültiges Entfernen bestätigen</label>`,f=>{if(f.get('confirm')!=='on')throw Error('Bitte das endgültige Entfernen bestätigen.');return this.change('purge_trash',{confirmed:true});},'Endgültig entfernen');return;
    }
    if(action==='purgetrashdevice'){
      const device=(data.trash||[]).find(device=>device.id===id);if(!device)throw Error('Gerät ist nicht im Papierkorb.');
      this.modal('Gerät endgültig entfernen','<p>«'+E(device.name)+'» samt Aufgaben und Historie endgültig entfernen?</p><p>Danach ist keine Wiederherstellung im Wartungs-Manager möglich. Andere Geräte im Papierkorb bleiben erhalten.</p><label class="check"><input type="checkbox" name="confirm" required>Endgültiges Entfernen bestätigen</label>',form=>{if(!form.has('confirm'))throw Error('Bitte das endgültige Entfernen bestätigen.');return this.change('purge_trash_device',{id,confirmed:true});},'Endgültig entfernen');return;
    }
    if(action==='undelete'){await this.change('restore_device',{id});return;}
    if(action==='requestpurchase'){
      const battery=id.startsWith('battery:'),key=id.slice(id.indexOf(':')+1),material=battery?null:data.settings?.consumables?.[key];
      if(!battery&&!material)throw Error('Verbrauchsmaterial wurde nicht gefunden.');
      const name=battery?'Batterien '+key:material.name,unit=battery?'Stück':material.unit;
      const existing=Object.values(data.shopping).find(x=>!x.done&&(battery?x.battery_type===key:x.consumable_id===key));
      this.modal('Nachkaufauftrag erfassen',`<p>${E(name)}</p><p class="small sub">Erscheint unter Aufgaben → Nachkaufen.</p>`+this.field('quantity','Gewünschte Menge in '+unit,existing?.requested_quantity??1,'number'),f=>{
        const quantity=Number(f.get('quantity'));if(!Number.isFinite(quantity)||quantity<=0||quantity>100000||(battery&&!Number.isInteger(quantity)))throw Error('Bitte eine gültige positive Menge eingeben.');
        return this.change('save_shopping',{value:{...(existing||{}),id:existing?.id||(battery?'battery-stock:':'consumable:')+key,name:name+' nachkaufen',done:false,requested_quantity:quantity,requested_unit:unit,...(battery?{battery_type:key,battery_inventory_auto:true}:{consumable_id:key})}});
      },'Nachkaufauftrag speichern');return;
    }
    if(action==='deleteshopping'){
      const item=data.shopping[id];if(!item)return;
      this.modal('Nachkaufauftrag entfernen','<p>«'+E(item.name)+'» entfernen?</p><p class="small sub">Der Bestand bleibt unverändert. Bei erneutem Bedarf kann wieder ein automatischer Nachkaufauftrag entstehen.</p>',()=>this.change('save_shopping',{value:{id,done:true,cancelled_at:new Date().toISOString(),cancelled_reason:'Nachkaufauftrag gelöscht'}}),'Entfernen');return;
    }
    if(action==='editshopping'){
      const item=data.shopping[id];if(!item||item.done)throw Error('Nachkaufauftrag wurde nicht gefunden oder ist bereits erledigt.');
      const linked=!!(item.battery_type||item.consumable_id),unit=item.battery_type?'Stück':data.settings?.consumables?.[item.consumable_id]?.unit||item.requested_unit||'Stück';
      this.modal('Nachkaufauftrag bearbeiten',(linked?'<p>'+E(item.name)+' · '+E(unit)+'</p>':this.field('name','Bezeichnung',item.name))+this.field('quantity','Gewünschte Menge'+(linked?' in '+unit:' (optional)'),item.requested_quantity??(linked?1:''),'number')+(linked?'':this.field('unit','Einheit',unit))+this.field('notes','Notizen',this.shoppingNotes(item),'textarea')+(linked?'<p class="small sub">Diese Notizen gelten auch für das verknüpfte Verbrauchsmaterial.</p>':''),form=>{const name=linked?item.name:String(form.get('name')||'').trim(),raw=String(form.get('quantity')||'').trim(),quantity=raw===''?null:Number(raw);if(!name)throw Error('Bitte eine Bezeichnung angeben.');if(linked&&quantity===null||quantity!==null&&(!Number.isFinite(quantity)||quantity<=0||quantity>100000||item.battery_type&&!Number.isInteger(quantity)))throw Error('Bitte eine gültige positive Nachkaufmenge eingeben.');return this.change('save_shopping',{value:{id,name,notes:String(form.get('notes')??''),requested_quantity:quantity,requested_unit:linked?unit:String(form.get('unit')||'Stück').trim()||'Stück'}});});return;
    }
    if(action==='shopping'){this.modal('Nachkauf hinzufügen',this.field('name','Bezeichnung'),f=>this.change('save_shopping',{value:{name:f.get('name'),done:false}}));return;}
    if(action==='bought'){
      const item=data.shopping[id];if(!item)return;
      if(item.battery_type||item.consumable_id){const operation_id=operationId();this.modal('Einkauf erfassen',`<p>${E(item.battery_type||item.name)} · Nachgekaufte Menge (${E(item.battery_type?'Stück':data.settings.consumables[item.consumable_id]?.unit||'Stück')})</p><div class="stock-stepper"><button type="button" data-stock-step="-1" aria-label="Menge verringern">−</button><input name="quantity" type="number" min="${item.battery_type?1:0.001}" max="100000" step="${item.battery_type?1:'any'}" value="${E(item.requested_quantity||1)}" required aria-label="Nachgekaufte Menge"><button type="button" data-stock-step="1" aria-label="Menge erhöhen">+</button></div>`,f=>{const quantity=Number(f.get('quantity'));if(!Number.isFinite(quantity)||quantity<=0||quantity>100000||(item.battery_type&&!Number.isInteger(quantity)))throw Error('Bitte eine gültige positive Nachkaufmenge eingeben.');return this.change(item.battery_type?'battery_purchase':'consumable_purchase',{id,quantity,operation_id});},'Einkauf buchen');}
      else await this.change('save_shopping',{value:{id,done:true}});return;
    }
    if(action==='digest'){const r=await this.api('test_digest');this.notice(`Testmeldung in Home Assistant angezeigt (${r.tasks} Aufgaben).`);return;}
    if(action==='resetalldata'){
      this.modal('Daten zurücksetzen','<p class="error" role="alert"><strong>Alle Geräte-, Aufgaben- und Verbrauchsmaterialdaten werden endgültig gelöscht. Kategorien, Ereignisarten und allgemeine Einstellungen bleiben erhalten.</strong></p><p>Gelöscht werden alle Geräte inklusive Lager, Archiv und Papierkorb, Aufgaben, Historie, Nachkaufaufträge, Batterietypen und weiteres Verbrauchsmaterial mit Beständen, Nachkaufgrenzen und Notizen. Auch Geräteverknüpfungen, Materialzuordnungen, Importzuordnungen, Buchungsdaten und die interne Rückfallkopie werden entfernt.</p><p>Erhalten bleiben Kategorien und Ereignisarten mit Bezeichnungen und Reihenfolge sowie übrige Einstellungen wie Wochenmeldung und Batterieschwellenwert. Die Integration mit Design und Symbol, alle Home-Assistant-Geräte, Helfer, Entitäten und Automationen, Originalnotizen in Evernote und bereits heruntergeladene Exportdateien bleiben unverändert.</p><p>Diese Aktion kann in der App nicht rückgängig gemacht werden. Exportiere vorher deine Daten, wenn du sie wiederherstellen möchtest.</p>'+this.field('confirmation','Zur Bestätigung DATEN ZURÜCKSETZEN eingeben')+'<label class="check"><input type="checkbox" name="confirm" required>Ich möchte die genannten Geräte-, Aufgaben- und Verbrauchsmaterialdaten endgültig löschen</label>',async form=>{if(!form.has('confirm')||form.get('confirmation')!=='DATEN ZURÜCKSETZEN')throw Error('Bitte die Warnung bestätigen und DATEN ZURÜCKSETZEN exakt eingeben.');await this.change('reset_all_data',{confirmed:true,confirmation:form.get('confirmation')});this.selected=null;this.query=this.taskQuery=this.inventoryQuery=this.logQuery=this.logYearFilter=this.area=this.categoryFilter='';this.deviceMode='active';this.draw();},'Daten endgültig zurücksetzen');return;
    }
    if(action==='export'){const exportData=await this.api('export');const u=URL.createObjectURL(new Blob([JSON.stringify(exportData,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=u;a.download=`Wartungs-Manager-${data.today}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);return;}
    if(action==='restore'){
      this.modal('Daten importieren','<p>Wähle eine zuvor exportierte JSON-Datei. Anschliessend kannst du den Inhalt prüfen.</p><label>Exportdatei<input type="file" name="file" accept="application/json,.json" required></label>',async form=>{
        const value=await this.readDirectoryFile(form.get('file')),devices=Object.values(value.devices),materials=value.settings.consumables||{},batteries=value.settings.battery_inventory||{};
        const summary='<p><strong>'+devices.length+' Geräte</strong>, davon '+devices.filter(d=>d.deleted_at).length+' im Papierkorb und '+devices.filter(d=>!d.deleted_at&&(d.archived||d.archived_at)).length+' im Archiv.</p><p>'+Object.keys(value.rules).length+' Aufgaben · '+Object.keys(value.logs).length+' Historieneinträge · '+Object.keys(batteries).length+' Batterietypen · '+Object.keys(materials).length+' weitere Verbrauchsmaterialien.</p>';
        this.close();this.modal('Datenimport bestätigen',summary+'<p class="error" role="alert"><strong>Achtung: Alle bestehenden Wartungsdaten werden gelöscht und durch die Daten aus der Datei ersetzt.</strong></p><p>Dies betrifft Geräte inklusive Archiv und Papierkorb, Aufgaben, Historie, Verbrauchsmaterial und Einstellungen. Home-Assistant-Geräte und deren Konfiguration werden nicht verändert.</p><label class="check"><input type="checkbox" name="confirm" required>Ich bestätige, dass alle bestehenden Wartungsdaten gelöscht und durch die Daten aus der Datei ersetzt werden</label>',async confirmation=>{if(!confirmation.has('confirm'))throw Error('Bitte das Ersetzen der Daten bestätigen.');await this.change('restore',{value});this.selected=null;},'Daten importieren');
      },'Datei prüfen');return;
    }
  }
}
if(!customElements.get('ha-wartung-panel'))customElements.define('ha-wartung-panel',WartungPanel);
