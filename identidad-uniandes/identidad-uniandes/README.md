# Identidad institucional Uniandes — header y footer

Este paquete trae lo necesario para que cualquier proyecto del lab tenga un
header y un footer que cumplan el manual de identidad de la Universidad de
los Andes (`manual-imagen-2021.pdf`). Viene de los componentes reales del
sitio de SinergIA, genericizados para que sirvan en cualquier proyecto.

## Las 3 reglas que importan

1. **Nunca crees un logo nuevo para tu proyecto o lab** (manual, sec. 2.4.2).
   Eso incluye íconos, mascotas o cualquier marca propia. La única forma
   permitida de identificar tu proyecto es la "firma de unidad": el logo
   oficial de la Universidad + el nombre de tu proyecto en **texto plano**.
2. **Los únicos colores institucionales son negro y amarillo** (manual, sec.
   2.1.3). El amarillo puro (`#FFDE00` aprox.) casi no se lee como texto
   sobre blanco, así que para texto/links usa la variante oscura incluida
   aquí (`--yellow-ink`).
3. **El texto legal del footer es obligatorio tal cual está**, sin
   parafrasear ni resumir, en cualquier sitio afiliado a la Universidad
   (manual, sec. 2.3). Ya viene puesto en las plantillas; no lo borres.

Además trae **`DESIGN-SYSTEM.md`**, con la tipografía, los colores y los
patrones de tarjetas/enlaces/animación reales del sitio, para que el
resultado visual sea consistente con SinergIA y no solo "cumpla el manual".

## Qué hay en cada carpeta

- **`assets/logos/`** — todos los logos reales usados en el sitio, cada uno
  con su nombre:
  - `uniandes-logo.svg` — el logo oficial completo (escudo + texto
    "Universidad de los Andes"), como SVG independiente, en negro. Úsalo
    tal cual, con o sin React.
  - `uniandes-shield.png` — el escudo solo (ícono), para favicons o usos
    pequeños.
  - `sinergia-logo.webp` — el logo del laboratorio SinergIA.
  - `grupos-investigacion/` — los logos de cada grupo de investigación del
    departamento (`in2geco.png`, `geoingenia.png`, `cimoc.png`, `ciia.svg`,
    `ciacua.png`, `colivri.png`).
  - **Cuál usar cuándo:** ver la tabla en `DESIGN-SYSTEM.md` sec. 1. En
    corto: el de la Universidad siempre; el de SinergIA solo si el proyecto
    es del laboratorio; el de un grupo solo si el proyecto es de ese grupo
    específico. No es un permiso para inventar un logo nuevo para otra
    cosa (eso sigue prohibido por el manual, sec. 2.4.2).

- **`react/`** (para proyectos Next.js / React + Tailwind)
  - `UniandesLogo.tsx` — el logo oficial como componente, con un prop
    `fill` para ponerlo en negro (fondo claro) o blanco (fondo oscuro).
    **No lo edites**: es el logo real, no se redibuja ni se recolorea de
    otra forma (manual, sec. 2.1.3).
  - `UnitSignature.tsx` — el patrón de "firma de unidad" (logo + línea
    vertical + nombre), incluida la variante de dos niveles del manual
    (sec. 4.5.1, página 42): `Facultad | Tu proyecto`. Tampoco lo edites,
    solo pásale tus propios textos como props.
  - `Navbar.example.tsx` y `Footer.example.tsx` — ejemplos completos de
    header y footer ya armados con lo anterior. Estos sí los editas: busca
    los comentarios `// EDITA ESTO` y cambia el nombre del proyecto, las
    páginas de tu menú, el correo y la ubicación.
  - `colors.css` — los tokens de color oficiales. Pégalos en tu hoja de
    estilos global.
  - `motion.ts` — la curva de animación (`easeApple`) usada en todo el
    sitio para las apariciones al hacer scroll. Ver `DESIGN-SYSTEM.md`
    sec. 5 para el patrón completo.
  - Dependencias que usan los ejemplos: Tailwind CSS, `lucide-react`
    (iconos) y `motion` (antes `framer-motion`, para el menú móvil y las
    animaciones). Si no usas alguna, quita esa parte del ejemplo — la
    lógica de header/footer no depende de ellas.

- **`html/header-footer.html`**
  - La misma idea pero en HTML y CSS puro, sin ningún framework. Ábrelo
    directo en el navegador para verlo. Útil si tu proyecto no es
    Next.js/React. Busca los comentarios `<!-- EDITA ESTO -->`.

## Cómo usarlo en un proyecto Next.js

1. Copia `UniandesLogo.tsx` y `UnitSignature.tsx` sin cambios a
   `src/components/`.
2. Copia `Navbar.example.tsx` y `Footer.example.tsx` también a
   `src/components/`, renómbralos a `Navbar.tsx` y `Footer.tsx`, y edita
   las partes marcadas.
3. Pega el contenido de `colors.css` en tu `globals.css`.
4. Importa `<Navbar />` y `<Footer />` en tu layout, igual que cualquier
   otro componente.

## De dónde sale esto

Extraído el 2026-10-21 del sitio real de SinergIA
(`C:\Users\LuisPc\SinergIA`), que ya pasó por una revisión de Identidad
Institucional / Comunicación Estratégica de la Universidad. Si tienes
dudas puntuales sobre la firma de tu proyecto, el manual mismo indica
escribir a `identidadinstitucional@uniandes.edu.co`.
