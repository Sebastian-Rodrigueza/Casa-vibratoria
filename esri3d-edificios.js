// Edificios 3D de Esri debajo de un mapa de MapLibre.
//
// Pone un SceneView de ArcGIS (imagen satelital, relieve y Esri 3D Buildings)
// detras del mapa. Mientras esta activo se ocultan las capas del mapa base de
// MapLibre y su fondo queda transparente, asi las capas propias de la pagina
// (lineas, puntos, etiquetas) se siguen viendo encima. La camara la manda
// MapLibre y ArcGIS la copia en cada movimiento.
//
// Uso:
//   const esri = EsriBajoMapa(map, { capasBase: [...ids a ocultar], terreno: "id de la fuente raster-dem" });
//   await esri.activar();   esri.desactivar();
//   esri.verImagen(true/false);   esri.verEdificios(true/false);
(function () {
    const ARCGIS_JS = "https://js.arcgis.com/4.34/";
    const EDIFICIOS = "https://basemaps3d.arcgis.com/arcgis/rest/services/Esri3D_Buildings_v1/SceneServer/layers/0";
    const IMAGEN = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer";
    const RELIEVE = "https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer";
    const TRANSPARENTE = "rgba(0,0,0,0)";

    let cargando = null;
    function cargarArcGIS() {
        if (cargando) return cargando;
        cargando = new Promise((listo, error) => {
            const css = document.createElement("link");
            css.rel = "stylesheet";
            css.href = ARCGIS_JS + "esri/themes/light/main.css";
            document.head.appendChild(css);
            const s = document.createElement("script");
            s.src = ARCGIS_JS;
            s.onerror = () => error(new Error("No se pudo cargar ArcGIS"));
            s.onload = () => window.require([
                "esri/Map", "esri/Basemap", "esri/views/SceneView", "esri/layers/TileLayer",
                "esri/layers/ElevationLayer", "esri/layers/SceneLayer", "esri/Camera", "esri/geometry/Point",
                "esri/layers/VectorTileLayer", "esri/layers/GraphicsLayer", "esri/Graphic",
                "esri/layers/MediaLayer", "esri/layers/support/ImageElement",
                "esri/layers/support/ExtentAndRotationGeoreference", "esri/geometry/Extent"
            ], (...clases) => listo(clases), error);
            document.head.appendChild(s);
        });
        cargando.catch(() => { cargando = null; });
        return cargando;
    }

    window.EsriBajoMapa = function (map, opciones) {
        const capasBase = opciones.capasBase || [];
        // Con Esri, MapLibre usa este relieve (sin dibujar el mapa base): asi marcadores,
        // lineas y estaciones quedan a la altura real del terreno, como en ArcGIS.
        const fuenteRelieve = opciones.terreno || null;
        const contMapa = map.getContainer();
        let view = null, edificios = null, imagen = null, Camera = null, Point = null, VectorTileLayer = null;
        let GraphicsLayer = null, Graphic = null, capaPostes = null, imgPoste = null;
        let MediaLayer = null, ImageElement = null, ExtentAndRotationGeoreference = null, Extent = null;
        let viasNoche = null, viasFallo = false; // alumbrado de las vias (de noche), pegado al terreno de ArcGIS
        let suelo = 2600; // altura del terreno de ArcGIS en el centro del mapa (m)
        let activo = false;
        let antes = null; // como estaba el mapa antes de activar (para devolverlo igual)
        let verImg = true, verEdif = true;

        // Contenedor del SceneView: mismo lugar y tamano que el del mapa, por debajo
        const div = document.createElement("div");
        const pos = getComputedStyle(contMapa);
        Object.assign(div.style, {
            position: "absolute", top: pos.top, left: pos.left, right: pos.right, bottom: pos.bottom,
            pointerEvents: "none", visibility: "hidden"
        });
        contMapa.parentNode.insertBefore(div, contMapa);

        async function crearVista() {
            if (view) return;
            let EMap, Basemap, SceneView, TileLayer, ElevationLayer, SceneLayer;
            [EMap, Basemap, SceneView, TileLayer, ElevationLayer, SceneLayer, Camera, Point, VectorTileLayer, GraphicsLayer, Graphic,
                MediaLayer, ImageElement, ExtentAndRotationGeoreference, Extent] = await cargarArcGIS();
            imagen = new TileLayer({ url: IMAGEN });
            edificios = new SceneLayer({
                url: EDIFICIOS,
                renderer: simboloEdificios(0)
            });
            view = new SceneView({
                container: div,
                map: new EMap({
                    basemap: new Basemap({ baseLayers: [imagen] }),
                    ground: { layers: [new ElevationLayer({ url: RELIEVE })] },
                    layers: [edificios]
                }),
                camera: camara(),
                // sin limites de inclinacion/altura propios: la camara la manda MapLibre
                constraints: { collision: { enabled: false }, tilt: { mode: "manual", max: 89.9 } },
                qualityProfile: "high",
                environment: { lighting: { directShadowsEnabled: true } },
                ui: { components: ["attribution"] }
            });
            await view.when();
            await medirSuelo();
        }

        // Camara de ArcGIS identica a la de MapLibre: misma posicion, rumbo,
        // inclinacion y campo de vision, para que las capas de la pagina queden
        // exactamente encima de la imagen y los edificios de Esri.
        // MapLibre dibuja el suelo plano a altura 0; en ArcGIS ese suelo es el
        // terreno en el centro del mapa (variable "suelo").
        const M_GRADO = 111320;
        function camara() {
            const lienzo = map.getCanvas();
            const alto = lienzo.clientHeight || 1, ancho = lienzo.clientWidth || 1;
            const fovV = map.getVerticalFieldOfView() * Math.PI / 180;
            const c = map.getCenter();
            const lat = c.lat * Math.PI / 180;
            const mpp = 40075016.686 * Math.cos(lat) / (512 * Math.pow(2, map.getZoom())); // metros por pixel
            const dist = (alto / 2) / Math.tan(fovV / 2) * mpp; // de la camara al centro
            const pitch = map.getPitch() * Math.PI / 180, rumbo = map.getBearing() * Math.PI / 180;
            const atras = dist * Math.sin(pitch);
            return new Camera({
                position: new Point({
                    longitude: c.lng - atras * Math.sin(rumbo) / (M_GRADO * Math.cos(lat)),
                    latitude: c.lat - atras * Math.cos(rumbo) / M_GRADO,
                    z: suelo + dist * Math.cos(pitch)
                }),
                heading: map.getBearing(),
                tilt: map.getPitch(),
                // ArcGIS usa el campo de vision diagonal
                fov: 2 * Math.atan(Math.tan(fovV / 2) * Math.hypot(ancho, alto) / alto) * 180 / Math.PI
            });
        }
        function seguir() {
            if (!activo || !view) return;
            if (map.getTerrain()) {
                // con relieve, el centro de MapLibre esta a la altura del terreno
                const z = map.getCenterElevation();
                if (Number.isFinite(z) && z > 0) suelo = z; else sueloAlMover();
            } else {
                sueloAlMover();
            }
            view.camera = camara();
        }
        // El suelo se lee en cada movimiento del relieve ya cargado (lectura inmediata),
        // asi cambia de a poco mientras se mueve y no salta al soltar el mapa.
        function sueloAlMover() {
            const muestra = view.groundView && view.groundView.elevationSampler;
            if (!muestra) return;
            const c = map.getCenter(), R = 6378137, lat = c.lat * Math.PI / 180;
            const p = muestra.queryElevation(new Point({
                x: R * c.lng * Math.PI / 180, y: R * Math.log(Math.tan(Math.PI / 4 + lat / 2)),
                spatialReference: { wkid: 3857 }
            }));
            const z = p && p.z;
            if (Number.isFinite(z) && z > 0 && z < 6000) suelo = z;
        }
        async function medirSuelo() {
            if (!view) return;
            const c = map.getCenter();
            try {
                const r = await view.map.ground.queryElevation(new Point({ longitude: c.lng, latitude: c.lat }));
                const z = r.geometry.z;
                if (Number.isFinite(z) && z > 0 && z < 6000) { suelo = z; seguir(); }
            } catch (e) { /* se queda con la altura anterior */ }
        }
        map.on("move", seguir);
        map.on("resize", seguir);

        function aplicarVisibilidad() {
            if (!view) return;
            imagen.visible = verImg;
            edificios.visible = verEdif;
        }

        async function activar() {
            if (activo) return;
            await crearVista();
            activo = true;
            aplicarVisibilidad();
            // ocultar el mapa base de MapLibre, el cielo y el relieve (lo pone ArcGIS)
            antes = {
                fondo: contMapa.style.background,
                cielo: map.getSky(),
                terreno: map.getTerrain(),
                visibles: capasBase.filter((id) => map.getLayer(id) &&
                    map.getLayoutProperty(id, "visibility") !== "none")
            };
            antes.visibles.forEach((id) => map.setLayoutProperty(id, "visibility", "none"));
            map.setSky({
                "sky-color": TRANSPARENTE, "horizon-color": TRANSPARENTE, "fog-color": TRANSPARENTE,
                "sky-horizon-blend": 0, "horizon-fog-blend": 0, "fog-ground-blend": 1, "atmosphere-blend": 0
            });
            if (fuenteRelieve && map.getSource(fuenteRelieve)) {
                map.setTerrain({ source: fuenteRelieve, exaggeration: 1.0 });
            } else if (antes.terreno) {
                map.setTerrain(null);
            }
            contMapa.style.background = "transparent";
            div.style.visibility = "visible";
            seguir();
        }

        function desactivar() {
            if (!activo) return;
            activo = false;
            div.style.visibility = "hidden";
            contMapa.style.background = antes.fondo;
            antes.visibles.forEach((id) => { if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "visible"); });
            map.setSky(antes.cielo || {});
            map.setTerrain(antes.terreno || null);
            antes = null;
        }

        // ---------- Noche (edificios, charcos de luz) ----------
        function mezclar(a, b, t) {
            return a.map((v, i) => v + (b[i] - v) * t);
        }
        function simboloEdificios(n) {
            // De dia: blanco hueso con bordes grises. De noche: azul oscuro con
            // los bordes encendidos (siluetas de ciudad iluminada).
            return { type: "simple", symbol: { type: "mesh-3d", symbolLayers: [{
                type: "fill", material: { color: mezclar([242, 240, 234], [36, 43, 60], n) },
                edges: { type: "solid", color: mezclar([0, 0, 0, 0.25], [255, 196, 120, 0.8], n), size: 0.6 + 0.5 * n }
            }] } };
        }
        let nEdificios = 0;
        function edificiosDeNoche(n) {
            if (!edificios || Math.abs(n - nEdificios) < 0.05 && (n > 0) === (nEdificios > 0)) return;
            nEdificios = n;
            edificios.renderer = simboloEdificios(n);
        }

        // Canvas con un circulo de luz que se desvanece hacia afuera
        function degradado(lado, paradas) {
            const c = document.createElement("canvas");
            c.width = c.height = lado;
            const g = c.getContext("2d");
            const r = g.createRadialGradient(lado / 2, lado / 2, 0, lado / 2, lado / 2, lado / 2);
            paradas.forEach(([t, color]) => r.addColorStop(t, color));
            g.fillStyle = r;
            g.fillRect(0, 0, lado, lado);
            return c;
        }

        let capaCharcos = null, spriteCharco = null;
        function charcos(puntos, caja, n) {
            if (!MediaLayer) return;
            if (!capaCharcos) {
                capaCharcos = new MediaLayer({ source: [] });
                view.map.add(capaCharcos, 1); // sobre la imagen satelital, debajo de vias y edificios
                spriteCharco = degradado(64, [[0, "rgba(255,200,120,.55)"], [0.35, "rgba(255,165,70,.3)"], [1, "rgba(255,140,40,0)"]]);
            }
            capaCharcos.source.elements.removeAll();
            if (!puntos) return;
            // Lienzo sobre la caja de los postes (lineal en grados: el area es pequena)
            const LADO = 2048;
            const lienzo = document.createElement("canvas");
            lienzo.width = lienzo.height = LADO;
            const g = lienzo.getContext("2d");
            g.globalCompositeOperation = "lighter"; // las luces que se cruzan se suman
            const [o, s, e, nn] = caja;
            const mx = LADO / (e - o), my = LADO / (nn - s);
            const radioM = 15; // metros
            const r = Math.max(2, radioM / (111320 * Math.cos((s + nn) / 2 * Math.PI / 180)) * mx);
            for (const [lng, lat] of puntos) {
                g.drawImage(spriteCharco, (lng - o) * mx - r, (nn - lat) * my - r, 2 * r, 2 * r);
            }
            capaCharcos.source.elements.add(new ImageElement({
                image: lienzo,
                georeference: new ExtentAndRotationGeoreference({
                    extent: new Extent({ xmin: o, ymin: s, xmax: e, ymax: nn, spatialReference: { wkid: 4326 } })
                })
            }));
            capaCharcos.opacity = n;
        }

        return {
            activar, desactivar,
            get activo() { return activo; },
            get vista() { return view; },
            verImagen(v) { verImg = v; aplicarVisibilidad(); },
            verEdificios(v) { verEdif = v; aplicarVisibilidad(); },
            // Postes de alumbrado dentro de la escena de ArcGIS: un punto de luz por
            // poste (los edificios de Esri lo tapan) y, debajo, los charcos de luz
            // en el piso como una imagen pegada al terreno (MediaLayer), con el
            // mismo degradado que en el modo OpenStreetMap.
            // puntos: [[lng, lat]...] o null; caja: [oeste, sur, este, norte]; n: 0 a 1.
            // Devuelve true si los pone.
            postes(puntos, caja, n) {
                if (!view || !GraphicsLayer) return false;
                if (!capaPostes) {
                    capaPostes = new GraphicsLayer({ elevationInfo: { mode: "on-the-ground" } });
                    view.map.add(capaPostes);
                    imgPoste = degradado(32, [[0, "rgba(255,248,225,1)"], [0.25, "rgba(255,225,160,.9)"],
                        [0.5, "rgba(255,170,70,.25)"], [1, "rgba(255,140,40,0)"]]).toDataURL();
                }
                capaPostes.removeAll();
                const hay = !!(puntos && puntos.length && caja);
                if (hay) {
                    const simbolo = { type: "picture-marker", url: imgPoste, width: "11px", height: "11px" };
                    capaPostes.addMany(puntos.map(([lng, lat]) => new Graphic({
                        geometry: { type: "point", longitude: lng, latitude: lat }, symbol: simbolo
                    })));
                }
                capaPostes.opacity = n || 0;
                try { charcos(hay ? puntos : null, caja, n); } catch (err) { console.error("Charcos de luz:", err); }
                return true;
            },
            // Noche en la escena de ArcGIS (n: 0 dia a 1 noche): edificios oscuros con
            // los bordes encendidos en tono calido, y las vias de OpenMapTiles (las
            // mismas del mapa) como capa pegada al suelo. Devuelve true si ArcGIS
            // dibuja las vias (si no, la pagina las pone con MapLibre).
            noche(n, teselasVias) {
                if (!view) return false;
                edificiosDeNoche(n);
                if (!VectorTileLayer || viasFallo) return false;
                if (!viasNoche && n > 0 && teselasVias) {
                    const ancho = (k) => ({ base: 1.6, stops: [[12, k], [18, k * 9]] });
                    const filtro = (clases) => ["all", ["in", "class"].concat(clases), ["!=", "brunnel", "tunnel"]];
                    const capas = [];
                    [[["motorway", "trunk", "primary"], 2.2], [["secondary", "tertiary"], 1.4], [["minor"], 0.6]].forEach(([clases, peso], i) => {
                        capas.push({ id: "halo" + i, type: "line", source: "vias", "source-layer": "transportation", minzoom: 11,
                            filter: filtro(clases), layout: { "line-cap": "round", "line-join": "round" },
                            paint: { "line-color": "#ff9a2e", "line-opacity": { stops: [[13, 0.35], [15, 0.05]] }, "line-width": ancho(3 * peso) } });
                        capas.push({ id: "via" + i, type: "line", source: "vias", "source-layer": "transportation", minzoom: 11,
                            filter: filtro(clases), layout: { "line-cap": "round", "line-join": "round" },
                            paint: { "line-color": "#ffe1a1", "line-opacity": { stops: [[13, 0.9], [15, 0.1]] }, "line-width": ancho(0.6 * peso) } });
                    });
                    viasNoche = new VectorTileLayer({
                        style: { version: 8, sources: { vias: { type: "vector", tiles: teselasVias, maxzoom: 14 } }, layers: capas }
                    });
                    view.map.add(viasNoche);
                    viasNoche.when().catch((err) => {
                        console.error("Alumbrado de ArcGIS:", err);
                        viasFallo = true;
                        view.map.remove(viasNoche);
                    });
                }
                if (!viasNoche) return false;
                viasNoche.visible = n > 0;
                viasNoche.opacity = n;
                return true;
            }
        };
    };
})();
