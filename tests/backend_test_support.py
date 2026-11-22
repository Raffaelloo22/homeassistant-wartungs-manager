import ast,asyncio,unittest,re,sys
from pathlib import Path
from copy import deepcopy
from datetime import datetime,timezone
from types import SimpleNamespace
from uuid import uuid4
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'custom_components'/'ha_wartung'));import engine
s=ast.parse((ROOT/'custom_components'/'ha_wartung'/'__init__.py').read_text());cls=next(x for x in s.body if isinstance(x,ast.ClassDef) and x.name=='Directory');method=next(x for x in cls.body if isinstance(x,ast.AsyncFunctionDef) and x.name=='execute');default=next(x for x in s.body if isinstance(x,ast.Assign) and any(isinstance(n,ast.Name) and n.id=='DEFAULT_DEVICE_CATEGORIES' for n in x.targets));m=ast.Module(body=[default]+[x for x in s.body if isinstance(x,ast.FunctionDef)]+[method],type_ignores=[]);ast.fix_missing_locations(m);ns={'deepcopy':deepcopy,'dt_util':SimpleNamespace(now=lambda:datetime.now(timezone.utc)),'engine':engine,'re':re,'uuid4':uuid4};exec(compile(m,'backend','exec'),ns)
class DirectoryTestCase(unittest.IsolatedAsyncioTestCase):
 def obj(self):
  o=SimpleNamespace(data={**engine.blank(),'devices':{'d':{'id':'d','name':'Lampe','category':'Licht'}},'settings':{'device_categories':['Licht','Heizung','Sensoren']}},lock=asyncio.Lock());o.validate_registry_links=lambda _:None
  def check(p):
   if p['revision']!=o.data['revision']:raise ValueError('stale')
  o.check_revision=check
  async def commit(data):engine.validate_data(data);o.data=data
  o.commit=commit;return o

# Register all execution dependencies here; test discovery order must not matter.
from battery_edit import edit_battery_type
from materials import material_info, consume, undo_consumption, return_event_stock
from onboarding import capture_preview, apply_capture, device_type
ns.update(Path=Path, edit_battery_type=edit_battery_type, material_info=material_info, consume=consume, undo_consumption=undo_consumption, return_event_stock=return_event_stock, capture_preview=capture_preview, apply_capture=apply_capture)

class TaskMaterialFixture:
 def linked(self,kind='battery',quantity=2,stock=5):
  o=self.obj();o.data['devices']['d'].update(battery_quantity=quantity,battery_type='AA');o.data['settings']['battery_inventory']={'AA':5 if kind=='material' and stock is None else stock}
  o.data['settings']['consumables']={'salt':{'id':'salt','name':'Salz','unit':'Säcke','quantity':stock,'threshold':1}}
  o.data['rules']['r']={'id':'r','device_id':'d','name':'Wechsel','kind':'interval','months':2,'consumable':{'kind':kind,'id':'AA' if kind=='battery' else 'salt','quantity':1}}
  return o
 async def done(self,o,**p):return await ns['execute'](o,'complete',{'revision':o.data['revision'],'operation_id':'test-op','rule_id':'r',**p})

from diagnostics import inspect_directory
ns.update(inspect_directory=inspect_directory)
