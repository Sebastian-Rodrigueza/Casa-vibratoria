// ======================================================
// NEXA AI - AGENTE INSTRUMENTACION CIAM V1.3
// ======================================================


const URL_BACKEND =
    "http://localhost:3001/api/explicar-sensor";


let sensores = {};



const elSelect =
    document.getElementById("selectorSensor");


const elBoton =
    document.getElementById("btnPreguntar");


const elTexto =
    document.getElementById("subtitulo");


const elEstado =
    document.getElementById("estadoAgente");


const elConexion =
    document.getElementById("estadoConexion");


const elBoca =
    document.getElementById("boca");


const holograma =
    document.querySelector(".holograma");





// ======================================================
// CARGAR SENSORES
// ======================================================


async function cargarSensores() {


    try {


        const respuesta =
            await fetch("sensores.json");


        sensores =
            await respuesta.json();



        elSelect.innerHTML = "";



        Object.keys(sensores).forEach(id => {


            let opcion =
                document.createElement("option");


            opcion.value = id;


            opcion.textContent =
                sensores[id].nombre;


            elSelect.appendChild(opcion);



        });



        comprobarBackend();



    }

    catch (error) {


        elTexto.innerHTML =
            "Error cargando sensores";


        console.error(error);


    }



}







// ======================================================
// ESTADO BACKEND
// ======================================================


async function comprobarBackend() {


    try {


        await fetch(URL_BACKEND, {
            method: "OPTIONS"
        });


        cambiarConexion(true);


    }

    catch {


        cambiarConexion(false);


    }



}



function cambiarConexion(activo) {



    if (activo) {


        elConexion.innerHTML =
            "● GEMINI ONLINE";


        elConexion.className =
            "estado online";


    }

    else {


        elConexion.innerHTML =
            "● MODO LOCAL";


        elConexion.className =
            "estado offline";


    }


}







// ======================================================
// CONSULTAR SENSOR
// ======================================================


async function pedirExplicacion(id) {



    const sensor = sensores[id];


    if (!sensor)
        return "Sensor no encontrado";




    try {


        const respuesta =
            await fetch(URL_BACKEND, {


                method: "POST",


                headers: {


                    "Content-Type": "application/json"


                },


                body: JSON.stringify({


                    sensorId: id,


                    ficha: sensor


                })


            });



        if (!respuesta.ok)
            throw Error();



        const datos =
            await respuesta.json();


        cambiarConexion(true);


        return datos.texto;



    }

    catch {


        cambiarConexion(false);



        return `

<b>${sensor.nombre}</b><br><br>

Tipo:
${sensor.tipo}<br>

Eje:
${sensor.eje}<br>

Ubicación:
${sensor.ubicacion}<br>

Unidad:
${sensor.unidad}<br>

Rango:
${sensor.rango}<br><br>

${sensor.queMide}<br><br>

${sensor.funcion}

`;



    }



}








// ======================================================
// VOZ
// ======================================================


function hablar(texto) {



    speechSynthesis.cancel();



    let voz =
        new SpeechSynthesisUtterance(
            texto.replace(/<[^>]*>/g, "")
        );



    voz.lang = "es-ES";

    voz.rate = .95;

    voz.pitch = 1;




    voz.onstart = () => {


        elEstado.innerHTML =
            "EXPLICANDO SENSOR";


        holograma.classList.remove("pensando");


        holograma.classList.add("hablando");


    };




    voz.onboundary = () => {


        abrirBoca();


        setTimeout(cerrarBoca, 120);


    };




    voz.onend = () => {


        elEstado.innerHTML =
            "EN REPOSO";


        holograma.classList.remove("hablando");


        cerrarBoca();


    };



    speechSynthesis.speak(voz);



}





function abrirBoca() {


    elBoca.setAttribute(
        "d",
        "M42 76 Q60 95 78 76"
    );


}



function cerrarBoca() {


    elBoca.setAttribute(
        "d",
        "M42 78 Q60 78 78 78"
    );


}







// ======================================================
// BOTON CONSULTAR
// ======================================================


/*
 * Esta pantalla (holograma NEXA AI) solo existe en agente1/index.html.
 * Cuando este mismo archivo se carga desde Index.html (para el agente
 * del catálogo ICDE, ver más abajo), estos elementos no existen en el
 * DOM y hay que evitar que el script se rompa por eso.
 */
if (elBoton) {

    elBoton.onclick =
        async () => {


            elBoton.disabled = true;



            holograma.classList.add("pensando");


            elEstado.innerHTML =
                "ANALIZANDO DATOS";



            elTexto.innerHTML =
                "Consultando información del sensor...";



            let respuesta =
                await pedirExplicacion(
                    elSelect.value
                );



            holograma.classList.remove("pensando");



            elTexto.innerHTML =
                respuesta;



            hablar(respuesta);



            elBoton.disabled = false;


        };

}







// ======================================================
// PARPADEO
// ======================================================


setInterval(() => {


    document.querySelectorAll(".ojo")
        .forEach(o => {


            o.style.transform = "scaleY(.15)";


            setTimeout(() => {


                o.style.transform = "scaleY(1)";


            }, 150);



        });


}, 4500);







// ======================================================
// CONEXION MODELO 3D
// ======================================================


window.CasaAgente = {


    explicarSensor: async (id) => {


        if (sensores[id]) {


            elSelect.value = id;


        }



        let respuesta =
            await pedirExplicacion(id);



        elTexto.innerHTML =
            respuesta;



        hablar(respuesta);



        return respuesta;



    }


};







if (elSelect) {

    cargarSensores();

}


// ======================================================
// AGENTE ICDE - ASISTENTE DEL CATÁLOGO (panel flotante
// del Index.html principal)
// ======================================================
//
// Este bloque solo se activa si el HTML donde se carga este
// archivo tiene el panel de chat del ICDE (Index.html). No
// interfiere en nada con el holograma NEXA AI de arriba, que
// sigue funcionando igual en agente1/index.html.
//
// El agente le pregunta a un backend propio (api.py) que:
//   1) busca en la base de datos MySQL los datasets del ICDE
//      relacionados con lo que la persona escribió, y
//   2) le pide a Gemini que redacte una recomendación breve
//      usando SOLO esos datasets (para no inventar resultados).
//
// La clave de Gemini nunca viaja hasta aquí: vive únicamente
// en el servidor (api.py), leída de una variable de entorno.
// ======================================================

(() => {

    const API_AGENTE_ICDE = "http://localhost:5000/api/agente/consultar";

    // Ruta absoluta desde la raiz del sitio (con "/" al inicio), para
    // que funcione igual sin importar desde que carpeta se abrio esta
    // pagina (raiz, Geodata Colombia/, Geodata Colombia/General/ICDE/,
    // etc.). Solo funciona si el sitio se sirve desde su propia raiz
    // (ej. http://localhost:8000/), no si se abre el archivo directo
    // con doble clic (file://).
    const MAPA_HTML_ICDE = "/Mapa.html";

    const elLauncher = document.getElementById("agentLauncher");
    const elPanel = document.getElementById("agentPanel");
    const elPanelClose = document.getElementById("agentPanelClose");
    const elLog = document.getElementById("agentPanelLog");
    const elForm = document.getElementById("agentForm");
    const elInput = document.getElementById("agentInput");

    if (!elLauncher || !elPanel || !elLog || !elForm || !elInput) {
        return;
    }

    /* ==================================================
       ABRIR / CERRAR EL PANEL (sin depender de AngularJS,
       para que funcione igual en cualquier pagina del sitio)
       ================================================== */

    elLauncher.addEventListener("click", () => {
        const abierto = elPanel.classList.toggle("agent-panel-open");
        elLauncher.classList.toggle("is-open", abierto);
    });

    if (elPanelClose) {
        elPanelClose.addEventListener("click", () => {
            elPanel.classList.remove("agent-panel-open");
            elLauncher.classList.remove("is-open");
        });
    }

    const elBotonEnviar = elForm.querySelector("button");

    elInput.disabled = false;

    if (elBotonEnviar) {
        elBotonEnviar.disabled = false;
    }

    function agregarBurbuja(contenidoHtml, tipo) {
        const burbuja = document.createElement("div");

        // "bot" -> agent-bubble-bot, "user" -> agent-bubble-user,
        // "loading" se deja tal cual porque es un modificador aparte
        // (ver .agent-bubble.loading en geodata.css).
        const clases = tipo
            .split(" ")
            .map((palabra) => palabra === "loading" ? "loading" : "agent-bubble-" + palabra);

        burbuja.className = ["agent-bubble", ...clases].join(" ");
        burbuja.innerHTML = contenidoHtml;
        elLog.appendChild(burbuja);
        elLog.scrollTop = elLog.scrollHeight;
        return burbuja;
    }

    function escaparTexto(texto) {
        const div = document.createElement("div");
        div.textContent = String(texto ?? "");
        return div.innerHTML;
    }

    /* ==================================================
       RESOLVER SERVICIO ARCGIS (misma lógica que ya usan
       resultadoscatastro.html, resultadosgeodesia.html, etc.)
       ================================================== */

    function esServicioArcGIS(url) {
        return typeof url === "string" &&
            /\/(?:FeatureServer|MapServer)(?:\/\d+)?\/?$/i.test(
                url.trim().split("?")[0]
            );
    }

    function limpiarUrlArcGIS(url) {
        return String(url || "").trim().replace(/\/+$/, "");
    }

    function extraerArcgisItemId(valor) {
        const texto = String(valor || "").trim();
        if (!texto) return "";

        if (/^[a-f0-9]{32}$/i.test(texto)) {
            return texto;
        }

        try {
            const url = new URL(texto);
            const idQuery = url.searchParams.get("id");
            if (idQuery && /^[a-f0-9]{32}$/i.test(idQuery)) {
                return idQuery;
            }
            const matchItems = url.pathname.match(/\/items\/([a-f0-9]{32})/i);
            if (matchItems) return matchItems[1];
        } catch (_) { }

        const match = texto.match(/[a-f0-9]{32}/i);
        return match ? match[0] : "";
    }

    function buscarServicioEnObjeto(objeto) {
        if (!objeto) return "";

        if (typeof objeto === "string") {
            const match = objeto.trim().match(
                /https?:\/\/[^\s"'<>]+\/(?:FeatureServer|MapServer)(?:\/\d+)?/i
            );
            return match ? limpiarUrlArcGIS(match[0]) : "";
        }

        if (Array.isArray(objeto)) {
            for (const elemento of objeto) {
                const encontrado = buscarServicioEnObjeto(elemento);
                if (encontrado) return encontrado;
            }
            return "";
        }

        if (typeof objeto === "object") {
            for (const valor of Object.values(objeto)) {
                const encontrado = buscarServicioEnObjeto(valor);
                if (encontrado) return encontrado;
            }
        }

        return "";
    }

    async function resolverServicioArcgis(dataset) {
        const itemId =
            extraerArcgisItemId(dataset.arcgis_id) ||
            extraerArcgisItemId(dataset.url_fuente) ||
            extraerArcgisItemId(dataset.url_descarga);

        for (const candidato of [dataset.url_descarga, dataset.url_fuente]) {
            if (!candidato) continue;
            const directo = buscarServicioEnObjeto(candidato);
            if (directo && esServicioArcGIS(directo)) {
                return { servicio: directo, itemId };
            }
        }

        if (!itemId) {
            throw new Error("Este dataset no tiene arcgis_id ni un servicio ArcGIS asociado.");
        }

        const infoUrl =
            "https://www.arcgis.com/sharing/rest/content/items/" +
            encodeURIComponent(itemId) + "?f=json";

        const respuestaInfo = await fetch(infoUrl);
        if (!respuestaInfo.ok) {
            throw new Error("ArcGIS respondió con estado " + respuestaInfo.status);
        }

        const info = await respuestaInfo.json();
        if (info.error) {
            throw new Error(info.error.message || "ArcGIS no permitió consultar el recurso.");
        }

        if (info.url) {
            const servicioInfo = buscarServicioEnObjeto(info.url);
            if (servicioInfo && esServicioArcGIS(servicioInfo)) {
                return { servicio: servicioInfo, itemId };
            }
        }

        const dataUrl =
            "https://www.arcgis.com/sharing/rest/content/items/" +
            encodeURIComponent(itemId) + "/data?f=json";

        const respuestaData = await fetch(dataUrl);
        if (respuestaData.ok) {
            const data = await respuestaData.json();
            const servicioData = buscarServicioEnObjeto(data);
            if (servicioData && esServicioArcGIS(servicioData)) {
                return { servicio: servicioData, itemId };
            }
        }

        throw new Error(
            "El Item de ArcGIS existe, pero no contiene un FeatureServer o MapServer público."
        );
    }

    /* ==================================================
       TARJETAS DE DATASET DENTRO DEL CHAT
       ================================================== */

    function crearTarjetaDataset(dataset) {
        const tarjeta = document.createElement("div");
        tarjeta.className = "agent-card";

        const titulo = document.createElement("strong");
        titulo.textContent = dataset.nombre_dataset || "Dataset";
        tarjeta.appendChild(titulo);

        if (dataset.entidad_responsable) {
            const entidad = document.createElement("small");
            entidad.textContent = dataset.entidad_responsable;
            tarjeta.appendChild(entidad);
        }

        const acciones = document.createElement("div");
        acciones.className = "agent-card-actions";

        if (dataset.url_fuente) {
            const fuente = document.createElement("a");
            fuente.href = dataset.url_fuente;
            fuente.target = "_blank";
            fuente.rel = "noopener noreferrer";
            fuente.textContent = "Ver fuente";
            acciones.appendChild(fuente);
        }

        if (dataset.url_descarga) {
            const descarga = document.createElement("a");
            descarga.href = dataset.url_descarga;
            descarga.target = "_blank";
            descarga.rel = "noopener noreferrer";
            descarga.textContent = "Descargar";
            acciones.appendChild(descarga);
        }

        if (dataset.arcgis_id) {
            const botonMapa = document.createElement("button");
            botonMapa.type = "button";
            botonMapa.textContent = "Ver en mi mapa";

            botonMapa.addEventListener("click", async () => {
                const textoOriginal = botonMapa.textContent;
                botonMapa.textContent = "Cargando…";
                botonMapa.disabled = true;

                try {
                    const { servicio, itemId } = await resolverServicioArcgis(dataset);

                    const parametros = new URLSearchParams();
                    parametros.set("servicio", limpiarUrlArcGIS(servicio));
                    parametros.set("nombre", dataset.nombre_dataset || "Capa ICDE");
                    parametros.set("dataset", String(dataset.id || ""));
                    if (itemId) parametros.set("arcgis_item", itemId);

                    window.location.href = MAPA_HTML_ICDE + "?" + parametros.toString();

                } catch (error) {
                    console.error("Error abriendo capa desde el agente:", error);
                    agregarBurbuja(
                        "No pude abrir esta capa en el mapa: " + escaparTexto(error.message || "error desconocido."),
                        "bot"
                    );
                    botonMapa.textContent = textoOriginal;
                    botonMapa.disabled = false;
                }
            });

            acciones.appendChild(botonMapa);
        }

        if (acciones.childNodes.length) {
            tarjeta.appendChild(acciones);
        }

        return tarjeta;
    }

    /* ==================================================
       ENVÍO DE PREGUNTAS AL AGENTE
       ================================================== */

    async function consultarAgente(mensaje) {
        const burbujaCargando = agregarBurbuja("Buscando en el catálogo del ICDE…", "bot loading");

        try {
            const respuesta = await fetch(API_AGENTE_ICDE, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ mensaje })
            });

            const datos = await respuesta.json();

            burbujaCargando.remove();

            if (!respuesta.ok || !datos.ok) {
                throw new Error(datos.error || "El agente no pudo responder.");
            }

            agregarBurbuja(escaparTexto(datos.respuesta).replace(/\n/g, "<br>"), "bot");

            (datos.recomendados || []).forEach((dataset) => {
                const burbujaTarjeta = agregarBurbuja("", "bot");
                burbujaTarjeta.appendChild(crearTarjetaDataset(dataset));
            });

        } catch (error) {
            burbujaCargando.remove();
            console.error("Error consultando al agente ICDE:", error);

            agregarBurbuja(
                "No pude conectarme con el agente. Verifica que el servidor esté activo " +
                "(<code>python api.py</code>) en <code>http://localhost:5000</code>.",
                "bot"
            );
        }
    }

    elForm.addEventListener("submit", (evento) => {
        evento.preventDefault();

        const mensaje = elInput.value.trim();
        if (!mensaje) return;

        agregarBurbuja(escaparTexto(mensaje), "user");
        elInput.value = "";

        consultarAgente(mensaje);
    });

})();