from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path
from typing import Iterable

from flask import Flask, jsonify, request, send_from_directory

BASE_DIR = Path(__file__).resolve().parent
HTML_NAME = "Mapa.html"

app = Flask(__name__, static_folder=str(BASE_DIR), static_url_path="")
app.config["MAX_CONTENT_LENGTH"] = 2 * 1024 * 1024 * 1024  # 2 GB


def find_executable(name: str) -> str | None:
    """Busca GDAL en PATH y en instalaciones comunes de QGIS/OSGeo4W."""
    found = shutil.which(name)
    if found:
        return found

    candidates: list[Path] = []
    program_files = [
        Path(os.environ.get("ProgramFiles", r"C:\Program Files")),
        Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")),
        Path(r"C:\OSGeo4W"),
        Path(r"C:\OSGeo4W64"),
    ]

    executable = f"{name}.exe" if os.name == "nt" else name

    for root in program_files:
        if not root.exists():
            continue

        candidates.extend(root.glob(f"QGIS*/bin/{executable}"))
        candidates.extend(root.glob(f"bin/{executable}"))
        candidates.extend(root.glob(f"apps/qgis*/bin/{executable}"))

    for candidate in candidates:
        if candidate.exists():
            return str(candidate)

    return None


OGRINFO = find_executable("ogrinfo")
OGR2OGR = find_executable("ogr2ogr")


def safe_relative_path(raw_path: str) -> Path:
    cleaned = raw_path.replace("\\", "/").lstrip("/")
    parts = [
        part for part in cleaned.split("/")
        if part not in ("", ".", "..")
    ]

    if not parts:
        raise ValueError("Ruta de archivo vacía.")

    return Path(*parts)


def safe_extract_zip(zip_path: Path, destination: Path) -> None:
    with zipfile.ZipFile(zip_path) as archive:
        destination_resolved = destination.resolve()

        for member in archive.infolist():
            target = (destination / member.filename).resolve()

            if destination_resolved not in target.parents and target != destination_resolved:
                raise ValueError("El ZIP contiene rutas no seguras.")

        archive.extractall(destination)


def locate_gdb(root: Path) -> Path:
    if root.is_dir() and root.name.lower().endswith(".gdb"):
        return root

    matches = sorted(
        (path for path in root.rglob("*") if path.is_dir() and path.name.lower().endswith(".gdb")),
        key=lambda path: len(path.parts),
    )

    if not matches:
        raise FileNotFoundError(
            "No se encontró una carpeta terminada en .gdb. "
            "Selecciona la carpeta completa o comprímela conservando su estructura."
        )

    return matches[0]


def run_command(command: list[str], timeout: int = 600) -> subprocess.CompletedProcess[str]:
    completed = subprocess.run(
        command,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
        check=False,
    )

    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip()
        raise RuntimeError(detail or f"El comando terminó con código {completed.returncode}.")

    return completed


def list_layers(gdb_path: Path) -> list[str]:
    if not OGRINFO:
        raise RuntimeError("No se encontró ogrinfo de GDAL.")

    result = run_command([OGRINFO, "-ro", "-q", str(gdb_path)], timeout=180)
    layers: list[str] = []

    # Ejemplo de salida: 1: Nombre_Capa (Polygon)
    pattern = re.compile(r"^\s*\d+\s*:\s*(.+?)(?:\s+\([^)]*\))?\s*$")

    for line in result.stdout.splitlines():
        match = pattern.match(line)

        if match:
            layer_name = match.group(1).strip()

            if layer_name and layer_name not in layers:
                layers.append(layer_name)

    if not layers:
        raise RuntimeError(
            "GDAL abrió la geodatabase, pero no encontró capas vectoriales."
        )

    return layers


def safe_output_name(layer_name: str, index: int) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", layer_name).strip("._")
    return f"{index:03d}_{cleaned or 'layer'}.geojson"


def convert_layer(gdb_path: Path, layer_name: str, output_path: Path) -> dict:
    if not OGR2OGR:
        raise RuntimeError("No se encontró ogr2ogr de GDAL.")

    command = [
        OGR2OGR,
        "-f", "GeoJSON",
        "-t_srs", "EPSG:4326",
        "-lco", "RFC7946=YES",
        "-skipfailures",
        str(output_path),
        str(gdb_path),
        layer_name,
    ]

    run_command(command, timeout=1200)

    with output_path.open("r", encoding="utf-8") as stream:
        geojson = json.load(stream)

    features = geojson.get("features", [])

    return {
        "name": layer_name,
        "featureCount": len(features),
        "sourceCrs": "FileGDB → EPSG:4326",
        "geojson": geojson,
    }


@app.get("/")
def index():
    return send_from_directory(BASE_DIR, HTML_NAME)


@app.get("/api/gdb/status")
def gdb_status():
    if not OGRINFO or not OGR2OGR:
        return jsonify({
            "ok": False,
            "error": (
                "No se encontró GDAL/ogr2ogr. Instala QGIS u OSGeo4W "
                "y vuelve a iniciar el servidor."
            ),
        }), 503

    return jsonify({
        "ok": True,
        "engine": "GDAL / ogr2ogr",
        "ogrinfo": OGRINFO,
        "ogr2ogr": OGR2OGR,
    })


@app.post("/api/gdb/convert")
def convert_gdb():
    if not OGRINFO or not OGR2OGR:
        return jsonify({
            "ok": False,
            "error": (
                "GDAL no está instalado o no se encontró ogr2ogr. "
                "Instala QGIS u OSGeo4W."
            ),
        }), 503

    files = request.files.getlist("files")
    relative_paths = request.form.getlist("relativePaths")

    if not files:
        return jsonify({"ok": False, "error": "No se recibieron archivos."}), 400

    try:
        with tempfile.TemporaryDirectory(prefix="ciam_gdb_") as temp_name:
            temp_root = Path(temp_name)
            upload_root = temp_root / "upload"
            upload_root.mkdir(parents=True, exist_ok=True)

            for index, uploaded in enumerate(files):
                relative_raw = (
                    relative_paths[index]
                    if index < len(relative_paths)
                    else uploaded.filename
                )

                relative_path = safe_relative_path(relative_raw)
                destination = upload_root / relative_path
                destination.parent.mkdir(parents=True, exist_ok=True)
                uploaded.save(destination)

            # Si se subió un ZIP, extraerlo.
            zip_files = list(upload_root.rglob("*.zip"))

            for zip_file in zip_files:
                extract_dir = upload_root / f"{zip_file.stem}_extraido"
                extract_dir.mkdir(parents=True, exist_ok=True)
                safe_extract_zip(zip_file, extract_dir)

            gdb_path = locate_gdb(upload_root)
            layer_names = list_layers(gdb_path)

            output_dir = temp_root / "geojson"
            output_dir.mkdir(parents=True, exist_ok=True)

            converted_layers: list[dict] = []
            errors: list[dict] = []

            for index, layer_name in enumerate(layer_names, start=1):
                output_path = output_dir / safe_output_name(layer_name, index)

                try:
                    converted_layers.append(
                        convert_layer(gdb_path, layer_name, output_path)
                    )
                except Exception as exc:
                    errors.append({
                        "layer": layer_name,
                        "error": str(exc),
                    })

            if not converted_layers:
                detail = errors[0]["error"] if errors else "No se convirtió ninguna capa."
                raise RuntimeError(detail)

            return jsonify({
                "ok": True,
                "databaseName": gdb_path.name,
                "layers": converted_layers,
                "errors": errors,
            })

    except zipfile.BadZipFile:
        return jsonify({
            "ok": False,
            "error": "El archivo ZIP está dañado o no es un ZIP válido.",
        }), 400
    except Exception as exc:
        return jsonify({
            "ok": False,
            "error": str(exc),
        }), 400


if __name__ == "__main__":
    print("")
    print("============================================================")
    print(" CIAM - SERVIDOR LOCAL CON SOPORTE FILE GEODATABASE (.GDB)")
    print("============================================================")
    print(f"HTML esperado: {BASE_DIR / HTML_NAME}")
    print(f"ogrinfo: {OGRINFO or 'NO ENCONTRADO'}")
    print(f"ogr2ogr: {OGR2OGR or 'NO ENCONTRADO'}")
    print("Abrir en el navegador: http://localhost:5500")
    print("")

    app.run(
        host="127.0.0.1",
        port=5500,
        debug=False,
        threaded=True,
    )