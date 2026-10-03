### Smart City

### OPIS ZADANIA

"Cities are operating at the edge of their capacity. Growing populations, overloaded infrastructure, transportation, energy, and access to information all need to work faster, smoother, and more reliably than ever before.

In this category, we’re looking for solutions that help cities function better in everyday conditions – improving mobility, resource management, communication with citizens, and crisis response. You can focus on mobility, energy, urban data, public services, quality of life, or any related area. Your task is to build a tool, application, system, or prototype that addresses a real problem.

This is an open category, but the direction is clear: technology that helps cities work better. Build something that makes everyday life in a city easier."

### KRYTERIA OCENY

Judging criteria are as follows:
• Idea & Innovation - 30%
• Relation to Category - 20%
• Practical Applicability / Usability - 20%
• Design - 20%
• Completeness & Implementation Value - 10%

### POMYSŁ

Użycie aut z kamerami, które sprawdzają czy auto ma opłacony parking,
użyć tych kamer do sprawdzania stanu nawierzchni, czy zaśmiecenia w pobliżu drogi wraz z alertami.


---

# PLAN MVP

## 1. Nazwa i jednozdaniowy pitch

**Working title:** *CityEye* (do zmiany)

> Samochody, które już dziś jeżdżą po mieście i kontrolują parkowanie, stają się mobilnym sensorem infrastruktury. Jedna kamera, jeden przejazd: wykrywamy dziury w nawierzchni i śmieci przy drodze, a miasto dostaje gotowe alerty na mapie.

**Dlaczego to działa:** miasto ma już auta z kamerami (kontrola parkowania), więc nie ma kosztu nowego sprzętu. Dziś te dane służą tylko jednemu celowi. My dokładamy inspekcję dróg i czystości „za darmo”, bez budowania osobnej floty.

## 2. Mapowanie na kryteria oceny

| Kryterium | Waga | Co pokażemy |
|---|---|---|
| Idea i innowacyjność | 30% | Jeden przejazd, dwa problemy miasta. Wykorzystanie istniejącej floty zamiast nowych czujników. |
| Związek z kategorią | 20% | Mobilność, zasoby miasta, szybka reakcja, jakość życia. |
| Praktyczność | 20% | Integracja z istniejącą flotą kontroli parkowania, zgłoszenia trafiają do właściwych służb (ZDM, ZOO). |
| Design | 20% | Dopracowany dashboard z mapą, kolorowe alerty, czytelny widok szczegółu zdarzenia. |
| Kompletność | 10% | Działający pipeline end-to-end na realnym nagraniu. |

**Wniosek:** 50% punktów to pomysł i design. Priorytetem jest przekonujące demo, nie idealna dokładność modeli.

## 3. Zakres MVP

### MUST HAVE (bez tego nie ma demo)
1. **Wejście danych:** nagranie wideo z auta (dashcam / nagranie z YouTube / własne nagranie telefonem) plus ślad GPS (plik GPX albo ręcznie wygenerowana trasa zsynchronizowana z wideo).
2. **Detekcja uszkodzeń nawierzchni** (dziury, pęknięcia) modelem YOLO.
3. **Detekcja zaśmiecenia** (worki, śmieci przy drodze, przepełnione kosze) modelem YOLO.
4. **Backend:** zapis zdarzeń (typ, lokalizacja, czas, zdjęcie, pewność, status).
5. **Dashboard webowy:** mapa z pinezkami zdarzeń, filtry po typie, lista alertów, szczegóły zdarzenia ze zdjęciem.
6. **Symulacja „na żywo”:** odtwarzanie przejazdu, podczas którego alerty pojawiają się na mapie w czasie rzeczywistym.

### SHOULD HAVE (jeśli zostanie czas)
- Przypisanie zgłoszenia do służby (ZDM dla dziur, ZOO dla śmieci) i zmiana statusu (nowe, w toku, zamknięte).
- Mapa cieplna problemów (heatmap) i statystyki: liczba zdarzeń na dzielnicę i trend.
- Deduplikacja: ta sama dziura z kilku przejazdów to jedno zgłoszenie z licznikiem potwierdzeń.
- Priorytetyzacja (wielkość dziury, powtarzalność, bliskość przedszkola/szkoły).

### NICE TO HAVE (tylko do slajdu „roadmapa”)
- Aplikacja dla mieszkańców (podgląd naprawionych zgłoszeń).
- Wykrywanie uszkodzonych znaków i wygasłej infrastruktury (latarnie, graffiti).
- Predykcja miejsc o dużym ryzyku powstania ubytków.

### POZA ZAKRESEM
Logowanie użytkowników, wielu operatorów, trenowanie modeli od zera (startujemy z wag COCO i robimy krótki fine-tuning).
**Detekcja tablic, OCR i weryfikacja opłat parkingowych** — nie wchodzą do MVP. Auta parkingowe są tylko nośnikiem kamer.
Trening na laptopie hackathonowym — GPU jest tylko w Colabie. Laptop dostaje gotowy plik `best.pt` i robi inferencję.

## 4. Architektura

```
[Datasety YOLO] --> [Colab GPU: fine-tuning] --> best_road.pt + best_litter.pt
                                                        |
[Wideo + GPS] --> [Worker lokalny, tylko inferencja] --> [API (FastAPI)] --> [DB]
                        |                                      |
                        |- YOLO na pobranych wagach            |--> WebSocket --> [Dashboard]
                        |- Rozmycie twarzy / tablic
```

Colab jest środowiskiem treningu. Demo na scenie działa offline: worker ładuje wagi z `/ml/weights` i nie łączy się z Colabem.

### Proponowany stack (szybki w hackathonie)
- **Trening:** Google Colab (GPU T4), Ultralytics YOLO12, osobno `ml/train_road.ipynb` i `ml/train_litter.ipynb`.
- **Inferencja / worker:** Python, Ultralytics, OpenCV, te same wagi co z Colaba.
- **Backend:** FastAPI, WebSocket (alerty na żywo), SQLite (wystarczy na 24 h).
- **Frontend:** React (Vite) + Tailwind + shadcn/ui, mapa: MapLibre GL lub Leaflet, wykresy: Recharts.
- **Hosting demo:** wszystko lokalnie na laptopie. Colab nie jest częścią prezentacji.

### Struktura repo
```
/ml          # skrypty detekcji, modele, pipeline
/backend     # FastAPI, modele danych
/frontend    # dashboard
/data        # nagrania demo, GPX, przykładowe wyniki
/docs        # slajdy, makiety
```

## 5. Dane i modele — trening w Colab

Nie trenujemy od zera. Baza to `yolo12n.pt` (YOLO12 nano, wagi COCO). W Colabie robimy dwa krótkie fine-tuningi i ściągamy wagi na laptop.

| Zadanie | Plik wag | Źródło danych | Budżet w Colabie |
|---|---|---|---|
| Dziury i pęknięcia | `ml/weights/best_road.pt` | Kaggle `aliabdelmenam/rdd-2022` (RDD2022, XML → YOLO) | 25 epok, próbka 2000 klatek z kamer na pojeździe |
| Śmieci przy drodze | `ml/weights/best_litter.pt` | Kaggle `aaronvincent6411/litter-detection-plastic-bottle-and-bag` | 25 epok, cały zbiór |
| Wideo do demo | — | Telefon na szybie, 10–15 min, plus zapasowy dashcam | zbierane równolegle, nie w Colabie |

**Dlaczego dwa modele, nie jeden:** klasy z różnych zbiorów mają różne ID. Sklejanie ich w jeden YAML zjada godziny na hackathonie. Dwa notebooki (albo dwie komórki) dają dwa pliki `.pt` i czytelne typy zdarzeń: `road_damage` oraz `litter`.

**Kontrakt wyjścia z Colaba** (to jedyna rzecz, której potrzebuje reszta zespołu):

- `best_road.pt`, `best_litter.pt`
- lista klas i próg `conf` (start: 0.35)
- 5–10 klatek z naszego nagrania z narysowanymi boxami, żeby było widać, że model łapie właściwe rzeczy

**Limity Colaba, których nie wolno ignorować:**

- Runtime: GPU (T4). Bez GPU nie startujemy treningu.
- Sesja potrafi paść. Co ~15 min kopiujemy `best.pt` na Google Drive albo od razu ściągamy na dysk.
- Twardy stop: jeśli po 90 minutach na zadanie wagi nie są lepsze od punktu startowego, bierzemy najlepszy checkpoint i idziemy dalej. Demo nie czeka na kolejną epokę.
- Drugie konto Google = drugi Colab. Dziury i śmieci mogą iść równolegle, jeśli są dwie osoby przy ML.

**Kolejność w notebooku:**

1. `pip install ultralytics kagglehub`, sprawdzenie `nvidia-smi`. Przy pierwszym pobraniu Colab prosi o token Kaggle.
2. `kagglehub.dataset_download` dla RDD2022 i zbioru butelek/worków, potem złożenie `data.yaml`.
3. `YOLO("yolo12n.pt").train(data="data.yaml", epochs=25, imgsz=640, batch=16)`.
4. Predykcja na 10 klatkach z demo (`conf=0.35`).
5. Zapis `best.pt` pod ustaloną nazwą i pobranie na laptop.

## 6. Model danych (minimum)

```
events
  id, type (road_damage | litter),
  lat, lon, timestamp, confidence,
  image_url, severity (low/med/high),
  status (new | assigned | resolved), assigned_to,
  meta (JSON: damage_type, litter_class, itp.)

vehicles / patrols
  id, name, last_position
```

## 7. Prywatność i RODO (osobny slajd, to punktuje przy „Practical Applicability”)
- Nie rozpoznajemy ani nie zapisujemy tablic rejestracyjnych.
- Automatyczne **rozmycie twarzy** i tablic na zdjęciach zdarzeń.
- Przechowujemy tylko klatki ze zdarzeniem (dziura, śmieci), reszty wideo nie archiwizujemy.
- Dane przechowywane krótko (np. 30 dni dla nieistotnych klatek).

## 8. Podział pracy (przykład dla zespołu 4-osobowego)

| Rola | Zadania |
|---|---|
| **ML / CV** | Notebook w Colabie, fine-tuning dwóch YOLO12, dostarczenie `best_road.pt` i `best_litter.pt` do godz. 4, potem lokalna inferencja i eksport zdarzeń do API |
| **Backend** | FastAPI, baza, WebSocket, deduplikacja, symulator przejazdu |
| **Frontend / Design** | Dashboard, mapa, widok zdarzenia, animacje alertów, logo i identyfikacja |
| **Produkt / Pitch** | Nagranie danych, scenariusz demo, slajdy, analiza rynku i ROI, testy |

Przy mniejszym zespole: ML + backend łączymy w jedną rolę, frontend i design w drugą. Pitch robi cały zespół.

## 9. Harmonogram (zakładam 24 h, dostosuj do faktycznego czasu)

| Godzina | Cel |
|---|---|
| 0-1 | Zakres, repo, kontrakt API i kontrakt wag. Colab na GPU odpalony, ZIP-y datasetów pobrane. Ktoś jedzie zbierać nagranie. |
| 1-4 | Fine-tuning w Colabie (oba modele, najlepiej równolegle). Frontend i backend na danych mockowych, bez czekania na wagi. |
| 4-6 | `best_*.pt` na laptopie. Inferencja na nagraniu, eksport zdarzeń JSON. Jeśli model słaby — obniżamy próg i wybieramy lepsze ujęcie, nie dokładamy epok. |
| 6-10 | Mapa z prawdziwymi zdarzeniami. WebSocket, symulator przejazdu, statusy zgłoszeń. |
| 10-16 | **Integracja end-to-end.** Pierwszy pełny przebieg demo. |
| 16-20 | Design: UI, statystyki, heatmapa. Colab zamknięty, chyba że wagi są nieużywalne. |
| 20-22 | Pitch deck, nagranie zapasowe, próba prezentacji. |
| 22-24 | Bufor, poprawki błędów, **zakaz nowych funkcji i zakaz nowego treningu**. |

**Kamienie milowe kontrolne:**
- godz. 4: oba pliki `.pt` ściągnięte albo świadoma decyzja, który model zostaje na wagach COCO,
- godz. 8: jedno wideo daje zdarzenia na mapie,
- godz. 16: pełne demo działa bez Colaba i bez internetu,
- godz. 20: zamrożenie funkcji.

## 10. Scenariusz demo (3-5 min)

1. **Problem (30 s):** miasto ma tysiące kilometrów dróg, a o dziurach i śmieciach dowiaduje się po skargach mieszkańców.
2. **Pomysł (30 s):** auta kontroli parkowania już jeżdżą po mieście z kamerami. Używamy ich jako mobilnego skanera miasta.
3. **Demo na żywo (2 min):** startujemy przejazd. Na mapie auto się porusza, pojawiają się alerty (pomarańczowe: dziura, zielone: śmieci). Klikamy zdarzenie, widać zdjęcie, pewność modelu, lokalizację. Przypisujemy do służby.
4. **Wartość (45 s):** dane z jednego tygodnia, heatmapa, priorytety napraw. Liczby: koszt vs tradycyjny objazd.
5. **Prywatność i wdrożenie (30 s):** RODO, integracja z istniejącą flotą, model biznesowy (abonament dla miast).
6. **Roadmapa (15 s).**

**Plan B:** zawsze mieć nagrane wideo z demo, gdyby zawiódł internet albo GPU.

## 11. Ryzyka i jak je ograniczyć

| Ryzyko | Mitygacja |
|---|---|
| Modele słabo działają na naszym nagraniu | Krótki fine-tuning w Colabie do godz. 4. Potem zmiana nagrania i progu, nie kolejnych epok. |
| Sesja Colaba pada w trakcie treningu | Zapis `best.pt` na Drive co kilkanaście minut. Drugie konto jako zapasowy GPU. |
| Brak GPU | Trening tylko w Colabie. Na scenie i tak jest inferencja CPU/GPU laptopa na gotowych wagach, albo odtworzenie wcześniej policzonych zdarzeń. |
| Brak GPS w nagraniu | Ręcznie narysowana trasa po mapie i interpolacja pozycji w czasie |
| Za dużo funkcji | Trzymać się listy MUST HAVE, reszta tylko na slajdzie roadmapy |
| Awaria na scenie | Nagranie zapasowe plus lokalna wersja bez internetu |

## 12. Model biznesowy i wpływ (na slajd)
- **Klient:** zarządcy dróg i miasta (ZDM, ZOO).
- **Model:** abonament SaaS za pojazd lub kilometr przejazdu, dla miasta oszczędność na osobnych objazdach inspekcyjnych.
- **Wartość:** szybsza reakcja na dziury (mniej uszkodzeń aut), czystsze miasto, dane do planowania budżetu remontów.
- **Metryki do pokazania:** liczba wykrytych zdarzeń na 100 km, czas od wykrycia do zgłoszenia, odsetek automatycznych zgłoszeń.

## 13. Checklista przed prezentacją
- [ ] Demo działa od zera jednym poleceniem (`docker compose up` lub skrypt)
- [ ] Nagranie zapasowe gotowe
- [ ] Slajd o RODO
- [ ] Slajd z modelem biznesowym i roadmapą
- [ ] Każdy z zespołu wie, co mówi
- [ ] Repozytorium z README i instrukcją uruchomienia
- [ ] Dopasowanie wypowiedzi do kryteriów: innowacja (30%) i design (20%) mają największy wpływ
