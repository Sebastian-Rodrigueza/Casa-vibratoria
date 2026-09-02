"""
API Sensores LabVIEW
---------------------
Este script lee archivos .lvm de la carpeta D:\instru
y expone sus datos en una direccion web (API) para que otras PCs de
la misma red puedan consultarlos.

COMO EJECUTARLO:
1. Abre PowerShell en esta PC (la del laboratorio).
2. Ve a la carpeta donde guardaste este archivo, por ejemplo:
   cd D:\instru
3. Corre:
   py api_sensores.py
4. Deja esta ventana abierta mientras quieras que la API funcione.
   Si la cierras, la API deja de responder.

COMO SE USA DESDE OTRA PC:
Desde el navegador (o desde tu pagina web), entra a:
   http://157.253.210.156:5000/api/sensores

Eso te da un JSON con los nombres de los sensores y su ultima lectura
del archivo MAS RECIENTE (el que se modifico por ultima vez).

Tambien existe:
   http://157.253.210.156:5000/api/sensores/completo
que devuelve el archivo MAS RECIENTE completo (todas las filas), util
para hacer una carga masiva del ultimo ensayo hacia la base de datos.

Y ahora tambien:
   http://157.253.210.156:5000/api/sensores/archivos
que lista TODOS los archivos .lvm que hay en la carpeta ahora mismo
(no solo el mas reciente), para poder elegir uno viejo.

Tanto /api/sensores como /api/sensores/completo aceptan un parametro
opcional "archivo" para pedir uno especifico en vez del mas reciente,
por ejemplo:
   http://157.253.210.156:5000/api/sensores/completo?archivo=2021-06-02-Estrenar_vivienda_M6.lvm&limite=0
"""

import os
import glob
from datetime import datetime
from flask import Flask, jsonify, request
from flask_cors import CORS

# ------------- CONFIGURACION -------------
CARPETA_DATOS = r"C:\Users\Instrumentacion\Documents\LabVIEW Data"
PUERTO = 5000
# ------------------------------------------

app = Flask(__name__)
CORS(app)  # permite que tu pagina web (en otro dominio/PC) pueda consultar esta API


def obtener_archivo_mas_reciente():
    archivos = glob.glob(os.path.join(CARPETA_DATOS, "*.lvm"))
    if not archivos:
        return None
    return max(archivos, key=os.path.getmtime)


def resolver_archivo_objetivo():
    """
    Si en la URL viene ?archivo=nombre.lvm, se usa exactamente ese
    archivo (debe existir dentro de CARPETA_DATOS, sin rutas raras).
    Si no viene, se usa el mas reciente por fecha de modificacion,
    igual que antes.

    Devuelve la ruta completa al archivo, o None si no se encontro.
    """
    nombre_pedido = request.args.get("archivo", "").strip()
    if nombre_pedido:
        # Evita que alguien intente pedir un archivo fuera de la carpeta
        # (ej: "../../algo.lvm").
        nombre_pedido = os.path.basename(nombre_pedido)
        ruta = os.path.join(CARPETA_DATOS, nombre_pedido)
        if os.path.isfile(ruta):
            return ruta
        return None
    return obtener_archivo_mas_reciente()


def listar_archivos_lvm():
    """
    Lista TODOS los archivos .lvm que hay ahora mismo en la carpeta,
    del mas reciente al mas viejo (por fecha de modificacion), con su
    tamano en bytes.
    """
    archivos = glob.glob(os.path.join(CARPETA_DATOS, "*.lvm"))
    lista = []
    for ruta in archivos:
        try:
            lista.append({
                "nombre": os.path.basename(ruta),
                "modificado": datetime.fromtimestamp(os.path.getmtime(ruta)).isoformat(),
                "tamano_bytes": os.path.getsize(ruta),
            })
        except OSError:
            # El archivo pudo haberse borrado/movido justo en este instante.
            continue
    lista.sort(key=lambda a: a["modificado"], reverse=True)
    return lista


def leer_datos_lvm(ruta_archivo):
    """
    Lee un archivo .lvm de LabVIEW y devuelve:
    - nombres de los sensores (columnas)
    - la ultima fila de datos leida
    Maneja el separador decimal como coma (,) tal como lo guarda LabVIEW
    en configuracion regional en espanol.
    """
    with open(ruta_archivo, "r", encoding="latin-1") as f:
        lineas = f.readlines()

    # Buscar la linea de encabezados de columnas: empieza con "X_Value"
    idx_encabezado = None
    for i, linea in enumerate(lineas):
        if linea.startswith("X_Value"):
            idx_encabezado = i
            break

    if idx_encabezado is None:
        return None, None, "No se encontro la fila de encabezados (X_Value) en el archivo."

    nombres_columnas = lineas[idx_encabezado].strip().split("\t")

    # Las filas de datos vienen despues del encabezado
    filas_datos = []
    for linea in lineas[idx_encabezado + 1:]:
        linea = linea.strip()
        if not linea:
            continue
        valores = linea.split("\t")
        filas_datos.append(valores)

    if not filas_datos:
        return nombres_columnas, None, "El archivo aun no tiene filas de datos."

    ultima_fila = filas_datos[-1]

    # Convertir la ultima fila a un diccionario {nombre_sensor: valor}
    lectura = {}
    for nombre, valor in zip(nombres_columnas, ultima_fila):
        valor_limpio = valor.replace(",", ".")  # coma decimal -> punto decimal
        try:
            lectura[nombre] = float(valor_limpio)
        except ValueError:
            lectura[nombre] = valor  # si no es numero (ej: columna Comment), se deja como texto

    return nombres_columnas, {
        "total_filas": len(filas_datos),
        "ultima_lectura": lectura,
    }, None


def leer_archivo_completo(ruta_archivo):
    """
    Lee un archivo .lvm completo y devuelve TODAS las filas de datos
    (no solo la ultima), listas para hacer una carga masiva a la
    base de datos. Se devuelve en formato "columnas" + "filas" (en vez
    de un diccionario repetido por cada fila) para que el archivo
    resultante sea mucho mas liviano de transportar por la red.
    """
    with open(ruta_archivo, "r", encoding="latin-1") as f:
        lineas = f.readlines()

    idx_encabezado = None
    for i, linea in enumerate(lineas):
        if linea.startswith("X_Value"):
            idx_encabezado = i
            break

    if idx_encabezado is None:
        return None, None, "No se encontro la fila de encabezados (X_Value) en el archivo."

    nombres_columnas = lineas[idx_encabezado].strip().split("\t")

    filas_numericas = []
    for linea in lineas[idx_encabezado + 1:]:
        linea = linea.strip()
        if not linea:
            continue
        valores = linea.split("\t")
        fila_convertida = []
        for valor in valores:
            valor_limpio = valor.replace(",", ".")
            try:
                fila_convertida.append(float(valor_limpio))
            except ValueError:
                fila_convertida.append(valor)  # texto (ej: columna Comment)
        filas_numericas.append(fila_convertida)

    if not filas_numericas:
        return nombres_columnas, None, "El archivo aun no tiene filas de datos."

    return nombres_columnas, filas_numericas, None


@app.route("/api/sensores/archivos")
def api_sensores_archivos():
    """
    Lista TODOS los archivos .lvm que hay en la carpeta de datos ahora
    mismo (no solo el mas reciente), para poder elegir uno viejo que ya
    no este activo.
    """
    return jsonify({"archivos": listar_archivos_lvm()})


@app.route("/api/sensores/completo")
def api_sensores_completo():
    """
    Devuelve un archivo .lvm completo (o un pedazo de el), con TODAS
    sus filas de datos (no solo la ultima). Pensado para hacer una
    carga masiva hacia la base de datos.

    Parametros opcionales en la URL:
      - archivo: nombre exacto del archivo .lvm a usar. Si no se pasa,
        se usa el mas reciente por fecha de modificacion.
      - limite: cuantas filas devolver como maximo (por defecto 1000,
        mientras estamos probando). Para traer el archivo COMPLETO sin
        recortar, usa limite=0 (ej: /api/sensores/completo?limite=0).
    """
    limite_str = request.args.get("limite", "1000")
    try:
        limite = int(limite_str)
    except ValueError:
        limite = 1000

    archivo = resolver_archivo_objetivo()
    if archivo is None:
        return jsonify({"error": f"No se encontro el archivo .lvm solicitado en {CARPETA_DATOS}"}), 404

    nombres_columnas, filas, error = leer_archivo_completo(archivo)

    if error and filas is None:
        return jsonify({"error": error, "archivo": os.path.basename(archivo)}), 404

    total_filas_real = len(filas)
    if limite and limite > 0:
        filas = filas[:limite]

    return jsonify({
        "archivo": os.path.basename(archivo),
        "columnas": nombres_columnas,
        "total_filas_en_archivo": total_filas_real,
        "total_filas_devueltas": len(filas),
        "filas": filas,
    })


@app.route("/api/sensores")
def api_sensores():
    archivo = resolver_archivo_objetivo()
    if archivo is None:
        return jsonify({"error": f"No se encontro el archivo .lvm solicitado en {CARPETA_DATOS}"}), 404

    nombres_columnas, resultado, error = leer_datos_lvm(archivo)

    if error and resultado is None:
        return jsonify({"error": error, "archivo": os.path.basename(archivo)}), 404

    return jsonify({
        "archivo": os.path.basename(archivo),
        "sensores": nombres_columnas,
        "total_filas": resultado["total_filas"],
        "ultima_lectura": resultado["ultima_lectura"],
    })


@app.route("/")
def home():
    return "API de sensores LabVIEW activa. Ve a /api/sensores para ver los datos."


if __name__ == "__main__":
    print(f"Leyendo archivos .lvm desde: {CARPETA_DATOS}")
    print(f"API disponible en: http://157.253.210.156:{PUERTO}/api/sensores")
    app.run(host="0.0.0.0", port=PUERTO)
