import ast,asyncio,unittest,re,sys
from pathlib import Path
from copy import deepcopy
from datetime import datetime,timezone
from types import SimpleNamespace
from uuid import uuid4
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'custom_components'/'ha_wartung'))
import engine
from materials import return_event_stock
source=ast.parse((ROOT/'custom_components'/'ha_wartung'/'__init__.py').read_text())
cls=next(x for x in source.body if isinstance(x,ast.ClassDef) and x.name=='Directory')
method=next(x for x in cls.body if isinstance(x,ast.AsyncFunctionDef) and x.name=='execute')
mod=ast.Module(body=[x for x in source.body if isinstance(x,ast.FunctionDef)]+[method],type_ignores=[]);ast.fix_missing_locations(mod)
ns={'deepcopy':deepcopy,'dt_util':SimpleNamespace(now=lambda:datetime(2026,11,21,tzinfo=timezone.utc)),'engine':engine,'re':re,'uuid4':uuid4,'return_event_stock':return_event_stock}
exec(compile(mod,'transaction_after.py','exec'),ns)
class Transactions(unittest.IsolatedAsyncioTestCase):
 def obj(self,stock=3):
  obj=SimpleNamespace(data={**engine.blank(),'settings':{'battery_inventory':{'AAA':stock}},'devices':{'d':{'id':'d','name':'Sensor','battery_type':'AAA','battery_quantity':2}}},lock=asyncio.Lock())
  def revision(p):
   if p['revision']!=obj.data['revision']:raise ValueError('stale')
  obj.check_revision=revision;obj.validate_registry_links=lambda data:None
  async def commit(new):engine.validate_data(new);obj.data=new
  obj.commit=commit
  return obj
 async def call(self,obj,action,**p):return await ns['execute'](obj,action,{'revision':obj.data['revision'],**p})
 async def replace(self,obj,op='op',**value):return await self.call(obj,'battery_replacement',operation_id=op,value={'device_id':'d',**value})
 async def test_deduct_threshold_duplicate_and_undo(self):
  o=self.obj();r=await self.replace(o);self.assertEqual(o.data['settings']['battery_inventory']['AAA'],1)
  self.assertFalse(o.data['shopping']['battery-stock:AAA']['done']);self.assertEqual(o.data['logs'][r['id']]['battery_stock_movement']['quantity'],2)
  before=deepcopy(o.data);r2=await ns['execute'](o,'battery_replacement',{'revision':0,'operation_id':'op','value':{'device_id':'d'}});self.assertTrue(r2['already_saved']);self.assertEqual(before,o.data)
  await self.call(o,'delete_log',id=r['id'],confirmed=True);self.assertEqual(o.data['settings']['battery_inventory']['AAA'],3);self.assertTrue(o.data['shopping']['battery-stock:AAA']['done'])
  before=deepcopy(o.data)
  with self.assertRaises(ValueError):await self.call(o,'delete_log',id=r['id'],confirmed=True)
  self.assertEqual(before,o.data)
 async def test_validation_atomicity(self):
  for value in [{'battery_quantity':0},{'battery_quantity':1.5},{'battery_quantity':True},{'battery_type':'XXX'},{'event_date':'2030-01-01'},{'cost':-1}]:
   o=self.obj();before=deepcopy(o.data)
   with self.assertRaises(ValueError):await self.replace(o,**value)
   self.assertEqual(before,o.data)
 async def test_negative_and_restock(self):
  o=self.obj(1);await self.replace(o);self.assertEqual(o.data['settings']['battery_inventory']['AAA'],-1)
  await self.call(o,'battery_inventory',stocks={'AAA':10});self.assertTrue(o.data['shopping']['battery-stock:AAA']['done'])
 async def test_remove_readd_and_custom_types(self):
  o=self.obj();await self.call(o,'battery_inventory',stocks={'CR2025':1});self.assertFalse(o.data['shopping']['battery-stock:CR2025']['done'])
  await self.call(o,'battery_inventory',remove_types=['CR2025','AAA']);self.assertNotIn('CR2025',o.data['settings']['battery_inventory']);self.assertNotIn('battery-stock:CR2025',o.data['shopping'])
  with self.assertRaises(ValueError):await self.replace(o)
  await self.call(o,'battery_inventory',stocks={'AAA':4});self.assertNotIn('AAA',o.data['settings']['battery_inventory_hidden_types']);await self.replace(o);self.assertEqual(o.data['settings']['battery_inventory']['AAA'],2)
 async def test_normalize_retains_other_data(self):
  o=self.obj();o.data['devices']['d'].update(battery_type='4 × AA',battery_quantity=None,serial='XYZ');o.data['settings']['battery_inventory']['AA']=1
  await self.call(o,'normalize_battery_devices');self.assertEqual(o.data['devices']['d']['battery_type'],'AA');self.assertEqual(o.data['devices']['d']['battery_quantity'],4);self.assertEqual(o.data['devices']['d']['serial'],'XYZ')
  before=deepcopy(o.data['devices']);await self.call(o,'normalize_battery_devices');self.assertEqual(before,o.data['devices'])
 async def test_commit_failure_no_partial_update(self):
  o=self.obj();before=deepcopy(o.data)
  async def failure(new):raise OSError('disk full')
  o.commit=failure
  with self.assertRaises(OSError):await self.replace(o)
  self.assertEqual(before,o.data)
if __name__=='__main__':unittest.main()
