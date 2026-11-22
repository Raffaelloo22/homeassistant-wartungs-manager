from backend_test_support import DirectoryTestCase, TaskMaterialFixture, deepcopy, ns
from materials import material_info,consume,undo_consumption
class TaskMaterial(TaskMaterialFixture, DirectoryTestCase):
 async def test_battery_uses_device_quantity_idempotent_and_undo(self):
  o=self.linked(stock=3);result=await self.done(o,consume_material=True)
  self.assertEqual(o.data['settings']['battery_inventory']['AA'],1);movement=o.data['logs'][result['id']]['material_stock_movement'];self.assertEqual(movement['quantity'],2);self.assertFalse(o.data['shopping']['battery-stock:AA']['done'])
  await self.done(o,consume_material=True);self.assertEqual(o.data['settings']['battery_inventory']['AA'],1)
  o.data['settings']['battery_inventory']['AA']+=10
  await ns['execute'](o,'delete_log',{'revision':o.data['revision'],'id':result['id'],'confirmed':True})
  self.assertEqual(o.data['settings']['battery_inventory']['AA'],13);self.assertTrue(o.data['shopping']['battery-stock:AA']['done'])
 async def test_material_quantity_and_undo(self):
  o=self.linked('material',stock=2);o.data['rules']['r']['consumable']['quantity']=1.5
  result=await self.done(o,consume_material=True);self.assertEqual(o.data['settings']['consumables']['salt']['quantity'],0.5);self.assertFalse(o.data['shopping']['consumable:salt']['done'])
  await ns['execute'](o,'delete_log',{'revision':o.data['revision'],'id':result['id'],'confirmed':True})
  self.assertEqual(o.data['settings']['consumables']['salt']['quantity'],2)
 async def test_without_consent_no_stock_change(self):
  o=self.linked();await self.done(o,consume_material=False);self.assertEqual(o.data['settings']['battery_inventory']['AA'],5)
 async def test_unknown_stock_atomic(self):
  o=self.linked('material',stock=None);before=deepcopy(o.data)
  with self.assertRaises(ValueError):await self.done(o,consume_material=True)
  self.assertEqual(o.data,before)
  await self.done(o,consume_material=False);self.assertIsNone(o.data['settings']['consumables']['salt']['quantity'])
 async def test_removed_material_atomic(self):
  o=self.linked('material');del o.data['settings']['consumables']['salt'];before=deepcopy(o.data)
  with self.assertRaises(ValueError):await self.done(o,consume_material=True)
  self.assertEqual(o.data,before)
 async def test_rule_link_persisted_and_cleared(self):
  o=self.linked('material')
  await ns['execute'](o,'save_rule',{'revision':o.data['revision'],'value':{'id':'r','consumable':{'kind':'battery','id':'AA'}}})
  self.assertEqual(o.data['rules']['r']['consumable'],{'kind':'battery','id':'AA'})
  await ns['execute'](o,'save_rule',{'revision':o.data['revision'],'value':{'id':'r','consumable':None}})
  self.assertIsNone(o.data['rules']['r']['consumable'])
 async def test_invalid_quantities_rejected(self):
  for q in [0,-1,float('nan'),True]:
   o=self.linked('material');before=deepcopy(o.data)
   with self.assertRaises(ValueError):await ns['execute'](o,'save_rule',{'revision':o.data['revision'],'value':{'id':'r','consumable':{'kind':'material','id':'salt','quantity':q}}})
   self.assertEqual(o.data,before)

class RotationMaterial(TaskMaterialFixture, DirectoryTestCase):
 async def test_current_step_consumed_before_rotation_advances(self):
  o=self.linked('material',stock=5);o.data['settings']['consumables']['clean']={'id':'clean','name':'Reiniger','unit':'Stück','quantity':3,'threshold':1}
  o.data['rules']['r'].update(kind='rotation',steps=['Entkalken','Reinigen'],rotation_step=0,first_due='2026-11-21',consumable=None,consumables_by_step={'Entkalken':{'kind':'material','id':'salt','quantity':1},'Reinigen':{'kind':'material','id':'clean','quantity':1}})
  await self.done(o,consume_material=True,cycle=0)
  self.assertEqual(o.data['settings']['consumables']['salt']['quantity'],4);self.assertEqual(o.data['settings']['consumables']['clean']['quantity'],3);self.assertEqual(o.data['rules']['r']['rotation_step'],1)
  await ns['execute'](o,'complete',{'revision':o.data['revision'],'operation_id':'second','rule_id':'r','consume_material':True,'cycle':1})
  self.assertEqual(o.data['settings']['consumables']['clean']['quantity'],2)
