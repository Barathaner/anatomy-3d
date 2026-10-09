#!/usr/bin/env node
/* Bakes the procedural anatomy (js/sdf.js + js/model_*.js) into assets/anatomy.bin.gz.
   Run:  node tools/bake.js        (about 10 s)
   The page loads that file; it only falls back to generating the meshes live if it is missing. */
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');
global.window = globalThis;
const root = path.join(__dirname, '..');
['sdf.js', 'data.js', 'model_bones.js', 'model_soft.js'].forEach(f => (0, eval)(fs.readFileSync(path.join(root, 'js', f), 'utf8')));
const A = globalThis.ANATOMY;

const chunks = [];
let offset = 0;
const pad4 = n => (4 - (n % 4)) % 4;
function push(buf) { const off = offset; chunks.push(buf); offset += buf.length; const p = pad4(buf.length); if (p) { chunks.push(Buffer.alloc(p)); offset += p; } return off; }

const header = { version: 1, parts: [] };
let tris = 0, verts = 0;
const t0 = Date.now();
A.PART_DEFS.forEach(def => {
  (def.sided ? [1, -1] : [0]).forEach(s => {
    const id = def.key + (def.sided ? (s > 0 ? '_l' : '_r') : '');
    const items = A.BUILD[def.key](s).map(it => {
      const g = it.g, nv = g.p.length / 3;
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < g.p.length; i += 3) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], g.p[i + a]); hi[a] = Math.max(hi[a], g.p[i + a]); }
      const q = new Uint16Array(nv * 3);
      for (let i = 0; i < nv; i++) for (let a = 0; a < 3; a++) {
        const span = hi[a] - lo[a] || 1;
        q[i * 3 + a] = Math.round((g.p[i * 3 + a] - lo[a]) / span * 65535);
      }
      const n8 = new Int8Array(nv * 3);
      for (let i = 0; i < nv * 3; i++) n8[i] = Math.max(-127, Math.min(127, Math.round(g.n[i] * 127)));
      const c8 = new Uint8Array(nv * 3);
      for (let i = 0; i < nv * 3; i++) c8[i] = Math.max(0, Math.min(255, Math.round(g.c[i] * 255)));
      const wide = nv > 65535;
      const idx = wide ? Uint32Array.from(g.i) : Uint16Array.from(g.i);
      const asBuf = ta => Buffer.from(ta.buffer, ta.byteOffset, ta.byteLength);
      tris += g.i.length / 3; verts += nv;
      return {
        tone: it.tone || 'main', nv, ni: g.i.length, lo, hi, wide,
        pos: push(asBuf(q)), nrm: push(asBuf(n8)), col: push(asBuf(c8)), idx: push(asBuf(idx))
      };
    });
    header.parts.push({ id, items });
  });
});
const json = Buffer.from(JSON.stringify(header), 'utf8');
const jpad = pad4(json.length);
const head = Buffer.alloc(12);
head.write('ANAT', 0, 'ascii'); head.writeUInt32LE(1, 4); head.writeUInt32LE(json.length + jpad, 8);
const all = Buffer.concat([head, json, Buffer.alloc(jpad, 0x20), ...chunks]);
const gz = zlib.gzipSync(all, { level: 9 });
fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
fs.writeFileSync(path.join(root, 'assets', 'anatomy.bin.gz'), gz);
console.log('baked', header.parts.length, 'parts,', verts, 'verts,', tris, 'tris,',
  (all.length / 1048576).toFixed(1) + ' MB raw,', (gz.length / 1048576).toFixed(1) + ' MB gzip,', ((Date.now() - t0) / 1000).toFixed(1) + ' s');
