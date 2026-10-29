// Dashboard del rio Sinu. Datos de datos/ (los genera herramientas/preparar_geoingenia.py)
// y graficas de js/graficas.js.
(() => {
    "use strict";
    const G = window.Graficas, num = G.num;
    const $ = (id) => document.getElementById(id);
    const CAPAS = "datos/capas/";
    const COL = { lotico: "#1c6fb0", lentico: "#2f8f4e", inundacion: "#1f6feb", sequia: "#f0883e",
        caudal: "#1f6feb", lluvia: "#2a9d8f", nino: "#c4472c", nina: "#2f6db3", neutro: "#a9adb2",
        oni: "#2a78d6", roni: "#eb6834" };
    const sinTildes = (t) => (t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
    const nombreEst = (t) => (t || "").replace(/\s*\[\d+\]$/, "").trim();
    const cargar = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(u + ": " + r.status); return r.json(); });
    let SER, CUENCA, SUB, EST, LOT;

    // Mapa base claro (CARTO) con el limite de la cuenca
    function nuevoMapa(id) {
        const map = new maplibregl.Map({
            container: id, attributionControl: { compact: true }, cooperativeGestures: true,
            style: { version: 8, sources: { claro: { type: "raster", tileSize: 256, maxzoom: 16, attribution: "Mapa: Esri, HERE, Garmin, © OpenStreetMap",
                tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"] } },
                layers: [{ id: "claro", type: "raster", source: "claro" }] },
            bounds: caja(CUENCA), fitBoundsOptions: { padding: 20 }
        });
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
        map.on("load", () => {
            map.addSource("cuenca", { type: "geojson", data: CUENCA });
            map.addLayer({ id: "cuenca", type: "line", source: "cuenca", paint: { "line-color": "#26292d", "line-width": 1.5, "line-dasharray": [3, 2] } });
        });
        return map;
    }
    function caja(fc) {
        let a = [180, 90, -180, -90];
        const rec = (c) => { if (typeof c[0] === "number") a = [Math.min(a[0], c[0]), Math.min(a[1], c[1]), Math.max(a[2], c[0]), Math.max(a[3], c[1])]; else c.forEach(rec); };
        (fc.features || [fc]).forEach((f) => rec(f.geometry.coordinates));
        return [[a[0], a[1]], [a[2], a[3]]];
    }
    const listo = (map) => new Promise((r) => map.loaded() ? r() : map.on("load", r));
    const mini = (el, items) => { el.innerHTML = items.map(([k, v]) => `<div><small>${k}</small><b>${v}</b></div>`).join(""); };

    // ------------------------------------------------------------------
    // Cifras de arriba
    // ------------------------------------------------------------------
    function cifras() {
        const L = SER.lotico_lentico;
        const ha = L.reduce((s, r) => s + (r.ha_agua || 0), 0);
        const activas = EST.features.filter((f) => f.properties.estado === "Activa").length;
        const conDatos = EST.features.filter((f) => f.properties.con_caudal || f.properties.con_lluvia).length;
        const maxI = SER.area_agua.reduce((m, r) => (r[1] || 0) > (m[1] || 0) ? r : m, [0, 0]);
        const ultimo = SER.oni_roni.filter((r) => r[2] != null).at(-1);
        const fase = (v) => v >= 0.5 ? "El Niño" : v <= -0.5 ? "La Niña" : "neutral";
        const M = G.MES;
        $("cifras").innerHTML = [
            ["Área de la cuenca", `${num(CUENCA.features[0].properties.area_km2)} km²`, `${SUB.features.length} subcuencas`],
            ["Agua superficial 2020", `${num(ha / 100)} km²`, `${num(100 * L.reduce((s, r) => s + r.ha_lentico, 0) / ha)} % léntica`],
            ["Estaciones IDEAM", num(EST.features.length), `${activas} activas · ${conDatos} con series`],
            ["Mayor inundación", `${num(maxI[1])} km²`, `en ${maxI[0]}`],
            ["ONI más reciente", `${ultimo[2] > 0 ? "+" : ""}${num(ultimo[2], 2)}`, `${M[ultimo[1]]} ${ultimo[0]} · ${fase(ultimo[2])}`]
        ].map(([k, v, s]) => `<div class="cifra"><small>${k}</small><b>${v}</b><span>${s}</span></div>`).join("");
    }

    // ------------------------------------------------------------------
    // 1. Loticos y lenticos
    // ------------------------------------------------------------------
    async function agua() {
        const L = SER.lotico_lentico;
        const suma = (k) => L.reduce((s, r) => s + (r[k] || 0), 0);
        mini($("miniAgua"), [
            ["Lótico", `${num(suma("ha_lotico"))} ha`], ["Léntico", `${num(suma("ha_lentico"))} ha`],
            ["Permanente", `${num(suma("ha_permanente"))} ha`], ["Estacional", `${num(suma("ha_estacional"))} ha`],
            ["Cuerpos lóticos", num(suma("n_lotico"))], ["Cuerpos lénticos", num(suma("n_lentico"))]
        ]);
        const top = [...L].sort((a, b) => b.ha_agua - a.ha_agua).slice(0, 15);
        const map = nuevoMapa("mapaAgua");
        G.barrasH($("gSubAgua"), top.map((r) => ({ etiqueta: r.nombre, valores: [r.ha_lotico, r.ha_lentico], clave: r.nombre,
            extra: [null, null] })), [{ nombre: "Lótico", color: COL.lotico }, { nombre: "Léntico", color: COL.lentico }],
            { apiladas: true, unidad: "ha", etiquetaAncho: 170, alClic: (f) => {
                const s = SUB.features.find((x) => sinTildes(x.properties.nombre) === sinTildes(f.clave));
                if (s) { map.fitBounds(caja(s), { padding: 30, duration: 1200 }); $("mapaAgua").scrollIntoView({ behavior: "smooth", block: "center" }); }
            } });
        await listo(map);
        map.addSource("sub", { type: "geojson", data: SUB });
        map.addLayer({ id: "sub", type: "line", source: "sub", paint: { "line-color": "#9aa0a6", "line-width": 0.6 } });
        map.addSource("lot", { type: "geojson", data: LOT });
        map.addLayer({ id: "lot", type: "fill", source: "lot", paint: { "fill-color": ["match", ["get", "tipo"], "lotico", COL.lotico, COL.lentico], "fill-opacity": 0.85 } });
        map.addLayer({ id: "lot-borde", type: "line", source: "lot", paint: { "line-color": ["match", ["get", "tipo"], "lotico", COL.lotico, COL.lentico], "line-width": 0.8 } });
        map.on("click", "lot", (e) => {
            const p = e.features[0].properties;
            new maplibregl.Popup().setLngLat(e.lngLat).setHTML(`<b>${p.tipo === "lotico" ? "Lótico (agua que corre)" : "Léntico (agua quieta)"}</b><br>
                ${num(p.area_ha, 1)} ha · ${p.permanencia}`).addTo(map);
        });
        map.on("mouseenter", "lot", () => map.getCanvas().style.cursor = "pointer");
        map.on("mouseleave", "lot", () => map.getCanvas().style.cursor = "");
    }

    // ------------------------------------------------------------------
    // 2. Estaciones
    // ------------------------------------------------------------------
    function estaciones() {
        const datos = SER.estaciones;
        const map = nuevoMapa("mapaEst");
        const con = (k) => EST.features.filter((f) => datos[f.properties.codigo] && datos[f.properties.codigo][k])
            .sort((a, b) => nombreEst(a.properties.nombre).localeCompare(nombreEst(b.properties.nombre)));
        const opciones = (sel, lista, porDefecto) => {
            sel.innerHTML = lista.map((f) => `<option value="${f.properties.codigo}">${nombreEst(f.properties.nombre)} · ${f.properties.municipio}</option>`).join("");
            const d = lista.find((f) => f.properties.codigo === porDefecto);
            if (d) sel.value = porDefecto;
        };
        opciones($("selLluvia"), con("pm"), "13035501");   // Aeropuerto Los Garzones (Monteria)
        opciones($("selCaudal"), con("qm"), "13067020");   // Monteria
        const pintar = (tipo) => {
            const cod = $(tipo === "lluvia" ? "selLluvia" : "selCaudal").value, s = datos[cod] || {};
            const mensual = tipo === "lluvia" ? s.pm : s.qm, u = tipo === "lluvia" ? "mm" : "m³/s", col = tipo === "lluvia" ? COL.lluvia : COL.caudal;
            const nom = tipo === "lluvia" ? "Lluvia" : "Caudal";
            const { puntos, fuera } = G.anualCompleto(mensual);
            const reg = G.regimen(mensual);
            const media = puntos.length ? puntos.reduce((a, p) => a + p[1], 0) / puntos.length : null;
            const vals = reg.filter((r) => r[1] != null);
            const humedo = vals.reduce((m, r) => r[1] > m[1] ? r : m, vals[0] || [0, 0]), seco = vals.reduce((m, r) => r[1] < m[1] ? r : m, vals[0] || [0, 0]);
            const A = tipo === "lluvia" ? "Llu" : "Cau";
            mini($("mini" + (tipo === "lluvia" ? "Lluvia" : "Caudal")), [
                ["Años completos", puntos.length ? `${puntos.length} (${puntos[0][0]}–${puntos.at(-1)[0]})` : "—"],
                [tipo === "lluvia" ? "Promedio mensual" : "Caudal medio", media != null ? `${num(media, media < 10 ? 1 : 0)} ${u}` : "—"],
                ["Mes más húmedo", `${G.MES[humedo[0]] || "—"} · ${num(humedo[1] || 0)} ${u}`],
                ["Mes más seco", `${G.MES[seco[0]] || "—"} · ${num(seco[1] || 0, 1)} ${u}`]
            ]);
            G.grafica($("g" + A + "A"), [{ nombre: nom, color: col, puntos }], { unidad: u });
            G.grafica($("g" + A + "M"), [{ nombre: nom, color: col, puntos: reg }], { unidad: u, barras: true, fmtX: (m) => G.MES[m] });
            $("nota" + (tipo === "lluvia" ? "Lluvia" : "Caudal")).textContent = fuera.length
                ? `No se cuentan ${fuera.length} año${fuera.length > 1 ? "s" : ""} con menos de 10 meses de datos: ${fuera.join(", ")}.` : "";
            marcarEstaciones();
        };
        $("selLluvia").onchange = () => pintar("lluvia");
        $("selCaudal").onchange = () => pintar("caudal");
        pintar("lluvia");
        pintar("caudal");

        let filtro = "activas";
        const FILTRO = { activas: ["==", ["get", "estado"], "Activa"], datos: ["any", ["has", "con_caudal"], ["has", "con_lluvia"]], todas: ["boolean", true] };
        const nota = () => {
            const n = EST.features.filter((f) => filtro === "todas" || (filtro === "activas" ? f.properties.estado === "Activa" : (f.properties.con_caudal || f.properties.con_lluvia))).length;
            $("notaEst").textContent = `${n} estaciones en el mapa. Las que tienen series se ven más grandes; haz clic en una para ver sus gráficas.`;
        };
        function marcarEstaciones() {
            if (map.getLayer("est-sel")) map.setFilter("est-sel", ["in", ["get", "codigo"], ["literal", [$("selLluvia").value, $("selCaudal").value]]]);
        }
        listo(map).then(() => {
            map.addSource("est", { type: "geojson", data: EST });
            const conSerie = ["any", ["has", "con_caudal"], ["has", "con_lluvia"]];
            map.addLayer({ id: "est", type: "circle", source: "est", filter: FILTRO[filtro],
                paint: { "circle-radius": ["case", conSerie, 7, 4], "circle-color": ["case", ["has", "con_caudal"], COL.caudal, ["has", "con_lluvia"], COL.lluvia, "#9aa0a6"],
                    "circle-stroke-color": "#fff", "circle-stroke-width": 1.5, "circle-opacity": ["case", ["==", ["get", "estado"], "Activa"], 1, 0.55] } });
            map.addLayer({ id: "est-sel", type: "circle", source: "est", filter: ["in", ["get", "codigo"], ["literal", []]],
                paint: { "circle-radius": 11, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#000", "circle-stroke-width": 2.5 } });
            marcarEstaciones();
            map.on("click", "est", (e) => {
                const p = e.features[0].properties;
                if (p.con_lluvia) { $("selLluvia").value = p.codigo; pintar("lluvia"); }
                if (p.con_caudal) { $("selCaudal").value = p.codigo; pintar("caudal"); }
                new maplibregl.Popup().setLngLat(e.lngLat).setHTML(`<b>${nombreEst(p.nombre)}</b><br>${p.categoria} · ${p.municipio}<br>
                    ${p.estado}${p.suspendida ? " desde " + p.suspendida : ""}${p.con_caudal || p.con_lluvia ? "" : "<br><i>Sin series en el paquete</i>"}`).addTo(map);
            });
            map.on("mouseenter", "est", () => map.getCanvas().style.cursor = "pointer");
            map.on("mouseleave", "est", () => map.getCanvas().style.cursor = "");
        });
        document.querySelectorAll("#segEst button").forEach((b) => b.onclick = () => {
            filtro = b.dataset.f;
            document.querySelectorAll("#segEst button").forEach((x) => x.classList.toggle("activo", x === b));
            if (map.getLayer("est")) map.setFilter("est", FILTRO[filtro]);
            nota();
        });
        nota();
    }

    // ------------------------------------------------------------------
    // 3. Inundacion y sequia
    // ------------------------------------------------------------------
    function inundacion() {
        const A = SER.agua, c = A.caja;
        const anios = A.anios.inundacion.filter((a) => A.anios.sequia.includes(a)).sort((a, b) => a - b);
        let i = anios.length - 1, modo = "inundacion", play = 0;
        const map = nuevoMapa("mapaInund");
        const coords = [[c[0], c[3]], [c[2], c[3]], [c[2], c[1]], [c[0], c[1]]];
        listo(map).then(() => {
            ["sequia", "inundacion"].forEach((t) => {
                map.addSource(t, { type: "image", url: `datos/agua/${t}_${anios[i]}.png`, coordinates: coords });
                map.addLayer({ id: t, type: "raster", source: t, paint: { "raster-opacity": 0.95, "raster-fade-duration": 0, "raster-resampling": "linear" } }, "cuenca");
            });
            poner(i);
        });
        const maxI = SER.area_agua.reduce((m, r) => (r[1] || 0) > (m[1] || 0) ? r : m, [0, 0]);
        const minS = SER.area_agua.filter((r) => r[2] > 0).reduce((m, r) => r[2] < m[2] ? r : m, [0, null, Infinity]);
        $("notaInund").textContent = `Mayor inundación: ${maxI[0]} (${num(maxI[1])} km²). Menos agua persistente: ${minS[0]} (${num(minS[2])} km²).` +
            ` 1984 aparece en cero porque ese año casi no hay imágenes útiles.`;
        function poner(k) {
            i = k;
            const anio = anios[i];
            $("rngAnio").value = i;
            $("txtAnio").textContent = anio;
            ["inundacion", "sequia"].forEach((t) => {
                if (!map.getLayer(t)) return;
                const ver = modo === t || modo === "ambas";
                map.setLayoutProperty(t, "visibility", ver ? "visible" : "none");
                if (ver) map.getSource(t).updateImage({ url: `datos/agua/${t}_${anio}.png` });
            });
            const f = SER.area_agua.find((r) => r[0] === anio) || [];
            const oni = oniAnual().find((r) => r[0] === anio);
            mini($("miniInund"), [["Año", anio], ["Inundación máxima", f[1] != null ? `${num(f[1], 1)} km²` : "—"],
                ["Agua persistente", f[2] != null ? `${num(f[2], 1)} km²` : "—"], ["ONI del año", oni && oni[1] != null ? num(oni[1], 2) : "—"]]);
            G.grafica($("gArea"), [
                { nombre: "Inundación máxima", color: COL.inundacion, puntos: SER.area_agua.map((r) => [r[0], r[1]]) },
                { nombre: "Agua persistente", color: COL.sequia, puntos: SER.area_agua.map((r) => [r[0], r[2]]) }
            ], { unidad: "km²", marcarX: anio, salto: 2.01, alClicX: (x) => { const k = anios.indexOf(x); if (k >= 0) { parar(); poner(k); } } });
        }
        const parar = () => { clearInterval(play); play = 0; $("btnPlay").textContent = "Reproducir"; };
        $("rngAnio").max = anios.length - 1;
        $("rngAnio").oninput = () => { parar(); poner(+$("rngAnio").value); };
        $("btnPlay").onclick = () => {
            if (play) return parar();
            $("btnPlay").textContent = "Pausa";
            play = setInterval(() => poner((i + 1) % anios.length), 900);
        };
        document.querySelectorAll("#segAgua button").forEach((b) => b.onclick = () => {
            modo = b.dataset.m;
            document.querySelectorAll("#segAgua button").forEach((x) => x.classList.toggle("activo", x === b));
            poner(i);
        });
        poner(i);
    }

    // ------------------------------------------------------------------
    // 4. ONI y RONI
    // ------------------------------------------------------------------
    let _oni = null;
    function oniAnual() {
        if (_oni) return _oni;
        const por = {};
        SER.oni_roni.forEach(([y, , o, r]) => { (por[y] = por[y] || { o: [], r: [] }); if (o != null) por[y].o.push(o); if (r != null) por[y].r.push(r); });
        const media = (a) => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
        _oni = Object.entries(por).map(([y, v]) => [+y, media(v.o), media(v.r)]).filter(([y]) => y >= 1984);
        return _oni;
    }
    function oni() {
        const mes = SER.oni_roni.filter(([y]) => y >= 1984);
        const x = ([y, m]) => y + (m - 0.5) / 12;
        G.grafica($("gOniMes"), [
            { nombre: "ONI", color: COL.oni, puntos: mes.map((r) => [x(r), r[2]]) },
            { nombre: "RONI", color: COL.roni, puntos: mes.map((r) => [x(r), r[3]]) }
        ], { unidad: "°C", cero: true, salto: 0.2, fmtX: (v) => v % 1 ? `${G.MES[Math.floor((v % 1) * 12) + 1]} ${Math.floor(v)}` : Math.floor(v) });
        const anual = oniAnual();
        G.grafica($("gOniAnio"), [{ nombre: "ONI", color: COL.neutro, puntos: anual.map((r) => [r[0], r[1]]) }], {
            barras: true, cero: true, unidad: "°C", colorBarra: (x, y) => y >= 0.5 ? COL.nino : y <= -0.5 ? COL.nina : COL.neutro });
        // relacion con el agua: area inundada promedio segun la fase del ano
        const fase = (v) => v >= 0.5 ? "nino" : v <= -0.5 ? "nina" : "neutral";
        const grupos = { nino: [], nina: [], neutral: [] };
        const pares = [];
        SER.area_agua.forEach(([y, inund]) => {
            const o = anual.find((r) => r[0] === y);
            if (!o || o[1] == null || !inund) return;
            grupos[fase(o[1])].push(inund);
            pares.push([o[1], inund]);
        });
        const prom = (a) => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
        const n = pares.length, mx = prom(pares.map((p) => p[0])), my = prom(pares.map((p) => p[1]));
        const r = pares.reduce((s, [a, b]) => s + (a - mx) * (b - my), 0) /
            Math.sqrt(pares.reduce((s, [a]) => s + (a - mx) ** 2, 0) * pares.reduce((s, [, b]) => s + (b - my) ** 2, 0));
        mini($("miniOni"), [
            ["Inundación en años La Niña", `${num(prom(grupos.nina))} km²`], ["En años neutrales", `${num(prom(grupos.neutral))} km²`],
            ["En años El Niño", `${num(prom(grupos.nino))} km²`], ["Correlación ONI–inundación", num(r, 2)]
        ]);
        $("notaOni").textContent = `Promedio de inundación máxima según la fase del año (${grupos.nina.length} años La Niña, ${grupos.neutral.length} neutrales, ` +
            `${grupos.nino.length} El Niño; ${n} años con dato). Una correlación negativa quiere decir que con La Niña (ONI bajo) se inunda más. ` +
            `Es una relación general: la inundación también depende de Urrá, de las lluvias locales y de cada temporada.`;
    }

    // ------------------------------------------------------------------
    // 5. Cambio de suelos: modelo propio del proyecto (Random Forest sobre Landsat, 1985-2026)
    // ------------------------------------------------------------------
    // Por instruccion del equipo no se usan las capas de ArcGIS (Sentinel-2 de Esri / Impact Observatory).
    // 2012->2013 cambia el satelite, 2013-2015 falto radar y 2026 esta incompleto (LEEME_modelo_propio.txt).
    const NO_COMPARABLE = [2013, 2014, 2015];
    const ULTIMO_SUELO = 2025;
    const PERIODOS = [[1985, 1989], [1990, 1994], [1995, 1999], [2000, 2004], [2005, 2009], [2016, 2020], [2021, 2025]];
    const clasesSuelo = () => SER.suelo.clases.map((c, k) => ({ ...c, k: k + 1 }));
    const filasSuelo = () => SER.suelo.km2.filter((r) => r[0] <= ULTIMO_SUELO);
    function promedioPeriodo([a, b]) {
        const f = filasSuelo().filter((r) => r[0] >= a && r[0] <= b);
        return clasesSuelo().map((c) => f.reduce((s, r) => s + r[c.k], 0) / f.length);
    }
    const pctCambio = (a, d) => `${d >= a ? "+" : ""}${num((d / a - 1) * 100)} %`;
    function suelos() {
        const clases = clasesSuelo(), filas = filasSuelo();
        // serie de 41 anos, una grafica por clase (cada una con su escala)
        const cont = $("multSuelo");
        if (!cont.children.length) cont.innerHTML = clases.map((c, i) =>
            `<div><h4><i style="background:${c.color}"></i>${c.nombre}<small id="multDif${i}"></small></h4>
             <div class="g-lienzo"><svg id="multG${i}"></svg><div class="g-tip" hidden></div></div></div>`).join("");
        const ini = promedioPeriodo(PERIODOS[0]), fin = promedioPeriodo(PERIODOS[PERIODOS.length - 1]);
        clases.forEach((c, i) => {
            G.grafica($("multG" + i), [{ nombre: c.nombre, color: c.color, puntos: filas.map((r) => [r[0], r[c.k]]) }],
                { unidad: "km²", cero: false, bandas: [[2012.5, 2015.5]] });
            $("multDif" + i).textContent = `${pctCambio(ini[i], fin[i])} desde 1985–89`;
        });
        // antes / despues por periodos de cinco anos
        const sa = $("perAntes"), sd = $("perDespues");
        if (!sa.options.length) {
            const ops = PERIODOS.map(([a, b], i) => `<option value="${i}">${a}–${b}</option>`).join("");
            sa.innerHTML = sd.innerHTML = ops;
            sa.value = 0; sd.value = PERIODOS.length - 1;
            sa.onchange = sd.onchange = cambioSuelo;
        }
        cambioSuelo();
    }
    function cambioSuelo() {
        const clases = clasesSuelo(), pa = PERIODOS[+$("perAntes").value], pd = PERIODOS[+$("perDespues").value];
        const a = promedioPeriodo(pa), d = promedioPeriodo(pd);
        G.barrasH($("gSuelos"), clases.map((c, i) => ({ etiqueta: c.nombre, color: c.color, valores: [d[i] - a[i]], extra: [`(${pctCambio(a[i], d[i])})`] })),
            [{ nombre: "Cambio", color: "#70757b" }], { unidad: "km²", etiquetaAncho: 140, rotular: true, signo: true, altoFila: 30 });
        $("tablaSuelos").innerHTML = `<tr><th>Clase</th><th>${pa[0]}–${pa[1]}</th><th>${pd[0]}–${pd[1]}</th><th>Cambio</th></tr>` +
            clases.map((c, i) => `<tr><td><b>${c.nombre}</b></td><td>${num(a[i])}</td><td>${num(d[i])}</td>` +
                `<td>${d[i] >= a[i] ? "▲ +" : "▼ "}${num(d[i] - a[i])}<br><small>${pctCambio(a[i], d[i])}</small></td></tr>`).join("") +
            `<tr><td colspan="4"><small>km², promedio anual de cada periodo</small></td></tr>`;
    }

    // ------------------------------------------------------------------
    // 5b. Comparador antes / despues con imagenes satelitales (cortina, como en Mapa.html)
    // ------------------------------------------------------------------
    const LUGARES = [
        ["Bajo Sinú: Montería – Lorica – Ciénaga Grande", [[-76.02, 8.62], [-75.55, 9.32]]],
        ["Montería", [[-75.95, 8.69], [-75.82, 8.81]]],
        ["Lorica y Ciénaga Grande", [[-75.9, 9.1], [-75.62, 9.3]]],
        ["Delta de Tinajones (desembocadura)", [[-76.05, 9.3], [-75.8, 9.45]]],
        ["Embalse de Urrá", [[-76.33, 7.85], [-76.05, 8.08]]],
        ["Tierralta", [[-76.12, 8.12], [-75.99, 8.23]]],
        ["Toda la cuenca", null]
    ];
    async function fuentesImagen() {
        const s2 = [2018, 2019, 2020, 2021, 2022, 2023, 2024].map((a) => ({ etiqueta: String(a), maxzoom: 14,
            url: "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-" + a + "_3857/default/g/{z}/{y}/{x}.jpg",
            atrib: "Sentinel-2 cloudless " + a + " por EOX IT Services GmbH (datos Copernicus Sentinel modificados)" }));
        let wb = [];
        try {
            const cfg = await cargar("https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json");
            // una version por ano (la ultima de cada ano), de la mas antigua a la mas reciente
            const porAnio = {};
            Object.values(cfg).forEach((v) => {
                const f = (v.itemTitle.match(/\d{4}-\d{2}-\d{2}/) || [""])[0];
                if (!f) return;
                const a = f.slice(0, 4);
                if (!porAnio[a] || porAnio[a].fecha < f) porAnio[a] = { fecha: f,
                    url: v.itemURL.replace("{level}", "{z}").replace("{row}", "{y}").replace("{col}", "{x}") };
            });
            wb = Object.keys(porAnio).sort().map((a) => ({ etiqueta: porAnio[a].fecha, url: porAnio[a].url, maxzoom: 18,
                atrib: "Esri World Imagery Wayback " + porAnio[a].fecha }));
        } catch (e) { console.warn("Wayback no disponible:", e); }
        const c = SER.suelo.caja;
        const cob = SER.suelo.mapas.filter((a) => a <= ULTIMO_SUELO).map((a) => ({
            etiqueta: NO_COMPARABLE.includes(a) ? `${a} (no comparable)` : String(a),
            imagen: "datos/suelo/clases_" + a + ".png", coords: [[c[0], c[3]], [c[2], c[3]], [c[2], c[1]], [c[0], c[1]]] }));
        // Landsat Global Land Survey (USGS/NASA) del servicio publico de Esri: mosaicos de escenas de varios anos
        // alrededor de cada epoca, con costuras y nubes. 1975 es MSS y no tiene color real.
        const LS = "https://landsat2.arcgis.com/arcgis/rest/services/Landsat/MS/ImageServer/exportImage?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857" +
            "&size=256,256&format=jpgpng&f=image&renderingRule=" + encodeURIComponent(JSON.stringify({ rasterFunction: "Natural Color with DRA" }));
        const gls = [1990, 2000, 2005, 2010].map((a) => ({ etiqueta: String(a), maxzoom: 14,
            url: LS + "&mosaicRule=" + encodeURIComponent(JSON.stringify({ mosaicMethod: "esriMosaicNone", where: `dataset_id='GLS-${a}'` })),
            atrib: `Landsat GLS ${a}: USGS, NASA, vía Esri` }));
        return { cob, s2, wb, gls };
    }
    // Cortina entre dos mapas: se mueven juntos y el de "despues" solo se ve a la derecha de la barra
    function cortina(cont, A, D) {
        let sinc = false;
        const seguir = (a, b) => a.on("move", () => {
            if (sinc) return;
            sinc = true;
            b.jumpTo({ center: a.getCenter(), zoom: a.getZoom(), bearing: a.getBearing(), pitch: a.getPitch() });
            sinc = false;
        });
        seguir(A, D); seguir(D, A);
        const barra = cont.querySelector(".cmp-barra"), lado = D.getContainer();
        const mover = (x) => {
            const r = cont.getBoundingClientRect(), pct = Math.min(98, Math.max(2, (x - r.left) / r.width * 100));
            barra.style.left = pct + "%";
            lado.style.clipPath = `inset(0 0 0 ${pct}%)`;
        };
        barra.addEventListener("pointerdown", (e) => {
            e.preventDefault();
            barra.setPointerCapture(e.pointerId);
            const mv = (ev) => mover(ev.clientX);
            const fin = () => { barra.removeEventListener("pointermove", mv); barra.removeEventListener("pointerup", fin); };
            barra.addEventListener("pointermove", mv);
            barra.addEventListener("pointerup", fin);
        });
        lado.style.clipPath = "inset(0 0 0 50%)";
    }
    const SAT = { type: "raster", tileSize: 256, maxzoom: 19, attribution: "Imagen: Esri, Maxar, Earthstar Geographics",
        tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"] };
    const NOTAS_CMP = {
        cob: "Mapas de visualización del modelo propio, a unos 340 m por píxel, con los bordes suavizados para verlos mejor (las áreas oficiales están abajo). " +
            "Los años 2013–2015 no se comparan con el resto y 2026 no se muestra porque está incompleto. Líneas grises: subcuencas; negra: límite de la cuenca.",
        s2: "Solo visual: esta imagen no está contemplada en el análisis del proyecto. Sentinel-2 sin nubes: mosaicos anuales de EOX (Sentinel-2 cloudless, contiene datos Copernicus Sentinel modificados, CC BY-NC-SA 4.0), " +
            "unos 10 m por píxel. Sirve para ver en detalle lo que el mapa de cobertura resume. Líneas blancas: subcuencas; amarilla: límite de la cuenca.",
        wb: "Solo visual: esta imagen no está contemplada en el análisis del proyecto. Esri Wayback: archivo de las versiones de World Imagery; algunas fechas repiten la misma foto en zonas rurales. " +
            "Líneas blancas: subcuencas; amarilla: límite de la cuenca.",
        gls: "Solo visual: esta imagen no está contemplada en el análisis del proyecto. Landsat Global Land Survey (USGS y NASA, servicio público de Esri), " +
            "30 m por píxel. Cada época junta escenas de varios años alrededor de esa fecha: se ven costuras entre escenas, nubes y bruma, y en 2005 y 2010 " +
            "franjas de la falla de Landsat 7. Sirve para dar una idea de cómo se veía antes de 2014, no para medir cambio. " +
            "Líneas blancas: subcuencas; amarilla: límite de la cuenca."
    };
    async function comparador() {
        const F = await fuentesImagen();
        let fuente = "cob";
        const mapa = (id) => new maplibregl.Map({
            container: id, attributionControl: false, cooperativeGestures: true, bounds: LUGARES[0][1], maxZoom: 17,
            style: { version: 8, sources: { claro: { type: "raster", tileSize: 256, maxzoom: 16, attribution: "Mapa: Esri, HERE, Garmin, © OpenStreetMap",
                tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"] } },
                layers: [{ id: "fondo", type: "background", paint: { "background-color": "#111" } },
                    { id: "claro", type: "raster", source: "claro", layout: { visibility: "none" } }] }
        });
        const A = mapa("mapaAntes"), D = mapa("mapaDespues");
        D.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
        D.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");
        const poner = (m, item) => {
            if (!item) return;
            if (m.getLayer("img")) m.removeLayer("img");
            if (m.getSource("img")) m.removeSource("img");
            const cob = !!item.imagen, debajo = m.getLayer("sub") ? "sub" : undefined;
            m.setLayoutProperty("claro", "visibility", cob ? "visible" : "none");
            if (cob) {   // mapa de cobertura: una imagen por ano sobre el mapa claro, colores sin mezclar
                m.addSource("img", { type: "image", url: item.imagen, coordinates: item.coords });
                m.addLayer({ id: "img", type: "raster", source: "img", paint: { "raster-fade-duration": 0, "raster-resampling": "nearest", "raster-opacity": 0.92 } }, debajo);
            } else {
                m.addSource("img", { type: "raster", tiles: [item.url], tileSize: 256, maxzoom: item.maxzoom, attribution: item.atrib });
                m.addLayer({ id: "img", type: "raster", source: "img", paint: { "raster-fade-duration": 0 } }, debajo);
            }
            if (!m.getLayer("sub")) return;
            m.setPaintProperty("sub", "line-color", cob ? "rgba(38,41,45,.35)" : "rgba(255,255,255,.6)");
            m.setPaintProperty("cuenca", "line-color", cob ? "#26292d" : "#ffde00");
        };
        const lineas = (m) => {
            m.addSource("sub", { type: "geojson", data: SUB });
            m.addLayer({ id: "sub", type: "line", source: "sub", paint: { "line-color": "rgba(255,255,255,.6)", "line-width": 0.8 } });
            m.addSource("cuenca", { type: "geojson", data: CUENCA });
            m.addLayer({ id: "cuenca", type: "line", source: "cuenca", paint: { "line-color": "#ffde00", "line-width": 2 } });
        };
        const listas = () => {
            const L = F[fuente];
            if (!L.length) { $("selAntes").innerHTML = $("selDespues").innerHTML = "<option>No disponible</option>"; return; }
            const ops = L.map((it, i) => `<option value="${i}">${it.etiqueta}</option>`).join("");
            $("selAntes").innerHTML = ops; $("selDespues").innerHTML = ops;
            $("selAntes").value = 0; $("selDespues").value = L.length - 1;
            $("leyCmp").innerHTML = fuente === "cob" ? SER.suelo.clases.map((c) => `<span><i style="background:${c.color}"></i>${c.nombre}</span>`).join("") : "";
            $("notaCmp").textContent = NOTAS_CMP[fuente];
        };
        const actualizar = () => {
            const L = F[fuente], a = L[+$("selAntes").value], d = L[+$("selDespues").value];
            poner(A, a); poner(D, d);
            const visual = fuente === "cob" ? "" : " · solo visual";
            $("etAntes").textContent = a ? "Antes · " + a.etiqueta + visual : "";
            $("etDespues").textContent = d ? "Después · " + d.etiqueta + visual : "";
        };
        $("selLugar").innerHTML = LUGARES.map(([n], i) => `<option value="${i}">${n}</option>`).join("");
        $("selLugar").onchange = () => {
            const b = LUGARES[+$("selLugar").value][1] || caja(CUENCA);
            D.fitBounds(b, { padding: 20, duration: 1200 });
        };
        document.querySelectorAll("#segFuente button").forEach((b) => b.onclick = () => {
            if (!F[b.dataset.f].length) { b.title = "No se pudo consultar el servicio"; return; }
            fuente = b.dataset.f;
            document.querySelectorAll("#segFuente button").forEach((x) => x.classList.toggle("activo", x === b));
            listas(); actualizar();
        });
        $("selAntes").onchange = actualizar;
        $("selDespues").onchange = actualizar;
        cortina($("comparador"), A, D);
        await Promise.all([listo(A), listo(D)]);
        lineas(A); lineas(D);
        listas(); actualizar();
    }

    // ------------------------------------------------------------------
    // 6. Camellones zenues (San Jorge confirmados; bajo Sinu candidatas y sitios de 1992)
    // ------------------------------------------------------------------
    const ZONAS_CAM = { sj: [[-75.146, 8.505], [-75.122, 8.528]], ip: [[-75.68, 9.08], [-75.47, 9.21]], todo: [[-75.72, 8.48], [-75.1, 9.23]] };
    const RESULTADO = { candidata: "#22c55e", "sin patrón": "#cbd5e1", "descartada: labranza moderna": "#ef4444" };
    async function camellones() {
        const C = SER.camellones, CAM = await cargar(CAPAS + "camellones.geojson");
        mini($("miniCam"), [
            ["Camellones confirmados (San Jorge)", num(C.n.camellon)], ["Área de camellones", `${num(C.ha_camellones, 1)} ha`],
            ["Altura conservada (mediana)", `${num(C.alt_mediana, 2)} m`], ["Plataformas de vivienda", num(C.n.plataforma)],
            ["Franjas candidatas en el Sinú", `${num(C.n.franja)} · ${num(C.ha_franjas, 1)} ha`]
        ]);
        // histograma de altura conservada, de a 5 cm
        const paso = 0.05, bins = new Array(Math.ceil(Math.max(...C.alt) / paso) + 1).fill(0);
        C.alt.forEach((v) => bins[Math.floor(v / paso)]++);
        G.grafica($("gCam"), [{ nombre: "Camellones", color: "#c2410c", puntos: bins.map((n, i) => [i, n]) }],
            { barras: true, unidad: "camellones", fmtX: (i) => `${num(i * paso, 2)} m` });
        const zonas = CAM.features.filter((f) => f.properties.capa === "zona_revisada");
        $("tablaCam").innerHTML = "<tr><th>Zona (Google Earth 2007–2025)</th><th>Resultado</th></tr>" + zonas.map((f) =>
            `<tr><td><i style="display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:6px;background:${RESULTADO[f.properties.resultado] || "#999"}"></i>${f.properties.zona}</td><td>${f.properties.resultado}</td></tr>`).join("");

        const map = new maplibregl.Map({
            container: "mapaCam", attributionControl: { compact: true }, cooperativeGestures: true, bounds: ZONAS_CAM.sj, maxZoom: 19,
            style: { version: 8, glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
                sources: { sat: SAT },
                layers: [{ id: "sat", type: "raster", source: "sat", paint: { "raster-saturation": -0.35 } }] }
        });
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
        await listo(map);
        const L = C.lidar.caja;
        map.addSource("lidar", { type: "image", url: C.lidar.url, coordinates: [[L[0], L[3]], [L[2], L[3]], [L[2], L[1]], [L[0], L[1]]] });
        map.addLayer({ id: "lidar", type: "raster", source: "lidar", paint: { "raster-fade-duration": 0 } });
        map.addSource("cuenca", { type: "geojson", data: CUENCA });
        map.addLayer({ id: "cuenca", type: "line", source: "cuenca", paint: { "line-color": "#ffde00", "line-width": 2 } });
        map.addSource("cam", { type: "geojson", data: CAM });
        const es = (...c) => ["in", ["get", "capa"], ["literal", c]];
        const capas = [
            ["camellon", { id: "camellon", type: "fill", filter: es("camellon"), paint: { "fill-opacity": 0.75,
                "fill-color": ["interpolate", ["linear"], ["coalesce", ["get", "alt_cons_m"], 0.3], 0.2, "#fde68a", 0.35, "#f59e0b", 0.5, "#c2410c"] } }],
            ["camellon", { id: "franja", type: "fill", filter: es("franja"), paint: { "fill-color": "#e879f9", "fill-opacity": 0.3 } }],
            ["camellon", { id: "franja-borde", type: "line", filter: es("franja"), paint: { "line-color": "#f0abfc", "line-width": 2, "line-dasharray": [2, 1.5] } }],
            ["camellon", { id: "eje", type: "line", filter: es("eje"), paint: { "line-color": "#fff", "line-width": 1.2 } }],
            ["plataforma", { id: "plataforma", type: "fill", filter: es("plataforma"), paint: { "fill-color": "#22d3ee", "fill-opacity": 0.55 } }],
            ["plataforma", { id: "plataforma-borde", type: "line", filter: es("plataforma"), paint: { "line-color": "#cffafe", "line-width": 1 } }],
            ["paleocauce", { id: "paleocauce-relleno", type: "fill", filter: es("paleocauce"), paint: { "fill-color": "#3b82f6", "fill-opacity": 0.35 } }],
            ["paleocauce", { id: "paleocauce", type: "line", filter: es("paleocauce"), paint: { "line-color": "#60a5fa", "line-width": 2.5 } }],
            ["montejo", { id: "area-estudio", type: "line", filter: es("area_estudio"), paint: { "line-color": "#fff", "line-width": 1.5, "line-dasharray": [3, 2] } }],
            ["montejo", { id: "montejo", type: "line", filter: es("area_montejo"), paint: { "line-color": "#fde047", "line-width": 1.5, "line-dasharray": [1, 1.5] } }],
            ["montejo", { id: "sitio", type: "circle", filter: es("sitio_montejo"), paint: { "circle-radius": 5, "circle-color": "#fde047", "circle-stroke-color": "#000", "circle-stroke-width": 1 } }],
            ["montejo", { id: "sitio-nombre", type: "symbol", filter: es("sitio_montejo"), layout: { "text-field": ["get", "sitio"], "text-size": 12,
                "text-offset": [0, 1.1], "text-anchor": "top", "text-font": ["Noto Sans Bold"] }, paint: { "text-color": "#fff", "text-halo-color": "#000", "text-halo-width": 1.4 } }],
            ["zona", { id: "zona", type: "line", filter: es("zona_revisada"), paint: { "line-width": 2.5,
                "line-color": ["match", ["get", "resultado"], ...Object.entries(RESULTADO).flat(), "#999"] } }]
        ];
        capas.forEach(([, l]) => map.addLayer({ source: "cam", ...l }));
        // casillas: cada una prende o apaga su grupo de capas
        document.querySelectorAll("#capasCam input").forEach((chk) => chk.onchange = () => {
            const ids = chk.dataset.c === "lidar" ? ["lidar"] : capas.filter(([g]) => g === chk.dataset.c).map(([, l]) => l.id);
            ids.forEach((id) => map.setLayoutProperty(id, "visibility", chk.checked ? "visible" : "none"));
        });
        $("leyCam").innerHTML = [["#f59e0b", "Camellón (más oscuro = más alto)"], ["#e879f9", "Franja candidata, no confirmada"], ["#22d3ee", "Plataforma de vivienda"],
            ["#60a5fa", "Cauce antiguo (San Jorge e Isla Pérez)"], ["#fde047", "Montejo y Rojas (1992), aproximado"], ["#ffde00", "Límite de la cuenca del Sinú"]]
            .map(([c, n]) => `<span><i style="background:${c}"></i>${n}</span>`).join("");
        document.querySelectorAll("#segCam button").forEach((b) => b.onclick = () => {
            document.querySelectorAll("#segCam button").forEach((x) => x.classList.toggle("activo", x === b));
            map.fitBounds(ZONAS_CAM[b.dataset.z], { padding: 30, duration: 1400 });
        });
        // ficha al hacer clic
        const ficha = (p) => ({
            camellon: () => `<b>Camellón</b><br>Altura conservada: ${num(p.alt_cons_m, 2)} m<br>Área: ${num(p.area_m2)} m²<br><small>Vieri et al. 2026 · confirmado</small>`,
            franja: () => `<b>Franja candidata (Isla Pérez)</b><br>Área: ${num(p.area_m2 / 1e4, 1)} ha<br><small>No confirmada: podría ser drenaje natural. Imagen Maxar ${p.fecha_img || ""}</small>`,
            eje: () => `<b>Eje de franja candidata</b><br>Largo: ${num(p.long_m)} m · rumbo ${num(p.rumbo)}°<br>Ángulo con el cauce antiguo: ${num(p.ang_cauce)}°`,
            paleocauce: () => p.region === "San Jorge"
                ? `<b>Cauce antiguo (San Jorge)</b><br>Los camellones se orientan hacia estos cauces<br><small>Vieri et al. 2026 · LiDAR 1 m</small>`
                : `<b>Cauce antiguo (Isla Pérez)</b>${p.long_m ? `<br>Largo: ${num(p.long_m)} m` : ""}<br><small>Trazado a mano sobre Google Earth (Maxar 2017)</small>`,
            plataforma: () => `<b>Plataforma de vivienda prehispánica</b><br>Área: ${num(p.area_m2)} m²`,
            area_estudio: () => `<b>${p.nombre}</b><br>${num(p.area_ha)} ha`,
            area_montejo: () => `<b>${p.nombre}</b><br><small>${p.precision}</small>`,
            sitio_montejo: () => `<b>${p.sitio}</b><br><small>${p.precision}</small>`,
            zona_revisada: () => `<b>${p.zona}</b><br>Resultado: ${p.resultado}`
        }[p.capa] || (() => p.capa))();
        const clicables = ["sitio", "eje", "camellon", "franja", "plataforma", "paleocauce", "paleocauce-relleno", "zona", "montejo", "area-estudio"];
        map.on("click", (e) => {
            const f = map.queryRenderedFeatures(e.point, { layers: clicables })[0];
            if (f) new maplibregl.Popup({ maxWidth: "260px" }).setLngLat(e.lngLat).setHTML(ficha(f.properties)).addTo(map);
        });
        clicables.forEach((id) => { map.on("mouseenter", id, () => map.getCanvas().style.cursor = "pointer"); map.on("mouseleave", id, () => map.getCanvas().style.cursor = ""); });
    }

    // ------------------------------------------------------------------
    // 7. Indices espectrales NDVI, NDWI y MNDWI en toda la cuenca, 1985-2026
    // ------------------------------------------------------------------
    const IDX = ["NDVI", "NDWI", "MNDWI"];
    const COL_ZONA = { "Alto Sinú - Urrá": "#2a78d6", "Medio Sinú": "#e0a100", "Bajo Sinú": "#2a9d8f" };
    const COL_SUB_IDX = "#c4472c";
    const OTROS_IDX = {
        EVI: "Índice de vegetación mejorado: como el NDVI, pero se satura menos en el bosque denso y corrige el efecto de la atmósfera y del suelo.",
        NDMI: "Humedad de la vegetación (NIR contra SWIR1): más alto, hojas con más agua; baja en sequía.",
        NBR: "Índice de área quemada (NIR contra SWIR2): cae donde hubo quemas o se taló el bosque.",
        NDBI: "Índice de área construida (SWIR1 contra NIR): sube con ciudades, vías y suelo desnudo.",
        BSI: "Índice de suelo desnudo: sube donde la tierra queda sin cobertura (potreros pelados, cultivos recién arados)."
    };
    function indicesCuenca() {
        const X = SER.indices, R = X.raster, c = R.caja, anios = X.anios;
        const coords = [[c[0], c[3]], [c[2], c[3]], [c[2], c[1]], [c[0], c[1]]];
        const url = (k, a) => `datos/indices/${k.toLowerCase()}_${a}.png`;
        const cortes = [[X.sensor - 0.5, X.sensor - 0.5 + 1]];   // franja del cambio de sensor
        let ind = "NDVI", vista = "pixel", i = anios.length - 2, sel = null, play = 0;   // arranca en 2025 (2026 esta incompleto)
        const col = (k) => IDX.indexOf(k);
        const valorSub = (id, k, j) => { const v = X.sub[id] && X.sub[id][j]; return v ? v[col(k)] : null; };
        const nombreSub = (id) => (SUB.features.find((f) => f.properties.id === id) || { properties: {} }).properties.nombre;
        // color de un valor con la misma paleta de las imagenes (para el modo por subcuenca)
        const rampaColor = (k) => {
            const [lo, hi] = R.rango[k], p = R.paleta[k];
            const e = ["interpolate", ["linear"], ["get", "v"]];
            p.forEach((cc, n) => e.push(lo + (hi - lo) * n / (p.length - 1), cc));
            return ["case", ["has", "v"], e, "rgba(0,0,0,0)"];
        };
        const map = nuevoMapa("mapaIdx");
        const subData = JSON.parse(JSON.stringify(SUB));
        listo(map).then(() => {
            map.addSource("idx", { type: "image", url: url(ind, anios[i]), coordinates: coords });
            map.addLayer({ id: "idx", type: "raster", source: "idx", paint: { "raster-fade-duration": 0, "raster-resampling": "nearest" } }, "cuenca");
            map.addSource("subidx", { type: "geojson", data: subData, promoteId: "id" });
            map.addLayer({ id: "subidx", type: "fill", source: "subidx", layout: { visibility: "none" }, paint: { "fill-color": rampaColor(ind), "fill-opacity": 0.95 } }, "cuenca");
            map.addLayer({ id: "subidx-linea", type: "line", source: "subidx", paint: { "line-color": "rgba(38,41,45,.35)", "line-width": 0.6 } });
            map.addLayer({ id: "subidx-sel", type: "line", source: "subidx", filter: ["==", ["get", "id"], -1], paint: { "line-color": COL_SUB_IDX, "line-width": 3 } });
            // en modo pixel el relleno esta apagado: la subcuenca se busca por geometria en los dos modos
            map.on("click", (e) => { const id = buscarSub(e.lngLat); elegir(id === sel ? null : id); });
            poner(i);
        });
        // punto en poligono (rayo) para elegir la subcuenca aunque el relleno no se vea
        function dentro(pt, anillo) {
            let si = false;
            for (let a = 0, b = anillo.length - 1; a < anillo.length; b = a++) {
                const [xa, ya] = anillo[a], [xb, yb] = anillo[b];
                if ((ya > pt[1]) !== (yb > pt[1]) && pt[0] < (xb - xa) * (pt[1] - ya) / (yb - ya) + xa) si = !si;
            }
            return si;
        }
        function buscarSub(ll) {
            const pt = [ll.lng, ll.lat];
            const f = SUB.features.find((s) => {
                const g = s.geometry, polis = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
                return polis.some((p) => dentro(pt, p[0]) && !p.slice(1).some((h) => dentro(pt, h)));
            });
            return f ? f.properties.id : null;
        }
        function elegir(id) {
            sel = id;
            if (map.getLayer("subidx-sel")) map.setFilter("subidx-sel", ["==", ["get", "id"], id == null ? -1 : id]);
            poner(i);
        }
        function rampa() {
            const [lo, hi] = R.rango[ind];
            $("rampaIdx").innerHTML = `<div class="barra" style="background:linear-gradient(90deg,${R.paleta[ind].join(",")})"></div>` +
                `<div class="marcas"><span>${num(lo, 1)}${ind === "NDVI" ? " · suelo, agua" : " · tierra"}</span><span>${ind}</span>` +
                `<span>${num(hi, 1)}${ind === "NDVI" ? " · vegetación densa" : " · agua"}</span></div>`;
        }
        function poner(k) {
            i = k;
            const a = anios[i];
            $("rngIdx").value = i;
            $("txtIdx").textContent = a;
            if (map.getLayer("idx")) {
                map.getSource("idx").updateImage({ url: url(ind, a), coordinates: coords });
                subData.features.forEach((f) => { const v = valorSub(f.properties.id, ind, i); if (v != null) f.properties.v = v; else delete f.properties.v; });
                map.getSource("subidx").setData(subData);
                map.setPaintProperty("subidx", "fill-color", rampaColor(ind));
                map.setLayoutProperty("idx", "visibility", vista === "pixel" ? "visible" : "none");
                map.setLayoutProperty("subidx", "visibility", vista === "sub" ? "visible" : "none");
            }
            const vc = X.cuenca[i][X.campos.indexOf(ind)];
            const vent = X.ventana[i];
            mini($("miniIdx"), [
                ["Año", a + (X.notas[a] && a === 2026 ? " (en curso)" : "")],
                [`${ind} de la cuenca`, num(vc, 3)],
                sel != null ? [nombreSub(sel), valorSub(sel, ind, i) != null ? num(valorSub(sel, ind, i), 3) : "—"]
                    : ["Imágenes usadas", num(X.escenas[i])],
                ["Compuesto", vent ? `${vent} meses` : "solo el año"]
            ]);
            $("tituloIdx").textContent = `${ind} promedio por año`;
            $("subIdx").textContent = `${X.sensores[i]}${X.notas[a] ? " · " + X.notas[a] : ""}. La línea negra es toda la cuenca; las de color, las tres zonas del IDEAM.`;
            const series = [{ nombre: "Toda la cuenca", color: "#26292d", puntos: anios.map((y, j) => [y, X.cuenca[j][X.campos.indexOf(ind)]]) }]
                .concat(Object.entries(COL_ZONA).filter(([z]) => X.zonas[z]).map(([z, cz]) => ({ nombre: z, color: cz,
                    puntos: anios.map((y, j) => [y, X.zonas[z].v[j][col(ind)]]) })));
            if (sel != null) series.push({ nombre: nombreSub(sel), color: COL_SUB_IDX, puntos: anios.map((y, j) => [y, valorSub(sel, ind, j)]) });
            $("leyIdx").innerHTML = series.map((s) => `<span><i style="background:${s.color}"></i>${s.nombre}</span>`).join("");
            G.grafica($("gIdx"), series, { cero: false, bandas: cortes, marcarX: a,
                alClicX: (x) => { const j = anios.indexOf(x); if (j >= 0) { parar(); poner(j); } } });
            cambio();
        }
        // cambio 2013 -> 2025 por subcuenca (mismo sensor)
        function cambio() {
            const ja = anios.indexOf(X.sensor), jb = anios.indexOf(2025);
            $("tituloCambio").textContent = `Cambio del ${ind} de ${X.sensor} a 2025, por subcuenca`;
            const filas = Object.keys(X.sub).map((id) => {
                const a = valorSub(+id, ind, ja), b = valorSub(+id, ind, jb);
                return a == null || b == null ? null : { id: +id, etiqueta: nombreSub(+id) || id, d: b - a };
            }).filter(Boolean).sort((p, q) => q.d - p.d);
            const lista = filas.length > 16 ? filas.slice(0, 8).concat(filas.slice(-8)) : filas;
            const sube = ind === "NDVI" ? "#1a9641" : "#2166ac", baja = "#a6611a";
            G.barrasH($("gCambioIdx"), lista.map((f) => ({ etiqueta: f.etiqueta, valores: [f.d], color: f.d >= 0 ? sube : baja, clave: f.id })),
                [{ nombre: `Cambio del ${ind}`, color: sube }], { signo: true, etiquetaAncho: 170, altoFila: 18, alClic: (f) => {
                    elegir(f.clave);
                    const s = SUB.features.find((x) => x.properties.id === f.clave);
                    if (s) map.fitBounds(caja(s), { padding: 40, duration: 1200, maxZoom: 10 });
                } });
        }
        const parar = () => { clearInterval(play); play = 0; $("btnPlayIdx").textContent = "Reproducir"; };
        $("rngIdx").max = anios.length - 1;
        $("rngIdx").oninput = () => { parar(); poner(+$("rngIdx").value); };
        $("btnPlayIdx").onclick = () => {
            if (play) return parar();
            $("btnPlayIdx").textContent = "Pausa";
            // las imagenes del indice elegido se piden antes para que la animacion no parpadee
            anios.forEach((y) => { new Image().src = url(ind, y); });
            play = setInterval(() => poner((i + 1) % anios.length), 900);
        };
        document.querySelectorAll("#segIdx button").forEach((b) => b.onclick = () => {
            ind = b.dataset.i;
            document.querySelectorAll("#segIdx button").forEach((x) => x.classList.toggle("activo", x === b));
            rampa(); poner(i);
        });
        document.querySelectorAll("#segIdxVista button").forEach((b) => b.onclick = () => {
            vista = b.dataset.v;
            document.querySelectorAll("#segIdxVista button").forEach((x) => x.classList.toggle("activo", x === b));
            poner(i);
        });
        // otros indices: solo la serie de la cuenca
        $("selOtroIdx").innerHTML = Object.keys(OTROS_IDX).map((k) => `<option value="${k}">${k}</option>`).join("");
        $("selOtroIdx").onchange = () => {
            const k = $("selOtroIdx").value, n = X.campos.indexOf(k);
            $("txtOtroIdx").textContent = OTROS_IDX[k];
            G.grafica($("gOtroIdx"), [{ nombre: k, color: "#26292d", puntos: anios.map((y, j) => [y, X.cuenca[j][n]]) }], { cero: false, bandas: cortes });
        };
        $("selOtroIdx").onchange();
        rampa();
        indicesCuenca.redibujar = () => { poner(i); $("selOtroIdx").onchange(); };
    }

    // ------------------------------------------------------------------
    // 7b. Indice espectral de turbidez (NDTI) y color real en la desembocadura
    // ------------------------------------------------------------------
    const COL_SENSOR = { Landsat: "#2a78d6", "Sentinel-2": "#eb6834" };
    function indices() {
        const D = SER.desembocadura, c = D.caja, lista = D.anios;
        const coords = [[c[0], c[3]], [c[2], c[3]], [c[2], c[1]], [c[0], c[1]]];
        const url = (m, a) => `datos/desembocadura/${m}_${a}.${m === "rgb" ? "jpg" : "png"}`;
        const mapaSat = (id, extra = {}) => new maplibregl.Map({ container: id, cooperativeGestures: true, bounds: [[c[0], c[1]], [c[2], c[3]]],
            fitBoundsOptions: { padding: 10 }, maxZoom: 16, style: { version: 8, sources: { sat: SAT },
                layers: [{ id: "sat", type: "raster", source: "sat", paint: { "raster-saturation": -0.5, "raster-brightness-max": 0.85 } }] }, ...extra });
        let i = lista.length - 2, modo = "ndti", play = 0;   // arranca en 2025 (2026 esta incompleto)
        const map = mapaSat("mapaNdti", { attributionControl: { compact: true } });
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
        listo(map).then(() => {
            ["rgb", "ndti"].forEach((m) => {
                map.addSource(m, { type: "image", url: url(m, lista[i].anio), coordinates: coords });
                map.addLayer({ id: m, type: "raster", source: m, paint: { "raster-fade-duration": 0, "raster-resampling": m === "ndti" ? "nearest" : "linear" } });
            });
            poner(i);
        });
        const [lo, hi] = D.rango;
        $("rampaNdti").innerHTML = `<div class="barra" style="background:linear-gradient(90deg,${D.paleta.join(",")})"></div>` +
            `<div class="marcas"><span>${num(lo, 1)} · agua más clara</span><span>NDTI</span><span>${num(hi, 1)} · más turbia</span></div>`;
        $("leyNdti").innerHTML = Object.entries(COL_SENSOR).map(([n, col]) => `<span><i style="background:${col}"></i>${n}</span>`).join("");
        function poner(k) {
            i = k;
            const r = lista[i];
            $("rngNdti").value = i;
            $("txtNdti").textContent = r.anio;
            ["ndti", "rgb"].forEach((m) => {
                if (!map.getLayer(m)) return;
                map.setLayoutProperty(m, "visibility", m === modo ? "visible" : "none");
                if (m === modo) map.getSource(m).updateImage({ url: url(m, r.anio), coordinates: coords });
            });
            mini($("miniNdti"), [["Año", r.anio + (r.anio === 2026 ? " (en curso)" : "")], ["Sensor", r.sensor],
                ["NDTI mediano", r.mediana != null ? num(r.mediana, 2) : "—"], ["Zona con dato", `${num(r.cobertura)} %`]]);
            G.grafica($("gNdti"), Object.keys(COL_SENSOR).map((s) => ({ nombre: s, color: COL_SENSOR[s],
                puntos: lista.filter((x) => x.sensor === s).map((x) => [x.anio, x.mediana]) })),
            { cero: false, marcarX: r.anio, alClicX: (x) => { const k = lista.findIndex((y) => y.anio === x); if (k >= 0) { parar(); poner(k); } } });
        }
        const parar = () => { clearInterval(play); play = 0; $("btnPlayNdti").textContent = "Reproducir"; };
        $("rngNdti").max = lista.length - 1;
        $("rngNdti").oninput = () => { parar(); poner(+$("rngNdti").value); };
        $("btnPlayNdti").onclick = () => {
            if (play) return parar();
            $("btnPlayNdti").textContent = "Pausa";
            play = setInterval(() => poner((i + 1) % lista.length), 900);
        };
        document.querySelectorAll("#segNdti button").forEach((b) => b.onclick = () => {
            modo = b.dataset.m;
            document.querySelectorAll("#segNdti button").forEach((x) => x.classList.toggle("activo", x === b));
            poner(i);
        });
        indices.redibujar = () => poner(i);

        // cortina de color real entre dos anos (por defecto 1985 y 2025; 1992 tiene mucha nube)
        const A = mapaSat("mapaDesA", { attributionControl: false }), B = mapaSat("mapaDesD", { attributionControl: { compact: true } });
        B.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
        cortina($("cmpDes"), A, B);
        const ops = lista.map((x, k) => `<option value="${k}">${x.anio}${x.anio === 1992 ? " (nubes)" : x.anio === 2026 ? " (en curso)" : ""}</option>`).join("");
        $("selDesA").innerHTML = $("selDesD").innerHTML = ops;
        $("selDesA").value = 0; $("selDesD").value = lista.length - 2;
        const cambiar = () => [[A, "selDesA", "etDesA", "Antes"], [B, "selDesD", "etDesD", "Después"]].forEach(([m, sel, et, txt]) => {
            const a = lista[+$(sel).value].anio;
            $(et).textContent = `${txt} · ${a}`;
            if (m.getSource("rgb")) m.getSource("rgb").updateImage({ url: url("rgb", a), coordinates: coords });
            else {
                m.addSource("rgb", { type: "image", url: url("rgb", a), coordinates: coords });
                m.addLayer({ id: "rgb", type: "raster", source: "rgb", paint: { "raster-fade-duration": 0 } });
            }
        });
        $("selDesA").onchange = $("selDesD").onchange = cambiar;
        Promise.all([listo(A), listo(B)]).then(cambiar);
    }

    // ------------------------------------------------------------------
    // 8. Mapas historicos (1864 y 1963) contra la imagen de hoy
    // ------------------------------------------------------------------
    const MAPAS_HIS = {
        bolivar_1864: { etiqueta: "1864 · Carta corográfica del Estado de Bolívar", vista: [[-76.2, 8.62], [-75.5, 9.45]],
            nota: "Mapa del siglo XIX: su geometría es aproximada. Se ajustó con 29 poblaciones, así que pasa justo por ellas, pero entre una y otra " +
                "el error puede ser de kilómetros (unos 15 km en promedio). Sirve para ver qué ciénagas y caños existían, no para medir áreas. " +
                "Montería (\"S. Jerónimo\") no se usó porque está dibujada fuera de su sitio; la ciénaga de Betancí cae en su lugar sin haberla usado, " +
                "y esa es la prueba independiente. Línea amarilla: límite de la cuenca." },
        "incora_61-IB-4d": { etiqueta: "1963 · INCORA, plancha 61-IB-4d", nota: "Plancha 1:5.000 restituida de fotos aéreas de 1963, puesta en su " +
                "sitio con la cuadrícula de 500 m (error de unos 5 m). Ciénagas El Maguey, Malagana, Los Caballos y El Polo. En cian, los cuerpos de " +
                "agua de 1963 trazados sobre la plancha: hoy casi todos son potreros." },
        "incora_61-IB-2b": { etiqueta: "1963 · INCORA, plancha 61-IB-2b", nota: "Plancha 1:5.000 de fotos aéreas de 1963 (error de unos 7 m). " +
                "Ciénagas La Pisinga, La Cranchina y Charco Pelao. Solo hay estas dos planchas: faltan las de Lorica, Momil y Chimá, así que las " +
                "ciénagas de 1963 no son las de todo el bajo Sinú." }
    };
    async function historicos() {
        const H = SER.historicos, CIEN = await cargar(CAPAS + "cienagas_1963.geojson");
        mini($("miniHis"), [
            ["Cuerpos de agua de 1963", num(H.cienagas.n)], ["Área en 1963 (dos planchas)", `${num(H.cienagas.ha["61-IB-4d"] + H.cienagas.ha["61-IB-2b"], 1)} ha`],
            ["Error de las planchas de 1963", "5–7 m"], ["Error del mapa de 1864", "≈ 15 km"]
        ]);
        const opciones = { cooperativeGestures: true, maxZoom: 18, bounds: MAPAS_HIS.bolivar_1864.vista,
            style: { version: 8, sources: { sat: SAT }, layers: [{ id: "sat", type: "raster", source: "sat" }] } };
        const A = new maplibregl.Map({ container: "mapaHisA", attributionControl: false, ...opciones });
        const D = new maplibregl.Map({ container: "mapaHisD", attributionControl: { compact: true }, ...opciones });
        D.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
        cortina($("cmpHis"), A, D);
        await Promise.all([listo(A), listo(D)]);
        Object.entries(H.mapas).forEach(([k, m]) => {
            const c = m.caja;
            A.addSource(k, { type: "image", url: m.url, coordinates: [[c[0], c[3]], [c[2], c[3]], [c[2], c[1]], [c[0], c[1]]] });
            A.addLayer({ id: k, type: "raster", source: k, layout: { visibility: "none" }, paint: { "raster-fade-duration": 0 } });
        });
        [A, D].forEach((m) => {
            m.addSource("cuenca", { type: "geojson", data: CUENCA });
            m.addLayer({ id: "cuenca", type: "line", source: "cuenca", paint: { "line-color": "#ffde00", "line-width": 2 } });
            m.addSource("cien", { type: "geojson", data: CIEN });
            m.addLayer({ id: "cien", type: "line", source: "cien", paint: { "line-color": "#22d3ee", "line-width": 2 } });
        });
        let actual = "bolivar_1864";
        const cienagas = () => [A, D].forEach((m) => m.setLayoutProperty("cien", "visibility",
            $("chkCienHis").checked && (m === D || actual !== "bolivar_1864") ? "visible" : "none"));
        const poner = (k, volar) => {
            actual = k;
            Object.keys(H.mapas).forEach((x) => A.setLayoutProperty(x, "visibility", x === k ? "visible" : "none"));
            $("etHisA").textContent = MAPAS_HIS[k].etiqueta;
            $("notaHis").textContent = MAPAS_HIS[k].nota;
            cienagas();
            if (volar) {
                const c = H.mapas[k].caja;
                D.fitBounds(MAPAS_HIS[k].vista || [[c[0], c[1]], [c[2], c[3]]], { padding: 20, duration: 1400 });
            }
        };
        document.querySelectorAll("#segHis button").forEach((b) => b.onclick = () => {
            document.querySelectorAll("#segHis button").forEach((x) => x.classList.toggle("activo", x === b));
            poner(b.dataset.m, true);
        });
        $("chkCienHis").onchange = cienagas;
        D.on("click", "cien", (e) => new maplibregl.Popup({ maxWidth: "240px" }).setLngLat(e.lngLat)
            .setHTML(`<b>Cuerpo de agua en 1963</b><br>Plancha ${e.features[0].properties.plancha} · ${num(e.features[0].properties.ha, 1)} ha`).addTo(D));
        poner(actual, false);
    }

    // ------------------------------------------------------------------
    async function iniciar() {
        try {
            [SER, CUENCA, SUB, EST, LOT] = await Promise.all([cargar("datos/series.json"), cargar(CAPAS + "cuenca.geojson"),
                cargar("datos/subcuencas.geojson"), cargar(CAPAS + "estaciones.geojson"), cargar(CAPAS + "lotico_lentico_2020.geojson")]);
        } catch (e) {
            $("cifras").innerHTML = `<p class="nota">No se pudieron cargar los datos (${e.message}). Abre la página desde el servidor local, no con doble clic.</p>`;
            return;
        }
        cifras();
        agua();
        estaciones();
        inundacion();
        oni();
        suelos();
        comparador().catch((e) => console.warn("Comparador:", e));
        camellones().catch((e) => console.warn("Camellones:", e));
        indices();
        if (SER.indices) indicesCuenca();
        historicos().catch((e) => console.warn("Mapas historicos:", e));
        // las graficas se vuelven a dibujar al cambiar el ancho de la ventana
        let t;
        window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(() => { oni(); suelos(); indices.redibujar(); if (indicesCuenca.redibujar) indicesCuenca.redibujar(); $("selLluvia").onchange(); $("selCaudal").onchange(); $("rngAnio").oninput(); }, 200); });
    }
    iniciar();
})();
