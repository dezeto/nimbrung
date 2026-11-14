import QRCode from "qrcode";
import { useMemo } from "react";

// Renders the QR as one SVG path from qrcode's synchronous matrix, so there
// is no async canvas/data-URL step and it stays crisp at any size.
export function QrCode({ value, className }: { value: string; className?: string }) {
  const { size, path } = useMemo(() => {
    const { modules } = QRCode.create(value, { errorCorrectionLevel: "M" });
    let d = "";
    for (let row = 0; row < modules.size; row++) {
      for (let col = 0; col < modules.size; col++) {
        if (modules.get(row, col)) d += `M${col} ${row}h1v1h-1z`;
      }
    }
    return { size: modules.size, path: d };
  }, [value]);

  const quiet = 2; // white margin scanners need around the code
  return (
    <svg
      viewBox={`${-quiet} ${-quiet} ${size + quiet * 2} ${size + quiet * 2}`}
      className={className}
      role="img"
      aria-label={`QR code for ${value}`}
      shapeRendering="crispEdges"
    >
      <rect x={-quiet} y={-quiet} width={size + quiet * 2} height={size + quiet * 2} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
