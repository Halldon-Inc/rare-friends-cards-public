import { ImageResponse } from "next/og";

// 180x180 touch icon: the pixel mark on black. iMessage and Safari read this; Slack falls back to it for image-less pages.
export const runtime = "nodejs";
export const dynamic = "force-static";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ display: "flex", width: 180, height: 180, background: "#000", alignItems: "center", justifyContent: "center" }}>
        <svg width="120" height="120" viewBox="0 0 8 8" shapeRendering="crispEdges">
          <path fill="#fff" d="M0 0h8v1h-8zM0 1h1v1h-1zM3 1h2v1h-2zM7 1h1v1h-1zM0 2h2v1h-2zM6 2h2v1h-2zM0 3h1v1h-1zM2 3h1v1h-1zM5 3h1v1h-1zM7 3h1v1h-1zM0 4h1v1h-1zM7 4h1v1h-1zM0 5h1v1h-1zM3 5h2v1h-2zM7 5h1v1h-1zM0 6h2v1h-2zM6 6h2v1h-2zM0 7h8v1h-8z" />
        </svg>
      </div>
    ),
    size
  );
}
