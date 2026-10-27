/** Minimal 20px line icon set (no icon font, no external requests). */
const paths = {
  home: 'M3 9.5 10 4l7 5.5V16a1 1 0 0 1-1 1h-3.5v-4.5h-5V17H4a1 1 0 0 1-1-1V9.5Z',
  list: 'M7 5h10M7 10h10M7 15h10M3.5 5h.01M3.5 10h.01M3.5 15h.01',
  target: 'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm0-3.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm0-3.5h.01',
  repeat: 'M4 8V7a2 2 0 0 1 2-2h10l-2.5-2.5M16 12v1a2 2 0 0 1-2 2H4l2.5 2.5',
  chart: 'M3 17h14M5.5 14V9M10 14V5M14.5 14v-3',
  bulb: 'M7.5 14.5h5M8 17h4M10 3a5 5 0 0 0-3 9c.6.5 1 1.2 1 2h4c0-.8.4-1.5 1-2a5 5 0 0 0-3-9Z',
  settings:
    'M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM16.2 11.8l1.3 1-1.5 2.6-1.6-.6a6 6 0 0 1-1.6.9L12.5 17.5h-3l-.3-1.8a6 6 0 0 1-1.6-.9l-1.6.6-1.5-2.6 1.3-1a6 6 0 0 1 0-1.8l-1.3-1L6 6.4l1.6.6a6 6 0 0 1 1.6-.9l.3-1.8h3l.3 1.8a6 6 0 0 1 1.6.9l1.6-.6 1.5 2.6-1.3 1a6 6 0 0 1 0 1.8Z',
  plus: 'M10 4v12M4 10h12',
  minus: 'M4 10h12',
  lock: 'M6 9V7a4 4 0 1 1 8 0v2M5 9h10v8H5V9Zm5 3v2',
  unlock: 'M6 9V7a4 4 0 0 1 7.7-1.5M5 9h10v8H5V9Zm5 3v2',
  menu: 'M3 6h14M3 10h14M3 14h14',
  close: 'M5 5l10 10M15 5 5 15',
  edit: 'M12.5 4.5 15.5 7.5M4 16l.8-3.2L13 4.5a1.4 1.4 0 0 1 2 0l.5.5a1.4 1.4 0 0 1 0 2L7.2 15.2 4 16Z',
  trash: 'M4 6h12M8 6V4h4v2M6 6l.7 10h6.6L14 6M8.5 9v4.5M11.5 9v4.5',
  download: 'M10 3v10M6 9l4 4 4-4M4 17h12',
  upload: 'M10 13V3M6 7l4-4 4 4M4 17h12',
  print: 'M6 7V3h8v4M6 14H4V8h12v6h-2M6 12h8v5H6v-5Z',
  chevronLeft: 'M12.5 4.5 7 10l5.5 5.5',
  chevronRight: 'M7.5 4.5 13 10l-5.5 5.5',
  search: 'M9 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12Zm4.5-1.5L17 17',
  phone: 'M7 2.5h6a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1ZM9 15h2',
  shield: 'M10 2.5 16 5v4.5c0 3.8-2.5 6.6-6 8-3.5-1.4-6-4.2-6-8V5l6-2.5Zm-2.5 7.5 1.8 1.8L13 8',
  critical: 'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm0-10v4m0 2.5h.01',
  warning: 'M10 3 2.5 16.5h15L10 3Zm0 5v3.5m0 2.5h.01',
  info: 'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm0-7.5V14m0-7h.01',
  positive: 'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm-3-7 2 2 4-4',
  wallet: 'M3.5 6.5h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-12V6.5Zm0 0V5a1.5 1.5 0 0 1 1.5-1.5h9M13 11.5h.01',
  offline: 'M3 7a10 10 0 0 1 14 0M5.5 9.8a6.5 6.5 0 0 1 9 0M8 12.5a3 3 0 0 1 4 0M10 15.5h.01',
  arrowUp: 'M10 15V5M6 9l4-4 4 4',
  arrowDown: 'M10 5v10M6 11l4 4 4-4',
  trend: 'M3 14.5 7.5 10l3 3L17 6.5M12.5 6.5H17V11',
  flag: 'M5 17.5V3.5M5 4h9.5l-2 3.5 2 3.5H5',
  check: 'M4.5 10.5 8 14l7.5-8',
  circle: 'M10 16.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Z',
  dot: 'M10 16.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Zm0-4a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 20, label }: { name: IconName; size?: number; label?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <path d={paths[name]} />
    </svg>
  );
}
