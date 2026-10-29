// Motor del visor 3D de cuencas (MapLibre). Cada pagina define window.VISOR3D antes de cargarlo.
(() => {
    "use strict";
    // Configuracion de cada cuenca: la pone la pagina en window.VISOR3D antes de cargar este archivo
    const CFG = Object.assign({
        datos: "datos/",          // carpeta con rejilla.json, dem.png, direcciones.png, zonas.png, subcuencas y drenaje
        colores: {},              // color de cada "cuenca" (grupo de subcuencas)
        embalses: false,          // datos/embalses.geojson + pestana de embalses
        ideam: false,             // niveles del IDEAM en vivo
        clima: false,             // lluvia de Open-Meteo
        gota: true,               // boton "Gota desde lo mas alto" en la ficha
        ciudad: { centro: [-74.072, 4.6], texto: "Se ven al acercarse a una ciudad." },
        ordenBase: 0,             // se resta al orden de Strahler para el grosor (redes que empiezan en orden 3)
        // Ganchos para que una pagina agregue lo suyo sin tocar el motor:
        alIniciar: null,          // (api) cuando el mapa y los datos estan listos
        alClic: null,             // (evento) antes de seleccionar subcuenca; si devuelve true no sigue
        alPestana: null,          // (pestana) al cambiar de pestana
        alFicha: null             // (propiedades, ficha) despues de armar la ficha de una subcuenca
    }, window.VISOR3D || {});
    const $ = (id) => document.getElementById(id);
    const num = (v, d = 0) => Number(v).toLocaleString("es-CO", { maximumFractionDigits: d, minimumFractionDigits: d });
    lucide.createIcons();

    // ---------- Colores ----------
    const COLOR_CUENCA = CFG.colores;
    // texto oscuro sobre colores claros (amarillo), blanco sobre los demas
    const textoSobre = (c) => {
        const v = parseInt(c.slice(1), 16);
        return (0.299 * (v >> 16) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) > 170 ? "#26292d" : "#fff";
    };
    const RAMPAS = {
        alt_media: { colores: ["#1a9850", "#a6d96a", "#fee08b", "#f46d43", "#a50026", "#ffffff"], unidad: " m", nombre: "Altura media" },
        pendiente_media: { colores: ["#ffffcc", "#fed976", "#fd8d3c", "#e31a1c", "#800026"], unidad: "°", nombre: "Pendiente media" },
        integral_hipsometrica: { colores: ["#2166ac", "#92c5de", "#f7f7f7", "#f4a582", "#b2182b"], unidad: "", nombre: "Integral hipsométrica" },
        lluvia: { colores: ["#f1f7fd", "#9ecae1", "#4292c6", "#2171b5", "#08306b", "#3f007d"], unidad: " mm", nombre: "Lluvia" }
    };
    // Fondo de lluvia: valores de corte fijos (mm) para comparar entre horas
    const CORTES_LLUVIA_H = [0, 0.5, 2, 5, 10, 20];
    const CORTES_LLUVIA_24 = [0, 5, 15, 30, 50, 80];

    // ---------- Estado ----------
    const S = {
        R: null, elev: null, dir: null, zona: null,
        sub: null, rios: null, porId: new Map(),
        herr: null, clics: [], gota: null, inund: null, clima: null, hora: 24,
        sel: null, marca: 0, visitado: null
    };
    // Vecinos D8 (mismo orden que preparar_datos.py): codigo 1..8
    const VEC = [null, [-1, 0], [-1, 1], [0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1]];
    const OPUESTO = [0, 5, 6, 7, 8, 1, 2, 3, 4];

    // ---------- Carga de datos ----------
    async function imagen(url) {
        const blob = await (await fetch(url)).blob();
        const bmp = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
        const c = document.createElement("canvas");
        c.width = bmp.width; c.height = bmp.height;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(bmp, 0, 0);
        return ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    }
    async function cargarDatos() {
        const [R, sub, rios, emb, dem, dir, zon] = await Promise.all([
            fetch(CFG.datos + "rejilla.json").then((r) => r.json()),
            fetch(CFG.datos + "subcuencas.geojson").then((r) => r.json()),
            fetch(CFG.datos + "drenaje.geojson").then((r) => r.json()),
            CFG.embalses ? fetch(CFG.datos + "embalses.geojson").then((r) => r.json()) : { type: "FeatureCollection", features: [] },
            imagen(CFG.datos + "dem.png"), imagen(CFG.datos + "direcciones.png"), imagen(CFG.datos + "zonas.png")
        ]);
        const n = R.ancho * R.alto;
        const elev = new Float32Array(n), d = new Uint8Array(n), z = new Uint8Array(n);
        for (let i = 0, p = 0; i < n; i++, p += 4) {
            const h = dem[p] * 256 + dem[p + 1] + dem[p + 2] / 256 - 32768;
            elev[i] = h < -9000 ? NaN : h;
            d[i] = dir[p];
            z[i] = zon[p];
        }
        Object.assign(S, { R, elev, dir: d, zona: z, sub, rios, emb, visitado: new Uint32Array(n) });
        sub.features.forEach((f) => S.porId.set(f.properties.id, f));
    }

    // ---------- Rejilla <-> coordenadas ----------
    function celda(lng, lat) {
        const R = S.R;
        const c = Math.floor((lng - R.oeste) / R.dx), f = Math.floor((R.norte - lat) / R.dy);
        if (c < 0 || f < 0 || c >= R.ancho || f >= R.alto) return -1;
        return f * R.ancho + c;
    }
    function centroCelda(i) {
        const R = S.R, f = Math.floor(i / R.ancho), c = i % R.ancho;
        return [R.oeste + (c + 0.5) * R.dx, R.norte - (f + 0.5) * R.dy];
    }
    function areaCeldaKm2(i) {
        const R = S.R, lat = R.norte - (Math.floor(i / R.ancho) + 0.5) * R.dy;
        return R.dx * 111.32 * Math.cos(lat * Math.PI / 180) * R.dy * 110.57;
    }
    function distM(a, b) {
        const lat = (a[1] + b[1]) / 2 * Math.PI / 180;
        return Math.hypot((b[0] - a[0]) * 111320 * Math.cos(lat), (b[1] - a[1]) * 110570);
    }
    // El punto mas bajo cerca del clic (para caer en el cauce y no en la ladera)
    function ajustarAlCauce(i, radio = 3) {
        const R = S.R, f0 = Math.floor(i / R.ancho), c0 = i % R.ancho;
        let mejor = i;
        for (let df = -radio; df <= radio; df++) for (let dc = -radio; dc <= radio; dc++) {
            const f = f0 + df, c = c0 + dc;
            if (f < 0 || c < 0 || f >= R.alto || c >= R.ancho) continue;
            const j = f * R.ancho + c;
            if (S.elev[j] < S.elev[mejor]) mejor = j;
        }
        return mejor;
    }
    // Camino D8 de una gota desde la celda i (lista de celdas)
    function caminoDesde(i) {
        const R = S.R, camino = [i];
        for (let paso = 0; paso < 60000; paso++) {
            const k = S.dir[i];
            if (!k) break;
            const f = Math.floor(i / R.ancho) + VEC[k][0], c = (i % R.ancho) + VEC[k][1];
            if (f < 0 || c < 0 || f >= R.alto || c >= R.ancho) break;
            i = f * R.ancho + c;
            camino.push(i);
        }
        return camino;
    }
    // Celda mas alta de una subcuenca cuya agua se queda en la misma cuenca grande
    // (la de mas arriba a veces cae justo al otro lado de la divisoria)
    function celdaAlta(id) {
        const celdas = [];
        for (let i = 0; i < S.zona.length; i++) if (S.zona[i] === id) celdas.push(i);
        celdas.sort((a, b) => S.elev[b] - S.elev[a]);
        const cuenca = S.porId.get(id).properties.cuenca;
        for (const i of celdas.slice(0, 3000)) {
            const sale = caminoDesde(i).find((j) => S.zona[j] && S.zona[j] !== id);
            if (!sale || S.porId.get(S.zona[sale])?.properties.cuenca === cuenca) return i;
        }
        return celdas[0];
    }
    function nombreZona(i) {
        const f = S.porId.get(S.zona[i]);
        return f ? f.properties.nombre : null;
    }

    // ---------- Mapa ----------
    const ESRI = "Imágenes: Esri, Maxar, Earthstar Geographics";
    const map = new maplibregl.Map({
        container: "mapa",
        center: [-74.0, 4.55], zoom: 8.3, pitch: 55, bearing: -15, maxPitch: 85,
        attributionControl: { compact: true },
        style: {
            version: 8,
            glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
            sources: {
                satelite: { type: "raster", tileSize: 256, maxzoom: 19, attribution: ESRI,
                    tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"] },
                topo: { type: "raster", tileSize: 256, maxzoom: 19, attribution: "Mapa: Esri",
                    tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}"] },
                claro: { type: "raster", tileSize: 256, maxzoom: 16, attribution: "Mapa: Esri, HERE, Garmin, © OpenStreetMap",
                    tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"] },
                terreno: { type: "raster-dem", encoding: "terrarium", tileSize: 256, maxzoom: 14, attribution: "Relieve: Mapzen / AWS",
                    tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"] },
                sombra: { type: "raster-dem", encoding: "terrarium", tileSize: 256, maxzoom: 14,
                    tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"] },
                edificios: { type: "vector", url: "https://tiles.openfreemap.org/planet" }
            },
            layers: [
                { id: "fondo", type: "background", paint: { "background-color": "#0f1418" } },
                { id: "base-satelite", type: "raster", source: "satelite", paint: { "raster-saturation": -0.15, "raster-contrast": 0.05 } },
                { id: "base-topo", type: "raster", source: "topo", layout: { visibility: "none" } },
                { id: "base-claro", type: "raster", source: "claro", layout: { visibility: "none" } },
                { id: "sombreado", type: "hillshade", source: "sombra",
                    paint: { "hillshade-exaggeration": 0.35, "hillshade-shadow-color": "#1b2a3a", "hillshade-highlight-color": "#fffbe6" } }
            ],
            sky: {
                "sky-color": "#7fb6e6", "sky-horizon-blend": 0.5, "horizon-color": "#e8f1f8",
                "horizon-fog-blend": 0.6, "fog-color": "#d6e3ec", "fog-ground-blend": 0.4
            }
        }
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");
    window.mapa = map;

    function ponerTerreno() {
        if ($("chk3d").checked) map.setTerrain({ source: "terreno", exaggeration: +$("rngExag").value });
        else map.setTerrain(null);
    }

    const vacio = { type: "FeatureCollection", features: [] };
    function agregarCapas() {
        // Subcuencas
        map.addSource("subcuencas", { type: "geojson", data: S.sub, promoteId: "id" });
        map.addLayer({ id: "sub-relleno", type: "fill", source: "subcuencas",
            paint: { "fill-color": "#f5c400", "fill-opacity": ["case", ["boolean", ["feature-state", "sel"], false], 0.55, ["boolean", ["feature-state", "hover"], false], 0.45, 0.28] } });
        map.addLayer({ id: "sub-borde", type: "line", source: "subcuencas",
            paint: { "line-color": "#ffffff", "line-width": ["case", ["boolean", ["feature-state", "sel"], false], 3.2, 1], "line-opacity": 0.85 } });
        // Drenaje
        map.addSource("rios", { type: "geojson", data: S.rios });
        const orden = ["max", 1, ["-", ["get", "orden"], CFG.ordenBase]];
        // el zoom solo puede ir en el "interpolate" de mas afuera: el factor y la suma van dentro de cada parada
        const anchoRio = (k = 1, mas = 0) => ["interpolate", ["linear"], ["zoom"], 7, ["+", ["*", 0.35 * k, orden], mas], 12, ["+", ["*", 1.4 * k, orden], mas]];
        const ancho = anchoRio();
        map.addLayer({ id: "rios-halo", type: "line", source: "rios", layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": "#0b3d6e", "line-width": anchoRio(1, 1.5), "line-opacity": 0.5 } });
        map.addLayer({ id: "rios", type: "line", source: "rios", layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": ["interpolate", ["linear"], orden, 1, "#90caf9", 3, "#42a5f5", 5, "#1565c0"], "line-width": ancho } });
        map.addLayer({ id: "rios-flujo", type: "line", source: "rios", filter: [">=", ["get", "orden"], 2 + CFG.ordenBase],
            layout: { "line-cap": "butt", "line-join": "round" },
            paint: { "line-color": "#e3f2fd", "line-width": anchoRio(0.55), "line-opacity": 0.85, "line-dasharray": [0, 4, 3] } });
        // Simulaciones
        map.addSource("cuenca-img", { type: "image", url: PIXEL, coordinates: COORD0 });
        map.addLayer({ id: "cuenca-img", type: "raster", source: "cuenca-img", paint: { "raster-opacity": 0.8, "raster-fade-duration": 0, "raster-resampling": "nearest" } });
        map.addSource("inund-img", { type: "image", url: PIXEL, coordinates: COORD0 });
        map.addLayer({ id: "inund-img", type: "raster", source: "inund-img", paint: { "raster-opacity": 0.85, "raster-fade-duration": 0 } });
        map.addSource("gota", { type: "geojson", data: vacio });
        map.addLayer({ id: "gota-halo", type: "line", source: "gota", filter: ["==", ["geometry-type"], "LineString"],
            paint: { "line-color": "#ffffff", "line-width": 7, "line-opacity": 0.7 } });
        map.addLayer({ id: "gota-linea", type: "line", source: "gota", filter: ["==", ["geometry-type"], "LineString"],
            paint: { "line-color": "#00b0ff", "line-width": 4 } });
        map.addSource("gota-punto", { type: "geojson", data: vacio });
        map.addLayer({ id: "gota-punto", type: "circle", source: "gota-punto",
            paint: { "circle-radius": 8, "circle-color": "#00b0ff", "circle-stroke-color": "#fff", "circle-stroke-width": 3 } });
        map.addSource("perfil", { type: "geojson", data: vacio });
        map.addLayer({ id: "perfil-linea", type: "line", source: "perfil", filter: ["==", ["geometry-type"], "LineString"],
            paint: { "line-color": "#f5c400", "line-width": 4, "line-dasharray": [2, 1] } });
        map.addLayer({ id: "perfil-puntos", type: "circle", source: "perfil", filter: ["all", ["==", ["geometry-type"], "Point"], ["!", ["has", "cursor"]]],
            paint: { "circle-radius": 6, "circle-color": "#f5c400", "circle-stroke-color": "#26292d", "circle-stroke-width": 2 } });
        map.addLayer({ id: "perfil-cursor", type: "circle", source: "perfil", filter: ["==", ["get", "cursor"], true],
            paint: { "circle-radius": 7, "circle-color": "#fff", "circle-stroke-color": "#26292d", "circle-stroke-width": 3 } });
        // Edificios 3D (OpenStreetMap via OpenFreeMap)
        map.addLayer({ id: "edificios", type: "fill-extrusion", source: "edificios", "source-layer": "building", minzoom: 13,
            layout: { visibility: "none" },
            paint: { "fill-extrusion-color": "#e8e3d6", "fill-extrusion-opacity": 0.9,
                "fill-extrusion-height": ["coalesce", ["get", "render_height"], 6],
                "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0] } });
        // Embalses
        map.addSource("embalses", { type: "geojson", data: S.emb });
        map.addLayer({ id: "emb-relleno", type: "fill", source: "embalses", paint: { "fill-color": "#0288d1", "fill-opacity": 0.75 } });
        map.addLayer({ id: "emb-borde", type: "line", source: "embalses", paint: { "line-color": "#e1f5fe", "line-width": 1.6 } });
        map.addSource("emb-etq", { type: "geojson", data: {
            type: "FeatureCollection",
            features: S.emb.features.filter((f) => f.properties.centro).map((f) => ({
                type: "Feature", properties: { nombre: f.properties.nombre.replace("Embalse ", "").replace(/^de(l)? /, "") },
                geometry: { type: "Point", coordinates: f.properties.centro } }))
        } });
        map.addLayer({ id: "emb-etq", type: "symbol", source: "emb-etq",
            layout: { "text-field": ["get", "nombre"], "text-font": ["Noto Sans Bold"], "text-size": 12, "text-offset": [0, 1.2],
                "icon-allow-overlap": true, "text-allow-overlap": false },
            paint: { "text-color": "#e1f5fe", "text-halo-color": "#01579b", "text-halo-width": 1.8 } });
        // Estaciones del IDEAM (se llenan al consultar)
        map.addSource("ideam", { type: "geojson", data: vacio });
        map.addLayer({ id: "ideam-punto", type: "circle", source: "ideam",
            paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 7, 5, 12, 9],
                "circle-color": ["interpolate", ["linear"], ["get", "subida"], 0, "#66bb6a", 0.3, "#ffee58", 1, "#ffa726", 2, "#e53935"],
                "circle-stroke-color": "#1b2a3a", "circle-stroke-width": 2 } });
        map.addLayer({ id: "ideam-etq", type: "symbol", source: "ideam", minzoom: 8.6,
            layout: { "text-field": ["get", "etiqueta"], "text-font": ["Noto Sans Bold"], "text-size": 11, "text-offset": [0, 1.3], "text-anchor": "top" },
            paint: { "text-color": "#fff", "text-halo-color": "rgba(10,20,30,.9)", "text-halo-width": 1.5 } });
        // Etiquetas
        map.addSource("etiquetas", { type: "geojson", data: {
            type: "FeatureCollection",
            features: S.sub.features.filter((f) => f.properties.centro).map((f) => ({
                type: "Feature", properties: { nombre: f.properties.nombre, area: f.properties.area_km2 },
                geometry: { type: "Point", coordinates: f.properties.centro } }))
        } });
        map.addLayer({ id: "etiquetas", type: "symbol", source: "etiquetas",
            layout: { "text-field": ["get", "nombre"], "text-font": ["Noto Sans Bold"], "text-size": ["interpolate", ["linear"], ["zoom"], 7, 9, 11, 13],
                "symbol-sort-key": ["-", 0, ["get", "area"]], "text-max-width": 9, "text-padding": 4 },
            paint: { "text-color": "#ffffff", "text-halo-color": "rgba(10,20,30,.85)", "text-halo-width": 1.6 } });
    }
    const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const COORD0 = [[-74, 4.6], [-73.99, 4.6], [-73.99, 4.59], [-74, 4.59]];

    // ---------- Agua en movimiento (rayas que corren sobre los rios) ----------
    const PASOS = [
        [0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0],
        [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5]
    ];
    let pasoFlujo = -1;
    // Cada paso cambia el estilo, y con el relieve 3D eso obliga a redibujar todas las capas sobre el
    // terreno: con muchas capas (rio Sinu) el mapa se trababa. Con 3D se avanza mas despacio y nunca
    // mientras el mapa se mueve o esta cargando.
    function animarFlujo(t) {
        const en3d = !!map.getTerrain();
        if ($("chkFlujo").checked && $("chkRios").checked && map.getLayer("rios-flujo") && !(en3d && (map.isMoving() || !map.areTilesLoaded()))) {
            const paso = Math.floor(t / (en3d ? 260 : 70)) % PASOS.length;
            if (paso !== pasoFlujo) {
                map.setPaintProperty("rios-flujo", "line-dasharray", PASOS[paso]);
                pasoFlujo = paso;
            }
        }
        requestAnimationFrame(animarFlujo);
    }

    // ---------- Colores de subcuencas ----------
    function rampa(colores, min, max) {
        const e = ["interpolate", ["linear"], ["coalesce", ["get", "valor"], min]];
        colores.forEach((c, k) => e.push(min + (max - min) * k / (colores.length - 1), c));
        return e;
    }
    function rampaCortes(colores, cortes) {
        const e = ["interpolate", ["linear"], ["coalesce", ["get", "valor"], 0]];
        cortes.forEach((v, k) => e.push(v, colores[Math.min(k, colores.length - 1)]));
        return e;
    }
    function leyendaRampa(el, colores, a, b, unidad, d = 0) {
        el.innerHTML = `<div class="barra" style="background:linear-gradient(90deg,${colores.join(",")})"></div>
            <div class="extremos"><span>${num(a, d)}${unidad}</span><span>${num(b, d)}${unidad}</span></div>`;
    }
    function colorear() {
        const modo = $("selColor").value;
        const ley = $("leyenda");
        if (modo === "cuenca") {
            const e = ["match", ["get", "cuenca"]];
            Object.entries(COLOR_CUENCA).forEach(([k, c]) => e.push(k, c));
            e.push("#cccccc");
            map.setPaintProperty("sub-relleno", "fill-color", e);
            ley.innerHTML = Object.entries(COLOR_CUENCA).map(([k, c]) => `<div class="item"><i style="background:${c}"></i>${k}</div>`).join("");
            return;
        }
        if (modo.startsWith("lluvia")) {
            if (!S.clima) { ley.innerHTML = `<p class="nota">Cargando la lluvia…</p>`; cargarClima().then(colorear); return; }
            S.sub.features.forEach((f) => { f.properties.valor = S.clima.porId.get(f.properties.id)?.[modo === "lluvia_pasada" ? "pasada" : "futura"] ?? 0; });
            map.getSource("subcuencas").setData(S.sub);
            map.setPaintProperty("sub-relleno", "fill-color", rampaCortes(RAMPAS.lluvia.colores, CORTES_LLUVIA_24));
            leyendaRampa(ley, RAMPAS.lluvia.colores, 0, CORTES_LLUVIA_24.at(-1), " mm o más");
            ley.innerHTML += `<p class="nota">${modo === "lluvia_pasada" ? "Lluvia acumulada en las últimas 24 horas." : "Lluvia esperada en las próximas 24 horas."}</p>`;
            return;
        }
        const r = RAMPAS[modo];
        const vals = S.sub.features.map((f) => f.properties[modo]).filter((v) => v != null);
        const a = Math.min(...vals), b = Math.max(...vals);
        S.sub.features.forEach((f) => { f.properties.valor = f.properties[modo]; });
        map.getSource("subcuencas").setData(S.sub);
        map.setPaintProperty("sub-relleno", "fill-color", rampa(r.colores, a, b));
        leyendaRampa(ley, r.colores, a, b, r.unidad, modo === "integral_hipsometrica" ? 2 : modo === "pendiente_media" ? 1 : 0);
        if (modo === "integral_hipsometrica") ley.innerHTML += `<p class="nota">Valores altos: relieve "joven", con mucho terreno en lo alto
            (valles en formación). Valores bajos: relieve "viejo", ya muy erosionado.</p>`;
    }

    // ---------- Ficha de subcuenca ----------
    function seleccionar(id, volar = false) {
        if (S.sel != null) map.setFeatureState({ source: "subcuencas", id: S.sel }, { sel: false });
        S.sel = id;
        const f = S.porId.get(id);
        if (!f) { $("ficha").hidden = true; return; }
        map.setFeatureState({ source: "subcuencas", id }, { sel: true });
        const p = f.properties;
        const color = COLOR_CUENCA[p.cuenca] || "#888";
        const ih = p.integral_hipsometrica;
        const etapa = ih == null ? "" : ih > 0.5 ? "joven (mucho relieve por erosionar)" : ih > 0.35 ? "madura (en equilibrio)" : "vieja (muy erosionada)";
        const kc = p.kc;
        const forma = kc == null ? "" : kc < 1.25 ? "casi redonda: el agua llega toda junta y rápido a la salida" :
            kc < 1.5 ? "ovalada: respuesta intermedia a las lluvias" : "alargada: el agua llega más repartida en el tiempo";
        const lluvia = S.clima?.porId.get(id);
        $("ficha").innerHTML = `
            <button type="button" class="cerrar" id="fichaCerrar" title="Cerrar"><i data-lucide="x"></i></button>
            <span class="eti" style="background:${color};color:${textoSobre(color)}">${p.cuenca}</span>
            <h2>${p.nombre}</h2>
            <p class="sub">Subcuenca ${p.codsch}</p>
            <div class="datos">
                <div class="dato"><small>Área</small><b>${num(p.area_km2)} km²</b></div>
                <div class="dato"><small>Perímetro</small><b>${num(p.perimetro_km)} km</b></div>
                <div class="dato"><small>Pendiente media</small><b>${num(p.pendiente_media, 1)}°</b></div>
                <div class="dato"><small>Altura mínima</small><b>${num(p.alt_min)} m</b></div>
                <div class="dato"><small>Altura media</small><b>${num(p.alt_media)} m</b></div>
                <div class="dato"><small>Altura máxima</small><b>${num(p.alt_max)} m</b></div>
            </div>
            ${lluvia ? `<div class="datos" style="grid-template-columns:1fr 1fr">
                <div class="dato"><small>Lluvia últimas 24 h</small><b>${num(lluvia.pasada, 1)} mm</b></div>
                <div class="dato"><small>Próximas 24 h</small><b>${num(lluvia.futura, 1)} mm</b></div></div>
                <p class="explica">Sobre toda la subcuenca eso son unos <b>${num(lluvia.futura * p.area_km2 / 1000, 1)} millones de m³</b> de agua lloviendo en las próximas 24 h.</p>` : ""}
            ${p.caud_med != null ? `<h3>Agua (POMCA)</h3>
            <div class="datos">
                <div class="dato"><small>Caudal medio</small><b>${num(p.caud_med, 1)} m³/s</b></div>
                <div class="dato"><small>Caudal máximo</small><b>${num(p.q_max, 1)} m³/s</b></div>
                <div class="dato"><small>Caudal mínimo</small><b>${num(p.q_min, 2)} m³/s</b></div>
            </div>
            <p class="explica">Caudal ambiental <b>${num(p.q_ambienta, 2)} m³/s</b> · disponible <b>${num(p.q_disponib, 2)} m³/s</b>${p.tiem_conc ? ` · tiempo de concentración <b>${num(p.tiem_conc / 60, 1)} h</b>` : ""}.
                Corriente ${(p.t_corrien || "").toLowerCase()}.</p>` : ""}
            <h3>Curva hipsométrica</h3>
            <svg class="hipso" id="hipso" viewBox="0 0 300 150" preserveAspectRatio="none"></svg>
            <p class="explica">Qué parte del área (eje horizontal) está por encima de cada altura. Integral hipsométrica
                <b>${ih == null ? "—" : num(ih, 2)}</b>: cuenca <b>${etapa}</b>.</p>
            <h3>Forma</h3>
            <p class="explica">Coeficiente de compacidad (Gravelius) <b>${kc == null ? "—" : num(kc, 2)}</b>: ${forma}.</p>
            <div class="acciones">
                <button type="button" class="boton primario" id="fichaVolar"><i data-lucide="video"></i> Sobrevuelo</button>
                ${CFG.gota ? `<button type="button" class="boton" id="fichaGota"><i data-lucide="droplet"></i> Gota desde lo más alto</button>` : ""}
            </div>`;
        $("ficha").hidden = false;
        lucide.createIcons();
        dibujarHipso(p);
        if (CFG.alFicha) CFG.alFicha(p, $("ficha"));
        $("fichaCerrar").onclick = () => { $("ficha").hidden = true; map.setFeatureState({ source: "subcuencas", id }, { sel: false }); S.sel = null; };
        $("fichaVolar").onclick = () => sobrevuelo(f);
        if (CFG.gota) $("fichaGota").onclick = () => {
            activarPestana("simular");
            lanzarGota(celdaAlta(id), true);
        };
        if (volar) volarA(f);
    }
    function cajaDe(f) {
        let a = [180, 90, -180, -90];
        // sirve para Polygon y MultiPolygon (y cualquier geometria): se recorren todos los puntos
        const recorrer = (c) => { if (typeof c[0] === "number") a = [Math.min(a[0], c[0]), Math.min(a[1], c[1]), Math.max(a[2], c[0]), Math.max(a[3], c[1])]; else c.forEach(recorrer); };
        recorrer(f.geometry.coordinates);
        return [[a[0], a[1]], [a[2], a[3]]];
    }
    function volarA(f) {
        const izq = window.innerWidth > 900 ? 360 : 20, der = window.innerWidth > 900 ? 370 : 20;
        map.fitBounds(cajaDe(f), { padding: { top: 90, bottom: 60, left: izq, right: der }, pitch: 60, bearing: map.getBearing(), duration: 2200 });
    }

    // ---------- Sobrevuelo ----------
    // Llega en diagonal, baja y da una vuelta completa alrededor de la subcuenca mirando al centro,
    // con los paneles escondidos, la subcuenca casi transparente y el relieve mas exagerado.
    // Cualquier clic, rueda o toque lo detiene y deja todo como estaba.
    const SOBRE = { anim: 0, activo: false, antes: null, f: null };
    function sobrevuelo(f) {
        pararSobrevuelo(false);
        const caja = cajaDe(f);
        const centro = f.properties.centro || [(caja[0][0] + caja[1][0]) / 2, (caja[0][1] + caja[1][1]) / 2];
        const cam = map.cameraForBounds(caja, { padding: 30 });
        const z0 = Math.min(cam ? cam.zoom + 0.35 : map.getZoom(), 14.5);
        const ter = map.getTerrain();
        SOBRE.antes = { op: map.getPaintProperty("sub-relleno", "fill-opacity"), ter, ficha: !$("ficha").hidden };
        SOBRE.activo = true; SOBRE.f = f;
        document.body.classList.add("en-sobrevuelo");
        $("ficha").hidden = true;
        map.setPaintProperty("sub-relleno", "fill-opacity", ["case", ["boolean", ["feature-state", "sel"], false], 0.1, 0.03]);
        if (ter) map.setTerrain({ source: "terreno", exaggeration: Math.max(ter.exaggeration || 1, 2.2) });
        let chip = $("chipSobrevuelo");
        if (!chip) {
            chip = document.createElement("button");
            chip.type = "button"; chip.id = "chipSobrevuelo"; chip.className = "chip-sobrevuelo";
            document.body.appendChild(chip);
        }
        chip.innerHTML = `<i data-lucide="square"></i><span>${f.properties.nombre} · detener sobrevuelo</span>`;
        chip.hidden = false;
        chip.onclick = () => pararSobrevuelo(true);
        lucide.createIcons();
        const b0 = map.getBearing() - 40;
        // 1) entrada en diagonal, desde arriba
        map.flyTo({ center: centro, zoom: z0, pitch: 68, bearing: b0, duration: 4200, curve: 1.6, essential: true });
        map.once("moveend", () => {
            if (!SOBRE.activo) return;
            // 2) vuelta completa: arranca y frena suave, se acerca a la mitad y sube el angulo de camara
            const dur = 38000, t0 = performance.now();
            const paso = (t) => {
                if (!SOBRE.activo) return;
                const u = Math.min(1, (t - t0) / dur);
                const s = u - Math.sin(2 * Math.PI * u) / (2 * Math.PI);
                const cerca = Math.sin(Math.PI * u);
                map.jumpTo({ center: centro, bearing: b0 + 360 * s, zoom: z0 + 0.75 * cerca, pitch: 68 + 10 * cerca });
                if (u < 1) SOBRE.anim = requestAnimationFrame(paso);
                else pararSobrevuelo(true);
            };
            SOBRE.anim = requestAnimationFrame(paso);
        });
    }
    function pararSobrevuelo(volver) {
        if (!SOBRE.activo) return;
        SOBRE.activo = false;
        cancelAnimationFrame(SOBRE.anim);
        document.body.classList.remove("en-sobrevuelo");
        if ($("chipSobrevuelo")) $("chipSobrevuelo").hidden = true;
        const a = SOBRE.antes;
        map.setPaintProperty("sub-relleno", "fill-opacity", a.op);
        if (a.ter) map.setTerrain(a.ter);
        if (a.ficha) $("ficha").hidden = false;
        if (volver) volarA(SOBRE.f);
    }
    ["mousedown", "wheel", "touchstart"].forEach((ev) => map.getCanvasContainer().addEventListener(ev, () => {
        if (SOBRE.activo) { map.stop(); pararSobrevuelo(false); }
    }, { passive: true }));
    function dibujarHipso(p) {
        const svg = $("hipso");
        if (!p.hipsometrica) { svg.innerHTML = ""; return; }
        const h = p.hipsometrica, a = h[0], b = h[h.length - 1] || a + 1;
        const x = (k) => 30 + 262 * k / (h.length - 1), y = (v) => 135 - 125 * (v - a) / (b - a || 1);
        const pts = h.map((v, k) => `${x(k).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
        svg.innerHTML = `
            <defs><linearGradient id="gh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8d6e63"/><stop offset=".5" stop-color="#9ccc65"/><stop offset="1" stop-color="#2e7d32"/></linearGradient></defs>
            <polygon points="30,135 ${pts} 292,135" fill="url(#gh)" opacity=".85"/>
            <polyline points="${pts}" fill="none" stroke="#26292d" stroke-width="1.6"/>
            <line x1="30" y1="135" x2="292" y2="135" stroke="#9aa0a6"/><line x1="30" y1="10" x2="30" y2="135" stroke="#9aa0a6"/>
            <text x="2" y="14" font-size="9" fill="#555">${num(a)}</text><text x="2" y="138" font-size="9" fill="#555">${num(b)}</text>
            <text x="30" y="148" font-size="9" fill="#555">0 %</text><text x="270" y="148" font-size="9" fill="#555">100 %</text>`;
    }

    // ---------- Herramientas de simulacion ----------
    const AYUDA = {
        gota: "Haz clic donde cae la gota: verás el camino que sigue el agua cuesta abajo.",
        cuenca: "Haz clic sobre un río: se pinta todo el terreno cuya lluvia termina pasando por ese punto.",
        inundacion: "Haz clic sobre un río y mueve el nivel del agua en el panel.",
        perfil: "Haz clic en dos puntos del mapa para ver el corte del terreno."
    };
    function elegirHerramienta(h) {
        S.herr = S.herr === h ? null : h;
        S.clics = [];
        document.querySelectorAll(".herr").forEach((b) => b.classList.toggle("activo", b.dataset.herr === S.herr));
        $("avisoHerr").hidden = !S.herr;
        if (S.herr) $("avisoHerr").querySelector("span").textContent = AYUDA[S.herr];
        map.getCanvas().style.cursor = S.herr ? "crosshair" : "";
        if ($("grupoNivel")) $("grupoNivel").hidden = S.herr !== "inundacion" && !S.inund;
        if (!S.herr) return;
        const r = $("resultado");
        r.className = "caja vacia";
        r.textContent = AYUDA[S.herr];
    }
    function resultado(html) {
        const r = $("resultado");
        r.className = "caja";
        r.innerHTML = html;
        lucide.createIcons();
    }

    // --- Gota de lluvia: sigue la direccion de flujo D8 hasta salir del mapa ---
    function lanzarGota(i0, volar = false) {
        const camino = caminoDesde(i0);
        const coords = camino.map(centroCelda);
        let largo = 0;
        for (let k = 1; k < coords.length; k++) largo += distM(coords[k - 1], coords[k]);
        // subcuencas que atraviesa, en orden
        const pasa = [];
        camino.forEach((c) => { const z = S.zona[c]; if (z && pasa.at(-1) !== z) pasa.push(z); });
        const nombres = [...new Set(pasa)].map((z) => S.porId.get(z)?.properties.nombre).filter(Boolean);
        const z0 = S.elev[i0], z1 = S.elev[camino.at(-1)];
        S.gota = { coords, largo };
        map.getSource("gota").setData({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [coords[0]] } });
        animarGota(coords);
        const sale = camino.length > 1 && S.zona[camino.at(-1)] === 0;
        resultado(`<h4><i data-lucide="droplet"></i> Recorrido de la gota</h4>
            <div class="datos">
                <div class="dato"><small>Distancia recorrida</small><b>${num(largo / 1000, 1)} km</b></div>
                <div class="dato"><small>Baja</small><b>${num(z0 - z1)} m</b></div>
                <div class="dato"><small>Sale a</small><b>${num(z0)} m</b></div>
                <div class="dato"><small>Llega a</small><b>${num(z1)} m</b></div>
            </div>
            <p class="explica">Pasa por ${nombres.length} subcuenca${nombres.length === 1 ? "" : "s"}: <b>${nombres.slice(0, 8).join(" → ")}${nombres.length > 8 ? " → …" : ""}</b>.
            ${sale ? "Al final sale del área de estudio (normalmente hacia el río Magdalena o los Llanos)." : ""}</p>
            <button type="button" class="boton agua ancho" id="btnVolarGota"><i data-lucide="plane"></i> Volar siguiendo el agua</button>`);
        $("btnVolarGota").onclick = () => volarPorCamino(coords);
        if (volar) volarPorCamino(coords);
    }
    let animGota = 0;
    function animarGota(coords) {
        cancelAnimationFrame(animGota);
        const t0 = performance.now(), dur = Math.min(6000, 600 + coords.length * 2);
        const paso = (t) => {
            const k = Math.min(coords.length, Math.max(2, Math.floor(coords.length * (t - t0) / dur)));
            map.getSource("gota").setData({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords.slice(0, k) } });
            map.getSource("gota-punto").setData({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: coords[k - 1] } });
            if (k < coords.length) animGota = requestAnimationFrame(paso);
        };
        animGota = requestAnimationFrame(paso);
    }
    // Camara que sigue el camino del agua (vuelo)
    let vuelo = 0;
    function volarPorCamino(coords) {
        cancelAnimationFrame(vuelo);
        // camino suavizado: un punto cada ~400 m
        const pts = [coords[0]];
        let acum = 0;
        for (let k = 1; k < coords.length; k++) {
            acum += distM(coords[k - 1], coords[k]);
            if (acum >= 400) { pts.push(coords[k]); acum = 0; }
        }
        pts.push(coords.at(-1));
        if (pts.length < 3) return;
        const vel = 900; // metros por segundo de animacion (aprox.)
        const tramos = [0];
        for (let k = 1; k < pts.length; k++) tramos.push(tramos[k - 1] + distM(pts[k - 1], pts[k]));
        const total = tramos.at(-1), dur = Math.max(8000, total / vel * 1000);
        const rumbo = (a, b) => Math.atan2((b[0] - a[0]) * Math.cos(a[1] * Math.PI / 180), b[1] - a[1]) * 180 / Math.PI;
        let bearing = map.getBearing();
        const t0 = performance.now();
        const paso = (t) => {
            const d = Math.min(total, total * (t - t0) / dur);
            let k = 1;
            while (k < tramos.length - 1 && tramos[k] < d) k++;
            const e = (d - tramos[k - 1]) / ((tramos[k] - tramos[k - 1]) || 1);
            const a = pts[k - 1], b = pts[k];
            const centro = [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e];
            const mira = pts[Math.min(pts.length - 1, k + 4)];
            let objetivo = rumbo(centro, mira), dif = ((objetivo - bearing + 540) % 360) - 180;
            bearing += dif * 0.04;
            map.jumpTo({ center: centro, bearing, pitch: 72, zoom: 12.6 });
            map.getSource("gota-punto").setData({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: centro } });
            if (d < total) vuelo = requestAnimationFrame(paso);
        };
        vuelo = requestAnimationFrame(paso);
    }
    const pararVuelo = () => cancelAnimationFrame(vuelo);
    ["mousedown", "wheel", "touchstart"].forEach((ev) => map.getCanvasContainer().addEventListener(ev, pararVuelo, { passive: true }));

    // --- Area que drena a un punto (cuenca aguas arriba) ---
    function areaQueDrena(i0) {
        const R = S.R, W = R.ancho, n = S.elev.length;
        const marca = ++S.marca;
        const vis = S.visitado;
        const pila = [i0];
        vis[i0] = marca;
        let fmin = R.alto, fmax = 0, cmin = W, cmax = 0, area = 0, cuenta = 0;
        const celdas = [];
        while (pila.length) {
            const i = pila.pop();
            celdas.push(i);
            cuenta++;
            area += areaCeldaKm2(i);
            const f = Math.floor(i / W), c = i % W;
            if (f < fmin) fmin = f; if (f > fmax) fmax = f; if (c < cmin) cmin = c; if (c > cmax) cmax = c;
            for (let k = 1; k <= 8; k++) {
                const ff = f + VEC[k][0], cc = c + VEC[k][1];
                if (ff < 0 || cc < 0 || ff >= R.alto || cc >= W) continue;
                const j = ff * W + cc;
                if (vis[j] === marca) continue;
                if (S.dir[j] === OPUESTO[k]) { vis[j] = marca; pila.push(j); }
            }
        }
        return { celdas, area, cuenta, fmin, fmax, cmin, cmax };
    }
    function pintarCeldas(src, celdas, caja, colorDe) {
        const R = S.R, w = caja.cmax - caja.cmin + 1, h = caja.fmax - caja.fmin + 1;
        const cv = document.createElement("canvas");
        cv.width = w; cv.height = h;
        const ctx = cv.getContext("2d");
        const img = ctx.createImageData(w, h);
        for (const i of celdas) {
            const f = Math.floor(i / R.ancho) - caja.fmin, c = (i % R.ancho) - caja.cmin;
            const p = (f * w + c) * 4, col = colorDe(i);
            img.data[p] = col[0]; img.data[p + 1] = col[1]; img.data[p + 2] = col[2]; img.data[p + 3] = col[3];
        }
        ctx.putImageData(img, 0, 0);
        const o = R.oeste + caja.cmin * R.dx, e = R.oeste + (caja.cmax + 1) * R.dx;
        const nn = R.norte - caja.fmin * R.dy, s = R.norte - (caja.fmax + 1) * R.dy;
        map.getSource(src).updateImage({ url: cv.toDataURL(), coordinates: [[o, nn], [e, nn], [e, s], [o, s]] });
    }
    function limpiarImg(src) { map.getSource(src).updateImage({ url: PIXEL, coordinates: COORD0 }); }

    function herramientaCuenca(i) {
        const i0 = ajustarAlCauce(i);
        const r = areaQueDrena(i0);
        // borde de la cuenca mas marcado: celdas con algun vecino fuera
        const marca = S.marca;
        pintarCeldas("cuenca-img", r.celdas, r, (j) => {
            const R = S.R, f = Math.floor(j / R.ancho), c = j % R.ancho;
            let borde = false;
            for (let k = 1; k <= 8 && !borde; k += 2) {
                const ff = f + VEC[k][0], cc = c + VEC[k][1];
                if (ff < 0 || cc < 0 || ff >= R.alto || cc >= R.ancho || S.visitado[ff * R.ancho + cc] !== marca) borde = true;
            }
            return borde ? [255, 214, 0, 255] : [255, 196, 0, 95];
        });
        let zmin = Infinity, zmax = -Infinity;
        r.celdas.forEach((j) => { const z = S.elev[j]; if (z < zmin) zmin = z; if (z > zmax) zmax = z; });
        const lluvia = S.clima ? lluviaSobreCeldas(r.celdas) : null;
        resultado(`<h4><i data-lucide="scan-search"></i> Área que drena a este punto</h4>
            <div class="datos">
                <div class="dato"><small>Área de drenaje</small><b>${num(r.area, r.area < 10 ? 2 : 0)} km²</b></div>
                <div class="dato"><small>Desnivel</small><b>${num(zmax - zmin)} m</b></div>
                <div class="dato"><small>Punto de salida</small><b>${num(S.elev[i0])} m</b></div>
                <div class="dato"><small>Punto más alto</small><b>${num(zmax)} m</b></div>
            </div>
            ${lluvia ? `<p class="explica">Con el pronóstico de las próximas 24 h caerían unos <b>${num(lluvia, 2)} millones de m³</b> de lluvia sobre esta área.</p>` : ""}
            <p class="explica">Toda la lluvia que cae en la zona amarilla termina pasando por el punto donde hiciste clic
            (${nombreZona(i0) || "fuera de las subcuencas"}).</p>`);
    }
    function lluviaSobreCeldas(celdas) {
        let v = 0;
        for (const j of celdas) {
            const z = S.zona[j];
            const ll = z ? S.clima.porId.get(z)?.futura || 0 : 0;
            v += ll * areaCeldaKm2(j);
        }
        return v / 1000; // mm * km2 = 1000 m3 -> millones de m3
    }

    // --- Inundacion tipo banera ---
    function herramientaInundacion(i) {
        S.inund = { i0: ajustarAlCauce(i) };
        $("grupoNivel").hidden = false;
        recalcularInundacion();
    }
    let rafInund = 0;
    function recalcularInundacion() {
        cancelAnimationFrame(rafInund);
        rafInund = requestAnimationFrame(() => {
            if (!S.inund) return;
            const h = +$("rngNivel").value;
            $("txtNivel").textContent = num(h, h % 1 ? 1 : 0) + " m";
            const R = S.R, W = R.ancho, i0 = S.inund.i0, nivel = S.elev[i0] + h;
            const marca = ++S.marca, vis = S.visitado, LIM = 1500000;
            const pila = [i0], celdas = [];
            vis[i0] = marca;
            let fmin = R.alto, fmax = 0, cmin = W, cmax = 0, area = 0, vol = 0, lleno = false;
            while (pila.length) {
                const i = pila.pop();
                celdas.push(i);
                const a = areaCeldaKm2(i);
                area += a;
                vol += (nivel - S.elev[i]) * a; // m * km2 = millones de m3
                const f = Math.floor(i / W), c = i % W;
                if (f < fmin) fmin = f; if (f > fmax) fmax = f; if (c < cmin) cmin = c; if (c > cmax) cmax = c;
                if (celdas.length >= LIM) { lleno = true; break; }
                for (let k = 1; k <= 8; k++) {
                    const ff = f + VEC[k][0], cc = c + VEC[k][1];
                    if (ff < 0 || cc < 0 || ff >= R.alto || cc >= W) continue;
                    const j = ff * W + cc;
                    if (vis[j] === marca) continue;
                    vis[j] = marca;
                    if (S.elev[j] <= nivel) pila.push(j);
                }
            }
            pintarCeldas("inund-img", celdas, { fmin, fmax, cmin, cmax }, (j) => {
                const p = Math.min(1, (nivel - S.elev[j]) / Math.max(1, h));
                return [Math.round(100 - 90 * p), Math.round(190 - 120 * p), Math.round(255 - 60 * p), Math.round(150 + 90 * p)];
            });
            const zonas = new Set(celdas.map((j) => S.zona[j]).filter(Boolean));
            resultado(`<h4><i data-lucide="waves-arrow-up"></i> Inundación simulada</h4>
                <div class="datos">
                    <div class="dato"><small>Área inundada</small><b>${num(area, area < 10 ? 2 : 0)} km²</b></div>
                    <div class="dato"><small>Volumen de agua</small><b>${num(vol, vol < 10 ? 2 : 0)} M m³</b></div>
                    <div class="dato"><small>Nivel del agua</small><b>${num(nivel)} m</b></div>
                    <div class="dato"><small>Subcuencas tocadas</small><b>${zonas.size}</b></div>
                </div>
                <p class="explica">Azul más oscuro = agua más profunda. Punto de partida: ${S.inund.origen ? "<b>" + S.inund.origen + "</b>, " : ""}${nombreZona(i0) || "el mapa"}, a ${num(S.elev[i0])} m.
                ${lleno ? "<b>Se detuvo al llegar a 1,5 millones de celdas:</b> la zona inundada es enorme." : ""}</p>`);
        });
    }

    // --- Perfil ---
    function herramientaPerfil(lngLat) {
        S.clics.push([lngLat.lng, lngLat.lat]);
        const puntos = S.clics.map((c) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: c } }));
        if (S.clics.length < 2) {
            map.getSource("perfil").setData({ type: "FeatureCollection", features: puntos });
            resultado(`<h4><i data-lucide="chart-spline"></i> Perfil del terreno</h4>Ahora haz clic en el segundo punto.`);
            return;
        }
        const [a, b] = S.clics;
        S.clics = [];
        S.perfilBase = [...puntos, { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [a, b] } }];
        map.getSource("perfil").setData({ type: "FeatureCollection", features: S.perfilBase });
        const total = distM(a, b), N = Math.max(200, Math.min(900, Math.round(total / 25))), muestras = [];
        for (let k = 0; k <= N; k++) {
            const p = [a[0] + (b[0] - a[0]) * k / N, a[1] + (b[1] - a[1]) * k / N];
            muestras.push({ d: total * k / N, z: alturaSuave(p[0], p[1]), p, i: celda(p[0], p[1]) });
        }
        S.perfilDatos = { m: muestras, total, cruces: crucesDeRios(a, b, total) };
        dibujarPerfil();
    }
    // Altura interpolada entre las 4 celdas vecinas (evita los escalones de 92 m)
    function alturaSuave(lng, lat) {
        const R = S.R, x = (lng - R.oeste) / R.dx - 0.5, y = (R.norte - lat) / R.dy - 0.5;
        const c = Math.floor(x), f = Math.floor(y), tx = x - c, ty = y - f;
        const v = (ff, cc) => (ff < 0 || cc < 0 || ff >= R.alto || cc >= R.ancho) ? NaN : S.elev[ff * R.ancho + cc];
        const z00 = v(f, c), z01 = v(f, c + 1), z10 = v(f + 1, c), z11 = v(f + 1, c + 1);
        if ([z00, z01, z10, z11].some(isNaN)) { const i = celda(lng, lat); return i >= 0 ? S.elev[i] : NaN; }
        return (z00 * (1 - tx) + z01 * tx) * (1 - ty) + (z10 * (1 - tx) + z11 * tx) * ty;
    }
    // Donde la linea A-B corta la red de drenaje (distancia y orden de Strahler)
    function crucesDeRios(a, b, total) {
        const res = [], dx = b[0] - a[0], dy = b[1] - a[1];
        const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
        for (const f of S.rios.features) {
            const c = f.geometry.coordinates;
            for (let k = 1; k < c.length; k++) {
                const p = c[k - 1], q = c[k];
                if (Math.max(p[0], q[0]) < x0 || Math.min(p[0], q[0]) > x1 || Math.max(p[1], q[1]) < y0 || Math.min(p[1], q[1]) > y1) continue;
                const ex = q[0] - p[0], ey = q[1] - p[1], den = dx * ey - dy * ex;
                if (!den) continue;
                const t = ((p[0] - a[0]) * ey - (p[1] - a[1]) * ex) / den, u = ((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / den;
                if (t >= 0 && t <= 1 && u >= 0 && u <= 1) res.push({ d: t * total, orden: f.properties.orden });
            }
        }
        res.sort((p, q) => p.d - q.d);
        // une cortes muy cercanos (el mismo cauce partido en dos tramos)
        return res.filter((r, k) => !k || r.d - res[k - 1].d > total / 150);
    }
    // Colores hipsometricos por altura absoluta (tierra caliente -> paramo)
    const TINTAS = [[200, "#5b8f3e"], [1000, "#9cbc59"], [1800, "#d6c86f"], [2500, "#cf9f5b"], [3000, "#a47652"], [3500, "#8b7b70"], [4100, "#e8e4df"]];
    function tinta(z) {
        if (z <= TINTAS[0][0]) return TINTAS[0][1];
        for (let k = 1; k < TINTAS.length; k++) {
            if (z <= TINTAS[k][0]) {
                const [za, ca] = TINTAS[k - 1], [zb, cb] = TINTAS[k], t = (z - za) / (zb - za);
                const h = (c, j) => parseInt(c.slice(1 + 2 * j, 3 + 2 * j), 16);
                return "#" + [0, 1, 2].map((j) => Math.round(h(ca, j) + (h(cb, j) - h(ca, j)) * t).toString(16).padStart(2, "0")).join("");
            }
        }
        return TINTAS.at(-1)[1];
    }
    // Marcas "redondas" para un eje (1, 2, 2.5 o 5 por potencia de 10)
    function marcas(a, b, n) {
        const paso0 = (b - a) / n || 1, pot = 10 ** Math.floor(Math.log10(paso0));
        const paso = [1, 2, 2.5, 5, 10].map((k) => k * pot).find((p) => p >= paso0);
        const res = [];
        for (let v = Math.ceil(a / paso) * paso; v <= b + 1e-9; v += paso) res.push(+v.toFixed(6));
        return { res, paso };
    }
    function recortar(t, n) { n = Math.floor(n); return t.length <= n ? t : t.slice(0, Math.max(1, n - 1)) + "…"; }
    function dibujarPerfil() {
        const { m, total, cruces } = S.perfilDatos;
        document.body.classList.add("con-perfil");
        $("perfil").hidden = false;
        lucide.createIcons();
        const svg = $("perfilSvg"), W = svg.clientWidth || 800, H = svg.clientHeight || 200;
        svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
        const ok = m.filter((s) => !isNaN(s.z));
        if (!ok.length) { svg.innerHTML = ""; $("perfilInfo").innerHTML = "<span>La línea está fuera del modelo de terreno.</span>"; return; }
        const zs = ok.map((s) => s.z);
        const zmin = Math.min(...zs), zmax = Math.max(...zs);
        // margen vertical: el perfil no toca los bordes y un corte casi plano no se ve como un serrucho
        const rango = Math.max(zmax - zmin, 20), mz = rango * 0.12;
        const ejeMin = zmin - mz, ejeMax = zmin + rango + mz;
        const L = 54, Rm = 12, T = 8, BANDA = 15, B = BANDA + 26;
        const pw = W - L - Rm, ph = H - T - B;
        const x = (d) => L + pw * d / total, y = (z) => T + ph * (1 - (z - ejeMin) / (ejeMax - ejeMin));
        const base = T + ph;

        // estadisticas
        let sube = 0, baja = 0, pmax = 0;
        for (let k = 1; k < ok.length; k++) {
            const dz = ok[k].z - ok[k - 1].z, dd = ok[k].d - ok[k - 1].d;
            if (dz > 0) sube += dz; else baja -= dz;
            if (dd > 0) pmax = Math.max(pmax, Math.abs(dz) / dd * 100);
        }
        const kmax = zs.indexOf(zmax), kmin = zs.indexOf(zmin);
        const exag = (total / pw) / ((ejeMax - ejeMin) / ph);

        // relleno con tintas por altura
        const pasos = 10, stops = [];
        for (let k = 0; k <= pasos; k++) {
            const z = ejeMax - (ejeMax - ejeMin) * k / pasos;
            stops.push(`<stop offset="${k / pasos}" stop-color="${tinta(z)}"/>`);
        }
        const linea = ok.map((s) => `${x(s.d).toFixed(1)},${y(s.z).toFixed(1)}`).join(" ");
        const area = `${x(ok[0].d).toFixed(1)},${base} ${linea} ${x(ok.at(-1).d).toFixed(1)},${base}`;

        // ejes
        const my = marcas(ejeMin, ejeMax, Math.max(2, Math.floor(ph / 34)));
        const mx = marcas(0, total / 1000, Math.max(2, Math.floor(pw / 90)));
        const dec = mx.paso < 1 ? (mx.paso < 0.5 ? 2 : 1) : 0;
        let g = "";
        my.res.forEach((v) => {
            g += `<line x1="${L}" x2="${L + pw}" y1="${y(v)}" y2="${y(v)}" stroke="#26292d" stroke-opacity=".08"/>
                  <text x="${L - 6}" y="${y(v) + 3.5}" font-size="10.5" fill="#6b7075" text-anchor="end">${num(v)} m</text>`;
        });
        mx.res.forEach((v) => {
            const px = x(v * 1000);
            g += `<line x1="${px}" x2="${px}" y1="${T}" y2="${base}" stroke="#26292d" stroke-opacity=".06"/>
                  <text x="${px}" y="${H - 6}" font-size="10.5" fill="#6b7075" text-anchor="middle">${num(v, dec)} km</text>`;
        });

        // banda de subcuencas que atraviesa la linea
        let banda = "", ini = 0;
        for (let k = 1; k <= m.length; k++) {
            if (k < m.length && S.zona[m[k].i] === S.zona[m[ini].i]) continue;
            const f = m[ini].i >= 0 ? S.porId.get(S.zona[m[ini].i]) : null;
            const xa = x(m[ini].d), xb = k < m.length ? x(m[k].d) : x(total), ancho = xb - xa;
            if (f) {
                const col = COLOR_CUENCA[f.properties.cuenca] || "#999";
                banda += `<g><title>${f.properties.nombre}</title><rect x="${xa}" y="${base + 3}" width="${Math.max(ancho, 1)}" height="${BANDA - 3}" rx="3" fill="${col}" fill-opacity=".85"/>`;
                if (ancho > 70) banda += `<text x="${xa + 5}" y="${base + BANDA - 3}" font-size="9.5" font-weight="700" fill="#fff">${recortar(f.properties.nombre, ancho / 5.6)}</text>`;
                banda += `</g>`;
            }
            ini = k;
        }

        // cauces que cruza
        const rios = cruces.map((c) => {
            const z = m[Math.round(c.d / total * (m.length - 1))].z;
            if (isNaN(z)) return "";
            return `<g><title>Cruza un cauce (orden ${c.orden}) a ${num(c.d / 1000, 2)} km</title>
                <line x1="${x(c.d)}" x2="${x(c.d)}" y1="${y(z)}" y2="${base}" stroke="#1e88e5" stroke-width="${0.6 + c.orden * 0.35}" stroke-opacity=".55"/>
                <circle cx="${x(c.d)}" cy="${y(z)}" r="${2 + c.orden * 0.6}" fill="#1e88e5" stroke="#fff" stroke-width="1.2"/></g>`;
        }).join("");

        // punto mas alto y mas bajo
        const marca = (s, txt, arriba) => `<circle cx="${x(s.d)}" cy="${y(s.z)}" r="3.5" fill="#26292d" stroke="#fff" stroke-width="1.5"/>
            <text x="${Math.min(Math.max(x(s.d), L + 34), L + pw - 34)}" y="${y(s.z) + (arriba ? -8 : 15)}" font-size="10.5" font-weight="700" fill="#26292d" text-anchor="middle"
                paint-order="stroke" stroke="#fff" stroke-width="3">${txt} ${num(s.z)} m</text>`;

        svg.innerHTML = `
            <defs>
                <linearGradient id="pfTinta" gradientUnits="userSpaceOnUse" x1="0" y1="${T}" x2="0" y2="${base}">${stops.join("")}</linearGradient>
                <clipPath id="pfClip"><rect x="${L}" y="${T}" width="${pw}" height="${ph}"/></clipPath>
            </defs>
            ${g}
            <g clip-path="url(#pfClip)">
                <polygon points="${area}" fill="url(#pfTinta)"/>
                <polyline points="${linea}" fill="none" stroke="#26292d" stroke-width="1.6" stroke-linejoin="round"/>
                ${rios}
            </g>
            <line x1="${L}" x2="${L + pw}" y1="${base}" y2="${base}" stroke="#9aa0a6"/>
            ${banda}
            ${marca(ok[kmax], "Máx.", true)}
            ${kmin !== kmax ? marca(ok[kmin], "Mín.", false) : ""}
            <text x="${L + 4}" y="${T + 12}" font-size="10" font-weight="700" fill="#6b7075">A</text>
            <text x="${L + pw - 4}" y="${T + 12}" font-size="10" font-weight="700" fill="#6b7075" text-anchor="end">B</text>
            <line id="pfCursor" y1="${T}" y2="${base}" stroke="#26292d" stroke-dasharray="3 3" visibility="hidden"/>
            <circle id="pfPunto" r="4.5" fill="#ffd200" stroke="#26292d" stroke-width="1.5" visibility="hidden"/>
            <rect x="${L}" y="${T}" width="${pw}" height="${ph + BANDA}" fill="transparent" id="pfZona" style="cursor:crosshair"/>`;

        $("perfilInfo").innerHTML = [
            ["Distancia", `${num(total / 1000, total < 10000 ? 2 : 1)} km`],
            ["De A a B", `${num(ok[0].z)} → ${num(ok.at(-1).z)} m`],
            ["Desnivel", `${num(zmax - zmin)} m`],
            ["Sube", `${num(sube)} m`], ["Baja", `${num(baja)} m`],
            ["Pendiente máx.", `${num(pmax)} %`],
            ["Cauces", `${cruces.length}`],
            ["Exageración vertical", `×${num(exag, exag < 10 ? 1 : 0)}`]
        ].map(([k, v]) => `<span>${k} <b>${v}</b></span>`).join("");

        const zona = $("pfZona"), cur = $("pfCursor"), pto = $("pfPunto"), tip = $("perfilTip");
        zona.onmousemove = (ev) => {
            const r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) * W / r.width;
            const d = Math.max(0, Math.min(total, (px - L) / pw * total));
            const k = Math.round(d / total * (m.length - 1)), s = m[k], xs = x(s.d);
            cur.setAttribute("x1", xs); cur.setAttribute("x2", xs); cur.setAttribute("visibility", "visible");
            if (!isNaN(s.z)) { pto.setAttribute("cx", xs); pto.setAttribute("cy", y(s.z)); pto.setAttribute("visibility", "visible"); }
            // pendiente local (unos 150 m a cada lado)
            const v = Math.max(1, Math.round(150 / (total / (m.length - 1))));
            const s0 = m[Math.max(0, k - v)], s1 = m[Math.min(m.length - 1, k + v)];
            const pend = (s1.z - s0.z) / ((s1.d - s0.d) || 1) * 100;
            const txtPend = isNaN(pend) ? "" : (Math.abs(pend) < 1 ? "Plano" : (pend > 0 ? "Sube " : "Baja ") + num(Math.abs(pend)) + " %") + " · ";
            tip.hidden = false;
            tip.innerHTML = `<b>${isNaN(s.z) ? "—" : num(s.z) + " m"}</b> · ${num(s.d / 1000, 2)} km<br>
                <small>${txtPend}${nombreZona(s.i) || "fuera de las subcuencas"}</small>`;
            const medio = tip.offsetWidth / 2;
            tip.style.left = Math.max(medio, Math.min(r.width - medio, xs * r.width / W)) + "px";
            tip.style.top = (isNaN(s.z) ? T : y(s.z)) * r.height / H + "px";
            map.getSource("perfil").setData({ type: "FeatureCollection", features: [...(S.perfilBase || []),
                { type: "Feature", properties: { cursor: true }, geometry: { type: "Point", coordinates: s.p } }] });
        };
        zona.onmouseleave = () => {
            cur.setAttribute("visibility", "hidden"); pto.setAttribute("visibility", "hidden"); tip.hidden = true;
            map.getSource("perfil").setData({ type: "FeatureCollection", features: S.perfilBase || [] });
        };
        resultado(`<h4><i data-lucide="chart-spline"></i> Perfil del terreno</h4>
            <div class="datos">
                <div class="dato"><small>Distancia</small><b>${num(total / 1000, 1)} km</b></div>
                <div class="dato"><small>Desnivel</small><b>${num(zmax - zmin)} m</b></div>
                <div class="dato"><small>Punto más alto</small><b>${num(zmax)} m</b></div>
                <div class="dato"><small>Cauces que cruza</small><b>${cruces.length}</b></div>
            </div>
            <p class="explica">Pasa el mouse sobre el perfil (abajo) para ver cada punto en el mapa. Los colores van del verde
            (tierra caliente) al café y gris (páramo); los puntos azules son ríos y quebradas que cruza la línea.
            El relieve está exagerado ×${num(exag, exag < 10 ? 1 : 0)} en vertical para que se note.</p>`);
    }
    window.addEventListener("resize", () => { if (S.perfilDatos && !$("perfil").hidden) dibujarPerfil(); });
    $("btnCerrarPerfil").onclick = () => {
        $("perfil").hidden = true;
        document.body.classList.remove("con-perfil");
        map.getSource("perfil").setData(vacio);
    };

    function limpiarTodo() {
        cancelAnimationFrame(animGota);
        pararVuelo();
        S.gota = null; S.inund = null; S.clics = [];
        ["gota", "gota-punto", "perfil"].forEach((s) => map.getSource(s).setData(vacio));
        limpiarImg("cuenca-img"); limpiarImg("inund-img");
        if ($("grupoNivel")) $("grupoNivel").hidden = S.herr !== "inundacion";
        $("perfil").hidden = true;
        document.body.classList.remove("con-perfil");
        const r = $("resultado");
        r.className = "caja vacia";
        r.textContent = S.herr ? AYUDA[S.herr] : "Elige una herramienta para empezar.";
    }

    // ---------- Lluvia en vivo (Open-Meteo) ----------
    let promesaClima = null;
    function cargarClima() {
        if (promesaClima) return promesaClima;
        promesaClima = (async () => {
            const feats = S.sub.features.filter((f) => f.properties.centro);
            const lat = feats.map((f) => f.properties.centro[1]).join(","), lon = feats.map((f) => f.properties.centro[0]).join(",");
            const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=precipitation&past_days=1&forecast_days=2&timezone=America%2FBogota`;
            const r = await fetch(url);
            if (!r.ok) throw new Error("Open-Meteo respondió " + r.status);
            let datos = await r.json();
            if (!Array.isArray(datos)) datos = [datos];
            const horas = datos[0].hourly.time;
            // hora actual en Bogota (UTC-5)
            const ahora = new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 13) + ":00";
            let iAhora = horas.indexOf(ahora);
            if (iAhora < 0) iAhora = 24;
            const porId = new Map();
            feats.forEach((f, k) => {
                const p = datos[k].hourly.precipitation.map((v) => v || 0);
                const suma = (a, b) => p.slice(Math.max(0, a), b).reduce((s, v) => s + v, 0);
                porId.set(f.properties.id, { horas: p, pasada: suma(iAhora - 24, iAhora), futura: suma(iAhora, iAhora + 24) });
            });
            S.clima = { horas, iAhora, porId };
            S.hora = iAhora;
            return S.clima;
        })();
        promesaClima.catch(() => { promesaClima = null; });
        return promesaClima;
    }
    function textoHora(iso, iAhora, k) {
        const d = new Date(iso + ":00-05:00");
        const dia = d.toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "short", timeZone: "America/Bogota" });
        const hora = d.toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit", timeZone: "America/Bogota" });
        const rel = k === iAhora ? " (ahora)" : k < iAhora ? ` (hace ${iAhora - k} h)` : ` (en ${k - iAhora} h)`;
        return `${dia}, ${hora}${rel}`;
    }
    function mostrarHora(k) {
        const C = S.clima;
        S.hora = k;
        $("rngHora").value = k;
        $("txtHora").textContent = textoHora(C.horas[k], C.iAhora, k);
        let total = 0, area = 0;
        S.sub.features.forEach((f) => {
            const v = C.porId.get(f.properties.id)?.horas[k] ?? 0;
            f.properties.valor = v;
            total += v * f.properties.area_km2; area += f.properties.area_km2;
        });
        map.getSource("subcuencas").setData(S.sub);
        map.setPaintProperty("sub-relleno", "fill-color", rampaCortes(RAMPAS.lluvia.colores, CORTES_LLUVIA_H));
        map.setPaintProperty("sub-relleno", "fill-opacity", ["case", ["boolean", ["feature-state", "sel"], false], 0.75,
            ["interpolate", ["linear"], ["get", "valor"], 0, 0.12, 0.5, 0.45, 5, 0.7]]);
        $("climaTotales").innerHTML = `
            <div class="dato"><small>Lluvia media en esa hora</small><b>${num(total / area, 2)} mm</b></div>
            <div class="dato"><small>Agua que cae en esa hora</small><b>${num(total / 1000, 1)} M m³</b></div>`;
    }
    async function abrirClima() {
        $("selColor").value = "cuenca";
        try {
            const C = await cargarClima();
            $("climaEstado").hidden = true;
            $("climaCont").hidden = false;
            $("rngHora").max = C.horas.length - 1;
            leyendaRampa($("leyendaLluvia"), RAMPAS.lluvia.colores, 0, CORTES_LLUVIA_H.at(-1), " mm/h o más", 0);
            mostrarHora(S.hora);
            const lista = S.sub.features.map((f) => ({ f, v: C.porId.get(f.properties.id)?.futura || 0 })).sort((a, b) => b.v - a.v).slice(0, 8);
            const max = Math.max(0.1, lista[0]?.v || 0);
            $("ranking").innerHTML = lista.map(({ f, v }) => `<li data-id="${f.properties.id}"><b>${f.properties.nombre}</b><span>${num(v, 1)} mm</span>
                <div class="rb"><span style="width:${(100 * v / max).toFixed(0)}%"></span></div></li>`).join("");
            $("ranking").querySelectorAll("li").forEach((li) => li.onclick = () => seleccionar(+li.dataset.id, true));
            $("grupoRanking").hidden = false;
        } catch (e) {
            $("climaEstado").textContent = "No se pudo consultar el pronóstico: " + e.message;
        }
    }
    function cerrarClima() {
        pararPlay();
        map.setPaintProperty("sub-relleno", "fill-opacity", ["case", ["boolean", ["feature-state", "sel"], false], 0.55, ["boolean", ["feature-state", "hover"], false], 0.45, 0.28]);
        colorear();
    }
    let play = 0;
    function pararPlay() { clearInterval(play); play = 0; $("btnPlay").innerHTML = `<i data-lucide="play"></i>`; lucide.createIcons(); }
    if ($("btnPlay")) $("btnPlay").onclick = () => {
        if (play) return pararPlay();
        $("btnPlay").innerHTML = `<i data-lucide="pause"></i>`; lucide.createIcons();
        play = setInterval(() => mostrarHora((S.hora + 1) % S.clima.horas.length), 450);
    };
    if ($("rngHora")) $("rngHora").oninput = () => { pararPlay(); mostrarHora(+$("rngHora").value); };

    // ---------- Edificios 3D: OpenStreetMap o Esri ----------
    let esri = null;
    async function ponerEdificios(modo) {
        const botones = document.querySelectorAll("#segEdif button");
        const marcar = (m) => botones.forEach((b) => b.classList.toggle("activo", b.dataset.edif === m));
        const nota = $("notaEdif");
        if (modo !== "esri" && esri && esri.activo) {
            esri.desactivar();
            $("chk3d").disabled = $("rngExag").disabled = false;
            ponerTerreno();
        }
        map.setLayoutProperty("edificios", "visibility", modo === "osm" ? "visible" : "none");
        marcar(modo);
        if (modo === "no") { nota.textContent = CFG.ciudad.texto; return; }
        if (map.getZoom() < 12.5) map.flyTo({ center: CFG.ciudad.centro, zoom: 15, pitch: 68, bearing: 30, duration: 3500 });
        if (modo === "osm") { nota.textContent = "Edificios de OpenStreetMap (OpenFreeMap), con su altura cuando se conoce."; return; }
        nota.textContent = "Cargando la escena 3D de ArcGIS…";
        botones.forEach((b) => b.disabled = true);
        try {
            if (!esri) esri = EsriBajoMapa(map, { capasBase: ["fondo", "base-satelite", "base-topo", "base-claro", "sombreado"], terreno: "terreno" });
            await esri.activar();
            $("chk3d").disabled = $("rngExag").disabled = true; // con Esri el relieve lo pone ArcGIS
            nota.textContent = "Esri 3D Buildings con imagen satelital y relieve de ArcGIS (gratis, sin clave). Las capas del visor quedan encima.";
        } catch (e) {
            marcar("no");
            nota.textContent = "No se pudo cargar ArcGIS: " + e.message;
        }
        botones.forEach((b) => b.disabled = false);
    }

    // ---------- Embalses ----------
    // Datos de referencia (capacidad: Acueducto de Bogotá en La Republica, 2025)
    const EMB_INFO = {
        tomine: { opera: "Enel Colombia", donde: "Guatavita y Sesquilé", capacidad: 689,
            uso: "Es el embalse más grande de Cundinamarca. Guarda agua del río Tominé y regula el caudal del río Bogotá aguas abajo." },
        sisga: { opera: "CAR Cundinamarca", donde: "Chocontá", capacidad: 90,
            uso: "Regula el río Bogotá cerca de su nacimiento: guarda agua en lluvias (control de crecientes) y la suelta en época seca." },
        neusa: { opera: "CAR Cundinamarca", donde: "Cogua y Tausa", capacidad: 102,
            uso: "Regula el río Neusa, afluente del Bogotá; su agua abastece municipios de la sabana. Rodeado de bosque y zona de recreación." },
        chuza: { opera: "Acueducto de Bogotá (EAAB)", donde: "Fómeque (Parque Nacional Chingaza)", capacidad: 220,
            uso: "Corazón del Sistema Chingaza: toma agua de la vertiente de los Llanos y la lleva por túneles a Bogotá." },
        san_rafael: { opera: "Acueducto de Bogotá (EAAB)", donde: "La Calera", capacidad: 70,
            uso: "Reserva de agua potable de Bogotá; recibe agua del Sistema Chingaza." },
        muna: { opera: "Enel Colombia", donde: "Sibaté", capacidad: null,
            uso: "Recibe agua bombeada del río Bogotá para generar energía en la cadena de centrales del río; por eso tiene problemas de contaminación." },
        guavio: { opera: "Enel Colombia", donde: "Gachalá, Ubalá y Gama", capacidad: null,
            uso: "Alimenta la central hidroeléctrica del Guavio, una de las más grandes de Colombia." }
    };
    function listaEmbalses() {
        const orden = [...S.emb.features].sort((a, b) => b.properties.area_km2 - a.properties.area_km2);
        $("listaEmb").innerHTML = orden.map((f) => {
            const p = f.properties, inf = EMB_INFO[p.clave] || {};
            return `<li data-clave="${p.clave}"><b>${p.nombre}</b><span class="chip" style="background:#e1f5fe;color:#01579b">${num(p.area_km2, 1)} km²</span>
                <small>${inf.donde || ""} · ${inf.opera || ""}${inf.capacidad ? " · " + num(inf.capacidad) + " millones de m³" : ""}</small></li>`;
        }).join("");
        $("listaEmb").querySelectorAll("li").forEach((li) => li.onclick = () => fichaEmbalse(li.dataset.clave, true));
    }
    function fichaEmbalse(clave, volar = false) {
        const f = S.emb.features.find((x) => x.properties.clave === clave);
        if (!f) return;
        const p = f.properties, inf = EMB_INFO[clave] || {};
        if (S.sel != null) { map.setFeatureState({ source: "subcuencas", id: S.sel }, { sel: false }); S.sel = null; }
        $("ficha").innerHTML = `
            <button type="button" class="cerrar" id="fichaCerrar" title="Cerrar"><i data-lucide="x"></i></button>
            <span class="eti" style="background:#0288d1">Embalse</span>
            <h2>${p.nombre}</h2>
            <p class="sub">${inf.donde || ""}${p.subcuenca ? " · subcuenca " + p.subcuenca : ""}</p>
            <div class="datos">
                <div class="dato"><small>Espejo de agua</small><b>${num(p.area_km2, 1)} km²</b></div>
                <div class="dato"><small>Cota del agua</small><b>${num(p.cota_dem)} m</b></div>
                <div class="dato"><small>Capacidad</small><b>${inf.capacidad ? num(inf.capacidad) + " M m³" : "—"}</b></div>
            </div>
            <p class="explica"><b>Lo opera:</b> ${inf.opera || "—"}.<br>${inf.uso || ""}</p>
            <h3>¿Y si el agua sube?</h3>
            <p class="explica">Simula una subida del nivel sobre la cota actual y mira qué terrenos de la orilla quedarían bajo el agua.</p>
            <div class="acciones">
                <button type="button" class="boton agua" data-sube="2"><i data-lucide="waves-arrow-up"></i> +2 m</button>
                <button type="button" class="boton agua" data-sube="5">+5 m</button>
                <button type="button" class="boton agua" data-sube="10">+10 m</button>
                <button type="button" class="boton primario" id="fichaVolar"><i data-lucide="plane"></i> Volar</button>
            </div>
            <p class="fuente-ficha">Contorno: <a href="${p.osm}" target="_blank" rel="noopener">OpenStreetMap</a>. Cota: mediana del DEM dentro del embalse.
                ${inf.capacidad ? "Capacidad: Acueducto de Bogotá, citado en La República (2025)." : "Capacidad: sin dato verificado."}</p>`;
        $("ficha").hidden = false;
        lucide.createIcons();
        $("fichaCerrar").onclick = () => { $("ficha").hidden = true; };
        const volarEmb = () => {
            const c = [];
            const anillos = f.geometry.type === "Polygon" ? [f.geometry.coordinates[0]] : f.geometry.coordinates.map((x) => x[0]);
            anillos.forEach((a) => a.forEach((q) => c.push(q)));
            const xs = c.map((q) => q[0]), ys = c.map((q) => q[1]);
            const izq = window.innerWidth > 900 ? 360 : 20, der = window.innerWidth > 900 ? 370 : 20;
            map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]],
                { padding: { top: 120, bottom: 80, left: izq, right: der }, pitch: 62, bearing: map.getBearing(), duration: 2500, maxZoom: 14 });
        };
        $("fichaVolar").onclick = volarEmb;
        $("ficha").querySelectorAll("[data-sube]").forEach((b) => b.onclick = () => {
            const i = celda(p.centro[0], p.centro[1]);
            if (i >= 0) simularSubida(ajustarAlCauce(i, 2), +b.dataset.sube, p.nombre);
        });
        if (volar) volarEmb();
    }
    // Lleva al simulador de inundacion con un punto y una subida ya puestos
    function simularSubida(i0, h, origen) {
        activarPestana("simular");
        if (S.herr !== "inundacion") elegirHerramienta("inundacion");
        $("rngNivel").value = Math.min(40, Math.max(0.5, Math.round(h * 2) / 2));
        S.inund = { i0, origen };
        $("grupoNivel").hidden = false;
        recalcularInundacion();
    }

    // ---------- Rios: niveles del IDEAM ----------
    let promesaIdeam = null;
    const limpiarTexto = (t) => (t || "").replace(/\uFFFD\u00AD/g, "í").replace(/\uFFFD/g, "").trim();
    function nombreEstacion(t) {
        return limpiarTexto(t).replace(/\s*\[\d+\]\s*$/, "").replace(/\s*-\s*AUT\s*$/i, "").trim()
            .toLowerCase().replace(/(^|[\s(])\S/g, (m) => m.toUpperCase());
    }
    function cargarIdeam() {
        if (promesaIdeam) return promesaIdeam;
        promesaIdeam = (async () => {
            const R = S.R;
            const desde = new Date(Date.now() - 5 * 3600e3 - 7 * 86400e3).toISOString().slice(0, 10) + "T00:00:00";
            const q = new URLSearchParams({
                "$select": "codigoestacion,nombreestacion,municipio,latitud,longitud,fechaobservacion,valorobservado",
                "$where": `fechaobservacion > '${desde}' AND latitud between ${R.sur} and ${R.norte} AND longitud between ${R.oeste} and ${R.este}`,
                "$order": "fechaobservacion", "$limit": "50000"
            });
            const r = await fetch("https://www.datos.gov.co/resource/bdmn-sqnh.json?" + q);
            if (!r.ok) throw new Error("datos.gov.co respondió " + r.status);
            const filas = await r.json();
            const est = new Map();
            filas.forEach((x) => {
                const v = parseFloat(x.valorobservado);
                if (!isFinite(v)) return;
                let e = est.get(x.codigoestacion);
                if (!e) est.set(x.codigoestacion, e = { codigo: x.codigoestacion.replace(/^0+/, ""), nombre: nombreEstacion(x.nombreestacion),
                    municipio: limpiarTexto(x.municipio), lng: +x.longitud, lat: +x.latitud, serie: [] });
                e.serie.push([new Date(x.fechaobservacion.slice(0, 19) + "-05:00").getTime(), v]);
            });
            const lista = [...est.values()].filter((e) => e.serie.length > 5).map((e) => {
                const vals = e.serie.map((s) => s[1]);
                const ult = e.serie.at(-1);
                const min = Math.min(...vals), max = Math.max(...vals);
                const hace24 = e.serie.find((s) => s[0] >= ult[0] - 86400e3) || e.serie[0];
                const i = celda(e.lng, e.lat);
                return Object.assign(e, { ultimo: ult[1], fecha: ult[0], min, max, subida: ult[1] - min, cambio24: ult[1] - hace24[1],
                    zona: i >= 0 ? nombreZona(i) : null });
            }).sort((a, b) => b.subida - a.subida);
            S.ideam = lista;
            map.getSource("ideam").setData({ type: "FeatureCollection", features: lista.map((e, k) => ({
                type: "Feature", properties: { k, subida: e.subida, etiqueta: `${e.nombre}\n${num(e.ultimo, 2)} m` },
                geometry: { type: "Point", coordinates: [e.lng, e.lat] } })) });
            return lista;
        })();
        promesaIdeam.catch(() => { promesaIdeam = null; });
        return promesaIdeam;
    }
    const fmtFecha = (t) => new Date(t).toLocaleString("es-CO", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "America/Bogota" });
    async function abrirIdeam() {
        try {
            const lista = await cargarIdeam();
            $("ideamEstado").textContent = `${lista.length} estaciones con datos recientes. Ordenadas por cuánto ha subido el río en la semana.`;
            $("listaIdeam").innerHTML = lista.map((e, k) => {
                const c = e.subida >= 1 ? ["#ffebee", "#b71c1c"] : e.subida >= 0.3 ? ["#fff8e1", "#8d6e00"] : ["#e8f5e9", "#1b5e20"];
                return `<li data-k="${k}"><b>${e.nombre}</b><span class="chip" style="background:${c[0]};color:${c[1]}">+${num(e.subida, 2)} m</span>
                    <small>${e.municipio} · nivel ${num(e.ultimo, 2)} m · ${fmtFecha(e.fecha)}</small></li>`;
            }).join("");
            $("listaIdeam").querySelectorAll("li").forEach((li) => li.onclick = () => fichaEstacion(+li.dataset.k, true));
        } catch (err) {
            $("ideamEstado").textContent = "No se pudo consultar el IDEAM: " + err.message;
        }
    }
    function fichaEstacion(k, volar = false) {
        const e = S.ideam[k];
        if (!e) return;
        if (S.sel != null) { map.setFeatureState({ source: "subcuencas", id: S.sel }, { sel: false }); S.sel = null; }
        $("ficha").innerHTML = `
            <button type="button" class="cerrar" id="fichaCerrar" title="Cerrar"><i data-lucide="x"></i></button>
            <span class="eti" style="background:#37474f">Estación IDEAM ${e.codigo}</span>
            <h2>${e.nombre}</h2>
            <p class="sub">${e.municipio}${e.zona ? " · " + e.zona : ""}</p>
            <div class="datos">
                <div class="dato"><small>Nivel ahora</small><b>${num(e.ultimo, 2)} m</b></div>
                <div class="dato"><small>Subió en la semana</small><b>${num(e.subida, 2)} m</b></div>
                <div class="dato"><small>Cambio en 24 h</small><b>${e.cambio24 >= 0 ? "+" : ""}${num(e.cambio24, 2)} m</b></div>
            </div>
            <h3>Nivel del río, últimos 7 días</h3>
            <svg class="spark" id="spark" viewBox="0 0 300 120" preserveAspectRatio="none"></svg>
            <p class="explica">Mínimo de la semana ${num(e.min, 2)} m, máximo ${num(e.max, 2)} m. Último dato: ${fmtFecha(e.fecha)}.</p>
            <h3>¿Cómo se comportaría como inundación?</h3>
            <p class="explica">Lleva esta subida al simulador desde el cauce junto a la estación y mira qué zonas bajas alcanzaría el agua.
                Con más subida (por ejemplo, el doble) se ve qué pasaría en una creciente fuerte.</p>
            <div class="acciones">
                <button type="button" class="boton agua" id="simEst"><i data-lucide="waves-arrow-up"></i> Simular +${num(Math.max(0.5, e.subida), 1)} m</button>
                <button type="button" class="boton" id="simEst2">El doble</button>
                <button type="button" class="boton" id="simEst5">+5 m</button>
            </div>
            <p class="fuente-ficha">Fuente: IDEAM, <a href="https://www.datos.gov.co/resource/bdmn-sqnh.json?codigoestacion=${encodeURIComponent(e.codigo.padStart(10, "0"))}" target="_blank" rel="noopener">Datos Abiertos Colombia</a>.
                El nivel es la lectura en la regla de la estación, no la altura sobre el mar.</p>`;
        $("ficha").hidden = false;
        lucide.createIcons();
        $("fichaCerrar").onclick = () => { $("ficha").hidden = true; };
        // grafica
        const t0 = e.serie[0][0], t1 = e.serie.at(-1)[0], a = e.min, b = e.max === e.min ? e.min + 0.1 : e.max;
        const x = (t) => 30 + 265 * (t - t0) / ((t1 - t0) || 1), y = (v) => 108 - 98 * (v - a) / (b - a);
        const pts = e.serie.map(([t, v]) => `${x(t).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
        $("spark").innerHTML = `<polygon points="30,108 ${pts} 295,108" fill="#bbdefb"/><polyline points="${pts}" fill="none" stroke="#1565c0" stroke-width="1.6"/>
            <text x="0" y="14" font-size="9" fill="#555">${num(b, 2)}</text><text x="0" y="110" font-size="9" fill="#555">${num(a, 2)}</text>`;
        const i = celda(e.lng, e.lat);
        const sim = (h) => { if (i >= 0) simularSubida(ajustarAlCauce(i, 3), h, e.nombre); };
        $("simEst").onclick = () => sim(Math.max(0.5, e.subida));
        $("simEst2").onclick = () => sim(Math.max(1, 2 * e.subida));
        $("simEst5").onclick = () => sim(5);
        if (volar) map.flyTo({ center: [e.lng, e.lat], zoom: 12.5, pitch: 62, duration: 2500 });
    }

    // ---------- Fuentes y metodo ----------
    if ($("btnInfo")) $("btnInfo").onclick = () => { $("modalInfo").hidden = false; };
    $("cerrarInfo").onclick = () => { $("modalInfo").hidden = true; };
    $("modalInfo").onclick = (ev) => { if (ev.target === $("modalInfo")) $("modalInfo").hidden = true; };

    // ---------- Pestanas ----------
    let pestana = "explorar";
    function activarPestana(p) {
        if (p === pestana) return;
        if (pestana === "clima") cerrarClima();
        if (pestana === "simular" && S.herr) elegirHerramienta(S.herr);
        pestana = p;
        document.querySelectorAll(".pestanas button").forEach((b) => b.classList.toggle("activo", b.dataset.pestana === p));
        document.querySelectorAll("[data-seccion]").forEach((s) => { s.hidden = s.dataset.seccion !== p; });
        if (p === "clima") abrirClima();
        if (p === "embalses") listaEmbalses();
        if (p === "ideam") abrirIdeam();
        if (CFG.alPestana) CFG.alPestana(p);
    }
    document.querySelectorAll(".pestanas button").forEach((b) => b.onclick = () => activarPestana(b.dataset.pestana));

    // ---------- Controles ----------
    function enlazar() {
        document.querySelectorAll("#segBase button").forEach((b) => b.onclick = () => {
            document.querySelectorAll("#segBase button").forEach((x) => x.classList.toggle("activo", x === b));
            ["satelite", "topo", "claro"].forEach((k) => map.setLayoutProperty("base-" + k, "visibility", k === b.dataset.base ? "visible" : "none"));
        });
        $("chk3d").onchange = ponerTerreno;
        $("rngExag").oninput = () => { $("txtExag").textContent = num(+$("rngExag").value, 1) + "×"; ponerTerreno(); };
        const vis = (chk, capas) => { if ($(chk)) $(chk).onchange = () => capas.forEach((c) => map.setLayoutProperty(c, "visibility", $(chk).checked ? "visible" : "none")); };
        vis("chkSombra", ["sombreado"]);
        vis("chkSub", ["sub-relleno", "sub-borde"]);
        vis("chkEtq", ["etiquetas"]);
        const verRios = () => {
            ["rios", "rios-halo"].forEach((c) => map.setLayoutProperty(c, "visibility", $("chkRios").checked ? "visible" : "none"));
            map.setLayoutProperty("rios-flujo", "visibility", $("chkRios").checked && $("chkFlujo").checked ? "visible" : "none");
        };
        $("chkRios").onchange = verRios;
        $("chkFlujo").onchange = verRios;
        vis("chkEmb", ["emb-relleno", "emb-borde", "emb-etq"]);
        vis("chkIdeam", ["ideam-punto", "ideam-etq"]);
        document.querySelectorAll("#segEdif button").forEach((b) => b.onclick = () => ponerEdificios(b.dataset.edif));
        $("selColor").onchange = colorear;
        const opciones = [...S.sub.features].sort((a, b) => a.properties.cuenca.localeCompare(b.properties.cuenca) || a.properties.nombre.localeCompare(b.properties.nombre));
        let grupo = null, html = "";
        opciones.forEach((f) => {
            if (f.properties.cuenca !== grupo) { if (grupo) html += "</optgroup>"; grupo = f.properties.cuenca; html += `<optgroup label="${grupo}">`; }
            html += `<option value="${f.properties.id}">${f.properties.nombre}</option>`;
        });
        $("selIr").insertAdjacentHTML("beforeend", html + "</optgroup>");
        $("selIr").onchange = () => { if ($("selIr").value) seleccionar(+$("selIr").value, true); };
        document.querySelectorAll(".herr").forEach((b) => b.onclick = () => elegirHerramienta(b.dataset.herr));
        if ($("rngNivel")) $("rngNivel").oninput = recalcularInundacion;
        if ($("btnLimpiar")) $("btnLimpiar").onclick = limpiarTodo;
        if ($("btnRioBogota")) $("btnRioBogota").onclick = () => {
            // nacimiento: la celda mas alta de "Rio Alto Bogota"
            const f = S.sub.features.find((x) => x.properties.nombre === "Río Alto Bogotá");
            if (!f) return;
            lanzarGota(celdaAlta(f.properties.id), true);
        };
        $("btnPanel").onclick = () => $("panel").classList.toggle("oculto");
    }

    // ---------- Eventos del mapa ----------
    let hoverId = null;
    function eventos() {
        map.on("mousemove", (e) => {
            const i = celda(e.lngLat.lng, e.lngLat.lat);
            const z = i >= 0 ? S.elev[i] : NaN;
            const zona = i >= 0 ? nombreZona(i) : null;
            $("cursor").textContent = `${isNaN(z) ? "" : num(z) + " m · "}${zona ? zona + " · " : ""}${num(e.lngLat.lat, 4)}° N, ${num(-e.lngLat.lng, 4)}° O`;
            if (S.herr) return;
            const f = map.queryRenderedFeatures(e.point, { layers: ["sub-relleno"] })[0];
            const id = f ? f.id : null;
            if (id !== hoverId) {
                if (hoverId != null) map.setFeatureState({ source: "subcuencas", id: hoverId }, { hover: false });
                if (id != null) map.setFeatureState({ source: "subcuencas", id }, { hover: true });
                hoverId = id;
                map.getCanvas().style.cursor = id != null ? "pointer" : "";
            }
        });
        map.on("click", (e) => {
            const i = celda(e.lngLat.lng, e.lngLat.lat);
            if (S.herr) {
                if (i < 0) return;
                if (S.herr === "gota") lanzarGota(i);
                else if (S.herr === "cuenca") herramientaCuenca(i);
                else if (S.herr === "inundacion") herramientaInundacion(i);
                else if (S.herr === "perfil") herramientaPerfil(e.lngLat);
                return;
            }
            if (CFG.alClic && CFG.alClic(e)) return;
            const est = map.queryRenderedFeatures(e.point, { layers: ["ideam-punto"] })[0];
            if (est) { fichaEstacion(est.properties.k); return; }
            const emb = map.queryRenderedFeatures(e.point, { layers: ["emb-relleno"] })[0];
            if (emb) { fichaEmbalse(emb.properties.clave); return; }
            const f = map.queryRenderedFeatures(e.point, { layers: ["sub-relleno"] })[0];
            if (f) seleccionar(f.id);
        });
    }

    // ---------- Arranque ----------
    const listoMapa = new Promise((r) => map.on("load", r));
    Promise.all([cargarDatos(), listoMapa]).then(() => {
        agregarCapas();
        ponerTerreno();
        colorear();
        enlazar();
        eventos();
        requestAnimationFrame(animarFlujo);
        $("cargando").hidden = true;
        // vuelo de entrada sobre toda el area
        const R = S.R;
        map.fitBounds([[R.oeste, R.sur], [R.este, R.norte]], {
            padding: { top: 80, bottom: 40, left: window.innerWidth > 900 ? 360 : 20, right: 40 }, pitch: 55, bearing: -15, duration: 2500
        });
        if (CFG.alIniciar) CFG.alIniciar({ map, S, $, num, seleccionar, activarPestana, volarA, distM, colorear });
        if (CFG.clima) cargarClima().catch(() => {});
        if (CFG.ideam) cargarIdeam().catch((e) => console.warn("IDEAM:", e));
    }).catch((e) => {
        $("cargandoTxt").textContent = "No se pudieron cargar los datos: " + e.message +
            ". Abre la página desde un servidor (por ejemplo localhost:5500), no con doble clic.";
        console.error(e);
    });
})();
