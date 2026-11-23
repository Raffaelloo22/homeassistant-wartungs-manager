"""Edit a battery inventory type without orphaning stock references."""
import re
try:
 from .engine import normalize_shop_url
except ImportError:  # Pure-module imports in the offline test harness.
 from engine import normalize_shop_url

_UNSET = object()

def edit_battery_type(data, old, new, quantity, device_ids, normalize, validate_ids, threshold=None, notes=None, shop_url=_UNSET, no_restock=_UNSET):
 settings=data.setdefault('settings',{});stocks=settings.setdefault('battery_inventory',{})
 known=set(stocks)|set(settings.get('battery_inventory_hidden_types',[]))|set(settings.get('battery_device_links',{}))
 known.update(normalize(d.get('battery_type')) for d in data['devices'].values() if d.get('battery_type'))
 if not isinstance(old,str) or old not in known or old in settings.get('battery_inventory_hidden_types',[]):raise ValueError('Batterietyp wurde nicht gefunden.')
 if not isinstance(new,str) or not new.strip() or new!=new.strip() or len(new)>160 or normalize(new)!=new or re.search(r'fest.*verbaut',new,re.I):raise ValueError('Bitte einen Batterietyp ohne Mengenangabe eingeben.')
 if new!=old and any(name.casefold()==new.casefold() for name in known if name!=old):raise ValueError('Dieser Batterietyp existiert bereits. Typen werden nicht automatisch zusammengeführt.')
 if type(quantity) is not int or not -100000<=quantity<=100000:raise ValueError('Bestand muss eine ganze Zahl zwischen -100000 und 100000 sein.')
 if threshold is None:threshold=settings.get('battery_inventory_thresholds',{}).get(old,1)
 if type(threshold) is not int or not 0<=threshold<=100000:raise ValueError('Nachkauf-Schwelle muss eine ganze Zahl zwischen 0 und 100000 sein.')
 if notes is not None and (not isinstance(notes,str) or len(notes)>20000):raise ValueError('Notizen müssen Text mit höchstens 20000 Zeichen sein.')
 if no_restock is not _UNSET and type(no_restock) is not bool:raise ValueError('Nicht nachkaufen muss ein Wahrheitswert sein.')
 url=normalize_shop_url(settings.get('battery_shop_urls',{}).get(old,'') if shop_url is _UNSET else shop_url)
 ids=validate_ids(data,device_ids)
 stocks.pop(old,None);stocks[new]=quantity
 thresholds=settings.setdefault('battery_inventory_thresholds',{});thresholds.pop(old,None);thresholds[new]=threshold
 if 'battery_no_restock' in settings or no_restock is not _UNSET:
  disabled=set(settings.get('battery_no_restock',[]));suppress=old in disabled if no_restock is _UNSET else no_restock
  disabled.discard(old);disabled.discard(new)
  if suppress:disabled.add(new)
  settings['battery_no_restock']=sorted(disabled)
 links=settings.setdefault('battery_device_links',{});links.pop(old,None);links[new]=ids
 saved_notes=settings.setdefault('battery_notes',{})
 if new!=old and old in saved_notes:saved_notes[new]=saved_notes.pop(old)
 if notes is not None:saved_notes[new]=notes
 if 'battery_shop_urls' in settings or shop_url is not _UNSET:
  urls=settings.setdefault('battery_shop_urls',{});urls.pop(old,None)
  if url:urls[new]=url
  else:urls.pop(new,None)
 if new!=old:
  for device in data['devices'].values():
   if normalize(device.get('battery_type'))==old:device['battery_type']=new
  for rule in data['rules'].values():
   for link in [rule.get('consumable'),*rule.get('consumables_by_step',{}).values()]:
    if link and link.get('kind')=='battery' and link.get('id')==old:link['id']=new
  for log in data['logs'].values():
   movement=log.get('battery_stock_movement')
   if movement and movement.get('type')==old:movement['type']=new
   movement=log.get('material_stock_movement')
   if movement and movement.get('kind')=='battery' and movement.get('id')==old:movement.update(id=new,name=new)
  for identity,item in list(data['shopping'].items()):
   if item.get('battery_type')!=old:continue
   item['battery_type']=new
   if item.get('battery_inventory_auto'):
    item['name']='Batterien '+new+' nachkaufen'
    if identity=='battery-stock:'+old:
     new_id='battery-stock:'+new;data['shopping'].pop(identity);item['id']=new_id;data['shopping'][new_id]=item
     data['operations']={op:(new_id if target==identity else target) for op,target in data['operations'].items()}
 return {'type':new}
