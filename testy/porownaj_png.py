#!/usr/bin/env python3
"""Porównuje ikony PNG w web/ z wersją zatwierdzoną (indeks gita) po pikselach, a nie po bajtach.

Bajty PNG zapisane przez Pillow zależą od wersji biblioteki zlib w danym systemie, więc `git diff` wskazywałby różnicę
tam, gdzie obraz jest identyczny. Użycie (po zbudowaniu web/): python3 -I testy/porownaj_png.py
"""
import io
import os
import subprocess
import sys

from PIL import Image

pliki = subprocess.run(['git', 'ls-files', 'web/*.png'], capture_output=True, text=True, check=True).stdout.split()
zle = []
brak = []
for p in pliki:
    stary = subprocess.run(['git', 'show', ':' + p], capture_output=True, check=True).stdout
    if not os.path.isfile(p):
        print('::error::Brak ikony po zbudowaniu strony (jest w repozytorium, nie ma jej w web/): ' + p)
        brak.append(p)
        continue
    a, b = Image.open(io.BytesIO(stary)).convert('RGBA'), Image.open(p).convert('RGBA')
    if a.size != b.size or a.tobytes() != b.tobytes():
        zle.append(p)
for p in zle:
    print('::error::Ikona różni się od źródła (piksele): ' + p)
print(f'Ikony PNG: {len(pliki)} sprawdzone, różnych: {len(zle)}, brakujących: {len(brak)}')
sys.exit(1 if zle or brak else 0)
