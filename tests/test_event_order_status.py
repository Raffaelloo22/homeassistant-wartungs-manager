from backend_test_support import DirectoryTestCase, deepcopy, engine, ns
class EventOrderStatus(DirectoryTestCase):
 async def test_event_order_stable_across_rename_and_reject_incomplete(self):
  o=self.obj();order=list(reversed(engine.event_types(o.data)))
  await ns['execute'](o,'save_event_type_order',{'revision':o.data['revision'],'order':order});self.assertEqual(o.data['settings']['event_type_order'],order)
  await ns['execute'](o,'save_event_type',{'revision':o.data['revision'],'id':order[0],'name':'Neue Bezeichnung'});self.assertEqual(o.data['settings']['event_type_order'],order)
  for invalid in [order[:-1],order+[order[0]],['unknown']*len(order),None]:
   before=deepcopy(o.data)
   with self.assertRaises(ValueError):await ns['execute'](o,'save_event_type_order',{'revision':o.data['revision'],'order':invalid})
   self.assertEqual(o.data,before)
 async def test_device_status_transitions_and_trash_restore_preserve_data(self):
  o=self.obj();o.data['rules']['r']={'id':'r','device_id':'d','name':'Aufgabe','kind':'none'};o.data['logs']['l']={'id':'l','device_id':'d','kind':'maintenance','event_date':'2026-01-01','note':'Historie'};before_rules=deepcopy(o.data['rules']);before_logs=deepcopy(o.data['logs'])
  async def status(value,**changes):return await ns['execute'](o,'save_device',{'revision':o.data['revision'],'value':{'id':'d','device_status':value,**changes}})
  await status('storage');self.assertTrue(o.data['devices']['d']['in_storage']);self.assertFalse(o.data['devices']['d']['archived'])
  await status('archive');when=o.data['devices']['d']['archived_at'];self.assertTrue(o.data['devices']['d']['archived']);self.assertFalse(o.data['devices']['d']['in_storage'])
  await status('archive',notes='Bearbeitet');self.assertEqual(o.data['devices']['d']['archived_at'],when)
  await status('active');self.assertFalse(o.data['devices']['d']['archived']);self.assertIsNone(o.data['devices']['d']['archived_at'])
  await status('storage');await status('trash',notes='Bleibt',in_storage=False,archived=False);self.assertTrue(o.data['devices']['d']['deleted_at']);self.assertTrue(o.data['devices']['d']['in_storage']);self.assertNotIn('device_status',o.data['devices']['d']);self.assertEqual(o.data['rules'],before_rules);self.assertEqual(o.data['logs'],before_logs)
  await ns['execute'](o,'restore_device',{'revision':o.data['revision'],'id':'d'});self.assertTrue(o.data['devices']['d']['in_storage']);self.assertNotIn('deleted_at',o.data['devices']['d']);self.assertEqual(o.data['devices']['d']['notes'],'Bleibt')
 async def test_invalid_or_new_trash_status_rejected_atomically(self):
  for value in [{'id':'d','device_status':'wrong'},{'name':'Neues Gerät','device_status':'trash'}]:
   o=self.obj();before=deepcopy(o.data)
   with self.assertRaises(ValueError):await ns['execute'](o,'save_device',{'revision':o.data['revision'],'value':value})
   self.assertEqual(o.data,before)
