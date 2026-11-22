"""Repeatable, previewed device capture. No entity state or maintenance rules are changed."""
from collections import Counter
import unicodedata

TYPES = {
 'light': 'Leuchten', 'cover': 'Storen und Beschattung', 'heating': 'Heizung und Lüftung',
 'power': 'Aktoren und Smart Plugs', 'lock': 'Schlösser', 'camera': 'Kameras',
 'media': 'Audio und Medien', 'appliance': 'Haushalts- und Gartengeräte',
 'safety': 'Gefahrenmelder', 'contact': 'Tür- und Fenstermelder', 'motion': 'Bewegungsmelder',
 'weather': 'Temperatur und Wetter', 'air': 'Luftsensoren', 'button': 'Buttons', 'sensor': 'Weitere Sensoren',
}
CATEGORIES = {'light':'Licht','cover':'Beschattung','heating':'Heizung','power':'Smart Home','lock':'Zutritt','camera':'Kameras','media':'Audio und Medien','appliance':'Haushalt','safety':'Gefahrenmelder','contact':'Tür- und Fenstermelder','motion':'Bewegungsmelder','weather':'Temperatursensoren','air':'Sensoren','button':'Buttons','sensor':'Sensoren'}

def name_key(name):
 return ''.join(c for c in unicodedata.normalize('NFKD',str(name or '')).casefold() if c.isalnum())

def device_type(device):
 entities=device.get('entity_types',[])
 domains={e['domain'] for e in entities}; classes={e.get('device_class') for e in entities}
 for domain,kind in [('climate','heating'),('water_heater','heating'),('fan','heating'),('vacuum','appliance'),('lawn_mower','appliance'),('camera','camera'),('lock','lock'),('cover','cover'),('media_player','media'),('light','light'),('switch','power')]:
  if domain in domains:return kind
 if classes & {'smoke','gas','carbon_monoxide','safety','moisture','tamper'}:return 'safety'
 if classes & {'door','window','opening','garage_door'}:return 'contact'
 if classes & {'motion','occupancy','presence'}:return 'motion'
 if classes & {'carbon_dioxide','volatile_organic_compounds','volatile_organic_compounds_parts','pm1','pm10','pm25','aqi'}:return 'air'
 if classes & {'temperature','humidity','atmospheric_pressure','wind_speed','precipitation','precipitation_intensity'}:return 'weather'
 if 'weather' in domains:return 'weather'
 if 'event' in domains:return 'button'
 if domains & {'sensor','binary_sensor'}:return 'sensor'
 if 'button' in domains:return 'button'
 return None

def capture_preview(data, registry, selected_types=None):
 if selected_types is not None and (not isinstance(selected_types,list) or not selected_types or any(not isinstance(t,str) or t not in TYPES for t in selected_types) or len(set(selected_types))!=len(selected_types)):
  raise ValueError('Bitte gültige Gerätetypen auswählen.')
 existing=list(data.get('devices',{}).values())
 known_ids={d.get('ha_device_id') for d in existing if d.get('ha_device_id')}
 known_names={name_key(d.get('name')) for d in existing}
 devices=[d for d in registry['devices'] if not d.get('disabled') and not d.get('service') and d.get('entity_types')]
 counts=Counter(name_key(d.get('name')) for d in devices)
 candidates=[];skipped=[];catalogue=Counter();existing_counts=Counter();new_counts=Counter();conflict_counts=Counter()
 for device in devices:
  kind=device_type(device)
  if not kind:continue
  catalogue[kind]+=1
  key=name_key(device['name']);reason=None
  if device['id'] in known_ids or 'ha-initial:'+device['id'] in data.get('devices',{}):reason='Bereits erfasst (einschliesslich Lager, Archiv und Papierkorb)'
  elif key in known_names:reason='Gleicher Name bereits im Verzeichnis – bitte manuell prüfen'
  elif counts[key]>1:reason='Mehrere HA-Geräte mit gleichem Namen – bitte manuell prüfen'
  if device['id'] in known_ids or 'ha-initial:'+device['id'] in data.get('devices',{}):existing_counts[kind]+=1
  elif reason:conflict_counts[kind]+=1
  else:new_counts[kind]+=1
  if selected_types is not None and kind not in selected_types:continue
  row={k:device.get(k) for k in ('id','name','manufacturer','model','area')};row['type']=kind
  if reason:skipped.append(dict(row,reason=reason))
  else:candidates.append(row)
 return {'types':[{'id':key,'name':name,'count':catalogue[key],'existing_count':existing_counts[key],'new_count':new_counts[key],'conflict_count':conflict_counts[key]} for key,name in TYPES.items()], 'candidates':sorted(candidates,key=lambda d:d['name'].casefold()),'skipped':skipped,'last_capture':data.get('settings',{}).get('last_device_capture') or data.get('settings',{}).get('initial_device_capture')}

def apply_capture(data, registry, types, ids, confirmed, now):
 if confirmed is not True:raise ValueError('Bitte die Sammelerfassung bestätigen.')
 if not isinstance(ids,list) or not ids or len(ids)>5000 or any(not isinstance(i,str) for i in ids) or len(set(ids))!=len(ids):raise ValueError('Bitte unterschiedliche Geräte auswählen.')
 preview=capture_preview(data,registry,types)
 allowed={d['id']:d for d in preview['candidates']}
 if any(i not in allowed for i in ids):raise ValueError('Auswahl ist veraltet oder enthält mögliche Dubletten. Bitte Vorschau erneut öffnen.')
 for identity in ids:
  source=allowed[identity];did='ha-initial:'+identity
  data['devices'][did]={'id':did,'name':source['name'],'manufacturer':source['manufacturer'],'model':source['model'],'ha_device_id':identity,'area':source['area'],'category':CATEGORIES[source['type']]}
 data.setdefault('settings',{})['last_device_capture']={'completed_at':now.isoformat(),'created':len(ids),'types':list(types)}
 return {'created':len(ids),'already_saved':False}
