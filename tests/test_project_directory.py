from backend_test_support import DirectoryTestCase, deepcopy, ns
class DirectoryRead(DirectoryTestCase):
 async def test_filtered_read_no_mutation(self):
  o=self.obj();o.data['devices']['ac']={'id':'ac','name':'Klima','manufacturer':'Mitsubishi','model':'MSZ'};o.data['rules']['r']={'device_id':'ac'};o.data['logs']['l']={'device_id':'d'};o.snapshot=lambda:deepcopy(o.data);before=deepcopy(o.data)
  result=await ns['execute'](o,'get',{'fields':['revision','devices','rules','logs'],'device_query':'mitsubishi'})
  self.assertEqual(set(result),{'revision','devices','rules','logs'});self.assertEqual(list(result['devices']),['ac']);self.assertEqual(list(result['rules']),['r']);self.assertEqual(result['logs'],{});self.assertEqual(o.data,before)
  self.assertEqual(await ns['execute'](o,'get',{}),before)
 async def test_export_can_find_deleted_devices(self):
  o=self.obj();o.data['devices']['d'].update(name='Klimagerät',deleted_at='2026-11-22')
  result=await ns['execute'](o,'export',{'fields':['revision','devices'],'device_query':'klima'});self.assertIn('d',result['devices'])
 async def test_invalid_fields(self):
  o=self.obj();o.snapshot=lambda:deepcopy(o.data)
  for payload in [{'fields':[]},{'fields':['not_present']},{'device_query':[]},{'device_query':''}]:
   with self.assertRaises(ValueError):await ns['execute'](o,'get',payload)
