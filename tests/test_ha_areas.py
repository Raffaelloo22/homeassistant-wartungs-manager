from backend_test_support import ns, unittest
class HAAreas(unittest.TestCase):
 def test_only_registry_defines_area(self):
  data={'devices':{'a':{'id':'a','ha_device_id':'ha-a','area':'manuell'},'b':{'id':'b','area':'alt'},'c':{'id':'c','ha_device_id':'missing','area':'alt'}}}
  ns['apply_ha_device_areas'](data,{'devices':[{'id':'ha-a','area':'Küche'}]})
  self.assertEqual(data['devices']['a']['area'],'Küche');self.assertIsNone(data['devices']['b']['area']);self.assertIsNone(data['devices']['c']['area'])
  ns['apply_ha_device_areas'](data,{'devices':[{'id':'ha-a','area':'Büro'}]})
  self.assertEqual(data['devices']['a']['area'],'Büro')
