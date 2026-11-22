from backend_test_support import DirectoryTestCase, deepcopy, ns, unittest
from onboarding import capture_preview,apply_capture,device_type

def registry():
 return {'devices':[{'id':'ha-a','name':'Licht Büro','manufacturer':'Hue','model':'Lily','area':'Büro','entity_types':[{'domain':'light','device_class':None}]},{'id':'ha-b','name':'Fenster Zoé','manufacturer':'Aqara','model':'Door','area':'Zoé','entity_types':[{'domain':'binary_sensor','device_class':'window'}]}]}

class Capture(DirectoryTestCase):
 async def test_repeatable_capture_and_no_rules(self):
  o=self.obj();o.registry=registry
  o.data['settings']['initial_device_capture']={'completed_at':'2026-01-01','created':0}
  result=await ns['execute'](o,'initial_capture_commit',{'revision':o.data['revision'],'types':['light'],'device_ids':['ha-a'],'confirmed':True})
  self.assertEqual(result['created'],1);self.assertEqual(o.data['rules'],{})
  preview=capture_preview(o.data,registry());self.assertEqual([d['id'] for d in preview['candidates']],['ha-b'])
  result=await ns['execute'](o,'initial_capture_commit',{'revision':o.data['revision'],'types':['contact'],'device_ids':['ha-b'],'confirmed':True})
  self.assertEqual(result['created'],1);self.assertEqual(o.data['rules'],{})
  self.assertEqual(o.data['devices']['ha-initial:ha-a']['ha_device_id'],'ha-a')
  self.assertEqual(o.data['devices']['ha-initial:ha-b']['ha_device_id'],'ha-b')
  before=deepcopy(o.data)
  with self.assertRaises(ValueError):await ns['execute'](o,'initial_capture_commit',{'revision':o.data['revision'],'types':['contact'],'device_ids':['ha-b'],'confirmed':True})
  self.assertEqual(o.data,before)
 async def test_stale_revision_still_rejected_after_previous_capture(self):
  o=self.obj();o.registry=registry;o.data['settings']['initial_device_capture']={'created':1}
  before=deepcopy(o.data)
  with self.assertRaises(ValueError):await ns['execute'](o,'initial_capture_commit',{'revision':-1,'types':['contact'],'device_ids':['ha-b'],'confirmed':True})
  self.assertEqual(o.data,before)
 async def test_duplicate_and_stale_selection_atomic(self):
  for extra,ids in [({'id':'existing','name':'Andere Bezeichnung','ha_device_id':'ha-a','archived':True},['ha-a']),({'id':'existing','name':'Licht Büro','deleted_at':'2026-11-21T12:00:00+01:00'},['ha-a'])]:
   o=self.obj();o.registry=registry;o.data['devices']['existing']=extra;before=deepcopy(o.data)
   with self.assertRaises(ValueError):await ns['execute'](o,'initial_capture_commit',{'revision':o.data['revision'],'types':['light'],'device_ids':ids,'confirmed':True})
   self.assertEqual(o.data,before)
 async def test_reject_unconfirmed_wrong_type_duplicates_and_empty(self):
  for types,ids,confirmed in [(['contact'],['ha-a'],True),(['light'],['ha-a','ha-a'],True),(['light'],[],True),(['light'],['ha-a'],False),([],['ha-a'],True)]:
   o=self.obj();o.registry=registry;before=deepcopy(o.data)
   with self.assertRaises(ValueError):await ns['execute'](o,'initial_capture_commit',{'revision':o.data['revision'],'types':types,'device_ids':ids,'confirmed':confirmed})
   self.assertEqual(o.data,before)
 def test_preview_no_mutation_and_types(self):
  data=self.obj().data;before=deepcopy(data);result=capture_preview(data,registry(),['contact'])
  self.assertEqual(data,before);self.assertEqual([r['id'] for r in result['candidates']],['ha-b']);self.assertEqual(device_type(registry()['devices'][0]),'light')
 def test_ambiguous_names_and_services_skipped(self):
  reg=registry();reg['devices'].append(dict(reg['devices'][0],id='duplicate'));reg['devices'].append(dict(reg['devices'][1],id='service',service=True))
  result=capture_preview(self.obj().data,reg,['light','contact']);self.assertEqual([r['id'] for r in result['candidates']],['ha-b']);self.assertEqual(len(result['skipped']),2)

class CaptureCounts(unittest.TestCase):
 def test_counts_separate_existing_new_and_conflicts(self):
  reg=registry();reg['devices'] += [dict(reg['devices'][0],id='ha-c',name='Manuelle Lampe'),dict(reg['devices'][0],id='ha-d',name='Neue Lampe')]
  data={'devices':{'known':{'id':'known','name':'Alt','ha_device_id':'ha-a','archived':True},'manual':{'id':'manual','name':'Manuelle Lampe'}}}
  result=capture_preview(data,reg);types={t['id']:t for t in result['types']}
  self.assertEqual((types['light']['existing_count'],types['light']['new_count'],types['light']['conflict_count']),(1,1,1))
  self.assertEqual(types['contact']['new_count'],1)
  for t in types.values():self.assertEqual(t['count'],t['existing_count']+t['new_count']+t['conflict_count'])
  filtered=capture_preview(data,reg,['light']);self.assertEqual(filtered['types'],result['types']);self.assertEqual([d['id'] for d in filtered['candidates']],['ha-d'])
