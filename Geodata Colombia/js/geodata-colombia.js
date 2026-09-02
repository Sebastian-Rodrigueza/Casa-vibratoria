(() => {
    "use strict";

    const nav = document.getElementById("mainNav");
    const menuToggle = document.getElementById("menuToggle");
    const brandBtn = document.getElementById("brandBtn");
    const btnVolverInicio = document.getElementById("btnVolverInicio");
    const toast = document.getElementById("toast");

    let toastTimer = null;

    function mostrarMensaje(mensaje) {
        toast.textContent = mensaje;
        toast.classList.add("toast-visible");

        if (toastTimer) {
            clearTimeout(toastTimer);
        }

        toastTimer = setTimeout(() => {
            toast.classList.remove("toast-visible");
        }, 2600);
    }

    function cerrarMenu() {
        nav.classList.remove("navigation-open");
    }

    function irColecciones() {
        cerrarMenu();

        const elemento = document.getElementById("colecciones");

        if (!elemento) {
            return;
        }

        elemento.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function volverInicio() {
        cerrarMenu();
        window.location.href = "../Index.html";
    }

    function seleccionarColeccion(tarjeta) {
        cerrarMenu();

        const destino = tarjeta.dataset.destino;

        if (destino) {
            window.location.href = destino;
            return;
        }

        mostrarMensaje(
            tarjeta.dataset.mensaje || "No fue posible identificar el visor."
        );
    }

    menuToggle.addEventListener("click", () => {
        nav.classList.toggle("navigation-open");
    });

    brandBtn.addEventListener("click", () => mostrarMensaje("Geodata Colombia"));

    btnVolverInicio.addEventListener("click", volverInicio);

    document.querySelectorAll("[data-ir-colecciones]").forEach((elemento) => {
        elemento.addEventListener("click", irColecciones);
    });

    document.querySelectorAll(".collection-card").forEach((tarjeta) => {
        tarjeta.addEventListener("click", () => seleccionarColeccion(tarjeta));

        tarjeta.addEventListener("keydown", (evento) => {
            if (evento.key === "Enter") {
                seleccionarColeccion(tarjeta);
            }
        });

        const boton = tarjeta.querySelector(".collection-button");

        if (boton) {
            boton.addEventListener("click", (evento) => {
                evento.stopPropagation();
                seleccionarColeccion(tarjeta);
            });
        }
    });
})();
