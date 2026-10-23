"""
Descarga de OpenStreetMap (Overpass) el contorno de los embalses de la zona y
escribe ../datos/embalses.geojson (+ .js) con su area, la cota de su espejo de
agua segun el DEM (../datos/dem.png) y la subcuenca donde estan.

Uso (desde la raiz del repo, despues de preparar_datos.py):
  py Cuencas/Cundinamarca/herramientas/embalses.py
"""
import json
import math
import os
import time
import urllib.parse
import urllib.request

import numpy as np
from PIL import Image, ImageDraw

AQUI = os.path.dirname(os.path.abspath(__file__))
DATOS = os.path.join(AQUI, "..", "datos")

# Elementos de OpenStreetMap (tipo, id) -> clave del embalse en la pagina
EMBALSES = {
    ("relation", 7272885): "tomine",
    ("way", 32058486): "sisga",
    ("relation", 3434323): "neusa",
    ("way", 32056928): "chuza",
    ("relation", 4000410): "san_rafael",
    ("way", 29421723): "muna",
    ("relation", 11512616): "guavio",
}
NOMBRES = {
    "tomine": "Embalse de Tominé", "sisga": "Embalse del Sisga", "neusa": "Embalse del Neusa",
    "chuza": "Embalse de Chuza (Chingaza)", "san_rafael": "Embalse de San Rafael",
    "muna": "Embalse del Muña", "guavio": "Embalse del Guavio",
}


def overpass():
    ids_w = ",".join(str(i) for (t, i) in EMBALSES if t == "way")
    ids_r = ",".join(str(i) for (t, i) in EMBALSES if t == "relation")
    q = f"[out:json][timeout:150];(way(id:{ids_w});relation(id:{ids_r}););out geom;"
    datos = urllib.parse.urlencode({"data": q}).encode()
    for intento in range(5):
        try:
            req = urllib.request.Request("https://overpass-api.de/api/interpreter", data=datos,
                                         headers={"User-Agent": "LabSinergIA-Uniandes/1.0"})
            return json.loads(urllib.request.urlopen(req, timeout=200).read())
        except Exception as e:  # el servidor publico a veces esta lleno: se reintenta
            print("Overpass ocupado, reintentando...", e)
            time.sleep(15 * (intento + 1))
    raise RuntimeError("Overpass no respondio")


def unir(tramos):
    """Une los tramos (listas de [lon, lat]) de una relacion en anillos cerrados."""
    tramos = [t[:] for t in tramos if len(t) > 1]
    anillos = []
    while tramos:
        anillo = tramos.pop(0)
        cambio = True
        while anillo[0] != anillo[-1] and cambio:
            cambio = False
            for k, t in enumerate(tramos):
                if t[0] == anillo[-1]:
                    anillo += t[1:]
                elif t[-1] == anillo[-1]:
                    anillo += t[::-1][1:]
                elif t[-1] == anillo[0]:
                    anillo = t[:-1] + anillo
                elif t[0] == anillo[0]:
                    anillo = t[::-1][:-1] + anillo
                else:
                    continue
                tramos.pop(k)
                cambio = True
                break
        if len(anillo) >= 4 and anillo[0] == anillo[-1]:
            anillos.append(anillo)
    return anillos


def area_km2(anillo):
    lat0 = sum(p[1] for p in anillo) / len(anillo)
    k = math.cos(math.radians(lat0))
    s = sum((a[0] * k * 111.32) * (b[1] * 110.57) - (b[0] * k * 111.32) * (a[1] * 110.57)
            for a, b in zip(anillo, anillo[1:]))
    return abs(s) / 2


def main():
    R = json.load(open(os.path.join(DATOS, "rejilla.json")))
    d = np.array(Image.open(os.path.join(DATOS, "dem.png"))).astype(float)
    elev = d[..., 0] * 256 + d[..., 1] + d[..., 2] / 256 - 32768
    zonas = np.array(Image.open(os.path.join(DATOS, "zonas.png")))
    sub = json.load(open(os.path.join(DATOS, "subcuencas.geojson"), encoding="utf-8"))
    nombre_zona = {f["properties"]["id"]: f["properties"]["nombre"] for f in sub["features"]}

    feats = []
    for e in overpass()["elements"]:
        clave = EMBALSES.get((e["type"], e["id"]))
        if not clave:
            continue
        if e["type"] == "way":
            exteriores = [[[p["lon"], p["lat"]] for p in e["geometry"]]]
            interiores = []
        else:
            exteriores = unir([[[p["lon"], p["lat"]] for p in m["geometry"]] for m in e["members"]
                               if m["type"] == "way" and m.get("role", "outer") in ("outer", "")])
            interiores = unir([[[p["lon"], p["lat"]] for p in m["geometry"]] for m in e["members"]
                               if m["type"] == "way" and m.get("role") == "inner"])
        area = sum(area_km2(a) for a in exteriores) - sum(area_km2(a) for a in interiores)
        # celdas del DEM dentro del embalse
        img = Image.new("L", (R["ancho"], R["alto"]), 0)
        dib = ImageDraw.Draw(img)
        a_px = lambda a: [((x - R["oeste"]) / R["dx"] - 0.5, (R["norte"] - y) / R["dy"] - 0.5) for x, y in a]
        for a in exteriores:
            dib.polygon(a_px(a), fill=1)
        for a in interiores:
            dib.polygon(a_px(a), fill=0)
        m = np.array(img, bool)
        props = {"clave": clave, "nombre": NOMBRES[clave], "area_km2": round(area, 2),
                 "osm": f"https://www.openstreetmap.org/{e['type']}/{e['id']}"}
        if m.any():
            props["cota_dem"] = round(float(np.median(elev[m])))
            z = zonas[m]
            z = z[z > 0]
            if z.size:
                props["subcuenca"] = nombre_zona.get(int(np.bincount(z).argmax()))
            ff, cc = np.nonzero(m)
            k = int(np.argmin((ff - ff.mean()) ** 2 + (cc - cc.mean()) ** 2))
            props["centro"] = [round(R["oeste"] + (cc[k] + 0.5) * R["dx"], 5), round(R["norte"] - (ff[k] + 0.5) * R["dy"], 5)]
        coords = [[[round(x, 5), round(y, 5)] for x, y in a] for a in exteriores]
        huecos = [[[round(x, 5), round(y, 5)] for x, y in a] for a in interiores]
        geom = ({"type": "Polygon", "coordinates": coords + huecos} if len(coords) == 1
                else {"type": "MultiPolygon", "coordinates": [[c] for c in coords]})
        feats.append({"type": "Feature", "properties": props, "geometry": geom})
        print(props["nombre"], props["area_km2"], "km2, cota", props.get("cota_dem"), "-", props.get("subcuenca"))

    fc = {"type": "FeatureCollection", "features": feats}
    texto = json.dumps(fc, ensure_ascii=False, separators=(",", ":"))
    open(os.path.join(DATOS, "embalses.geojson"), "w", encoding="utf-8").write(texto)
    open(os.path.join(DATOS, "embalses.js"), "w", encoding="utf-8").write(f"const DATA_EMBALSES_CUND = {texto};\n")
    print(f"embalses: {len(feats)}, {len(texto) / 1e3:.0f} KB")


if __name__ == "__main__":
    main()
