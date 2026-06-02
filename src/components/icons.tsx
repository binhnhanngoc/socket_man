// Lucide-style inline icons, 1.5px stroke, currentColor. Ported from
// design/icons.jsx — ES exports instead of window globals.

interface IconProps {
  size?: number;
  fill?: string;
  open?: boolean;
  children?: React.ReactNode;
  d?: string;
  [key: string]: unknown;
}

const Ic = ({ d, size = 16, fill, children, ...rest }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={fill || "none"}
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...rest}
  >
    {d ? <path d={d}></path> : children}
  </svg>
);

export const IconChevron = ({ size = 16, open }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ transition: "transform var(--dur-hover) var(--ease)", transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
  >
    <path d="M9 18l6-6-6-6"></path>
  </svg>
);

export const IconFolder = (p: IconProps) => <Ic {...p} d="M4 7a2 2 0 0 1 2-2h3l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7z" />;
export const IconRadio = (p: IconProps) => (
  <Ic {...p}>
    <circle cx="12" cy="12" r="2"></circle>
    <path d="M7.76 16.24a6 6 0 0 1 0-8.48M16.24 7.76a6 6 0 0 1 0 8.48M4.93 19.07a10 10 0 0 1 0-14.14M19.07 4.93a10 10 0 0 1 0 14.14"></path>
  </Ic>
);
export const IconSend = (p: IconProps) => <Ic {...p} d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" />;
export const IconPlus = (p: IconProps) => <Ic {...p} d="M12 5v14M5 12h14" />;
export const IconSearch = (p: IconProps) => (
  <Ic {...p}>
    <circle cx="11" cy="11" r="7"></circle>
    <path d="M21 21l-4.3-4.3"></path>
  </Ic>
);
export const IconArrowUp = (p: IconProps) => <Ic {...p} d="M12 19V5M5 12l7-7 7 7" />;
export const IconArrowDown = (p: IconProps) => <Ic {...p} d="M12 5v14M19 12l-7 7-7-7" />;
export const IconX = (p: IconProps) => <Ic {...p} d="M18 6 6 18M6 6l12 12" />;
export const IconCopy = (p: IconProps) => (
  <Ic {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2"></rect>
    <path d="M5 15V5a2 2 0 0 1 2-2h10"></path>
  </Ic>
);
export const IconTrash = (p: IconProps) => <Ic {...p} d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />;
export const IconSettings = (p: IconProps) => (
  <Ic {...p}>
    <circle cx="12" cy="12" r="3"></circle>
    <path d="M12 2v3M12 19v3M5 5l2 2M17 17l2 2M2 12h3M19 12h3M5 19l2-2M17 7l2-2"></path>
  </Ic>
);
export const IconDots = (p: IconProps) => (
  <Ic {...p}>
    <circle cx="5" cy="12" r="1"></circle>
    <circle cx="12" cy="12" r="1"></circle>
    <circle cx="19" cy="12" r="1"></circle>
  </Ic>
);
export const IconCheck = (p: IconProps) => <Ic {...p} d="M20 6 9 17l-5-5" />;
export const IconBolt = (p: IconProps) => <Ic {...p} d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />;
export const IconPlug = (p: IconProps) => <Ic {...p} d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0V8zM12 17v5" />;
export const IconPause = (p: IconProps) => (
  <Ic {...p}>
    <rect x="6" y="5" width="4" height="14" rx="1"></rect>
    <rect x="14" y="5" width="4" height="14" rx="1"></rect>
  </Ic>
);
export const IconFilter = (p: IconProps) => <Ic {...p} d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />;
export const IconStar = (p: IconProps) => <Ic {...p} d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />;
export const IconClock = (p: IconProps) => (
  <Ic {...p}>
    <circle cx="12" cy="12" r="9"></circle>
    <path d="M12 7v5l3 2"></path>
  </Ic>
);
export const IconGrip = (p: IconProps) => (
  <Ic {...p}>
    <circle cx="9" cy="6" r="1"></circle>
    <circle cx="9" cy="12" r="1"></circle>
    <circle cx="9" cy="18" r="1"></circle>
    <circle cx="15" cy="6" r="1"></circle>
    <circle cx="15" cy="12" r="1"></circle>
    <circle cx="15" cy="18" r="1"></circle>
  </Ic>
);
export const IconList = (p: IconProps) => <Ic {...p} d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />;
export const IconCards = (p: IconProps) => (
  <Ic {...p}>
    <rect x="3" y="4" width="18" height="7" rx="1.5"></rect>
    <rect x="3" y="13" width="18" height="7" rx="1.5"></rect>
  </Ic>
);
export const IconPencil = (p: IconProps) => <Ic {...p} d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />;
export const IconLock = (p: IconProps) => (
  <Ic {...p}>
    <rect x="4.5" y="11" width="15" height="9" rx="2"></rect>
    <path d="M8 11V7a4 4 0 0 1 8 0v4"></path>
  </Ic>
);
export const IconSidebar = (p: IconProps) => (
  <Ic {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2"></rect>
    <path d="M9 4v16"></path>
  </Ic>
);
export const IconGlobe2 = (p: IconProps) => (
  <Ic {...p}>
    <circle cx="12" cy="12" r="9"></circle>
    <path d="M3.5 9h17M3.5 15h17M12 3a13 13 0 0 1 0 18 13 13 0 0 1 0-18z"></path>
  </Ic>
);
