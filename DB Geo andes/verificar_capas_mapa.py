"""
Revisa que capas del catalogo ICDE se pueden ver en el mapa y guarda el resultado en la
tabla capas_mapa (dataset_id, servicio, ok, motivo, revisado). Las paginas solo dejan abrir
en el visor las capas con ok = true, y usan el servicio ya encontrado (sin buscarlo al hacer clic).

Para cada dataset:
  1) busca el servicio FeatureServer/MapServer en sus enlaces, o en su item de ArcGIS Online;
  2) comprueba que el servicio responda y que tenga elementos para dibujar
     (alguna capa con entidades, o mosaicos de imagen).

Uso (desde la raiz del repo, con DATABASE_URL en .env.local o en el entorno):
    py "DB Geo andes/verificar_capas_mapa.py"            # todas
    py "DB Geo andes/verificar_capas_mapa.py" --faltantes # solo las que nunca se revisaron
Conviene correrlo de vez en cuando: las entidades apagan o mueven sus servicios.
"""
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import psycopg2
import requests

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REGEX_SERVICIO = re.compile(r"https?://[^\s\"'<>]+/(?:FeatureServer|MapServer)(?:/\d+)?", re.I)
ITEMS = "https://www.arcgis.com/sharing/rest/content/items/"
CABECERAS = {"User-Agent": "LabSinergIA-Uniandes/1.0 (catalogo ICDE)"}


def cargar_env_local():
    ruta = os.path.join(RAIZ, ".env.local")
    if not os.path.exists(ruta):
        return
    for linea in open(ruta, encoding="utf-8-sig"):
        linea = linea.strip()
        if linea and not linea.startswith("#") and "=" in linea:
            k, v = linea.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def buscar_servicio(valor):
    if not valor:
        return ""
    if isinstance(valor, str):
        m = REGEX_SERVICIO.search(valor)
        if not m:
            return ""
        # ".../arcgis/services/..." es la version SOAP/WMS; la REST es ".../arcgis/rest/services/..."
        return re.sub(r"(?<!/rest)/services/", "/rest/services/", m.group(0).split("?")[0].rstrip("/"), count=1)
    for v in (valor if isinstance(valor, list) else valor.values() if isinstance(valor, dict) else []):
        s = buscar_servicio(v)
        if s:
            return s
    return ""


def id_item(valor):
    m = re.search(r"[a-f0-9]{32}", str(valor or ""), re.I)
    return m.group(0) if m else ""


def pedir_json(url, **params):
    # tiempo maximo total por consulta: algunos servidores dejan la conexion colgada
    limite = time.time() + 30
    with requests.get(url, params={"f": "json", **params}, headers=CABECERAS, timeout=(10, 20), stream=True) as r:
        if r.status_code >= 400:
            raise RuntimeError(f"ArcGIS respondió con estado {r.status_code}")
        partes = []
        for parte in r.iter_content(65536):
            partes.append(parte)
            if time.time() > limite:
                raise requests.Timeout("demasiado lento")
            if sum(map(len, partes)) > 20_000_000:
                break
    try:
        d = json.loads(b"".join(partes).decode("utf-8", "replace"))
    except ValueError:
        raise RuntimeError("el servicio no devolvió datos válidos")
    if isinstance(d, dict) and d.get("error"):
        e = d["error"]
        raise RuntimeError(f"ArcGIS respondió: {e.get('message') or e.get('code')}")
    return d


def encontrar_servicio(d):
    directo = buscar_servicio(d["url_descarga"]) or buscar_servicio(d["url_fuente"]) or buscar_servicio(d["arcgis_id"])
    if directo:
        return directo
    item = id_item(d["arcgis_id"]) or id_item(d["url_fuente"]) or id_item(d["url_descarga"])
    if not item:
        raise RuntimeError("no tiene un servicio de ArcGIS")
    info = pedir_json(ITEMS + item)
    s = buscar_servicio(info.get("url"))
    if s:
        return s
    # los OGCFeatureServer de ArcGIS Online tienen al lado el FeatureServer normal
    s = buscar_servicio(re.sub(r"/OGCFeatureServer\b", "/FeatureServer", info.get("url") or ""))
    if s:
        return s
    try:
        s = buscar_servicio(pedir_json(ITEMS + item + "/data"))
    except Exception:
        s = ""
    if s:
        return s
    raise RuntimeError("el ítem de ArcGIS no tiene un servicio público")


def tiene_entidades(url_capa):
    try:
        n = pedir_json(url_capa + "/query", where="1=1", returnCountOnly="true").get("count")
        return n is None or n > 0
    except Exception:
        return False


def revisar_servicio(servicio):
    meta = pedir_json(servicio)
    if re.search(r"/(FeatureServer|MapServer)/\d+$", servicio, re.I):
        if not tiene_entidades(servicio):
            raise RuntimeError("el servicio responde, pero no tiene elementos para dibujar")
        return
    capas = [c for c in meta.get("layers") or [] if not c.get("subLayerIds")]
    if any(tiene_entidades(f"{servicio}/{c['id']}") for c in capas[:6]):
        return
    if meta.get("tileInfo"):
        return   # se ve como imagen del servicio
    raise RuntimeError("el servicio responde, pero no tiene elementos para dibujar")


def revisar(d):
    try:
        s = encontrar_servicio(d)
        revisar_servicio(s)
        return d["id"], s, True, None
    except Exception as e:
        motivo = str(e)
        if isinstance(e, requests.RequestException):
            motivo = "el servicio no respondió"
        return d["id"], locals().get("s"), False, motivo[:300]


def main():
    cargar_env_local()
    if not os.environ.get("DATABASE_URL"):
        sys.exit("Falta DATABASE_URL (en .env.local o en el entorno).")
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    with conn, conn.cursor() as cur:
        cur.execute("""CREATE TABLE IF NOT EXISTS capas_mapa (
                           dataset_id INTEGER PRIMARY KEY REFERENCES datasets(id) ON DELETE CASCADE,
                           servicio TEXT, ok BOOLEAN NOT NULL, motivo TEXT, revisado TIMESTAMPTZ NOT NULL DEFAULT now())""")
        sql = "SELECT id, arcgis_id, url_fuente, url_descarga FROM datasets"
        if "--faltantes" in sys.argv:
            sql += " WHERE id NOT IN (SELECT dataset_id FROM capas_mapa)"
        cur.execute(sql + " ORDER BY id")
        filas = [dict(zip(("id", "arcgis_id", "url_fuente", "url_descarga"), r)) for r in cur.fetchall()]
    print(f"Revisando {len(filas)} capas…")
    t0, hechos, buenas = time.time(), [], 0
    with ThreadPoolExecutor(16) as ex:
        for i, fut in enumerate(as_completed([ex.submit(revisar, f) for f in filas]), 1):
            res = fut.result()
            hechos.append(res)
            buenas += res[2]
            if i % 50 == 0 or i == len(filas):
                print(f"  {i}/{len(filas)}  ({buenas} se pueden ver)  {time.time() - t0:.0f} s")
    with conn, conn.cursor() as cur:
        cur.executemany("""INSERT INTO capas_mapa (dataset_id, servicio, ok, motivo, revisado) VALUES (%s, %s, %s, %s, now())
                           ON CONFLICT (dataset_id) DO UPDATE SET servicio = EXCLUDED.servicio, ok = EXCLUDED.ok,
                               motivo = EXCLUDED.motivo, revisado = now()""", hechos)
    conn.close()
    malas = [h for h in hechos if not h[2]]
    print(f"\nListo: {buenas} de {len(hechos)} capas se pueden ver en el mapa; {len(malas)} no.")
    motivos = {}
    for h in malas:
        motivos[h[3]] = motivos.get(h[3], 0) + 1
    for m, n in sorted(motivos.items(), key=lambda x: -x[1])[:10]:
        print(f"  {n:4d}  {m}")


if __name__ == "__main__":
    main()
