from backend_test_support import DirectoryTestCase, deepcopy, engine, ns
class PurchaseDate(DirectoryTestCase):
 async def add(self,o,kind='purchase',**value):
  return await ns['execute'](o,'add_log',{'revision':o.data['revision'],'value':{'id':'new-log','device_id':'d','kind':kind,'event_date':'2026-03-23',**value}})
 async def test_new_purchase_fills_missing_date_atomically(self):
  for date in [None,'']:
   o=self.obj();o.data['devices']['d']['purchase_date']=date
   await self.add(o);self.assertEqual(o.data['devices']['d']['purchase_date'],'2026-03-23');self.assertIn('new-log',o.data['logs'])
 async def test_existing_purchase_date_is_preserved(self):
  o=self.obj();o.data['devices']['d']['purchase_date']='2025-01-01';await self.add(o);self.assertEqual(o.data['devices']['d']['purchase_date'],'2025-01-01')
 async def test_other_kinds_and_period_only_do_not_fill(self):
  for kind,fields in [('maintenance',{}),('purchase',{'event_date':None,'event_period':'2026-03'}),('purchase',{'date_precision':'month'})]:
   o=self.obj();await self.add(o,kind,**fields);self.assertFalse(o.data['devices']['d'].get('purchase_date'))
 async def test_invalid_entry_does_not_change_device(self):
  o=self.obj();before=deepcopy(o.data)
  with self.assertRaises(ValueError):await self.add(o,event_date='not-a-date')
  self.assertEqual(o.data,before)
 async def test_edit_to_purchase_fills_but_later_correction_does_not_overwrite(self):
  o=self.obj();await self.add(o,'note')
  await ns['execute'](o,'edit_log',{'revision':o.data['revision'],'id':'new-log','value':{'kind':'purchase'}});self.assertEqual(o.data['devices']['d']['purchase_date'],'2026-03-23')
  await ns['execute'](o,'edit_log',{'revision':o.data['revision'],'id':'new-log','value':{'event_date':'2026-03-24'}});self.assertEqual(o.data['devices']['d']['purchase_date'],'2026-03-23')
 def test_import_fills_date_only_for_new_dated_purchase(self):
  data=self.obj().data;record={'collection':'logs','source_key':'purchase-source','value':{'id':'buy','device_id':'d','kind':'purchase','event_date':'2026-03-23'}}
  result,counts=engine.import_new(data,[record]);self.assertEqual(counts['new'],1);self.assertEqual(result['devices']['d']['purchase_date'],'2026-03-23')
  result['devices']['d']['purchase_date']='2020-01-01';again,counts=engine.import_new(result,[record]);self.assertEqual(again['devices']['d']['purchase_date'],'2020-01-01');self.assertEqual(counts['existing'],1)
