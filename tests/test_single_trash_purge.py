from backend_test_support import DirectoryTestCase, deepcopy, ns
class SingleTrashPurge(DirectoryTestCase):
 async def test_only_selected_trash_device_and_dependents_are_removed(self):
  o=self.obj();o.data['devices'].update({'a':{'id':'a','name':'Weg A','deleted_at':'2026-01-01T00:00:00+00:00'},'b':{'id':'b','name':'Weg B','deleted_at':'2026-01-01T00:00:00+00:00'}})
  o.data['devices']['d']['related_devices']=[{'id':'a'},{'id':'b'}]
  for key in ['a','b']:
   o.data['rules']['r'+key]={'id':'r'+key,'device_id':key,'name':'Aufgabe','kind':'none'}
   o.data['logs']['l'+key]={'id':'l'+key,'device_id':key,'kind':'maintenance','event_date':'2025-01-01'}
   o.data['operations']['op'+key]='l'+key;o.data.setdefault('samples',{})['r'+key]={'value':1}
  o.data['settings']['battery_inventory']={'AA':5};o.data['settings']['battery_device_links']={'AA':['a','b','d']};o.data['imports']['source-a']={'id':'a'}
  result=await ns['execute'](o,'purge_trash_device',{'revision':o.data['revision'],'id':'a','confirmed':True})
  self.assertEqual((result['purged_devices'],result['purged_rules'],result['purged_logs']),(1,1,1));self.assertEqual(set(o.data['devices']),{'d','b'});self.assertEqual(set(o.data['rules']),{'rb'});self.assertEqual(set(o.data['logs']),{'lb'});self.assertEqual(o.data['devices']['d']['related_devices'],[{'id':'b'}]);self.assertEqual(o.data['settings']['battery_device_links']['AA'],['b','d']);self.assertEqual(o.data['settings']['battery_inventory'],{'AA':5});self.assertIn('source-a',o.data['imports']);self.assertNotIn('opa',o.data['operations']);self.assertNotIn('ra',o.data['samples'])
 async def test_confirmation_and_trash_membership_required(self):
  for payload in [{'id':'d','confirmed':True},{'id':'missing','confirmed':True},{'id':'d','confirmed':False}]:
   o=self.obj();before=deepcopy(o.data)
   with self.assertRaises(ValueError):await ns['execute'](o,'purge_trash_device',{'revision':o.data['revision'],**payload})
   self.assertEqual(o.data,before)
 async def test_edit_shopping_keeps_link_and_stock(self):
  o=self.obj();o.data['shopping']['s']={'id':'s','name':'AA nachkaufen','battery_type':'AA','battery_inventory_auto':True,'done':False};o.data['settings']['battery_inventory']={'AA':0}
  await ns['execute'](o,'save_shopping',{'revision':o.data['revision'],'value':{'id':'s','requested_quantity':8,'requested_unit':'Stück'}})
  self.assertEqual(o.data['shopping']['s']['battery_type'],'AA');self.assertTrue(o.data['shopping']['s']['battery_inventory_auto']);self.assertEqual(o.data['shopping']['s']['requested_quantity'],8);self.assertFalse(o.data['shopping']['s']['done']);self.assertEqual(o.data['settings']['battery_inventory'],{'AA':0})
