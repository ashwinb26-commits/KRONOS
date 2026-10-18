/**
 * The project's own icon set. Six marks, one stroke weight, drawn on a 16px
 * grid so they share an optical size. No icon library and no emoji, which
 * keeps the bundle small and the set internally consistent.
 */

type IconProps = { className?: string };

const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
};

export const ChevronDown = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <path d="M4 6.5 8 10.5 12 6.5" />
  </svg>
);

export const Check = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <path d="M3 8.5 6.5 12 13 4.5" />
  </svg>
);

export const Alert = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <path d="M8 2.5 14.5 13.5h-13z" />
    <path d="M8 6.5v3.5" />
    <path d="M8 12h.01" />
  </svg>
);

export const Info = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 7.5v4M8 5h.01" />
  </svg>
);

export const Copy = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M10.5 3.5h-6a1 1 0 0 0-1 1v6" />
  </svg>
);

export const Download = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <path d="M8 2.5v8" />
    <path d="M4.5 7.5 8 11l3.5-3.5" />
    <path d="M3 13.5h10" />
  </svg>
);

export const External = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <path d="M9 3.5h3.5V7" />
    <path d="M12.5 3.5 7.5 8.5" />
    <path d="M11 10v2.5h-8v-8H6" />
  </svg>
);

export const Close = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);
