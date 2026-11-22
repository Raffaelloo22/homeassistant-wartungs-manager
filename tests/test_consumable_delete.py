from backend_test_support import DirectoryTestCase, TaskMaterialFixture, deepcopy, ns
class DeleteConsumable(TaskMaterialFixture, DirectoryTestCase):
 async def test_delete_preserves_history_and_undo(self):
  o=self.linked('material',stock=5);result=await self.done(o,consume_material=True)
  o.data['shopping']['manual-salt']={'id':'manual-salt','name':'Salz','consumable_id':'salt','done':False}
  before_log=deepcopy(o.data['logs'][result['id']])
  await ns['execute'](o,'delete_consumable',{'revision':o.data['revision'],'id':'salt','confirmed':True})
  self.assertNotIn('salt',o.data['settings']['consumables']);self.assertEqual(o.data['settings']['deleted_consumables']['salt']['quantity'],4);self.assertIsNone(o.data['rules']['r']['consumable']);self.assertEqual(o.data['logs'][result['id']],before_log);self.assertTrue(o.data['shopping']['manual-salt']['done']);self.assertIn('cancelled_at',o.data['shopping']['manual-salt'])
  await ns['execute'](o,'delete_log',{'revision':o.data['revision'],'id':result['id'],'confirmed':True})
  self.assertNotIn('salt',o.data['settings']['consumables']);self.assertEqual(o.data['settings']['deleted_consumables']['salt']['quantity'],5)
 async def test_delete_requires_confirmation_and_is_atomic(self):
  o=self.linked('material');before=deepcopy(o.data)
  with self.assertRaises(ValueError):await ns['execute'](o,'delete_consumable',{'revision':o.data['revision'],'id':'salt'})
  self.assertEqual(o.data,before)
 async def test_rotation_unlinks_only_matching_step(self):
  o=self.linked('material');o.data['rules']['r'].update(kind='rotation',steps=['A','B'],months=2,consumables_by_step={'A':{'kind':'material','id':'salt'},'B':{'kind':'battery','id':'AA'}})
  await ns['execute'](o,'delete_consumable',{'revision':o.data['revision'],'id':'salt','confirmed':True})
  self.assertIsNone(o.data['rules']['r']['consumables_by_step']['A']);self.assertEqual(o.data['rules']['r']['consumables_by_step']['B'],{'kind':'battery','id':'AA'})
