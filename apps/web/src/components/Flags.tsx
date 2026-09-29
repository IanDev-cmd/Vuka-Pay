import { useId } from "react";

export type FlagCode = "UG" | "TZ" | "KE" | "RW";

export function Flag({ code, size = 22 }: { code: FlagCode; size?: number }) {
  const clip = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" aria-hidden="true">
      <defs>
        <clipPath id={clip}>
          <circle cx="11" cy="11" r="11" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        {code === "UG" ? <Uganda /> : null}
        {code === "TZ" ? <Tanzania /> : null}
        {code === "KE" ? <Kenya /> : null}
        {code === "RW" ? <Rwanda /> : null}
      </g>
    </svg>
  );
}

function Uganda() {
  const stripes = ["#000000", "#FCDC04", "#D90000", "#000000", "#FCDC04", "#D90000"];
  return (
    <>
      {stripes.map((fill, index) => (
        <rect key={fill + index} x="0" y={(22 / 6) * index} width="22" height={22 / 6 + 0.2} fill={fill} />
      ))}
      <circle cx="11" cy="11" r="3.1" fill="#fff" />
    </>
  );
}

function Tanzania() {
  return (
    <>
      <rect width="22" height="22" fill="#1EB53A" />
      <polygon points="22,0 22,22 0,22" fill="#00A3DD" />
      <polygon points="0,4.2 17.8,22 22,22 22,17.8 4.2,0 0,0" fill="#FCD116" />
      <polygon points="0,2.2 19.8,22 22,22 22,19.8 2.2,0 0,0" fill="#000" />
    </>
  );
}

function Rwanda() {
  return (
    <>
      <rect width="22" height="7.4" fill="#00A1DE" />
      <rect y="7.4" width="22" height="7.2" fill="#FAD201" />
      <rect y="14.6" width="22" height="7.4" fill="#20603D" />
    </>
  );
}

function Kenya() {
  return (
    <>
      <rect width="22" height="7.2" fill="#000" />
      <rect y="7.2" width="22" height="0.7" fill="#fff" />
      <rect y="7.9" width="22" height="6.2" fill="#BB0000" />
      <rect y="14.1" width="22" height="0.7" fill="#fff" />
      <rect y="14.8" width="22" height="7.2" fill="#006600" />
    </>
  );
}

export function Chevron({ up = false }: { up?: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" style={up ? { transform: "rotate(180deg)" } : undefined}>
      <path d="M2.2 4.4 L6 8.1 L9.8 4.4" fill="none" stroke="#8d9098" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function DownArrow() {
  return (
    <svg width="18" height="16" viewBox="0 0 18 16" aria-hidden="true">
      <path d="M4.25 1.6v8.6" fill="none" stroke="#1c1c1f" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M1.35 7.55 L4.25 11.15 L7.15 7.55" fill="none" stroke="#1c1c1f" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.75 14.4V5.8" fill="none" stroke="#1c1c1f" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M10.85 8.45 L13.75 4.85 L16.65 8.45" fill="none" stroke="#1c1c1f" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
