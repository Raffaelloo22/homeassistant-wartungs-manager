from backend_test_support import DirectoryTestCase, deepcopy, ns

class ShoppingNotes(DirectoryTestCase):
 async def test_notes_shared_atomically_without_stock_changes(self):
  for kind in ('battery','material','free'):
   o=self.obj();o.data['settings']['battery_inventory']={'AA':3};o.data['settings']['consumables']={'salt':{'id':'salt','name':'Salz','unit':'kg','quantity':5,'threshold':1,'notes':'Alt'}}
   item={'id':'s','name':'Nachkauf','done':False}
   if kind=='battery':item['battery_type']='AA'
   if kind=='material':item['consumable_id']='salt'
   o.data['shopping']['s']=item
   for note in ('\nNeue Notiz\nZweite Zeile',''):
    await ns['execute'](o,'save_shopping',{'revision':o.data['revision'],'value':{'id':'s','notes':note,'requested_quantity':2}})
    actual=o.data['settings'].get('battery_notes',{}).get('AA') if kind=='battery' else o.data['settings']['consumables']['salt']['notes'] if kind=='material' else o.data['shopping']['s']['notes']
    self.assertEqual(actual,note);self.assertEqual(o.data['settings']['battery_inventory']['AA'],3);self.assertEqual(o.data['settings']['consumables']['salt']['quantity'],5);self.assertFalse(o.data['shopping']['s']['done'])
    if kind!='free':self.assertNotIn('notes',o.data['shopping']['s'])
 async def test_invalid_note_does_not_save_partial_edit(self):
  o=self.obj();o.data['shopping']['s']={'id':'s','name':'Nachkauf','done':False};before=deepcopy(o.data)
  with self.assertRaises(ValueError):await ns['execute'](o,'save_shopping',{'revision':o.data['revision'],'value':{'id':'s','name':'Geändert','notes':42}})
  self.assertEqual(o.data,before)
