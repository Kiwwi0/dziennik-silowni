"""Buduje polską bazę ćwiczeń (exercises.json) i obrazki-sprite'y (img/<id>.jpg).

Użycie: python3 -I build_data.py [--bez-zdjec] [--content=KATALOG] <katalog free-exercise-db> <katalog wyjściowy>

--bez-zdjec: nie buduje img/ (wystarczy sam dist/exercises.json z free-exercise-db, np. sparse checkout).
Nagłówek ćwiczenia: @id | nazwa PL | tryb [| pola]. Pola (po średniku) są potrzebne dla ćwiczeń spoza
free-exercise-db (wtedy wymagane: en, eq, level, p, s – p i s mogą być puste) i mogą nadpisać wartości
z free-exercise-db (en, eq, level, p, s):
  @Kroc_Row | Wiosłowanie Kroc | reps | en=Kroc Row; eq=Hantle; level=średni; p=lats,middle back; s=biceps,forearms
"""
import json, re, sys, os, glob

ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
FLAGS = {a for a in sys.argv[1:] if a.startswith("--")}
CONTENT_DIR = None  # --content=KATALOG: inne pliki *.txt niż content/ (używa tego test regresji)
for f in list(FLAGS):
    if f.startswith("--content="):
        CONTENT_DIR = f.split("=", 1)[1]
        FLAGS.discard(f)
assert FLAGS <= {"--bez-zdjec"}, f"Nieznana opcja: {FLAGS - {'--bez-zdjec'}}"
BEZ_ZDJEC = "--bez-zdjec" in FLAGS
SRC, OUT = ARGS
HERE = os.path.dirname(os.path.abspath(__file__))
CONTENT_DIR = CONTENT_DIR or os.path.join(HERE, "content")

GROUPS = {
    "KLATKA": "Klatka piersiowa", "PLECY": "Plecy", "BARKI": "Barki",
    "BICEPS": "Biceps", "TRICEPS": "Triceps", "CZWOROGŁOWE UDA": "Czworogłowe uda",
    "DWUGŁOWE UDA": "Dwugłowe uda", "POŚLADKI I BIODRA": "Pośladki i biodra",
    "ŁYDKI": "Łydki", "BRZUCH": "Brzuch", "CAŁE CIAŁO": "Całe ciało", "CARDIO": "Cardio",
    "ROZGRZEWKA": "Rozgrzewka",
}
MUSCLES = {
    "chest": "klatka piersiowa", "lats": "najszerszy grzbietu", "middle back": "środek pleców",
    "lower back": "prostowniki grzbietu", "traps": "kaptury", "shoulders": "barki",
    "biceps": "biceps", "triceps": "triceps", "forearms": "przedramiona",
    "quadriceps": "czworogłowe uda", "hamstrings": "dwugłowe uda", "glutes": "pośladki",
    "calves": "łydki", "abdominals": "brzuch", "adductors": "przywodziciele",
    "abductors": "odwodziciele", "neck": "szyja",
}
EQUIP = {
    "barbell": "Sztanga", "dumbbell": "Hantle", "cable": "Wyciąg", "machine": "Maszyna",
    "body only": "Masa ciała", "kettlebells": "Kettlebell", "e-z curl bar": "Sztanga łamana",
    "bands": "Guma", "other": "Inne", None: "Masa ciała",
}
EQUIP_OVERRIDE = {
    "Dips_-_Chest_Version": "Masa ciała", "Inverted_Row": "Masa ciała", "Band_Assisted_Pull-Up": "Guma",
    "Farmers_Walk": "Hantle", "Trap_Bar_Deadlift": "Sztanga", "Knee_Hip_Raise_On_Parallel_Bars": "Masa ciała",
    "Hyperextensions_Back_Extensions": "Maszyna", "Close-Grip_EZ_Bar_Curl": "Sztanga łamana",
    "Rowing_Stationary": "Maszyna", "Running_Treadmill": "Maszyna", "Bicycling_Stationary": "Maszyna",
    "Elliptical_Trainer": "Maszyna",
}
LEVEL = {"beginner": "początkujący", "intermediate": "średni", "expert": "zaawansowany"}

FIELD_KEYS = {"en", "eq", "level", "p", "s"}


def parse_fields(text, eid):
    """'en=Kroc Row; eq=Hantle; p=lats,middle back' -> {'en': ..., 'p': [...]}"""
    f = {}
    for part in text.split(";"):
        part = part.strip()
        if not part:
            continue
        key, sep, val = part.partition("=")
        key, val = key.strip(), val.strip()
        if not sep or key not in FIELD_KEYS:
            raise ValueError(f"{eid}: nieznane pole {part!r} (dozwolone: {sorted(FIELD_KEYS)})")
        if key in f:
            raise ValueError(f"{eid}: pole {key} podane dwa razy")
        if key in ("p", "s"):
            keys = [m.strip() for m in val.split(",") if m.strip()]
            bad = [m for m in keys if m not in MUSCLES]
            if bad:
                raise ValueError(f"{eid}: nieznany mięsień {bad} w polu {key} (dozwolone: {sorted(MUSCLES)})")
            f[key] = [MUSCLES[m] for m in keys]
        elif key == "eq":
            if val not in EQUIP.values():
                raise ValueError(f"{eid}: nieznany sprzęt {val!r} (dozwolone: {sorted(set(EQUIP.values()))})")
            f[key] = val
        elif key == "level":
            if val not in LEVEL.values():
                raise ValueError(f"{eid}: nieznany poziom {val!r} (dozwolone: {sorted(LEVEL.values())})")
            f[key] = val
        else:
            if not val:
                raise ValueError(f"{eid}: puste pole en")
            f[key] = val
    return f


db = {e["id"]: e for e in json.load(open(os.path.join(SRC, "dist", "exercises.json")))}

out, group = [], None
for path in sorted(glob.glob(os.path.join(CONTENT_DIR, "*.txt"))):
    cur = None
    for raw in open(path, encoding="utf-8"):
        line = raw.strip()
        if not line or line.startswith("# "):
            continue
        if line.startswith("## "):
            group = GROUPS[line[3:].strip()]
        elif line.startswith("@"):
            parts = [p.strip() for p in line[1:].split("|", 3)]
            if len(parts) < 3:
                raise ValueError(f"Za mało pól w nagłówku: {line!r}")
            eid, name, mode = parts[:3]
            fields = parse_fields(parts[3], eid) if len(parts) == 4 else {}
            src = db.get(eid)
            if src is None:
                # ćwiczenie spoza free-exercise-db: wszystko z pól (brak pola = błąd, nie ciche puste)
                missing = {"en", "eq", "level", "p", "s"} - fields.keys()
                if missing:
                    raise KeyError(f"{eid}: nie ma go w free-exercise-db, brakuje pól {sorted(missing)} (literówka w id?)")
                en, equipment, level = fields["en"], fields["eq"], fields["level"]
                primary, secondary = fields["p"], fields["s"]
            else:
                en = fields.get("en", src["name"])
                equipment = fields.get("eq", EQUIP_OVERRIDE.get(eid, EQUIP[src.get("equipment")]))
                level = fields.get("level", LEVEL[src["level"]])
                primary = fields.get("p", [MUSCLES[m] for m in src["primaryMuscles"]])
                secondary = fields.get("s", [MUSCLES[m] for m in src["secondaryMuscles"]])
            cur = {
                "id": eid, "name": name, "en": en, "group": group, "mode": mode,
                "equipment": equipment, "primary": primary, "secondary": secondary,
                "level": level, "steps": [], "tips": [],
            }
            out.append(cur)
        elif line.startswith("- "):
            cur["steps"].append(line[2:])
        elif line.startswith("! "):
            cur["tips"].append(line[2:])
        else:
            raise ValueError(f"Nieznana linia: {line!r}")

ids = [e["id"] for e in out]
assert len(ids) == len(set(ids)), "duplikaty"
for e in out:
    assert len(e["steps"]) >= 2 and e["tips"], e["id"]

os.makedirs(OUT, exist_ok=True)
total = 0
n_img = 0
if not BEZ_ZDJEC:
    from PIL import Image
    os.makedirs(os.path.join(OUT, "img"), exist_ok=True)
    W = 420
    for e in out:
        images = db.get(e["id"], {}).get("images") or []
        if not images:  # ćwiczenie własne (spoza free-exercise-db) – bez zdjęć, miniatura idzie z ANIM albo litery
            continue
        frames = [Image.open(os.path.join(SRC, "exercises", p)).convert("RGB") for p in images]
        assert len(frames) == 2, e["id"]
        h = round(frames[0].height * W / frames[0].width)
        sheet = Image.new("RGB", (W, h * 2), "white")
        for i, f in enumerate(frames):
            sheet.paste(f.resize((W, h), Image.LANCZOS), (0, h * i))
        dst = os.path.join(OUT, "img", e["id"] + ".jpg")
        sheet.save(dst, "JPEG", quality=70, optimize=True, progressive=True)
        total += os.path.getsize(dst)
        n_img += 1

json.dump(out, open(os.path.join(OUT, "exercises.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
from collections import Counter
print(len(out), "ćwiczeń;", f"{n_img} zdjęć, {round(total / 1e6, 2)} MB" if not BEZ_ZDJEC else "bez zdjęć (--bez-zdjec)")
print(Counter(e["group"] for e in out))
print(Counter(e["equipment"] for e in out))
