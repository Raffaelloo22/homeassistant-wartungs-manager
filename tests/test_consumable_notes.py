from backend_test_support import DirectoryTestCase, deepcopy, ns
from battery_edit import edit_battery_type
class ConsumableNotes(DirectoryTestCase):
 async def test_material_notes_persist_through_stock_update_and_clear(self):
  o=self.obj();value={'id':'salt','name':'Salz','unit':'Säcke','quantity':3,'threshold':1,'notes':'\nLager im Keller\nNur Salztabletten <Marke>'}
  await ns['execute'](o,'save_consumable',{'revision':o.data['revision'],'value':value});self.assertEqual(o.data['settings']['consumables']['salt']['notes'],value['notes'])
  edited=dict(value,quantity=4);edited.pop('notes');await ns['execute'](o,'save_consumable',{'revision':o.data['revision'],'value':edited});self.assertEqual(o.data['settings']['consumables']['salt']['notes'],value['notes'])
  await ns['execute'](o,'save_consumable',{'revision':o.data['revision'],'value':dict(value,notes='')});self.assertEqual(o.data['settings']['consumables']['salt']['notes'],'')
 async def test_battery_notes_add_rename_stock_edit_and_clear(self):
  o=self.obj();await ns['execute'](o,'battery_inventory',{'revision':o.data['revision'],'stocks':{'AA':5},'notes':{'AA':'Im Schrank\nMarke ABC'}})
  self.assertEqual(o.data['settings']['battery_notes']['AA'],'Im Schrank\nMarke ABC')
  await ns['execute'](o,'edit_battery_type',{'revision':o.data['revision'],'type':'AA','new_type':'AAA','quantity':6,'device_ids':[]});self.assertNotIn('AA',o.data['settings']['battery_notes']);self.assertEqual(o.data['settings']['battery_notes']['AAA'],'Im Schrank\nMarke ABC')
  await ns['execute'](o,'battery_inventory',{'revision':o.data['revision'],'stocks':{'AAA':7}});self.assertEqual(o.data['settings']['battery_notes']['AAA'],'Im Schrank\nMarke ABC')
  await ns['execute'](o,'edit_battery_type',{'revision':o.data['revision'],'type':'AAA','new_type':'AAA','quantity':7,'device_ids':[],'notes':''});self.assertEqual(o.data['settings']['battery_notes']['AAA'],'')
  await ns['execute'](o,'battery_inventory',{'revision':o.data['revision'],'remove_types':['AAA']});self.assertNotIn('AAA',o.data['settings']['battery_notes'])
 async def test_invalid_notes_are_atomic(self):
  for notes in [42,{},'x'*20001]:
   o=self.obj();before=deepcopy(o.data)
   with self.assertRaises(ValueError):await ns['execute'](o,'battery_inventory',{'revision':o.data['revision'],'stocks':{'AA':1},'notes':{'AA':notes}})
   self.assertEqual(o.data,before)
   with self.assertRaises(ValueError):await ns['execute'](o,'save_consumable',{'revision':o.data['revision'],'value':{'id':'salt','name':'Salz','unit':'Säcke','quantity':1,'threshold':1,'notes':notes}})
   self.assertEqual(o.data,before)
