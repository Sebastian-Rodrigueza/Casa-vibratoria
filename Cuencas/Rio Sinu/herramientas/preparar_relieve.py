"""
Datos del visor 3D del rio Sinu (Relieve3D.html), con el mismo metodo que el de
Cundinamarca (../../Cundinamarca/herramientas/preparar_datos.py):

  DEM      capas_web/DEM_Sinu_Copernicus_web.tif (Copernicus GLO-30), promediado a ~90 m
  zonas    rio_sinu_data/subcuencas.geojson (58 subcuencas del POMCA)
  rios     rio_sinu_data/rios_hydrorivers.geojson, grabados en el DEM antes del drenaje

Escribe en ../datos/: dem.png, direcciones.png, zonas.png, rejilla.json,
subcuencas.geojson y drenaje.geojson (+ .js).

Uso (desde la raiz del repo, despues de actualizar_capas.py):
  py "Cuencas/Rio Sinu/herramientas/preparar_relieve.py"
"""
import json
import os
import sys

import numpy as np
import tifffile
from pyproj import Transformer
from shapely.geometry import shape
from shapely.ops import transform

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.normpath(os.path.join(AQUI, "..", "..", ".."))
sys.path.insert(0, os.path.join(RAIZ, "Cuencas", "Cundinamarca", "herramientas"))
import preparar_datos as motor  # noqa: E402

SALIDA = os.path.join(AQUI, "..", "datos")
FACTOR = 3  # 0,00027 grados (~30 m) -> 0,00081 (~90 m)

# Subzonas hidrograficas del IDEAM que trae el POMCA
GRUPOS = {"1302": "Medio Sinú", "1303": "Bajo Sinú"}
GRUPO_VALLE = "Alto Sinú y cauce principal"
COPIAR = ["pomca", "t_corrien", "caud_med", "q_max", "q_min", "q_ambienta", "q_disponib", "rend_hid", "tiem_conc"]


def leer_dem():
    with tifffile.TiffFile(os.path.join(RAIZ, "capas_web", "DEM_Sinu_Copernicus_web.tif")) as t:
        tags = t.pages[0].tags
        x0, y0 = tags["ModelTiepointTag"].value[3:5]
        paso = tags["ModelPixelScaleTag"].value[0]
        a = t.pages[0].asarray().astype(np.float32)
    a[a <= -9000] = np.nan
    h, w = (a.shape[0] // FACTOR) * FACTOR, (a.shape[1] // FACTOR) * FACTOR
    with np.errstate(all="ignore"):
        dem = np.nanmean(a[:h, :w].reshape(h // FACTOR, FACTOR, w // FACTOR, FACTOR), axis=(1, 3))
    meta = {"oeste": x0, "norte": y0, "dx": paso * FACTOR, "dy": paso * FACTOR,
            "ancho": dem.shape[1], "alto": dem.shape[0]}
    meta["este"] = meta["oeste"] + meta["ancho"] * meta["dx"]
    meta["sur"] = meta["norte"] - meta["alto"] * meta["dy"]
    return dem, meta


def main():
    ini = motor.t0()
    dem, meta = leer_dem()
    motor.log(f"DEM {meta['ancho']}x{meta['alto']} a {meta['dx'] * 111320:.0f} m", ini)

    a_9377 = Transformer.from_crs(4326, 9377, always_xy=True).transform
    sub = json.load(open(os.path.join(RAIZ, "rio_sinu_data", "subcuencas.geojson"), encoding="utf-8"))
    zonas = []
    for f in sub["features"]:
        p, g = f["properties"], f["geometry"]
        partes = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        szh = p.get("szh")
        zonas.append({
            "id": p["id"], "codch": int(szh) if szh else 1301, "cuenca": GRUPOS.get(szh, GRUPO_VALLE),
            "codsch": p.get("pomca") or "POMCA", "nombre": p["nombre"].replace("Sinu", "Sinú"),
            # solo los anillos exteriores: los huecos son otras subcuencas, que se pintan despues
            "anillos": [parte[0] for parte in partes],
            "huecos": sum(len(parte) - 1 for parte in partes),
            "geometria": g, "area_km2": p["area_km2"],
            "perimetro_km": round(transform(a_9377, shape(g)).length / 1000, 1),
            "extra": {k: p[k] for k in COPIAR if k in p},
        })
    # las subcuencas con huecos primero, para que las de adentro queden encima
    zonas.sort(key=lambda z: -z["huecos"])
    rios = json.load(open(os.path.join(RAIZ, "rio_sinu_data", "rios_hydrorivers.geojson"), encoding="utf-8"))
    lineas = []
    for f in rios["features"]:
        g = f["geometry"]
        lineas += [g["coordinates"]] if g["type"] == "LineString" else g["coordinates"]
    motor.log(f"{len(zonas)} subcuencas, {len(lineas)} tramos de HydroRIVERS", ini)

    motor.procesar(dem, meta, zonas, lineas, SALIDA, ini, {
        "fuente": "Copernicus GLO-30 (2024), remuestreado a ~90 m",
        "rios_grabados": "HydroRIVERS (WWF / HydroSHEDS)",
        "variables": ("DATA_SUBCUENCAS_SINU", "DATA_DRENAJE_SINU")})


if __name__ == "__main__":
    main()
