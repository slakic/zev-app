// Small monochrome pictogram icons for the sidebar navigation — plain inline
// SVG (currentColor stroke), no icon library dependency. Each takes an
// optional className so callers control size/spacing.
import type { ReactNode, SVGProps } from "react";

type IconProps = { className?: string };

function IconBase({ children, className }: { children: ReactNode; className?: string }) {
  const svgProps: SVGProps<SVGSVGElement> = {
    viewBox: "0 0 20 20",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  };
  return (
    <svg {...svgProps} className={className ?? "h-5 w-5"} aria-hidden="true">
      {children}
    </svg>
  );
}

export function IconHome(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3 9.5 10 3l7 6.5" />
      <path d="M5 8v8.5h10V8" />
      <path d="M8 16.5v-4.5h4v4.5" />
    </IconBase>
  );
}

export function IconBuilding(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="4" y="3" width="12" height="14" rx="1" />
      <path d="M7 6.5h1.4M11.6 6.5H13M7 9.5h1.4M11.6 9.5H13M7 12.5h1.4M11.6 12.5H13" />
    </IconBase>
  );
}

export function IconUsers(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="7.2" cy="7" r="2.4" />
      <path d="M2.8 16.2c0-2.4 2-4 4.4-4s4.4 1.6 4.4 4" />
      <circle cx="14.2" cy="7.6" r="2" />
      <path d="M12.7 12.4c1.9.3 3.3 1.7 3.5 3.8" />
    </IconBase>
  );
}

export function IconLandmark(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3 7.5 10 3l7 4.5" />
      <path d="M4 8.5h12" />
      <path d="M5.5 8.5V15M9 8.5V15M11 8.5V15M14.5 8.5V15" />
      <path d="M3 17h14" />
    </IconBase>
  );
}

export function IconBallot(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="3.5" y="4" width="13" height="12" rx="1.5" />
      <path d="M6.8 10.2 8.6 12 13 7.6" />
    </IconBase>
  );
}

export function IconReceipt(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M5 3.5h10v12.7l-1.4-.9-1.4.9-1.4-.9-1.4.9-1.4-.9-1.4.9-1.4-.9-1.4.9V3.5Z" />
      <path d="M7 7.3h6M7 10.3h6" />
    </IconBase>
  );
}

export function IconWallet(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="3" y="6" width="14" height="9.5" rx="2" />
      <path d="M3 9.2h14" />
      <circle cx="13.8" cy="12.3" r="0.9" fill="currentColor" stroke="none" />
    </IconBase>
  );
}

export function IconCalendar(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="3.5" y="4.5" width="13" height="12" rx="1.5" />
      <path d="M3.5 8h13" />
      <path d="M7 3v3M13 3v3" />
      <path d="M6.5 11h1.4M9.3 11h1.4M12.1 11h1.4M6.5 13.6h1.4M9.3 13.6h1.4" />
    </IconBase>
  );
}

export function IconWrench(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M13.2 3.8a3.2 3.2 0 0 0-4.3 3.9L4 12.6a1.7 1.7 0 0 0 2.4 2.4l4.9-4.9a3.2 3.2 0 0 0 3.9-4.3l-2 2-1.6-.4-.4-1.6 2-2Z" />
    </IconBase>
  );
}

export function IconDocument(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M6 3h6l3 3v11H6V3Z" />
      <path d="M12 3v3h3" />
      <path d="M8 10h6M8 12.6h6M8 15.2h4" />
    </IconBase>
  );
}

export function IconChart(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 16.5V11M9 16.5V6.5M14 16.5V9" />
      <path d="M3 16.5h14" />
    </IconBase>
  );
}

export function IconSliders(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 6h7M4 10h4M4 14h9" />
      <circle cx="13" cy="6" r="1.4" />
      <circle cx="8" cy="10" r="1.4" />
      <circle cx="15" cy="14" r="1.4" />
    </IconBase>
  );
}

export function IconDot(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="10" cy="10" r="2" fill="currentColor" stroke="none" />
    </IconBase>
  );
}

export function IconChevronLeft(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12.5 5 7 10l5.5 5" />
    </IconBase>
  );
}

/** href -> icon, for the sidebar. Falls back to IconDot for anything unmapped. */
export const NAV_ICONS: Record<string, (props: IconProps) => ReactNode> = {
  "/": IconHome,
  "/zgrade": IconBuilding,
  "/vlasnici": IconUsers,
  "/organi": IconLandmark,
  "/skupstina": IconBallot,
  "/fakture": IconReceipt,
  "/troskovi": IconWallet,
  "/planovi": IconCalendar,
  "/odrzavanje": IconWrench,
  "/dokumenti": IconDocument,
  "/izvjestaji": IconChart,
  "/podesavanja": IconSliders,
};
