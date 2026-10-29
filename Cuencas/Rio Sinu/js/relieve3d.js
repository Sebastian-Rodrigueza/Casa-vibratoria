// Relieve 3D del rio Sinu: lo propio de esta cuenca encima del motor compartido (../motor3d/visor3d.js).
// Usa los ganchos de window.VISOR3D (alIniciar, alClic, alPestana) y los datos que genera
// herramientas/preparar_geoingenia.py a partir del paquete de capas de GeoIngenIA.
(() => {
    "use strict";
    const V = window.VISOR3D;
    let map, $, num, api, SER = null;
    const vacio = { type: "FeatureCollection", features: [] };
    const CAPAS_DIR = "datos/capas/";

    const COLOR = {
        inundacion: "#1f6feb", sequia: "#f0883e",          // los mismos de las imagenes originales
        nino: "#c4472c", nina: "#2f6db3", neutro: "#a9adb2", // diverging ONI (dos polos + gris)
        caudal: "#1f6feb", lluvia: "#2a9d8f", tinta: "#26292d", gris: "#70757b", reja: "rgba(38,41,45,.08)"
    };

    // ------------------------------------------------------------------
    // Capas tematicas (se cargan la primera vez que se prenden)
    // ------------------------------------------------------------------
    const CAPAS = {
        estaciones: { tipo: "circle", nombre: "Estaciones IDEAM",
            // las 21 con series de datos se ven mas grandes que las que son solo un punto
            paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"],
                    7, ["case", ["any", ["has", "con_caudal"], ["has", "con_lluvia"]], 5.5, 3], 11, ["case", ["any", ["has", "con_caudal"], ["has", "con_lluvia"]], 10, 6]],
                "circle-color": ["case", ["has", "con_caudal"], COLOR.caudal, ["has", "con_lluvia"], COLOR.lluvia, "#9aa0a6"],
                "circle-stroke-color": "#fff", "circle-stroke-width": 1.5,
                "circle-opacity": ["case", ["==", ["get", "estado"], "Activa"], 1, 0.55] } },
        // colores fuertes y borde del mismo tono: tienen que verse sobre el satelite y las subcuencas
        lotico_lentico_2020: { tipo: "fill", nombre: "Lótico / léntico 2020", borde: ["match", ["get", "tipo"], "lotico", "#0d47a1", "#1b5e20"],
            paint: { "fill-color": ["match", ["get", "tipo"], "lotico", "#1565c0", "#2e7d32"], "fill-opacity": 0.85 } },
        embalse: { tipo: "fill", nombre: "Embalse de Urrá", borde: "#01579b", paint: { "fill-color": "#0288d1", "fill-opacity": 0.85 } },
        lagunas: { tipo: "fill", nombre: "Lagunas y ciénagas", borde: "#006064", paint: { "fill-color": "#00acc1", "fill-opacity": 0.85 } },
        poblaciones: { tipo: "fill", nombre: "Cabeceras y centros poblados", borde: "#bf360c", paint: { "fill-color": "#ff8f00", "fill-opacity": 0.75 } },
        vias: { tipo: "line", nombre: "Vías principales", paint: { "line-color": "#212121", "line-width": ["interpolate", ["linear"], ["zoom"], 7, 2, 12, 4] } },
        puentes: { tipo: "circle", nombre: "Puentes", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 7, 6, 12, 10], "circle-color": "#111", "circle-stroke-color": "#fff", "circle-stroke-width": 2 } },
        plantas: { tipo: "circle", nombre: "Plantas de tratamiento", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 7, 7, 12, 11], "circle-color": "#00bfa5", "circle-stroke-color": "#fff", "circle-stroke-width": 2 } },
        rellenos: { tipo: "fill", nombre: "Rellenos sanitarios", borde: "#4a148c", paint: { "fill-color": "#8e24aa", "fill-opacity": 0.85 } },
        desastres: { tipo: "circle", nombre: "Desastres registrados", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 7, 8, 12, 12], "circle-color": "#c62828", "circle-stroke-color": "#fff", "circle-stroke-width": 2.5 } },
        parque_paramillo: { tipo: "fill", nombre: "Parque Nacional Paramillo", borde: "#1b5e20", paint: { "fill-color": "#2e7d32", "fill-opacity": 0.5 } },
        sinap: { tipo: "fill", nombre: "Otras áreas SINAP", borde: "#1b5e20", paint: { "fill-color": "#43a047", "fill-opacity": 0.45 } },
        reserva_ley2: { tipo: "fill", nombre: "Reserva forestal Ley 2ª", borde: "#827717", paint: { "fill-color": "#afb42b", "fill-opacity": 0.45 } },
        dmi: { tipo: "fill", nombre: "Distritos de manejo integrado", borde: "#004d40", paint: { "fill-color": "#00897b", "fill-opacity": 0.55 } },
        conservacion_suelo: { tipo: "fill", nombre: "Distritos de conservación de suelo", borde: "#33691e", paint: { "fill-color": "#7cb342", "fill-opacity": 0.65 } },
        rnsc: { tipo: "fill", nombre: "Reservas de la sociedad civil", borde: "#880e4f", paint: { "fill-color": "#d81b60", "fill-opacity": 0.7 } },
        clase_suelo: { tipo: "fill", nombre: "Clase agrológica del suelo", borde: "rgba(60,40,20,.45)",
            paint: { "fill-color": ["match", ["get", "clase"], 1, "#fff176", 2, "#ffd54f", 3, "#ffb74d", 4, "#ff8a65", 5, "#e57373", 6, "#a1887f", 7, "#795548", 8, "#4e342e", "#bdbdbd"],
                "fill-opacity": 0.75 } },
        // camellones zenues: todas salen de camellones.geojson, separadas por su propiedad "capa"
        camellones: { tipo: "fill", nombre: "Camellones confirmados (San Jorge)", archivo: "camellones", filtro: ["camellon"], zoom: 15, borde: "rgba(120,40,0,.6)",
            paint: { "fill-color": ["interpolate", ["linear"], ["coalesce", ["get", "alt_cons_m"], 0.3], 0.2, "#fde68a", 0.35, "#f59e0b", 0.5, "#c2410c"], "fill-opacity": 0.8 } },
        franjas: { tipo: "fill", nombre: "Franjas candidatas (Isla Pérez)", archivo: "camellones", filtro: ["franja", "eje"], zoom: 14, borde: "#f0abfc",
            paint: { "fill-color": "#e879f9", "fill-opacity": 0.35 } },
        cauces_antiguos: { tipo: "fill", nombre: "Cauces antiguos", archivo: "camellones", filtro: ["paleocauce"], zoom: 11, borde: "#60a5fa",
            paint: { "fill-color": "#3b82f6", "fill-opacity": 0.4 } },
        plataformas: { tipo: "fill", nombre: "Plataformas de vivienda (San Jorge)", archivo: "camellones", filtro: ["plataforma"], zoom: 15, borde: "#cffafe",
            paint: { "fill-color": "#22d3ee", "fill-opacity": 0.6 } },
        montejo: { tipo: "fill", nombre: "Montejo y Rojas (1992), aproximado", archivo: "camellones", filtro: ["area_montejo", "area_estudio"], zoom: 11, borde: "#fde047",
            paint: { "fill-color": "#fde047", "fill-opacity": 0.08 } },
        sitios_montejo: { tipo: "circle", nombre: "Sitios prospectados (1992)", archivo: "camellones", filtro: ["sitio_montejo"], zoom: 11, etiqueta: "sitio",
            paint: { "circle-radius": 7, "circle-color": "#fde047", "circle-stroke-color": "#000", "circle-stroke-width": 1.5 } },
        zonas_revisadas: { tipo: "line", nombre: "Zonas revisadas en Google Earth", archivo: "camellones", filtro: ["zona_revisada"], zoom: 11,
            paint: { "line-width": 3, "line-color": ["match", ["get", "resultado"], "candidata", "#22c55e", "sin patrón", "#cbd5e1", "descartada: labranza moderna", "#ef4444", "#999"] } },
        cienagas_1963: { tipo: "fill", nombre: "Ciénagas de 1963 (planchas INCORA)", zoom: 13.5, borde: "#22d3ee",
            paint: { "fill-color": "#22d3ee", "fill-opacity": 0.3 } }
    };
    // un archivo se descarga una sola vez aunque lo usen varias capas
    const archivos = {};
    const leerArchivo = (a) => archivos[a] || (archivos[a] = fetch(CAPAS_DIR + a + ".geojson").then((r) => r.json()));
    // Cada capa se descarga y se agrega al mapa una sola vez (oculta); prender o apagar solo cambia
    // su visibilidad, que es inmediato. Al abrir el visor se precargan todas en segundo plano.
    const cargas = {};
    // las areas y las imagenes de agua van debajo de los rios (si esa capa no esta, encima de todo)
    const debajoDeRios = () => ["rios-halo", "rios"].find((id) => map.getLayer(id));
    function cargarCapa(k) {
        if (cargas[k]) return cargas[k];
        cargas[k] = (async () => {
            const c = CAPAS[k];
            let datos = await leerArchivo(c.archivo || k);
            if (c.filtro) datos = { type: "FeatureCollection", features: datos.features.filter((f) => c.filtro.includes(f.properties.capa)) };
            c.datos = datos;
            map.addSource("sinu-" + k, { type: "geojson", data: datos });
            const oculta = { visibility: "none" };
            // las areas van debajo de los rios; los puntos encima de todo
            const antes = c.tipo === "fill" ? debajoDeRios() : undefined;
            map.addLayer({ id: "sinu-" + k, type: c.tipo, source: "sinu-" + k, paint: c.paint, layout: oculta }, antes);
            if (c.tipo === "fill") map.addLayer({ id: "sinu-" + k + "-borde", type: "line", source: "sinu-" + k, layout: oculta,
                paint: { "line-color": c.borde || "#fff", "line-width": ["interpolate", ["linear"], ["zoom"], 7, 1.2, 12, 2.5] } }, antes);
            if (k === "estaciones") {
                map.addLayer({ id: "sinu-estaciones-etq", type: "symbol", source: "sinu-estaciones", minzoom: 9.5,
                    layout: { visibility: "none", "text-field": ["get", "nombre"], "text-font": ["Noto Sans Bold"], "text-size": 11, "text-offset": [0, 1.1], "text-anchor": "top" },
                    paint: { "text-color": "#fff", "text-halo-color": "rgba(10,20,30,.9)", "text-halo-width": 1.5 } });
                listaEstaciones();
            }
            if (c.etiqueta) map.addLayer({ id: "sinu-" + k + "-etq", type: "symbol", source: "sinu-" + k,
                layout: { visibility: "none", "text-field": ["get", c.etiqueta], "text-font": ["Noto Sans Bold"], "text-size": 12, "text-offset": [0, 1.1], "text-anchor": "top" },
                paint: { "text-color": "#fff", "text-halo-color": "rgba(10,20,30,.9)", "text-halo-width": 1.5 } });
        })();
        cargas[k].catch(() => { delete cargas[k]; });
        return cargas[k];
    }
    function verCapa(k, si) {
        ["", "-borde", "-etq"].forEach((s) => {
            if (map.getLayer("sinu-" + k + s)) map.setLayoutProperty("sinu-" + k + s, "visibility", si ? "visible" : "none");
        });
    }
    async function prenderCapa(k, si) {
        if (map.getLayer("sinu-" + k)) return verCapa(k, si);   // ya cargada: inmediato
        await cargarCapa(k);
        // la casilla manda: si la apagaron mientras cargaba, queda apagada
        const chk = document.querySelector(`[data-capa-sinu="${k}"]`);
        verCapa(k, chk ? chk.checked : si);
    }
    // Al prender una capa el mapa va a ella (varias son pequenas a la escala de la cuenca)
    function cajaDe(fc) {
        let a = [180, 90, -180, -90];
        const rec = (c) => { if (typeof c[0] === "number") a = [Math.min(a[0], c[0]), Math.min(a[1], c[1]), Math.max(a[2], c[0]), Math.max(a[3], c[1])]; else c.forEach(rec); };
        fc.features.forEach((f) => rec(f.geometry.coordinates));
        return [[a[0], a[1]], [a[2], a[3]]];
    }
    function irA(caja, maxZoom = 12) {
        const izq = window.innerWidth > 900 ? 380 : 20, der = $("ficha").hidden ? 60 : 380;
        map.fitBounds(caja, { padding: { top: 90, bottom: 70, left: izq, right: der }, maxZoom, pitch: Math.min(map.getPitch(), 50), duration: 1400 });
    }
    let tAviso = 0;
    function aviso(html) {
        let el = document.getElementById("avisoSinu");
        if (!el) {
            el = document.createElement("div");
            el.id = "avisoSinu";
            el.className = "aviso-sinu";
            document.body.appendChild(el);
        }
        el.innerHTML = html;
        el.hidden = false;
        clearTimeout(tAviso);
        tAviso = setTimeout(() => { el.hidden = true; }, 3200);
    }
    async function mostrarCapa(k) {
        await prenderCapa(k, true);
        const c = CAPAS[k];
        if (!c.datos || !document.querySelector(`[data-capa-sinu="${k}"]`).checked) return;
        const n = c.datos.features.length;
        const color = c.paint["fill-color"] || c.paint["circle-color"] || c.paint["line-color"];
        aviso(`<i style="background:${typeof color === "string" ? color : "#1565c0"}"></i><b>${c.nombre}</b> · ${num(n)} ${n === 1 ? "elemento" : "elementos"}`);
        if (k !== "estaciones") irA(cajaDe(c.datos), c.zoom || (n === 1 && c.tipo === "circle" ? 12 : 11.5));
    }

    // Mapas historicos georreferenciados (1864 y planchas INCORA 1963) puestos sobre el terreno
    const HISTORICOS = { "1864": ["bolivar_1864"], "1963": ["incora_61-IB-4d", "incora_61-IB-2b"] };
    // las imagenes viejas van debajo de las capas tematicas (para ver las cienagas de 1963 encima)
    const debajoDeCapas = () => (map.getStyle().layers.find((l) => l.id.startsWith("sinu-") && l.id !== "sinu-cuenca") || {}).id || debajoDeRios();
    function verHistorico(cual, si) {
        const M = SER && SER.historicos && SER.historicos.mapas;
        if (!M) return;
        const op = +$("rngHis").value / 100;
        HISTORICOS[cual].forEach((k) => {
            if (!map.getSource("his-" + k)) {
                const c = M[k].caja;
                map.addSource("his-" + k, { type: "image", url: M[k].url, coordinates: [[c[0], c[3]], [c[2], c[3]], [c[2], c[1]], [c[0], c[1]]] });
                map.addLayer({ id: "his-" + k, type: "raster", source: "his-" + k, paint: { "raster-fade-duration": 0, "raster-opacity": op } }, debajoDeCapas());
            }
            map.setLayoutProperty("his-" + k, "visibility", si ? "visible" : "none");
        });
        if (!si) return;
        const cajas = HISTORICOS[cual].map((k) => M[k].caja);
        const caja = cual === "1864" ? [[-76.2, 8.62], [-75.5, 9.45]]
            : [[Math.min(...cajas.map((c) => c[0])), Math.min(...cajas.map((c) => c[1]))], [Math.max(...cajas.map((c) => c[2])), Math.max(...cajas.map((c) => c[3]))]];
        irA(caja, cual === "1864" ? 10 : 14);
        aviso(cual === "1864" ? `<i style="background:#d8c9a8"></i><b>Carta de Bolívar, 1864</b> · posición aproximada (error de kilómetros)`
            : `<i style="background:#fff;border:1px solid #999"></i><b>Planchas INCORA, 1963</b> · error de 5 a 7 m`);
    }
    function opacidadHistoricos() {
        Object.values(HISTORICOS).flat().forEach((k) => { if (map.getLayer("his-" + k)) map.setPaintProperty("his-" + k, "raster-opacity", +$("rngHis").value / 100); });
    }

    // Relieve local LiDAR 1 m de San Marcos (Vieri et al. 2026): imagen sobre el terreno 3D
    function verLidar(si) {
        const L = SER && SER.camellones && SER.camellones.lidar;
        if (!L) return;
        if (!map.getSource("lidar-cam")) {
            const c = L.caja;
            map.addSource("lidar-cam", { type: "image", url: L.url, coordinates: [[c[0], c[3]], [c[2], c[3]], [c[2], c[1]], [c[0], c[1]]] });
            map.addLayer({ id: "lidar-cam", type: "raster", source: "lidar-cam", paint: { "raster-fade-duration": 0 } }, debajoDeRios());
        }
        map.setLayoutProperty("lidar-cam", "visibility", si ? "visible" : "none");
        if (si) {
            const c = L.caja;
            irA([[c[0], c[1]], [c[2], c[3]]], 15.5);
            aviso(`<i style="background:linear-gradient(90deg,#222,#eee)"></i><b>Relieve LiDAR de San Marcos</b> · los camellones son las franjas claras`);
        }
    }
    // En Territorio, Agua y Estaciones las subcuencas se atenuan para que se vea lo que se prende
    const OPACIDAD_SUB = ["case", ["boolean", ["feature-state", "sel"], false], 0.55, ["boolean", ["feature-state", "hover"], false], 0.45, 0.28];
    const OPACIDAD_SUB_TENUE = ["case", ["boolean", ["feature-state", "sel"], false], 0.3, ["boolean", ["feature-state", "hover"], false], 0.18, 0.04];
    function atenuarSubcuencas(si) {
        if (map.getLayer("sub-relleno")) map.setPaintProperty("sub-relleno", "fill-opacity", si ? OPACIDAD_SUB_TENUE : OPACIDAD_SUB);
        if (map.getLayer("etiquetas")) map.setPaintProperty("etiquetas", "text-opacity", si ? 0.55 : 1);
    }

    async function precargar() {
        // de la mas liviana a la mas pesada, una por una para no trabar el mapa
        const orden = ["estaciones", "embalse", "plantas", "puentes", "desastres", "rellenos", "vias", "dmi", "parque_paramillo", "sinap",
            "reserva_ley2", "rnsc", "conservacion_suelo", "lagunas", "poblaciones", "lotico_lentico_2020", "clase_suelo"];
        for (const k of orden) {
            try { await cargarCapa(k); } catch (e) { console.warn("No se pudo precargar", k, e); }
            await new Promise((r) => setTimeout(r, 60));
        }
    }
    function capasClicables() {
        // el borde tambien cuenta: ahi estan las lineas (ejes y cauces de Isla Perez) de las capas de relleno
        return Object.keys(CAPAS).filter((k) => map.getLayer("sinu-" + k) && map.getLayoutProperty("sinu-" + k, "visibility") !== "none")
            .flatMap((k) => map.getLayer("sinu-" + k + "-borde") ? ["sinu-" + k, "sinu-" + k + "-borde"] : ["sinu-" + k]);
    }

    // Graficas compartidas con el dashboard (js/graficas.js)
    const grafica = (...a) => window.Graficas.grafica(...a);
    const cajaGrafica = (id, titulo, extra = "") => `<div class="g-caja"><div class="g-titulo">${titulo}</div>${extra}
        <div class="g-lienzo"><svg id="${id}"></svg><div class="g-tip" hidden></div></div></div>`;

    // ------------------------------------------------------------------
    // Pestana Agua: inundacion y sequia por ano, ONI, lotico/lentico
    // ------------------------------------------------------------------
    // las imagenes de agua solo se ven mientras la pestana Agua esta abierta
    const AG = { modo: "inundacion", i: 0, anios: [], play: 0, activo: false };
    function prepararAgua() {
        const A = SER.agua, c = A.caja;
        const coords = [[c[0], c[3]], [c[2], c[3]], [c[2], c[1]], [c[0], c[1]]];
        AG.anios = A.anios.inundacion.filter((a) => A.anios.sequia.includes(a)).sort((a, b) => a - b);
        AG.i = AG.anios.length - 1;
        const primera = AG.anios[AG.i];
        ["inundacion", "sequia"].forEach((t) => {
            map.addSource("agua-" + t, { type: "image", url: `datos/agua/${t}_${primera}.png`, coordinates: coords });
            map.addLayer({ id: "agua-" + t, type: "raster", source: "agua-" + t, layout: { visibility: "none" },
                paint: { "raster-opacity": 0.9, "raster-fade-duration": 0, "raster-resampling": "linear" } }, debajoDeRios());
        });
        $("rngAnio").max = AG.anios.length - 1;
        $("rngAnio").value = AG.i;
        $("rngAnio").oninput = () => { pararPlay(); ponerAnio(+$("rngAnio").value); };
        document.querySelectorAll("#segAgua button").forEach((b) => b.onclick = () => {
            AG.modo = b.dataset.modo;
            document.querySelectorAll("#segAgua button").forEach((x) => x.classList.toggle("activo", x === b));
            ponerAnio(AG.i);
        });
        $("btnPlayAgua").onclick = () => {
            if (AG.play) return pararPlay();
            $("btnPlayAgua").innerHTML = `<i data-lucide="pause"></i>`; lucide.createIcons();
            AG.play = setInterval(() => ponerAnio((AG.i + 1) % AG.anios.length), 900);
        };
        $("chkLotico").onchange = () => prenderCapa("lotico_lentico_2020", $("chkLotico").checked);
        // lotico/lentico por subcuenca (2020)
        const lot = [...SER.lotico_lentico].sort((a, b) => b.pct_agua - a.pct_agua).slice(0, 8);
        const max = Math.max(...lot.map((r) => r.pct_agua));
        $("listaLotico").innerHTML = lot.map((r) => `<li data-nombre="${r.nombre}"><b>${r.nombre}</b><span>${num(r.pct_agua, 1)} %</span>
            <div class="rb"><span style="width:${(100 * r.pct_agua / max).toFixed(0)}%"></span></div>
            <small>${num(r.ha_agua)} ha de agua · ${num(r.ha_lentico)} ha léntico · ${num(r.ha_lotico)} ha lótico</small></li>`).join("");
        $("listaLotico").querySelectorAll("li").forEach((li) => li.onclick = () => {
            const f = api.S.sub.features.find((x) => sinTildes(x.properties.nombre) === sinTildes(li.dataset.nombre));
            if (f) api.seleccionar(f.properties.id, true);
        });
        ponerAnio(AG.i);
    }
    const sinTildes = (t) => (t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
    function pararPlay() { clearInterval(AG.play); AG.play = 0; $("btnPlayAgua").innerHTML = `<i data-lucide="play"></i>`; lucide.createIcons(); }
    function oniAnual() {
        if (AG.oni) return AG.oni;
        const por = {};
        SER.oni_roni.forEach(([y, , o, r]) => { (por[y] = por[y] || { o: [], r: [] }); if (o != null) por[y].o.push(o); if (r != null) por[y].r.push(r); });
        const media = (a) => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
        AG.oni = Object.entries(por).map(([y, v]) => [+y, media(v.o), media(v.r)]).filter(([y]) => y >= 1984);
        return AG.oni;
    }
    function ponerAnio(i) {
        AG.i = i;
        const anio = AG.anios[i];
        $("rngAnio").value = i;
        $("txtAnio").textContent = anio;
        ["inundacion", "sequia"].forEach((t) => {
            const ver = AG.activo && (AG.modo === t || AG.modo === "ambas");
            map.setLayoutProperty("agua-" + t, "visibility", ver ? "visible" : "none");
            if (ver) map.getSource("agua-" + t).updateImage({ url: `datos/agua/${t}_${anio}.png` });
        });
        const fila = SER.area_agua.find((r) => r[0] === anio) || [];
        const oni = oniAnual().find((r) => r[0] === anio);
        const fase = oni && oni[1] != null ? (oni[1] >= 0.5 ? "El Niño" : oni[1] <= -0.5 ? "La Niña" : "neutral") : "—";
        $("aguaDatos").innerHTML = `
            <div class="dato"><small>Inundación máxima</small><b>${fila[1] != null ? num(fila[1], 1) + " km²" : "—"}</b></div>
            <div class="dato"><small>Agua persistente</small><b>${fila[2] != null ? num(fila[2], 1) + " km²" : "—"}</b></div>
            <div class="dato"><small>ONI del año</small><b>${oni && oni[1] != null ? num(oni[1], 2) : "—"}</b><small>${fase}</small></div>`;
        grafica($("gArea"), [
            { nombre: "Inundación máxima", color: COLOR.inundacion, puntos: SER.area_agua.map((r) => [r[0], r[1]]) },
            { nombre: "Agua persistente", color: COLOR.sequia, puntos: SER.area_agua.map((r) => [r[0], r[2]]) }
        ], { unidad: "km²", marcarX: anio, alClicX: (x) => { const k = AG.anios.indexOf(x); if (k >= 0) { pararPlay(); ponerAnio(k); } } });
        grafica($("gOni"), [{ nombre: "ONI", color: COLOR.neutro, puntos: oniAnual().map((r) => [r[0], r[1]]) }], {
            barras: true, cero: true, marcarX: anio,
            colorBarra: (x, y) => y >= 0.5 ? COLOR.nino : y <= -0.5 ? COLOR.nina : COLOR.neutro,
            alClicX: (x) => { const k = AG.anios.indexOf(x); if (k >= 0) { pararPlay(); ponerAnio(k); } }
        });
    }

    // ------------------------------------------------------------------
    // Pestana Indices: NDVI, NDWI y MNDWI por ano sobre el terreno (o como color de las subcuencas)
    // ------------------------------------------------------------------
    const IDX = ["NDVI", "NDWI", "MNDWI"];
    const COL_ZONA = { "Alto Sinú - Urrá": "#2a78d6", "Medio Sinú": "#e0a100", "Bajo Sinú": "#2a9d8f" };
    const IX = { ind: "NDVI", vista: "pixel", i: 0, play: 0, activo: false, listo: false };
    const urlIdx = (k, a) => `datos/indices/${k.toLowerCase()}_${a}.png`;
    function prepararIndices() {
        const X = SER.indices, c = X.raster.caja;
        IX.listo = true;
        IX.i = X.anios.indexOf(2025);
        map.addSource("idx3d", { type: "image", url: urlIdx(IX.ind, X.anios[IX.i]), coordinates: [[c[0], c[3]], [c[2], c[3]], [c[2], c[1]], [c[0], c[1]]] });
        map.addLayer({ id: "idx3d", type: "raster", source: "idx3d", layout: { visibility: "none" },
            paint: { "raster-opacity": 0.9, "raster-fade-duration": 0, "raster-resampling": "nearest" } }, debajoDeRios());
        $("rngIdx3d").max = X.anios.length - 1;
        $("rngIdx3d").oninput = () => { pararIdx(); ponerIdx(+$("rngIdx3d").value); };
        $("btnPlayIdx3d").onclick = () => {
            if (IX.play) return pararIdx();
            X.anios.forEach((a) => { new Image().src = urlIdx(IX.ind, a); });
            $("btnPlayIdx3d").innerHTML = `<i data-lucide="pause"></i>`; lucide.createIcons();
            IX.play = setInterval(() => ponerIdx((IX.i + 1) % X.anios.length), 900);
        };
        document.querySelectorAll("#segIdx3d button").forEach((b) => b.onclick = () => {
            IX.ind = b.dataset.i;
            document.querySelectorAll("#segIdx3d button").forEach((x) => x.classList.toggle("activo", x === b));
            ponerIdx(IX.i);
        });
        document.querySelectorAll("#segIdxVista3d button").forEach((b) => b.onclick = () => {
            IX.vista = b.dataset.v;
            document.querySelectorAll("#segIdxVista3d button").forEach((x) => x.classList.toggle("activo", x === b));
            if (IX.vista === "pixel") { api.colorear(); atenuarSubcuencas(true); }
            ponerIdx(IX.i);
        });
    }
    function pararIdx() { clearInterval(IX.play); IX.play = 0; $("btnPlayIdx3d").innerHTML = `<i data-lucide="play"></i>`; lucide.createIcons(); }
    // expresion de color con la misma paleta de las imagenes
    function rampaIdx(k, prop) {
        const R = SER.indices.raster, [lo, hi] = R.rango[k], p = R.paleta[k];
        const e = ["interpolate", ["linear"], ["get", prop]];
        p.forEach((c, n) => e.push(lo + (hi - lo) * n / (p.length - 1), c));
        return ["case", ["has", prop], e, "rgba(0,0,0,0)"];
    }
    const valorIdx = (id, k, j) => { const v = SER.indices.sub[id] && SER.indices.sub[id][j]; return v ? v[IDX.indexOf(k)] : null; };
    function ponerIdx(i) {
        const X = SER.indices, R = X.raster, a = X.anios[i], k = IX.ind;
        IX.i = i;
        $("rngIdx3d").value = i;
        $("txtIdx3d").textContent = a;
        const pixel = IX.activo && IX.vista === "pixel";
        map.setLayoutProperty("idx3d", "visibility", pixel ? "visible" : "none");
        if (pixel) map.getSource("idx3d").updateImage({ url: urlIdx(k, a) });
        if (IX.activo && IX.vista === "sub") {
            api.S.sub.features.forEach((f) => { const v = valorIdx(f.properties.id, k, i); if (v != null) f.properties.vidx = v; else delete f.properties.vidx; });
            map.getSource("subcuencas").setData(api.S.sub);
            map.setPaintProperty("sub-relleno", "fill-color", rampaIdx(k, "vidx"));
            map.setPaintProperty("sub-relleno", "fill-opacity", ["case", ["boolean", ["feature-state", "sel"], false], 0.95, 0.82]);
        }
        const [lo, hi] = R.rango[k];
        $("leyIdx3d").innerHTML = `<div class="barra" style="background:linear-gradient(90deg,${R.paleta[k].join(",")})"></div>
            <div class="extremos"><span>${num(lo, 1)} ${k === "NDVI" ? "suelo / agua" : "tierra"}</span><span>${num(hi, 1)} ${k === "NDVI" ? "vegetación densa" : "agua"}</span></div>`;
        const vc = X.cuenca[i][X.campos.indexOf(k)];
        const vent = X.ventana[i];
        $("idxDatos").innerHTML = `
            <div class="dato"><small>${k} de la cuenca</small><b>${num(vc, 3)}</b></div>
            <div class="dato"><small>Imágenes</small><b>${num(X.escenas[i])}</b></div>
            <div class="dato"><small>Compuesto</small><b>${vent ? vent + " meses" : "el año"}</b></div>`;
        $("notaIdx3d").textContent = `${a}: ${X.sensores[i]}${X.notas[a] ? " · " + X.notas[a] : ""}.`;
        $("tituloIdx3d").textContent = `${k} promedio por año`;
        const sel = api.S.sel;
        const series = [{ nombre: "Toda la cuenca", color: "#26292d", puntos: X.anios.map((y, j) => [y, X.cuenca[j][X.campos.indexOf(k)]]) }]
            .concat(Object.entries(COL_ZONA).filter(([z]) => X.zonas[z]).map(([z, cz]) => ({ nombre: z, color: cz,
                puntos: X.anios.map((y, j) => [y, X.zonas[z].v[j][IDX.indexOf(k)]]) })));
        if (sel != null && X.sub[sel]) series.push({ nombre: api.S.porId.get(sel).properties.nombre, color: "#c4472c", puntos: X.anios.map((y, j) => [y, valorIdx(sel, k, j)]) });
        $("leySubIdx3d").hidden = !(sel != null && X.sub[sel]);
        grafica($("gIdx3d"), series, { cero: false, bandas: [[X.sensor - 0.5, X.sensor + 0.5]], marcarX: a,
            alClicX: (x) => { const j = X.anios.indexOf(x); if (j >= 0) { pararIdx(); ponerIdx(j); } } });
    }
    // bloque de indices en la ficha de cada subcuenca
    function fichaIndices(p, ficha) {
        const X = SER && SER.indices;
        if (!X || !X.sub[p.id]) return;
        const j13 = X.anios.indexOf(X.sensor), j25 = X.anios.indexOf(2025);
        const v25 = valorIdx(p.id, "NDVI", j25), v13 = valorIdx(p.id, "NDVI", j13), w25 = valorIdx(p.id, "MNDWI", j25);
        const d = v25 != null && v13 != null ? v25 - v13 : null;
        const div = document.createElement("div");
        div.innerHTML = `<h3>Vegetación y agua (Landsat)</h3>
            <div class="datos">
                <div class="dato"><small>NDVI 2025</small><b>${v25 != null ? num(v25, 2) : "—"}</b></div>
                <div class="dato"><small>Cambio desde ${X.sensor}</small><b>${d != null ? (d > 0 ? "+" : "") + num(d, 3) : "—"}</b></div>
                <div class="dato"><small>MNDWI 2025</small><b>${w25 != null ? num(w25, 2) : "—"}</b></div>
            </div>
            <div class="g-lienzo"><svg id="gFichaIdx" style="height:110px"></svg><div class="g-tip" hidden></div></div>
            <p class="explica">NDVI promedio de la subcuenca por año (rojo) contra toda la cuenca (gris). La franja gris es el cambio de satélite
                (2012 → 2013): compara solo años del mismo lado. Más en la pestaña Índices.</p>`;
        const acc = ficha.querySelector(".acciones");
        [...div.children].forEach((n) => ficha.insertBefore(n, acc));
        grafica($("gFichaIdx"), [
            { nombre: "Toda la cuenca", color: "#a9adb2", puntos: X.anios.map((y, j) => [y, X.cuenca[j][0]]) },
            { nombre: p.nombre, color: "#c4472c", puntos: X.anios.map((y, j) => [y, valorIdx(p.id, "NDVI", j)]) }
        ], { cero: false, bandas: [[X.sensor - 0.5, X.sensor + 0.5]] });
        if (IX.activo) ponerIdx(IX.i);   // suma la subcuenca a la grafica de la pestana
    }

    // ------------------------------------------------------------------
    // Pestana Estaciones
    // ------------------------------------------------------------------
    // por defecto solo las activas: las 114 suspendidas llenaban el mapa y no tienen datos
    let filtroEst = "activas";
    const FILTRO_MAPA = {
        activas: ["==", ["get", "estado"], "Activa"],
        datos: ["any", ["has", "con_caudal"], ["has", "con_lluvia"]],
        caudal: ["has", "con_caudal"],
        lluvia: ["has", "con_lluvia"],
        todas: ["boolean", true]
    };
    function listaEstaciones() {
        const c = CAPAS.estaciones.datos;
        if (!c) return;
        const q = sinTildes($("buscaEst").value);
        const lista = c.features.filter((f) => {
            const p = f.properties;
            if (filtroEst === "caudal" && !p.con_caudal) return false;
            if (filtroEst === "lluvia" && !p.con_lluvia) return false;
            if (filtroEst === "activas" && p.estado !== "Activa") return false;
            if (filtroEst === "datos" && !p.con_caudal && !p.con_lluvia) return false;
            return !q || sinTildes(p.nombre + " " + p.municipio + " " + p.codigo).includes(q);
        }).sort((a, b) => (b.properties.con_caudal ? 2 : 0) + (b.properties.con_lluvia ? 1 : 0) - (a.properties.con_caudal ? 2 : 0) - (a.properties.con_lluvia ? 1 : 0)
            || a.properties.nombre.localeCompare(b.properties.nombre));
        $("estCuenta").textContent = `${lista.length} de ${c.features.length} estaciones`;
        ["sinu-estaciones", "sinu-estaciones-etq"].forEach((l) => { if (map.getLayer(l)) map.setFilter(l, FILTRO_MAPA[filtroEst]); });
        $("listaEst").innerHTML = lista.slice(0, 120).map((f) => {
            const p = f.properties;
            const chips = (p.con_caudal ? `<span class="chip" style="background:#e3edfd;color:#174ea6">caudal</span>` : "") +
                (p.con_lluvia ? `<span class="chip" style="background:#e0f2ef;color:#1d6b62">lluvia</span>` : "");
            return `<li data-cod="${p.codigo}"><b>${p.nombre.replace(/\s*\[\d+\]$/, "")}</b><span>${chips}</span>
                <small>${p.categoria} · ${p.municipio} · ${p.estado}</small></li>`;
        }).join("");
        $("listaEst").querySelectorAll("li").forEach((li) => li.onclick = () => fichaEstacion(li.dataset.cod, true));
    }
    function fichaEstacion(cod, volar) {
        const f = CAPAS.estaciones.datos.features.find((x) => x.properties.codigo === cod);
        if (!f) return;
        const p = f.properties, s = SER.estaciones[cod] || {};
        const fila = (k, v) => v ? `<tr><td>${k}</td><td>${v}</td></tr>` : "";
        let html = `<button type="button" class="cerrar" id="fichaCerrarEst" title="Cerrar"><i data-lucide="x"></i></button>
            <span class="eti" style="background:${p.con_caudal ? COLOR.caudal : p.con_lluvia ? COLOR.lluvia : "#9aa0a6"}">Estación IDEAM</span>
            <h2>${p.nombre.replace(/\s*\[\d+\]$/, "")}</h2>
            <p class="sub">Código ${p.codigo} · ${p.categoria} (${(p.tecnologia || "").toLowerCase()})</p>
            <table class="t-ficha">
                ${fila("Estado", p.estado + (p.suspendida ? ` desde ${p.suspendida}` : ""))}
                ${fila("Municipio", `${p.municipio}, ${p.departamento}`)}
                ${fila("Altitud", p.altitud != null ? num(p.altitud) + " m" : "")}
                ${fila("Corriente", p.corriente)}
                ${fila("Instalada", p.instalada)}
                ${fila("Entidad", p.entidad)}
            </table>`;
        const bloques = [];
        if (s.qa) bloques.push(["caudal", "Caudal", "m³/s", COLOR.caudal, s.qa, s.qm]);
        if (s.pa) bloques.push(["lluvia", "Lluvia", "mm", COLOR.lluvia, s.pa, s.pm]);
        bloques.forEach(([k, nom, u, col, anual, mensual]) => {
            html += cajaGrafica("gEstA_" + k, `${nom} promedio por año (${u})`) + cajaGrafica("gEstM_" + k, `${nom}: cómo se reparte en el año (promedio de cada mes, ${u})`);
        });
        if (!bloques.length) html += `<p class="explica">El paquete no trae series de caudal ni de lluvia para esta estación.</p>`;
        html += `<p class="fuente-ficha">Fuente: IDEAM (catálogo de estaciones y series), procesado por GeoIngenIA.</p>`;
        $("ficha").innerHTML = html;
        $("ficha").hidden = false;
        lucide.createIcons();
        $("fichaCerrarEst").onclick = () => { $("ficha").hidden = true; };
        const G = window.Graficas;
        bloques.forEach(([k, nom, u, col, anual, mensual]) => {
            // solo anos con 10 meses o mas: el promedio del archivo con 1 o 2 meses engana
            const { puntos, fuera } = G.anualCompleto(mensual);
            grafica($("gEstA_" + k), [{ nombre: nom, color: col, puntos }], { unidad: u });
            if (fuera.length) $("gEstA_" + k).closest(".g-caja").insertAdjacentHTML("beforeend",
                `<p class="explica">Sin contar ${fuera.length} año${fuera.length > 1 ? "s" : ""} con menos de 10 meses de datos (${fuera.join(", ")}).</p>`);
            grafica($("gEstM_" + k), [{ nombre: nom, color: col, puntos: G.regimen(mensual) }], { unidad: u, barras: true, fmtX: (m) => G.MES[m] });
        });
        if (volar) map.flyTo({ center: f.geometry.coordinates, zoom: Math.max(map.getZoom(), 10.5), duration: 1800 });
    }

    // ------------------------------------------------------------------
    // Fichas de las demas capas (popup)
    // ------------------------------------------------------------------
    function textoPopup(k, p) {
        const fila = (a, b) => b != null && b !== "" ? `<tr><td>${a}</td><td>${b}</td></tr>` : "";
        const tabla = (filas) => `<table class="pop-t">${filas.join("")}</table>`;
        const t = CAPAS[k].nombre;
        let cuerpo = "";
        if (k === "lotico_lentico_2020") cuerpo = tabla([fila("Tipo", p.tipo === "lotico" ? "Lótico (agua que corre)" : "Léntico (agua quieta)"), fila("Permanencia", p.permanencia), fila("Área", num(p.area_ha, 1) + " ha")]);
        else if (k === "desastres") cuerpo = `<p>${p.titulo}</p>` + tabla([fila("Año", p.anio), fila("Tipo", p.tipo), fila("Lugar", p.lugar), fila("Fuente", p.url ? `<a href="${p.url}" target="_blank" rel="noopener">${p.fuente}</a>` : p.fuente)]);
        else if (k === "clase_suelo") cuerpo = tabla([fila("Clase agrológica", p.clase), fila("Área", p.area_ha ? num(p.area_ha) + " ha" : null)]);
        else if (k === "puentes") cuerpo = tabla([fila("Puente", p.nombre), fila("Vía", p.via), fila("Material", p.material), fila("Longitud", p.longitud_m ? num(p.longitud_m) + " m" : null)]);
        else if (k === "rellenos") cuerpo = tabla([fila("Sitio", p.nombre), fila("Municipio", p.municipio), fila("Toneladas/día", p.toneladas_dia)]);
        else if (k === "plantas") cuerpo = tabla([fila("Planta", p.nombre), fila("Empresa", p.empresa), fila("Municipio", p.municipio)]);
        else if (CAPAS[k].archivo === "camellones") {
            const vieri = "Vieri et al. 2026 (CC BY 4.0)";
            const t2 = {
                camellon: ["Camellón zenú", [fila("Altura conservada", p.alt_cons_m != null ? num(p.alt_cons_m, 2) + " m" : null), fila("Área", num(p.area_m2) + " m²"), fila("Estado", "Confirmado"), fila("Fuente", vieri)]],
                franja: ["Franja candidata (Isla Pérez)", [fila("Área", num(p.area_m2 / 1e4, 1) + " ha"), fila("Estado", "No confirmada: podría ser drenaje natural"), fila("Imagen", "Maxar " + (p.fecha_img || ""))]],
                eje: ["Eje de franja candidata", [fila("Largo", num(p.long_m) + " m"), fila("Rumbo", num(p.rumbo) + "°"), fila("Ángulo con el cauce antiguo", num(p.ang_cauce) + "°")]],
                paleocauce: ["Cauce antiguo (" + p.region + ")", p.region === "San Jorge"
                    ? [fila("Qué es", "Cauce hacia el que se orientan los camellones"), fila("Fuente", vieri)]
                    : [fila("Largo", p.long_m ? num(p.long_m) + " m" : null), fila("Fuente", "Trazado a mano sobre Google Earth (Maxar 2017)")]],
                plataforma: ["Plataforma de vivienda prehispánica", [fila("Área", num(p.area_m2) + " m²"), fila("Fuente", vieri)]],
                area_estudio: [p.nombre, [fila("Área", num(p.area_ha) + " ha"), fila("Fuente", vieri)]],
                area_montejo: [p.nombre, [fila("Ubicación", p.precision), fila("Fuente", "Montejo y Rojas 1992")]],
                sitio_montejo: [p.sitio, [fila("Ubicación", p.precision), fila("Fuente", "Montejo y Rojas 1992")]],
                zona_revisada: [p.zona, [fila("Resultado", p.resultado), fila("Revisión", "Imagen histórica de Google Earth")]]
            }[p.capa] || [p.capa, []];
            return `<div class="pop-titulo">${t2[0]}</div>${tabla(t2[1])}`;
        }
        else if (k === "cienagas_1963") cuerpo = tabla([fila("Plancha INCORA", p.plancha), fila("Área en 1963", num(p.ha, 1) + " ha"), fila("Fuente", "Fotos aéreas de jun–jul 1963 (IGAC – INCORA)")]);
        else if (k === "lagunas") cuerpo = tabla([fila("Nombre", p.nombre || "Sin nombre"), fila("Área", num(p.area_ha, 1) + " ha")]);
        else cuerpo = tabla([fila("Nombre", p.nombre), fila("Categoría", p.categoria), fila("Acto administrativo", p.acto || p.resolucion), fila("Tramo", p.tramo),
            fila("Altitud", p.altitud ? num(p.altitud) + " m" : null), fila("Área", p.area_ha ? num(p.area_ha) + " ha" : null)]);
        return `<div class="pop-titulo">${t}</div>${cuerpo}`;
    }

    // ------------------------------------------------------------------
    // Ganchos del motor
    // ------------------------------------------------------------------
    V.alIniciar = async (a) => {
        api = a; map = a.map; $ = a.$; num = a.num;
        // limite de la cuenca nueva encima de todo
        map.addSource("sinu-cuenca", { type: "geojson", data: CAPAS_DIR + "cuenca.geojson" });
        map.addLayer({ id: "sinu-cuenca", type: "line", source: "sinu-cuenca", paint: { "line-color": "#ffd200", "line-width": 2.5 } });
        // Chrome recuerda las casillas marcadas al recargar: se arranca con todo apagado para que el
        // mapa abra rapido (si no, se cargaban y dibujaban las 17 capas de golpe)
        document.querySelectorAll("[data-capa-sinu], #chkLotico").forEach((chk) => { chk.checked = false; chk.autocomplete = "off"; });
        document.querySelectorAll("[data-capa-sinu]").forEach((chk) => {
            chk.onchange = () => chk.checked ? mostrarCapa(chk.dataset.capaSinu) : prenderCapa(chk.dataset.capaSinu, false);
            if (chk.checked) prenderCapa(chk.dataset.capaSinu, true);
        });
        $("chkLidar").checked = false;
        $("chkLidar").onchange = () => verLidar($("chkLidar").checked);
        ["1864", "1963"].forEach((a) => { $("chkHis" + a).checked = false; $("chkHis" + a).onchange = () => verHistorico(a, $("chkHis" + a).checked); });
        $("rngHis").oninput = opacidadHistoricos;
        $("chkCuenca").onchange =() => map.setLayoutProperty("sinu-cuenca", "visibility", $("chkCuenca").checked ? "visible" : "none");
        document.querySelectorAll("#segEst button").forEach((b) => b.onclick = () => {
            filtroEst = b.dataset.filtro;
            document.querySelectorAll("#segEst button").forEach((x) => x.classList.toggle("activo", x === b));
            listaEstaciones();
        });
        $("buscaEst").oninput = listaEstaciones;
        try {
            SER = await (await fetch("datos/series.json")).json();
            prepararAgua();
        } catch (e) {
            $("aguaDatos").innerHTML = `<p class="nota">No se pudieron cargar las series: ${e.message}</p>`;
        }
        precargar();
    };
    V.alFicha = fichaIndices;
    V.alPestana = (p) => {
        if (p === "estaciones" && !$("chkEstaciones").checked) { $("chkEstaciones").checked = true; prenderCapa("estaciones", true); }
        // al salir de Indices en modo subcuenca, las subcuencas vuelven a su color de siempre
        if (IX.activo && p !== "indices" && IX.vista === "sub") api.colorear();
        atenuarSubcuencas(["territorio", "agua", "estaciones", "indices"].includes(p));
        IX.activo = p === "indices";
        if (IX.activo && SER && SER.indices && !IX.listo) prepararIndices();
        if (IX.listo) ponerIdx(IX.i);
        if (!IX.activo && IX.play) pararIdx();
        AG.activo = p === "agua";
        // la primera vez en Agua, el mapa va al bajo Sinu (cienagas y llanura), donde esta el agua
        if (AG.activo && !AG.visto) { AG.visto = true; irA([[-76.08, 8.68], [-75.42, 9.46]], 10.5); }
        if (AG.activo && !AG.precargado && SER) {
            AG.precargado = true;
            AG.anios.forEach((a) => ["inundacion", "sequia"].forEach((t) => { new Image().src = `datos/agua/${t}_${a}.png`; }));
        }
        if (SER && map.getLayer("agua-inundacion")) ponerAnio(AG.i);
        if (p !== "agua" && AG.play) pararPlay();
    };
    V.alClic = (e) => {
        const capas = capasClicables();
        if (!capas.length) return false;
        const f = map.queryRenderedFeatures(e.point, { layers: capas })[0];
        if (!f) return false;
        const k = f.layer.id.replace("sinu-", "").replace(/-borde$/, "");
        if (k === "estaciones") { fichaEstacion(f.properties.codigo); return true; }
        new maplibregl.Popup({ maxWidth: "300px" }).setLngLat(e.lngLat).setHTML(textoPopup(k, f.properties)).addTo(map);
        return true;
    };
})();
