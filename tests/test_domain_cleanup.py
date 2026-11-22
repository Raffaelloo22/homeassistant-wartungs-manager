import ast
import unittest
from pathlib import Path
from copy import deepcopy
from backend_test_support import ROOT, engine, ns
from materials import validate_link_shape

class DomainCleanup(unittest.TestCase):
 def test_battery_normalization_preserves_existing_cases(self):
  cases={None:'','':'',' 2 × AA ':'AA','3xAAA':'AAA','CR123A (Lithium)':'CR123A','cr123a Batterie':'CR123A','9 V':'9V','9v':'9V','AA (Lithium)':'AA (Lithium)','2 × 3 × AA':'3 × AA'}
  for value,expected in cases.items():
   with self.subTest(value=value):self.assertEqual(engine.normalize_battery_type(value),expected);self.assertEqual(ns['battery_type'](value),expected)
 def test_link_validation_preserves_context_specific_errors(self):
  valid=[None,{'kind':'battery','id':'AA'},{'kind':'material','id':'salt','quantity':0.5}]
  for link in valid:engine.validate_consumable_link(link);validate_link_shape(link)
  for link in [False,[],{'kind':'bad','id':'AA'},{'kind':'battery','id':''}]:
   with self.assertRaisesRegex(ValueError,'Ungültige Verbrauchsmaterial-Verknüpfung'):engine.validate_consumable_link(link)
   with self.assertRaisesRegex(ValueError,'Bitte ein Verbrauchsmaterial auswählen'):validate_link_shape(link)
  for quantity in [True,0,-1,float('nan'),float('inf'),100001]:
   for validate in [engine.validate_consumable_link,validate_link_shape]:
    with self.assertRaisesRegex(ValueError,'Verbrauchsmenge'):validate({'kind':'material','id':'salt','quantity':quantity})
 def test_directory_sanitizer_matches_previous_pipeline(self):
  data={'devices':{'d':{'id':'d','name':'Gerät','notes':'Erhalten','incoming_devices':[{'id':'b'}],'related_devices':[{'id':'b','type':'Steuerung'}],'image_id':'a'*32,'source_ref':'evernote-note:11111111-2222-3333-4444-555555555555'}},'logs':{'l':{'note':'Wartung','source_ref':'alt'}},'settings':{'relationship_types':['Steuerung'],'device_categories':['Licht'],'event_types':{'custom':'Prüfung'}}}
  expected=deepcopy(data);expected['settings'].pop('relationship_types');expected['devices']['d'].pop('incoming_devices');expected['devices']['d']['related_devices']=[{'id':'b'}];expected=engine.remove_evernote_sources(engine.remove_device_images(engine.remove_log_sources(expected)))
  self.assertEqual(engine.sanitize_directory(deepcopy(data)),expected);self.assertEqual(engine.sanitize_directory(deepcopy(expected)),expected)
 def test_backend_default_categories_and_version_are_consistent(self):
  import json
  tree=ast.parse((ROOT/'custom_components/ha_wartung/__init__.py').read_text());assigns={n.targets[0].id:n.value for n in tree.body if isinstance(n,ast.Assign) and isinstance(n.targets[0],ast.Name)}
  self.assertEqual(ns['DEFAULT_DEVICE_CATEGORIES'],engine.DEFAULT_DEVICE_CATEGORIES)
  manifest=json.loads((ROOT/'custom_components/ha_wartung/manifest.json').read_text());self.assertEqual(ast.literal_eval(assigns['VERSION']),manifest['version']);self.assertEqual(engine.BACKEND_UPCOMING_DAYS,7)
