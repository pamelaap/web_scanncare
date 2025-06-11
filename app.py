import os
import io
import zipfile
import numpy as np
import pydicom
from flask import Flask, render_template, request, jsonify, send_file
import retoimagen

app = Flask(__name__)

BASE   = os.getcwd()
UPLOAD = os.path.join(BASE, "uploads")
EXPORT = os.path.join(BASE, "exports")
os.makedirs(UPLOAD, exist_ok=True)
os.makedirs(EXPORT, exist_ok=True)

# Caché de volúmenes para no recargar en cada slice
_volumes = {}
def get_volume(sid):
    if sid in _volumes:
        return _volumes[sid]
    folder = os.path.join(UPLOAD, sid)
    arr = retoimagen.load_series_to_numpy(folder)
    _volumes[sid] = arr
    return arr

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/upload", methods=["POST"])
def upload():
    sid = request.form.get("session_id")
    if not sid:
        return "Falta session_id", 400

    folder = os.path.join(UPLOAD, sid)
    os.makedirs(folder, exist_ok=True)

    f = request.files.get("dicoms")
    if not f or not f.filename.lower().endswith(".zip"):
        return "Solo .zip válido", 400

    # Guardar y extraer ZIP
    zip_path = os.path.join(folder, f.filename)
    f.save(zip_path)
    with zipfile.ZipFile(zip_path, "r") as zf:
        zf.extractall(folder)

    # Buscar recursivamente todos los .dcm extraídos
    dcm_paths = []
    for root, _, files in os.walk(folder):
        for fname in files:
            if fname.lower().endswith(".dcm"):
                dcm_paths.append(os.path.join(root, fname))
    if not dcm_paths:
        return "No se encontraron .dcm en el ZIP", 400

    # Leer dimensiones del primero
    ds = pydicom.dcmread(dcm_paths[0], stop_before_pixels=True)
    rows, cols = int(ds.Rows), int(ds.Columns)
    z = len(dcm_paths)

    return jsonify(z=z, y=rows, x=cols)

@app.route("/slice", methods=["POST"])
def slice_view():
    d   = request.get_json() or {}
    sid = d.get("session_id")
    if not sid:
        return "Falta session_id", 400

    arr    = get_volume(sid)
    mask_p = os.path.join(UPLOAD, sid, "mask.npy")
    mask   = np.load(mask_p) if os.path.exists(mask_p) else np.zeros_like(arr, bool)

    img = retoimagen.render_slice(
        arr, mask,
        d["view"], int(d["idx"]),
        int(d["center"]), int(d["width"])
    )
    return send_file(io.BytesIO(img), mimetype="image/png")

@app.route("/apply_threshold", methods=["POST"])
def apply_threshold():
    d   = request.get_json() or {}
    sid = d.get("session_id")
    if not sid:
        return "Falta session_id", 400

    arr  = get_volume(sid)
    mask = retoimagen.compute_mask(
        arr,
        d["thr_min"], d["thr_max"],
        d["min_vol"], d["smoothing"],
        d["invert"], d.get("roi")
    )
    np.save(os.path.join(UPLOAD, sid, "mask.npy"), mask)
    return jsonify(status="ok")

@app.route("/preview_3d")
def preview_3d():
    d = request.args or {}
    sid = d.get("session_id")
    if not sid:
        return "Falta session_id", 400

    thr_min   = int(d.get("thr_min",   300))
    thr_max   = int(d.get("thr_max",   4000))
    min_vol   = int(d.get("min_vol",   1000))
    smoothing = float(d.get("smoothing", 1.0))
    invert    = d.get("invert","false").lower() in ("true","1")
    download  = d.get("download","0") == "1"

    arr  = get_volume(sid)
    mask = retoimagen.compute_mask(arr, thr_min, thr_max, min_vol, smoothing, invert, None)
    stl_path = retoimagen.export_stl(arr, mask, smoothing, EXPORT)

    return send_file(
        stl_path,
        mimetype="model/stl",
        as_attachment=download,
        download_name=os.path.basename(stl_path) if download else None
    )

if __name__=="__main__":
    app.run(debug=True, host="0.0.0.0", port=int(os.environ.get("PORT",5000)))
