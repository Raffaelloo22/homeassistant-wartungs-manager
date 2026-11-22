from backend_test_support import DirectoryTestCase, deepcopy, ns
import json

class DataTransfer(DirectoryTestCase):
 async def test_restore_roundtrip_includes_all_data_and_preserves_monotonic_revision(self):
  o=self.obj();o.data['devices']['d']['notes']='Mehrzeilig\nNotiz'
  o.data['devices'].update({'archive':{'id':'archive','name':'Archiv','archived':True},'trash':{'id':'trash','name':'Papierkorb','deleted_at':'2026-01-01T00:00:00+00:00'}})
  o.data['rules']['r']={'id':'r','device_id':'d','name':'Prüfen','kind':'none'}
  o.data['logs']['l']={'id':'l','device_id':'archive','kind':'maintenance','event_date':'2026-01-01','note':'Historie'}
  o.data['shopping']['s']={'id':'s','name':'Nachkaufen','done':False}
  o.data['settings'].update(device_categories=['Garten','Licht'],category_aliases={'Beleuchtung':'Licht'},event_types={'purchase':'Kauf','custom':'Eigene Prüfung'},event_type_order=['custom','purchase'],hidden_event_types=['repair'],battery_inventory={'AA':2},battery_notes={'AA':'Marke'},consumables={'salt':{'id':'salt','name':'Salz','unit':'kg','quantity':3,'threshold':1,'notes':'Keller'}})
  o.data['imports']['note:d']={'id':'d'};o.data['operations']['op']='l'
  backup=json.loads(json.dumps(o.data));o.data['revision']+=5;o.data['devices']['d']['notes']='Verändert'
  revision=o.data['revision'];await ns['execute'](o,'restore',{'revision':revision,'value':backup})
  self.assertEqual(o.data['revision'],revision+1)
  for key,value in backup.items():
   if key!='revision':self.assertEqual(o.data[key],value,key)
 async def test_invalid_restore_keeps_current_data(self):
  o=self.obj();before=deepcopy(o.data);broken=deepcopy(before);broken['rules']={'r':{'id':'r','device_id':'missing','name':'Fehler','kind':'none'}}
  with self.assertRaises(ValueError):await ns['execute'](o,'restore',{'revision':o.data['revision'],'value':broken})
  self.assertEqual(o.data,before)
