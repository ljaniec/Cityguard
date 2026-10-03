# Cityguard

Dashboard dla miasta: auta kontroli parkowania wykrywają dziury i śmieci przy drodze. Trening YOLO12 jest w Colabie. Laptop tylko inferuje i pokazuje alerty.

## Trening (Colab)

1. W Colabie: Środowisko wykonawcze → Zmień typ środowiska → GPU (T4).
2. Wgraj `ml/train_road.ipynb` na jednym koncie i `ml/train_litter.ipynb` na drugim.
3. Przy pierwszym pobraniu wgraj token Kaggle (`kaggle.json`). Zbiory są już wpisane: RDD2022 oraz butelki i worki.
4. Pobierz `cityguard_weights.zip` i rozpakuj do `ml/weights/`:
   - `best_road.pt`
   - `best_litter.pt`
5. Opcjonalnie skopiuj tam też `yolo12n.pt` (wagi COCO). Inferencja użyje ich do rozmycia twarzy i tablic.

## Demo lokalnie

```bash
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt
backend/.venv/bin/uvicorn app.main:app --app-dir backend --port 8000
```

W drugim terminalu:

```bash
cd frontend && npm install && npm run dev
```

Dashboard: http://127.0.0.1:5173

Albo jednym poleceniem: `docker compose up --build`, potem ten sam adres.

## Film testowy

`data/demo.mp4` trwa 21 sekund, 1280×720, 15 kl./s. To początek jazdy autem przez centrum Krakowa (Wawel, Barbakan, zaparkowane auta przy krawężniku, znaki strefy P). Źródło: Relaxing Roads 4K, [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/), [plik na Wikimedia](https://commons.wikimedia.org/wiki/File:City_Driving_4K-_Krak%C3%B3w_Poland_2024.webm). Na początku widać napis HIGHLIGHTS z oryginału.

Kamery [Cityscanner](https://mcx.pl/cityscanner/) patrzą w bok, z dachu, na tablice. Ten kadr jest z szyby, do przodu. Wolnego nagrania z bocznej kamery auta e-kontroli nie ma; film ZDM jest na [YouTube](https://www.youtube.com/watch?v=qg1LSP9cqag) i na [stronie ZDM](https://zdm.waw.pl/aktualnosci/pierwszy-dzien-z-e-kontrola-za-nami-zobaczcie-film/).

### Synchronizacja mapy z nagraniem

`data/route.json` to trasa z filmu, kluczowana sekundą nagrania: każdy punkt ma `t`, `lat`, `lon`, `street` i `segment`. Nagranie jest montażem trzech ujęć (ul. Podzamcze pod Wawelem, pl. Matejki przy Barbakanie, ul. Stradomska), więc trasa też ma trzy odcinki, a między nimi auto przeskakuje. Backend, mapa i podgląd kamery idą po jednym zegarze:

- `POST /api/simulate/start` tyka co 0,25 s i rozsyła przez WebSocket `position` z polem `t` (sekunda nagrania), pozycją interpolowaną po czasie i nazwą ulicy;
- dashboard odtwarza `data/demo.mp4` (serwowane pod `/data/demo.mp4`) i dosuwa `currentTime` do `t`, gdy rozjazd przekroczy 0,6 s; tempo 4× ustawia też `playbackRate`;
- alerty demo mają `t_offset` równy sekundzie nagrania, w której auto mija to miejsce, a ich miniatury to klatki z `data/frames/` wycięte w tej samej sekundzie.

Zmiana trasy = edycja `data/route.json` i skasowanie `backend/storage/cityguard.db` (seed liczy pozycje od nowa).

```bash
python3 -m pip install -r ml/requirements.txt
python3 ml/infer.py --video data/demo.mp4
```

Potrzebne są wagi `ml/weights/best_road.pt` i `ml/weights/best_litter.pt` oraz działające API. `infer.py` liczy pozycję z czasu klatki (`CAP_PROP_POS_MSEC`) na tej samej trasie i wysyła ją do `POST /api/patrol/position`, więc mapa jedzie razem z inferencją (gdy akurat nie trwa symulacja). Z `--gpx` czas bierze się ze znaczników `<time>` śladu GPS.
