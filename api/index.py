"""
API GeoDB Andes - version Vercel + Supabase
---------------------------------------------
Reemplaza a api.py (Flask en Render + MySQL en Aiven) con funciones
serverless en Vercel que consultan Postgres en Supabase.

Diferencias a proposito respecto a api.py:
- No incluye las rutas que dependian de preguntarle EN VIVO a la PC del
  laboratorio (/api/labview/actual, /api/labview/importar,
  /api/labview/archivos_disponibles) -- Vercel no puede llegar a esa
  red local. Los datos ya importados (los 3 ensayos de muestra) se
  siguen consultando bien con /api/labview/historico y /api/labview/archivos.
- No hay scheduler en segundo plano (APScheduler): las funciones
  serverless no mantienen procesos corriendo entre peticiones.
- Gemini se llama con la libreria "requests" normal (el workaround de
  curl.exe en api.py era por una red especifica de la PC del usuario,
  no hace falta en el entorno de Vercel).

Variables de entorno que hay que configurar en Vercel (Project Settings
-> Environment Variables):
  - DATABASE_URL: la cadena de conexion de Supabase (postgresql://...)
  - GEMINI_API_KEY: la clave de Gemini para el asistente ICDE (opcional,
    si falta simplemente /api/agente/consultar responde con un error
    claro en vez de fallar feo)
"""

import os
import re
import time

import psycopg2
import psycopg2.extras
import requests as req_lib
from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

DATABASE_URL = os.environ.get("DATABASE_URL")


def conectar():
    return psycopg2.connect(DATABASE_URL)


ARCGIS_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0 Safari/537.36"
    )
}


# =====================================================================
# LABVIEW - HISTORICO (solo lectura de lo ya importado a Supabase)
# =====================================================================

@app.route("/api/labview/historico")
def labview_historico():
    """
    Devuelve el historico de lecturas guardadas en Supabase, para
    graficar la evolucion de los sensores a lo largo del ensayo.

    Parametros opcionales en la URL:
      - archivo: filtra solo las lecturas de un archivo .lvm especifico
      - limite: cuantas filas devolver como maximo (por defecto 500)
    """
    archivo_filtro = request.args.get("archivo", "").strip()
    limite = request.args.get("limite", "500")
    try:
        limite = int(limite)
    except ValueError:
        limite = 500
    limite = max(1, min(limite, 100000))

    conn = conectar()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    if archivo_filtro:
        # Trae las ULTIMAS filas (para poder seguir un ensayo en vivo si
        # algun dia se retoma la carga en vivo) y las ordena
        # cronologicamente despues, igual que en api.py original.
        cur.execute(
            """
            SELECT id, fecha_hora, archivo, x_value, datos
            FROM (
                SELECT id, fecha_hora, archivo, x_value, datos
                FROM lecturas_labview
                WHERE archivo = %s
                ORDER BY id DESC
                LIMIT %s
            ) AS ultimas
            ORDER BY id ASC
            """,
            (archivo_filtro, limite)
        )
    else:
        cur.execute(
            """
            SELECT id, fecha_hora, archivo, x_value, datos
            FROM lecturas_labview
            ORDER BY id DESC
            LIMIT %s
            """,
            (limite,)
        )

    filas = cur.fetchall()
    cur.close()
    conn.close()

    resultado = [
        {
            "id": fila["id"],
            "fecha_hora": fila["fecha_hora"].isoformat() if fila["fecha_hora"] else None,
            "archivo": fila["archivo"],
            "x_value": fila["x_value"],
            "datos": fila["datos"],
        }
        for fila in filas
    ]
    return jsonify(resultado)


@app.route("/api/labview/archivos")
def labview_archivos():
    """
    Lista todos los ensayos (archivos .lvm) que hay guardados en
    Supabase, agrupados por nombre de archivo, con la cantidad de filas
    y la fecha de la primera y ultima lectura de cada uno.
    """
    conn = conectar()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(
        """
        SELECT
            archivo,
            COUNT(*) AS filas,
            MIN(fecha_hora) AS primera_lectura,
            MAX(fecha_hora) AS ultima_lectura
        FROM lecturas_labview
        GROUP BY archivo
        ORDER BY ultima_lectura DESC
        """
    )
    resultados = cur.fetchall()
    cur.close()
    conn.close()

    for fila in resultados:
        if fila.get("primera_lectura") is not None:
            fila["primera_lectura"] = fila["primera_lectura"].isoformat()
        if fila.get("ultima_lectura") is not None:
            fila["ultima_lectura"] = fila["ultima_lectura"].isoformat()

    return jsonify(resultados)


# =====================================================================
# CATALOGO ICDE (datasets / categorias)
# =====================================================================

@app.route("/api/datasets")
def obtener_datasets():
    categoria_nombre = request.args.get("categoria", "").strip()

    conn = conectar()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(
        """
        SELECT
            d.id, d.nombre_dataset, d.entidad_responsable, d.descripcion,
            d.formato, d.url_fuente, d.url_descarga, d.arcgis_id
        FROM datasets d
        JOIN categorias c ON d.categoria_id = c.id
        WHERE c.nombre ILIKE %s
        """,
        (f"%{categoria_nombre}%",)
    )
    resultados = cur.fetchall()
    cur.close()
    conn.close()
    return jsonify(resultados)


@app.route("/api/datasets/<int:dataset_id>")
def obtener_dataset(dataset_id):
    conn = conectar()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(
        """
        SELECT
            d.id, d.nombre_dataset, d.entidad_responsable, d.descripcion,
            d.formato, d.url_fuente, d.url_descarga, d.arcgis_id,
            c.id AS categoria_id, c.nombre AS categoria
        FROM datasets d
        JOIN categorias c ON d.categoria_id = c.id
        WHERE d.id = %s
        LIMIT 1
        """,
        (dataset_id,)
    )
    dataset = cur.fetchone()
    cur.close()
    conn.close()

    if not dataset:
        return jsonify({"ok": False, "error": "Dataset no encontrado"}), 404
    return jsonify(dataset)


@app.route("/api/categorias")
def obtener_categorias():
    conn = conectar()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT id, nombre FROM categorias ORDER BY id")
    resultados = cur.fetchall()
    cur.close()
    conn.close()
    return jsonify(resultados)


# =====================================================================
# PROXIES ARCGIS (sin cambios de fondo, no dependen de la base de datos)
# =====================================================================

@app.route("/api/arcgis-proxy", methods=["GET", "POST"])
def arcgis_proxy():
    destino = request.args.get("url", "").strip()
    if not destino:
        return jsonify({"error": "Falta el parametro url"}), 400

    try:
        if request.method == "POST":
            params = {k: v for k, v in request.form.items() if k != "url"}
            respuesta = req_lib.post(destino, data=params, headers=ARCGIS_HEADERS, timeout=30)
        else:
            params = {k: v for k, v in request.args.items() if k != "url"}
            respuesta = req_lib.get(destino, params=params, headers=ARCGIS_HEADERS, timeout=30)

        respuesta.raise_for_status()
        return jsonify(respuesta.json())

    except req_lib.exceptions.SSLError as e:
        return jsonify({"error": f"Error de certificado SSL en el servidor ArcGIS: {str(e)}"}), 502
    except req_lib.exceptions.Timeout:
        return jsonify({"error": "El servidor ArcGIS tardo demasiado en responder (timeout)."}), 502
    except req_lib.exceptions.RequestException as e:
        return jsonify({"error": f"No fue posible consultar ArcGIS: {str(e)}"}), 502
    except ValueError:
        return jsonify({"error": "ArcGIS no devolvio un JSON valido"}), 502


@app.route("/api/proxy-geojson")
def proxy_geojson():
    servicio_url = request.args.get("url", "").strip()
    if not servicio_url:
        return jsonify({"error": "Falta el parametro url"}), 400

    try:
        query_url = f"{servicio_url.rstrip('/')}/query"
        params = {"where": "1=1", "outFields": "*", "f": "geojson"}
        respuesta = req_lib.get(query_url, params=params, headers=ARCGIS_HEADERS, timeout=30)
        respuesta.raise_for_status()
        return jsonify(respuesta.json())
    except req_lib.exceptions.RequestException as e:
        return jsonify({"error": f"No fue posible consultar el servicio: {str(e)}"}), 502
    except ValueError:
        return jsonify({"error": "El servicio no devolvio un JSON valido"}), 502


# =====================================================================
# AGENTE ICDE - ASISTENTE DEL CATALOGO
# =====================================================================

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
# El modelo "flash" normal solo da 20 solicitudes GRATIS por dia -- se
# agota facilisimo en una demo. El "flash-lite" tiene un cupo gratis
# mucho mas alto, y de sobra para este uso (recomendar datasets).
GEMINI_MODEL = "gemini-flash-lite-latest"
GEMINI_URL = (
    f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
)


def buscar_datasets_relacionados(mensaje, limite=40):
    palabras = [p for p in re.split(r"\W+", mensaje.lower()) if len(p) >= 3]

    conn = conectar()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    base_query = """
        SELECT
            d.id, d.nombre_dataset, d.entidad_responsable, d.descripcion,
            d.formato, d.url_fuente, d.url_descarga, d.arcgis_id,
            c.nombre AS categoria
        FROM datasets d
        JOIN categorias c ON d.categoria_id = c.id
    """

    resultados = []

    if palabras:
        condiciones = []
        valores = []
        for palabra in palabras:
            comodin = f"%{palabra}%"
            condiciones.append(
                "(d.nombre_dataset ILIKE %s OR d.descripcion ILIKE %s "
                "OR d.entidad_responsable ILIKE %s OR c.nombre ILIKE %s)"
            )
            valores.extend([comodin, comodin, comodin, comodin])

        query = base_query + " WHERE " + " OR ".join(condiciones) + " LIMIT %s"
        valores.append(limite)
        cur.execute(query, tuple(valores))
        resultados = cur.fetchall()

    if not resultados:
        cur.execute(base_query + " LIMIT %s", (limite,))
        resultados = cur.fetchall()

    cur.close()
    conn.close()
    return resultados


@app.route("/api/agente/consultar", methods=["POST"])
def agente_consultar():
    if not GEMINI_API_KEY:
        return jsonify({
            "ok": False,
            "error": (
                "El agente no tiene configurada la clave de Gemini en Vercel. "
                "Agrega la variable de entorno GEMINI_API_KEY en Project Settings."
            )
        }), 503

    datos_entrada = request.get_json(silent=True) or {}
    mensaje = str(datos_entrada.get("mensaje", "")).strip()

    if not mensaje:
        return jsonify({"ok": False, "error": "Falta el mensaje."}), 400

    try:
        candidatos = buscar_datasets_relacionados(mensaje)
    except Exception as e:
        return jsonify({"ok": False, "error": f"No fue posible consultar el catalogo: {str(e)}"}), 500

    catalogo_texto = "\n".join(
        f"- {c['nombre_dataset']} · {c['categoria']} · "
        f"{c['entidad_responsable'] or 'Entidad no especificada'} · "
        f"{(c['descripcion'] or '').strip()[:200]}"
        for c in candidatos
    ) or "(el catalogo no tiene datasets registrados todavia)"

    prompt = (
        "Eres el asistente del portal ICDE (Infraestructura Colombiana de Datos "
        "Espaciales) del Laboratorio Digital CIAM, Universidad de los Andes. "
        "Ayudas a las personas a encontrar los datasets geograficos que necesitan.\n\n"
        "Instrucciones:\n"
        "- Responde en espanol, en un maximo de 100 palabras, en tono claro y directo.\n"
        "- Recomienda SOLO datasets que existan en el catalogo de abajo. No inventes datasets.\n"
        "- Si nada del catalogo coincide bien con lo que pide la persona, dilo con honestidad "
        "y sugiere que categoria del portal podria explorar en su lugar.\n"
        "- Al final de tu respuesta, agrega una linea por cada dataset que recomiendes, con "
        "el nombre EXACTO tal cual aparece en el catalogo, en el formato:\n"
        "RECOMENDADO: <nombre exacto del dataset>\n"
        "Si no recomiendas ninguno, no agregues esas lineas.\n\n"
        f"Catalogo disponible:\n{catalogo_texto}\n\n"
        f'Pregunta de la persona: "{mensaje}"'
    )

    # Gemini a veces responde 503 "high demand" un momento y ya -- 2
    # reintentos cortos evitan que eso tumbe la demo por algo pasajero.
    ultimo_error = None
    cuerpo = None
    for intento in range(3):
        try:
            respuesta = req_lib.post(
                GEMINI_URL,
                headers={"Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY},
                # "flash-lite" no tiene modo de razonamiento (no acepta
                # thinkingConfig, responde 400 si se lo mandamos), asi
                # que ni hace falta -- ya responde rapido de por si.
                json={"contents": [{"parts": [{"text": prompt}]}]},
                # Con el catalogo completo en el prompt, Gemini a veces
                # tarda 30-40s en responder -- Vercel permite funciones de
                # hasta 300s, asi que hay margen de sobra para esperar.
                timeout=60,
            )
            respuesta.raise_for_status()
            cuerpo = respuesta.json()
            break
        except req_lib.exceptions.HTTPError as e:
            ultimo_error = e
            if respuesta.status_code != 503 or intento == 2:
                return jsonify({"ok": False, "error": f"No fue posible conectar con Gemini: {str(e)}"}), 502
            time.sleep(1.5)
        except req_lib.exceptions.RequestException as e:
            return jsonify({"ok": False, "error": f"No fue posible conectar con Gemini: {str(e)}"}), 502
        except ValueError:
            return jsonify({"ok": False, "error": "Gemini no devolvio un JSON valido"}), 502

    if cuerpo is None:
        return jsonify({"ok": False, "error": f"No fue posible conectar con Gemini: {str(ultimo_error)}"}), 502

    try:
        texto_ia = (
            cuerpo.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [{}])[0]
            .get("text", "")
        ).strip()
        if not texto_ia:
            raise ValueError("Gemini no devolvio texto en la respuesta.")
    except (ValueError, KeyError, IndexError) as e:
        return jsonify({"ok": False, "error": f"Gemini devolvio una respuesta inesperada: {str(e)}"}), 502

    nombres_recomendados = re.findall(r"RECOMENDADO:\s*(.+)", texto_ia)
    texto_para_mostrar = re.sub(r"RECOMENDADO:.*", "", texto_ia).strip()

    recomendados = []
    for nombre in nombres_recomendados:
        nombre = nombre.strip()
        coincidencia = next(
            (c for c in candidatos if c["nombre_dataset"].strip().lower() == nombre.lower()),
            None
        )
        if coincidencia:
            recomendados.append(coincidencia)

    return jsonify({
        "ok": True,
        "respuesta": texto_para_mostrar or texto_ia,
        "recomendados": recomendados
    })


# =====================================================================
# TRANSMILENIO - DEMANDA POR ESTACION (datos abiertos, sin guardar nada)
# =====================================================================
# TransMilenio publica cada dia un archivo con las entradas y salidas de
# cada estacion troncal cada 15 minutos, en un almacenamiento publico de
# Google. No tiene API ni permite leerlo desde el navegador (CORS), asi
# que esta ruta lo descarga, lo resume por estacion y por hora y devuelve
# un JSON pequeno. Vercel guarda la respuesta en su cache (CDN), asi que
# cada fecha se descarga una sola vez y no se guarda nada de nuestro lado.

TM_ALMACEN = "https://storage.googleapis.com/validaciones_tmsa"
TM_LISTADO = "https://storage.googleapis.com/storage/v1/b/validaciones_tmsa/o"


def _codigo_y_nombre(texto):
    """'(10000)Portal 20 de Julio' -> ('10000', 'Portal 20 de Julio')"""
    m = re.match(r"\s*\((\w+)\)\s*(.*)", texto or "")
    return (m.group(1), m.group(2).strip()) if m else ("", (texto or "").strip())


def _con_cache(respuesta, segundos):
    # max-age=0: el navegador no guarda copia (siempre pregunta); s-maxage: la cache
    # de Vercel si la guarda, que es la que ahorra descargas a TransMilenio
    respuesta.headers["Cache-Control"] = f"public, max-age=0, s-maxage={segundos}, stale-while-revalidate=86400"
    return respuesta


@app.route("/api/transmilenio/fechas")
def transmilenio_fechas():
    """Fechas con archivo de salidas disponible (las mas recientes primero)."""
    try:
        fechas, token = [], None
        while True:
            params = {"prefix": "Salidas/salidas", "fields": "items(name),nextPageToken", "maxResults": 1000}
            if token:
                params["pageToken"] = token
            datos = req_lib.get(TM_LISTADO, params=params, timeout=20).json()
            for item in datos.get("items", []):
                m = re.search(r"salidas(\d{4})(\d{2})(\d{2})\.zip$", item["name"])
                if m:
                    fechas.append(f"{m.group(1)}-{m.group(2)}-{m.group(3)}")
            token = datos.get("nextPageToken")
            if not token:
                break
        fechas.sort(reverse=True)
        return _con_cache(jsonify({"ok": True, "fechas": fechas}), 6 * 3600)
    except Exception as e:
        return jsonify({"ok": False, "error": f"No se pudo consultar el listado de TransMilenio: {e}"}), 502


@app.route("/api/transmilenio/salidas")
def transmilenio_salidas():
    """Entradas y salidas por estacion y por hora de un dia (?fecha=AAAA-MM-DD)."""
    import csv
    import io
    import zipfile

    fecha = request.args.get("fecha", "").strip()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", fecha):
        return jsonify({"ok": False, "error": "Falta ?fecha=AAAA-MM-DD"}), 400

    url = f"{TM_ALMACEN}/Salidas/salidas{fecha.replace('-', '')}.zip"
    try:
        r = req_lib.get(url, timeout=25)
    except req_lib.exceptions.RequestException as e:
        return jsonify({"ok": False, "error": f"No se pudo descargar el archivo de TransMilenio: {e}"}), 502
    if r.status_code == 404:
        return _con_cache(jsonify({"ok": False, "error": f"TransMilenio no tiene datos para {fecha}"}), 3600), 404
    if r.status_code != 200:
        return jsonify({"ok": False, "error": f"TransMilenio respondio {r.status_code}"}), 502

    estaciones = {}
    por_hora_entradas = [0] * 24
    por_hora_salidas = [0] * 24
    por_franja_salidas = [0] * 96  # cada 15 minutos
    por_franja_entradas = [0] * 96

    with zipfile.ZipFile(io.BytesIO(r.content)) as z:
        nombre = next(n for n in z.namelist() if n.lower().endswith(".csv"))
        with z.open(nombre) as f:
            # el archivo mezcla UTF-8 y Latin-1 segun la fila: se decodifica linea por linea
            def lineas():
                for cruda in f:
                    try:
                        yield cruda.decode("utf-8-sig")
                    except UnicodeDecodeError:
                        yield cruda.decode("latin-1")
            lector = csv.DictReader(lineas())
            for fila in lector:
                try:
                    hh, mm = int(fila["Tiempo"][:2]), int(fila["Tiempo"][3:5])
                    ent = int(fila.get("Entradas_E") or 0)
                    sal = int(fila.get("Salidas_S") or 0)
                except (ValueError, KeyError, TypeError):
                    continue
                if not (ent or sal) or hh > 23:
                    continue
                codigo, nombre_est = _codigo_y_nombre(fila.get("Estacion"))
                est = estaciones.get(codigo)
                if est is None:
                    _, linea = _codigo_y_nombre(fila.get("Linea"))
                    est = estaciones[codigo] = {
                        "codigo": codigo, "nombre": nombre_est, "linea": linea,
                        "entradas": 0, "salidas": 0, "salidas_hora": [0] * 24, "entradas_hora": [0] * 24,
                    }
                est["entradas"] += ent
                est["salidas"] += sal
                est["salidas_hora"][hh] += sal
                est["entradas_hora"][hh] += ent
                por_hora_entradas[hh] += ent
                por_hora_salidas[hh] += sal
                por_franja_salidas[hh * 4 + mm // 15] += sal
                por_franja_entradas[hh * 4 + mm // 15] += ent

    lista = sorted(estaciones.values(), key=lambda e: -e["salidas"])
    return _con_cache(jsonify({
        "ok": True,
        "fecha": fecha,
        "fuente": "TransMilenio S.A. - Salidas del sistema troncal (datos abiertos)",
        "total_entradas": sum(por_hora_entradas),
        "total_salidas": sum(por_hora_salidas),
        "por_hora": {"entradas": por_hora_entradas, "salidas": por_hora_salidas},
        "salidas_cada_15_min": por_franja_salidas,
        "entradas_cada_15_min": por_franja_entradas,
        "estaciones": lista,
    }), 7 * 24 * 3600)  # un dia pasado no cambia: cache de una semana


# =====================================================================
# TRANSMILENIO - COMPARACION DE RUTAS TRONCALES (GTFS, sin guardar nada)
# =====================================================================
# TransMilenio publica cada dia su GTFS (horarios PROGRAMADOS) en un zip de
# ~120 MB. No se descarga entero: se leen solo los archivos pequenos del
# zip (rutas, viajes, calendario) con descargas parciales, y el de horarios
# (stop_times, ~560 MB descomprimido) se recorre en flujo quedandose solo
# con los viajes de las rutas pedidas. Tarda unos segundos y Vercel guarda
# la respuesta en su cache.

GTFS_ALMACEN = "https://storage.googleapis.com/gtfs-estaticos"
GTFS_LISTADO = "https://storage.googleapis.com/storage/v1/b/gtfs-estaticos/o"


class _ZipRemoto:
    """Lee archivos sueltos de un zip publicado en la web con peticiones Range."""

    def __init__(self, url):
        import struct
        self.url = url
        tam = int(req_lib.head(url, timeout=20).headers["Content-Length"])
        cola = self._rango(tam - 65536, tam - 1)
        i = cola.rfind(b"PK\x05\x06")
        _, tam_dir, ini_dir = struct.unpack("<HII", cola[i + 10:i + 20])
        directorio = self._rango(ini_dir, ini_dir + tam_dir - 1)
        self.archivos, p = {}, 0
        while p < len(directorio):
            comp, = struct.unpack("<I", directorio[p + 20:p + 24])
            ln, le, lc = struct.unpack("<HHH", directorio[p + 28:p + 34])
            local, = struct.unpack("<I", directorio[p + 42:p + 46])
            self.archivos[directorio[p + 46:p + 46 + ln].decode()] = (local, comp)
            p += 46 + ln + le + lc

    def _rango(self, a, b, stream=False):
        r = req_lib.get(self.url, headers={"Range": f"bytes={a}-{b}"}, timeout=60, stream=stream)
        r.raise_for_status()
        return r if stream else r.content

    def _datos(self, nombre, stream=False):
        import struct
        local, comp = self.archivos[nombre]
        cab = self._rango(local, local + 29)
        ln, le = struct.unpack("<HH", cab[26:30])
        ini = local + 30 + ln + le
        return self._rango(ini, ini + comp - 1, stream=stream)

    def leer(self, nombre):
        import zlib
        return zlib.decompress(self._datos(nombre), -15).decode("utf-8-sig")

    def lineas(self, nombre):
        """Recorre un archivo grande del zip linea por linea, sin cargarlo entero."""
        import zlib
        d = zlib.decompressobj(-15)
        resto = b""
        for bloque in self._datos(nombre, stream=True).iter_content(1 << 20):
            partes = (resto + d.decompress(bloque)).split(b"\n")
            resto = partes.pop()
            for linea in partes:
                yield linea
        if resto:
            yield resto


def _segundos(hhmmss):
    h, m, s = (int(x) for x in hhmmss.split(":"))
    return h * 3600 + m * 60 + s  # el GTFS usa horas >24 para viajes despues de medianoche


def _palabras(texto):
    """Palabras significativas de un nombre, sin tildes ni abreviaturas de una letra."""
    import unicodedata
    t = unicodedata.normalize("NFD", texto or "").encode("ascii", "ignore").decode().lower()
    return [p for p in re.findall(r"[a-z0-9]+", t) if len(p) > 2 and p not in ("portal", "por", "las", "los", "del")]


def _gtfs_mas_reciente():
    datos = req_lib.get(GTFS_LISTADO, params={"prefix": "GTFS_", "fields": "items(name)", "maxResults": 1000}, timeout=20).json()
    nombres = sorted(i["name"] for i in datos.get("items", []) if re.fullmatch(r"GTFS_\d{8}\.zip", i["name"]))
    return nombres[-1]


@app.route("/api/transmilenio/rutas")
def transmilenio_rutas():
    """Comparacion de rutas troncales (?codigos=H75,B75,H13): viajes, tiempos y velocidad programados."""
    import csv
    import io
    import statistics

    codigos = [c.strip().upper() for c in request.args.get("codigos", "").split(",") if c.strip()][:4]
    if not codigos:
        return jsonify({"ok": False, "error": "Falta ?codigos=H75,B75"}), 400
    # destino de cada ruta segun el servicio del mapa (ayuda a elegir la variante correcta del GTFS)
    destinos = request.args.get("destinos", "").split("|")

    try:
        archivo = _gtfs_mas_reciente()
        z = _ZipRemoto(f"{GTFS_ALMACEN}/{archivo}")

        # rutas troncales (agencia 1). El servicio del mapa y el GTFS no siempre usan
        # el mismo codigo (ej. "G12GS" en el mapa es "G12" hacia G. Santander en el GTFS)
        troncales = [r for r in csv.DictReader(io.StringIO(z.leer("routes.txt"))) if r.get("agency_id") == "1"]
        ruta_a_codigo = {}
        for n, codigo in enumerate(codigos):
            candidatas = [r for r in troncales if r.get("route_short_name", "").upper() == codigo]
            if not candidatas:
                base = re.match(r"[A-Z]+\d+", codigo)
                candidatas = [r for r in troncales if base and r.get("route_short_name", "").upper() == base.group(0)]
            destino = destinos[n] if n < len(destinos) else ""
            if len(candidatas) > 1 and destino:
                # variante cuyo nombre largo se parece mas al destino ("G. Santander" ~ "GENERAL SANTANDER")
                palabras = set(_palabras(destino))
                puntaje = lambda r: len(palabras & set(_palabras(r.get("route_long_name", ""))))
                mejor = max(puntaje(r) for r in candidatas)
                if mejor:
                    candidatas = [r for r in candidatas if puntaje(r) == mejor]
            for r in candidatas:
                ruta_a_codigo.setdefault(r["route_id"], codigo)

        # tipos de dia de cada servicio (uno puede funcionar habil, sabado y domingo a la vez)
        tipo_servicio = {}
        for c in csv.DictReader(io.StringIO(z.leer("calendar.txt"))):
            tipo_servicio[c["service_id"]] = {d for d, col in (("habil", "monday"), ("sabado", "saturday"), ("domingo", "sunday"))
                                              if c.get(col) == "1"}

        viajes = {}
        for t in csv.DictReader(io.StringIO(z.leer("trips.txt"))):
            if t["route_id"] in ruta_a_codigo:
                viajes[t["trip_id"]] = {"codigo": ruta_a_codigo[t["route_id"]],
                                        "dias": tipo_servicio.get(t["service_id"], set()),
                                        "destino": t.get("trip_headsign", ""),
                                        "ini": None, "fin": None, "paradas": 0, "dist": 0.0, "filas": []}

        # horarios: solo las filas de esos viajes
        claves = {k.encode() for k in viajes}
        encabezado = None
        for linea in z.lineas("stop_times.txt"):
            if encabezado is None:
                encabezado = linea.decode("utf-8-sig").strip().split(",")
                i_lle, i_sal, i_dist = (encabezado.index("arrival_time"), encabezado.index("departure_time"),
                                        encabezado.index("shape_dist_traveled"))
                i_seq, i_par = encabezado.index("stop_sequence"), encabezado.index("stop_id")
                continue
            tid = linea.split(b",", 1)[0]
            if tid not in claves:
                continue
            campos = linea.decode().strip().split(",")
            v = viajes[campos[0]]
            sal, lle = _segundos(campos[i_sal]), _segundos(campos[i_lle])
            v["ini"] = sal if v["ini"] is None else min(v["ini"], sal)
            v["fin"] = lle if v["fin"] is None else max(v["fin"], lle)
            v["paradas"] += 1
            try:
                dist = float(campos[i_dist] or 0)
            except ValueError:
                dist = 0.0
            v["dist"] = max(v["dist"], dist)
            v["filas"].append((int(campos[i_seq]), lle, campos[i_par], dist))

        # nombres de las paradas (solo se necesitan para la linea de tiempo)
        nombres_parada = {p["stop_id"]: p["stop_name"] for p in csv.DictReader(io.StringIO(z.leer("stops.txt")))}
    except Exception as e:
        return jsonify({"ok": False, "error": f"No se pudo leer el GTFS de TransMilenio: {e}"}), 502

    def recorrido(del_dia, minuto_objetivo, metros):
        """Linea de tiempo de un bus tipico que sale cerca de una hora dada:
        minutos desde la salida y km recorridos en cada parada."""
        completos = [v for v in del_dia if v["filas"]]
        if not completos:
            return None
        paradas_tipicas = statistics.median(v["paradas"] for v in completos)
        candidatos = [v for v in completos if v["paradas"] >= paradas_tipicas] or completos
        v = min(candidatos, key=lambda x: abs(x["ini"] / 60 - minuto_objetivo))
        factor = 1000 if metros else 1
        return {
            "salida": v["ini"] // 60,
            "paradas": [{"nombre": nombres_parada.get(par, par), "min": round((lle - v["ini"]) / 60, 1),
                         "km": round(dist / factor, 2)}
                        for _, lle, par, dist in sorted(v["filas"])],
        }

    # resumen por ruta y tipo de dia
    resultado = []
    for codigo in codigos:
        propios = [v for v in viajes.values() if v["codigo"] == codigo and v["ini"] is not None and v["fin"] > v["ini"]]
        if not propios:
            resultado.append({"codigo": codigo, "encontrada": False})
            continue
        dias = {}
        for dia in ("habil", "sabado", "domingo"):
            del_dia = [v for v in propios if dia in v["dias"]]
            if not del_dia:
                continue
            duraciones = [(v["fin"] - v["ini"]) / 60 for v in del_dia]
            distancias = [v["dist"] for v in del_dia if v["dist"]]
            por_hora_viajes, por_hora_min = [0] * 24, [None] * 24
            for h in range(24):
                en_hora = [(v["fin"] - v["ini"]) / 60 for v in del_dia if (v["ini"] // 3600) % 24 == h]
                por_hora_viajes[h] = len(en_hora)
                por_hora_min[h] = round(statistics.median(en_hora), 1) if en_hora else None
            dist_km = statistics.median(distancias) if distancias else None
            if dist_km and dist_km > 500:  # algunos GTFS dan la distancia en metros
                dist_km /= 1000
            dur = statistics.median(duraciones)
            dias[dia] = {
                "viajes": len(del_dia),
                "duracion_min": round(dur, 1),
                "duracion_min_rango": [round(min(duraciones), 1), round(max(duraciones), 1)],
                "distancia_km": round(dist_km, 2) if dist_km else None,
                "velocidad_kmh": round(dist_km / (dur / 60), 1) if dist_km and dur else None,
                "paradas": round(statistics.median(v["paradas"] for v in del_dia)),
                "primer_salida": min(v["ini"] for v in del_dia) // 60,
                "ultima_salida": max(v["ini"] for v in del_dia) // 60,
                "viajes_por_hora": por_hora_viajes,
                "minutos_por_hora": por_hora_min,
                # bus de media manana (~11:00) y de hora pico de la tarde (~17:30)
                "recorrido": {
                    "valle": recorrido(del_dia, 11 * 60, max(distancias or [0]) > 500),
                    "pico": recorrido(del_dia, 17 * 60 + 30, max(distancias or [0]) > 500),
                },
            }
        resultado.append({"codigo": codigo, "encontrada": True,
                          "destino": propios[0]["destino"], "dias": dias})

    return _con_cache(jsonify({
        "ok": True,
        "fuente": f"TransMilenio S.A. - GTFS {archivo} (horarios programados)",
        "gtfs": archivo,
        "rutas": resultado,
    }), 24 * 3600)


# =====================================================================
# TRANSMILENIO - BUSES DEL SITP ZONAL (validaciones del dia, sin guardar nada)
# =====================================================================
# Cada pasaje pagado en un bus zonal trae: ID del vehiculo, ruta, paradero y
# hora. Con eso se reconstruye el recorrido de cada bus (puntos en los
# paraderos donde subio gente) y, cruzando con el archivo de flota, su placa.
# El archivo del dia (~120 MB comprimido) se recorre en flujo; Vercel cachea.

def _texto(b):
    try:
        return b.decode("utf-8")
    except UnicodeDecodeError:
        return b.decode("latin-1")


def _paradero(texto):
    """'(54191) 507A12_TM|507A12_Br. Marichuela' -> ('507A12', 'Br. Marichuela')"""
    m = re.match(r"\s*\(\d+\)\s*([^_|]+)[^|]*\|?(?:[^_]*_)?(.*)", texto or "")
    return (m.group(1).strip(), m.group(2).strip()) if m else ("", texto or "")


def _ruta(texto):
    """'(10160) 3-9 Marichuela' -> ('10160', '3-9 Marichuela')"""
    m = re.match(r"\s*\((\w+)\)\s*(.*)", texto or "")
    return (m.group(1), m.group(2).strip()) if m else (texto or "", texto or "")


def _validaciones_zonales(fecha):
    """Recorre las validaciones zonales de un dia. Devuelve (encabezado, generador de columnas)."""
    url = f"{TM_ALMACEN}/ValidacionZonal/validacionZonal{fecha.replace('-', '')}.zip"
    z = _ZipRemoto(url)
    nombre = next(n for n in z.archivos if n.lower().endswith(".csv"))
    lineas = z.lineas(nombre)
    encabezado = next(lineas).decode("utf-8-sig").strip().split(",")
    return encabezado, (l.rstrip(b"\r").split(b",") for l in lineas)


def _flota():
    """Archivo de flota mas reciente: numero del bus (sin letras) -> datos del bus."""
    import csv
    import io
    datos = req_lib.get(TM_LISTADO, params={"prefix": "FlotaVinculada/flota_vinculada_", "fields": "items(name)",
                                            "maxResults": 1000}, timeout=20).json()
    nombres = sorted(i["name"] for i in datos.get("items", []) if i["name"].endswith(".csv"))
    if not nombres:
        return {}
    texto = req_lib.get(f"{TM_ALMACEN}/{nombres[-1]}", timeout=30).content.decode("utf-8", "replace")
    flota = {}
    for f in csv.DictReader(io.StringIO(texto)):
        clave = re.sub(r"\D", "", f.get("codigo_bus", "")).lstrip("0")
        if clave:
            flota[clave] = {"bus": f.get("codigo_bus"), "placa": f.get("matricula"), "tipo": f.get("descripcion_tipo"),
                            "combustible": f.get("combustible"), "modelo": f.get("modelo"),
                            "operador": f.get("concesionario_operacion"), "componente": f.get("componente")}
    return flota


@app.route("/api/transmilenio/sitp/indice")
def transmilenio_sitp_indice():
    """Rutas y buses zonales de un dia (?fecha=AAAA-MM-DD), con placa y horas de servicio."""
    fecha = request.args.get("fecha", "").strip()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", fecha):
        return jsonify({"ok": False, "error": "Falta ?fecha=AAAA-MM-DD"}), 400
    try:
        enc, filas = _validaciones_zonales(fecha)
    except Exception:
        return _con_cache(jsonify({"ok": False, "error": f"TransMilenio no tiene validaciones zonales para {fecha}"}), 3600), 404
    i_v, i_l, i_t, i_p = (enc.index("ID_Vehiculo"), enc.index("Linea"),
                          enc.index("Fecha_Transaccion"), enc.index("Estacion_Parada"))
    rutas, buses = {}, {}
    try:
        for c in filas:
            if len(c) < len(enc) or not c[i_v]:
                continue
            ruta, hora, par = c[i_l], c[i_t][11:19], c[i_p]
            r = rutas.get(ruta)
            if r is None:
                r = rutas[ruta] = {"validaciones": 0, "buses": set(), "paraderos": set()}
            r["validaciones"] += 1
            r["buses"].add(c[i_v])
            r["paraderos"].add(par)
            b = buses.get(c[i_v])
            if b is None:
                b = buses[c[i_v]] = {"ini": hora, "fin": hora, "n": 0, "rutas": set()}
            b["ini"] = min(b["ini"], hora)
            b["fin"] = max(b["fin"], hora)
            b["n"] += 1
            b["rutas"].add(ruta)
    except Exception as e:
        return jsonify({"ok": False, "error": f"No se pudo leer el archivo de TransMilenio: {e}"}), 502

    flota = _flota()
    salida_rutas = []
    for clave, r in rutas.items():
        rid, nombre = _ruta(_texto(clave))
        salida_rutas.append({"id": rid, "nombre": nombre, "validaciones": r["validaciones"], "buses": len(r["buses"]),
                             "paraderos": sorted({_paradero(_texto(p))[0] for p in r["paraderos"]})})
    salida_buses = []
    for vid, b in buses.items():
        vid = _texto(vid)
        f = flota.get(vid.lstrip("0"), {})
        salida_buses.append({"id": vid, "placa": f.get("placa"), "bus": f.get("bus"), "tipo": f.get("tipo"),
                             "combustible": f.get("combustible"), "modelo": f.get("modelo"),
                             "operador": f.get("operador"), "ini": _texto(b["ini"]), "fin": _texto(b["fin"]),
                             "validaciones": b["n"], "rutas": sorted(_ruta(_texto(r))[0] for r in b["rutas"])})
    salida_rutas.sort(key=lambda r: -r["validaciones"])
    return _con_cache(jsonify({"ok": True, "fecha": fecha,
                               "fuente": "TransMilenio S.A. - Validaciones del SITP zonal y flota vinculada (datos abiertos)",
                               "rutas": salida_rutas, "buses": salida_buses}), 7 * 24 * 3600)


@app.route("/api/transmilenio/sitp/ruta")
def transmilenio_sitp_ruta():
    """Recorrido de cada bus de una ruta zonal en un dia (?fecha=AAAA-MM-DD&ruta=10160):
    paraderos donde subio gente, con hora y numero de pasajes."""
    fecha = request.args.get("fecha", "").strip()
    ruta = request.args.get("ruta", "").strip()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", fecha) or not re.fullmatch(r"\w+", ruta):
        return jsonify({"ok": False, "error": "Falta ?fecha=AAAA-MM-DD&ruta=ID"}), 400
    try:
        enc, filas = _validaciones_zonales(fecha)
    except Exception:
        return _con_cache(jsonify({"ok": False, "error": f"TransMilenio no tiene validaciones zonales para {fecha}"}), 3600), 404
    i_v, i_l, i_t, i_p = (enc.index("ID_Vehiculo"), enc.index("Linea"),
                          enc.index("Fecha_Transaccion"), enc.index("Estacion_Parada"))
    prefijo = f"({ruta})".encode()
    por_bus = {}
    nombre_ruta = ruta
    try:
        for c in filas:
            if len(c) < len(enc) or not c[i_l].startswith(prefijo):
                continue
            nombre_ruta = _ruta(_texto(c[i_l]))[1]
            por_bus.setdefault(_texto(c[i_v]), []).append((_texto(c[i_t][11:19]), _texto(c[i_p])))
    except Exception as e:
        return jsonify({"ok": False, "error": f"No se pudo leer el archivo de TransMilenio: {e}"}), 502

    buses = {}
    for vid, regs in por_bus.items():
        regs.sort()
        paradas = []   # visitas: pasajes seguidos en el mismo paradero se juntan
        for hora, par in regs:
            cod, nombre = _paradero(par)
            if paradas and paradas[-1]["cod"] == cod:
                paradas[-1]["fin"] = hora
                paradas[-1]["n"] += 1
            else:
                paradas.append({"cod": cod, "nombre": nombre, "ini": hora, "fin": hora, "n": 1})
        buses[vid] = paradas
    return _con_cache(jsonify({"ok": True, "fecha": fecha, "ruta": ruta, "nombre": nombre_ruta, "buses": buses}),
                      7 * 24 * 3600)


@app.route("/api/transmilenio/sitp/trazado")
def transmilenio_sitp_trazado():
    """Trazado oficial por las calles de una ruta zonal (?codigo=BH907), tomado del GTFS
    (shapes.txt). Devuelve las variantes mas usadas (normalmente ida y vuelta)."""
    import csv
    import io
    from collections import Counter

    codigo = request.args.get("codigo", "").strip().upper()
    if not re.fullmatch(r"[\w\-\.]+", codigo):
        return jsonify({"ok": False, "error": "Falta ?codigo=BH907"}), 400
    try:
        archivo = _gtfs_mas_reciente()
        z = _ZipRemoto(f"{GTFS_ALMACEN}/{archivo}")
        zonales = [r for r in csv.DictReader(io.StringIO(z.leer("routes.txt"))) if r.get("agency_id") != "1"]
        rutas = [r for r in zonales if r.get("route_short_name", "").upper() == codigo]
        partida = re.fullmatch(r"([A-Z])([A-Z])(\d+\w*)", codigo)
        if not rutas and partida:
            # "BH907" en el GTFS esta partida por sentido: "B907" (hacia zona B) y "H907" (hacia zona H)
            sentidos = {partida.group(1) + partida.group(3), partida.group(2) + partida.group(3)}
            rutas = [r for r in zonales if r.get("route_short_name", "").upper() in sentidos]
        normales = [r for r in rutas if "ciclov" not in r.get("route_long_name", "").lower()]
        ids = {r["route_id"] for r in (normales or rutas)}
        if not ids:
            return _con_cache(jsonify({"ok": False, "error": f"La ruta {codigo} no esta en el GTFS"}), 86400), 404

        viajes_gtfs = [t for t in csv.DictReader(io.StringIO(z.leer("trips.txt")))
                       if t["route_id"] in ids and t.get("shape_id")]
        usos = Counter(t["shape_id"] for t in viajes_gtfs)
        # hacia donde va cada trazado: nombre largo de su ruta (en las partidas por sentido es el destino)
        nombre_ruta = {r["route_id"]: r.get("route_long_name", "") for r in rutas}
        ruta_de_trazado = {}
        for t in viajes_gtfs:
            ruta_de_trazado.setdefault(t["shape_id"], Counter())[t["route_id"]] += 1
        elegidos = [s for s, _ in usos.most_common(4)]
        puntos = {s: [] for s in elegidos}
        claves = {s.encode() + b"," for s in elegidos}
        lineas = z.lineas("shapes.txt")
        enc = next(lineas).decode("utf-8-sig").strip().split(",")
        i_s, i_la, i_lo, i_q = (enc.index("shape_id"), enc.index("shape_pt_lat"),
                                enc.index("shape_pt_lon"), enc.index("shape_pt_sequence"))
        for l in lineas:
            if not any(l.startswith(k) for k in claves):
                continue
            c = l.rstrip(b"\r").decode().split(",")
            puntos[c[i_s]].append((int(c[i_q]), round(float(c[i_lo]), 5), round(float(c[i_la]), 5)))
    except Exception as e:
        return jsonify({"ok": False, "error": f"No se pudo leer el GTFS: {e}"}), 502

    trazados = []
    for s in elegidos:
        pts = [[lo, la] for _, lo, la in sorted(puntos[s])]
        limpios = [p for i, p in enumerate(pts) if i == 0 or p != pts[i - 1]]
        if len(limpios) > 1:
            rid = ruta_de_trazado[s].most_common(1)[0][0]
            trazados.append({"id": s, "viajes": usos[s], "nombre": nombre_ruta.get(rid, ""), "coords": limpios})
    return _con_cache(jsonify({"ok": True, "codigo": codigo, "gtfs": archivo,
                               "nombre": " / ".join(sorted({r.get("route_long_name", "") for r in (normales or rutas)})),
                               "trazados": trazados}), 7 * 24 * 3600)


@app.route("/api/status")
def status():
    return jsonify({"ok": True, "mensaje": "API GeoDB Andes activa (Vercel + Supabase)"})
