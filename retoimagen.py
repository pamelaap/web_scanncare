# retoimagen.py

import SimpleITK as sitk
import numpy as np
from skimage import morphology, measure
from scipy.ndimage import gaussian_filter
from stl import mesh as mmesh
import matplotlib.pyplot as plt
import io, os
from datetime import datetime
import pydicom

def load_series_to_numpy(folder):
    """
    Carga un volumen DICOM desde 'folder' (extraído de ZIP), buscando
    en subdirectorios y agrupando por SeriesInstanceUID.
    """
    # 1) Recopila todos los .dcm (case-insensitive)
    dcm_paths = []
    for root, _, files in os.walk(folder):
        for f in files:
            if f.lower().endswith(".dcm"):
                dcm_paths.append(os.path.join(root, f))
    if not dcm_paths:
        raise RuntimeError(f"No se encontraron archivos DICOM en {folder}")

    # 2) Agrupa por SeriesInstanceUID usando pydicom
    series_map = {}
    for p in dcm_paths:
        try:
            ds = pydicom.dcmread(p, stop_before_pixels=True, specific_tags=["SeriesInstanceUID"])
            uid = ds.SeriesInstanceUID
        except Exception:
            uid = None
        if uid:
            series_map.setdefault(uid, []).append(p)

    # 3) Elige la serie con más archivos, o todos si no hay UIDs
    if series_map:
        best_list = max(series_map.values(), key=len)
    else:
        best_list = dcm_paths

    # 4) Ordena las rutas y cárgalas con SimpleITK
    best_list = sorted(best_list)
    reader = sitk.ImageSeriesReader()
    reader.SetFileNames(best_list)
    img = reader.Execute()

    # 5) Convierte a NumPy y devuelve
    return sitk.GetArrayFromImage(img)
# retoimagen.py

def compute_mask(arr, thr_min, thr_max, min_vol, smoothing, invert, roi):
    """
    Aplica threshold y postprocesado:
    - Filtra por rango [thr_min, thr_max]
    - Recorta a la ROI si se proporciona [z,y1,y2,x1,x2]
    - Elimina objetos pequeños (<min_vol)
    - Cierra/abre con un ball de radio smoothing
    - Invierte la máscara si invert=True
    """
    mask = (arr >= thr_min) & (arr <= thr_max)

    if roi:
        z, y1, y2, x1, x2 = roi
        roi_m = np.zeros_like(mask)
        roi_m[z, y1:y2, x1:x2] = True
        mask &= roi_m

    # elimina objetos pequeños
    mask = morphology.remove_small_objects(mask, min_size=int(min_vol))

    # suavizado
    if smoothing and smoothing > 0:
        ball = morphology.ball(int(smoothing))
        mask = morphology.binary_closing(mask, footprint=ball)
        mask = morphology.binary_opening(mask, footprint=ball)

    if invert:
        mask = ~mask

    return mask

def render_slice(arr, mask, view, idx, center, width):
    if view=='axial':
        img = arr[idx,:,:]; m = mask[idx,:,:]
    elif view=='sagital':
        img = arr[:,idx,:]; m = mask[:,idx,:]
    else:
        img = arr[:,:,idx]; m = mask[:,:,idx]

    vmin = center - width/2
    vmax = center + width/2

    # Normalizar a 0-255 uint8
    im_norm = ((img - vmin)/(vmax-vmin)*255).clip(0,255).astype(np.uint8)
    # Crear un RGB simple
    rgb = np.stack([im_norm]*3, axis=-1)
    # Superponer mask en rojo con alpha
    alpha = 0.3
    rgb[m,0] = (1-alpha)*rgb[m,0] + alpha*255

    # Guardar con PIL directamente
    from PIL import Image
    im = Image.fromarray(rgb)
    buf = io.BytesIO()
    im.save(buf, format='PNG')
    buf.seek(0)
    return buf.getvalue()


def export_stl(arr, mask, smoothing, export_path, output_filename=None): # Added output_filename
    sm = gaussian_filter(mask.astype(float), sigma=smoothing)
    if not mask.any():
        raise ValueError("No hay segmentación para generar STL. Aplica threshold primero.")

    # If the blurred mask is essentially empty, marching cubes might fail or produce garbage.
    # This can happen if 'smoothing' blurs away all features.
    if not sm.any():
        raise ValueError("La máscara suavizada está vacía. Intenta un menor suavizado o un umbral diferente.")

    verts, faces, _, _ = measure.marching_cubes(sm, level=0.5)

    # Handle cases where marching_cubes might return no faces
    if len(faces) == 0:
        raise ValueError("No se pudo generar una superficie 3D. No hay caras/triángulos generados.")

    # Use the more efficient mesh creation:
    faces_verts = verts[faces]
    mesh_data = mmesh.Mesh(np.zeros(faces_verts.shape[0], dtype=mmesh.Mesh.dtype))
    mesh_data.vectors = faces_verts

    os.makedirs(export_path, exist_ok=True)
    # Use the provided filename or generate a default
    fn = output_filename if output_filename else f"segment_{datetime.now():%Y%m%d_%H%M%S}.stl"
    out = os.path.join(export_path, fn)
    mesh_data.save(out)
    return out
