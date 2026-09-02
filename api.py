import json
import os
import re
import socket
import subprocess
import time
from datetime import datetime

from flask import Flask, jsonify, request
from flask_cors import CORS
import mysql.connector
import requests as req_lib
import urllib3.util.connection as urllib3_cn
from apscheduler.schedulers.background import BackgroundScheduler

# =====================================================================
# FORZAR IPv4 EN LAS PETICIONES SALIENTES (requests/urllib3)
# -----------------------------------------------------------------
# En algunas redes (sobre todo corporativas) el IPv6 esta bloqueado en
# silencio: no da error, simplemente nunca responde. curl.exe moderno
# prueba IPv4 e IPv6 al mismo tiempo y usa el que conteste primero
# ("Happy Eyeballs"), pero la libreria requests/urllib3 no hace eso por
# defecto: si el DNS devuelve IPv6 primero y esa ruta esta bloqueada,
# se queda esperando ahi hasta agotar el timeout, aunque IPv4 funcione
# perfecto (esto explica por que curl.exe conecta rapido con Gemini
# pero requests, dentro de este mismo archivo, se cuelga).
#
# Esto obliga a TODAS las conexiones salientes hechas con requests
# (incluida la llamada a Gemini) a usar unicamente IPv4.
# =====================================================================


def _forzar_ipv4(*args, **kwargs):
    return socket.AF_INET


urllib3_cn.allowed_gai_family = _forzar_ipv4

app = Flask(__name__)
CORS(app)

# =====================================================================
# IP DE LA PC DEL LABORATORIO
# -----------------------------------------------------------------
# Esta es la UNICA linea que hay que editar cuando la PC del
# laboratorio cambie de IP (se reinicie, se reconecte a la red, etc).
# No hay que tocar nada mas en este archivo, ni el script del
# laboratorio, ni la pagina web.
#
# Para saber la IP actual: en la PC del laboratorio, correr
# "ipconfig" y ver "Direccion IPv4" del adaptador Wi-Fi activo.
# =====================================================================
IP_LABORATORIO = "157.253.210.156"


# =====================================================================
# CREDENCIALES DE LA BASE DE DATOS
# -----------------------------------------------------------------
# Se leen de variables de entorno (DB_HOST, DB_PORT, DB_USER, DB_PASSWORD,
# DB_NAME) para no dejar la contraseña escrita en el codigo (esto importa
# sobre todo si el proyecto se sube a GitHub, que es publico). Si no
# existe la variable de entorno, se usa el valor de siempre (localhost),
# para que en tu PC siga funcionando igual sin configurar nada.
#
# En Render.com (o donde despliegues api.py) se configuran estas mismas
# variables con los datos de la base de datos en la nube.
# =====================================================================
def conectar():
    return mysql.connector.connect(
        host=os.environ.get("DB_HOST", "localhost"),
        port=int(os.environ.get("DB_PORT", "3306")),
        user=os.environ.get("DB_USER", "root"),
        password=os.environ.get("DB_PASSWORD", "Andes2026*"),
        database=os.environ.get("DB_NAME", "geodbandes")
    )


ARCGIS_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0 Safari/537.36"
    )
}


# =====================================================================
# LABVIEW - SENSORES (agregado)
# =====================================================================

URL_API_LABVIEW = f"http://{IP_LABORATORIO}:5000/api/sensores"

# Guardamos en memoria cual fue el ultimo dato guardado, para saber
# si el ensayo avanzo (dato nuevo) o esta detenido (mismo dato repetido).
_ultimo_guardado = {
    "archivo": None,
    "x_value": None,
}


def guardar_lectura_labview():
    """
    Se ejecuta automaticamente cada 5 segundos (ver scheduler mas abajo).
    Consulta la API de la PC del laboratorio, y SOLO guarda en la base
    de datos si el ensayo avanzo (si x_value cambio respecto al ultimo
    guardado). Si el archivo no cambia o el ensayo esta detenido, no
    hace nada (para no llenar la tabla de datos repetidos).
    """
    try:
        respuesta = req_lib.get(URL_API_LABVIEW, timeout=5)
        respuesta.raise_for_status()
        data = respuesta.json()
    except req_lib.exceptions.RequestException:
        # La PC del laboratorio esta apagada, sin red, o el script
        # de alla no esta corriendo. No hacemos nada, se reintenta
        # automaticamente en el proximo ciclo (5 segundos despues).
        return
    except ValueError:
        return

    archivo = data.get("archivo")
    ultima_lectura = data.get("ultima_lectura", {})
    x_value = ultima_lectura.get("X_Value")

    if archivo is None or x_value is None:
        return

    # Si es exactamente el mismo archivo Y el mismo x_value que la
    # ultima vez que guardamos, el ensayo no ha avanzado -> no guardar.
    if archivo == _ultimo_guardado["archivo"] and x_value == _ultimo_guardado["x_value"]:
        return

    # Hay un dato nuevo: lo guardamos en la base de datos.
    try:
        conn = conectar()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO lecturas_labview (archivo, x_value, datos)
            VALUES (%s, %s, %s)
            """,
            (archivo, x_value, json.dumps(ultima_lectura))
        )
        conn.commit()
        cursor.close()
        conn.close()

        _ultimo_guardado["archivo"] = archivo
        _ultimo_guardado["x_value"] = x_value

        print(f"[{datetime.now()}] Guardado: {archivo} - x_value={x_value}")
    except Exception as e:
        print(f"[{datetime.now()}] Error guardando lectura LabVIEW: {e}")


URL_API_LABVIEW_COMPLETO = f"http://{IP_LABORATORIO}:5000/api/sensores/completo"
URL_API_LABVIEW_ARCHIVOS = f"http://{IP_LABORATORIO}:5000/api/sensores/archivos"


@app.route("/api/labview/archivos_disponibles")
def labview_archivos_disponibles():
    """
    Lista TODOS los archivos .lvm que hay AHORA MISMO en la carpeta del
    laboratorio (esten o no ya importados a la base de datos). Esto es
    distinto de /api/labview/archivos (que solo lista lo que YA se
    guardo en la base de datos): esta ruta sirve para poder ver y elegir
    pruebas viejas que nunca se siguieron en vivo.
    """
    try:
        respuesta = req_lib.get(URL_API_LABVIEW_ARCHIVOS, timeout=10)
        respuesta.raise_for_status()
        return jsonify(respuesta.json())
    except req_lib.exceptions.RequestException as e:
        return jsonify({
            "error": f"No fue posible conectar con la PC del laboratorio: {str(e)}"
        }), 502
    except ValueError:
        return jsonify({"error": "El laboratorio no devolvio un JSON valido"}), 502


@app.route("/api/labview/importar", methods=["GET", "POST"])
def labview_importar():
    """
    Trae el ULTIMO ensayo completo (o el pedazo de prueba que la PC del
    laboratorio este devolviendo, por ejemplo 1000 filas) y lo guarda
    TODO en la base de datos, fila por fila.

    Se puede llamar simplemente abriendo esta direccion en el navegador:
      http://127.0.0.1:5000/api/labview/importar

    Si ya existian filas guardadas de ese mismo archivo, las borra antes
    de volver a importar, para que puedas repetir la prueba las veces
    que quieras sin ir acumulando datos duplicados.

    Por defecto importa el archivo MAS RECIENTE del laboratorio. Si se
    quiere importar uno especifico (por ejemplo, una prueba vieja que
    nunca se siguio en vivo), se puede pasar su nombre exacto:
      /api/labview/importar?archivo=2021-06-02-Estrenar_vivienda_M6.lvm
    """
    archivo_pedido = request.args.get("archivo", "").strip()

    # limite=0 le dice al script del laboratorio que NO recorte el
    # archivo (su valor por defecto es 1000 filas, pensado solo para
    # pruebas); para el ensayo real necesitamos todas las filas.
    parametros = {"limite": 0}
    if archivo_pedido:
        parametros["archivo"] = archivo_pedido

    try:
        respuesta = req_lib.get(URL_API_LABVIEW_COMPLETO, params=parametros, timeout=120)
        respuesta.raise_for_status()
        data = respuesta.json()
    except req_lib.exceptions.RequestException as e:
        return jsonify({
            "ok": False,
            "error": f"No fue posible conectar con la PC del laboratorio: {str(e)}"
        }), 502
    except ValueError:
        return jsonify({"ok": False, "error": "El laboratorio no devolvio un JSON valido"}), 502

    archivo = data.get("archivo")
    columnas = data.get("columnas")
    filas = data.get("filas")

    if not archivo or not columnas or filas is None:
        return jsonify({
            "ok": False,
            "error": "La respuesta del laboratorio no tiene el formato esperado"
        }), 502

    if "X_Value" not in columnas:
        return jsonify({
            "ok": False,
            "error": "No se encontro la columna X_Value en los datos del laboratorio"
        }), 502

    idx_x_value = columnas.index("X_Value")

    conn = conectar()
    cursor = conn.cursor()

    # Borramos lo que ya existiera de este mismo archivo, para poder
    # repetir la prueba sin ir duplicando filas cada vez que se llama.
    cursor.execute("DELETE FROM lecturas_labview WHERE archivo = %s", (archivo,))

    insertados = 0
    for fila in filas:
        x_value = fila[idx_x_value]
        datos_fila = dict(zip(columnas, fila))
        cursor.execute(
            """
            INSERT INTO lecturas_labview (archivo, x_value, datos)
            VALUES (%s, %s, %s)
            """,
            (archivo, x_value, json.dumps(datos_fila))
        )
        insertados += 1

    conn.commit()
    cursor.close()
    conn.close()

    return jsonify({
        "ok": True,
        "archivo": archivo,
        "filas_importadas": insertados
    })


@app.route("/api/labview/actual")
def labview_actual():
    """
    Devuelve la lectura MAS RECIENTE directamente desde la PC del
    laboratorio (en vivo, sin pasar por la base de datos). Tu pagina
    web consulta esta ruta cada pocos segundos para mostrar el valor
    actual de cada sensor.
    """
    try:
        respuesta = req_lib.get(URL_API_LABVIEW, timeout=5)
        respuesta.raise_for_status()
        return jsonify(respuesta.json())
    except req_lib.exceptions.RequestException as e:
        return jsonify({
            "error": f"No fue posible conectar con la PC del laboratorio: {str(e)}"
        }), 502
    except ValueError:
        return jsonify({"error": "El laboratorio no devolvio un JSON valido"}), 502


@app.route("/api/labview/historico")
def labview_historico():
    """
    Devuelve el historico de lecturas guardadas en la base de datos,
    para graficar la evolucion de los sensores a lo largo del ensayo.

    Parametros opcionales en la URL:
      - archivo: filtra solo las lecturas de un archivo .lvm especifico
      - limite: cuantas filas devolver como maximo (por defecto 500)

    Ejemplo de uso:
      /api/labview/historico?archivo=2021-08-04-Estrenar_vivienda_M1_E13.lvm&limite=200
    """
    archivo_filtro = request.args.get("archivo", "").strip()
    limite = request.args.get("limite", "500")

    try:
        limite = int(limite)
    except ValueError:
        limite = 500

    # Tope de seguridad: sin importar lo que pida el navegador, nunca se
    # devuelven mas de 100000 filas de un tiron (protege la memoria del
    # servidor, sobre todo en el plan gratis de Render).
    limite = max(1, min(limite, 100000))

    conn = conectar()
    cursor = conn.cursor(dictionary=True)

    if archivo_filtro:
        # "ORDER BY id ASC LIMIT %s" directo siempre trae las PRIMERAS
        # filas del ensayo (nunca cambia aunque entren datos nuevos, una
        # vez el ensayo supera el limite). Para poder seguir un ensayo
        # en vivo hay que traer las ULTIMAS filas, y solo despues
        # ordenarlas cronologicamente para graficarlas bien.
        cursor.execute(
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
        cursor.execute(
            """
            SELECT id, fecha_hora, archivo, x_value, datos
            FROM lecturas_labview
            ORDER BY id DESC
            LIMIT %s
            """,
            (limite,)
        )

    filas = cursor.fetchall()
    cursor.close()
    conn.close()

    # OJO: antes esto hacia json.loads() sobre el texto de "datos" para
    # convertirlo a diccionario de Python, y despues jsonify() lo volvia
    # a convertir a texto JSON. En ensayos grandes (decenas de miles de
    # filas, cada una con ~40 sensores) ese ida-y-vuelta multiplicaba
    # muchisimo la memoria usada (cada numero pasa a ser un objeto de
    # Python con su propio overhead), suficiente para tumbar el servidor
    # gratis de Render (512 MB de RAM) con un solo ensayo grande.
    #
    # Como "datos" ya es JSON valido tal como sale de MySQL, lo insertamos
    # tal cual (como texto crudo) directo en la respuesta, sin pasar por
    # diccionarios de Python. Mismo resultado para quien lo consume, pero
    # usando una fraccion de la memoria.
    partes = []
    for fila in filas:
        fecha_hora = fila["fecha_hora"].isoformat() if fila.get("fecha_hora") is not None else None
        datos_crudo = fila.get("datos") or "null"
        partes.append(
            '{"id":%s,"fecha_hora":%s,"archivo":%s,"x_value":%s,"datos":%s}' % (
                json.dumps(fila["id"]),
                json.dumps(fecha_hora),
                json.dumps(fila["archivo"]),
                json.dumps(fila["x_value"]),
                datos_crudo
            )
        )
    cuerpo = "[" + ",".join(partes) + "]"
    return app.response_class(response=cuerpo, mimetype="application/json")


@app.route("/api/labview/archivos")
def labview_archivos():
    """
    Lista todos los ensayos (archivos .lvm) que hay guardados en la base
    de datos, agrupados por nombre de archivo, con la cantidad de filas
    guardadas y la fecha de la primera y ultima lectura de cada uno.

    Se usa para llenar el selector de "ensayo" en el dashboard, en vez de
    asumir que el mas reciente por ID es siempre el que se quiere ver
    (a veces se importan pruebas viejas despues, y quedarian de "ultimas").

    Ordenado del ensayo mas reciente (por fecha de la ultima lectura) al
    mas antiguo.
    """
    conn = conectar()
    cursor = conn.cursor(dictionary=True)
    cursor.execute(
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
    resultados = cursor.fetchall()
    cursor.close()
    conn.close()

    for fila in resultados:
        if fila.get("primera_lectura") is not None:
            fila["primera_lectura"] = fila["primera_lectura"].isoformat()
        if fila.get("ultima_lectura") is not None:
            fila["ultima_lectura"] = fila["ultima_lectura"].isoformat()

    return jsonify(resultados)


# =====================================================================
# TUS RUTAS ORIGINALES (sin ningun cambio)
# =====================================================================

@app.route("/api/datasets")
def obtener_datasets():

    categoria_nombre = request.args.get("categoria", "").strip()

    conn = conectar()
    cursor = conn.cursor(dictionary=True)

    cursor.execute("""
        SELECT
            d.id,
            d.nombre_dataset,
            d.entidad_responsable,
            d.descripcion,
            d.formato,
            d.url_fuente,
            d.url_descarga,
            d.arcgis_id
        FROM datasets d
        JOIN categorias c
            ON d.categoria_id = c.id
        WHERE c.nombre LIKE %s
    """, (f"%{categoria_nombre}%",))

    resultados = cursor.fetchall()

    cursor.close()
    conn.close()

    return jsonify(resultados)


@app.route("/api/datasets/<int:dataset_id>")
def obtener_dataset(dataset_id):

    conn = conectar()
    cursor = conn.cursor(dictionary=True)

    cursor.execute("""
        SELECT
            d.id,
            d.nombre_dataset,
            d.entidad_responsable,
            d.descripcion,
            d.formato,
            d.url_fuente,
            d.url_descarga,
            d.arcgis_id,
            c.id AS categoria_id,
            c.nombre AS categoria
        FROM datasets d
        JOIN categorias c
            ON d.categoria_id = c.id
        WHERE d.id = %s
        LIMIT 1
    """, (dataset_id,))

    dataset = cursor.fetchone()

    cursor.close()
    conn.close()

    if not dataset:
        return jsonify({
            "ok": False,
            "error": "Dataset no encontrado"
        }), 404

    return jsonify(dataset)


@app.route("/api/categorias")
def obtener_categorias():

    conn = conectar()
    cursor = conn.cursor(dictionary=True)

    cursor.execute("""
        SELECT id, nombre
        FROM categorias
        ORDER BY id
    """)

    resultados = cursor.fetchall()

    cursor.close()
    conn.close()

    return jsonify(resultados)


@app.route("/api/arcgis-proxy", methods=["GET", "POST"])
def arcgis_proxy():
    """
    Intermediario genérico entre el navegador y CUALQUIER servicio ArcGIS
    (metadata ?f=json, returnIdsOnly, query final con geojson, etc.)

    Muchos servidores ArcGIS de entidades (no los de la nube de Esri)
    no tienen CORS habilitado, así que el navegador no puede consultarlos
    directamente. Este endpoint hace la peticion desde el servidor
    (sin restriccion CORS) y devuelve el resultado tal cual.

    Soporta GET (consultas cortas) y POST (consultas largas, por
    ejemplo con muchos objectIds, que no caben en una URL de GET
    sin superar el limite de longitud de la mayoria de servidores).

    Uso GET:
    /api/arcgis-proxy?url=<url_base_sin_query>&where=1=1&f=geojson

    Uso POST:
    /api/arcgis-proxy?url=<url_base_sin_query>
    body (application/x-www-form-urlencoded): where=1=1&f=geojson&objectIds=...
    """
    destino = request.args.get("url", "").strip()

    if not destino:
        return jsonify({"error": "Falta el parametro url"}), 400

    try:
        if request.method == "POST":
            # Los parametros largos (como objectIds) van en el body,
            # no en la URL, para evitar el limite de longitud de URL.
            params = {
                k: v for k, v in request.form.items() if k != "url"
            }

            respuesta = req_lib.post(
                destino,
                data=params,
                headers=ARCGIS_HEADERS,
                timeout=30
            )
        else:
            params = {
                k: v for k, v in request.args.items() if k != "url"
            }

            respuesta = req_lib.get(
                destino,
                params=params,
                headers=ARCGIS_HEADERS,
                timeout=30
            )

        respuesta.raise_for_status()
        return jsonify(respuesta.json())

    except req_lib.exceptions.SSLError as e:
        return jsonify({
            "error": f"Error de certificado SSL en el servidor ArcGIS: {str(e)}"
        }), 502

    except req_lib.exceptions.Timeout:
        return jsonify({
            "error": "El servidor ArcGIS tardo demasiado en responder (timeout)."
        }), 502

    except req_lib.exceptions.ConnectionError as e:
        return jsonify({
            "error": f"No fue posible conectar con el servidor ArcGIS: {str(e)}"
        }), 502

    except req_lib.exceptions.HTTPError as e:
        return jsonify({
            "error": f"El servidor ArcGIS respondio con error HTTP: {str(e)}"
        }), 502

    except req_lib.exceptions.RequestException as e:
        return jsonify({
            "error": f"No fue posible consultar ArcGIS: {str(e)}"
        }), 502

    except ValueError:
        return jsonify({
            "error": "ArcGIS no devolvio un JSON valido"
        }), 502


@app.route("/api/proxy-geojson")
def proxy_geojson():
    """
    Atajo simple: dado solo el servicio base (.../FeatureServer/0),
    hace directamente la consulta '?where=1=1&outFields=*&f=geojson'
    a traves del servidor. Util para cargas rapidas de una sola capa
    sin muchos objectIds. Para flujos que necesitan varias llamadas
    (metadata, IDs, etc.) o consultas largas usa /api/arcgis-proxy.
    """
    servicio_url = request.args.get("url", "").strip()

    if not servicio_url:
        return jsonify({"error": "Falta el parametro url"}), 400

    try:
        query_url = f"{servicio_url.rstrip('/')}/query"
        params = {
            "where": "1=1",
            "outFields": "*",
            "f": "geojson"
        }

        respuesta = req_lib.get(
            query_url,
            params=params,
            headers=ARCGIS_HEADERS,
            timeout=30
        )
        respuesta.raise_for_status()

        return jsonify(respuesta.json())

    except req_lib.exceptions.SSLError as e:
        return jsonify({
            "error": f"Error de certificado SSL en el servidor ArcGIS: {str(e)}"
        }), 502
    except req_lib.exceptions.Timeout:
        return jsonify({
            "error": "El servidor ArcGIS tardo demasiado en responder (timeout)."
        }), 502
    except req_lib.exceptions.RequestException as e:
        return jsonify({
            "error": f"No fue posible consultar el servicio: {str(e)}"
        }), 502
    except ValueError:
        return jsonify({
            "error": "El servicio no devolvio un JSON valido"
        }), 502


# =====================================================================
# AGENTE ICDE - ASISTENTE DEL CATALOGO (agregado)
# -----------------------------------------------------------------
# La clave de Gemini NUNCA se escribe en este archivo en texto plano.
# Se lee de una variable de entorno para que no quede expuesta si el
# archivo se comparte o se sube a algun repositorio.
#
# Para configurarla en Windows (PowerShell), antes de iniciar la API:
#   $env:GEMINI_API_KEY = "tu-clave-aqui"
#   python api.py
#
# La clave se consigue gratis en https://aistudio.google.com
# =====================================================================

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = "gemini-flash-latest"
GEMINI_URL = (
    f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
)


def llamar_gemini(prompt, intentos=3, timeout_por_intento=30):
    """
    Llama a Gemini usando curl.exe en vez de la libreria 'requests'.

    En esta red, el servidor de Gemini pide una renegociacion TLS a
    mitad del handshake ("schannel: remote party requests
    renegotiation"). El curl.exe de Windows la maneja bien porque usa
    el motor TLS nativo de Windows (schannel), pero la libreria
    'requests' (que usa OpenSSL por debajo) se queda colgada esperando
    esa renegociacion en esta red especifica -- por eso curl.exe
    siempre conecta al instante y 'requests' nunca lo logra, sin
    importar IPv4 forzado ni reintentos.

    En vez de pelear con eso, se usa el mismo curl.exe que ya demostro
    ser confiable en esta maquina.

    Devuelve el JSON de la respuesta de Gemini ya parseado (un dict).
    """
    cuerpo_peticion = json.dumps({"contents": [{"parts": [{"text": prompt}]}]})
    ultimo_error = None

    for intento in range(1, intentos + 1):
        try:
            resultado = subprocess.run(
                [
                    "curl", "-s", "-S",
                    "--max-time", str(timeout_por_intento),
                    "-X", "POST", GEMINI_URL,
                    "-H", "Content-Type: application/json",
                    "-H", f"x-goog-api-key: {GEMINI_API_KEY}",
                    "-d", cuerpo_peticion
                ],
                capture_output=True,
                text=True,
                timeout=timeout_por_intento + 10,
                check=False
            )

            if resultado.returncode != 0:
                raise RuntimeError(
                    f"curl termino con codigo {resultado.returncode}: "
                    f"{resultado.stderr.strip() or 'sin detalle'}"
                )

            if not resultado.stdout.strip():
                raise RuntimeError("curl no devolvio ninguna respuesta.")

            datos = json.loads(resultado.stdout)

            if isinstance(datos, dict) and "error" in datos:
                mensaje_error = datos["error"].get("message", "Gemini devolvio un error.")
                raise RuntimeError(mensaje_error)

            return datos

        except Exception as e:
            ultimo_error = e
            print(f"[agente-icde] Intento {intento}/{intentos} fallo: {e}")

            if intento < intentos:
                time.sleep(1.5)

    raise ultimo_error


def buscar_datasets_relacionados(mensaje, limite=40):
    """
    Filtra el catalogo de datasets por las palabras clave del mensaje
    del usuario (nombre, descripcion, entidad responsable y categoria).

    Si ninguna palabra coincide, se devuelve una muestra general del
    catalogo para que el agente pueda al menos sugerir categorias en
    vez de responder que no encontro absolutamente nada.
    """
    palabras = [p for p in re.split(r"\W+", mensaje.lower()) if len(p) >= 3]

    conn = conectar()
    cursor = conn.cursor(dictionary=True)

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
                "(d.nombre_dataset LIKE %s OR d.descripcion LIKE %s "
                "OR d.entidad_responsable LIKE %s OR c.nombre LIKE %s)"
            )
            valores.extend([comodin, comodin, comodin, comodin])

        query = base_query + " WHERE " + " OR ".join(condiciones) + " LIMIT %s"
        valores.append(limite)

        cursor.execute(query, tuple(valores))
        resultados = cursor.fetchall()

    if not resultados:
        cursor.execute(base_query + " LIMIT %s", (limite,))
        resultados = cursor.fetchall()

    cursor.close()
    conn.close()

    return resultados


@app.route("/api/agente/consultar", methods=["POST"])
def agente_consultar():
    """
    Asistente en lenguaje natural del catalogo ICDE.

    Recibe una pregunta (JSON: {"mensaje": "..."}), busca en MySQL los
    datasets mas relacionados y le pide a Gemini que redacte una
    recomendacion breve usando UNICAMENTE esos datasets (para que no
    invente resultados que no existen en el catalogo).
    """
    if not GEMINI_API_KEY:
        return jsonify({
            "ok": False,
            "error": (
                "El agente no tiene configurada la clave de Gemini en el servidor. "
                "Define la variable de entorno GEMINI_API_KEY antes de iniciar api.py."
            )
        }), 503

    datos_entrada = request.get_json(silent=True) or {}
    mensaje = str(datos_entrada.get("mensaje", "")).strip()

    if not mensaje:
        return jsonify({"ok": False, "error": "Falta el mensaje."}), 400

    try:
        candidatos = buscar_datasets_relacionados(mensaje)
    except Exception as e:
        return jsonify({
            "ok": False,
            "error": f"No fue posible consultar el catalogo: {str(e)}"
        }), 500

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
        cuerpo = llamar_gemini(prompt)
    except (RuntimeError, subprocess.SubprocessError, json.JSONDecodeError, OSError) as e:
        return jsonify({
            "ok": False,
            "error": f"No fue posible conectar con Gemini: {str(e)}"
        }), 502

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
        return jsonify({
            "ok": False,
            "error": f"Gemini devolvio una respuesta inesperada: {str(e)}"
        }), 502

    # Se extraen las lineas "RECOMENDADO: <nombre>" para devolver tambien
    # los datos completos de esos datasets (enlaces, arcgis_id, etc.) y
    # poder mostrar tarjetas clicables en el chat.
    nombres_recomendados = re.findall(r"RECOMENDADO:\s*(.+)", texto_ia)
    texto_para_mostrar = re.sub(r"RECOMENDADO:.*", "", texto_ia).strip()

    recomendados = []
    for nombre in nombres_recomendados:
        nombre = nombre.strip()
        coincidencia = next(
            (
                c for c in candidatos
                if c["nombre_dataset"].strip().lower() == nombre.lower()
            ),
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
    return jsonify({
        "ok": True,
        "mensaje": "API GeoDB Andes activa"
    })


# =====================================================================
# ARRANQUE DEL SCHEDULER (guardado automatico de lecturas LabVIEW)
# =====================================================================

scheduler = BackgroundScheduler()
scheduler.add_job(guardar_lectura_labview, "interval", seconds=5)
scheduler.start()


if __name__ == "__main__":
    print("")
    print("============================================================")
    print(" API GEODB ANDES")
    print("============================================================")
    print(f"Agente ICDE - modelo de Gemini configurado: {GEMINI_MODEL}")
    print(f"Clave de Gemini detectada: {'si' if GEMINI_API_KEY else 'NO (falta GEMINI_API_KEY)'}")
    print("Si acabas de cambiar algo en este archivo y no ves el cambio")
    print("reflejado en las respuestas, este servidor NO se reinicio de")
    print("verdad: dale Ctrl+C aqui y vuelve a correr 'python api.py'.")
    print("============================================================")
    print("")

    app.run(
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 5000)),
        debug=True,
        use_reloader=False
    )