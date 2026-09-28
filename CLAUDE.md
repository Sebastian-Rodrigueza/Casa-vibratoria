# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Static geospatial website for Laboratorio Digital CIAM (Universidad de los Andes), deployed on **Vercel**, with one Python serverless API. Code, comments and UI text are in Spanish (comments intentionally avoid accents/ñ) — keep that style. There is no build step, no bundler, no linter and no test suite.

## Running locally

- **Static pages:** serve the repo root with any static server, e.g. `python -m http.server 8000`, then open `http://localhost:8000/Index.html`. Many pages load data via `<script>` tags, so some also work opened directly from disk.
- **Production API locally:** `api/index.py` is a Flask app. It needs `DATABASE_URL` (Supabase Postgres) and optionally `GEMINI_API_KEY`:
  ```powershell
  pip install -r api/requirements.txt
  $env:DATABASE_URL = "postgresql://..."; $env:FLASK_APP = "api/index.py"; flask run --port 5000
  ```
  Frontend pages switch to `http://localhost:5000/api/...` when `location.hostname` is `localhost`/`127.0.0.1`, and use relative `/api/...` otherwise (see `API_BASE` in `Geodata Colombia/General/ICDE/resultados*.html`, `agente1/agente.js`, `Mapa.html`).
- **GDB import server for Mapa.html:** `INICIAR_MAPA_GDB.bat` (or `python servidor_mapa_gdb.py`) serves the repo on `http://localhost:5500` and adds `/api/gdb/status` and `/api/gdb/convert`, which shell out to GDAL `ogrinfo`/`ogr2ogr` (auto-discovered from PATH, QGIS or OSGeo4W installs). Local-only; not deployed.

## Deployment (Vercel)

- `vercel.json`: `/` → `/Index.html`; `/api/(.*)` → `/api/index` (all API routes live in the single Flask app `api/index.py`).
- Env vars in Vercel: `DATABASE_URL`, `GEMINI_API_KEY`.
- `.vercelignore` excludes legacy/local-only files. Its patterns must be anchored with a leading `/` when the name exists elsewhere — an unanchored `requirements.txt` once excluded `api/requirements.txt` and broke the API.
- GitHub and Vercel both reject files >100 MB. Large rasters live in `capas_pesadas/` (gitignored and vercelignored); pages that reference them will fail on the live site until they are hosted elsewhere.

## Architecture

**Two backends exist — only one is live:**
- `api/index.py` — **current**: Vercel serverless Flask + Postgres (Supabase) via `psycopg2`. Routes: `/api/labview/historico`, `/api/labview/archivos`, `/api/datasets`, `/api/datasets/<id>`, `/api/categorias`, `/api/arcgis-proxy` (GET/POST), `/api/proxy-geojson`, `/api/agente/consultar`, `/api/status`.
- `api.py` (+ root `requirements.txt`, `Procfile`) — **legacy**: Flask + MySQL formerly on Render. Additionally had live LabVIEW routes (`/api/labview/actual`, `/importar`, `/archivos_disponibles`) that call the lab PC on the university LAN and an APScheduler job polling it every 5 s. These cannot work on Vercel (no LAN access, no background processes), so `casa.html`'s live/import buttons fail in production. When changing shared route behavior, `api/index.py` is the one that matters; `api.py` uses MySQL syntax (`LIKE`, `dictionary=True`) vs Postgres (`ILIKE`, `RealDictCursor`).
- `backend/api_sensores_LAB.py` runs **on the lab PC**, reading LabVIEW `.lvm` files and exposing `/api/sensores*` on port 5000. Not deployed.

**Data model** (Postgres, originally MySQL — see `DB Geo andes/scripdbandes.sql`): `categorias(id, nombre)`, `datasets(..., categoria_id, arcgis_id)` for the ICDE catalog; `lecturas_labview(id, fecha_hora, archivo, x_value, datos JSON)` for sensor readings of the vibrating-house experiment.

**ICDE assistant** (`/api/agente/consultar`): keyword-filters `datasets` via ILIKE, puts up to 40 candidates in a Gemini prompt (`gemini-flash-lite-latest`, REST via `requests`, retries on 503), asks for `RECOMENDADO: <exact name>` lines, then matches those names back to DB rows. Frontend widget: `agente1/agente.js` + `agente1/agente-panel.css`, loaded by `Index.html` (the `agente1/` folder is used by the site — don't treat it as unused).

**ArcGIS proxy:** many Colombian government ArcGIS servers lack CORS, so browser pages (Mapa.html, ICDE results pages) fetch through `/api/arcgis-proxy?url=<service>`; POST is used for long `objectIds` queries.

**Frontend:** self-contained HTML pages with inline JS/CSS (some very large, e.g. `Mapa.html`, `casa.html`, `modelo3d.html`) using CDN libraries (Leaflet/MapLibre/three.js etc.). Sections:
- `Index.html` — landing page linking everything.
- `Mapa.html` — main map viewer (ArcGIS layers, Overpass, GDB import, GeoTIFF).
- `casa.html` — LabVIEW sensor dashboard (vibrating house, `casavibratoria.glb`); `modelo3d.html`, `Comparador3D.html`, `Prueba3D-MapLibre.html` — 3D viewers. `Comparador3D.html` uses a Potree viewer in `NubePuntos/` which is gitignored (multi-GB), so it only works locally.
- `Geodata Colombia/` — ICDE catalog UI; `General/ICDE/resultados*.html` are per-category result pages that call `/api/datasets?categoria=...`.
- `Rio Sinu/` — Sinú river basin viewer, using lightweight layers from `rio_sinu_data/`.

**Data file convention:** layers in `rio_sinu_data/` exist as both `.geojson` and a `.js` twin that assigns the same content to a global (`const DATA_PUENTES = {...};`) so pages can load it via `<script>` without fetch/CORS. If you regenerate a `.geojson`, regenerate its `.js` twin too.

**Not part of the site (gitignored):** `Webscraping/` (separate scraper project), `NubePuntos/`, `Sinu (2)/` (744 MB raw basin data), `capas_pesadas/`, `_archivo_local/` (old DB dumps).
