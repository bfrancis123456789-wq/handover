// Small inline icon set (stroke icons, 24px grid).
const base = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', viewBox: '0 0 24 24' }
const make = (paths) => function Icon({ className = 'h-5 w-5', ...props }) {
  return <svg {...base} className={className} aria-hidden="true" {...props}>{paths}</svg>
}

export const HomeIcon = make(<><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M10 21v-6h4v6" /></>)
export const HashIcon = make(<><path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" /></>)
export const LockIcon = make(<><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>)
export const UserIcon = make(<><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" /></>)
export const BellIcon = make(<><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" /></>)
export const KeyIcon = make(<><circle cx="8" cy="15" r="4" /><path d="m10.8 12.2 9.2-9.2M16 7l3 3M18 5l2 2" /></>)
export const HelpIcon = make(<><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14" /><path d="M12 17.5h.01" /></>)
export const UsersIcon = make(<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M21.5 20c0-2.8-1.7-4.9-4.2-5.7" /></>)
export const MenuIcon = make(<><path d="M4 6h16M4 12h16M4 18h16" /></>)
export const XIcon = make(<><path d="M18 6 6 18M6 6l12 12" /></>)
export const ImageIcon = make(<><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m21 16-5-5-9 9" /></>)
export const HeartIcon = make(<><path d="M12 20s-7.5-4.6-9.2-9.3C1.7 7.4 4 4.5 7.2 4.5c2 0 3.6 1.1 4.8 2.8 1.2-1.7 2.8-2.8 4.8-2.8 3.2 0 5.5 2.9 4.4 6.2C19.5 15.4 12 20 12 20z" /></>)
export const SendIcon = make(<><path d="M5 12h14M13 6l6 6-6 6" /></>)
export const DownloadIcon = make(<><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></>)
export const CopyIcon = make(<><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></>)
export const RefreshIcon = make(<><path d="M20 11a8 8 0 0 0-14.7-4.3L4 8.5" /><path d="M4 4v4.5h4.5M4 13a8 8 0 0 0 14.7 4.3l1.3-1.8" /><path d="M20 20v-4.5h-4.5" /></>)
export const LogoutIcon = make(<><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H3" /></>)
export const CameraIcon = make(<><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>)
export const ChatIcon = make(<><path d="M4 5h16v11H9l-5 4z" /></>)
