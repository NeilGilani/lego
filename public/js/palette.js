// Brick colours (BrickLink names + colour IDs) and the parts the engine can use.

export const COLORS = {
  WHITE:    { name: 'White',               bl: 1,   hex: '#F4F4F4' },
  BLACK:    { name: 'Black',               bl: 11,  hex: '#1B2A34' },
  LBG:      { name: 'Light Bluish Gray',   bl: 86,  hex: '#A0A5A9' },
  DBG:      { name: 'Dark Bluish Gray',    bl: 85,  hex: '#6C6E68' },
  RED:      { name: 'Red',                 bl: 5,   hex: '#C91A09' },
  DKRED:    { name: 'Dark Red',            bl: 59,  hex: '#720E0F' },
  ORANGE:   { name: 'Orange',              bl: 4,   hex: '#FE8A18' },
  DKORANGE: { name: 'Dark Orange',         bl: 68,  hex: '#A95500' },
  LTORANGE: { name: 'Bright Light Orange', bl: 110, hex: '#F8BB3D' },
  YELLOW:   { name: 'Yellow',              bl: 3,   hex: '#F2CD37' },
  LTYELLOW: { name: 'Bright Light Yellow', bl: 103, hex: '#FFF03A' },
  LIME:     { name: 'Lime',                bl: 34,  hex: '#BBE90B' },
  GREEN:    { name: 'Green',               bl: 6,   hex: '#237841' },
  DKGREEN:  { name: 'Dark Green',          bl: 80,  hex: '#184632' },
  OLIVE:    { name: 'Olive Green',         bl: 155, hex: '#9B9A5A' },
  SANDGRN:  { name: 'Sand Green',          bl: 48,  hex: '#A0BCAC' },
  BLUE:     { name: 'Blue',                bl: 7,   hex: '#0055BF' },
  DKBLUE:   { name: 'Dark Blue',           bl: 63,  hex: '#0A3463' },
  MAZURE:   { name: 'Medium Azure',        bl: 156, hex: '#36AEBF' },
  DKAZURE:  { name: 'Dark Azure',          bl: 153, hex: '#078BC9' },
  LAVENDER: { name: 'Medium Lavender',     bl: 157, hex: '#AC78BA' },
  MAGENTA:  { name: 'Magenta',             bl: 71,  hex: '#923978' },
  PINK:     { name: 'Bright Pink',         bl: 104, hex: '#E4ADC8' },
  DKPINK:   { name: 'Dark Pink',           bl: 47,  hex: '#C870A0' },
  CORAL:    { name: 'Coral',               bl: 220, hex: '#FF698F' },
  TAN:      { name: 'Tan',                 bl: 2,   hex: '#E4CD9E' },
  DKTAN:    { name: 'Dark Tan',            bl: 69,  hex: '#958A73' },
  LTNOUGAT: { name: 'Light Nougat',        bl: 90,  hex: '#F6D7B3' },
  NOUGAT:   { name: 'Nougat',              bl: 28,  hex: '#D09168' },
  MNOUGAT:  { name: 'Medium Nougat',       bl: 150, hex: '#AA7D55' },
  RBROWN:   { name: 'Reddish Brown',       bl: 88,  hex: '#582A12' },
  DKBROWN:  { name: 'Dark Brown',          bl: 120, hex: '#352100' },
  GOLD:     { name: 'Pearl Gold',          bl: 115, hex: '#AA7F2E' },
  SILVER:   { name: 'Flat Silver',         bl: 95,  hex: '#898788' },
  TCLEAR:   { name: 'Trans-Clear',         bl: 12,  hex: '#DDEEF5', trans: true },
  TLTBLUE:  { name: 'Trans-Light Blue',    bl: 15,  hex: '#AEEFEC', trans: true },
  TRED:     { name: 'Trans-Red',           bl: 17,  hex: '#E02A1A', trans: true },
  TYELLOW:  { name: 'Trans-Yellow',        bl: 19,  hex: '#F5CD2F', trans: true },
};

const PLATE_IDS = {
  '1x1': '3024', '1x2': '3023', '1x3': '3623', '1x4': '3710', '1x6': '3666',
  '1x8': '3460', '1x10': '4477', '1x12': '60479', '2x2': '3022', '2x3': '3021',
  '2x4': '3020', '2x6': '3795', '2x8': '3034',
};
export const PARTS = {
  ROUND1:  { id: '4073',  name: 'Plate, Round 1 x 1',             w: 1, d: 1, h: 1, shape: 'round' },
  RBRICK1: { id: '3062b', name: 'Brick, Round 1 x 1',             w: 1, d: 1, h: 3, shape: 'round' },
  RBRICK2: { id: '3941',  name: 'Brick, Round 2 x 2',             w: 2, d: 2, h: 3, shape: 'round' },
  JUMPER2: { id: '87580', name: 'Plate 2 x 2 with 1 Center Stud', w: 2, d: 2, h: 1, shape: 'jumper' },
};
for (const [k, id] of Object.entries(PLATE_IDS)) {
  const [a, b] = k.split('x').map(Number);
  PARTS['P' + k] = { id, name: `Plate ${a} x ${b}`, w: a, d: b, h: 1, shape: 'box' };
}
export const PLATE_SIZES = Object.keys(PLATE_IDS).map(k => k.split('x').map(Number));

export const BASEPLATES = [
  { size: 16, id: '3867', name: 'Baseplate 16 x 16' },
  { size: 32, id: '3811', name: 'Baseplate 32 x 32' },
  { size: 48, id: '4186', name: 'Baseplate 48 x 48' },
];
export const baseplateFor = n => BASEPLATES.find(b => b.size >= n) || BASEPLATES[2];
