/**
 * The website designs that ship with the platform. The React code for each design lives in
 * frontend/themes/<id>/ ; this list is what the database is seeded with (prisma/seed.ts) and what the
 * admin gallery shows. Colour keys are shared by every design: primary, dark, accent, light, paint.
 */
export interface ThemeColorSlot {
  key: 'primary' | 'dark' | 'accent' | 'light' | 'paint';
  label: string;
  default: string;
  hint: string;
}

export interface ThemeDefinition {
  id: string;
  name: string;
  description: string;
  style: string;
  version: string;
  colors: ThemeColorSlot[];
}

export const BUILTIN_THEMES: ThemeDefinition[] = [
  {
    id: 'classic',
    name: 'Classic',
    version: '1.0.0',
    style: 'Bright & professional',
    description: 'A clean, traditional dealership layout with a photo hero, quick search, featured vehicles and detailed category pages.',
    colors: [
      { key: 'primary', label: 'Main brand colour', default: '#0057B8', hint: 'Buttons, links and highlights' },
      { key: 'dark', label: 'Dark colour', default: '#062B49', hint: 'Header, footer and dark sections' },
      { key: 'accent', label: 'Accent colour', default: '#22D3EE', hint: 'Small highlights and highlighted words' },
    ],
  },
  {
    id: 'atelier',
    name: 'Atelier',
    version: '1.0.0',
    style: 'Warm & editorial',
    description: 'Warm, editorial design with large serif headlines and a showcase gallery.',
    colors: [
      { key: 'primary', label: 'Main brand colour', default: '#9C5A41', hint: 'Buttons, links and highlights' },
      { key: 'accent', label: 'Accent colour', default: '#D79A78', hint: 'Highlighted words and soft accents' },
      { key: 'dark', label: 'Dark colour', default: '#3B231B', hint: 'Header, footer and dark sections' },
    ],
  },
  {
    id: 'apex-drift',
    name: 'Apex Drift',
    version: '1.0.0',
    style: 'Bold night drive',
    description: 'Bold night-drive design with an animated road scene and glowing sodium-light accents.',
    colors: [
      { key: 'primary', label: 'Main brand colour', default: '#FFB547', hint: 'Buttons and links' },
      { key: 'accent', label: 'Accent colour', default: '#FFB547', hint: 'Highlights, glows and highlighted words' },
      { key: 'dark', label: 'Dark background', default: '#080A16', hint: 'Header, hero and dark sections' },
    ],
  },
  {
    id: 'halcyon',
    name: 'Halcyon',
    version: '1.0.0',
    style: 'Dark showroom',
    description: 'Midnight showroom design: a spot-lit hero car on a glowing turntable, cinematic motion and compact, phone-first pages.',
    colors: [
      { key: 'accent', label: 'Accent colour', default: '#E0212B', hint: 'Buttons, highlights and glows' },
      { key: 'dark', label: 'Dark background', default: '#06080D', hint: 'Hero and dark sections' },
      { key: 'light', label: 'Light background', default: '#F1F0EC', hint: 'Light sections' },
      { key: 'paint', label: 'Showroom glow', default: '#8A0812', hint: 'Colour of the turntable glow' },
    ],
  },
  {
    id: 'vroomfox',
    name: 'VroomFox',
    version: '1.0.0',
    style: 'Friendly & illustrated',
    description: 'Friendly, rounded, illustrated single-page style with playful colours.',
    colors: [
      { key: 'primary', label: 'Main brand colour', default: '#1F7BFF', hint: 'Buttons, links and highlights' },
      { key: 'dark', label: 'Darker shade', default: '#0A5CF0', hint: 'Button hover and dark accents' },
    ],
  },
];
