# Źródła aplikacji „Dziennik siłowni”

Strona w folderze `web/` jest budowana z tych plików. Ten folder nie wpływa na działanie strony.

## Budowanie strony
1. Skopiuj zawartość tego folderu do katalogu roboczego (np. `silownia/`).
2. `python3 build_web.py <ścieżka do repozytorium>` – składa `web/index.html`, `web/sw.js` i kopiuje `miesnie3d.js`.
   (`python3 build.py` składa wersję testową do `dist/index.html`, bez manekina 3D.)

## Najważniejsze pliki
- `src/app.html` – cała aplikacja (widoki, logika, style).
- `src/muscles.js` – mięśnie pracujące w każdym ćwiczeniu.
- `src/anim_body.js` – płaski manekin z mięśniami (na podstawie react-native-body-highlighter, licencja MIT).
- `src/miesnie3d.js` – obracany manekin 3D (three.js); model `web/models/miesnie.glb`.
- `src/anim*.js` – animacje ćwiczeń (zapas, gdy nie ma internetu do filmów).
- `content/` – opisy ćwiczeń i lista filmów.
- `model3d/` – skrypty, którymi powstał model 3D z BodyParts3D (CC BY-SA 2.1 JP): wybór części, uproszczenie siatek
  (meshoptimizer), skóra z woksli, zapis do GLB. Wymagają pobranych plików STL z BodyParts3D i skompilowanej biblioteki meshoptimizer.
- `manekin_plaski/` – skrypty pomocnicze do płaskiego manekina.
