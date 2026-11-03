import re, json
names = {}
for line in open('/tmp/bp/bp3d/assets/BodyParts3D_data/parts_list_e.txt', encoding='utf-8', errors='replace'):
    p = line.rstrip('\n').split('\t')
    if len(p) >= 2: names[p[0]] = p[1]
ids = [l.strip() for l in open('/tmp/bp/stl_ids.txt')]
RULES = [  # (regex, key, cell mm)
 (r'clavicular part of .* pectoralis major', 'chestU', 4), (r'(sternocostal|abdominal) part of .* pectoralis major', 'chestL', 4),
 (r'clavicular part of .* deltoid', 'deltA', 4), (r'acromial part of .* deltoid', 'deltL', 4), (r'spinal part of .* deltoid', 'deltP', 4),
 (r'descending part of .* trapezius', 'trapsU', 4), (r'transverse part of .* trapezius', 'trapsM', 4), (r'ascending part of .* trapezius', 'trapsL', 4),
 (r'latissimus dorsi', 'lats', 5), (r'teres major', 'teres', 4), (r'teres minor|infraspinatus', 'infra', 4), (r'supraspinatus', 'n_supra', 5),
 (r'rhomboid', 'trapsM', 6), (r'levator scapulae', 'neck', 5), (r'serratus anterior', 'serratus', 4), (r'external oblique', 'obliques', 5),
 (r'rectus abdominis', 'abs', 4), (r'iliocostalis (lumborum|thoracis)|longissimus thoracis|spinalis thoracis', 'erectors', 5),
 (r'sternocleidomastoid', 'neck', 4), (r'(sternohyoid|omohyoid|thyrohyoid)|semispinalis (capitis|cervicis)|longissimus (capitis|cervicis)|longus colli|thyroid cartilage|hyoid bone', 'n_neck', 5),
 (r'(long|short) head of .* biceps brachii', 'biceps', 4), (r'(left|right) brachialis$', 'brachialis', 4), (r'coracobrachialis', 'n_cb', 5),
 (r'long head of .* triceps', 'triLong', 4), (r'lateral head of .* triceps', 'triLat', 4), (r'medial head of .* triceps', 'triMed', 4),
 (r'brachioradialis', 'brachiorad', 4),
 (r'flexor carpi (radialis|ulnaris)|head of .* flexor carpi ulnaris|head of .* flexor digitorum superficialis|head of .* pronator teres', 'flexors', 4),
 (r'extensor carpi radialis|extensor digitorum$|extensor digiti minimi|head of .* extensor carpi ulnaris|extensor pollicis (brevis|longus)', 'extensors', 4),
 (r'gluteus maximus', 'gluteMax', 5), (r'gluteus medius', 'gluteMed', 5), (r'tensor fasciae latae', 'n_tfl', 5), (r'iliotibial tract', 'n_itb', 5),
 (r'rectus femoris', 'quadRF', 4), (r'vastus lateralis', 'quadVL', 5), (r'vastus medialis', 'quadVM', 4), (r'sartorius', 'n_sart', 4),
 (r'gracilis|adductor (longus|magnus)$', 'adductors', 5),
 (r'head of .* biceps femoris', 'hamLat', 4), (r'semitendinosus|semimembranosus', 'hamMed', 4),
 (r'head of .* gastrocnemius', 'gastro', 4), (r'soleus', 'soleus', 4), (r'tibialis anterior', 'tibialis', 4),
 (r'fibularis (longus|brevis)|extensor digitorum longus|extensor hallucis longus', 'n_leg', 4),
 # kości widoczne między mięśniami
 (r'clavicle|scapula|hip bone|sacrum|patella|tibia$|fibula$|humerus|radius$|ulna$|femur', 'bone', 6),
 (r'(third|fourth|fifth|sixth|seventh) cervical vertebra', 'bone', 5),
]
sel = []
for i in ids:
    n = names.get(i, '')
    if 'tibialis posterior' in n: continue
    for rx, key, h in RULES:
        if re.search(rx, n):
            sel.append({'id': i, 'name': n, 'key': key, 'h': h}); break
json.dump(sel, open('/tmp/bp/work/sel.json', 'w'), indent=0)
from collections import Counter
print(len(sel)); print(Counter(s['key'] for s in sel))
