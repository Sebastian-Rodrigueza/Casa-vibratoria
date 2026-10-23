"""
Prepara los datos livianos del visor de cuencas de Cundinamarca.

Lee los datos crudos de ../info/info/ (DEM de 30 m y shapefile de subcuencas,
855 MB, fuera de git) y escribe en ../datos/ solo lo que necesita la pagina:

  dem.png          DEM a ~92 m en codificacion Terrarium (RGB), para leer
                   alturas en el navegador (perfil, inundacion, gota de lluvia)
  direcciones.png  direccion de flujo D8 (0 = sin salida, 1..8 = vecino), en gris
  zonas.png        numero de subcuenca de cada celda (0 = fuera), en gris
  rejilla.json     tamano y ubicacion de las tres imagenes anteriores
  subcuencas.geojson (+ .js)  poligonos simplificados con estadisticas
  drenaje.geojson    (+ .js)  red de drenaje calculada del DEM (orden de Strahler)

Uso (desde la raiz del repo):
  py -m pip install tifffile imagecodecs pyshp numpy pillow
  py Cuencas/Cundinamarca/herramientas/preparar_datos.py

Los rios de OpenStreetMap (../info/osm/rios.json) se graban en el DEM antes de
calcular el drenaje ("stream burning"). Sin eso, en la Sabana, que es casi plana,
el agua sale en lineas rectas paralelas que no existen. Si el archivo no esta, se
descarga de Overpass (gratis).
"""
import heapq
import json
import math
import os
import time
import urllib.parse
import urllib.request

import numpy as np
import shapefile
import tifffile
from PIL import Image, ImageDraw

AQUI = os.path.dirname(os.path.abspath(__file__))
CRUDOS = os.path.join(AQUI, "..", "info", "info")
SALIDA = os.path.join(AQUI, "..", "datos")

FACTOR = 3            # 1 segundo de arco (~30 m) -> 3 segundos (~92 m)
MARGEN = 0.03         # grados alrededor de las subcuencas
UMBRAL_KM2 = 4.0      # area de drenaje minima para dibujar un cauce
QUEMA_M = 15.0        # profundidad con que se "graban" los rios de OpenStreetMap en el DEM
TOL_POLIGONO = 0.0004 # simplificacion de poligonos (grados, ~45 m)
TOL_RIO = 0.0006

# Vecinos D8: codigo 1..8 -> (dfila, dcol)
VECINOS = [(-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1), (0, -1), (-1, -1)]


def t0():
    return time.time()


def log(msg, ini):
    print(f"{msg} ({time.time() - ini:.1f} s)", flush=True)


# ---------------------------------------------------------------------
# Subcuencas: lectura y arreglo de nombres
# ---------------------------------------------------------------------
def texto(b):
    # El .dbf perdio el primer byte de la "í" (queda EF BF BD AD): se repara
    if isinstance(b, str):
        b = b.encode("utf-8", "surrogateescape")
    b = b.replace(b"\xef\xbf\xbd\xad", "í".encode()).replace(b"\xef\xbf\xbd", b"")
    return b.decode("utf-8", "replace").strip()


def leer_subcuencas():
    sf = shapefile.Reader(os.path.join(CRUDOS, "SubCuenca"), encoding="utf-8", encodingErrors="surrogateescape")
    campos = [f[0] for f in sf.fields[1:]]
    zonas = []
    for i, sr in enumerate(sf.shapeRecords(), start=1):
        r = dict(zip(campos, sr.record))
        partes = list(sr.shape.parts) + [len(sr.shape.points)]
        anillos = [sr.shape.points[partes[k]:partes[k + 1]] for k in range(len(partes) - 1)]
        zonas.append({
            "id": i,
            "codch": int(r["CODCH"]), "cuenca": texto(r["NOMCH"]),
            "codsch": int(r["CODSCH"]), "nombre": texto(r["NOMSCH"]),
            "anillos": anillos,
        })
    return zonas


# ---------------------------------------------------------------------
# DEM
# ---------------------------------------------------------------------
def leer_dem(caja):
    with tifffile.TiffFile(os.path.join(CRUDOS, "dem.tif")) as t:
        tags = t.pages[0].tags
        x0, y0 = tags["ModelTiepointTag"].value[3:5]
        dx, dy = tags["ModelPixelScaleTag"].value[:2]
        a = t.pages[0].asarray()
    # tiepoint = esquina del primer pixel (PixelIsArea)
    oeste, sur, este, norte = caja
    c0 = int((oeste - x0) / dx) // FACTOR * FACTOR
    c1 = int(math.ceil((este - x0) / dx / FACTOR)) * FACTOR
    f0 = int((y0 - norte) / dy) // FACTOR * FACTOR
    f1 = int(math.ceil((y0 - sur) / dy / FACTOR)) * FACTOR
    sub = a[f0:f1, c0:c1].astype(np.float32)
    sub[(sub > 1e30) | (sub < -500)] = np.nan
    h, w = sub.shape
    bloques = sub.reshape(h // FACTOR, FACTOR, w // FACTOR, FACTOR)
    with np.errstate(all="ignore"):
        dem = np.nanmean(bloques, axis=(1, 3))
    meta = {
        "oeste": x0 + c0 * dx, "norte": y0 - f0 * dy,
        "dx": dx * FACTOR, "dy": dy * FACTOR,
        "ancho": dem.shape[1], "alto": dem.shape[0],
    }
    meta["este"] = meta["oeste"] + meta["ancho"] * meta["dx"]
    meta["sur"] = meta["norte"] - meta["alto"] * meta["dy"]
    return dem, meta


def rasterizar_zonas(zonas, meta):
    """Imagen con el id de subcuenca en cada celda (centro de celda dentro del poligono)."""
    img = Image.new("L", (meta["ancho"], meta["alto"]), 0)
    d = ImageDraw.Draw(img)
    for z in zonas:
        for anillo in z["anillos"]:
            pts = [((x - meta["oeste"]) / meta["dx"] - 0.5, (meta["norte"] - y) / meta["dy"] - 0.5) for x, y in anillo]
            d.polygon(pts, fill=z["id"])
    return np.array(img, dtype=np.uint8)


# ---------------------------------------------------------------------
# Rios de OpenStreetMap grabados en el DEM
# ---------------------------------------------------------------------
def rios_osm(meta):
    ruta = os.path.join(CRUDOS, "..", "osm", "rios.json")
    if not os.path.exists(ruta):
        os.makedirs(os.path.dirname(ruta), exist_ok=True)
        caja = f"{meta['sur']:.3f},{meta['oeste']:.3f},{meta['norte']:.3f},{meta['este']:.3f}"
        q = f'[out:json][timeout:180];way["waterway"~"^(river|canal)$"]({caja});out geom;'
        datos = urllib.parse.urlencode({"data": q}).encode()
        for intento in range(5):
            try:
                req = urllib.request.Request("https://overpass-api.de/api/interpreter", data=datos,
                                             headers={"User-Agent": "LabSinergIA-Uniandes/1.0"})
                with open(ruta, "wb") as f:
                    f.write(urllib.request.urlopen(req, timeout=240).read())
                break
            except Exception as e:  # el servidor publico a veces esta lleno
                print("Overpass ocupado, reintentando...", e)
                time.sleep(15 * (intento + 1))
    lineas = []
    for e in json.load(open(ruta, encoding="utf-8"))["elements"]:
        t = e.get("tags", {})
        tunel = t.get("tunnel") not in (None, "no", "culvert")
        # rios: todos; canales: solo los que tienen nombre (rios canalizados de Bogota),
        # no las acequias de riego ni los tuneles de trasvase
        if tunel or (t.get("waterway") == "canal" and "name" not in t):
            continue
        lineas.append([(p["lon"], p["lat"]) for p in e.get("geometry", [])])
    return lineas


def quemar(dem, meta, lineas):
    img = Image.new("L", (meta["ancho"], meta["alto"]), 0)
    d = ImageDraw.Draw(img)
    for ln in lineas:
        pts = [((x - meta["oeste"]) / meta["dx"] - 0.5, (meta["norte"] - y) / meta["dy"] - 0.5) for x, y in ln]
        if len(pts) > 1:
            d.line(pts, fill=1, width=1)
    m = np.array(img, bool) & ~np.isnan(dem)
    return np.where(m, dem - QUEMA_M, dem), m


# ---------------------------------------------------------------------
# Hidrologia: relleno de depresiones, direcciones D8, acumulacion
# ---------------------------------------------------------------------
def rellenar(dem, rio=None):
    """Priority-flood (Barnes 2014) con epsilon: deja todo con salida al borde o a celdas sin dato.

    Dentro de las zonas planas que quedan al rellenar, el epsilon es 20 veces menor
    sobre los rios conocidos: asi el agua recorre el cauce real y llega a el desde
    los lados, en vez de cruzar la llanura en linea recta hacia la salida."""
    h, w = dem.shape
    z = np.where(np.isnan(dem), -1e9, dem).astype(np.float64).ravel()
    valido = (~np.isnan(dem)).ravel()
    lleno = z.copy()
    visto = np.zeros(h * w, bool)
    cola = []
    # semillas: borde del mapa y celdas validas vecinas de "sin dato"
    nan = np.isnan(dem)
    borde = np.zeros((h, w), bool)
    borde[0, :] = borde[-1, :] = borde[:, 0] = borde[:, -1] = True
    vecino_nan = np.zeros((h, w), bool)
    for df, dc in VECINOS:
        vecino_nan |= np.roll(np.roll(nan, df, 0), dc, 1)
    semillas = np.flatnonzero(((borde | vecino_nan) & ~nan).ravel())
    for i in semillas:
        visto[i] = True
        heapq.heappush(cola, (lleno[i], int(i)))
    visto[~valido] = True
    desp = [(df, dc, df * w + dc) for df, dc in VECINOS]
    eps_rio, eps = 1e-4, 2e-3
    rio = np.zeros(h * w, bool) if rio is None else rio.ravel()
    while cola:
        zi, i = heapq.heappop(cola)
        f, c = divmod(i, w)
        for df, dc, d in desp:
            ff, cc = f + df, c + dc
            if ff < 0 or ff >= h or cc < 0 or cc >= w:
                continue
            j = i + d
            if visto[j]:
                continue
            visto[j] = True
            if lleno[j] <= zi:
                lleno[j] = zi + (eps_rio if rio[j] else eps)
            heapq.heappush(cola, (lleno[j], j))
    return lleno.reshape(h, w)


def direcciones(lleno, meta):
    """D8: vecino con mayor pendiente (en metros). 0 = sin salida."""
    h, w = lleno.shape
    lat = meta["norte"] - (np.arange(h) + 0.5) * meta["dy"]
    mx = meta["dx"] * 111320 * np.cos(np.radians(lat))[:, None]
    my = meta["dy"] * 110570
    mejor = np.zeros((h, w))
    codigo = np.zeros((h, w), np.uint8)
    pad = np.pad(lleno, 1, constant_values=np.inf)
    for k, (df, dc) in enumerate(VECINOS, start=1):
        vec = pad[1 + df:1 + df + h, 1 + dc:1 + dc + w]
        dist = np.sqrt((dc * mx) ** 2 + (df * my) ** 2)
        pend = (lleno - vec) / dist
        mas = pend > mejor
        mejor[mas] = pend[mas]
        codigo[mas] = k
    # en el borde del mapa, si no hay vecino mas bajo, sale hacia afuera (0)
    return codigo


def acumulacion(lleno, codigo):
    h, w = lleno.shape
    orden = np.argsort(-lleno.ravel(), kind="stable")
    cod = codigo.ravel()
    acc = np.ones(h * w, np.float64)
    destino = np.full(h * w, -1, np.int64)
    filas, cols = np.divmod(np.arange(h * w), w)
    for k, (df, dc) in enumerate(VECINOS, start=1):
        m = cod == k
        ff, cc = filas[m] + df, cols[m] + dc
        ok = (ff >= 0) & (ff < h) & (cc >= 0) & (cc < w)
        idx = np.flatnonzero(m)[ok]
        destino[idx] = ff[ok] * w + cc[ok]
    for i in orden:
        d = destino[i]
        if d >= 0:
            acc[d] += acc[i]
    return acc.reshape(h, w), destino


# ---------------------------------------------------------------------
# Geometria
# ---------------------------------------------------------------------
def simplificar(pts, tol):
    """Douglas-Peucker iterativo."""
    if len(pts) < 3:
        return pts
    p = np.asarray(pts, float)
    guardar = np.zeros(len(p), bool)
    guardar[0] = guardar[-1] = True
    pila = [(0, len(p) - 1)]
    while pila:
        a, b = pila.pop()
        if b <= a + 1:
            continue
        seg = p[b] - p[a]
        n = np.hypot(*seg)
        rel = p[a + 1:b] - p[a]
        d = np.abs(seg[0] * rel[:, 1] - seg[1] * rel[:, 0]) / n if n > 0 else np.hypot(rel[:, 0], rel[:, 1])
        k = int(np.argmax(d))
        if d[k] > tol:
            m = a + 1 + k
            guardar[m] = True
            pila += [(a, m), (m, b)]
    return p[guardar].tolist()


def redondear(pts):
    return [[round(x, 5), round(y, 5)] for x, y in pts]


def distancia_m(a, b):
    lat = math.radians((a[1] + b[1]) / 2)
    return math.hypot((b[0] - a[0]) * 111320 * math.cos(lat), (b[1] - a[1]) * 110570)


def area_anillo_km2(anillo):
    lat0 = sum(y for _, y in anillo) / len(anillo)
    k = math.cos(math.radians(lat0))
    s = 0.0
    for (x1, y1), (x2, y2) in zip(anillo, anillo[1:] + anillo[:1]):
        s += (x1 * k * 111.32) * (y2 * 110.57) - (x2 * k * 111.32) * (y1 * 110.57)
    return abs(s) / 2


# ---------------------------------------------------------------------
# Salidas
# ---------------------------------------------------------------------
def guardar_geojson(nombre, variable, fc):
    texto_json = json.dumps(fc, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(SALIDA, nombre + ".geojson"), "w", encoding="utf-8") as f:
        f.write(texto_json)
    with open(os.path.join(SALIDA, nombre + ".js"), "w", encoding="utf-8") as f:
        f.write(f"const {variable} = {texto_json};\n")
    print(f"  {nombre}: {len(texto_json) / 1e6:.2f} MB")


def terrarium(dem):
    # alturas redondeadas al metro: el canal azul queda en 0 y la imagen pesa mucho menos
    v = np.round(np.where(np.isnan(dem), -10000.0, dem)) + 32768.0
    r = np.floor(v / 256)
    g = np.floor(v - r * 256)
    b = np.floor((v - np.floor(v)) * 256)
    return np.dstack([r, g, b]).astype(np.uint8)


def main():
    os.makedirs(SALIDA, exist_ok=True)
    ini = t0()
    zonas = leer_subcuencas()
    xs = [x for z in zonas for a in z["anillos"] for x, _ in a]
    ys = [y for z in zonas for a in z["anillos"] for _, y in a]
    caja = (min(xs) - MARGEN, min(ys) - MARGEN, max(xs) + MARGEN, max(ys) + MARGEN)
    log(f"{len(zonas)} subcuencas, caja {[round(v, 3) for v in caja]}", ini)

    dem, meta = leer_dem(caja)
    log(f"DEM {meta['ancho']}x{meta['alto']} a {meta['dx'] * 3600:.0f} segundos", ini)
    procesar(dem, meta, zonas, rios_osm(meta), SALIDA, ini, {
        "fuente": "DEM 1 segundo de arco (dem.tif), remuestreado",
        "rios_grabados": "OpenStreetMap (waterway=river y canales con nombre)",
        "variables": ("DATA_SUBCUENCAS_CUND", "DATA_DRENAJE_CUND")})


def procesar(dem, meta, zonas, lineas, salida, ini, info):
    """Drenaje, estadisticas y rejillas a partir del DEM (lat/lon), las subcuencas y los rios a grabar.

    Cada zona: id, codch, cuenca, codsch, nombre, anillos (lat/lon). Opcionales: "geometria"
    (GeoJSON ya simplificado, para multipoligonos), "area_km2", "perimetro_km" y "extra"
    (atributos que se copian tal cual). Tambien lo usa el visor del rio Sinu."""
    global SALIDA
    SALIDA = salida
    os.makedirs(SALIDA, exist_ok=True)
    zon = rasterizar_zonas(zonas, meta)
    quemado, es_rio = quemar(dem, meta, lineas)
    log(f"{len(lineas)} rios grabados ({int(es_rio.sum())} celdas)", ini)
    lleno = rellenar(quemado, es_rio)
    log("depresiones rellenadas", ini)
    codigo = direcciones(lleno, meta)
    codigo[np.isnan(dem)] = 0
    acc, destino = acumulacion(lleno, codigo)
    log("acumulacion de flujo", ini)

    # area de cada celda en km2
    h, w = dem.shape
    lat = meta["norte"] - (np.arange(h) + 0.5) * meta["dy"]
    celda_km2 = (meta["dx"] * 111.32 * np.cos(np.radians(lat)))[:, None] * (meta["dy"] * 110.57) * np.ones((1, w))
    # acumulacion en km2 (aproximada con el area media de la celda)
    acc_km2 = acc * float(celda_km2.mean())

    # Pendiente (grados)
    gy, gx = np.gradient(np.where(np.isnan(dem), np.nanmean(dem), dem))
    mx = (meta["dx"] * 111320 * np.cos(np.radians(lat)))[:, None]
    pend = np.degrees(np.arctan(np.hypot(gx / mx, gy / (meta["dy"] * 110570))))

    # ---------- Subcuencas con estadisticas ----------
    feats = []
    for z in zonas:
        m = (zon == z["id"]) & ~np.isnan(dem)
        alt = dem[m]
        anillos = [redondear(simplificar(a, TOL_POLIGONO)) for a in z["anillos"]]
        anillos = [a for a in anillos if len(a) >= 4]
        area = z.get("area_km2") or (sum(area_anillo_km2(a) for a in z["anillos"][:1]) - sum(area_anillo_km2(a) for a in z["anillos"][1:]))
        perim = z.get("perimetro_km") or sum(distancia_m(a, b) for a, b in zip(z["anillos"][0], z["anillos"][0][1:])) / 1000
        props = {"id": z["id"], "codch": z["codch"], "cuenca": z["cuenca"], "codsch": z["codsch"],
                 "nombre": z["nombre"], "area_km2": round(area, 2), "perimetro_km": round(perim, 1),
                 "kc": round(0.28 * perim / math.sqrt(area), 2) if area > 0 else None, **z.get("extra", {})}
        if alt.size:
            # punto interior para etiquetas y para pedir el clima: la celda de la
            # subcuenca mas cercana a su centro de masa
            ff, cc = np.nonzero(m)
            k = int(np.argmin((ff - ff.mean()) ** 2 + (cc - cc.mean()) ** 2))
            props["centro"] = [round(meta["oeste"] + (cc[k] + 0.5) * meta["dx"], 5),
                               round(meta["norte"] - (ff[k] + 0.5) * meta["dy"], 5)]
            props.update({
                "alt_min": round(float(alt.min())), "alt_max": round(float(alt.max())),
                "alt_media": round(float(alt.mean())),
                "pendiente_media": round(float(pend[m].mean()), 1),
                # curva hipsometrica: altura que supera el p% del area (p = 0, 5, ..., 100)
                "hipsometrica": [round(float(v)) for v in np.percentile(alt, list(range(100, -1, -5)))],
                "cauce_max_km2": round(float(acc_km2[m].max()), 1),
            })
            # integral hipsometrica (Strahler): (media - min) / (max - min)
            if props["alt_max"] > props["alt_min"]:
                props["integral_hipsometrica"] = round((props["alt_media"] - props["alt_min"]) /
                                                       (props["alt_max"] - props["alt_min"]), 3)
        # el shapefile trae a veces varias partes: anillo exterior + huecos
        feats.append({"type": "Feature", "properties": props,
                      "geometry": z.get("geometria") or {"type": "Polygon", "coordinates": anillos}})
    guardar_geojson("subcuencas", info["variables"][0], {"type": "FeatureCollection", "features": feats})
    log("subcuencas", ini)

    # ---------- Red de drenaje (Strahler) ----------
    cauce = (acc_km2 >= UMBRAL_KM2) & (zon > 0)
    flat_c = cauce.ravel()
    entradas = np.zeros(h * w, np.int32)
    idx_c = np.flatnonzero(flat_c)
    dest_c = destino[idx_c]
    ok = dest_c >= 0
    np.add.at(entradas, dest_c[ok][flat_c[dest_c[ok]]], 1)
    # orden de Strahler: de aguas arriba hacia abajo
    orden = np.zeros(h * w, np.int16)
    maxo = np.zeros(h * w, np.int16)
    cuenta_max = np.zeros(h * w, np.int16)
    por_altura = idx_c[np.argsort(-lleno.ravel()[idx_c], kind="stable")]
    for i in por_altura:
        o = maxo[i] if maxo[i] > 0 else 1
        if cuenta_max[i] >= 2:
            o = maxo[i] + 1
        orden[i] = o
        d = destino[i]
        if d >= 0 and flat_c[d]:
            if o > maxo[d]:
                maxo[d], cuenta_max[d] = o, 1
            elif o == maxo[d]:
                cuenta_max[d] += 1
    # tramos: se corta en nacimientos y confluencias
    def centro(i):
        f, c = divmod(int(i), w)
        return [meta["oeste"] + (c + 0.5) * meta["dx"], meta["norte"] - (f + 0.5) * meta["dy"]]
    inicio = idx_c[(entradas[idx_c] != 1)]
    rios = []
    for i in inicio:
        pts = [centro(i)]
        j = i
        o = int(orden[i])
        while True:
            d = destino[j]
            if d < 0 or not flat_c[d]:
                break
            pts.append(centro(d))
            if entradas[d] != 1 or orden[d] != o:
                break
            j = d
        if len(pts) < 2:
            continue
        rios.append({"type": "Feature",
                     "properties": {"orden": o, "area_km2": round(float(acc_km2.ravel()[j]), 1),
                                    "zona": int(zon.ravel()[i])},
                     "geometry": {"type": "LineString", "coordinates": redondear(simplificar(pts, TOL_RIO))}})
    guardar_geojson("drenaje", info["variables"][1], {"type": "FeatureCollection", "features": rios})
    log(f"red de drenaje: {len(rios)} tramos, orden maximo {int(orden.max())}", ini)

    # ---------- Rejillas para el navegador ----------
    Image.fromarray(terrarium(dem), "RGB").save(os.path.join(SALIDA, "dem.png"), optimize=True)
    Image.fromarray(codigo, "L").save(os.path.join(SALIDA, "direcciones.png"), optimize=True)
    Image.fromarray(zon, "L").save(os.path.join(SALIDA, "zonas.png"), optimize=True)
    meta.update({"factor": FACTOR, "fuente": info["fuente"],
                 "alt_min": round(float(np.nanmin(dem))), "alt_max": round(float(np.nanmax(dem))),
                 "umbral_cauce_km2": UMBRAL_KM2,
                 "rios_grabados": info["rios_grabados"] + ", " + str(int(QUEMA_M)) + " m"})
    with open(os.path.join(SALIDA, "rejilla.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=1)
    for n in ("dem.png", "direcciones.png", "zonas.png"):
        print(f"  {n}: {os.path.getsize(os.path.join(SALIDA, n)) / 1e6:.2f} MB")
    log("listo", ini)


if __name__ == "__main__":
    main()
