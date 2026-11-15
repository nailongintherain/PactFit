#!/usr/bin/env python3
"""Read-only probe: no login, emails, mutations, or business data reads."""
import json
import os
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from urllib.parse import urlsplit
root = Path(__file__).resolve().parents[1]
values = dict(line.split('=', 1) for line in (root/'staging/env.example').read_text().splitlines() if line and not line.startswith('#'))
values.update({key: os.environ[key] for key in values if key in os.environ})
u = urlsplit(values['PACTFIT_STAGING_SUPABASE_URL'])
if u.scheme != 'https' or u.netloc != 'ksridewbjuwckuvougma.supabase.co' or u.path not in ('', '/', '/rest/v1', '/rest/v1/') or u.query or u.fragment:
    raise SystemExit('Refusing URL outside PactFit staging')
key = values['PACTFIT_STAGING_PUBLIC_KEY']
if not key.startswith('sb_publishable_'):
    raise SystemExit('Probe requires a public publishable key')
def get(path):
    try:
        with urlopen(Request('https://'+u.netloc+path, headers={'apikey':key}), timeout=20) as r:
            return r.status, json.load(r)
    except HTTPError as e:
        try:
            body = json.loads(e.read())
        except ValueError:
            body = {}
        return e.code, body
status, data = get('/auth/v1/settings')
if status != 200:
    raise SystemExit(f'FAIL Auth gateway HTTP {status}')
print('PASS publishable key accepted; email enabled=' + str(data.get('external', {}).get('email', False)))
pending = False
for table in ['profiles','records','todos','tags','messages','rewards','spaces','space_members']:
    status, data = get('/rest/v1/'+table+'?select=*&limit=0')
    code = data.get('code') if isinstance(data,dict) else None
    if code == 'PGRST205':
        print(f'PENDING {table}: missing from schema cache')
        pending = True
    elif status in (401,403) and code == '42501':
        print(f'PASS {table}: anonymous access denied')
    else:
        raise SystemExit(f'FAIL {table}: expected permission denial; HTTP {status}, code={code}')
if pending:
    raise SystemExit(2)
print('PASS read-only gateway checks; full RLS/RPC validation still required')
