from backend_test_support import DirectoryTestCase, datetime, deepcopy, engine, ns, timezone

class EventTypes(DirectoryTestCase):
 async def test_add_rename_retire_restore_keeps_history(self):
  o=self.obj()
  result=await ns['execute'](o,'save_event_type',{'revision':o.data['revision'],'name':' Filter gereinigt '})
  identity=result['id'];self.assertEqual(engine.event_types(o.data)[identity],'Filter gereinigt')
  await ns['execute'](o,'add_log',{'revision':o.data['revision'],'value':{'id':'event','device_id':'d','kind':identity,'event_date':'2026-01-01','note':'Bleibt'}})
  before=deepcopy(o.data['logs']['event'])
  await ns['execute'](o,'save_event_type',{'revision':o.data['revision'],'id':identity,'name':'Filterpflege'})
  self.assertEqual(o.data['logs']['event'],before);self.assertEqual(engine.event_types(o.data)[identity],'Filterpflege')
  await ns['execute'](o,'delete_event_type',{'revision':o.data['revision'],'id':identity,'confirmed':True})
  self.assertEqual(o.data['logs']['event'],before);self.assertIn(identity,o.data['settings']['hidden_event_types'])
  with self.assertRaises(ValueError):await ns['execute'](o,'add_log',{'revision':o.data['revision'],'value':{'device_id':'d','kind':identity,'event_date':'2026-01-01'}})
  changed=engine.edit_log(o.data,'event',{'note':'Weiterhin bearbeitbar'},datetime.now(timezone.utc));self.assertEqual(changed['logs']['event']['kind'],identity)
  restored=await ns['execute'](o,'save_event_type',{'revision':o.data['revision'],'name':'Filterpflege'});self.assertEqual(restored['id'],identity);self.assertNotIn(identity,o.data['settings']['hidden_event_types'])
 async def test_invalid_names_and_duplicate_labels_are_atomic(self):
  for name in ['',None,'x'*81,'wartung']:
   o=self.obj();before=deepcopy(o.data)
   with self.assertRaises(ValueError):await ns['execute'](o,'save_event_type',{'revision':o.data['revision'],'name':name})
   self.assertEqual(o.data,before)
 def test_at_least_one_type_and_confirmation(self):
  data=self.obj().data
  with self.assertRaises(ValueError):engine.delete_event_type(data,'maintenance',False)
  for identity in list(engine.DEFAULT_EVENT_TYPES)[:-1]:engine.delete_event_type(data,identity,True)
  with self.assertRaises(ValueError):engine.delete_event_type(data,'note',True)
 def test_source_migration_removes_only_log_sources(self):
  data={'devices':{'d':{'source_ref':'Gerätequelle'}},'logs':{'l':{'source_ref':'alte Quelle','source_refs':['andere'],'note':'Notiz','source_key':'import-key'},'deleted':{'deleted_at':'yesterday','source_ref':'weg'}},'settings':{}}
  cleaned=engine.sanitize_directory(deepcopy(data));self.assertNotIn('source_ref',cleaned['logs']['l']);self.assertNotIn('source_refs',cleaned['logs']['l']);self.assertNotIn('source_ref',cleaned['logs']['deleted']);self.assertEqual(cleaned['devices'],data['devices']);self.assertEqual(cleaned['logs']['l']['note'],'Notiz');self.assertEqual(cleaned['logs']['l']['source_key'],'import-key');self.assertEqual(engine.sanitize_directory(deepcopy(cleaned)),cleaned)
 async def test_retired_maintenance_preserves_rule_completion_semantics(self):
  o=self.obj();o.data['rules']['r']={'id':'r','device_id':'d','name':'Wartung','kind':'interval','months':1,'last_completed':'2026-01-01'};o.data['logs']['l']={'id':'l','device_id':'d','rule_id':'r','kind':'maintenance','event_date':'2026-01-01','note':'Alt','source_ref':'weg'}
  engine.delete_event_type(o.data,'maintenance',True)
  changed=engine.edit_log(o.data,'l',{'note':'Neu'},datetime.now(timezone.utc));self.assertEqual(changed['logs']['l']['kind'],'maintenance');self.assertNotIn('source_ref',changed['logs']['l']);self.assertEqual(changed['rules']['r']['last_completed'],'2026-01-01')
