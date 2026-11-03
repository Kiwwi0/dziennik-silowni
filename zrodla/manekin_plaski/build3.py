import json, collections
B = json.load(open('/tmp/mm/body.json')); BB = json.load(open('/tmp/mm/bbox.json'))
MID = {'front': 362, 'back': 1086}
out = {'front': [], 'back': []}
for view in ['front', 'back']:
    mid = MID[view]
    for part in B[view]:
        slug = part['slug']
        for side in ['left', 'right', 'common']:
            items = []
            for i, d in enumerate(part[side]):
                x, y, w, h = BB[f'{view}:{slug}:{side}:{i}']
                cx, cy = x + w / 2, y + h / 2
                items.append(dict(d=d, x=x, y=y, w=w, h=h, cx=cx, cy=cy, dist=abs(cx - mid)))
            if not items: continue
            def put(it, r, split=None):
                e = [r, it['d']]
                if split: e.append(split)
                out[view].append(e)
            s = side[0]
            if slug in ('head', 'hair', 'hands', 'feet', 'ankles', 'knees'):
                for it in items: put(it, 'skin')
                continue
            if view == 'front':
                if slug == 'chest':
                    for it in items: put(it, 'chest', 'chest' + s)
                elif slug == 'obliques':
                    for it in items: put(it, 'serratus' if it['cy'] < 500 else 'obliques')
                elif slug == 'abs':
                    for it in items: put(it, 'abs')
                elif slug == 'biceps':
                    for it in items: put(it, 'biceps')
                elif slug == 'triceps':
                    for it in items: put(it, 'triLong')
                elif slug == 'neck':
                    for it in items: put(it, 'neck')
                elif slug == 'trapezius':
                    for it in items: put(it, 'trapsU')
                elif slug == 'deltoids':
                    for it in items: put(it, 'delts', 'deltF' + s)
                elif slug == 'adductors':
                    for it in items: put(it, 'sartorius' if it['h'] > 200 else 'adductors')
                elif slug == 'quadriceps':
                    vl = max(items, key=lambda t: t['dist'])
                    rest = [t for t in items if t is not vl]
                    vm = max(rest, key=lambda t: t['cy'])  # niżej położony, przy kolanie
                    for it in items: put(it, 'quadVL' if it is vl else 'quadVM' if it is vm else 'quadRF')
                elif slug == 'tibialis':
                    for it in items: put(it, 'tibialis')
                elif slug == 'calves':
                    for it in items: put(it, 'gastro')
                elif slug == 'forearm':
                    br = max(items, key=lambda t: t['dist'])
                    for it in items: put(it, 'brachiorad' if it is br else 'flexors')
                else:
                    print('?', view, slug)
            else:
                if slug == 'neck':
                    for it in items: put(it, 'neck')
                elif slug == 'trapezius':
                    for it in items: put(it, 'traps', 'trapsB' + s)
                elif slug == 'deltoids':
                    for it in items: put(it, 'delts', 'deltB' + s)
                elif slug == 'upper-back':
                    for it in items: put(it, 'lats' if it['h'] > 150 else ('infra' if it['h'] > 65 else 'teres'))
                elif slug == 'triceps':
                    lg = min(items, key=lambda t: t['dist']); rest = [t for t in items if t is not lg]
                    lat = min(rest, key=lambda t: t['cy'])
                    for it in items: put(it, 'triLong' if it is lg else 'triLat' if it is lat else 'triMed')
                elif slug == 'lower-back':
                    for it in items: put(it, 'erectors' if it['w'] > 45 else 'obliques')
                elif slug == 'forearm':
                    for it in items: put(it, 'extensors')
                elif slug == 'gluteal':
                    for it in items: put(it, 'gluteMed' if it['h'] < 60 else 'gluteMax')
                elif slug == 'adductors':
                    for it in items: put(it, 'adductors')
                elif slug == 'hamstring':
                    srt = sorted(items, key=lambda t: t['dist'])
                    names = {id(srt[0]): 'hamMed', id(srt[1]): 'hamMed', id(srt[2]): 'hamLat', id(srt[3]): 'quadVL'}
                    for it in items: put(it, names[id(it)])
                elif slug == 'calves':
                    for it in items: put(it, 'gastro' if it['cy'] < 1150 else 'soleus')
                else:
                    print('?', view, slug)
out['outline'] = B['outline']
def mx(pts, c): return [[round(2 * c - x, 1), y] for x, y in pts]
def ml(l, c): return [round(2 * c - l[0], 1), l[1], round(2 * c - l[2], 1), l[3]]
SPL = {}
fl_lat = [[100, 250], [237.7, 250], [202.5, 450], [100, 450]]; fl_ant = [[237.7, 250], [400, 250], [400, 450], [202.5, 450]]; fl_line = [228, 305, 212, 396]
SPL['deltFl'] = {'parts': [['deltL', fl_lat], ['deltA', fl_ant]], 'lines': [fl_line]}
SPL['deltFr'] = {'parts': [['deltL', mx(fl_lat, 362)], ['deltA', mx(fl_ant, 362)]], 'lines': [ml(fl_line, 362)]}
cu = [[240, 280], [375, 280], [375, 343], [240, 357]]; cl = [[240, 357], [375, 343], [375, 460], [240, 460]]; cline = [250, 356, 365, 344]
SPL['chestl'] = {'parts': [['chestU', cu], ['chestL', cl]], 'lines': [cline]}
SPL['chestr'] = {'parts': [['chestU', mx(cu, 362)], ['chestL', mx(cl, 362)]], 'lines': [ml(cline, 362)]}
bl_lat = [[880, 290], [937.5, 290], [922.7, 420], [880, 420]]; bl_post = [[937.5, 290], [1000, 290], [1000, 420], [922.7, 420]]; bline = [935, 312, 925, 400]
SPL['deltBl'] = {'parts': [['deltL', bl_lat], ['deltP', bl_post]], 'lines': [bline]}
SPL['deltBr'] = {'parts': [['deltL', mx(bl_lat, 1086)], ['deltP', mx(bl_post, 1086)]], 'lines': [ml(bline, 1086)]}
for s, (x0, x1) in {'l': (990, 1086), 'r': (1086, 1182)}.items():
    SPL['trapsB' + s] = {'parts': [['trapsU', [[x0, 280], [x1, 280], [x1, 340], [x0, 340]]], ['trapsM', [[x0, 340], [x1, 340], [x1, 400], [x0, 400]]], ['trapsL', [[x0, 400], [x1, 400], [x1, 490], [x0, 490]]]],
                         'lines': [[x0, 340, x1, 340], [x0, 400, x1, 400]]}
out['split'] = SPL
json.dump(out, open('/tmp/mm/body3.json', 'w'), separators=(',', ':'))
for v in ['front', 'back']: print(v, dict(collections.Counter(p[0] for p in out[v])))
print(len(json.dumps(out, separators=(',', ':'))))
