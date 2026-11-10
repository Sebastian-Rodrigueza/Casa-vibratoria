/* =========================================================
   MI SELECCION DE CAPAS (tipo carrito)
   ---------------------------------------------------------
   En las paginas de resultados del ICDE cada capa que se puede
   ver en el mapa tiene "Agregar a mi mapa". Las capas elegidas se
   guardan en este navegador (localStorage) y una bandeja flotante
   las muestra; "Ver todas en el mapa" abre Mapa.html?seleccion=1,
   que las carga todas juntas.

   Uso en una pagina de resultados:
     - en abrirEnMapa(dataset, servicio): si SeleccionCapas.interceptar(...)
       devuelve true, no se abre el mapa (la capa se agrego a la seleccion);
     - junto al boton "Ver en mi mapa": SeleccionCapas.botonAgregar(dataset, botonVer)
   ========================================================= */
(() => {
    const CLAVE = "sinergia-capas";
    const MAX = 25;
    const MAPA = "/Mapa.html";

    function leer() {
        try {
            const lista = JSON.parse(localStorage.getItem(CLAVE) || "[]");
            return Array.isArray(lista) ? lista : [];
        } catch (e) {
            return [];
        }
    }
    function guardar(lista) {
        try { localStorage.setItem(CLAVE, JSON.stringify(lista)); } catch (e) { /* sin almacenamiento */ }
        pintar();
    }
    const clave = (c) => String(c.dataset || c.servicio);
    const esta = (id) => leer().some((c) => clave(c) === String(id));

    function agregar(capa) {
        const lista = leer().filter((c) => clave(c) !== clave(capa));
        if (lista.length >= MAX) {
            aviso(`Puedes juntar hasta ${MAX} capas. Quita alguna para agregar otra.`);
            return false;
        }
        lista.push({ servicio: capa.servicio, nombre: capa.nombre || "Capa", dataset: capa.dataset || "" });
        guardar(lista);
        aviso(`"${capa.nombre}" quedó en tu selección (${lista.length}).`);
        return true;
    }
    function quitar(id) { guardar(leer().filter((c) => clave(c) !== String(id))); }
    function vaciar() { guardar([]); }

    /* ---------- estilos (los colores siguen la paleta del sitio) ---------- */
    const css = document.createElement("style");
    css.textContent = `
    .sel-capas-btn { position: fixed; left: 22px; bottom: 22px; z-index: 900; display: none; align-items: center; gap: 9px;
        padding: 12px 16px; border: 0; border-radius: 999px; background: #282b2f; color: #fff; cursor: pointer;
        font: 700 14px "Inter", "Segoe UI", sans-serif; box-shadow: 0 12px 30px rgba(38,40,43,.25); }
    .sel-capas-btn.visible { display: inline-flex; }
    .sel-capas-btn svg { width: 19px; height: 19px; }
    .sel-capas-btn .cuenta { min-width: 22px; height: 22px; padding: 0 6px; border-radius: 999px; background: #f5c400; color: #282b2f;
        display: inline-grid; place-items: center; font-size: 12.5px; }
    .sel-capas-btn.salto { animation: selSalto .45s ease; }
    @keyframes selSalto { 40% { transform: scale(1.08); } }
    .sel-capas-panel { position: fixed; left: 22px; bottom: 78px; z-index: 901; width: min(380px, calc(100vw - 32px)); max-height: min(70vh, 560px);
        display: none; flex-direction: column; border-radius: 16px; background: #fff; border: 1px solid #e5e4dc;
        box-shadow: 0 18px 40px rgba(38,40,43,.18); font-family: "Inter", "Segoe UI", sans-serif; color: #282b2f; overflow: hidden; }
    .sel-capas-panel.abierto { display: flex; }
    .sel-capas-panel header { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 14px 16px;
        border-bottom: 1px solid #e5e4dc; background: #fff9df; }
    .sel-capas-panel header b { font-size: 15px; }
    .sel-capas-panel header small { display: block; color: #6f7479; font-size: 12px; margin-top: 2px; }
    .sel-capas-panel .cerrar { border: 0; background: transparent; font-size: 22px; line-height: 1; cursor: pointer; color: #6f7479; }
    .sel-capas-lista { list-style: none; margin: 0; padding: 8px; overflow-y: auto; flex: 1; }
    .sel-capas-lista li { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: center; padding: 9px 10px; border-radius: 10px; font-size: 13px; line-height: 1.35; }
    .sel-capas-lista li:nth-child(odd) { background: #f7f7f3; }
    .sel-capas-lista li button { border: 1px solid #e5e4dc; background: #fff; border-radius: 8px; padding: 4px 9px; cursor: pointer; font-size: 12px; color: #6f7479; }
    .sel-capas-lista li button:hover { color: #b42318; border-color: #f0b4ad; }
    .sel-capas-vacio { padding: 18px 16px; color: #6f7479; font-size: 13px; }
    .sel-capas-panel footer { display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid #e5e4dc; }
    .sel-capas-panel footer button { border-radius: 10px; padding: 10px 14px; cursor: pointer; font: 700 13px "Inter", "Segoe UI", sans-serif; }
    .sel-capas-ver { flex: 1; border: 1px solid #d4a900; background: #f5c400; color: #282b2f; }
    .sel-capas-vaciar { border: 1px solid #e5e4dc; background: #fff; color: #6f7479; }
    .sel-capas-aviso { position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%); z-index: 902; padding: 10px 16px; border-radius: 10px;
        background: #282b2f; color: #fff; font: 13px "Inter", "Segoe UI", sans-serif; opacity: 0; transition: opacity .2s; pointer-events: none; max-width: calc(100vw - 32px); }
    .sel-capas-aviso.visible { opacity: 1; }
    .action-link.sel-capas-agregar.agregada { background: #fff3b0; border-color: #d4a900; }
    @media (max-width: 640px) { .sel-capas-btn { left: 12px; bottom: 12px; } .sel-capas-panel { left: 12px; bottom: 66px; } }`;
    document.head.appendChild(css);

    const ICONO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/>
        <path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/></svg>`;

    /* ---------- bandeja flotante ---------- */
    const boton = document.createElement("button");
    boton.type = "button";
    boton.className = "sel-capas-btn";
    boton.title = "Capas que elegiste para ver juntas en el mapa";
    boton.innerHTML = `${ICONO}<span>Mi mapa</span><span class="cuenta">0</span>`;

    const panel = document.createElement("section");
    panel.className = "sel-capas-panel";
    panel.setAttribute("aria-label", "Mi selección de capas");
    panel.innerHTML = `
        <header><div><b>Mi selección de capas</b><small>Se verán todas juntas en el mapa</small></div>
            <button type="button" class="cerrar" aria-label="Cerrar">×</button></header>
        <ul class="sel-capas-lista"></ul>
        <footer><button type="button" class="sel-capas-vaciar">Vaciar</button>
            <button type="button" class="sel-capas-ver">Ver todas en el mapa</button></footer>`;

    const avisoEl = document.createElement("div");
    avisoEl.className = "sel-capas-aviso";
    let relojAviso = 0;
    function aviso(texto) {
        avisoEl.textContent = texto;
        avisoEl.classList.add("visible");
        clearTimeout(relojAviso);
        relojAviso = setTimeout(() => avisoEl.classList.remove("visible"), 2600);
    }

    const escapar = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));

    function pintar() {
        const lista = leer();
        boton.querySelector(".cuenta").textContent = lista.length;
        boton.classList.toggle("visible", lista.length > 0);
        if (!lista.length) panel.classList.remove("abierto");
        panel.querySelector(".sel-capas-lista").innerHTML = lista.length
            ? lista.map((c) => `<li><span>${escapar(c.nombre)}</span><button type="button" data-quitar="${escapar(clave(c))}">Quitar</button></li>`).join("")
            : `<li class="sel-capas-vacio">Todavía no has agregado capas.</li>`;
        panel.querySelector(".sel-capas-ver").textContent = `Ver ${lista.length === 1 ? "la capa" : "las " + lista.length + " capas"} en el mapa`;
        // los botones "Agregar" de la pagina muestran si su capa ya esta
        document.querySelectorAll(".sel-capas-agregar").forEach((b) => marcarBoton(b, esta(b.dataset.capa)));
    }
    function marcarBoton(b, si) {
        b.classList.toggle("agregada", si);
        b.textContent = si ? "En mi mapa ✓" : "+ Agregar a mi mapa";
        b.title = si ? "Ya está en tu selección. Clic para quitarla" : "Juntar esta capa con otras para verlas todas en el mapa";
    }

    boton.addEventListener("click", () => panel.classList.toggle("abierto"));
    panel.querySelector(".cerrar").addEventListener("click", () => panel.classList.remove("abierto"));
    panel.querySelector(".sel-capas-vaciar").addEventListener("click", vaciar);
    panel.querySelector(".sel-capas-ver").addEventListener("click", () => {
        if (leer().length) window.location.href = MAPA + "?seleccion=1";
    });
    panel.querySelector(".sel-capas-lista").addEventListener("click", (e) => {
        const b = e.target.closest("[data-quitar]");
        if (b) quitar(b.dataset.quitar);
    });
    // si se agrega una capa en otra pestana, esta tambien se entera
    window.addEventListener("storage", (e) => { if (e.key === CLAVE) pintar(); });

    function montar() {
        document.body.append(boton, panel, avisoEl);
        pintar();
    }
    if (document.body) montar(); else document.addEventListener("DOMContentLoaded", montar);

    /* ---------- enlace con las paginas de resultados ---------- */
    // "Agregar" reutiliza la busqueda del servicio que ya hace "Ver en mi mapa":
    // dispara ese boton marcado como "agregar", y abrirEnMapa llama a interceptar().
    function botonAgregar(dataset, botonVer) {
        if (!botonVer) return null;
        const id = String(dataset.id || "");
        const b = document.createElement("button");
        b.type = "button";
        b.className = (botonVer.className || "action-link") + " sel-capas-agregar";
        b.dataset.capa = id;
        marcarBoton(b, esta(id));
        // un clic de la persona en "Ver en mi mapa" siempre abre el mapa
        botonVer.addEventListener("click", (e) => { if (e.isTrusted) dataset.__accionMapa = "abrir"; }, true);
        b.addEventListener("click", () => {
            if (esta(id)) { quitar(id); return; }
            dataset.__accionMapa = "agregar";
            botonVer.click();
        });
        return b;
    }
    function interceptar(dataset, servicio, nombre) {
        if (!dataset || dataset.__accionMapa !== "agregar") return false;
        dataset.__accionMapa = "abrir";
        const ok = agregar({ servicio, nombre, dataset: String(dataset.id || "") });
        if (ok) {
            boton.classList.remove("salto");
            void boton.offsetWidth;
            boton.classList.add("salto");
        }
        return true;
    }

    window.SeleccionCapas = { leer, agregar, quitar, vaciar, botonAgregar, interceptar };
})();
