"""
Actualiza el catalogo de Datos Abiertos Bogota que usa Datos.html.

La API de datosabiertos.bogota.gov.co (CKAN) no permite consultas desde el
navegador (no envia cabeceras CORS), asi que el catalogo se descarga con
este script y se guarda como archivo del sitio:

    catalogo_bogota.json  y su gemelo  catalogo_bogota.js  (const DATA_CATALOGO_BOGOTA)

Solo se guardan los conjuntos de datos geograficos (con servicio ArcGIS,
GeoJSON, SHP, KMZ, WMS, etc.). Tambien descarga los iconos de cada
categoria a Imagenes/DatosBogota/.

Uso (desde cualquier carpeta):
    python "Geodata Colombia/Bogota/datos/actualizar_catalogo.py"
"""

import json
import os
import re
import urllib.request
from datetime import date

API = "https://datosabiertos.bogota.gov.co/api/3/action"
FICHA = "https://datosabiertos.bogota.gov.co/dataset/"

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.normpath(os.path.join(AQUI, "..", "..", ".."))
CARPETA_ICONOS = os.path.join(RAIZ, "Imagenes", "DatosBogota")

FORMATOS_GEO = {"ESRI REST", "ARCGIS GEOSERVICES REST API", "REST", "GEOJSON", "SHP", "KMZ", "KML",
                "WMS", "WFS", "WMTS", "GPKG", "GDB", "DXF", "DWG"}


def pedir(accion):
    with urllib.request.urlopen(f"{API}/{accion}", timeout=120) as r:
        return json.load(r)["result"]


def servicio_arcgis(recursos):
    """Primer servicio ArcGIS (MapServer o FeatureServer, con o sin capa) que Mapa.html puede abrir."""
    for r in recursos:
        url = (r.get("url") or "").strip()
        m = re.search(r"^(https?://.+?/rest/services/.+?/(?:MapServer|FeatureServer)(?:/\d+)?)(?:[/?#]|$)", url, re.I)
        if m:
            return m.group(1)
    return None


def texto_plano(t, largo=280):
    t = re.sub(r"<[^>]+>", " ", t or "")
    t = re.sub(r"[*_#>`\[\]]", "", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t if len(t) <= largo else t[:largo].rsplit(" ", 1)[0] + "…"


def main():
    # ---------- Todos los conjuntos de datos ----------
    paquetes, inicio = [], 0
    while True:
        r = pedir(f"package_search?rows=1000&start={inicio}")
        paquetes += r["results"]
        inicio += 1000
        if inicio >= r["count"]:
            break
    print("Conjuntos en el portal:", len(paquetes))

    datasets = []
    for p in paquetes:
        formatos = sorted({(x.get("format") or "").upper().strip() for x in p.get("resources", [])} - {""})
        servicio = servicio_arcgis(p.get("resources", []))
        if not servicio and not (set(formatos) & FORMATOS_GEO):
            continue  # no es geografico
        datasets.append({
            "id": p["name"],
            "t": p.get("title") or p["name"],
            "e": (p.get("organization") or {}).get("title") or "",
            "d": texto_plano(p.get("notes")),
            "g": [g["name"] for g in p.get("groups", [])] or ["otros"],
            "s": servicio,
            "f": formatos[:8],
            "m": (p.get("metadata_modified") or "")[:10],
        })
    print("Geograficos:", len(datasets), "| con servicio para el mapa:", sum(1 for d in datasets if d["s"]))

    # ---------- Categorias (grupos del portal) ----------
    os.makedirs(CARPETA_ICONOS, exist_ok=True)
    categorias = []
    # el portal entrega las categorias de 25 en 25
    grupos, offset = [], 0
    while True:
        parte = pedir(f"group_list?all_fields=true&limit=25&offset={offset}")
        grupos += parte
        offset += 25
        if len(parte) < 25:
            break
    for g in grupos:
        n = sum(1 for d in datasets if g["name"] in d["g"])
        if not n:
            continue
        icono = None
        if g.get("image_display_url"):
            ext = os.path.splitext(g["image_display_url"])[1].lower() or ".png"
            icono = g["name"] + ext
            try:
                with urllib.request.urlopen(g["image_display_url"], timeout=60) as r:
                    open(os.path.join(CARPETA_ICONOS, icono), "wb").write(r.read())
            except Exception as e:
                print("  sin icono para", g["name"], e)
                icono = None
        categorias.append({
            "id": g["name"],
            "nombre": g.get("display_name") or g["name"],
            "icono": icono,
            "n": n,
            "nMapa": sum(1 for d in datasets if g["name"] in d["g"] and d["s"]),
        })
    n_otros = sum(1 for d in datasets if "otros" in d["g"])
    if n_otros:
        categorias.append({"id": "otros", "nombre": "Otros", "icono": None, "n": n_otros,
                           "nMapa": sum(1 for d in datasets if "otros" in d["g"] and d["s"])})
    categorias.sort(key=lambda c: -c["n"])

    catalogo = {
        "fuente": "Datos Abiertos Bogotá (datosabiertos.bogota.gov.co)",
        "ficha": FICHA,
        "actualizado": date.today().isoformat(),
        "categorias": categorias,
        "datasets": datasets,
    }

    with open(os.path.join(AQUI, "catalogo_bogota.json"), "w", encoding="utf-8") as f:
        json.dump(catalogo, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(AQUI, "catalogo_bogota.js"), "w", encoding="utf-8") as f:
        f.write("const DATA_CATALOGO_BOGOTA = ")
        json.dump(catalogo, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    print("Categorias:", len(categorias), "| guardado en", AQUI)


if __name__ == "__main__":
    main()
