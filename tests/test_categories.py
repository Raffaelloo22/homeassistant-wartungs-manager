from backend_test_support import DirectoryTestCase, ns, engine, deepcopy, unittest

class Categories(DirectoryTestCase):
 async def call(self,o,**p):return await ns['execute'](o,'save_categories',{'revision':o.data['revision'],**p})
 async def test_reorder_persisted(self):
  o=self.obj();await self.call(o,categories=['Sensoren','Licht','Heizung']);self.assertEqual(o.data['settings']['device_categories'],['Sensoren','Licht','Heizung']);self.assertEqual(o.data['devices']['d']['category'],'Licht')
 async def test_rename_updates_devices_and_aliases(self):
  o=self.obj();await self.call(o,categories=['Beleuchtung','Heizung','Sensoren'],rename={'from':'Licht','to':'Beleuchtung'});self.assertEqual(o.data['devices']['d']['category'],'Beleuchtung');self.assertEqual(o.data['settings']['category_aliases']['Licht'],'Beleuchtung')
 async def test_invalid_changes_atomic(self):
  for cats in [['Licht'],['Licht','licht','Heizung','Sensoren'],['Licht','Heizung','Sensoren','']]:
   o=self.obj();before=deepcopy(o.data)
   with self.assertRaises(ValueError):await self.call(o,categories=cats)
   self.assertEqual(o.data,before)
 async def test_add_category(self):
  o=self.obj();await self.call(o,categories=['Licht','Heizung','Sensoren','Büro']);self.assertEqual(o.data['settings']['device_categories'][-1],'Büro')
 async def test_delete_category_keeps_devices_and_history(self):
  o=self.obj();o.data['devices']['auto']={'id':'auto','name':'Automatische Lampe'}
  o.data['settings']['category_aliases']={'Beleuchtung':'Licht'}
  await ns['execute'](o,'delete_category',{'revision':o.data['revision'],'name':'Licht','device_ids':['auto'],'confirmed':True})
  self.assertEqual(o.data['devices']['d']['category'],'Ohne Kategorie');self.assertEqual(o.data['devices']['auto']['category'],'Ohne Kategorie')
  self.assertEqual(o.data['settings']['device_categories'],['Heizung','Sensoren']);self.assertEqual(o.data['settings']['category_aliases']['Beleuchtung'],'Ohne Kategorie')
 async def test_delete_requires_confirmation(self):
  o=self.obj();before=deepcopy(o.data)
  with self.assertRaises(ValueError):await ns['execute'](o,'delete_category',{'revision':o.data['revision'],'name':'Licht'})
  self.assertEqual(o.data,before)
if __name__=='__main__':unittest.main()
