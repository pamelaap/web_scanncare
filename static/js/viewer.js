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
document.addEventListener("DOMContentLoaded", () => {
  const overlay    = document.getElementById("loadingOverlay"),
        showLoading= msg=>{ overlay.innerText=msg; overlay.classList.remove("hidden"); },
        hideLoading= ()=>{ overlay.innerText="Listo ✓"; setTimeout(()=>overlay.classList.add("hidden"),500); };

  const uploadForm = document.getElementById("uploadForm"),
        thrMin     = document.getElementById("thrMin"),
        thrMax     = document.getElementById("thrMax"),
        minVol     = document.getElementById("minVol"),
        smoothVal  = document.getElementById("smoothVal"),
        invertChk  = document.getElementById("invertChk"),
        preset     = document.getElementById("presetSelect"),

        btnThresh    = document.getElementById("btnThresh"),
        btnResetROI  = document.getElementById("btnResetROI"),
        btnPreview3D = document.getElementById("btnPreview3D"),
        btnExportSTL = document.getElementById("btnExportSTL"),

        viewer3d     = document.getElementById("viewer3d"),
        close3d      = document.getElementById("close3d");

  let session, dims={}, roiBox=null, sliceTO, pressing=false;

  // Presets HU
  const presetsHU = {
    lung:   {min:-1000,max:-500},
    fat:    {min:-190,max:-30},
    soft:   {min:30,max:60},
    muscle: {min:40,max:80},
    bone:   {min:226,max:3071}
  };
  preset.onchange = e => {
    const p = presetsHU[e.target.value];
    if (p) { thrMin.value = p.min; thrMax.value = p.max; }
  };

  const schedule = fn=>{ clearTimeout(sliceTO); sliceTO=setTimeout(fn,150); };

  uploadForm.onsubmit = async e => {
    e.preventDefault(); showLoading("Cargando DICOM…");
    session = new FormData(uploadForm).get("session_id");
    const res = await fetch("/upload",{method:"POST",body:new FormData(uploadForm)});
    if(!res.ok){ hideLoading(); return alert(await res.text()); }
    dims = await res.json();
    ["axial","sagital","coronal"].forEach(v=>{
      const s=document.getElementById(v+"Slider"),
            m=dims[v==="axial"?"z":v==="sagital"?"y":"x"]-1;
      s.max=m; s.value=Math.floor(m/2);
      s.oninput=()=>{showLoading(`Cargando ${v}…`);schedule(()=>updateSlice(v));};
    });
    ["winCenter","winWidth"].forEach(id=>{
      document.getElementById(id).oninput=()=>{showLoading("Ajustando WL…");schedule(updateAll);};
    });
    initROI(); await updateAll(); hideLoading();
  };

  async function updateSlice(view){
    try{
      const idx=+document.getElementById(view+"Slider").value;
      const body={session_id:session,view,idx,
        center:+document.getElementById("winCenter").value,
        width:+document.getElementById("winWidth").value};
      const r=await fetch("/slice",{method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify(body)});
      const blob=await r.blob();
      document.getElementById(view+"Img").src=URL.createObjectURL(blob);
    }finally{ hideLoading(); }
  }

  async function updateAll(){
    for(const v of["axial","sagital","coronal"]){
      showLoading(`Cargando ${v}…`);
      await updateSlice(v);
    }
  }

  btnThresh.onclick = async ()=>{
    showLoading("Segmentando…");
    const [x1,y1,x2,y2] = roiBox||[0,0,0,0];
    await fetch("/apply_threshold",{method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        session_id:session,
        thr_min:+thrMin.value,thr_max:+thrMax.value,
        min_vol:+minVol.value,smoothing:+smoothVal.value,
        invert:invertChk.checked,
        roi:[+document.getElementById("axialSlider").value,y1,y2,x1,x2]
      })
    });
    hideLoading(); alert("✅ Threshold aplicado"); await updateAll();
  };

  btnResetROI.onclick=()=>{roiBox=null;drawROI();};

  // Three.js para 3D
  let scene, camera, renderer, controls, stlMesh;
  function initThree(){
    scene=new THREE.Scene();
    camera=new THREE.PerspectiveCamera(45,window.innerWidth/window.innerHeight,0.1,1000);
    renderer=new THREE.WebGLRenderer({antialias:true});
    renderer.setSize(window.innerWidth,window.innerHeight);
    viewer3d.appendChild(renderer.domElement);
    scene.add(new THREE.AmbientLight(0x404040));
    const dir=new THREE.DirectionalLight(0xffffff,1);
    dir.position.set(1,1,1);scene.add(dir);
    controls=new THREE.OrbitControls(camera,renderer.domElement);
    camera.position.set(100,100,100);controls.update();
    window.addEventListener("resize",()=>{
      camera.aspect=window.innerWidth/window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth,window.innerHeight);
    });
    (function animate(){
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene,camera);
    })();
  }
  function loadSTL(buffer){
    if(!scene) initThree();
    if(stlMesh){
      scene.remove(stlMesh);
      stlMesh.geometry.dispose();
      stlMesh.material.dispose();
    }
    const loader=new THREE.STLLoader();
    const geom=loader.parse(buffer);
    const mat=new THREE.MeshPhongMaterial({color:0x00aaff,specular:0x111111,shininess:200});
    stlMesh=new THREE.Mesh(geom,mat);
    stlMesh.rotation.x=-Math.PI/2;
    scene.add(stlMesh);
    const box=new THREE.Box3().setFromObject(stlMesh);
    const size=box.getSize(new THREE.Vector3()).length();
    const center=box.getCenter(new THREE.Vector3());
    camera.position.copy(center).add(new THREE.Vector3(size,size,size));
    camera.lookAt(center);
  }

  btnPreview3D.onclick = async ()=>{
    showLoading("Generando 3D…");
    await fetch("/apply_threshold",{method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        session_id:session,
        thr_min:+thrMin.value,thr_max:+thrMax.value,
        min_vol:+minVol.value,smoothing:+smoothVal.value,
        invert:invertChk.checked,
        roi:[+document.getElementById("axialSlider").value,0,0,0,0]
      })
    });
    const qs=new URLSearchParams({
      session_id:session,
      thr_min:thrMin.value,thr_max:thrMax.value,
      min_vol:minVol.value,
      smoothing:smoothVal.value,
      invert:invertChk.checked
    });
    const r=await fetch(`/preview_3d?${qs}`);
    if(!r.ok){ hideLoading(); return alert(await r.text()); }
    const buf=await r.arrayBuffer();
    loadSTL(buf);
    viewer3d.classList.remove("hidden");
    close3d.classList.remove("hidden");
    hideLoading();
  };

  close3d.onclick=()=>{
    viewer3d.classList.add("hidden");
    close3d.classList.add("hidden");
  };

  btnExportSTL.onclick=()=>{
    showLoading("Descargando STL…");
    const qs=new URLSearchParams({
      session_id:session,
      thr_min:thrMin.value,thr_max:thrMax.value,
      min_vol:minVol.value,
      smoothing:smoothVal.value,
      invert:invertChk.checked,
      download:"1"
    });
    const a=document.createElement("a");
    a.href=`/preview_3d?${qs}`; a.download=`segmentacion_${session}.stl`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    hideLoading();
  };

  function initROI(){
    const img=document.getElementById("axialImg"),
          can=document.getElementById("axialCanvas");
    can.width=img.clientWidth;can.height=img.clientHeight;
    can.style.top=img.offsetTop+"px";can.style.left=img.offsetLeft+"px";
    can.onmousedown=e=>{roiBox=[e.offsetX,e.offsetY,0,0];pressing=true;};
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
});
