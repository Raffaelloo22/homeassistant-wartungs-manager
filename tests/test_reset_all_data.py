from backend_test_support import DirectoryTestCase, SimpleNamespace, deepcopy, ns

class ResetAllData(DirectoryTestCase):
 async def test_reset_requires_both_confirmations_and_current_revision(self):
  for payload in [{},{'confirmed':True},{'confirmed':False,'confirmation':'DATEN ZURÜCKSETZEN'},{'confirmed':True,'confirmation':'falsch'},{'revision':-1,'confirmed':True,'confirmation':'DATEN ZURÜCKSETZEN'}]:
   o=self.obj();before=deepcopy(o.data)
   with self.assertRaises(ValueError):await ns['execute'](o,'reset_all_data',{'revision':o.data['revision'],**payload})
   self.assertEqual(o.data,before)
 async def test_reset_clears_every_collection_and_removes_rollback(self):
  o=self.obj();o.data['devices']['trash']={'id':'trash','name':'Weg','deleted_at':'2026-01-01T00:00:00+00:00'};o.data['devices']['archive']={'id':'archive','name':'Alt','archived':True}
  o.data['rules']['r']={'id':'r','device_id':'d','name':'Prüfen','kind':'none'};o.data['logs']['l']={'id':'l','device_id':'d','kind':'maintenance','event_date':'2026-01-01'}
  o.data.update(samples={'r':{'value':1}},questions=['Frage']);o.data['shopping']['s']={'id':'s','name':'Kaufen'};o.data['imports']['source']={'id':'d'};o.data['operations']['op']='l';o.data['settings'].update(event_types={'custom':'Eigener Typ'},event_type_order=['custom'],category_aliases={'Beleuchtung':'Licht'},hidden_event_types=['repair'],weekday=5,time='09:30',enabled=True,battery_inventory={'AA':2},battery_notes={'AA':'Notiz'},consumables={'salt':{'id':'salt','name':'Salz','unit':'kg','quantity':5,'threshold':1,'notes':'Behalten','device_ids':['d']}})
  removed=[]
  async def remove():removed.append(True)
  o.rollback=SimpleNamespace(async_remove=remove);revision=o.data['revision']
  await ns['execute'](o,'reset_all_data',{'revision':revision,'confirmed':True,'confirmation':'DATEN ZURÜCKSETZEN'})
  for key in ['devices','rules','logs','shopping','imports','operations','samples']:self.assertEqual(o.data[key],{})
  self.assertEqual(o.data['questions'],[]);self.assertTrue(o.data['settings']['enabled']);self.assertEqual(o.data['settings']['weekday'],5);self.assertEqual(o.data['settings']['time'],'09:30');self.assertEqual(o.data['settings']['category_aliases'],{'Beleuchtung':'Licht'});self.assertEqual(o.data['settings']['hidden_event_types'],['repair']);self.assertEqual(o.data['settings']['device_categories'],['Licht','Heizung','Sensoren']);self.assertEqual(o.data['settings']['event_types'],{'custom':'Eigener Typ'});self.assertEqual(o.data['settings']['event_type_order'],['custom']);self.assertNotIn('battery_inventory',o.data['settings']);self.assertNotIn('battery_notes',o.data['settings']);self.assertNotIn('consumables',o.data['settings']);self.assertEqual(o.data['revision'],revision+1);self.assertEqual(removed,[True])
