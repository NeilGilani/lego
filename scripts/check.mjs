// Sanity checks for the brick engine: the Eiffel showcase and a sample AI spec must
// produce fully connected models.
import { eiffelModel } from '../public/js/eiffel.js';
import { sanitizeSpec, voxelize } from '../public/js/voxelize.js';

const e = eiffelModel();
console.log(`eiffel: ${e.pieces.length} parts, ${e.steps.length} steps, ${e.floating.length} loose cells dropped`);
if (e.pieces.length < 2000) throw new Error('eiffel model too small');

const rocket = voxelize(sanitizeSpec({ title: 'Rocket', primitives: [
  { name: 'body', shape: 'cylinder', color: 'WHITE', x: 0, z: 0, y: 6, w: 10, d: 10, h: 60 },
  { name: 'nose cone', shape: 'cylinder', color: 'RED', x: 0, z: 0, y: 66, w: 10, d: 10, h: 25, taper: 0 },
  { name: 'window', shape: 'cylinder', axis: 'x', color: 'TLTBLUE', x: 4, z: 0, y: 50, w: 3, d: 4, h: 10 },
  { name: 'fins', shape: 'roof', color: 'RED', x: 0, z: 0, y: 0, w: 20, d: 2, h: 24 },
  { name: 'engine', shape: 'cylinder', color: 'DBG', x: 0, z: 0, y: 0, w: 6, d: 6, h: 6 },
  { name: 'satellite', shape: 'box', color: 'YELLOW', x: 12, z: 0, y: 40, w: 2, d: 2, h: 3 },
] }));
console.log(`rocket: ${rocket.pieces.length} parts, ${rocket.steps.length} steps, ${rocket.supports} support cells, ${rocket.floating.length} loose`);
if (rocket.floating.length > 3) throw new Error('rocket has loose parts');
console.log('ok');
