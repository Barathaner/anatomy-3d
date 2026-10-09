/* Tiny signed-distance-field sculpting kit + naive surface-nets mesher.
   Pure JS (no three.js), so it also runs under Node for testing.
   An "obj" is { f(x,y,z) -> signed distance (negative inside), lo:[x,y,z], hi:[x,y,z] }.
   Meshes are plain objects { p, n, c, uv, i } (typed arrays). */
(function (root) {
  'use strict';
  const INF = 1e6;

  // ---------------------------------------------------------------- noise
  function hash3(x, y, z) {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
  }
  function vnoise(x, y, z) {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    let fx = x - ix, fy = y - iy, fz = z - iz;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
    const a = hash3(ix, iy, iz), b = hash3(ix + 1, iy, iz), c = hash3(ix, iy + 1, iz), d = hash3(ix + 1, iy + 1, iz);
    const e = hash3(ix, iy, iz + 1), f = hash3(ix + 1, iy, iz + 1), g = hash3(ix, iy + 1, iz + 1), h = hash3(ix + 1, iy + 1, iz + 1);
    const x1 = a + (b - a) * fx, x2 = c + (d - c) * fx, x3 = e + (f - e) * fx, x4 = g + (h - g) * fx;
    const y1 = x1 + (x2 - x1) * fy, y2 = x3 + (x4 - x3) * fy;
    return y1 + (y2 - y1) * fz;
  }
  function fbm(x, y, z, oct) {
    let a = 0.5, s = 0, fr = 1;
    for (let i = 0; i < (oct || 3); i++) { s += a * vnoise(x * fr, y * fr, z * fr); a *= 0.5; fr *= 2.03; }
    return s / (1 - Math.pow(0.5, oct || 3)); // ~0..1
  }

  // ---------------------------------------------------------------- helpers
  function rotMat(rx, ry, rz) {
    const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
    return [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
            sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
            -sy, cy * sx, cy * cx];
  }
  const mk = (f, lo, hi) => ({ f, lo, hi });

  // ---------------------------------------------------------------- primitives
  function sphere(c, r) {
    const cx = c[0], cy = c[1], cz = c[2];
    return mk((x, y, z) => { const a = x - cx, b = y - cy, d = z - cz; return Math.sqrt(a * a + b * b + d * d) - r; },
      [cx - r, cy - r, cz - r], [cx + r, cy + r, cz + r]);
  }
  function ell(c, r, rot) {
    const cx = c[0], cy = c[1], cz = c[2], rx = r[0], ry = r[1], rz = r[2];
    const ix = 1 / rx, iy = 1 / ry, iz = 1 / rz, mn = Math.min(rx, ry, rz);
    const R = rot ? rotMat(rot[0] || 0, rot[1] || 0, rot[2] || 0) : null;
    const f = (x, y, z) => {
      let px = x - cx, py = y - cy, pz = z - cz;
      if (R) {
        const qx = R[0] * px + R[3] * py + R[6] * pz, qy = R[1] * px + R[4] * py + R[7] * pz, qz = R[2] * px + R[5] * py + R[8] * pz;
        px = qx; py = qy; pz = qz;
      }
      const ax = px * ix, ay = py * iy, az = pz * iz;
      const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
      const bx = ax * ix, by = ay * iy, bz = az * iz;
      const k1 = Math.sqrt(bx * bx + by * by + bz * bz);
      return k1 < 1e-9 ? -mn : k0 * (k0 - 1) / k1;
    };
    let hx = rx, hy = ry, hz = rz;
    if (R) {
      hx = Math.sqrt((R[0] * rx) ** 2 + (R[1] * ry) ** 2 + (R[2] * rz) ** 2);
      hy = Math.sqrt((R[3] * rx) ** 2 + (R[4] * ry) ** 2 + (R[5] * rz) ** 2);
      hz = Math.sqrt((R[6] * rx) ** 2 + (R[7] * ry) ** 2 + (R[8] * rz) ** 2);
    }
    return mk(f, [cx - hx, cy - hy, cz - hz], [cx + hx, cy + hy, cz + hz]);
  }
  // tapered capsule (round cone) from a to b
  function cap(a, b, r1, r2) {
    if (r2 === undefined) r2 = r1;
    const ax = a[0], ay = a[1], az = a[2];
    const bax = b[0] - ax, bay = b[1] - ay, baz = b[2] - az;
    const l2 = bax * bax + bay * bay + baz * baz;
    const rr = r1 - r2, a2 = l2 - rr * rr, il2 = 1 / l2;
    const R = Math.max(r1, r2);
    const lo = [Math.min(a[0], b[0]) - R, Math.min(a[1], b[1]) - R, Math.min(a[2], b[2]) - R];
    const hi = [Math.max(a[0], b[0]) + R, Math.max(a[1], b[1]) + R, Math.max(a[2], b[2]) + R];
    if (l2 < 1e-12 || a2 <= 1e-12) {
      const big = r1 >= r2 ? sphere(a, r1) : sphere(b, r2);
      return mk(big.f, lo, hi);
    }
    const sgr = Math.sign(rr);
    return mk((x, y, z) => {
      const pax = x - ax, pay = y - ay, paz = z - az;
      const yy = pax * bax + pay * bay + paz * baz, zz = yy - l2;
      const qx = pax * l2 - bax * yy, qy = pay * l2 - bay * yy, qz = paz * l2 - baz * yy;
      const x2 = qx * qx + qy * qy + qz * qz;
      const y2 = yy * yy * l2, z2 = zz * zz * l2;
      const k = sgr * rr * rr * x2;
      if (Math.sign(zz) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
      if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
      return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - r1;
    }, lo, hi);
  }
  // rounded box; h = outer half extents, rnd = corner radius
  function box(c, h, rnd, rot) {
    const cx = c[0], cy = c[1], cz = c[2], rd = rnd || 0;
    const ix = h[0] - rd, iy = h[1] - rd, iz = h[2] - rd;
    const R = rot ? rotMat(rot[0] || 0, rot[1] || 0, rot[2] || 0) : null;
    const f = (x, y, z) => {
      let px = x - cx, py = y - cy, pz = z - cz;
      if (R) {
        const qx = R[0] * px + R[3] * py + R[6] * pz, qy = R[1] * px + R[4] * py + R[7] * pz, qz = R[2] * px + R[5] * py + R[8] * pz;
        px = qx; py = qy; pz = qz;
      }
      const qx = Math.abs(px) - ix, qy = Math.abs(py) - iy, qz = Math.abs(pz) - iz;
      const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
      return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0) - rd;
    };
    const m = Math.max(h[0], h[1], h[2]) * (R ? 1.75 : 1);
    return mk(f, R ? [cx - m, cy - m, cz - m] : [cx - h[0], cy - h[1], cz - h[2]], R ? [cx + m, cy + m, cz + m] : [cx + h[0], cy + h[1], cz + h[2]]);
  }
  // torus with ring axis = local y (rotate with rot)
  function tor(c, Rr, r, rot) {
    const cx = c[0], cy = c[1], cz = c[2];
    const M = rot ? rotMat(rot[0] || 0, rot[1] || 0, rot[2] || 0) : null;
    const f = (x, y, z) => {
      let px = x - cx, py = y - cy, pz = z - cz;
      if (M) {
        const qx = M[0] * px + M[3] * py + M[6] * pz, qy = M[1] * px + M[4] * py + M[7] * pz, qz = M[2] * px + M[5] * py + M[8] * pz;
        px = qx; py = qy; pz = qz;
      }
      const a = Math.sqrt(px * px + pz * pz) - Rr;
      return Math.sqrt(a * a + py * py) - r;
    };
    const m = Rr + r;
    return mk(f, [cx - m, cy - m, cz - m], [cx + m, cy + m, cz + m]);
  }
  // half space: inside where n.p < d
  function plane(n, d) {
    const l = Math.hypot(n[0], n[1], n[2]), nx = n[0] / l, ny = n[1] / l, nz = n[2] / l;
    return mk((x, y, z) => nx * x + ny * y + nz * z - d / l, [-INF, -INF, -INF], [INF, INF, INF]);
  }

  // ---------------------------------------------------------------- combinators
  function boxDist(o, x, y, z) {
    const dx = Math.max(o.lo[0] - x, 0, x - o.hi[0]), dy = Math.max(o.lo[1] - y, 0, y - o.hi[1]), dz = Math.max(o.lo[2] - z, 0, z - o.hi[2]);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  function smooth(k, objs) {
    if (!Array.isArray(objs)) objs = Array.prototype.slice.call(arguments, 1);
    const n = objs.length, fs = objs.map(o => o.f);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    objs.forEach(o => { for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], o.lo[a]); hi[a] = Math.max(hi[a], o.hi[a]); } });
    const k4 = k * 0.25;
    return mk((x, y, z) => {
      let best = INF, first = true;
      for (let i = 0; i < n; i++) {
        const o = objs[i];
        if (!first) {
          const dx = Math.max(o.lo[0] - x, 0, x - o.hi[0]), dy = Math.max(o.lo[1] - y, 0, y - o.hi[1]), dz = Math.max(o.lo[2] - z, 0, z - o.hi[2]);
          if (Math.sqrt(dx * dx + dy * dy + dz * dz) >= best + k) continue;
        }
        const v = fs[i](x, y, z);
        if (first) { best = v; first = false; continue; }
        if (k > 0) {
          const h = Math.max(k - Math.abs(best - v), 0) / k;
          best = Math.min(best, v) - h * h * k4;
        } else if (v < best) best = v;
      }
      return best;
    }, [lo[0] - k, lo[1] - k, lo[2] - k], [hi[0] + k, hi[1] + k, hi[2] + k]);
  }
  const union = function () { return smooth(0, Array.prototype.slice.call(arguments)); };
  function sub(a, b, k) {
    const fa = a.f, fb = b.f;
    if (!k) return mk((x, y, z) => Math.max(fa(x, y, z), -fb(x, y, z)), a.lo, a.hi);
    return mk((x, y, z) => {
      const A = fa(x, y, z), B = -fb(x, y, z);
      const h = Math.max(k - Math.abs(A - B), 0) / k;
      return Math.max(A, B) + h * h * k * 0.25;
    }, a.lo, a.hi);
  }
  function inter(a, b, k) {
    const fa = a.f, fb = b.f;
    const lo = [0, 1, 2].map(i => Math.max(a.lo[i], b.lo[i])), hi = [0, 1, 2].map(i => Math.min(a.hi[i], b.hi[i]));
    if (!k) return mk((x, y, z) => Math.max(fa(x, y, z), fb(x, y, z)), lo, hi);
    return mk((x, y, z) => {
      const A = fa(x, y, z), B = fb(x, y, z);
      const h = Math.max(k - Math.abs(A - B), 0) / k;
      return Math.max(A, B) + h * h * k * 0.25;
    }, lo, hi);
  }
  function offset(a, d) {
    const f = a.f, p = Math.abs(d);
    return mk((x, y, z) => f(x, y, z) - d, [a.lo[0] - p, a.lo[1] - p, a.lo[2] - p], [a.hi[0] + p, a.hi[1] + p, a.hi[2] + p]);
  }
  // hollow shell of given thickness
  function shell(a, t) {
    const f = a.f, h = t / 2;
    return mk((x, y, z) => Math.abs(f(x, y, z)) - h, [a.lo[0] - h, a.lo[1] - h, a.lo[2] - h], [a.hi[0] + h, a.hi[1] + h, a.hi[2] + h]);
  }
  function shift(a, dx, dy, dz) {
    const f = a.f;
    return mk((x, y, z) => f(x - dx, y - dy, z - dz), [a.lo[0] + dx, a.lo[1] + dy, a.lo[2] + dz], [a.hi[0] + dx, a.hi[1] + dy, a.hi[2] + dz]);
  }
  // non-uniform scale about a centre
  function scaleAbout(a, c, sx, sy, sz) {
    const f = a.f, m = Math.min(sx, sy, sz);
    return mk((x, y, z) => f(c[0] + (x - c[0]) / sx, c[1] + (y - c[1]) / sy, c[2] + (z - c[2]) / sz) * m,
      [c[0] + (a.lo[0] - c[0]) * sx, c[1] + (a.lo[1] - c[1]) * sy, c[2] + (a.lo[2] - c[2]) * sz],
      [c[0] + (a.hi[0] - c[0]) * sx, c[1] + (a.hi[1] - c[1]) * sy, c[2] + (a.hi[2] - c[2]) * sz]);
  }
  // smooth value-noise displacement (amp in metres, freq in 1/m)
  function displace(a, amp, freq, oct) {
    const f = a.f, seed = 7.3;
    return mk((x, y, z) => f(x, y, z) + amp * (fbm(x * freq + seed, y * freq, z * freq - seed, oct || 2) * 2 - 1),
      [a.lo[0] - amp, a.lo[1] - amp, a.lo[2] - amp], [a.hi[0] + amp, a.hi[1] + amp, a.hi[2] + amp]);
  }
  // cortex-like folds: thin meandering sulci pushed into the surface
  function folds(a, depth, freq) {
    const f = a.f;
    return mk((x, y, z) => {
      const base = f(x, y, z);
      if (base > 0.02) return base;
      const wx = x * freq, wy = y * freq, wz = z * freq;
      const n = vnoise(wx + 3.1, wy, wz) * 0.78 + vnoise(wx * 2.1, wy * 2.1 + 5, wz * 2.1) * 0.22;
      const ridge = 1 - Math.abs(2 * n - 1);
      const t = Math.min(Math.max((ridge - 0.8) / 0.17, 0), 1);
      return base + depth * t * t * (3 - 2 * t);
    }, a.lo, a.hi);
  }
  // chain of tapered capsules through points
  function chain(pts, radii, k) {
    const parts = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const r1 = Array.isArray(radii) ? radii[i] : radii, r2 = Array.isArray(radii) ? radii[i + 1] : radii;
      parts.push(cap(pts[i], pts[i + 1], r1, r2));
    }
    return smooth(k === undefined ? 0.004 : k, parts);
  }

  // ---------------------------------------------------------------- surface nets mesher
  const CORNERS = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
  const EDGES = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];

  function mesh(obj, cell, o) {
    o = o || {};
    const pad = cell * 2;
    const lx = obj.lo[0] - pad, ly = obj.lo[1] - pad, lz = obj.lo[2] - pad;
    const nx = Math.ceil((obj.hi[0] + pad - lx) / cell) + 1, ny = Math.ceil((obj.hi[1] + pad - ly) / cell) + 1, nz = Math.ceil((obj.hi[2] + pad - lz) / cell) + 1;
    if (nx * ny * nz > 8e6) throw new Error('SDF grid too large: ' + nx + 'x' + ny + 'x' + nz);
    const f = obj.f;
    const vals = new Float32Array(nx * ny * nz);
    let q = 0;
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) vals[q++] = f(lx + i * cell, ly + j * cell, lz + k * cell);
    const cx = nx - 1, cy = ny - 1, cz = nz - 1;
    const vidx = new Int32Array(cx * cy * cz).fill(-1);
    const P = [];
    const sx = nx, sxy = nx * ny;
    const cv = new Float32Array(8);
    for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
      const b = i + sx * j + sxy * k;
      cv[0] = vals[b]; cv[1] = vals[b + 1]; cv[2] = vals[b + 1 + sx]; cv[3] = vals[b + sx];
      cv[4] = vals[b + sxy]; cv[5] = vals[b + 1 + sxy]; cv[6] = vals[b + 1 + sx + sxy]; cv[7] = vals[b + sx + sxy];
      let mask = 0;
      for (let c = 0; c < 8; c++) if (cv[c] < 0) mask |= 1 << c;
      if (mask === 0 || mask === 255) continue;
      let ax = 0, ay = 0, az = 0, cnt = 0;
      for (let e = 0; e < 12; e++) {
        const e0 = EDGES[e][0], e1 = EDGES[e][1];
        const v0 = cv[e0], v1 = cv[e1];
        if ((v0 < 0) === (v1 < 0)) continue;
        const t = v0 / (v0 - v1);
        const c0 = CORNERS[e0], c1 = CORNERS[e1];
        ax += c0[0] + (c1[0] - c0[0]) * t; ay += c0[1] + (c1[1] - c0[1]) * t; az += c0[2] + (c1[2] - c0[2]) * t;
        cnt++;
      }
      vidx[i + cx * (j + cy * k)] = P.length / 3;
      P.push(lx + (i + ax / cnt) * cell, ly + (j + ay / cnt) * cell, lz + (k + az / cnt) * cell);
    }
    const cellAt = (i, j, k) => vidx[i + cx * (j + cy * k)];
    const I = [];
    const quad = (a, b, c, d) => {
      if (a < 0 || b < 0 || c < 0 || d < 0) return;
      const d1 = (P[a * 3] - P[c * 3]) ** 2 + (P[a * 3 + 1] - P[c * 3 + 1]) ** 2 + (P[a * 3 + 2] - P[c * 3 + 2]) ** 2;
      const d2 = (P[b * 3] - P[d * 3]) ** 2 + (P[b * 3 + 1] - P[d * 3 + 1]) ** 2 + (P[b * 3 + 2] - P[d * 3 + 2]) ** 2;
      if (d1 <= d2) I.push(a, b, c, a, c, d); else I.push(b, c, d, b, d, a);
    };
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const v0 = vals[i + sx * j + sxy * k];
      const neg = v0 < 0;
      if (i < nx - 1 && j >= 1 && k >= 1 && j < ny - 1 && k < nz - 1) {
        const v1 = vals[i + 1 + sx * j + sxy * k];
        if (neg !== (v1 < 0)) {
          const a = cellAt(i, j - 1, k - 1), b = cellAt(i, j, k - 1), c = cellAt(i, j, k), d = cellAt(i, j - 1, k);
          if (neg) quad(a, b, c, d); else quad(a, d, c, b);
        }
      }
      if (j < ny - 1 && i >= 1 && k >= 1 && i < nx - 1 && k < nz - 1) {
        const v1 = vals[i + sx * (j + 1) + sxy * k];
        if (neg !== (v1 < 0)) {
          const a = cellAt(i - 1, j, k - 1), b = cellAt(i - 1, j, k), c = cellAt(i, j, k), d = cellAt(i, j, k - 1);
          if (neg) quad(a, b, c, d); else quad(a, d, c, b);
        }
      }
      if (k < nz - 1 && i >= 1 && j >= 1 && i < nx - 1 && j < ny - 1) {
        const v1 = vals[i + sx * j + sxy * (k + 1)];
        if (neg !== (v1 < 0)) {
          const a = cellAt(i - 1, j - 1, k), b = cellAt(i, j - 1, k), c = cellAt(i, j, k), d = cellAt(i - 1, j, k);
          if (neg) quad(a, b, c, d); else quad(a, d, c, b);
        }
      }
    }
    const nv = P.length / 3;
    const p = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3);
    const eps = cell * 0.4;
    for (let v = 0; v < nv; v++) {
      let x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
      let gx, gy, gz, gl;
      const grad = () => {
        gx = f(x + eps, y, z) - f(x - eps, y, z); gy = f(x, y + eps, z) - f(x, y - eps, z); gz = f(x, y, z + eps) - f(x, y, z - eps);
        gl = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
      };
      if (!o.noProject) {
        grad();
        let step = f(x, y, z);
        const lim = cell * 0.7;
        step = Math.max(-lim, Math.min(lim, step));
        x -= gx / gl * step; y -= gy / gl * step; z -= gz / gl * step;
      }
      grad();
      p[v * 3] = x; p[v * 3 + 1] = y; p[v * 3 + 2] = z;
      nrm[v * 3] = gx / gl; nrm[v * 3 + 1] = gy / gl; nrm[v * 3 + 2] = gz / gl;
    }
    return finish({ p, n: nrm, i: Uint32Array.from(I) }, o);
  }

  // colour / uv post-process shared by SDF meshes and sweeps
  function finish(g, o) {
    const nv = g.p.length / 3;
    g.c = new Float32Array(nv * 3).fill(1);
    if (o && typeof o.tint === 'function') {
      for (let v = 0; v < nv; v++) {
        const t = o.tint(g.p[v * 3], g.p[v * 3 + 1], g.p[v * 3 + 2], g.n[v * 3], g.n[v * 3 + 1], g.n[v * 3 + 2]);
        if (typeof t === 'number') { g.c[v * 3] = g.c[v * 3 + 1] = g.c[v * 3 + 2] = t; }
        else { g.c[v * 3] = t[0]; g.c[v * 3 + 1] = t[1]; g.c[v * 3 + 2] = t[2]; }
      }
    }
    if (!g.uv) {
      g.uv = new Float32Array(nv * 2);
      const sc = (o && o.uvScale) || 30;
      if (o && o.axis) {
        const a = o.axis[0], b = o.axis[1];
        let dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
        const dl = Math.hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
        let rx = Math.abs(dy) < 0.9 ? 0 : 1, ry = Math.abs(dy) < 0.9 ? 1 : 0, rz = 0;
        let e1x = ry * dz - rz * dy, e1y = rz * dx - rx * dz, e1z = rx * dy - ry * dx;
        const el = Math.hypot(e1x, e1y, e1z) || 1; e1x /= el; e1y /= el; e1z /= el;
        const e2x = dy * e1z - dz * e1y, e2y = dz * e1x - dx * e1z, e2z = dx * e1y - dy * e1x;
        for (let v = 0; v < nv; v++) {
          const x = g.p[v * 3] - a[0], y = g.p[v * 3 + 1] - a[1], z = g.p[v * 3 + 2] - a[2];
          const along = x * dx + y * dy + z * dz;
          const ang = Math.atan2(x * e2x + y * e2y + z * e2z, x * e1x + y * e1y + z * e1z);
          g.uv[v * 2] = ang * 0.02 * sc * 0.5; g.uv[v * 2 + 1] = along * sc;
        }
      } else {
        for (let v = 0; v < nv; v++) {
          const nx = Math.abs(g.n[v * 3]), ny = Math.abs(g.n[v * 3 + 1]), nz = Math.abs(g.n[v * 3 + 2]);
          const x = g.p[v * 3], y = g.p[v * 3 + 1], z = g.p[v * 3 + 2];
          if (ny >= nx && ny >= nz) { g.uv[v * 2] = x * sc; g.uv[v * 2 + 1] = z * sc; }
          else if (nx >= nz) { g.uv[v * 2] = y * sc; g.uv[v * 2 + 1] = z * sc; }
          else { g.uv[v * 2] = x * sc; g.uv[v * 2 + 1] = y * sc; }
        }
      }
    }
    return g;
  }

  // ---------------------------------------------------------------- sweeps (tubes with variable radius / flat sections)
  function crPoint(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    const out = [0, 0, 0];
    for (let a = 0; a < 3; a++) {
      out[a] = 0.5 * ((2 * p1[a]) + (-p0[a] + p2[a]) * t + (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t2 + (-p0[a] + 3 * p1[a] - 3 * p2[a] + p3[a]) * t3);
    }
    return out;
  }
  function samplePath(points, n) {
    const m = points.length;
    if (m < 2) throw new Error('sweep needs 2+ points');
    const P = points.map(p => [p[0], p[1], p[2]]);
    const dense = [];
    const per = 24;
    for (let s = 0; s < m - 1; s++) {
      const p0 = P[Math.max(s - 1, 0)], p1 = P[s], p2 = P[s + 1], p3 = P[Math.min(s + 2, m - 1)];
      for (let q = 0; q < per; q++) dense.push(crPoint(p0, p1, p2, p3, q / per));
    }
    dense.push(P[m - 1]);
    const cum = [0];
    for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1], dense[i][2] - dense[i - 1][2]));
    const total = cum[cum.length - 1] || 1e-9;
    const out = [];
    let j = 0;
    for (let i = 0; i <= n; i++) {
      const target = total * i / n;
      while (j < cum.length - 2 && cum[j + 1] < target) j++;
      const seg = cum[j + 1] - cum[j] || 1e-9;
      const u = Math.min(Math.max((target - cum[j]) / seg, 0), 1);
      out.push([dense[j][0] + (dense[j + 1][0] - dense[j][0]) * u, dense[j][1] + (dense[j + 1][1] - dense[j][1]) * u, dense[j][2] + (dense[j + 1][2] - dense[j][2]) * u]);
    }
    out.length_ = total;
    return out;
  }
  const norm3 = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  /* o: r (number | fn(t,len)), flat (ellipse ratio), radial, steps, up (fixed reference up for the section),
        round (rounded end caps), tint, vScale */
  function sweep(points, o) {
    o = o || {};
    const N = o.steps || Math.max(10, points.length * 8);
    const M = o.radial || 10;
    const path = samplePath(points, N);
    const L = path.length_;
    const rf = typeof o.r === 'function' ? o.r : () => (o.r === undefined ? 0.005 : o.r);
    const flat = o.flat || 1;
    const p = [], n = [], uv = [], I = [];
    let prevN = null;
    for (let i = 0; i <= N; i++) {
      const a = path[Math.max(i - 1, 0)], b = path[Math.min(i + 1, N)];
      const T = norm3([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
      let ex;
      if (o.up) {
        const u = o.up, d = dot3(u, T);
        ex = [u[0] - d * T[0], u[1] - d * T[1], u[2] - d * T[2]];
        if (Math.hypot(ex[0], ex[1], ex[2]) < 1e-4) ex = Math.abs(T[0]) < 0.9 ? cross3(T, [1, 0, 0]) : cross3(T, [0, 0, 1]);
        ex = norm3(ex);
      } else if (!prevN) {
        const ref = Math.abs(T[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
        const d = dot3(ref, T);
        ex = norm3([ref[0] - d * T[0], ref[1] - d * T[1], ref[2] - d * T[2]]);
      } else {
        const d = dot3(prevN, T);
        ex = norm3([prevN[0] - d * T[0], prevN[1] - d * T[1], prevN[2] - d * T[2]]);
      }
      prevN = ex;
      const ey = cross3(T, ex);
      const t = i / N;
      let r = rf(t, L);
      if (o.round) {
        const e = Math.min(t, 1 - t) * L / Math.max(r, 1e-4);
        if (e < 1) r *= Math.sqrt(Math.max(1 - (1 - e) * (1 - e), 0.0004));
      }
      const c = path[i];
      for (let k = 0; k < M; k++) {
        const th = (k / M) * Math.PI * 2, ct = Math.cos(th), st = Math.sin(th);
        p.push(c[0] + r * (ct * ex[0] + st * flat * ey[0]), c[1] + r * (ct * ex[1] + st * flat * ey[1]), c[2] + r * (ct * ex[2] + st * flat * ey[2]));
        const nn = norm3([ct * ex[0] + st / flat * ey[0], ct * ex[1] + st / flat * ey[1], ct * ex[2] + st / flat * ey[2]]);
        n.push(nn[0], nn[1], nn[2]);
        uv.push(k / M * 2, t * L * (o.vScale || 40));
      }
    }
    for (let i = 0; i < N; i++) for (let k = 0; k < M; k++) {
      const a = i * M + k, b = i * M + (k + 1) % M, c = (i + 1) * M + k, d = (i + 1) * M + (k + 1) % M;
      I.push(a, b, c, b, d, c);
    }
    // end caps
    const capEnd = (ring, tx, ty, tz, flip) => {
      const base = p.length / 3;
      const c = path[ring === 0 ? 0 : N];
      p.push(c[0], c[1], c[2]); n.push(tx, ty, tz); uv.push(0, 0);
      for (let k = 0; k < M; k++) {
        const a = ring * M + k, b = ring * M + (k + 1) % M;
        if (flip) I.push(base, a, b); else I.push(base, b, a);
      }
    };
    {
      const a0 = path[0], a1 = path[1], b0 = path[N - 1], b1 = path[N];
      const T0 = norm3([a1[0] - a0[0], a1[1] - a0[1], a1[2] - a0[2]]), T1 = norm3([b1[0] - b0[0], b1[1] - b0[1], b1[2] - b0[2]]);
      capEnd(0, -T0[0], -T0[1], -T0[2], false);
      capEnd(N, T1[0], T1[1], T1[2], true);
    }
    const g = { p: Float32Array.from(p), n: Float32Array.from(n), uv: Float32Array.from(uv), i: Uint32Array.from(I) };
    return finish(g, o);
  }

  function merge(list) {
    list = list.filter(Boolean);
    let nv = 0, ni = 0;
    list.forEach(g => { nv += g.p.length / 3; ni += g.i.length; });
    const out = { p: new Float32Array(nv * 3), n: new Float32Array(nv * 3), c: new Float32Array(nv * 3), uv: new Float32Array(nv * 2), i: new Uint32Array(ni) };
    let vo = 0, io = 0;
    list.forEach(g => {
      out.p.set(g.p, vo * 3); out.n.set(g.n, vo * 3); out.c.set(g.c, vo * 3); out.uv.set(g.uv, vo * 2);
      for (let i = 0; i < g.i.length; i++) out.i[io + i] = g.i[i] + vo;
      vo += g.p.length / 3; io += g.i.length;
    });
    return out;
  }

  root.SDF = { vnoise, fbm, rotMat, sphere, ell, cap, box, tor, plane, smooth, union, sub, inter, offset, shell, shift, scaleAbout, displace, folds, chain, mesh, sweep, merge, samplePath, boxDist };
})(typeof window !== 'undefined' ? window : globalThis);
