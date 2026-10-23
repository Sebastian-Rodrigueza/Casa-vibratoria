"use client";

/**
 * Plantilla de navbar institucional, basada en el patrón usado en
 * SinergIA. No la copies tal cual: cambia PROJECT_NAME y NAV_ITEMS por
 * los de tu propio proyecto.
 *
 * Usa el patrón de "firma de unidad" del manual (sec. 4.5): el logo
 * oficial de la Universidad + una línea vertical + el nombre de tu
 * proyecto en texto plano. Nunca un logo nuevo para tu proyecto/lab
 * (manual, sec. 2.4.2) — ese es justo el problema que esto evita.
 *
 * Requiere: UniandesLogo.tsx en la misma carpeta, Tailwind, y
 * opcionalmente "motion" (framer-motion) y "lucide-react" para las
 * animaciones del menú móvil. Si no los usas, quita esas partes.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { Menu, X } from "lucide-react";
import { UniandesLogo } from "./UniandesLogo";

// EDITA ESTO: nombre de tu proyecto, mostrado junto al logo.
const PROJECT_NAME = "Nombre del proyecto";

// EDITA ESTO: tus propias páginas.
const NAV_ITEMS = [
  { label: "Inicio", href: "/" },
  { label: "Proyecto", href: "/proyecto" },
];

export function Navbar() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", handleScroll);
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-colors duration-300 ${
        scrolled ? "bg-white/80 backdrop-blur-xl border-b border-black/5" : "bg-white/0 border-b border-transparent"
      }`}
    >
      <div className="max-w-7xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
        <Link href="/" className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black">
          <div className="flex items-center gap-3">
            <UniandesLogo className="h-6 sm:h-7 w-auto shrink-0" fill="#1F1F1C" />
            <span className="h-8 sm:h-10 w-px shrink-0 bg-black/20" />
            <span className="text-sm sm:text-[15px] font-semibold text-[#1F1F1C]">{PROJECT_NAME}</span>
          </div>
        </Link>

        <nav className="hidden lg:flex items-center gap-1">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`px-4 py-2 text-[13px] font-medium rounded-full transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black ${
                  isActive ? "text-black bg-black/[0.05]" : "text-foreground-secondary hover:text-black"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <button
          onClick={() => setMobileOpen((v) => !v)}
          className="lg:hidden p-2 rounded-full transition-colors min-h-[40px] min-w-[40px] flex items-center justify-center cursor-pointer text-black hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black"
          aria-label={mobileOpen ? "Cerrar menú" : "Abrir menú"}
          aria-expanded={mobileOpen}
        >
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3 }}
            className="lg:hidden bg-white/95 backdrop-blur-xl border-b border-black/5 overflow-hidden"
          >
            <div className="px-5 sm:px-8 py-4 flex flex-col gap-1">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={`px-3 py-3 rounded-xl text-[15px] font-medium transition-colors min-h-[44px] flex items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black ${
                    pathname === item.href ? "bg-black/[0.05] text-black" : "text-black hover:bg-black/[0.04]"
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
