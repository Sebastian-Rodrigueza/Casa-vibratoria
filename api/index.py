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
GEMINI_MODEL = "gemini-flash-latest"
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

    try:
        respuesta = req_lib.post(
            GEMINI_URL,
            headers={"Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY},
            json={"contents": [{"parts": [{"text": prompt}]}]},
            timeout=30,
        )
        respuesta.raise_for_status()
        cuerpo = respuesta.json()
    except req_lib.exceptions.RequestException as e:
        return jsonify({"ok": False, "error": f"No fue posible conectar con Gemini: {str(e)}"}), 502
    except ValueError:
        return jsonify({"ok": False, "error": "Gemini no devolvio un JSON valido"}), 502

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


@app.route("/api/status")
def status():
    return jsonify({"ok": True, "mensaje": "API GeoDB Andes activa (Vercel + Supabase)"})
