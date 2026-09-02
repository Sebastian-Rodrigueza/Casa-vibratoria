(() => {
    "use strict";

    const nav = document.getElementById("mainNav");
    const menuToggle = document.getElementById("menuToggle");
    const toast = document.getElementById("toast");
    const cardBogota = document.getElementById("cardGeodataBogota");

    let toastTimer = null;

    function mostrarMensaje(mensaje) {
        toast.textContent = mensaje;
        toast.classList.add("toast-show");

        if (toastTimer) {
            clearTimeout(toastTimer);
        }

        toastTimer = setTimeout(() => {
            toast.classList.remove("toast-show");
        }, 2500);
    }

    function cerrarMenu() {
        nav.classList.remove("nav-open");
    }

    function accionTemporal(nombre) {
        cerrarMenu();
        mostrarMensaje(nombre + ": botón preparado, sin navegación por ahora.");
    }

    menuToggle.addEventListener("click", () => {
        nav.classList.toggle("nav-open");
    });

    // Cualquier elemento con data-accion="..." muestra el mismo mensaje
    // temporal (botones del menú, del hero, y el de la tarjeta Bogotá).
    document.querySelectorAll("[data-accion]").forEach((elemento) => {
        elemento.addEventListener("click", (evento) => {
            evento.stopPropagation();
            accionTemporal(elemento.dataset.accion);
        });
    });

    // La tarjeta de Geodata Bogotá completa también es seleccionable
    // (clic en cualquier parte de la tarjeta, o Enter con el teclado).
    if (cardBogota) {
        cardBogota.addEventListener("click", () => accionTemporal("Geodata Bogotá"));

        cardBogota.addEventListener("keydown", (evento) => {
            if (evento.key === "Enter") {
                accionTemporal("Geodata Bogotá");
            }
        });
    }
})();
