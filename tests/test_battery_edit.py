from backend_test_support import DirectoryTestCase, deepcopy, ns
from battery_edit import edit_battery_type
class BatteryEdit(DirectoryTestCase):
 async def test_rename_keeps_device_rule_and_history_references(self):
  o=self.obj();o.data['devices']['d'].update(battery_type='AA',battery_quantity=2);o.data['settings'].update(battery_inventory={'AA':3},battery_device_links={'AA':['d']});o.data['rules']['r']={'id':'r','device_id':'d','kind':'interval','name':'Batterien','months':1,'consumable':{'kind':'battery','id':'AA'}}
  o.data['logs']['l']={'id':'l','device_id':'d','kind':'maintenance','event_date':'2026-11-21','battery_stock_movement':{'type':'AA','quantity':2},'material_stock_movement':{'kind':'battery','id':'AA','name':'AA','quantity':2}}
  o.data['shopping']['battery-stock:AA']={'id':'battery-stock:AA','name':'Alt','battery_type':'AA','battery_inventory_auto':True,'done':False};o.data['operations']['purchase']='battery-stock:AA'
  await ns['execute'](o,'edit_battery_type',{'revision':o.data['revision'],'type':'AA','new_type':'AA (Lithium)','quantity':3,'device_ids':['d']})
  self.assertEqual(o.data['settings']['battery_inventory'],{'AA (Lithium)':3});self.assertEqual(o.data['devices']['d']['battery_type'],'AA (Lithium)');self.assertEqual(o.data['devices']['d']['battery_quantity'],2);self.assertEqual(o.data['rules']['r']['consumable']['id'],'AA (Lithium)');self.assertEqual(o.data['logs']['l']['battery_stock_movement']['type'],'AA (Lithium)');self.assertEqual(o.data['logs']['l']['material_stock_movement']['id'],'AA (Lithium)');self.assertEqual(o.data['operations']['purchase'],'battery-stock:AA (Lithium)');self.assertNotIn('battery-stock:AA',o.data['shopping'])
 async def test_collision_atomic(self):
  o=self.obj();o.data['settings']['battery_inventory']={'AA':2,'AAA':1};before=deepcopy(o.data)
  with self.assertRaises(ValueError):await ns['execute'](o,'edit_battery_type',{'revision':o.data['revision'],'type':'AA','new_type':'AAA','quantity':2,'device_ids':[]})
  self.assertEqual(o.data,before)
 async def test_stock_and_links_only(self):
  o=self.obj();o.data['settings']['battery_inventory']={'AA':3}
  await ns['execute'](o,'edit_battery_type',{'revision':o.data['revision'],'type':'AA','new_type':'AA','quantity':1,'device_ids':['d']})
  self.assertEqual(o.data['settings']['battery_inventory']['AA'],1);self.assertEqual(o.data['settings']['battery_device_links']['AA'],['d']);self.assertFalse(o.data['shopping']['battery-stock:AA']['done'])

class BatteryThreshold(DirectoryTestCase):
 async def test_threshold_changes_shopping_without_changing_stock(self):
  o=self.obj();o.data['settings']['battery_inventory']={'AA':3};o.data['shopping']['battery-stock:AA']={'id':'battery-stock:AA','name':'AA','battery_type':'AA','battery_inventory_auto':True,'done':True}
  await ns['execute'](o,'battery_inventory',{'revision':o.data['revision'],'thresholds':{'AA':4}})
  self.assertEqual(o.data['settings']['battery_inventory']['AA'],3);self.assertFalse(o.data['shopping']['battery-stock:AA']['done'])
  await ns['execute'](o,'battery_inventory',{'revision':o.data['revision'],'thresholds':{'AA':0}})
  self.assertTrue(o.data['shopping']['battery-stock:AA']['done'])
 async def test_edit_threshold_rename_and_validation(self):
  o=self.obj();o.data['settings']['battery_inventory']={'AA':3}
  await ns['execute'](o,'edit_battery_type',{'revision':o.data['revision'],'type':'AA','new_type':'AA (Lithium)','quantity':3,'threshold':5,'device_ids':[]})
  self.assertEqual(o.data['settings']['battery_inventory_thresholds'],{'AA (Lithium)':5});self.assertFalse(o.data['shopping']['battery-stock:AA (Lithium)']['done'])
  before=deepcopy(o.data)
  with self.assertRaises(ValueError):await ns['execute'](o,'battery_inventory',{'revision':o.data['revision'],'thresholds':{'AA (Lithium)':-1}})
  self.assertEqual(o.data,before)
