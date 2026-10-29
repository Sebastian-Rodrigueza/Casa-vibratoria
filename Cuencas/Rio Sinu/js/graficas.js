// Graficas en SVG para el visor 3D y el dashboard del rio Sinu (sin librerias).
// Reglas: una sola escala vertical por grafica, lineas de 2 px, barras con 2 px de separacion,
// tooltip al pasar el mouse y el texto siempre en tinta (el color solo en la marca).
// Cada grafica va en un <div class="g-lienzo"> con su <svg> y un <div class="g-tip" hidden>.
(() => {
    "use strict";
    const TINTA = "#26292d", GRIS = "#70757b", REJA = "rgba(38,41,45,.08)";
    const num = (v, d = 0) => Number(v).toLocaleString("es-CO", { maximumFractionDigits: d, minimumFractionDigits: d });
    const dec = (v) => Math.abs(v) < 10 ? (Math.abs(v) < 1 ? 2 : 1) : 0;
    // decimales de los rotulos de un eje: los que pida el paso (0,05 -> 2), para que no se repitan
    const decEje = (lista) => Math.min(3, Math.max(0, ...lista.map((v) => ((String(v).split(".")[1]) || "").length)));

    function marcas(a, b, n) {
        const paso0 = (b - a) / n || 1, pot = 10 ** Math.floor(Math.log10(paso0));
        const paso = [1, 2, 2.5, 5, 10].map((k) => k * pot).find((p) => p >= paso0);
        const res = [];
        for (let v = Math.ceil(a / paso) * paso; v <= b + 1e-9; v += paso) res.push(+v.toFixed(6));
        return res;
    }

    function tooltip(svg, W, posX, contenido) {
        const tip = svg.parentElement.querySelector(".g-tip");
        if (!tip) return { mostrar() {}, ocultar() {} };
        return {
            mostrar(x, html) {
                const r = svg.getBoundingClientRect();
                tip.hidden = false;
                tip.innerHTML = html;
                const izq = x * r.width / W, medio = tip.offsetWidth / 2;
                tip.style.left = Math.min(Math.max(izq, medio), r.width - medio) + "px";
            },
            ocultar() { tip.hidden = true; }
        };
    }

    // Lineas o barras verticales sobre un eje x numerico (anos o meses).
    // series: [{ nombre, color, puntos: [[x, y], ...] }]
    // o: { unidad, marcarX, alClicX, fmtX, barras, colorBarra, cero, alto }
    function grafica(svg, series, o = {}) {
        const W = svg.clientWidth || 300, H = svg.clientHeight || o.alto || 150;
        svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
        const L = 42, R = 8, T = 10, B = 20, pw = W - L - R, ph = H - T - B;
        const xs = series.flatMap((s) => s.puntos.map((p) => p[0]));
        const ys = series.flatMap((s) => s.puntos.map((p) => p[1])).filter((v) => v != null);
        if (!xs.length || !ys.length) { svg.innerHTML = `<text x="${W / 2}" y="${H / 2}" font-size="12" fill="${GRIS}" text-anchor="middle">Sin datos</text>`; return; }
        const x0 = Math.min(...xs), x1 = Math.max(...xs);
        let y0 = Math.min(o.cero === false ? Infinity : 0, ...ys), y1 = Math.max(...ys);
        if (y1 === y0) y1 = y0 + 1;
        const mg = (y1 - y0) * 0.08; y1 += mg; if (y0 < 0) y0 -= mg;
        const anchoX = o.barras ? pw / (x1 - x0 + 1) : 0;
        const X = (v) => L + (o.barras ? (v - x0 + 0.5) * anchoX : (v - x0) / ((x1 - x0) || 1) * pw);
        const Y = (v) => T + ph * (1 - (v - y0) / (y1 - y0));
        const fx = o.fmtX || ((v) => v);
        let g = "";
        const my = marcas(y0, y1, 3), dy = decEje(my);
        my.forEach((v) => {
            g += `<line x1="${L}" x2="${L + pw}" y1="${Y(v)}" y2="${Y(v)}" stroke="${REJA}"/>
                <text x="${L - 5}" y="${Y(v) + 3.5}" font-size="10" fill="${GRIS}" text-anchor="end">${num(v, dy)}</text>`;
        });
        marcas(x0, x1, Math.max(2, Math.floor(pw / 60))).forEach((v) => {
            if (v % 1) return;
            g += `<text x="${X(v)}" y="${H - 5}" font-size="10" fill="${GRIS}" text-anchor="middle">${fx(v)}</text>`;
        });
        if (y0 < 0) g += `<line x1="${L}" x2="${L + pw}" y1="${Y(0)}" y2="${Y(0)}" stroke="#9aa0a6"/>`;
        // franjas de fondo para tramos que hay que leer con cuidado: [[desde, hasta], ...]
        (o.bandas || []).forEach(([a, b]) => {
            const xa = Math.max(L, X(a)), xb = Math.min(L + pw, X(b));
            if (xb > xa) g = `<rect x="${xa}" y="${T}" width="${xb - xa}" height="${ph}" fill="rgba(38,41,45,.07)"/>` + g;
        });
        let marcasSerie = "";
        series.forEach((s, k) => {
            if (o.barras) {
                const n = series.length, bw = Math.max(1, (anchoX - 2) / n);
                s.puntos.forEach(([x, y]) => {
                    if (y == null) return;
                    const ya = Y(Math.max(0, y)), yb = Y(Math.min(0, y));
                    const col = o.colorBarra ? o.colorBarra(x, y) : s.color;
                    marcasSerie += `<rect x="${X(x) - (anchoX - 2) / 2 + k * bw}" y="${ya}" width="${Math.max(1, bw - (n > 1 ? 1 : 0))}" height="${Math.max(1, yb - ya)}" rx="${Math.min(2, bw / 3)}" fill="${col}"/>`;
                });
            } else {
                // se corta la linea donde falta un dato (no se une por encima del hueco)
                let tramo = [];
                const cerrar = () => { if (tramo.length > 1) marcasSerie += `<polyline points="${tramo.join(" ")}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round"/>`; tramo = []; };
                const pts = [...s.puntos].sort((a, b) => a[0] - b[0]);
                pts.forEach(([x, y], i) => {
                    if (y == null || (i && x - pts[i - 1][0] > (o.salto || 1.01))) cerrar();
                    if (y != null) tramo.push(`${X(x).toFixed(1)},${Y(y).toFixed(1)}`);
                });
                cerrar();
                pts.forEach(([x, y], i) => {   // puntos aislados (sin vecinos) se dibujan como punto
                    const ant = pts[i - 1], sig = pts[i + 1];
                    if (y != null && (!ant || ant[1] == null || x - ant[0] > (o.salto || 1.01)) && (!sig || sig[1] == null || sig[0] - x > (o.salto || 1.01)))
                        marcasSerie += `<circle cx="${X(x)}" cy="${Y(y)}" r="2.5" fill="${s.color}"/>`;
                });
            }
        });
        const marca = o.marcarX != null ? `<line x1="${X(o.marcarX)}" x2="${X(o.marcarX)}" y1="${T}" y2="${T + ph}" stroke="${TINTA}" stroke-width="1.2"/>` : "";
        svg.innerHTML = `${g}${marcasSerie}${marca}
            <line class="g-cursor" y1="${T}" y2="${T + ph}" stroke="${TINTA}" stroke-dasharray="3 3" visibility="hidden"/>
            <rect x="${L}" y="${T}" width="${pw}" height="${ph}" fill="transparent" style="cursor:${o.alClicX ? "pointer" : "crosshair"}"/>`;
        const zona = svg.lastElementChild, cur = svg.querySelector(".g-cursor");
        const tt = tooltip(svg, W);
        const todosX = [...new Set(xs)].sort((a, b) => a - b);
        const cercano = (ev) => {
            const r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) * W / r.width;
            return todosX.reduce((m, v) => Math.abs(X(v) - px) < Math.abs(X(m) - px) ? v : m, todosX[0]);
        };
        zona.onmousemove = (ev) => {
            const x = cercano(ev);
            cur.setAttribute("x1", X(x)); cur.setAttribute("x2", X(x)); cur.setAttribute("visibility", "visible");
            tt.mostrar(X(x), `<b>${fx(x)}</b>` + series.map((s) => {
                const p = s.puntos.find((q) => q[0] === x);
                const col = o.colorBarra && p && p[1] != null ? o.colorBarra(x, p[1]) : s.color;
                return `<div><i style="background:${col}"></i>${s.nombre}: <b>${p && p[1] != null ? num(p[1], dec(p[1])) : "—"}</b> ${o.unidad || ""}</div>`;
            }).join(""));
        };
        zona.onmouseleave = () => { cur.setAttribute("visibility", "hidden"); tt.ocultar(); };
        if (o.alClicX) zona.onclick = (ev) => o.alClicX(cercano(ev));
    }

    // Barras horizontales por categoria. filas: [{ etiqueta, valores: [..], clave }]
    // series: [{ nombre, color }]; o: { apiladas, unidad, alClic(fila), etiquetaAncho }
    // Una fila con 'color' propio pinta sus barras de ese color (p. ej. una clase de cobertura).
    // Con valores negativos el eje queda en el centro (barras divergentes).
    function barrasH(svg, filas, series, o = {}) {
        const fila = o.altoFila || (o.apiladas ? 20 : 8 + series.length * 9);
        const W = svg.clientWidth || 300, H = filas.length * fila + 24;
        svg.style.height = H + "px";
        svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
        const L = o.etiquetaAncho || 150, R = 46, T = 4, pw = W - L - R;
        const tot = (f) => o.apiladas ? f.valores.reduce((s, v) => s + (v || 0), 0) : null;
        const vals = filas.flatMap((f) => o.apiladas ? [tot(f)] : f.valores).filter((v) => v != null);
        let v0 = Math.min(0, ...vals), v1 = Math.max(0, ...vals);
        if (v1 === v0) v1 = v0 + 1;
        // con rotulos, espacio a cada lado para el numero (si no, el de la barra negativa mas larga
        // queda encima del nombre de la categoria)
        if (o.rotular) { const m = (v1 - v0) * 0.14; if (v0 < 0) v0 -= m; if (v1 > 0) v1 += m; }
        const X = (v) => L + (v - v0) / (v1 - v0) * pw;
        let s = "";
        const mx = marcas(v0, v1, Math.max(2, Math.floor(pw / 70))), dx = decEje(mx);
        mx.forEach((v) => {
            s += `<line x1="${X(v)}" x2="${X(v)}" y1="${T}" y2="${T + filas.length * fila}" stroke="${v === 0 ? "#9aa0a6" : REJA}"/>
                <text x="${X(v)}" y="${H - 6}" font-size="10" fill="${GRIS}" text-anchor="middle">${num(v, dx)}</text>`;
        });
        filas.forEach((f, i) => {
            const y = T + i * fila;
            const recorte = f.etiqueta.length > L / 6.2 ? f.etiqueta.slice(0, Math.floor(L / 6.2) - 1) + "…" : f.etiqueta;
            s += `<g class="g-fila" data-i="${i}" style="cursor:${o.alClic ? "pointer" : "default"}">
                <rect x="0" y="${y}" width="${W}" height="${fila}" fill="transparent"/>
                <text x="${L - 6}" y="${y + fila / 2 + 4}" font-size="11" fill="${TINTA}" text-anchor="end">${recorte}</text>`;
            if (o.apiladas) {
                let acc = 0;
                f.valores.forEach((v, k) => {
                    if (!v) return;
                    const xa = X(acc), xb = X(acc + v);
                    s += `<rect x="${xa}" y="${y + 3}" width="${Math.max(1, xb - xa - 2)}" height="${fila - 6}" rx="2" fill="${series[k].color}"/>`;
                    acc += v;
                });
                s += `<text x="${X(acc) + 4}" y="${y + fila / 2 + 4}" font-size="10.5" fill="${GRIS}">${num(acc, dec(acc))}</text>`;
            } else {
                const bh = (fila - 8) / series.length;
                f.valores.forEach((v, k) => {
                    if (v == null) return;
                    const xa = X(Math.min(0, v)), xb = X(Math.max(0, v)), yy = y + 4 + k * bh;
                    s += `<rect x="${xa}" y="${yy}" width="${Math.max(1, xb - xa)}" height="${Math.max(1, bh - 1.5)}" rx="1.5" fill="${f.color || series[k].color}"/>`;
                    if (o.rotular) s += `<text x="${v >= 0 ? xb + 3 : xa - 3}" y="${yy + bh - 2.5}" font-size="9" fill="${GRIS}" text-anchor="${v >= 0 ? "start" : "end"}">${v > 0 ? "+" : ""}${num(v)}</text>`;
                });
            }
            s += `</g>`;
        });
        svg.innerHTML = s;
        const tt = tooltip(svg, W);
        svg.querySelectorAll(".g-fila").forEach((g) => {
            const f = filas[+g.dataset.i];
            g.onmousemove = () => tt.mostrar(L + pw / 2, `<b>${f.etiqueta}</b>` + series.map((se, k) =>
                `<div><i style="background:${f.color || se.color}"></i>${se.nombre}: <b>${f.valores[k] == null ? "—" : (o.signo && f.valores[k] > 0 ? "+" : "") + num(f.valores[k], dec(f.valores[k]))}</b> ${o.unidad || ""}${f.extra && f.extra[k] ? " " + f.extra[k] : ""}</div>`).join(""));
            g.onmouseleave = () => tt.ocultar();
            if (o.alClic) g.onclick = () => o.alClic(f);
        });
    }

    // Promedio anual a partir de los meses, solo para los anos con al menos 'minMeses' meses
    // (el archivo del paquete promedia los meses que haya, y un ano con 1 mes engana).
    function anualCompleto(mensual, minMeses = 10) {
        const por = {};
        (mensual || []).forEach(([y, , v]) => { if (v != null) (por[y] = por[y] || []).push(v); });
        const anios = Object.keys(por).map(Number).sort((a, b) => a - b);
        const puntos = [], fuera = [];
        anios.forEach((y) => {
            if (por[y].length >= minMeses) puntos.push([y, por[y].reduce((s, v) => s + v, 0) / por[y].length]);
            else fuera.push(y);
        });
        return { puntos, fuera };
    }
    // Promedio de cada mes (regimen), con los mismos anos completos
    function regimen(mensual, minMeses = 10) {
        const completos = new Set(anualCompleto(mensual, minMeses).puntos.map((p) => p[0]));
        const suma = Array(13).fill(0), n = Array(13).fill(0);
        (mensual || []).forEach(([y, m, v]) => { if (v != null && completos.has(y)) { suma[m] += v; n[m]++; } });
        const res = [];
        for (let m = 1; m <= 12; m++) res.push([m, n[m] ? suma[m] / n[m] : null]);
        return res;
    }
    const MES = ["", "ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

    window.Graficas = { grafica, barrasH, anualCompleto, regimen, num, MES };
})();
