from backend_test_support import deepcopy, engine, unittest

class EvernoteCleanup(unittest.TestCase):
 def test_removes_nested_sources_and_links_but_preserves_facts_and_other_sources(self):
  url='https://share.evernote.com/note/00000000-0000-4000-8000-000000000001'
  data=engine.blank();data['devices']['d']={'id':'d','name':'Gerät','serial':'123','source_ref':url,'source_refs':[url,'https://example.org/manual.pdf'],'notes':'\nModell 1300. '+url+'\nPreis CHF 263.00','evernote_note_id':'11111111-2222-3333-4444-555555555555'}
  data['logs']['l']={'id':'l','device_id':'d','note':'Reinigung','edits':[{'before':{'source_ref':url,'note':'Filter reinigen '+url}}]}
  data['imports']['evernote:11111111-2222-3333-4444-555555555555:device']={'id':'d','collection':'devices'}
  result=engine.remove_evernote_sources(data)
  self.assertNotIn('source_ref',result['devices']['d']);self.assertNotIn('evernote_note_id',result['devices']['d']);self.assertEqual(result['devices']['d']['source_refs'],['https://example.org/manual.pdf']);self.assertEqual(result['devices']['d']['notes'],'\nModell 1300. \nPreis CHF 263.00');self.assertEqual(result['devices']['d']['serial'],'123')
  self.assertNotIn('source_ref',result['logs']['l']['edits'][0]['before']);self.assertNotIn(url,str(result));self.assertTrue(next(iter(result['imports'])).startswith('source:sha256:'));self.assertEqual(engine.remove_evernote_sources(deepcopy(result)),result)
 def test_hashed_import_keys_keep_duplicate_protection(self):
  data=engine.blank();record={'source_key':'evernote:11111111-2222-3333-4444-555555555555:device','collection':'devices','value':{'id':'d','name':'Gerät','source_ref':'evernote-note:11111111-2222-3333-4444-555555555555'}}
  first,counts=engine.import_new(data,[record]);self.assertEqual(counts['new'],1);self.assertNotIn('source_ref',first['devices']['d'])
  again,counts=engine.import_new(first,[record]);self.assertEqual(counts['new'],0);self.assertEqual(counts['existing'],1);self.assertEqual(len(again['devices']),1)
 def test_non_source_notes_remain_exactly_unchanged(self):
  data=engine.blank();data['devices']['d']={'id':'d','name':'Gerät','notes':'\nPreis 1499.00 CHF\nHersteller und Seriennummer','source_ref':'invoice:example-0001'}
  self.assertEqual(engine.remove_evernote_sources(deepcopy(data)),data)
