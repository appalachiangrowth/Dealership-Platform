/**
 * US spelling for text that comes from the server (design color labels and hints, design descriptions, permission
 * names). Designs installed before the switch to "color" still have "colour" in their stored labels.
 */
export const usSpelling = (s: unknown): string =>
  String(s ?? '')
    .replace(/COLOUR/g, 'COLOR')
    .replace(/Colour/g, 'Color')
    .replace(/colour/g, 'color');
