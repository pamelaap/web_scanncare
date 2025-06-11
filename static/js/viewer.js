document.addEventListener("DOMContentLoaded", () => {
  const showLoading = msg => {
    const o = document.getElementById("loadingOverlay");
    o.innerText = msg; o.classList.remove("hidden");
  };
  const hideLoading = () => {
    const o = document.getElementById("loadingOverlay");
    o.innerText = "Listo ✓";
    setTimeout(() => o.classList.add("hidden"), 500);
  };

  let session, dims={}, roiBox=null, sliceTO, pressing=false;
  const presets = {
    lung:   {min:-1000,max:-500},
    fat:    {min:-190,max:-30},
    soft:   {min:30,max:60},
    muscle: {min:40,max:80},
    bone:   {min:226,max:3071},
  };

  // Bindear inputs
  const thrMin = document.getElementById("thrMin");
  const thrMax = document.getElementById("thrMax");
  document.getElementById("presetSelect").onchange = e => {
    const p = presets[e.target.value];
    if (p) { thrMin.value = p.min; thrMax.value = p.max; }
  };

  // Debounce
  const schedule = fn => {
    clearTimeout(sliceTO);
    sliceTO = setTimeout(fn, 150);
  };

  // BOTÓN SUBIR en lugar de form submit
  document.getElementById("btnUpload").onclick = async () => {
    showLoading("Cargando DICOM…");
    const form = new FormData();
    session = document.querySelector("input[name=session_id]").value;
    form.append("session_id", session);
    const f = document.querySelector("input[name=dicoms]").files[0];
    form.append("dicoms", f);
    const res = await fetch("/upload", { method:"POST", body:form });
    if (!res.ok) {
      hideLoading();
      return alert(await res.text());
    }
    dims = await res.json();

    // Configurar sliders
    ["axial","sagital","coronal"].forEach(v => {
      const s = document.getElementById(v+"Slider");
      const m = dims[v==="axial"?"z":v==="sagital"?"y":"x"] - 1;
      s.max=m; s.value=Math.floor(m/2);
      s.oninput = ()=>{ showLoading(`Cargando ${v}…`); schedule(()=>updateSlice(v)); };
    });
    ["winCenter","winWidth"].forEach(id=>{
      document.getElementById(id).oninput = ()=>{ showLoading("Ajustando WL…"); schedule(updateAll); };
    });

    initROI();
    await updateAll();
    hideLoading();
  };

  async function updateSlice(view) {
    try {
      const idx = +document.getElementById(view+"Slider").value;
      const body = {
        session_id: session,
        view, idx,
        center:+document.getElementById("winCenter").value,
        width:+document.getElementById("winWidth").value
      };
      const r = await fetch("/slice", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify(body)
      });
      const blob = await r.blob();
      document.getElementById(view+"Img").src = URL.createObjectURL(blob);
    } finally {
      hideLoading();
    }
  }

  async function updateAll(){
    for(const v of ["axial","sagital","coronal"]){
      showLoading(`Cargando ${v}…`);
      await updateSlice(v);
    }
  }

  document.getElementById("btnThresh").onclick = async ()=>{
    showLoading("Segmentando…");
    const [x1,y1,x2,y2] = roiBox || [0,0,0,0];
    await fetch("/apply_threshold",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        session_id:session,
        thr_min:+thrMin.value,thr_max:+thrMax.value,
        min_vol:+document.getElementById("minVol").value,
        smoothing:+document.getElementById("smoothVal").value,
        invert:document.getElementById("invertChk").checked,
        roi:[+document.getElementById("axialSlider").value,x1,y1,x2,x2]
      })
    });
    hideLoading(); alert("✅ Segmentación aplicada");
    await updateAll();
  };

  document.getElementById("btnResetROI").onclick = ()=>{
    roiBox=null; drawROI();
  };

  // Three.js preview y export idénticos a lo anterior...
  // (mantén el mismo código Three.js que ya tienes)

  // ROI en el canvas axial
  function initROI(){
    const img = document.getElementById("axialImg");
    const can = document.getElementById("axialCanvas");
    can.width=img.clientWidth; can.height=img.clientHeight;
    can.style.top=img.offsetTop+"px"; can.style.left=img.offsetLeft+"px";
    can.onmousedown=e=>{pressing=true;roiBox=[e.offsetX,e.offsetY,0,0];};
    can.onmousemove=e=>{if(!pressing)return;roiBox[2]=e.offsetX;roiBox[3]=e.offsetY;drawROI();};
    can.onmouseup=e=>{pressing=false;drawROI();};
  }
  function drawROI(){
    const can=document.getElementById("axialCanvas"),
          ctx=can.getContext("2d");
    ctx.clearRect(0,0,can.width,can.height);
    if(!roiBox)return;
    let [x1,y1,x2,y2]=roiBox;
    const x=Math.min(x1,x2),y=Math.min(y1,y2),
          w=Math.abs(x2-x1),h=Math.abs(y2-y1);
    ctx.fillStyle="rgba(0,170,255,0.3)";ctx.fillRect(x,y,w,h);
    ctx.strokeStyle="#00aaff";ctx.lineWidth=2;ctx.strokeRect(x,y,w,h);
  }

  // Y tu Three.js...
});
