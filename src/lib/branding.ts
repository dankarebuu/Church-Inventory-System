/**
 * Centralized, environment-configurable brand identity for Steward.
 *
 * Self-hosting churches can override these values in `.env` without editing
 * source files:
 *   VITE_APP_NAME="Steward"
 *   VITE_CHURCH_SHORT_NAME="WIN-GMA"
 *   VITE_CHURCH_FULL_NAME="Winners Through God's Mighty Arm Community Church"
 *   VITE_CHURCH_TAGLINE="Your Church, Your Home"
 *   VITE_APP_SUBTITLE="Equipment Ops"
 */

function readEnvString(key: string, fallback: string): string {
  const raw = (import.meta.env as Record<string, unknown> | undefined)?.[key];
  if (typeof raw === 'string' && raw.trim().length > 0) {
    return raw.trim();
  }
  return fallback;
}

function slugifyPrefix(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const appName = readEnvString('VITE_APP_NAME', 'Steward');
const churchShortName = readEnvString('VITE_CHURCH_SHORT_NAME', 'WIN-GMA');
const churchFullName = readEnvString(
  'VITE_CHURCH_FULL_NAME',
  "Winners Through God's Mighty Arm Community Church"
);
const churchTagline = readEnvString('VITE_CHURCH_TAGLINE', 'Your Church, Your Home');
const appSubtitle = readEnvString('VITE_APP_SUBTITLE', 'Equipment Ops');
const adminContact = readEnvString('VITE_ADMIN_CONTACT', 'Dan Caleb');

export const BRAND = {
  appName,
  churchShortName,
  churchFullName,
  churchTagline,
  appSubtitle,
  adminContact,
  /** Clean single-line lockup subtitle: e.g. `WIN-GMA · Equipment Ops` */
  workspaceLabel: `${churchShortName} · ${appSubtitle}`,
  /** Compact uppercase pill label: e.g. `WIN-GMA · EQUIPMENT OPS` */
  eyebrow: `${churchShortName} · ${appSubtitle.toUpperCase()}`,
  /** Full browser & header title: e.g. `Steward — WIN-GMA Equipment Ops` */
  fullTitle: `${appName} — ${churchShortName} ${appSubtitle}`,
  /** Logo alt text: e.g. `WIN-GMA logo` */
  logoAlt: `${churchShortName} logo`,
  /** Download filename prefix: e.g. `steward-win-gma` */
  filePrefix: slugifyPrefix(`${appName}-${churchShortName}`) || 'steward',
} as const;
