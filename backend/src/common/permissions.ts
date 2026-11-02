/** Permission catalog and role presets (ported from platform/lib/auth.php). */

export const PERMISSIONS = {
  dashboard: { label: 'Overview', desc: 'See the dashboard, set-up checklist and key numbers.' },
  inventory: { label: 'Vehicles', desc: 'Add, edit, publish and delete vehicles and photos; feeds and lead form.' },
  blog: { label: 'Blog & news', desc: 'Write, edit and publish blog posts and announcements.' },
  leads: { label: 'Leads & inquiries', desc: 'Read customer inquiries, reply by email, change status.' },
  content: { label: 'Website content', desc: 'Edit headlines, about us, reviews and Google titles.' },
  design: { label: 'Design & colours', desc: 'Switch the website design and change brand colours.' },
  business: { label: 'Business details', desc: 'Name, logo, phone, address, opening hours and social links.' },
  settings: { label: 'Email & advanced settings', desc: 'Inquiry email, SMTP, feeds, CarGurus FTP, photo branding.' },
  users: { label: 'Team', desc: 'Add logins and change what each person can do (Dealership admin only).' },
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export type DealerRoleId = 'ADMIN' | 'STAFF' | 'INVENTORY' | 'LEADS' | 'MARKETING' | 'CUSTOM';

export const ROLES: Record<DealerRoleId, { label: string; desc: string; perms: Permission[] }> = {
  ADMIN: { label: 'Dealership admin', desc: 'Everything for this dealership, including the team.', perms: ALL_PERMISSIONS },
  STAFF: { label: 'Sales staff', desc: 'Vehicles and customer inquiries.', perms: ['dashboard', 'inventory', 'leads'] },
  INVENTORY: { label: 'Inventory manager', desc: 'Vehicles only.', perms: ['dashboard', 'inventory'] },
  LEADS: { label: 'Lead manager', desc: 'Customer inquiries only.', perms: ['dashboard', 'leads'] },
  MARKETING: { label: 'Marketing & content', desc: 'Website text, design and blog.', perms: ['dashboard', 'content', 'design', 'blog'] },
  CUSTOM: { label: 'Custom', desc: 'Pick exactly what this person can do.', perms: [] },
};

/** Permissions a CUSTOM user may hold: everything except managing the team. */
export const CUSTOM_ALLOWED: Permission[] = ALL_PERMISSIONS.filter((p) => p !== 'users');

export function cleanPerms(list: unknown): Permission[] {
  if (!Array.isArray(list)) return [];
  const out = new Set<Permission>();
  for (const p of list) if (typeof p === 'string' && (CUSTOM_ALLOWED as string[]).includes(p)) out.add(p as Permission);
  return [...out];
}

export function permsFor(role: DealerRoleId, custom: string[] = []): Permission[] {
  return role === 'CUSTOM' ? cleanPerms(custom) : ROLES[role].perms;
}
