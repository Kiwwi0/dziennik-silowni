"""Test regresji build_data.py (zlecenie B2, plan: zrodla/plany/B2-cwiczenia-z-planow.md).

Sprawdza, że skrypt z polem 4. (ćwiczenia spoza free-exercise-db) i opcją --bez-zdjec daje dla 112 starych
ćwiczeń dokładnie te same wpisy co migawka `exercises_przed_B2.json` (= dist/exercises.json sprzed B2),
oraz że błędy w nagłówkach są zgłaszane, a nie cicho puste.

Użycie (z katalogu repozytorium):
  git clone --depth 1 --filter=blob:none --sparse https://github.com/yuhonas/free-exercise-db <katalog>
  git -C <katalog> sparse-checkout set --no-cone /dist/exercises.json
  python3 -I testy/dane/test_build_data.py <katalog>        (albo zmienna FEDB=<katalog>)
"""
import json, os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
BUILD = os.path.join(REPO, "zrodla", "build_data.py")
SNAP = os.path.join(HERE, "exercises_przed_B2.json")
FEDB = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("FEDB")
if not FEDB or not os.path.exists(os.path.join(FEDB, "dist", "exercises.json")):
    sys.exit("Podaj katalog free-exercise-db z dist/exercises.json (argument albo FEDB=...); opis na górze pliku.")

fails = []


def check(ok, name):
    print(("OK    " if ok else "BŁĄD ") + name)
    if not ok:
        fails.append(name)


def run(content_dir=None):
    out = tempfile.mkdtemp()
    cmd = [sys.executable, "-I", BUILD, "--bez-zdjec"]
    if content_dir:
        cmd.append("--content=" + content_dir)
    r = subprocess.run(cmd + [FEDB, out], capture_output=True, text=True)
    path = os.path.join(out, "exercises.json")
    return r, (json.load(open(path, encoding="utf-8")) if r.returncode == 0 and os.path.exists(path) else None)


def content(text):
    d = tempfile.mkdtemp()
    open(os.path.join(d, "t.txt"), "w", encoding="utf-8").write(text)
    return d


BODY = "- Krok pierwszy.\n- Krok drugi.\n! Uwaga.\n"

# 1. regresja na 112 starych ćwiczeniach: prawdziwe content/ (stare + nowe pliki), stare wpisy bez zmian
snap = json.load(open(SNAP, encoding="utf-8"))
check(len(snap) == 112, "migawka ma 112 ćwiczeń")
r, out = run()
check(r.returncode == 0, "build na prawdziwym content/ przechodzi: " + r.stderr[-300:])
if out is not None:
    old_ids = [e["id"] for e in snap]
    got = {e["id"]: e for e in out}
    check(all(i in got for i in old_ids), "wszystkie 112 starych id są w wyniku")
    check([e["id"] for e in out if e["id"] in set(old_ids)] == old_ids, "kolejność starych ćwiczeń bez zmian")
    diff = [e["id"] for e in snap if json.dumps(got.get(e["id"]), ensure_ascii=False) != json.dumps(e, ensure_ascii=False)]
    check(not diff, "112 starych wpisów identycznych co do znaku (różnią się: %s)" % diff[:5])
    ids = [e["id"] for e in out]
    check(len(ids) == len(set(ids)), "brak duplikatów id")

# 2. nowe możliwości nagłówka
ok_text = (
    "## PLECY\n\n"
    "@Kroc_Row | Wiosłowanie Kroc | reps | en=Kroc Row; eq=Hantle; level=średni; p=lats,middle back; s=biceps,forearms\n" + BODY +
    "\n## ROZGRZEWKA\n\n"
    "@Cat_Cow_Test | Koci grzbiet | reps | en=Cat-Cow; eq=Masa ciała; level=początkujący; p=; s=\n" + BODY +
    "\n## KLATKA\n\n"
    "@Barbell_Bench_Press_-_Medium_Grip | Wyciskanie | reps | eq=Maszyna\n" + BODY
)
r, o = run(content(ok_text))
check(r.returncode == 0, "poprawne nagłówki z polem 4. przechodzą: " + r.stderr[-300:])
if o:
    by = {e["id"]: e for e in o}
    k = by["Kroc_Row"]
    check(k["en"] == "Kroc Row" and k["equipment"] == "Hantle" and k["level"] == "średni" and k["group"] == "Plecy", "ćwiczenie spoza db: en/sprzęt/poziom/grupa")
    check(k["primary"] == ["najszerszy grzbietu", "środek pleców"] and k["secondary"] == ["biceps", "przedramiona"], "ćwiczenie spoza db: mięśnie z pól p, s")
    c = by["Cat_Cow_Test"]
    check(c["group"] == "Rozgrzewka" and c["primary"] == [] and c["secondary"] == [], "grupa Rozgrzewka i puste mięśnie")
    b = by["Barbell_Bench_Press_-_Medium_Grip"]
    base = next(e for e in snap if e["id"] == b["id"])
    check(b["equipment"] == "Maszyna" and b["en"] == base["en"] and b["primary"] == base["primary"], "id z db: pole eq nadpisuje tylko sprzęt")

# 3. błędy muszą być głośne
for name, text, frag in [
    ("id spoza db bez pól", "## PLECY\n@Nie_Ma_Takiego | X | reps\n" + BODY, "free-exercise-db"),
    ("id spoza db bez pola p", "## PLECY\n@Nie_Ma | X | reps | en=X; eq=Hantle; level=średni; s=\n" + BODY, "brakuje"),
    ("nieznany mięsień", "## PLECY\n@Nie_Ma | X | reps | en=X; eq=Hantle; level=średni; p=plecy; s=\n" + BODY, "mięsień"),
    ("nieznany sprzęt", "## PLECY\n@Nie_Ma | X | reps | en=X; eq=Kula; level=średni; p=lats; s=\n" + BODY, "sprzęt"),
    ("nieznany poziom", "## PLECY\n@Nie_Ma | X | reps | en=X; eq=Hantle; level=pro; p=lats; s=\n" + BODY, "poziom"),
    ("nieznane pole", "## PLECY\n@Nie_Ma | X | reps | en=X; foo=1; eq=Hantle; level=średni; p=lats; s=\n" + BODY, "pole"),
    ("nieznana grupa", "## NIEZNANA\n@Nie_Ma | X | reps | en=X; eq=Hantle; level=średni; p=lats; s=\n" + BODY, "NIEZNANA"),
]:
    r, _ = run(content(text))
    check(r.returncode != 0 and frag in r.stderr, "błąd zgłoszony: " + name)

print("\n%s: %d błędów" % ("NIE PRZESZŁO" if fails else "PRZESZŁO", len(fails)))
sys.exit(1 if fails else 0)
