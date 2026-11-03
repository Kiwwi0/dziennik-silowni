"""Buduje polską bazę ćwiczeń (exercises.json) i obrazki-sprite'y (img/<id>.jpg).

Użycie: python3 -I build_data.py <katalog free-exercise-db> <katalog wyjściowy>
"""
import json, re, sys, os, glob
from PIL import Image

SRC, OUT = sys.argv[1], sys.argv[2]
HERE = os.path.dirname(os.path.abspath(__file__))

GROUPS = {
    "KLATKA": "Klatka piersiowa", "PLECY": "Plecy", "BARKI": "Barki",
    "BICEPS": "Biceps", "TRICEPS": "Triceps", "CZWOROGŁOWE UDA": "Czworogłowe uda",
    "DWUGŁOWE UDA": "Dwugłowe uda", "POŚLADKI I BIODRA": "Pośladki i biodra",
    "ŁYDKI": "Łydki", "BRZUCH": "Brzuch", "CAŁE CIAŁO": "Całe ciało", "CARDIO": "Cardio",
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

db = {e["id"]: e for e in json.load(open(os.path.join(SRC, "dist", "exercises.json")))}

out, group = [], None
for path in sorted(glob.glob(os.path.join(HERE, "content", "*.txt"))):
    cur = None
    for raw in open(path, encoding="utf-8"):
        line = raw.strip()
        if not line or line.startswith("# "):
            continue
        if line.startswith("## "):
            group = GROUPS[line[3:].strip()]
        elif line.startswith("@"):
            eid, name, mode = [p.strip() for p in line[1:].split("|")]
            src = db[eid]  # KeyError = literówka w id
            cur = {
                "id": eid, "name": name, "en": src["name"], "group": group, "mode": mode,
                "equipment": EQUIP_OVERRIDE.get(eid, EQUIP[src.get("equipment")]),
                "primary": [MUSCLES[m] for m in src["primaryMuscles"]],
                "secondary": [MUSCLES[m] for m in src["secondaryMuscles"]],
                "level": LEVEL[src["level"]], "steps": [], "tips": [],
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

os.makedirs(os.path.join(OUT, "img"), exist_ok=True)
W = 420
total = 0
for e in out:
    frames = [Image.open(os.path.join(SRC, "exercises", p)).convert("RGB") for p in db[e["id"]]["images"]]
    assert len(frames) == 2, e["id"]
    h = round(frames[0].height * W / frames[0].width)
    sheet = Image.new("RGB", (W, h * 2), "white")
    for i, f in enumerate(frames):
        sheet.paste(f.resize((W, h), Image.LANCZOS), (0, h * i))
    dst = os.path.join(OUT, "img", e["id"] + ".jpg")
    sheet.save(dst, "JPEG", quality=70, optimize=True, progressive=True)
    total += os.path.getsize(dst)

json.dump(out, open(os.path.join(OUT, "exercises.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
from collections import Counter
print(len(out), "ćwiczeń;", round(total / 1e6, 2), "MB zdjęć")
print(Counter(e["group"] for e in out))
print(Counter(e["equipment"] for e in out))
