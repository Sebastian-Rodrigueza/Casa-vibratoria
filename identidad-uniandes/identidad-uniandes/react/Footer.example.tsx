"use client";

/**
 * Plantilla de footer institucional, basada en el patrón usado en
 * SinergIA. No la copies tal cual: cambia los valores marcados como
 * "EDITA ESTO" por los de tu propio proyecto.
 *
 * El bloque de texto legal AL FINAL de este archivo es obligatorio en
 * cualquier sitio afiliado a la Universidad de los Andes (manual de
 * identidad, sec. 2.3). Va copiado tal cual, sin parafrasear.
 *
 * Requiere: UniandesLogo.tsx y UnitSignature.tsx en la misma carpeta,
 * Tailwind, y opcionalmente "lucide-react" para los íconos de contacto.
 */

import Link from "next/link";
import { Mail, MapPin } from "lucide-react";
import { UnitSignature } from "./UnitSignature";

// EDITA ESTO: tus propias páginas.
const links = [
  { label: "Inicio", href: "/" },
  { label: "Proyecto", href: "/proyecto" },
];

// EDITA ESTO: correo y ubicación de tu proyecto/grupo.
const CONTACT_EMAIL = "tu-correo@uniandes.edu.co";
const LOCATION = "Depto. de Ingeniería Civil y Ambiental, Universidad de los Andes, Bogotá";

export function Footer() {
  return (
    <footer className="relative bg-background-subtle border-t border-border-soft">
      <div className="max-w-6xl mx-auto px-5 sm:px-8 py-14">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-10">
          <div className="space-y-4">
            {/*
              `levels` sigue el patrón del manual (sec. 4.5.1, p. 42):
              logo + hasta 2 dependencias, cada una con su propia línea
              vertical. Para un laboratorio/proyecto colgado de un
              departamento, el orden es Facultad -> tu unidad (se omite
              el departamento intermedio). EDITA los textos de abajo.
            */}
            <UnitSignature large levels={[["Facultad", "de Ingeniería"], ["Nombre del", "proyecto"]]} />
            <p className="text-sm leading-relaxed text-foreground-secondary max-w-xs">
              {/* EDITA ESTO: una línea describiendo tu proyecto. */}
              Descripción breve de tu proyecto, Departamento de Ingeniería Civil y Ambiental,
              Universidad de los Andes.
            </p>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground-secondary/70 mb-4">
              Navegación
            </h4>
            <ul className="space-y-2.5 text-sm">
              {links.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="text-foreground-secondary hover:text-black transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground-secondary/70 mb-4">
              Contacto
            </h4>
            <ul className="space-y-2.5 text-sm text-foreground-secondary">
              <li className="flex items-center gap-2">
                <Mail className="w-4 h-4 shrink-0" />
                <a
                  href={`mailto:${CONTACT_EMAIL}`}
                  className="hover:text-black transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black"
                >
                  {CONTACT_EMAIL}
                </a>
              </li>
              <li className="flex items-start gap-2">
                <MapPin className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{LOCATION}</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-6 border-t border-border-soft flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-foreground-secondary">
          {/* EDITA ESTO: el nombre de tu proyecto en el copyright. */}
          <span>© {new Date().getFullYear()} Nombre del proyecto · Universidad de los Andes</span>
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className="hover:text-black transition-colors min-h-[32px] flex items-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black cursor-pointer"
          >
            Volver arriba
          </button>
        </div>

        {/*
          Texto legal institucional OBLIGATORIO (manual de identidad,
          sec. 2.3). No lo cambies, no lo quites, no lo resumas.
        */}
        <div className="mt-6 pt-6 border-t border-border-soft text-center text-[11px] leading-relaxed text-foreground-secondary/80">
          <p>Universidad de los Andes | Vigilada Mineducación</p>
          <p>
            Reconocimiento como Universidad: Decreto 1297 del 30 de mayo de 1964. Reconocimiento
            personería jurídica: Resolución 28 del 23 de febrero de 1949 Minjusticia.
          </p>
        </div>
      </div>
    </footer>
  );
}
