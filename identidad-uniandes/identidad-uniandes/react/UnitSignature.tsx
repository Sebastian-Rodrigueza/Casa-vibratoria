import { UniandesLogo } from "./UniandesLogo";

/**
 * "Firma de unidad" per the brand manual (sec. 4.5): official logo + a
 * vertical divider + the unit name — the sanctioned way to identify a lab or
 * department, since the manual (sec. 2.4.2) explicitly forbids creating a
 * separate logo for research groups/labs/initiatives.
 *
 * `levels` follows sec. 4.5.1 (p. 42): at most two dependencies after the
 * logo, each behind its own vertical line, and when a lab hangs off a
 * department the department is dropped — so a lab signature reads
 * logo | Facultad | Laboratorio. Each level is given as its lines of text; the
 * first (faculty) is set larger and bolder than the second, as in the manual.
 */
export function UnitSignature({
  dark = false,
  compact = false,
  large = false,
  className,
  unitName = "Laboratorio SinergIA",
  unitSubtitle = "Ingeniería Civil y Ambiental",
  levels,
}: {
  dark?: boolean;
  compact?: boolean;
  /** Taller signature for the footer, where it is the main identity mark. */
  large?: boolean;
  className?: string;
  /** Unit name next to the official logo — override for a sub-section that
   * needs its own identity (e.g. "Infraestructura Visible") without
   * creating a new logo mark (forbidden by manual sec. 2.4.2). */
  unitName?: string;
  unitSubtitle?: string;
  /** Manual-style signature: up to two levels, each an array of text lines. */
  levels?: string[][];
}) {
  const ink = dark ? "text-white" : "text-[#1F1F1C]";
  const rule = dark ? "bg-white/40" : "bg-[#1F1F1C]/60";
  const logoHeight = large ? "h-8 sm:h-10" : "h-6 sm:h-7";

  if (levels && levels.length > 0) {
    return (
      <div
        role="img"
        aria-label={`Universidad de los Andes, ${levels.map((l) => l.join(" ")).join(", ")}`}
        className={`flex items-stretch gap-2.5 sm:gap-3.5 ${className ?? ""}`}
      >
        <UniandesLogo className={`${logoHeight} w-auto shrink-0`} fill={dark ? "#FFFFFF" : "#1F1F1C"} />
        {levels.slice(0, 2).map((lines, i) => (
          <div key={lines.join(" ")} className="flex items-stretch gap-2.5 sm:gap-3.5 shrink-0">
            <span className={`w-px shrink-0 ${rule}`} />
            <span
              className={`flex flex-col justify-center whitespace-nowrap leading-[1.1] ${ink} ${
                i === 0
                  ? `font-bold ${large ? "text-[13px] sm:text-[15px]" : "text-[10px] sm:text-[12px]"}`
                  : `font-medium ${large ? "text-[10.5px] sm:text-[12.5px]" : "text-[9px] sm:text-[10px]"}`
              }`}
            >
              {lines.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-3 ${className ?? ""}`}>
      <UniandesLogo className={`${logoHeight} w-auto shrink-0`} fill={dark ? "#FFFFFF" : "#1F1F1C"} />
      <span className={`${large ? "h-8 sm:h-10" : "h-6 sm:h-7"} w-px shrink-0 ${dark ? "bg-white/30" : "bg-black/20"}`} />
      <span className={`leading-tight ${dark ? "text-white" : "text-[#1F1F1C]"}`}>
        <span className="block text-sm sm:text-[15px] font-semibold">{unitName}</span>
        {!compact && (
          <span className={`block text-[11px] font-normal ${dark ? "text-white/60" : "text-foreground-secondary"}`}>
            {unitSubtitle}
          </span>
        )}
      </span>
    </div>
  );
}
