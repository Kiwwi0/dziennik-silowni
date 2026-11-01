# Dziennik siłowni

Aplikacja na iPhone'a do planowania i zapisywania treningów na siłowni:
baza 111 ćwiczeń z opisem techniki i animacją ruchu, plany z dniami treningowymi,
trening z timerem przerw (z powiadomieniem przy zablokowanym ekranie),
kalkulator talerzy oraz historia z wykresami postępów.

## Jak powstaje plik aplikacji

Każde wypchnięcie zmian na gałąź `main` uruchamia GitHub Actions
(`.github/workflows/build.yml`): projekt Xcode jest generowany z `project.yml`
(XcodeGen), budowany bez podpisu i publikowany jako wydanie (Releases)
z plikiem `DziennikSilowni.ipa`.

## Instalacja na iPhonie (bez konta Apple Developer)

1. Pobierz `DziennikSilowni.ipa` z najnowszego wydania (zakładka Releases).
2. Na komputerze z Windows uruchom Sideloadly, podłącz iPhone'a kablem,
   przeciągnij plik `.ipa` do okna, wpisz swoje Apple ID i kliknij Start.
3. Na iPhonie: Ustawienia → Prywatność i ochrona → Tryb dewelopera → włącz
   (telefon się zrestartuje), a potem Ustawienia → Ogólne → VPN i urządzenia →
   zaufaj swojemu Apple ID.
4. Z darmowym Apple ID aplikację trzeba wgrać ponownie co 7 dni.
   Dane zostają, o ile nie usuniesz aplikacji przed ponowną instalacją.

## Przeniesienie danych z wersji w przeglądarce

W wersji w przeglądarce: Ustawienia → Kopiuj dane.
W aplikacji: Trening → ikona ustawień → Przywróć dane ze schowka.

Zdjęcia ćwiczeń: [Free Exercise DB](https://github.com/yuhonas/free-exercise-db) (domena publiczna).
