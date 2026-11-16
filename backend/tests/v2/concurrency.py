#!/usr/bin/env python3
"""Synthetic PostgreSQL tests only; takes the disposable container name, never a remote URL."""
import concurrent.futures
import json
import subprocess
import sys
import uuid
container=sys.argv[1]
if not container.startswith('pactfit-v2-test-'):
    raise SystemExit('Refusing a non-test container')
def sql(query):
    p=subprocess.run(['docker','exec','-i',container,'psql','-h','127.0.0.1','-U','postgres','-qAt','-v','ON_ERROR_STOP=1'],input=query,text=True,capture_output=True,check=True)
    return p.stdout.strip()
def uid(n): return f'00000000-0000-0000-0000-{n:012d}'
def quote(s):return "'"+str(s).replace("'","''")+"'"
def as_user(n,q):return sql(f"SET ROLE authenticated; SET request.jwt.claim.sub={quote(uid(n))}; {q}")
def command(n,action,args=None):
    return json.loads(as_user(n,f"SELECT public.v2_command({quote(action)},{quote(json.dumps(args or {}))}::jsonb);"))
def snapshot(n,space=None):
    return json.loads(as_user(n,f"SELECT public.v2_snapshot({quote(space)+'::uuid' if space else 'NULL'});"))
def parallel(fn,items):
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as ex:return list(ex.map(fn,items))
def init(n):
    assert command(n,'bootstrap')['ok']
    return snapshot(n)
# Seven simultaneous creates cannot bypass the combined five-team cap.
init(100)
created=parallel(lambda i:command(100,'create_space',{'name':f'并发团队{i}'}),range(7))
assert sum(x['ok'] for x in created)==5,created
assert len(snapshot(100)['spaces'])==6
# Ten simultaneous invitation acceptances cannot exceed six seats including captain.
init(200)
team=command(200,'create_space',{'name':'席位并发团队'})['data']['space_id']
requests=[]
for i in range(201,211):
    person=init(i)['me']
    assert command(200,'invite',{'space_id':team,'public_id':person['public_id']})['ok']
    pending=next(r for r in snapshot(i)['requests'] if r['status']=='pending')
    requests.append((i,pending['id']))
accepted=parallel(lambda pair:(pair[0],command(pair[0],'respond',{'request_id':pair[1],'accept':True})),requests)
assert sum(r['ok'] for _,r in accepted)==5,accepted
assert len(snapshot(200,team)['members'])==6
winner=next(n for n,result in accepted if result['ok'])
# Concurrent edits and checkins, including cross-space edits, issue each reward once.
private=init(300)['space']['id']
checks=parallel(lambda _:command(300,'checkin',{'space_id':private,'weight':None}),range(12))
assert all(c['ok'] for c in checks)
state=snapshot(300)
assert state['gems']==2 and len(state['ledger'])==2 and len(state['personal_checkins'])==1
# Prices/limits are enabled ONLY in this synthetic test, never in shipped configuration.
sql("UPDATE public.v2_catalog SET enabled=true,price=1,max_quantity=1 WHERE code='space_slot';")
key=str(uuid.uuid4())
buys=parallel(lambda _:command(300,'purchase',{'product':'space_slot','request_key':key}),range(8))
assert all(b['ok'] for b in buys),buys
state=snapshot(300)
assert state['gems']==1 and state['space_limit']==6
assert sum(1 for row in state['ledger'] if row['amount']<0)==1
assert command(300,'purchase',{'product':'space_slot','request_key':str(uuid.uuid4())})['code']=='product_limit'
# Two different purchase keys still cannot overdraw a wallet.
sql("UPDATE public.v2_catalog SET price=2,max_quantity=5 WHERE code='space_slot';")
private=init(301)['space']['id']
assert command(301,'checkin',{'space_id':private})['ok']
buys=parallel(lambda _:command(301,'purchase',{'product':'space_slot','request_key':str(uuid.uuid4())}),range(2))
assert sum(b['ok'] for b in buys)==1,buys
assert snapshot(301)['gems']==0
# Team seat purchase changes only this team; ordinary members cannot purchase on its behalf.
sql("UPDATE public.v2_catalog SET enabled=true,price=1,max_quantity=2 WHERE code='team_seat';")
private=snapshot(200)['space']['id']
assert command(200,'checkin',{'space_id':private})['ok']
assert command(winner,'purchase',{'space_id':team,'product':'team_seat','request_key':str(uuid.uuid4())})['code']=='forbidden'
assert command(200,'purchase',{'space_id':team,'product':'team_seat','request_key':str(uuid.uuid4())})['ok']
assert snapshot(200,team)['space']['limit']==7
# Activity authorization and likes are checked on the server, including after revocation.
assert command(200,'settings',{'share_activity':True})['ok']
events=[v for v in snapshot(winner,team)['events'] if v['nickname']==snapshot(200)['me']['nickname']]
assert events
my_event=sql(f"SELECT id FROM public.v2_events WHERE actor_id={quote(uid(200))} ORDER BY created_at LIMIT 1;")
assert command(winner,'like',{'event_id':my_event,'liked':True})['ok']
assert command(winner,'like',{'event_id':my_event,'liked':True})['ok']
assert sql(f"SELECT count(*) FROM public.v2_likes WHERE event_id={quote(my_event)};")=='1'
assert command(winner,'like',{'event_id':my_event,'liked':False})['ok']
assert command(200,'settings',{'share_activity':False})['ok']
assert command(winner,'like',{'event_id':my_event,'liked':True})['code']=='forbidden'
# Dissolution cannot transfer a team's extra seat or deduct previously earned personal gems.
wallet=snapshot(200)['gems']
assert command(200,'dissolve',{'space_id':team,'confirm':'DISSOLVE'})['ok']
new_team=command(200,'create_space',{'name':'全新团队'})['data']['space_id']
assert snapshot(200,new_team)['space']['limit']==6
assert snapshot(200)['gems']==wallet
print('PASS concurrent quotas/seats, idempotent rewards/purchases, no overdraft, authorization revocation, team-bound entitlements')
