from backend_test_support import Path, deepcopy, engine, ns, unittest
import tempfile
class PhotoRemoval(unittest.TestCase):
 def test_remove_only_photo_fields_preserves_all_other_device_data(self):
  data={'devices':{'d':{'id':'d','name':'Gerät','notes':'Notiz','image_id':'a'*32,'image_source':{'note_url':'Quelle'},'image_upload':'bytes','related_devices':[{'id':'b'}]}},'logs':{'l':{'id':'l','note':'Historie'}},'rules':{'r':{'name':'Wartung'}}}
  before=deepcopy(data);clean=engine.remove_device_images(deepcopy(data));self.assertEqual(clean['logs'],before['logs']);self.assertEqual(clean['rules'],before['rules']);self.assertEqual(clean['devices']['d'],{k:v for k,v in before['devices']['d'].items() if not k.startswith('image_')});self.assertEqual(engine.remove_device_images(deepcopy(clean)),clean)
 def test_storage_cleanup_only_generated_photo_files(self):
  with tempfile.TemporaryDirectory() as tmp:
   folder=Path(tmp)/'ha_wartung_images';folder.mkdir();(folder/('a'*32+'.jpg')).write_bytes(b'photo');other=folder/'unrelated.txt';other.write_text('preserve')
   ns['purge_device_image_files'](folder);self.assertFalse((folder/('a'*32+'.jpg')).exists());self.assertEqual(other.read_text(),'preserve');other.unlink();ns['purge_device_image_files'](folder);self.assertFalse(folder.exists());ns['purge_device_image_files'](folder)
 def test_current_and_rollback_sanitizer_removes_image_assignments(self):
  clean=engine.sanitize_directory({'devices':{'d':{'name':'Gerät','image_id':'a'*32,'image_source':{'hash':'hash'}}},'logs':{}});self.assertNotIn('image_id',clean['devices']['d']);self.assertNotIn('image_source',clean['devices']['d'])
