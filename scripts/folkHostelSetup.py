"""One-time, guarded setup from the user's confirmed 2026-10-21 hostel roster.
Default is read-only. --apply commits field-masked writes with fresh update-time
preconditions, then reads every changed document back. Credentials stay local.
"""
import argparse
import concurrent.futures
import datetime
import json
import os
import subprocess

ASSIGNMENTS = {
    'Powai': ['adrd@hkmmumbai.org', 'mmkd@hkmmumbai.org', 'mtnd@hkmmumbai.org', 'srgd@hkmmumbai.org'],
    'Thane': ['adpd@hkmmumbai.org', 'arap@hkmmumbai.org', 'asgd@hkmmumbai.org', 'shnd@hkmmumbai.org', 'urgd@hkmmumbai.org'],
    'BKC': ['anhd@hkmmumbai.org', 'vdnd@hkmmumbai.org'],
    'Vashi': ['ashteshk@outlook.com'],
    'Airoli': ['ggud@hkmmumbai.org', 'hnmd@hkmmumbai.org', 'rmtd@hkmmumbai.org', 'vbmd@hkmmumbai.org'],
}
PROJECT = 'bvpw108'
ROOT = f'projects/{PROJECT}/databases/(default)/documents'
BASE = 'https://firestore.googleapis.com/v1/' + ROOT

def decode(v):
    if 'arrayValue' in v: return [decode(x) for x in v['arrayValue'].get('values', [])]
    if 'mapValue' in v: return {k: decode(x) for k, x in v['mapValue'].get('fields', {}).items()}
    return next(iter(v.values()), None)

def encode(v):
    if v is None: return {'nullValue': None}
    if isinstance(v, bool): return {'booleanValue': v}
    if isinstance(v, list): return {'arrayValue': {'values': [encode(x) for x in v]}}
    return {'stringValue': str(v)}

def request(url, body=None):
    token = json.load(open(os.path.expanduser('~/.config/configstore/firebase-tools.json')))['tokens']['access_token']
    # Supply the authorization header through stdin, not the process arguments.
    args = ['curl', '--silent', '--show-error', '--max-time', '60', '--config', '-', url]
    config = 'header = "Authorization: Bearer ' + token + '"\nheader = "Content-Type: application/json"\n'
    if body is not None: args += ['--data', json.dumps(body)]
    result = subprocess.run(args, input=config, capture_output=True, text=True, check=True)
    data = json.loads(result.stdout)
    if isinstance(data, dict) and data.get('error'): raise RuntimeError(data['error'])
    return data

def unpack(doc):
    return {'fields': {k: decode(v) for k, v in doc.get('fields', {}).items()}, 'id': doc['name'].split('/')[-1], 'name': doc['name'], 'version': doc['updateTime']}

def rows(table):
    result = request(BASE + ':runQuery', {'structuredQuery': {'from': [{'collectionId': table}]}})
    return [unpack(r['document']) for r in result if 'document' in r]

def refs(v):
    if isinstance(v, list): return [x for i in v for x in refs(i)]
    return [str(v).strip().lower()] if v else []

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--receipt', default='/tmp/folk-hostel-setup-receipt.json')
    args = parser.parse_args()
    tables = ['Users', 'Guides', 'FolkResidencies', 'AccountDeletionHolds', 'OneToOneMeetings']
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        data = dict(zip(tables, pool.map(rows, tables)))
    changes = {}
    def patch(row, fields):
        diff = {k: v for k, v in fields.items() if row['fields'].get(k) != v}
        if diff:
            entry = changes.setdefault(row['name'], {'row': row, 'patch': {}})
            entry['patch'].update(diff)
    def one_email(table, email):
        matches = [r for r in data[table] if str(r['fields'].get('email', '')).strip().lower() == email]
        assert len(matches) == 1, f'{table}: expected one profile for {email}, got {len(matches)}'
        return matches[0]
    vd = one_email('Users', 'vdnd@hkmmumbai.org')
    auth = request(f'https://identitytoolkit.googleapis.com/v1/projects/{PROJECT}/accounts:lookup', {'localId': [vd['id']]})['users']
    assert len(auth) == 1 and auth[0]['email'].lower() == 'vdnd@hkmmumbai.org'
    assert not auth[0].get('customAttributes'), 'Review Auth custom claims before applying'
    aliases = set(refs([vd['id'], vd['fields'].get('userId'), 'vdnd@hkmmumbai.org']))
    assert not any(any(set(refs(v)) & aliases for v in r['fields'].values()) for r in data['AccountDeletionHolds']), 'Deletion hold exists'
    for hostel, emails in ASSIGNMENTS.items():
        names = ['FOLK ' + hostel] + (['FOLK Sion'] if hostel == 'BKC' else [])
        matches = [r for r in data['FolkResidencies'] if r['fields'].get('residencyName') in names]
        assert len(matches) == 1, f'Ambiguous hostel {hostel}'
        center = matches[0]
        ids, labels = [], []
        for email in emails:
            user = one_email('Users', email)
            assert user['fields'].get('status') == 'Active', f'Inactive guide {email}'
            if email != 'vdnd@hkmmumbai.org':
                assert user['fields'].get('segment') == 'FOLK' and user['fields'].get('role') in ['Guide', 'Super Guide'], f'Not a FOLK guide: {email}'
            linked = [r for r in data['Guides'] if str(r['fields'].get('email', '')).lower() == email]
            assert len(linked) <= 1, f'Ambiguous Guides records for {email}'
            record = linked[0] if linked else user
            ids.append(record['id'])
            labels.append(record['fields'].get('fullName', user['fields']['fullName']))
            patch(user, {'folkResidencies': [center['id']]})
            for g in linked:
                patch(g, {'folkResidencies': [center['id']], 'segment': 'FOLK', 'isActive': True})
        patch(center, {'residencyName': 'FOLK ' + hostel, 'guideIds': ids, 'guides': ', '.join(labels), 'category': 'FOLK', 'segment': 'FOLK'})
        if hostel == 'BKC':
            patch(center, {'legacyNames': ['FOLK Sion', 'Sion']})
    for table in ['Users', 'Guides']:
        patch(one_email(table, 'gmnd@hkmmumbai.org'), {'folkResidencies': []})
        patch(one_email(table, 'mnkd@hkmmumbai.org'), {'guideDirectoryHidden': True, 'folkResidencies': []})
    # Keep identity, sign-in and FOLK relationships; remove only PW access.
    patch(vd, {'role': 'Guide', 'segment': 'FOLK', 'isFolkUser': True,
               'isPrabhupadaWorldUser': False, 'isPrabhupadaWorldMentor': False,
               'isPwAdmin': False, 'isBvAdmin': False, 'isBvSuperAdmin': False})
    detached = []
    for row in data['Users']:
        if row['fields'].get('segment') != 'PW': continue
        patch_fields = {}
        for field in ['guide', 'selectedGuideId', 'sadhanaMentor', 'adminId', 'reportingTo']:
            old = row['fields'].get(field)
            if not set(refs(old)) & aliases: continue
            patch_fields[field] = [x for x in old if not set(refs(x)) & aliases] if isinstance(old, list) else None
        if patch_fields:
            patch(row, patch_fields)
            detached.append(row['id'])
    # An orphaned historical PW guide meeting was reviewed in the identity audit.
    # Do not delete shared meetings or records with an active member automatically.
    deletes = []
    user_refs = {x for u in data['Users'] for x in refs([u['id'], u['fields'].get('userId')])}
    for row in data['OneToOneMeetings']:
        f = row['fields']
        if row['id'] == 'rec_p8ucqq04a2o' and set(refs(f.get('guide'))) & aliases and not set(refs(f.get('member'))) & user_refs:
            deletes.append(row)
    # Force hierarchy recomputation instead of retaining removed PW links.
    marker_name = ROOT + '/Config/reportingChainsVersion'
    marker = unpack(request('https://firestore.googleapis.com/v1/' + marker_name))
    if changes or deletes:
        patch(marker, {'configValue': 'stale:folk-hostels:' + datetime.datetime.now(datetime.timezone.utc).isoformat()})
    plan = {'patches': [{'path': k, 'fields': v['patch']} for k, v in changes.items()], 'deletes': [r['name'] for r in deletes], 'detachedPwMembers': detached}
    print(json.dumps(plan, indent=2))
    if not args.apply: return
    # Read every affected document immediately before commit and fail on drift.
    for item in list(changes.values()) + [{'row': r} for r in deletes]:
        row = item['row']
        fresh = request('https://firestore.googleapis.com/v1/' + row['name'])
        assert fresh['updateTime'] == row['version'], f'Changed during preflight: {row["name"]}'
    writes = [{'update': {'name': name, 'fields': {k: encode(v) for k, v in entry['patch'].items()}}, 'updateMask': {'fieldPaths': list(entry['patch'])}, 'currentDocument': {'updateTime': entry['row']['version']}} for name, entry in changes.items()]
    writes += [{'delete': r['name'], 'currentDocument': {'updateTime': r['version']}} for r in deletes]
    assert len(writes) <= 500
    backup = {'plan': plan, 'before': [v['row'] for v in changes.values()] + deletes}
    with open(args.receipt + '.before.json', 'w') as f: json.dump(backup, f, indent=2)
    if writes: request(BASE + ':commit', {'writes': writes})
    for name, entry in changes.items():
        after = unpack(request('https://firestore.googleapis.com/v1/' + name))['fields']
        if name == marker_name and after.get('configValue') == 'ready:2':
            continue  # A live request already rebuilt the invalidated hierarchy.
        assert all(after.get(k) == v for k, v in entry['patch'].items()), f'Readback failed {name}'
    for row in deletes:
        try: request('https://firestore.googleapis.com/v1/' + row['name'])
        except RuntimeError as error:
            assert 'NOT_FOUND' in str(error)
        else: raise AssertionError('Deleted record still exists')
    with open(args.receipt, 'w') as f: json.dump({'verified': True, 'writes': len(writes), **plan}, f, indent=2)
    print(f'Verified {len(writes)} writes; receipt: {args.receipt}')

if __name__ == '__main__': main()
