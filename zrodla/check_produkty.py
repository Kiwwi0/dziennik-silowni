"""Sprawdza content/produkty.csv: id i nazwy bez duplikatów, 11 pól w wierszu, kategorie, jednostki, zakresy
i zgodność kcal ≈ 4B + 4W + 9T (albo z błonnikiem po 2 kcal/g; poza piwem – alkohol). Użycie: python3 -I zrodla/check_produkty.py"""
import csv, os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__))
CATS = {'mieso', 'ryby', 'nabial', 'jaja', 'zbozowe', 'straczkowe', 'warzywa', 'owoce', 'orzechy', 'tluszcze', 'suplementy', 'przekaski', 'slodycze', 'sosy', 'napoje', 'inne'}
EXEMPT = {'piwo-jasne', 'piwo-bezalkoholowe'}   # alkohol (etanol ≈ 7 kcal/g) – wzór nie obowiązuje
TOL = 0.15                                       # tak jak ostrzeżenie w aplikacji: |4B+4W+9T − kcal| > 15% (przy kcal > 30)
lines = open(os.path.join(HERE, 'content', 'produkty.csv'), encoding='utf-8').read().rstrip('\n').split('\n')
bad = []
if lines[0] != 'id;nazwa;kategoria;jednostka;kcal;bialko;wegle;tluszcz;blonnik;porcja_g;porcja_opis': bad.append('nagłówek')
ids, names = {}, {}
for n, l in enumerate(lines[1:], 2):
    r = l.split(';')
    if len(r) != 11: bad.append(f'wiersz {n}: {len(r)} pól zamiast 11'); continue
    i, nm, cat, u = r[:4]
    if not re.fullmatch(r'[a-z0-9-]+', i): bad.append(f'{i}: id spoza [a-z0-9-]')
    if i in ids: bad.append(f'duplikat id: {i}')
    if nm.lower() in names: bad.append(f'duplikat nazwy: {nm}')
    ids[i] = 1; names[nm.lower()] = 1
    if cat not in CATS: bad.append(f'{i}: kategoria {cat}')
    if u not in ('g', 'ml'): bad.append(f'{i}: jednostka {u}')
    try: k, b, w, t, f = (float(x) for x in r[4:9]); pg = float(r[9]) if r[9] else None
    except ValueError: bad.append(f'{i}: liczba'); continue
    if not (0 <= k <= 900 and all(0 <= x <= 100 for x in (b, w, t, f)) and b + w + t + f <= 105): bad.append(f'{i}: wartości poza zakresem')
    if pg is not None and not (0 < pg <= 5000): bad.append(f'{i}: porcja')
    if bool(r[9]) != bool(r[10]): bad.append(f'{i}: porcja_g i porcja_opis muszą być oba albo żaden')
    calc = 4 * b + 4 * w + 9 * t
    calc_f = 4 * b + 4 * (w - f) + 2 * f + 9 * t   # wariant: błonnik po 2 kcal/g (węgle z błonnikiem); trzeci: węgle netto + błonnik
    if i not in EXEMPT and k > 30 and min(abs(calc - k), abs(calc_f - k), abs(calc + 2 * f - k)) > TOL * k: bad.append(f'{i}: kcal {k:g} a 4B+4W+9T = {calc:.0f}')
print(f'produktów: {len(ids)}'); print('\n'.join(bad) if bad else 'OK – wszystko się zgadza'); sys.exit(1 if bad else 0)
