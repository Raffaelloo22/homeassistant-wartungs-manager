import ast
import unittest
from copy import deepcopy
from types import SimpleNamespace
from backend_test_support import ROOT, engine, ns

source=ast.parse((ROOT/'custom_components/ha_wartung/__init__.py').read_text())
cls=next(n for n in source.body if isinstance(n,ast.ClassDef) and n.name=='Directory')
method=next(n for n in cls.body if isinstance(n,ast.AsyncFunctionDef) and n.name=='commit')
namespace={'engine':engine,'deepcopy':deepcopy,'apply_ha_device_areas':ns['apply_ha_device_areas'],'DOMAIN':'ha_wartung'}
exec(compile(ast.fix_missing_locations(ast.Module(body=[method],type_ignores=[])),'real_commit','exec'),namespace)

class PersistenceCleanup(unittest.IsolatedAsyncioTestCase):
 async def test_real_commit_sanitizes_both_stores_before_publishing(self):
  events=[];old=engine.blank();old['devices']['d']={'id':'d','name':'Gerät','source_ref':'evernote-note:11111111-2222-3333-4444-555555555555'}
  async def rollback(value):events.append(('rollback',deepcopy(value)))
  async def store(value):events.append(('store',deepcopy(value)))
  obj=SimpleNamespace(data=old,registry=lambda **kwargs:{'devices':[]},rollback=SimpleNamespace(async_save=rollback),store=SimpleNamespace(async_save=store),hass=SimpleNamespace(bus=SimpleNamespace(async_fire=lambda *args:events.append(('event',args)))))
  new=deepcopy(old);new['revision']+=1;new['devices']['d']['notes']='Neue Notiz'
  await namespace['commit'](obj,new)
  self.assertEqual([event[0] for event in events],['rollback','store','event']);self.assertNotIn('source_ref',events[0][1]['devices']['d']);self.assertNotIn('source_ref',events[1][1]['devices']['d']);self.assertEqual(obj.data['devices']['d']['notes'],'Neue Notiz')
 async def test_store_failure_does_not_publish_or_replace_runtime_data(self):
  events=[];old=engine.blank()
  async def rollback(value):events.append('rollback')
  async def store(value):raise OSError('disk full')
  obj=SimpleNamespace(data=old,registry=lambda **kwargs:{'devices':[]},rollback=SimpleNamespace(async_save=rollback),store=SimpleNamespace(async_save=store),hass=SimpleNamespace(bus=SimpleNamespace(async_fire=lambda *args:events.append('event'))))
  new=deepcopy(old);new['revision']+=1
  with self.assertRaises(OSError):await namespace['commit'](obj,new)
  self.assertIs(obj.data,old);self.assertEqual(events,['rollback'])
