from backend_test_support import DirectoryTestCase, deepcopy, ns

class ArchiveTrashContract(DirectoryTestCase):
 async def test_archive_preserves_record_tasks_and_history_even_when_trash_is_emptied(self):
  o=self.obj();o.data['rules']['r']={'id':'r','device_id':'d','name':'Reinigen','kind':'none'};o.data['logs']['l']={'id':'l','device_id':'d','kind':'maintenance','event_date':'2026-01-01','note':'Reinigen'}
  rules,logs=deepcopy(o.data['rules']),deepcopy(o.data['logs'])
  await ns['execute'](o,'archive_device',{'revision':o.data['revision'],'id':'d','date':'2026-01-02'})
  self.assertTrue(o.data['devices']['d']['archived']);self.assertNotIn('deleted_at',o.data['devices']['d']);self.assertEqual(o.data['rules'],rules);self.assertEqual(o.data['logs'],logs)
  o.data['devices']['trash']={'id':'trash','name':'Papierkorb','deleted_at':'2026-01-01T00:00:00+00:00'}
  await ns['execute'](o,'purge_trash',{'revision':o.data['revision'],'confirmed':True})
  self.assertEqual(set(o.data['devices']),{'d'});self.assertEqual(o.data['rules'],rules);self.assertEqual(o.data['logs'],logs)
 async def test_trash_preserves_until_emptying_then_removes_record_tasks_and_history(self):
  o=self.obj();o.data['rules']['r']={'id':'r','device_id':'d','name':'Reinigen','kind':'none'};o.data['logs']['l']={'id':'l','device_id':'d','kind':'maintenance','event_date':'2026-01-01','note':'Reinigen'}
  await ns['execute'](o,'delete_device',{'revision':o.data['revision'],'id':'d','confirmed':True})
  self.assertTrue(o.data['devices']['d']['deleted_at']);self.assertIn('r',o.data['rules']);self.assertIn('l',o.data['logs'])
  await ns['execute'](o,'purge_trash',{'revision':o.data['revision'],'confirmed':True})
  self.assertNotIn('d',o.data['devices']);self.assertNotIn('r',o.data['rules']);self.assertNotIn('l',o.data['logs'])
