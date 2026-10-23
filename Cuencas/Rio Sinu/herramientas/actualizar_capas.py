"""
Actualiza las capas del visor del rio Sinu con las capas base nuevas
(../Sinu_capas_base/Sinu_capas_base/, todas en EPSG:9377, fuera de git).

Escribe en rio_sinu_data/ (raiz del repo), cada una con su gemelo .js:
  cuenca            limite de la cuenca (13.362 km2)
  subcuencas        58 subcuencas del POMCA con la forma nueva; los atributos
                    hidrologicos del POMCA (caudales, tiempo de concentracion...)
                    se copian de la capa anterior por nombre, y se agregan
                    alturas y pendiente medidas en el DEM nuevo
  rios_hydrorivers  red de rios HydroRIVERS con caudal medio modelado
y en capas_web/:
  DEM_Sinu_Copernicus_web.tif  Copernicus GLO-30 pasado a WGS84 (lat/lon, ~30 m),
                               entero en metros, para leerlo con georaster en la pagina

Uso (desde la raiz del repo):
  py -m pip install pyshp numpy pillow tifffile imagecodecs pyproj shapely
  py "Cuencas/Rio Sinu/herramientas/actualizar_capas.py"
"""
import json
import os
import unicodedata

import numpy as np
import shapefile
import shapely
import tifffile
from PIL import Image, ImageDraw
from pyproj import Transformer
from shapely.geometry import mapping, shape

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.normpath(os.path.join(AQUI, "..", "..", ".."))
BASE = os.path.join(AQUI, "..", "Sinu_capas_base", "Sinu_capas_base")
DATOS = os.path.join(RAIZ, "rio_sinu_data")
DEM_WEB = os.path.join(RAIZ, "capas_web", "DEM_Sinu_Copernicus_web.tif")

TOL_POLIGONO = 0.00015  # grados (~16 m)
TOL_RIO = 0.0002
PASO_DEM = 0.00027      # grados (~30 m) del DEM web
SIN_DATO = -9999

a_wgs84 = Transformer.from_crs(9377, 4326, always_xy=True)
a_9377 = Transformer.from_crs(4326, 9377, always_xy=True)


def leer(nombre):
    sf = shapefile.Reader(os.path.join(BASE, nombre), encoding="utf-8")
    campos = [f[0] for f in sf.fields[1:]]
    return [(dict(zip(campos, r.record)), shape(r.shape.__geo_interface__)) for r in sf.shapeRecords()]


def a_lonlat(g, tol):
    g = shapely.transform(g, lambda xy: np.column_stack(a_wgs84.transform(xy[:, 0], xy[:, 1])))
    if g.geom_type.endswith("Polygon"):
        g = shapely.make_valid(g)  # algunos poligonos traen huecos mal puestos
        # make_valid puede dejar lineas sueltas junto al poligono: solo se guardan las areas
        g = shapely.union_all([p for p in shapely.get_parts(g) if p.geom_type.endswith("Polygon")])
    g = g.simplify(tol, preserve_topology=True)
    return shapely.transform(g, lambda xy: np.round(xy, 5))


def clave(t):
    t = unicodedata.normalize("NFKD", str(t)).encode("ascii", "ignore").decode().lower()
    return " ".join(t.split())


def guardar(nombre, variable, feats):
    fc = {"type": "FeatureCollection", "name": nombre, "features": feats}
    texto = json.dumps(fc, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(DATOS, nombre + ".geojson"), "w", encoding="utf-8") as f:
        f.write(texto)
    with open(os.path.join(DATOS, nombre + ".js"), "w", encoding="utf-8") as f:
        f.write(f"const {variable} = {texto};\n")
    print(f"  {nombre}: {len(feats)} elementos, {len(texto) / 1e6:.2f} MB")


# ---------------------------------------------------------------------
# DEM (en EPSG:9377, celdas de 30 m)
# ---------------------------------------------------------------------
def leer_dem():
    ruta = os.path.join(BASE, "02_DEM", "DEM_CopernicusGLO30_cuenca_sinu_30m_EPSG9377.tif")
    with tifffile.TiffFile(ruta) as t:
        tags = t.pages[0].tags
        x0, y0 = tags["ModelTiepointTag"].value[3:5]
        dx, dy = tags["ModelPixelScaleTag"].value[:2]
        z = t.pages[0].asarray().astype(np.float32)
    z[z <= SIN_DATO + 1] = np.nan
    return z, (x0, y0, dx, dy)


def estadisticas(z, geo, g):
    """Alturas y pendiente dentro de un poligono (en metros, EPSG:9377)."""
    x0, y0, dx, dy = geo
    img = Image.new("L", (z.shape[1], z.shape[0]), 0)
    d = ImageDraw.Draw(img)
    for p in getattr(g, "geoms", [g]):
        a_px = lambda c: [((x - x0) / dx - 0.5, (y0 - y) / dy - 0.5) for x, y in c]
        d.polygon(a_px(p.exterior.coords), fill=1)
        for h in p.interiors:
            d.polygon(a_px(h.coords), fill=0)
    m = np.array(img, bool) & ~np.isnan(z)
    if not m.any():
        return {}
    v = z[m]
    return {"alt_min": round(float(v.min())), "alt_media": round(float(v.mean())),
            "alt_max": round(float(v.max())), "pendiente_media": round(float(PEND[m].mean()), 1)}


def dem_web(z, geo):
    """Remuestrea el DEM a una rejilla lat/lon (bilineal) y lo guarda como GeoTIFF."""
    x0, y0, dx, dy = geo
    alto, ancho = z.shape
    esq = np.array(a_wgs84.transform([x0, x0 + ancho * dx, x0, x0 + ancho * dx],
                                     [y0, y0, y0 - alto * dy, y0 - alto * dy]))
    oeste, este = np.floor(esq[0].min() / PASO_DEM) * PASO_DEM, np.ceil(esq[0].max() / PASO_DEM) * PASO_DEM
    sur, norte = np.floor(esq[1].min() / PASO_DEM) * PASO_DEM, np.ceil(esq[1].max() / PASO_DEM) * PASO_DEM
    cols, filas = int(round((este - oeste) / PASO_DEM)), int(round((norte - sur) / PASO_DEM))
    sal = np.full((filas, cols), SIN_DATO, np.int16)
    lon = oeste + (np.arange(cols) + 0.5) * PASO_DEM
    for f0 in range(0, filas, 400):
        f1 = min(filas, f0 + 400)
        lat = norte - (np.arange(f0, f1) + 0.5) * PASO_DEM
        LO, LA = np.meshgrid(lon, lat)
        X, Y = a_9377.transform(LO, LA)
        c = (X - x0) / dx - 0.5
        f = (y0 - Y) / dy - 0.5
        ci, fi = np.floor(c).astype(int), np.floor(f).astype(int)
        tx, ty = c - ci, f - fi
        ok = (ci >= 0) & (fi >= 0) & (ci < ancho - 1) & (fi < alto - 1)
        ci, fi = np.where(ok, ci, 0), np.where(ok, fi, 0)
        v = (z[fi, ci] * (1 - tx) + z[fi, ci + 1] * tx) * (1 - ty) + (z[fi + 1, ci] * (1 - tx) + z[fi + 1, ci + 1] * tx) * ty
        # en el borde (alguna vecina sin dato) se usa la celda mas cercana
        cerca = z[np.clip(np.rint(f).astype(int), 0, alto - 1), np.clip(np.rint(c).astype(int), 0, ancho - 1)]
        v = np.where(np.isnan(v), cerca, v)
        v = np.where(ok & ~np.isnan(v), np.rint(v), SIN_DATO)
        sal[f0:f1] = v.astype(np.int16)
    geokeys = [1, 1, 0, 3, 1024, 0, 1, 2, 1025, 0, 1, 1, 2048, 0, 1, 4326]
    tifffile.imwrite(
        DEM_WEB, sal, tile=(256, 256), compression="zlib", compressionargs={"level": 9}, predictor=2,
        extratags=[(33550, "d", 3, (PASO_DEM, PASO_DEM, 0.0), True),
                   (33922, "d", 6, (0.0, 0.0, 0.0, float(oeste), float(norte), 0.0), True),
                   (34735, "H", len(geokeys), geokeys, True),
                   (42113, "s", 0, str(SIN_DATO), True)])
    print(f"  DEM web: {cols}x{filas} celdas de {PASO_DEM}°, {os.path.getsize(DEM_WEB) / 1e6:.1f} MB")


# ---------------------------------------------------------------------
def main():
    global PEND
    z, geo = leer_dem()
    gy, gx = np.gradient(np.where(np.isnan(z), np.nanmean(z), z), geo[3], geo[2])
    PEND = np.degrees(np.arctan(np.hypot(gx, gy)))
    print(f"DEM {z.shape[1]}x{z.shape[0]}, {np.nanmin(z):.0f} a {np.nanmax(z):.0f} m")

    # ---------- Cuenca ----------
    (p, g), = leer("01_Cuenca/cuenca_rio_sinu")
    est = estadisticas(z, geo, g)
    guardar("cuenca", "DATA_CUENCA", [{"type": "Feature", "geometry": mapping(a_lonlat(g, TOL_POLIGONO)), "properties": {
        "nombre": "Cuenca del río Sinú", "area_km2": round(g.area / 1e6, 1), "Shape_Area": round(g.area),
        "perimetro_km": round(g.length / 1e3, 1), **est,
        "fuente": "Delimitación GeoIngenIA (2026), capas base Sinú"}}])

    # ---------- Subcuencas POMCA ----------
    # atributos de las 57 subcuencas anteriores (copiados de la capa vieja a atributos_pomca.json)
    viejas = json.load(open(os.path.join(AQUI, "atributos_pomca.json"), encoding="utf-8"))
    pomca = {clave(p.get("NOM_NSS") or p.get("COD_POMCA")): p for p in viejas}
    copiar = ["POMCA", "SZH", "T_CORRIEN", "CAUD_MED", "Q_MAX", "Q_MIN", "Q_AMBIENTA", "Q_DISPONIB", "REND_HID",
              "ESCORR", "TIEM_CONC", "IND_COMPAC", "IND_SIN", "DEN_DREN"]
    feats = []
    for p, g in leer("04_Subcuencas_POMCA/subcuencas_POMCA_rio_sinu"):
        props = {"id": p["id"], "nombre": p["nombre"], "area_km2": round(p["area_km2"], 1), "km2_pomca": p["km2_pomca"]}
        viejo = pomca.get(clave(p["nombre"]))
        if viejo:
            props.update({k.lower(): viejo[k] for k in copiar if viejo.get(k) not in (None, "")})
            props["area_anterior_km2"] = round(viejo["SHAPE_Area"] / 1e6, 1)
        props.update(estadisticas(z, geo, g))
        feats.append({"type": "Feature", "geometry": mapping(a_lonlat(g, TOL_POLIGONO)), "properties": props})
    print(f"  {sum('caud_med' in f['properties'] for f in feats)} de {len(feats)} subcuencas con atributos del POMCA")
    guardar("subcuencas", "DATA_SUBCUENCAS", feats)

    # ---------- Rios HydroRIVERS ----------
    feats = []
    for p, g in leer("03_Rios/rios_HydroRIVERS_cuenca_sinu"):
        g = a_lonlat(g, TOL_RIO)
        if g.is_empty:
            continue
        feats.append({"type": "Feature", "geometry": mapping(g), "properties": {
            "orden": p["RIV_ORD"], "caudal_m3s": round(p["DIS_AV_CMS"], 2),
            "area_km2": round(p["UPLAND_SKM"], 1), "long_km": round(p["long_km"], 2)}})
    # los mas caudalosos al final para que se dibujen encima
    feats.sort(key=lambda f: f["properties"]["caudal_m3s"])
    guardar("rios_hydrorivers", "DATA_RIOS_HYDRO", feats)

    # ---------- DEM web ----------
    dem_web(z, geo)


if __name__ == "__main__":
    main()
