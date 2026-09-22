/* Satori-safe primitives: every multi-child box is flex; borders must be solid or dashed (satori has no dotted). Site tokens: #fff / #000 / #ebebeb, accent #c6f232. */
import type { CSSProperties, ReactNode } from "react";

export const MONO = "'Sometype Mono'";
export const PX = "'Silkscreen'";
export const ACCENT = "#ccff00";

/** Satori's CSS parser throws on `undefined` values (e.g. `width: w` when w is unset), so strip them. */
const defined = (style?: CSSProperties): CSSProperties =>
  Object.fromEntries(Object.entries(style ?? {}).filter(([, v]) => v !== undefined)) as CSSProperties;

export const Box = ({ style, children }: { style?: CSSProperties; children?: ReactNode }) => (
  <div style={{ display: "flex", ...defined(style) }}>{children}</div>
);

export const Label = ({ children, dim = "#555", size = 13 }: { children: ReactNode; dim?: string; size?: number }) => (
  <div style={{ display: "flex", fontFamily: MONO, fontSize: size, color: dim }}>{children}</div>
);

export const Value = ({ children, size = 38, color = "#000" }: { children: ReactNode; size?: number; color?: string }) => (
  <div style={{ display: "flex", fontFamily: MONO, fontSize: size, fontWeight: 700, lineHeight: 1, color }}>{children}</div>
);

export const Logo = ({ color = "#000", size = 26 }: { color?: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 8 8" shapeRendering="crispEdges">
    <path fill={color} d="M0 0h8v1h-8zM0 1h1v1h-1zM3 1h2v1h-2zM7 1h1v1h-1zM0 2h2v1h-2zM6 2h2v1h-2zM0 3h1v1h-1zM2 3h1v1h-1zM5 3h1v1h-1zM7 3h1v1h-1zM0 4h1v1h-1zM7 4h1v1h-1zM0 5h1v1h-1zM3 5h2v1h-2zM7 5h1v1h-1zM0 6h2v1h-2zM6 6h2v1h-2zM0 7h8v1h-8z" />
  </svg>
);

export const Brand = ({ color = "#000" }: { color?: string }) => (
  <Box style={{ alignItems: "center", gap: 12 }}>
    <Logo color={color} />
    <div style={{ display: "flex", fontFamily: PX, fontSize: 17, letterSpacing: 2, color }}>RARE FRIENDS</div>
  </Box>
);

export const Status = ({ earning, invert = false }: { earning: boolean; invert?: boolean }) => {
  const fg = invert ? "#fff" : "#000";
  return (
    <Box
      style={{
        alignItems: "center",
        gap: 8,
        padding: "7px 14px",
        fontFamily: MONO,
        fontSize: 13,
        color: fg,
        border: earning ? `2px solid ${fg}` : `2px dashed ${fg}`,
      }}
    >
      <div style={{ display: "flex", width: 10, height: 10, border: `2px solid ${fg}`, background: earning ? ACCENT : "transparent" }} />
      <div style={{ display: "flex" }}>{earning ? "earning" : "not earning"}</div>
    </Box>
  );
};

/** On-chain portrait. imageUrl is a data: SVG from the API. */
export const Portrait = ({ src, size }: { src?: string; size: number }) =>
  src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} width={size} height={size} style={{ width: size, height: size, imageRendering: "pixelated" }} />
  ) : (
    <div style={{ display: "flex", width: size, height: size, background: "#fff", border: "2px dashed #000" }} />
  );
