// Ícones de traço (estilo Lucide), 24x24, herdando a cor do texto.
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

function make(paths: React.ReactNode) {
  return function Icon({ size = 16, ...rest }: P) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...rest}
      >
        {paths}
      </svg>
    );
  };
}

export const IconPlus = make(<path d="M12 5v14M5 12h14" />);
export const IconImage = make(
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="9" cy="9" r="2" />
    <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
  </>,
);
export const IconFilm = make(
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M7 3v18M17 3v18M3 7.5h4M3 12h18M3 16.5h4M17 7.5h4M17 16.5h4" />
  </>,
);
export const IconType = make(<path d="M4 7V4h16v3M9 20h6M12 4v16" />);
export const IconClock = make(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </>,
);
export const IconCalendar = make(
  <>
    <rect x="3" y="4" width="18" height="17" rx="2" />
    <path d="M16 2v4M8 2v4M3 10h18" />
  </>,
);
export const IconSquare = make(<rect x="4" y="4" width="16" height="16" rx="3" />);
export const IconCircle = make(<circle cx="12" cy="12" r="8.5" />);
export const IconRing = make(
  <>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
  </>,
);
export const IconBrush = make(
  <>
    <path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08" />
    <path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z" />
  </>,
);
export const IconEraser = make(
  <>
    <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
    <path d="M22 21H7M5 11l9 9" />
  </>,
);
export const IconCursor = make(<path d="m4 4 7.07 17 2.51-7.39L21 11.07z" />);
export const IconEye = make(
  <>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </>,
);
export const IconEyeOff = make(
  <>
    <path d="M9.9 4.24A9 9 0 0 1 12 4c6.5 0 10 7 10 7a17.6 17.6 0 0 1-2.16 3.19M6.6 6.6A17.4 17.4 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6" />
    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24M2 2l20 20" />
  </>,
);
export const IconLock = make(
  <>
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </>,
);
export const IconUnlock = make(
  <>
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 7.9-1" />
  </>,
);
export const IconTrash = make(<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />);
export const IconCopy = make(
  <>
    <rect x="8" y="8" width="13" height="13" rx="2" />
    <path d="M4 16V5a2 2 0 0 1 2-2h11" />
  </>,
);
export const IconUndo = make(<path d="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3" />);
export const IconRedo = make(<path d="m15 14 5-5-5-5M20 9H9a5 5 0 0 0 0 10h3" />);
export const IconPlay = make(<path d="M7 4v16l13-8z" />);
export const IconPause = make(<path d="M8 5v14M16 5v14" />);
export const IconSend = make(<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z" />);
export const IconSave = make(
  <>
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
    <path d="M17 21v-8H7v8M7 3v5h8" />
  </>,
);
export const IconFolder = make(<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />);
export const IconFile = make(
  <>
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
    <path d="M14 3v6h6" />
  </>,
);
export const IconChevronDown = make(<path d="m6 9 6 6 6-6" />);
export const IconGrip = make(
  <>
    <circle cx="9" cy="6" r="1" />
    <circle cx="15" cy="6" r="1" />
    <circle cx="9" cy="12" r="1" />
    <circle cx="15" cy="12" r="1" />
    <circle cx="9" cy="18" r="1" />
    <circle cx="15" cy="18" r="1" />
  </>,
);
export const IconSun = make(
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </>,
);
export const IconX = make(<path d="M18 6 6 18M6 6l12 12" />);
export const IconCheck = make(<path d="M20 6 9 17l-5-5" />);
export const IconAlert = make(
  <>
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    <path d="M12 9v4M12 17h.01" />
  </>,
);
export const IconLayers = make(
  <>
    <path d="m12 2 10 5-10 5L2 7z" />
    <path d="m2 17 10 5 10-5M2 12l10 5 10-5" />
  </>,
);
export const IconAlignCenterH = make(<path d="M12 2v20M7 6h10v4H7zM4 14h16v4H4z" />);
export const IconAlignCenterV = make(<path d="M2 12h20M6 7v10h4V7zM14 4v16h4V4z" />);
export const IconMaximize = make(<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />);
export const IconRotate = make(<path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5" />);
export const IconCpu = make(
  <>
    <rect x="5" y="5" width="14" height="14" rx="2" />
    <path d="M9 9h6v6H9zM9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
  </>,
);
export const IconBackground = make(
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 15l5-5 4 4 3-3 6 6" />
  </>,
);
export const IconMonitor = make(
  <>
    <rect x="3" y="4" width="18" height="13" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </>,
);
export const IconMore = make(
  <>
    <circle cx="5" cy="12" r="1" />
    <circle cx="12" cy="12" r="1" />
    <circle cx="19" cy="12" r="1" />
  </>,
);
export const IconThermometer =make(<path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0z" />);
export const IconUpload =make(<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />);
export const IconEdit = make(<path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />);
export const IconTarget = make(
  <>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="4" strokeDasharray="2 2" />
  </>,
);
