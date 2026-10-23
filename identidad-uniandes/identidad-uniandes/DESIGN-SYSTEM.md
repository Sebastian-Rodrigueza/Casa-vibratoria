# Patrones de diseño de SinergIA

Esto documenta el lenguaje visual real del sitio (tipografía, color, tarjetas,
enlaces, animaciones), tomado directamente del código de producción, para que
cualquier proyecto nuevo del lab se vea de la misma familia sin tener que
adivinar los valores. No son reglas institucionales obligatorias como las del
`README.md` — son las decisiones de diseño que ya tomamos para SinergIA, para
tener un resultado visual común.

Todo esto asume **Next.js + Tailwind CSS v4**. Si tu stack es distinto, los
valores (colores, tamaños, curva de animación) igual sirven como referencia.

## 1. Logos — cuál usar en cada caso

El manual de identidad (sec. 2.4.2) prohíbe crear un logo nuevo para un
laboratorio, grupo o proyecto. Los logos de abajo son excepciones ya
existentes y aprobadas para cada caso puntual — no un permiso para que tu
proyecto se invente el suyo.

| Logo | Archivo | Cuándo usarlo |
|---|---|---|
| Universidad de los Andes (oficial) | `assets/logos/uniandes-logo.svg`, `uniandes-shield.png` | **Siempre**, en cualquier proyecto afiliado a la Universidad. |
| SinergIA | `assets/logos/sinergia-logo.webp` | Solo si tu proyecto es parte del laboratorio SinergIA en sí (como en el navbar de `sinergia.uniandes.edu.co`). Si tu proyecto es independiente, no lo uses: usa la "firma de unidad" con el nombre de tu proyecto en texto, como en `Navbar.example.tsx`. |
| Grupos de investigación (`assets/logos/grupos-investigacion/`) | `in2geco.png`, `geoingenia.png`, `cimoc.png`, `ciia.svg`, `ciacua.png`, `colivri.png` | Solo si tu proyecto está afiliado directamente a ESE grupo específico (por ejemplo, un proyecto del grupo GeoIngenIA usa `geoingenia.png`, no los otros). |

## 2. Tipografía

El sitio usa **Geist** (sans) y **Geist Mono**, cargadas con `next/font/google`
(gratis, sin licencias que gestionar):

```tsx
import { Geist, Geist_Mono } from "next/font/google";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"], display: "swap" });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"], display: "swap" });

// en el <html>:
<html className={`${geistSans.variable} ${geistMono.variable}`}>
```

Escala de texto real, usada igual en Proyectos, Laboratorio, Investigación y
Quiénes somos:

| Uso | Clases de Tailwind |
|---|---|
| Título de página (h1) | `text-4xl sm:text-5xl font-semibold text-black tracking-tight text-balance mb-5` |
| Texto introductorio bajo el h1 | `text-lg text-foreground-secondary leading-relaxed` |
| Título de tarjeta/sección | `text-2xl font-semibold text-black` |
| Etiqueta pequeña en mayúsculas ("eyebrow") | `text-xs font-semibold uppercase tracking-wider text-yellow-ink` |
| Texto de cuerpo normal | `text-[15px] text-foreground-secondary leading-relaxed` |

## 3. Color

Pega `react/colors.css` en tu hoja de estilos global. En resumen:

- `--foreground` (`#000000`) y `--background` (`#ffffff`) — texto y fondo base.
- `--foreground-secondary` (`#6e6e73`) — texto secundario/descripciones.
- `--yellow` (`#ffde00`) — SOLO para rellenos/insignias con texto negro o
  ícono blanco encima (nunca como color de texto, no tiene contraste).
- `--yellow-ink` (`#7a6100`) — la variante que sí se usa como texto/acento
  (etiquetas, subrayados de links).
- `--border-soft` / `--border-strong` — bordes sutiles entre secciones y
  tarjetas.

## 4. Patrones de componentes (copiados tal cual del código real)

**Envoltorio de sección** (usado en Proyectos, Laboratorio, Quiénes somos):
```html
<section class="relative py-24 sm:py-32 px-5 sm:px-8 bg-white">
  <div class="max-w-6xl mx-auto"> ... </div>
</section>
```

**Enlace subrayado en amarillo** (el patrón de link más usado en todo el sitio):
```html
<a class="text-[15px] font-medium text-black underline decoration-yellow decoration-4
          underline-offset-4 hover:decoration-black transition-colors
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black rounded">
  Texto del enlace
</a>
```

**Ítem de lista con acento amarillo** (usado en líneas de investigación, specs
técnicas, features de proyectos):
```html
<li class="pl-4 border-l-2 border-yellow text-[15px] text-foreground-secondary leading-relaxed">
  Texto del ítem
</li>
```

**Pastilla/chip** (stack técnico, tags):
```html
<span class="text-xs px-2.5 py-1 rounded-full border border-border-strong text-foreground-secondary">
  Nombre
</span>
```

**Tarjeta seleccionable** (selector de proyectos en `Proyectos.tsx` — activa en
negro, inactiva en blanco):
```tsx
<button
  className={`text-left p-5 rounded-2xl border transition-colors cursor-pointer
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black ${
    isActive ? "bg-black border-black" : "bg-white border-border-soft hover:border-border-strong"
  }`}
>
  <span className={`block text-[15px] font-semibold mb-1.5 ${isActive ? "text-white" : "text-black"}`}>
    Título
  </span>
  <span className={`block text-[13px] leading-relaxed ${isActive ? "text-white/60" : "text-foreground-secondary"}`}>
    Descripción corta
  </span>
</button>
```

## 5. Animación

Una sola curva de easing para todo el sitio (`react/motion.ts`), más el
patrón estándar de aparición al hacer scroll (con `motion/react`, antes
`framer-motion`):

```tsx
import { motion } from "motion/react";
import { easeApple } from "./motion";

<motion.div
  initial={{ opacity: 0, y: 16 }}
  whileInView={{ opacity: 1, y: 0 }}
  viewport={{ once: true, margin: "-100px" }}
  transition={{ duration: 0.6, ease: easeApple }}
>
  ...
</motion.div>
```

Reglas simples: anima solo `opacity` y `transform` (nunca `width`/`height`/
`top`/`left`, son costosos), y respeta `prefers-reduced-motion` — el sitio ya
lo hace a nivel global en `colors.css`/`globals.css` (`scroll-behavior: auto`
cuando el usuario lo pide).
