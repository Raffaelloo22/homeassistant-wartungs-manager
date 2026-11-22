from backend_test_support import engine, DirectoryTestCase, deepcopy, ns, unittest
class DeviceLinks(DirectoryTestCase):
 async def test_undirected_links_from_both_sides(self):
  o=self.obj();o.data['devices']['b']={'id':'b','name':'B'};o.data['devices']['c']={'id':'c','name':'C'}
  await ns['execute'](o,'save_device',{'revision':o.data['revision'],'value':{'id':'d','related_devices':[{'id':'b'}]}})
  self.assertEqual(o.data['devices']['d']['related_devices'],[{'id':'b'}])
  await ns['execute'](o,'save_device',{'revision':o.data['revision'],'value':{'id':'b','related_devices':[{'id':'d'},{'id':'c'}]}})
  self.assertEqual(o.data['devices']['d']['related_devices'],[])
  self.assertEqual(o.data['devices']['b']['related_devices'],[{'id':'d'},{'id':'c'}])
  await ns['execute'](o,'save_device',{'revision':o.data['revision'],'value':{'id':'d','related_devices':[]}})
  self.assertEqual(o.data['devices']['b']['related_devices'],[{'id':'c'}])
 async def test_labels_discarded_on_save(self):
  o=self.obj();o.data['devices']['b']={'id':'b','name':'B'}
  await ns['execute'](o,'save_device',{'revision':o.data['revision'],'value':{'id':'d','related_devices':[{'id':'b','label':'alt'}]}})
  self.assertEqual(o.data['devices']['d']['related_devices'],[{'id':'b'}])
 async def test_device_links_validation_atomic(self):
  for links in [[{'id':'d'}],[{'id':'missing'}],[{}],[{'id':'b'},{'id':'b'}]]:
   o=self.obj();o.data['devices']['b']={'id':'b','name':'B'};before=deepcopy(o.data)
   with self.assertRaises(ValueError):await ns['execute'](o,'save_device',{'revision':o.data['revision'],'value':{'id':'d','related_devices':links}})
   self.assertEqual(o.data,before)
 def test_migration_preserves_endpoints_and_other_data(self):
  old={'settings':{'relationship_types':['steuert'],'battery_inventory':{'AA':3}},'devices':{'a':{'id':'a','name':'A','related_devices':[{'id':'b','label':'steuert'}]},'b':{'id':'b','name':'B','related_devices':[{'id':'a','label':'versorgt'}]}}}
  cleaned=engine.sanitize_directory(deepcopy(old));self.assertNotIn('relationship_types',cleaned['settings']);self.assertEqual(cleaned['settings']['battery_inventory'],{'AA':3});self.assertEqual(cleaned['devices']['a']['related_devices'],[{'id':'b'}]);self.assertEqual(cleaned['devices']['b']['related_devices'],[{'id':'a'}]);self.assertEqual(engine.sanitize_directory(deepcopy(cleaned)),cleaned)
 async def test_material_links_preserved_and_removed(self):
  o=self.obj();m={'id':'salt','name':'Salz','unit':'Säcke','quantity':2,'threshold':1,'device_ids':['d']}
  await ns['execute'](o,'save_consumable',{'revision':o.data['revision'],'value':m})
  m.pop('device_ids');m['quantity']=3
  await ns['execute'](o,'save_consumable',{'revision':o.data['revision'],'value':m})
  self.assertEqual(o.data['settings']['consumables']['salt']['device_ids'],['d'])
  m['device_ids']=[];await ns['execute'](o,'save_consumable',{'revision':o.data['revision'],'value':m})
  self.assertEqual(o.data['settings']['consumables']['salt']['device_ids'],[])
 async def test_battery_links_only_do_not_change_stock_or_shopping(self):
  o=self.obj();o.data['settings']['battery_inventory']={'AA':4};o.data['shopping']['manual']={'id':'manual','name':'Manuell','done':False};before=deepcopy(o.data)
  await ns['execute'](o,'battery_inventory',{'revision':o.data['revision'],'device_links':{'AA':['d']}})
  self.assertEqual(o.data['settings']['battery_device_links']['AA'],['d']);self.assertEqual(o.data['settings']['battery_inventory'],before['settings']['battery_inventory']);self.assertEqual(o.data['shopping'],before['shopping'])
  await ns['execute'](o,'battery_inventory',{'revision':o.data['revision'],'device_links':{'AA':[]}})
  self.assertEqual(o.data['settings']['battery_device_links']['AA'],[])
 async def test_unknown_material_device_rejected(self):
  o=self.obj();before=deepcopy(o.data)
  with self.assertRaises(ValueError):await ns['execute'](o,'save_consumable',{'revision':o.data['revision'],'value':{'id':'salt','name':'Salz','unit':'Säcke','quantity':2,'threshold':1,'device_ids':['missing']}})
  self.assertEqual(o.data,before)
if __name__=='__main__':unittest.main()
