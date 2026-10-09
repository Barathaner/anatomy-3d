/* Sculpted skeleton. Coordinates: metres, +y up, +z front, anatomical LEFT = +x.
   Builders: (s) => [ { g: mesh, tone?: 'tendon' | 'cartilage' | ... } ]  with s = +1 left, -1 right, 0 midline. */
(function () {
  'use strict';
  const S = window.SDF, A = window.ANATOMY;
  const { ell, cap, box, tor, plane, smooth, sub, inter, shift, displace, chain, mesh, sweep, merge } = S;
  const sph = (c, r) => S.sphere(c, r);
  const spineZ = y => -0.05 + 0.02 * Math.cos((y - 1.1) * 10);

  // shared helpers for the other model files
  const H = A.H = {
    spineZ,
    boneTint: (x, y, z) => {
      const n = S.vnoise(x * 170 + 3, y * 170, z * 170 - 5), m = S.vnoise(x * 40, y * 40 + 9, z * 40);
      const v = 0.86 + 0.1 * n + 0.06 * m;
      return [v, v * 0.985, v * 0.95];
    },
    mott: (amt, fr) => (x, y, z) => 1 - amt * S.vnoise(x * fr + 11.7, y * fr, z * fr - 4.2),
    out: (g, tone) => ({ g, tone })
  };
  H.Q = { bone: 1.3, muscle: 1.9 };
  const bone = (obj, cell, o) => H.out(mesh(displace(obj, 0.0005, 260, 2), cell * H.Q.bone, Object.assign({ tint: H.boneTint, uvScale: 40 }, o)));
  const B = A.BUILD = A.BUILD || {};

  // ------------------------------------------------------------------ head
  B.skull = () => {
    const cran = smooth(0.02, [
      ell([0, 1.692, -0.004], [0.076, 0.082, 0.095]),
      ell([0, 1.658, -0.046], [0.066, 0.066, 0.056]),
      ell([0, 1.668, 0.04], [0.068, 0.07, 0.058])
    ]);
    const parts = [cran,
      ell([0, 1.608, 0.064], [0.056, 0.056, 0.04]),
      box([0, 1.585, 0.064], [0.037, 0.024, 0.03], 0.01),
      ell([0.052, 1.618, 0.068], [0.024, 0.019, 0.017]), ell([-0.052, 1.618, 0.068], [0.024, 0.019, 0.017]),
      cap([-0.052, 1.652, 0.087], [0.052, 1.652, 0.087], 0.009),
      cap([0, 1.652, 0.09], [0, 1.612, 0.101], 0.006),
      sph([0.063, 1.592, -0.02], 0.011), sph([-0.063, 1.592, -0.02], 0.011)
    ];
    [1, -1].forEach(s => {
      parts.push(chain([[s * 0.054, 1.62, 0.066], [s * 0.078, 1.626, 0.02], [s * 0.075, 1.632, -0.026]], 0.0058, 0.004));
    });
    let o = smooth(0.012, parts);
    o = S.inter(o, plane([0, -1, 0], -1.552));
    [1, -1].forEach(s => { o = sub(o, sph([s * 0.034, 1.638, 0.081], 0.0195), 0.004); });
    o = sub(o, ell([0, 1.597, 0.101], [0.011, 0.017, 0.02]), 0.003);
    o = sub(o, ell([0, 1.552, -0.025], [0.013, 0.02, 0.016]));
    return [bone(o, 0.0032)];
  };
  B.mandible = () => {
    const parts = [sph([0, 1.552, 0.079], 0.012)];
    [1, -1].forEach(s => {
      parts.push(chain([[s * 0.058, 1.628, -0.012], [s * 0.053, 1.573, -0.003], [s * 0.044, 1.556, 0.04], [s * 0.021, 1.55, 0.07], [0, 1.549, 0.079]], [0.007, 0.0078, 0.0085, 0.0085, 0.009], 0.004));
      parts.push(cap([s * 0.057, 1.618, 0.0], [s * 0.054, 1.652, 0.02], 0.0055, 0.003));
      parts.push(ell([s * 0.06, 1.632, -0.012], [0.0085, 0.006, 0.0055]));
      parts.push(chain([[s * 0.046, 1.566, 0.036], [s * 0.022, 1.561, 0.066], [0, 1.559, 0.076]], 0.0048, 0.003));
    });
    return [bone(smooth(0.005, parts), 0.0022)];
  };
  B.teeth = () => {
    const parts = [];
    const angles = [0.12, 0.34, 0.58, 0.82, 1.04, 1.28, 1.5, 1.68];
    const kinds = [[0.0043, 0.0066, 0.0028], [0.0036, 0.0062, 0.0028], [0.0042, 0.0068, 0.0036], [0.0048, 0.0052, 0.0042], [0.0048, 0.005, 0.0042], [0.0062, 0.005, 0.0052], [0.0066, 0.005, 0.0054], [0.006, 0.0046, 0.005]];
    [[1.5815, 1], [1.5665, 0.9]].forEach(([y, sc]) => {
      [1, -1].forEach(s => angles.forEach((a, i) => {
        const x = s * 0.027 * sc * Math.sin(a), z = 0.043 + 0.034 * Math.cos(a) * sc - 0.012 * (a / 1.7) * (a / 1.7);
        const r = kinds[i];
        parts.push(ell([x, y, z], r, [0, -s * a * 0.9, 0]));
      }));
    });
    return [H.out(mesh(smooth(0.0006, parts), 0.0012, { tint: S.vnoise ? ((x, y, z) => 0.94 + 0.06 * S.vnoise(x * 400, y * 400, z * 400)) : 1 }))];
  };

  // ------------------------------------------------------------------ spine
  function vertebra(y, o) {
    const sc = o.sc, bw = o.bw, bh = o.bh, bd = o.bd, z = spineZ(y);
    const parts = [];
    const archZ = z - bd - 0.011 * sc;
    if (!o.atlas) parts.push(ell([0, y, z], [bw, bh, bd]));
    if (o.atlas) {
      parts.push(tor([0, y, z - 0.006], 0.021, 0.0058));
      parts.push(ell([0.017, y, z - 0.006], [0.01, 0.007, 0.01]), ell([-0.017, y, z - 0.006], [0.01, 0.007, 0.01]));
    } else {
      [1, -1].forEach(s => {
        parts.push(cap([s * bw * 0.55, y, z - bd * 0.5], [s * bw * 0.82, y + 0.0008, archZ], 0.0042 * sc));
        parts.push(cap([s * bw * 0.82, y + 0.0015, archZ], [s * 0.003, y + 0.003, archZ - 0.011 * sc], 0.0036 * sc));
        parts.push(cap([s * bw * 0.82, y + 0.0015, archZ], [s * (bw * 0.82 + o.tlen), y + 0.0015, archZ - 0.004 * sc], 0.0042 * sc, 0.0036 * sc));
        parts.push(sph([s * bw * 0.72, y + bh + 0.0018, archZ + 0.003], 0.0036 * sc));
      });
    }
    parts.push(cap([0, y + 0.003, archZ - 0.008 * sc], [0, y + o.sdy, archZ - 0.008 * sc - o.slen], 0.0036 * sc, 0.0030 * sc));
    if (o.dens) parts.push(cap([0, y + bh * 0.8, z], [0, y + bh + 0.016, z + 0.002], 0.0052, 0.0044));
    return smooth(0.003 * sc + 0.0006, parts);
  }
  function spineSet(kind) {
    const list = [];
    if (kind === 'cervical') {
      for (let i = 0; i < 7; i++) {
        const y = 1.545 - i * 0.0135, f = i / 6;
        list.push(vertebra(y, { sc: 0.8 + 0.12 * f, bw: 0.0125 + 0.004 * f, bh: 0.0052, bd: 0.0105 + 0.002 * f, tlen: 0.013 + 0.004 * f, sdy: -0.002, slen: 0.01 + 0.01 * f, atlas: i === 0, dens: i === 1 }));
      }
    } else if (kind === 'thoracic') {
      for (let i = 0; i < 12; i++) {
        const y = 1.445 - i * 0.0215, f = i / 11;
        list.push(vertebra(y, { sc: 1.0 + 0.16 * f, bw: 0.0165 + 0.005 * f, bh: 0.0088, bd: 0.0135 + 0.003 * f, tlen: 0.02, sdy: -0.009, slen: 0.019 }));
      }
    } else {
      for (let i = 0; i < 5; i++) {
        const y = 1.185 - i * 0.0305;
        list.push(vertebra(y, { sc: 1.35 + 0.05 * i, bw: 0.026 + 0.001 * i, bh: 0.0125, bd: 0.0195, tlen: 0.022, sdy: -0.001, slen: 0.02 }));
      }
    }
    return smooth(0.002, list);
  }
  B.cervical = () => [bone(spineSet('cervical'), 0.0022)];
  B.thoracic = () => [bone(spineSet('thoracic'), 0.0028)];
  B.lumbar = () => [bone(spineSet('lumbar'), 0.0028)];
  B.discs = () => {
    const list = [];
    const add = (y0, y1, bw, bd) => { const y = (y0 + y1) / 2, z = spineZ(y); list.push(ell([0, y, z], [bw, Math.max((y0 - y1) / 2 - 0.0032, 0.001) + 0.0012, bd])); };
    for (let i = 0; i < 6; i++) { const y = 1.545 - i * 0.0135; add(y - 0.0046, y - 0.0135 + 0.0046, 0.0155 + 0.0006 * i, 0.0125); }
    add(1.4635 - 0.0046, 1.445 + 0.0088, 0.0195, 0.0145);
    for (let i = 0; i < 11; i++) { const y = 1.445 - i * 0.0215; add(y - 0.0088, y - 0.0215 + 0.0088, 0.019 + 0.0004 * i, 0.0145 + 0.0003 * i); }
    add(1.445 - 11 * 0.0215 - 0.0088, 1.185 + 0.0125, 0.023, 0.017);
    for (let i = 0; i < 4; i++) { const y = 1.185 - i * 0.0305; add(y - 0.0125, y - 0.0305 + 0.0125, 0.027, 0.0195); }
    add(1.185 - 4 * 0.0305 - 0.0125, 1.04, 0.028, 0.02);
    return [H.out(mesh(smooth(0.001, list), 0.0026, { tint: H.mott(0.12, 90), uvScale: 40 }))];
  };
  B.sacrum = () => {
    const pts = [[0, 1.036, spineZ(1.04) + 0.002], [0, 1.0, -0.055], [0, 0.958, -0.058], [0, 0.924, -0.05]];
    const parts = [chain(pts, [0.04, 0.034, 0.024, 0.012], 0.01), ell([0, 1.035, -0.052], [0.05, 0.016, 0.026])];
    [1, -1].forEach(s => parts.push(ell([s * 0.045, 1.02, -0.05], [0.022, 0.025, 0.02], [0, 0, -s * 0.3])));
    let o = smooth(0.01, parts);
    [1, -1].forEach(s => [1.012, 0.986, 0.962, 0.94].forEach((y, i) => { o = sub(o, sph([s * (0.019 - i * 0.002), y, -0.036 - i * 0.005], 0.0052)); }));
    o = sub(o, ell([0, 0.99, -0.07], [0.009, 0.05, 0.012])); // sacral canal
    return [bone(o, 0.0026)];
  };
  B.coccyx = () => [bone(chain([[0, 0.922, -0.05], [0, 0.903, -0.045], [0, 0.887, -0.035], [0, 0.876, -0.026]], [0.009, 0.0075, 0.006, 0.0035], 0.002), 0.0016)];

  // ------------------------------------------------------------------ thorax
  function ribPoints(i, s, phiEnd) {
    const yb = 1.425 - i * 0.0235;
    const a = 0.078 + 0.085 * Math.sin(Math.PI * (i + 1.5) / 13);
    const zBack = spineZ(yb) + 0.012, zFront = 0.092;
    const zc = (zBack + zFront) / 2, b = (zFront - zBack) / 2, drop = 0.035 + 0.0025 * i;
    const pts = [[s * 0.022, yb + 0.006, zBack - 0.018]];
    for (let k = 0; k <= 10; k++) {
      const phi = 0.22 + (phiEnd - 0.22) * k / 10;
      pts.push([s * a * Math.sin(phi), yb - drop * Math.pow(phi / Math.PI, 1.2), zc - b * Math.cos(phi)]);
    }
    return pts;
  }
  const phiEndFor = i => (i < 7 ? Math.PI - 0.62 : i < 10 ? Math.PI - 0.8 : Math.PI * 0.56);
  H.ribPoints = ribPoints; H.phiEndFor = phiEndFor;
  B.hyoid = () => [bone(chain([[-0.021, 1.575, 0.018], [-0.014, 1.572, 0.033], [0.014, 1.572, 0.033], [0.021, 1.575, 0.018]], 0.0036, 0.003), 0.0015)];
  B.ribs = s => {
    const gs = [];
    for (let i = 0; i < 12; i++) {
      gs.push(sweep(ribPoints(i, s, phiEndFor(i)), {
        r: t => 0.0042 * (1 + 0.28 * Math.sin(Math.PI * Math.min(1, t * 1.6))) * (i > 9 ? 0.75 : 1), flat: 0.5, up: [0, 1, 0], radial: 10, steps: 34, round: true, tint: H.boneTint
      }));
    }
    return [H.out(merge(gs))];
  };
  B.costal = s => {
    const gs = [];
    for (let i = 0; i < 10; i++) {
      const pe = ribPoints(i, s, phiEndFor(i)), e = pe[pe.length - 1];
      let tgt;
      if (i < 7) tgt = [s * 0.019, 1.425 - i * 0.0275, 0.1];
      else tgt = [s * (0.045 + 0.01 * (i - 7)), 1.255 - (i - 7) * 0.012, 0.102];
      const mid = [(e[0] + tgt[0]) / 2, (e[1] + tgt[1]) / 2 + 0.006, (e[2] + tgt[2]) / 2 + 0.006];
      gs.push(sweep([e, mid, tgt], { r: 0.0043, flat: 0.55, up: [0, 1, 0], radial: 8, steps: 12, round: true, tint: H.mott(0.08, 120) }));
    }
    return [H.out(merge(gs), 'cartilage')];
  };
  B.sternum = () => {
    let o = smooth(0.012, [
      ell([0, 1.425, 0.093], [0.027, 0.02, 0.0085], [-0.25, 0, 0]),
      ell([0, 1.33, 0.1], [0.0175, 0.082, 0.0075], [-0.1, 0, 0]),
      cap([0, 1.245, 0.103], [0, 1.213, 0.1], 0.006, 0.003)
    ]);
    o = sub(o, sph([0, 1.449, 0.088], 0.008), 0.004);
    o = sub(o, sph([0.027, 1.437, 0.09], 0.0065)); o = sub(o, sph([-0.027, 1.437, 0.09], 0.0065));
    return [bone(o, 0.0018)];
  };

  // ------------------------------------------------------------------ shoulder girdle and arm
  B.clavicle = s => {
    const P = (x, y, z) => [s * x, y, z];
    return [bone(chain([P(0.02, 1.466, 0.091), P(0.058, 1.478, 0.086), P(0.108, 1.476, 0.058), P(0.15, 1.462, 0.04), P(0.192, 1.455, 0.024)], [0.0095, 0.0068, 0.0062, 0.0066, 0.0055], 0.004), 0.0018)];
  };
  B.scapula = s => {
    const P = (x, y, z) => [s * x, y, z];
    const R = (a, b, c) => [a, s * b, s * c];
    let o = smooth(0.014, [
      ell(P(0.098, 1.4, -0.098), [0.03, 0.022, 0.006], R(0, -0.35, 0.25)),
      ell(P(0.112, 1.32, -0.092), [0.022, 0.036, 0.006], R(0, -0.4, -0.12)),
      ell(P(0.15, 1.375, -0.07), [0.02, 0.034, 0.0065], R(0, -0.7, 0.12)),
      cap(P(0.078, 1.412, -0.1), P(0.188, 1.452, -0.034), 0.0068, 0.0058),
      ell(P(0.19, 1.456, -0.022), [0.021, 0.0055, 0.016], R(0, -0.2, 0)),
      cap(P(0.172, 1.425, -0.012), P(0.186, 1.432, 0.034), 0.0068, 0.0045),
      ell(P(0.188, 1.4, -0.026), [0.0085, 0.019, 0.013], R(0, -0.6, 0.2))
    ]);
    return [bone(o, 0.0022)];
  };
  B.humerus = s => {
    const P = (x, y, z) => [s * x, y, z];
    const parts = [
      sph(P(0.2, 1.435, 0.0), 0.0225),
      chain([P(0.205, 1.418, 0.0), P(0.228, 1.3, -0.004), P(0.246, 1.19, -0.005)], [0.0125, 0.0115, 0.0125], 0.006),
      sph(P(0.214, 1.438, 0.013), 0.0105),
      sph(P(0.228, 1.342, 0.008), 0.0072),
      sph(P(0.248, 1.14, 0.008), 0.0125), sph(P(0.255, 1.138, -0.006), 0.0115),
      sph(P(0.232, 1.158, -0.012), 0.0092), sph(P(0.272, 1.152, 0.0), 0.0085)
    ];
    let o = smooth(0.006, parts);
    o = sub(o, sph(P(0.252, 1.143, -0.021), 0.0085), 0.003);
    return [bone(o, 0.0022)];
  };
  B.radius = s => {
    const P = (x, y, z) => [s * x, y, z];
    const o = smooth(0.004, [
      ell(P(0.26, 1.15, 0.01), [0.0105, 0.0042, 0.0105]),
      chain([P(0.263, 1.14, 0.012), P(0.282, 1.03, 0.032), P(0.304, 0.918, 0.05)], [0.0058, 0.0072, 0.0098], 0.004),
      sph(P(0.31, 0.903, 0.05), 0.0075)
    ]);
    return [bone(o, 0.0018)];
  };
  B.ulna = s => {
    const P = (x, y, z) => [s * x, y, z];
    const o = smooth(0.004, [
      sph(P(0.248, 1.164, -0.018), 0.0115),
      chain([P(0.247, 1.148, -0.014), P(0.262, 1.095, -0.012), P(0.28, 1.0, 0.012), P(0.292, 0.918, 0.026)], [0.0095, 0.0078, 0.0064, 0.0055], 0.004),
      sph(P(0.292, 0.905, 0.026), 0.0072)
    ]);
    return [bone(o, 0.0018)];
  };
  B.hand = s => {
    const P = (x, y, z) => [s * x, y, z];
    const parts = [];
    for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) parts.push(ell(P(0.289 + c * 0.0086 + r * 0.002, 0.893 - r * 0.011, 0.043 + 0.002 * r), [0.0058, 0.0052, 0.0054]));
    const finger = (x0, y0, x1, lens, rr) => {
      let x = x0, y = y0;
      parts.push(cap(P(x0 + 0.0, 0.882, 0.047), P(x1, y0, 0.049), rr * 1.05, rr));
      for (let k = 0; k < lens.length; k++) {
        const nx = x + (x1 - x0) * 0.25 * (k + 1) * 0.3, ny = y - lens[k];
        parts.push(cap(P(x, y, 0.049), P(nx, ny, 0.051 + 0.002 * k), rr * (1 - 0.1 * k), rr * (0.9 - 0.1 * k)));
        parts.push(sph(P(nx, ny, 0.051 + 0.002 * k), rr * (0.95 - 0.1 * k)));
        x = nx; y = ny;
      }
    };
    // index -> little (lateral to medial for left hand: x decreasing), thumb on +x side
    finger(0.309, 0.842, 0.31, [0.032, 0.02, 0.017], 0.0039);
    finger(0.3, 0.84, 0.3, [0.036, 0.023, 0.018], 0.004);
    finger(0.291, 0.842, 0.29, [0.033, 0.021, 0.017], 0.0038);
    finger(0.282, 0.849, 0.28, [0.026, 0.016, 0.015], 0.0034);
    // thumb
    parts.push(chain([P(0.3, 0.884, 0.05), P(0.322, 0.862, 0.058), P(0.334, 0.835, 0.062), P(0.341, 0.815, 0.064), P(0.346, 0.797, 0.065)], [0.0045, 0.0048, 0.0043, 0.0038, 0.0032], 0.0015));
    return [bone(smooth(0.0015, parts), 0.0015)];
  };

  // ------------------------------------------------------------------ pelvis and leg
  B.hip = s => {
    const P = (x, y, z) => [s * x, y, z];
    const R = (a, b, c) => [a, s * b, s * c];
    // wedge-shaped blade: keep the part of an ellipse that lies between two edges meeting at the acetabulum
    const edge = (ax, ay, bx, by, outward) => {
      const dx = bx - ax, dy = by - ay;
      let nx = dy, ny = -dx;
      if (!outward) { nx = -nx; ny = -ny; }
      const nxs = s * nx;
      return S.plane([nxs, ny, 0], nxs * s * ax + ny * ay);
    };
    let blade = ell(P(0.114, 1.03, -0.008), [0.076, 0.062, 0.0115], R(0, -0.5, 0.2));
    blade = inter(blade, edge(0.092, 0.945, 0.178, 1.07, true));   // lateral edge
    blade = inter(blade, edge(0.092, 0.945, 0.046, 1.075, false)); // medial edge
    const parts = [
      blade,
      chain([P(0.05, 1.07, -0.05), P(0.104, 1.082, -0.022), P(0.15, 1.066, 0.026), P(0.166, 1.05, 0.048)], 0.0072, 0.004),
      sph(P(0.168, 1.048, 0.05), 0.0108), sph(P(0.066, 1.056, -0.054), 0.0092),
      ell(P(0.088, 0.99, -0.01), [0.026, 0.05, 0.015], R(0, -0.2, 0.0)),
      ell(P(0.086, 0.932, 0.0), [0.03, 0.034, 0.029]),
      chain([P(0.082, 0.915, -0.022), P(0.066, 0.872, -0.042)], 0.0115, 0.004), sph(P(0.063, 0.862, -0.043), 0.0145),
      chain([P(0.072, 0.925, 0.02), P(0.045, 0.9, 0.05), P(0.006, 0.888, 0.066)], 0.0088, 0.004),
      chain([P(0.006, 0.886, 0.066), P(0.022, 0.868, 0.056), P(0.05, 0.866, 0.012), P(0.065, 0.868, -0.04)], 0.0078, 0.004)
    ];
    let o = smooth(0.01, parts);
    o = sub(o, sph(P(0.106, 0.932, 0.0), 0.0245), 0.003);                  // acetabulum
    o = sub(o, ell(P(0.058, 0.886, 0.012), [0.04, 0.0155, 0.0135]), 0.002); // obturator foramen
    o = sub(o, sph(P(0.07, 0.968, -0.06), 0.017), 0.004);                  // greater sciatic notch
    return [bone(o, 0.0028)];
  };
  B.femur = s => {
    const P = (x, y, z) => [s * x, y, z];
    const parts = [
      sph(P(0.082, 0.936, 0.0), 0.0235),
      chain([P(0.086, 0.932, 0.0), P(0.118, 0.9, -0.002)], [0.0125, 0.0145], 0.004),
      sph(P(0.127, 0.898, -0.003), 0.0165),
      chain([P(0.115, 0.89, 0.0), P(0.106, 0.7, 0.014), P(0.098, 0.54, 0.009)], [0.0165, 0.0142, 0.0185], 0.006),
      ell(P(0.083, 0.5, -0.004), [0.0175, 0.0245, 0.027], [0, 0, s * 0.05]),
      ell(P(0.113, 0.5, -0.004), [0.0175, 0.0245, 0.027], [0, 0, -s * 0.05]),
      ell(P(0.098, 0.512, 0.02), [0.02, 0.02, 0.014])
    ];
    let o = smooth(0.008, parts);
    o = sub(o, ell(P(0.098, 0.488, -0.016), [0.006, 0.02, 0.016]), 0.002);
    return [bone(o, 0.0028)];
  };
  B.patella = s => {
    const P = (x, y, z) => [s * x, y, z];
    return [bone(smooth(0.006, [ell(P(0.098, 0.512, 0.044), [0.021, 0.024, 0.0105]), cap(P(0.098, 0.5, 0.044), P(0.098, 0.482, 0.042), 0.011, 0.005)]), 0.0017)];
  };
  B.tibia = s => {
    const P = (x, y, z) => [s * x, y, z];
    const parts = [
      ell(P(0.097, 0.484, 0.011), [0.0345, 0.0085, 0.0295]),
      sph(P(0.098, 0.455, 0.037), 0.0085),
      chain([P(0.097, 0.47, 0.012), P(0.095, 0.3, 0.012), P(0.091, 0.1, 0.006)], [0.0185, 0.0125, 0.0145], 0.006),
      chain([P(0.097, 0.45, 0.027), P(0.093, 0.15, 0.019)], 0.0058, 0.004),
      chain([P(0.077, 0.095, 0.0), P(0.072, 0.063, 0.0)], 0.0105, 0.003),
      ell(P(0.09, 0.08, 0.0), [0.018, 0.006, 0.017])
    ];
    return [bone(smooth(0.006, parts), 0.0026)];
  };
  B.fibula = s => {
    const P = (x, y, z) => [s * x, y, z];
    const parts = [
      sph(P(0.127, 0.464, 0.0), 0.0078),
      chain([P(0.128, 0.45, -0.002), P(0.122, 0.25, -0.006), P(0.115, 0.095, -0.006)], [0.0048, 0.0048, 0.0058], 0.004),
      ell(P(0.113, 0.07, -0.006), [0.0085, 0.021, 0.011])
    ];
    return [bone(smooth(0.004, parts), 0.0019)];
  };
  B.foot = s => {
    const P = (x, y, z) => [s * x, y, z];
    const parts = [
      ell(P(0.094, 0.03, -0.028), [0.0165, 0.0225, 0.033]),
      ell(P(0.092, 0.066, -0.006), [0.017, 0.0125, 0.0225]),
      ell(P(0.083, 0.044, 0.028), [0.0085, 0.009, 0.009]),
      ell(P(0.106, 0.026, 0.026), [0.01, 0.0085, 0.009])
    ];
    for (let i = 0; i < 3; i++) parts.push(ell(P(0.078 + i * 0.0155, 0.026, 0.044), [0.0072, 0.0075, 0.0085]));
    for (let i = 0; i < 5; i++) {
      const x0 = 0.076 + i * 0.0148, x1 = 0.072 + i * 0.0158;
      const big = i === 0;
      parts.push(cap(P(x0, 0.028, 0.044), P(x1, 0.013, 0.118), big ? 0.0072 : 0.0054, big ? 0.0066 : 0.0048));
      const lens = big ? [0.022, 0.017] : [0.014, 0.01, 0.008];
      let z = 0.12, x = x1;
      lens.forEach((L, k) => {
        const rr = (big ? 0.0066 : 0.0046) * (1 - 0.15 * k);
        parts.push(cap(P(x, 0.011, z), P(x - 0.0004 * k, 0.0105, z + L), rr, rr * 0.88));
        z += L + 0.0006;
      });
    }
    return [bone(smooth(0.0016, parts), 0.0017)];
  };
})();
