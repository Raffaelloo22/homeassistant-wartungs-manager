"""Registry output parity and area-only reads without an entity scan."""
import ast
import unittest
from types import SimpleNamespace as Obj
from backend_test_support import ROOT


class CountingDict(dict):
    reads = 0
    def values(self):
        self.reads += 1
        return super().values()


class RegistryCleanup(unittest.TestCase):
    def setup_registry(self):
        def device(identity, **extra):
            return Obj(**dict(id=identity, name_by_user=None, name=None,
                manufacturer='Maker', model='Model', area_id=None,
                disabled_by=None, entry_type=None, **extra))
        def entity(identity, domain, device_id, **extra):
            value = dict(id=identity, entity_id=domain+'.'+identity, domain=domain,
                device_id=device_id, name=None, original_name=None, disabled_by=None,
                entity_category=None, device_class=None, original_device_class=None, platform='test')
            value.update(extra)
            return Obj(**value)
        # Explicit records cover user-name priority, fallback ID, service and disabled status.
        devices = [device('d1'), device('d2'), device('d3')]
        devices[0].name='Original';devices[0].name_by_user='User';devices[0].area_id='a'
        devices[1].name='Service';devices[1].entry_type=Obj(value='service');devices[1].disabled_by='user';devices[1].area_id='missing'
        entities = CountingDict({e.id:e for e in [
            entity('battery','sensor','d1',original_name='Battery',original_device_class='battery'),
            entity('switch','switch','d1'),
            entity('hidden','sensor','d1',disabled_by='user'),
            entity('diagnostic','sensor','d1',entity_category='diagnostic'),
            entity('orphan','sensor',None,name='Standalone'),
            entity('light','light','d2',device_class='light'),
        ]})
        lookups=[]
        area=Obj(name='Kitchen')
        areas=Obj(async_get_area=lambda identity: area if identity=='a' else None, async_list_areas=lambda:[area])
        def get_entities(hass):
            lookups.append('entities')
            return Obj(entities=entities)
        source=ast.parse((ROOT/'custom_components/ha_wartung/__init__.py').read_text())
        cls=next(node for node in source.body if isinstance(node,ast.ClassDef) and node.name=='Directory')
        method=next(node for node in cls.body if isinstance(node,ast.FunctionDef) and node.name=='registry')
        namespace={'ar':Obj(async_get=lambda hass:areas),'dr':Obj(async_get=lambda hass:Obj(devices={d.id:d for d in devices})),'er':Obj(async_get=get_entities)}
        exec(compile(ast.fix_missing_locations(ast.Module(body=[method],type_ignores=[])),'real_registry','exec'),namespace)
        return namespace['registry'],Obj(hass=Obj()),entities,lookups

    def test_full_registry_keeps_all_fields_order_and_filtering_with_one_entity_scan(self):
        registry,obj,entities,lookups=self.setup_registry()
        result=registry(obj)
        self.assertEqual(result['devices'],[
            {'id':'d1','name':'User','manufacturer':'Maker','model':'Model','area':'Kitchen','disabled':False,'service':False,
             'entity_types':[{'domain':'sensor','device_class':'battery'},{'domain':'switch','device_class':None}]},
            {'id':'d2','name':'Service','manufacturer':'Maker','model':'Model','area':None,'disabled':True,'service':True,
             'entity_types':[{'domain':'light','device_class':'light'}]},
            {'id':'d3','name':'d3','manufacturer':'Maker','model':'Model','area':None,'disabled':False,'service':False,'entity_types':[]},
        ])
        self.assertEqual([s['id'] for s in result['sensors']],['battery','hidden','diagnostic','orphan'])
        self.assertEqual(result['sensors'][0],{'id':'battery','entity_id':'sensor.battery','name':'Battery','device_id':'d1','platform':'test','disabled':False})
        self.assertTrue(result['sensors'][1]['disabled'])
        self.assertEqual(result['sensors'][-1]['name'],'Standalone')
        self.assertEqual(result['areas'],['Kitchen'])
        self.assertEqual(entities.reads,1)
        self.assertEqual(lookups,['entities'])

    def test_area_only_registry_skips_entity_registry_entirely(self):
        registry,obj,entities,lookups=self.setup_registry()
        self.assertEqual(registry(obj,areas_only=True),{'devices':[
            {'id':'d1','area':'Kitchen'},{'id':'d2','area':None},{'id':'d3','area':None}]})
        self.assertEqual(entities.reads,0)
        self.assertEqual(lookups,[])
