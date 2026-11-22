"""Atomic stock consumption for completed maintenance rules."""
try:
 from .engine import normalize_battery_type, validate_consumable_link
except ImportError:  # Pure-module imports in the offline test harness.
 from engine import normalize_battery_type, validate_consumable_link
import re

def validate_link_shape(link):
 validate_consumable_link(link, 'Bitte ein Verbrauchsmaterial auswählen.')

def rule_link(rule):
 if rule.get('kind')=='rotation' and rule.get('steps'):
  step=rule['steps'][rule.get('rotation_step',0)%len(rule['steps'])]
  if step in rule.get('consumables_by_step',{}):return rule['consumables_by_step'][step]
 return rule.get('consumable')

def material_info(data,rule):
 link=rule_link(rule);validate_link_shape(link)
 if not link:return None
 settings=data.get('settings',{});identity=link['id']
 if link['kind']=='battery':
  stocks=settings.get('battery_inventory',{});known=set(stocks)
  for d in data.get('devices',{}).values():
   value=normalize_battery_type(d.get('battery_type'))
   if value:known.add(value)
  if identity not in known or identity in settings.get('battery_inventory_hidden_types',[]) or re.search('fest.*verbaut',identity,re.I):
   raise ValueError('Der verknüpfte Batterietyp ist nicht mehr im Inventar.')
  quantity=data['devices'][rule['device_id']].get('battery_quantity') or 1
  if type(quantity) is not int or not 1<=quantity<=1000:raise ValueError('Bitte die Batterieanzahl beim Gerät prüfen.')
  return dict(kind='battery',id=identity,name=identity,unit='Stück',quantity=quantity,before=stocks.get(identity,0))
 material=settings.get('consumables',{}).get(identity)
 if material is None:raise ValueError('Das verknüpfte Verbrauchsmaterial wurde entfernt. Bitte die Aufgabe bearbeiten.')
 return dict(kind='material',id=identity,name=material['name'],unit=material['unit'],quantity=link.get('quantity',1),before=material.get('quantity'))

def consume(data,rule,log_id):
 info=material_info(data,rule)
 if info is None:raise ValueError('Der Aufgabe ist kein Verbrauchsmaterial zugeordnet.')
 if info['before'] is None:raise ValueError('Bitte zuerst den Bestand für '+info['name']+' erfassen oder ohne Bestandsabzug abschliessen.')
 after=round(info['before']-info['quantity'],8)
 if after < -100000:raise ValueError('Bestand ausserhalb des erlaubten Bereichs.')
 if info['kind']=='battery':data['settings'].setdefault('battery_inventory',{})[info['id']]=after
 else:data['settings']['consumables'][info['id']]['quantity']=after
 data['logs'][log_id]['material_stock_movement']=dict(info,after=after)
 return info

def undo_consumption(data,movement):
 if not movement:return
 settings=data.setdefault('settings',{})
 if movement['kind']=='battery':
  stocks=settings.setdefault('battery_inventory',{});stocks[movement['id']]=round(stocks.get(movement['id'],0)+movement['quantity'],8)
 else:
  material=settings.get('consumables',{}).get(movement['id']) or settings.get('deleted_consumables',{}).get(movement['id'])
  if material is None or material.get('quantity') is None:raise ValueError('Für die Rückbuchung muss der Materialbestand zuerst wieder erfasst werden.')
  material['quantity']=round(material['quantity']+movement['quantity'],8)


def return_event_stock(data,event):
 """Credit a removed event's recorded usage to current stocks, preserving formats.

 The transaction caller owns its working copy, commit and retry protection. Return
 both movements so it can run the existing battery/material shopping sync paths.
 """
 movement=event.get('battery_stock_movement')
 material_movement=event.get('material_stock_movement')
 if material_movement:undo_consumption(data,material_movement)
 if movement:
  stocks=data.setdefault('settings',{}).setdefault('battery_inventory',{})
  stocks[movement['type']]=stocks.get(movement['type'],0)+movement['quantity']
 return movement,material_movement
