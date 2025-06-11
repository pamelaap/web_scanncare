import os, io, zipfile, numpy as np
from flask import Flask, render_template, request, jsonify, send_file
import retoimagen

app = Flask(__name__)
BASE   = os.getcwd()
UPLOAD = os.path.join(BASE, "uploads")
EXPORT = os.path.join(BASE, "exports")
os.makedirs(UPLOAD, exist_ok=True)
os.makedirs(EXPORT, exist_ok=True)

def get_volume(session_id):
    """Carga el volumen guardado en volume.npy, sin tocar DICOM."""
    folder = os.path.join(UPLOAD, session_id)
    vol_path = os.path.join(folder, "volume.npy")
    if not os.path.exists(vol_path):
        raise RuntimeError("Volumen no encontrado. Sube primero tu ZIP DICOM.")
    return np.load(vol_path)

def get_mask(session_id):
    """Carga la máscara si existe, o devuelve un array de False."""
    folder = os.path.join(UPLOAD, session_id)
    mask_path = os.path.join(folder, "mask.npy")
    if os.path.exists(mask_path):
        return np.load(mask_path)
    else:
        # Mismo tamaño que volumen: cargamos volumen para saber la forma
        vol = get_volume(session_id)
        return np.zeros_like(vol, dtype=bool)

@app.route("/", methods=["GET"])
def index():
    return render_template("index.html")

@app.route("/upload", methods=["POST"])
def upload():
    session_id = request.form.get("session_id")
    if not session_id:
        return "Falta session_id", 400

    folder = os.path.join(UPLOAD, session_id)
    os.makedirs(folder, exist_ok=True)

    upload = request.files.get("dicoms")
    if not upload or not upload.filename.lower().endswith(".zip"):
        return "Solo ZIP válido", 400

    zip_path = os.path.join(folder, upload.filename)
    upload.save(zip_path)
    with zipfile.ZipFile(zip_path, "r") as zf:
        zf.extractall(folder)

    # Aquí sí leemos los DICOM y guardamos volume.npy
    try:
        arr = retoimagen.load_series_to_numpy(folder)
    except Exception as e:
        return str(e), 500

    np.save(os.path.join(folder, "volume.npy"), arr)
    z,y,x = arr.shape
    return jsonify(z=z, y=y, x=x)

@app.route("/slice", methods=["POST"])
def slice_view():
    d = request.get_json() or {}
    session_id = d.get("session_id")
    if not session_id:
        return "Falta session_id", 400

    # Cargamos VOL directamente
    arr  = get_volume(session_id)
    mask = get_mask(session_id)

    img_bytes = retoimagen.render_slice(
        arr, mask,
        d["view"], int(d["idx"]),
        int(d["center"]), int(d["width"])
    )
    return send_file(io.BytesIO(img_bytes), mimetype="image/png")

@app.route("/apply_threshold", methods=["POST"])
def apply_threshold():
    d = request.get_json() or {}
    session_id = d.get("session_id")
    if not session_id:
        return "Falta session_id", 400

    arr = get_volume(session_id)
    mask = retoimagen.compute_mask(
        arr,
        d["thr_min"], d["thr_max"],
        d["min_vol"], d["smoothing"],
        d["invert"], d.get("roi")
    )
    # Guardamos la máscara
    folder = os.path.join(UPLOAD, session_id)
    np.save(os.path.join(folder, "mask.npy"), mask)
    return jsonify(status="ok")

@app.route("/preview_3d", methods=["GET", "POST"])
def preview_3d():
    # Recogemos parámetros de GET o POST
    data = request.get_json() if request.method=="POST" else request.args
    session_id = data.get("session_id")
    if not session_id:
        return "Falta session_id", 400

    thr_min   = int(data.get("thr_min",   300))
    thr_max   = int(data.get("thr_max",   4000))
    min_vol   = int(data.get("min_vol",   1000))
    smoothing = float(data.get("smoothing", 1.0))
    invert    = str(data.get("invert", False)).lower() in ("1","true")

    arr  = get_volume(session_id)
    mask = retoimagen.compute_mask(arr, thr_min, thr_max, min_vol, smoothing, invert, None)
    folder = os.path.join(UPLOAD, session_id)
    np.save(os.path.join(folder, "mask.npy"), mask)

    stl_path = retoimagen.export_stl(arr, mask, smoothing, EXPORT)
    download = data.get("download","")=="1"
    return send_file(
        stl_path,
        mimetype="application/vnd.ms-pki.stl",
        as_attachment=download,
        download_name=os.path.basename(stl_path) if download else None
    )

if __name__=="__main__":
    app.run(debug=True, host="0.0.0.0", port=int(os.environ.get("PORT",5000)))
