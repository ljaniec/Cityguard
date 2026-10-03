# CityGuard na Render

Jeden Web Service: FastAPI, dashboard i przejazd `--mock`. Bez Torch i bez wag YOLO — na darmowym planie to nie wejdzie.

SQLite i zdjęcia siedzą na dysku instancji. Po restarcie albo uśpieniu free tieru znikają. Przycisk „Start przejazdu” i tak czyści bazę.

## Co jest w tym folderze

| Plik | Po co |
|---|---|
| `Dockerfile` | Obraz: `npm run build` + API + OpenCV + `ml/infer.py` |
| `asgi.py` | To samo API, plus pliki z `frontend/dist` pod `/` |
| `entrypoint.sh` | `CITYGUARD_API=http://127.0.0.1:$PORT` (Render podstawia `PORT`) |
| `render.yaml` | Blueprint: New → Blueprint |

Kontekst Dockera to **katalog główny repozytorium**, nie ten folder.

## Ręcznie w dashboardzie

1. Wrzuć projekt na GitHub / GitLab.
2. [dashboard.render.com](https://dashboard.render.com/) → **New** → **Web Service** → to repo.
3. Ustawienia:
   - **Language / Runtime:** Docker
   - **Root directory:** puste (root repo)
   - **Dockerfile path:** `render/Dockerfile`
   - **Docker build context directory:** `.`
   - **Instance:** Free
   - **Health check path:** `/api/health`
4. **Create Web Service** i czekaj na deploy (pierwszy build 5–10 min: Node + pip).
5. Adres serwisu, np. `https://cityguard.onrender.com` — otwórz, kliknij **Start przejazdu**.

Zmienne możesz dodać, ale obraz ma już dobre domyślne. Nie ustawiaj `CITYGUARD_API` na publiczny URL — worker woła API od środka kontenera.

## Blueprint

Zamiast klikać ręcznie: **New** → **Blueprint** → to repo → jako plik wskaż `render/render.yaml` (albo skopiuj go do katalogu głównego jako `render.yaml`, jeśli Render szuka tylko tam).

## Lokalny test obrazu

Z katalogu głównego repo:

```bash
docker build -f render/Dockerfile -t cityguard-render .
docker run --rm -p 8000:8000 cityguard-render
```

Potem http://127.0.0.1:8000 — ten sam dashboard co na Vite, tylko z jednego portu.

## Czego nie wrzucać

- `ml/.venv`, `backend/.venv`, `ml/weights/*.pt` — niepotrzebne i za duże.
- Drugiego serwisu na front. Proxy Vite nie ma w produkcji; front i API są pod tym samym originem.

## Free tier

Instancja usypia po bezczynności. Pierwsze wejście po śnie trwa kilkanaście sekund. WebSocket łączy się ponownie sam.
