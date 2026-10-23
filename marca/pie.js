/*
 * Pie de pagina institucional (Universidad de los Andes · Lab SinergIA), igual en todo el sitio.
 * Sigue el kit de identidad (identidad-uniandes/): firma de unidad, colores y el texto legal
 * OBLIGATORIO del manual (sec. 2.3), que no se cambia ni se resume.
 *
 * Uso: <script src="(ruta)/marca/pie.js" defer></script> al final de la pagina.
 * Modos (atributo data-pie del script):
 *   completo   el pie entero al final de la pagina
 *   compacto   una franja pequena abajo con el texto legal y un boton que abre el pie entero
 *              (para visores a pantalla completa, donde la pagina no tiene scroll)
 *   en-footer  lo mismo que compacto, pero dentro del <footer> que ya tiene la pagina
 *   (sin atributo) se decide solo: compacto si la pagina no tiene scroll, completo si lo tiene
 */
(() => {
    "use strict";
    const script = document.currentScript;
    const raiz = new URL("..", script.src).href;          // la carpeta del sitio (marca/ esta en la raiz)
    const modoPedido = script.dataset.pie || "auto";

    const NAV = [
        ["Inicio", raiz + "Index.html"],
        ["Geodata Colombia", raiz + "Geodata%20Colombia/Index.html"],
        ["Cuencas", raiz + "Cuencas/Index.html"],
        ["Visor de mapas", raiz + "Mapa.html"],
        ["Sitio de SinergIA", "https://sinergia.uniandes.edu.co"]
    ];
    const CORREO = "sinergia@uniandes.edu.co";
    const LUGAR = "Depto. de Ingeniería Civil y Ambiental, Universidad de los Andes, Bogotá";
    // Texto legal obligatorio (manual de identidad, sec. 2.3): tal cual
    const LEGAL_1 = "Universidad de los Andes | Vigilada Mineducación";
    const LEGAL_2 = "Reconocimiento como Universidad: Decreto 1297 del 30 de mayo de 1964. " +
        "Reconocimiento personería jurídica: Resolución 28 del 23 de febrero de 1949 Minjusticia.";

    const ICONO_CORREO = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>';
    const ICONO_LUGAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>';

    const CSS = `
/* logos de los encabezados: que la caja de logos no se encoja (si se encoge, el logo de
   SinergIA, que es horizontal, se monta sobre el texto de al lado) */
:is(span, div, a, button, header):has(> img[src*="marca/sinergia-logo"]) { flex-shrink: 0; }
img[src*="marca/sinergia-logo"], img[src*="marca/uniandes-logo-cabecera"] { flex: none; max-width: none; object-fit: contain; }
.ps-pie, .ps-pie *, .ps-tira, .ps-tira *, .ps-ventana, .ps-ventana * {
    box-sizing: border-box; margin: 0; padding: 0; letter-spacing: normal; text-transform: none;
    font-family: "Geist", -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
.ps-pie { display: block; background: #f5f5f7; border-top: 1px solid #e5e5e7; color: #000; text-align: left; }
.ps-pie .ps-dentro { max-width: 1100px; margin: 0 auto; padding: 56px 24px 32px; }
.ps-pie .ps-rejilla { display: grid; grid-template-columns: 1fr; gap: 40px; }
@media (min-width: 720px) { .ps-pie .ps-rejilla { grid-template-columns: 1.2fr 1fr 1fr; } }
.ps-firma { display: flex; align-items: stretch; gap: 14px; margin-bottom: 18px; }
.ps-firma img { height: 36px; width: auto; display: block; max-width: none; }
.ps-firma .ps-linea { width: 1px; background: rgba(0, 0, 0, .6); flex: none; }
.ps-firma .ps-nivel { display: flex; flex-direction: column; justify-content: center; line-height: 1.12; color: #000; }
.ps-firma .ps-facultad { font-weight: 700; font-size: 14.5px; }
.ps-firma .ps-unidad { font-weight: 500; font-size: 12px; }
.ps-pie .ps-desc { font-size: 14px; line-height: 1.65; color: #6e6e73; max-width: 340px; }
.ps-pie .ps-titulo { font-size: 11.5px; font-weight: 600; text-transform: uppercase; letter-spacing: .08em; color: #8e8e93; margin-bottom: 16px; }
.ps-pie ul { list-style: none; display: flex; flex-direction: column; gap: 11px; }
.ps-pie li { font-size: 14px; line-height: 1.5; color: #6e6e73; display: flex; gap: 8px; align-items: flex-start; }
.ps-pie a { color: #6e6e73; text-decoration: none; transition: color .15s; }
.ps-pie a:hover { color: #000; }
.ps-pie a:focus-visible, .ps-tira button:focus-visible, .ps-ventana button:focus-visible { outline: 2px solid #000; outline-offset: 2px; border-radius: 4px; }
.ps-pie li svg { width: 16px; height: 16px; flex: none; margin-top: 2px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.ps-pie .ps-abajo { margin-top: 48px; padding-top: 22px; border-top: 1px solid #e5e5e7; display: flex; flex-wrap: wrap; gap: 12px;
    justify-content: space-between; align-items: center; font-size: 12.5px; color: #6e6e73; }
.ps-pie .ps-legal { margin-top: 22px; padding-top: 22px; border-top: 1px solid #e5e5e7; text-align: center; font-size: 11px; line-height: 1.7; color: rgba(110, 110, 115, .85); }
/* franja compacta para visores a pantalla completa */
.ps-tira { position: fixed; z-index: 2147483000; left: 50%; bottom: 6px; transform: translateX(-50%); display: flex; align-items: center; gap: 8px;
    max-width: calc(100vw - 24px); padding: 3px 4px 3px 11px; border-radius: 999px; background: rgba(255, 255, 255, .92);
    border: 1px solid rgba(0, 0, 0, .08); box-shadow: 0 2px 10px rgba(0, 0, 0, .12); font-size: 10.5px; color: #3a3a3c; white-space: nowrap; }
.ps-tira span { overflow: hidden; text-overflow: ellipsis; }
.ps-tira button, .ps-enfooter button { border: 0; cursor: pointer; font-size: 10.5px; font-weight: 600; color: #000; background: #ffde00; padding: 3px 9px; border-radius: 999px; }
.ps-enfooter { display: inline-flex; align-items: center; gap: 8px; margin-left: 10px; font-size: 11px; }
.ps-ventana { position: fixed; inset: 0; z-index: 2147483001; display: flex; align-items: flex-end; justify-content: center; background: rgba(0, 0, 0, .45); padding: 16px; }
.ps-ventana .ps-caja { position: relative; width: min(1100px, 100%); max-height: 100%; overflow-y: auto; border-radius: 18px; box-shadow: 0 12px 40px rgba(0, 0, 0, .3); }
.ps-ventana .ps-pie { border-top: 0; }
.ps-ventana .ps-cerrar { position: absolute; top: 12px; right: 12px; z-index: 1; width: 32px; height: 32px; border-radius: 50%; border: 1px solid #e5e5e7;
    background: #fff; cursor: pointer; font-size: 18px; line-height: 1; color: #000; }
`;

    function pieHTML() {
        const nav = NAV.map(([t, u]) => `<li><a href="${u}"${u.startsWith("http") ? ' target="_blank" rel="noopener"' : ""}>${t}</a></li>`).join("");
        return `
<div class="ps-dentro">
    <div class="ps-rejilla">
        <div>
            <div class="ps-firma">
                <img src="${raiz}marca/uniandes-logo.svg?v=2" alt="Universidad de los Andes">
                <span class="ps-linea"></span>
                <span class="ps-nivel"><span class="ps-facultad">Facultad</span><span class="ps-facultad">de Ingeniería</span></span>
                <span class="ps-linea"></span>
                <span class="ps-nivel"><span class="ps-unidad">Laboratorio</span><span class="ps-unidad">SinergIA</span></span>
            </div>
            <p class="ps-desc">Laboratorio de inteligencia artificial para ciudades sostenibles y modernización,
                Departamento de Ingeniería Civil y Ambiental, Universidad de los Andes.</p>
        </div>
        <div>
            <p class="ps-titulo">Navegación</p>
            <ul>${nav}</ul>
        </div>
        <div>
            <p class="ps-titulo">Contacto</p>
            <ul>
                <li>${ICONO_CORREO}<a href="mailto:${CORREO}">${CORREO}</a></li>
                <li>${ICONO_LUGAR}<span>${LUGAR}</span></li>
            </ul>
        </div>
    </div>
    <div class="ps-abajo">
        <span>© ${new Date().getFullYear()} Laboratorio SinergIA · Universidad de los Andes</span>
        <a href="#" data-ps-arriba>Volver arriba</a>
    </div>
    <div class="ps-legal">
        <p>${LEGAL_1}</p>
        <p>${LEGAL_2}</p>
    </div>
</div>`;
    }

    function crearPie() {
        const pie = document.createElement("div");
        pie.className = "ps-pie";
        pie.setAttribute("role", "contentinfo");
        pie.innerHTML = pieHTML();
        pie.querySelector("[data-ps-arriba]").addEventListener("click", (e) => {
            e.preventDefault();
            const caja = pie.closest(".ps-caja");
            if (caja) caja.scrollTo({ top: 0, behavior: "smooth" });
            else window.scrollTo({ top: 0, behavior: "smooth" });
        });
        return pie;
    }

    function abrirVentana() {
        const v = document.createElement("div");
        v.className = "ps-ventana";
        v.innerHTML = `<div class="ps-caja"><button type="button" class="ps-cerrar" aria-label="Cerrar">×</button></div>`;
        v.querySelector(".ps-caja").appendChild(crearPie());
        const cerrar = () => { v.remove(); document.removeEventListener("keydown", tecla); };
        const tecla = (e) => { if (e.key === "Escape") cerrar(); };
        v.addEventListener("click", (e) => { if (e.target === v) cerrar(); });
        v.querySelector(".ps-cerrar").addEventListener("click", cerrar);
        document.addEventListener("keydown", tecla);
        document.body.appendChild(v);
        v.querySelector(".ps-cerrar").focus();
    }

    function botonInfo() {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = "Lab SinergIA";
        b.title = "Ver la información institucional";
        b.addEventListener("click", abrirVentana);
        return b;
    }

    function sinScroll() {
        const h = getComputedStyle(document.documentElement), b = getComputedStyle(document.body);
        return [h.overflow, h.overflowY, b.overflow, b.overflowY].includes("hidden");
    }

    function montar() {
        if (!document.getElementById("ps-estilos")) {
            const fuente = document.createElement("link");
            fuente.rel = "stylesheet";
            fuente.href = "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap";
            document.head.appendChild(fuente);
            const estilo = document.createElement("style");
            estilo.id = "ps-estilos";
            estilo.textContent = CSS;
            document.head.appendChild(estilo);
        }
        // escudo de la Universidad como icono de la pestana, si la pagina no tiene uno
        if (!document.querySelector('link[rel~="icon"]')) {
            const ico = document.createElement("link");
            ico.rel = "icon";
            ico.href = raiz + "marca/uniandes-escudo.png";
            document.head.appendChild(ico);
        }
        const modo = modoPedido === "auto" ? (sinScroll() ? "compacto" : "completo") : modoPedido;
        const footer = modo === "en-footer" ? document.querySelector("footer") : null;
        if (footer) {
            const s = document.createElement("span");
            s.className = "ps-enfooter";
            s.innerHTML = `<span>${LEGAL_1}</span>`;
            s.appendChild(botonInfo());
            footer.appendChild(s);
        } else if (modo === "compacto" || modo === "en-footer") {
            const t = document.createElement("div");
            t.className = "ps-tira";
            t.innerHTML = `<span>${LEGAL_1}</span>`;
            t.appendChild(botonInfo());
            document.body.appendChild(t);
            document.body.classList.add("pie-compacto");
        } else {
            document.body.appendChild(crearPie());
        }
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", montar);
    else montar();
})();
