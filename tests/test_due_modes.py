from backend_test_support import datetime, engine, timezone, unittest
class DueModes(unittest.TestCase):
 def rule(self,kind):return {'id':'r','device_id':'d','name':'Test','kind':kind}
 def test_none_no_date_and_done(self):
  r=self.rule('none');engine.validate_rule(r);now=datetime(2026,11,21,tzinfo=timezone.utc)
  self.assertEqual(engine.view(r,now.date(),now)['status'],'no_due');r['last_completed']='2026-11-21';self.assertEqual(engine.view(r,now.date(),now)['status'],'ok')
 def test_date_once_and_validation(self):
  r=self.rule('date')
  with self.assertRaises(ValueError):engine.validate_rule(r)
  r['due_date']='2026-11-21';engine.validate_rule(r);now=datetime(2026,11,21,tzinfo=timezone.utc)
  self.assertEqual(engine.view(r,now.date(),now)['status'],'due');r['last_completed']='2026-11-21';self.assertEqual(engine.view(r,now.date(),now)['status'],'due');r['completed_due_date']=r['due_date'];self.assertEqual(engine.view(r,now.date(),now)['status'],'ok')
  r['due_date']='2026-02-30'
  with self.assertRaises(ValueError):engine.validate_rule(r)

class OneOffCompletion(unittest.TestCase):
 def test_completion_is_tied_to_scheduled_date_and_undo(self):
  now=datetime(2026,11,21,tzinfo=timezone.utc);data=engine.blank();data['devices']['d']={'id':'d','name':'D'};data['rules']['r']={'id':'r','device_id':'d','name':'Termin','kind':'date','due_date':'2026-12-15','last_completed':'2025-12-15'}
  self.assertEqual(engine.view(data['rules']['r'],now.date(),now)['status'],'scheduled')
  done,log=engine.complete(data,'r',event_date='2026-11-21',now=now,operation_id='one-off',expected_revision=data['revision'])
  self.assertEqual(engine.view(done['rules']['r'],now.date(),now)['status'],'ok')
  reopened=engine.delete_log(done,log,now);self.assertEqual(engine.view(reopened['rules']['r'],now.date(),now)['status'],'scheduled')
  done['rules']['r']['due_date']='2027-01-15';self.assertEqual(engine.view(done['rules']['r'],now.date(),now)['status'],'scheduled')
