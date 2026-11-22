from backend_test_support import DirectoryTestCase, deepcopy, ns, unittest
class Purchases(DirectoryTestCase):
 async def test_battery_purchase_and_retry(self):
  o=self.obj();o.data['settings']['battery_inventory']={'CR2032':0};o.data['shopping']['s']={'id':'s','battery_type':'CR2032','name':'Batterien','done':False}
  p={'id':'s','quantity':5,'operation_id':'test','revision':o.data['revision']}
  await ns['execute'](o,'battery_purchase',p);self.assertEqual(o.data['settings']['battery_inventory']['CR2032'],5)
  await ns['execute'](o,'battery_purchase',p);self.assertEqual(o.data['settings']['battery_inventory']['CR2032'],5)
 async def test_invalid_purchase_atomic(self):
  o=self.obj();o.data['shopping']['s']={'id':'s','battery_type':'CR2032','name':'Batterien','done':False};o.data['settings']['battery_inventory']={'CR2032':0}
  before=deepcopy(o.data)
  with self.assertRaises(ValueError):await ns['execute'](o,'battery_purchase',{'id':'s','quantity':-1,'operation_id':'bad','revision':o.data['revision']})
  self.assertEqual(o.data,before)
 async def test_material_threshold_and_purchase(self):
  o=self.obj();m={'id':'salt','name':'Entkalkersalz','quantity':None,'unit':'Säcke','threshold':1}
  await ns['execute'](o,'save_consumable',{'value':m,'revision':o.data['revision']});self.assertNotIn('consumable:salt',o.data['shopping'])
  m['quantity']=1;await ns['execute'](o,'save_consumable',{'value':m,'revision':o.data['revision']});self.assertFalse(o.data['shopping']['consumable:salt']['done'])
  p={'id':'consumable:salt','quantity':2.5,'operation_id':'salt-buy','revision':o.data['revision']};await ns['execute'](o,'consumable_purchase',p);await ns['execute'](o,'consumable_purchase',p)
  self.assertEqual(o.data['settings']['consumables']['salt']['quantity'],3.5);self.assertTrue(o.data['shopping']['consumable:salt']['done'])
if __name__=='__main__':unittest.main()
