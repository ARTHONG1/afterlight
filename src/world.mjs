const TAU = Math.PI * 2;
const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
const mix = (a, b, t) => a + (b - a) * t;
const add = (a, b) => a.map((value, i) => value + b[i]);
const mul = (a, n) => a.map(value => value * n);
const sub = (a, b) => a.map((value, i) => value - b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = p => mul(p, 1 / (Math.hypot(...p) || 1));

export const zones = [
  { name: '켈프 숲', position: [-66, -11, 18], yaw: -0.13, pitch: -0.12, center: -60 },
  { name: '산호 능선', position: [16, -27, 16], yaw: -0.12, pitch: -0.23, center: 24 },
  { name: '해파리 분지', position: [94, -44, 19], yaw: -0.13, pitch: 0.045, center: 101 },
];

export function randomSource(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function hill(x, z, cx, cz, w, d) {
  return Math.exp(-(((x - cx) / w) ** 2 + ((z - cz) / d) ** 2));
}

export function seabed(x, z) {
  return -23 - 17 * clamp((x + 30) / 58, 0, 1) - 17 * clamp((x - 54) / 60, 0, 1)
    + 1.8 * Math.sin(x * .11 + z * .055) * Math.cos(z * .12)
    + .65 * Math.sin(z * .37 + x * .24) + .29 * Math.cos(x * .68 - z * .61)
    + 10 * hill(x, z, -86, -12, 10, 26) + 8 * hill(x, z, -36, -31, 10, 18)
    + 9 * hill(x, z, 27, -12, 17, 18) + 13 * hill(x, z, 48, -26, 12, 29)
    + 10 * hill(x, z, 128, -30, 16, 39) + 8 * hill(x, z, 80, -45, 9, 21);
}

function color(hex) {
  return [16, 8, 0].map(shift => (((hex >> shift) & 255) / 255) ** 2);
}

const palette = values => values.map(color);
const silt = palette([0x687857, 0x526956, 0x819477, 0x425e55, 0x635d72]);
const stone = palette([0x3a5149, 0x475d52, 0x586b55, 0x506254, 0x5e7665, 0x3d4966]);
const fronds = palette([0x619541, 0x739f43, 0x397e58, 0x94ad55, 0x426e42, 0x55864a]);
const reef = palette([0xf98665, 0xf9b192, 0xe26985, 0xb786d6, 0xe8b266, 0xf17c8b]);
const jellies = palette([0x8fbff8, 0x8aeed4, 0xa59afe, 0xd893e9]);
const fishColors = palette([0x69a6a4, 0x9cbcc0, 0xc3c68a, 0x8fc3c6]);

class Mesh {
  vertices = [];

  v(position, normal, tint, data) {
    this.vertices.push(...position, ...normal, ...tint, ...data);
  }

  triangle(a, b, c, tint, data = [0, 0, 0], normals) {
    const normal = unit(cross(sub(b, a), sub(c, a)));
    this.v(a, normals?.[0] ?? normal, tint, data);
    this.v(b, normals?.[1] ?? normal, tint, data);
    this.v(c, normals?.[2] ?? normal, tint, data);
  }

  quad(a, b, c, d, tint, data) {
    this.triangle(a, b, c, tint, data);
    this.triangle(a, c, d, tint, data);
  }

  build() {
    const output = new Float32Array(this.vertices);
    this.vertices = [];
    return output;
  }
}

function tube(mesh, points, radii, tint, data, sides = 6) {
  const rings = points.map((point, i) => {
    const direction = unit(sub(points[Math.min(i + 1, points.length - 1)], points[Math.max(i - 1, 0)]));
    const side = unit(cross(direction, Math.abs(direction[1]) > .9 ? [1, 0, 0] : [0, 1, 0]));
    const up = cross(side, direction);
    return Array.from({length: sides}, (_, j) => {
      const angle = j / sides * TAU;
      return add(point, mul(add(mul(side, Math.cos(angle)), mul(up, Math.sin(angle))), radii[i]));
    });
  });
  for (let i = 1; i < rings.length; i++) {
    for (let j = 0; j < sides; j++) {
      const k = (j + 1) % sides;
      mesh.quad(rings[i - 1][j], rings[i - 1][k], rings[i][k], rings[i][j], tint, data);
    }
  }
}

function rock(mesh, center, dimensions, tint, random, rows = 5, columns = 8) {
  const rings = [];
  const phase = random() * TAU;
  for (let i = 0; i <= rows; i++) {
    const phi = i / rows * Math.PI;
    const row = [];
    for (let j = 0; j < columns; j++) {
      const theta = j / columns * TAU + phase + (i % 2) * .21;
      const rough = .77 + random() * .44;
      row.push(add(center, [
        dimensions[0] * Math.sin(phi) * Math.cos(theta) * rough,
        dimensions[1] * (Math.cos(phi) + (random() - .5) * .19),
        dimensions[2] * Math.sin(phi) * Math.sin(theta) * rough,
      ]));
    }
    rings.push(row);
  }
  for (let i = 1; i <= rows; i++) {
    for (let j = 0; j < columns; j++) {
      const k = (j + 1) % columns;
      mesh.quad(rings[i - 1][j], rings[i - 1][k], rings[i][k], rings[i][j], mul(tint, .76 + random() * .39), [0, 0, 0]);
    }
  }
}

function leaf(mesh, base, angle, length, width, rise, tint, phase, growth) {
  let left = base, right = base;
  const direction = [Math.cos(angle), 0, Math.sin(angle)];
  const side = [-direction[2], 0, direction[0]];
  for (let i = 1; i <= 7; i++) {
    const u = i / 7;
    const bow = Math.sin(Math.PI * u);
    const center = add(base, add(mul(direction, length * u), [0, rise * u + .33 * bow, 0]));
    const offset = add(mul(side, width * Math.max(.015, bow ** .82)), [0, width * .36 * Math.sin(u * TAU), 0]);
    const nextLeft = sub(center, offset);
    const nextRight = add(center, offset);
    const previousCenter = mul(add(left, right), .5);
    const rib = add(center, [0, width * .27 * bow, 0]);
    mesh.quad(left, previousCenter, rib, nextLeft, mul(tint, .8 + .2 * u), [2, phase, growth]);
    mesh.quad(previousCenter, right, nextRight, rib, mul(tint, 1 + .18 * u), [2, phase, growth]);
    left = nextLeft;
    right = nextRight;
  }
}

function kelp(mesh, x, z, height, random, sample) {
  const base = seabed(x, z) - .13;
  const phase = random() * TAU;
  const bend = (random() - .5) * 2.7;
  const twist = random() * TAU;
  const plant = t => [x + Math.sin(t * 3.5 + phase) * t * bend, base + height * t, z + Math.sin(t * 5 + phase) * t * .72];
  const segments = Math.max(6, Math.floor(height * .94));
  const tint = sample(fronds);
  const points = Array.from({length: segments + 1}, (_, i) => plant(i / segments));
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const radius = .075 * (1 - t * .88);
    tube(mesh, [points[i - 1], points[i]], [radius + .006, radius], mul(tint, .65), [2, phase, base], 4);
    if (i < 2) continue;
    leaf(mesh, points[i], twist + i * 2.36, (.66 + random() * 1.43) * (1 + height * .032), .14 + random() * .26, (random() - .12) * 1.3, mul(tint, .77 + random() * .63), phase, base);
    if (height > 7 && i % 2 === 0) {
      leaf(mesh, points[i], twist + i * 2.36 + 2.5, 1 + random() * 1.1, .22, .58, tint, phase, base);
    }
  }
}

function coral(mesh, root, height, tint, random) {
  const branch = (start, direction, length, width, level) => {
    const elbow = add(start, mul(direction, length * .54));
    const end = add(elbow, mul(unit(add(direction, [0, .67, 0])), length * .53));
    tube(mesh, [start, elbow, end], [width, width * .73, width * (level ? .55 : .2)], tint, [6, 0, 0], 5);
    if (!level) return;
    for (let i = 0; i < 2; i++) {
      const angle = random() * TAU + i * Math.PI;
      branch(i === 0 ? elbow : end, unit([Math.cos(angle) * .7, .49 + random() * .75, Math.sin(angle) * .7]), length * (.53 + random() * .22), width * .64, level - 1);
    }
  };
  branch(root, unit([random() - .5, 1.3, random() - .5]), height, height * .075, 3);
}

function seaFan(mesh, root, height, angle, tint, random) {
  const spread = [Math.cos(angle), 0, Math.sin(angle)];
  const normal = [-spread[2], 0, spread[0]];
  const point = (side, up, bend) => add(root, add(mul(spread, side * height), add([0, up * height, 0], mul(normal, bend * height))));
  for (let i = -6; i <= 6; i++) {
    const side = i / 6;
    const taper = 1 - .28 * Math.abs(side);
    const stem = t => point(side * t ** 1.2 * .65, taper * t, .11 * t * Math.sin(side * 3 + t * 2));
    const points = Array.from({ length: 7 }, (_, index) => stem(index / 6));
    tube(mesh, points, points.map((_, index) => height * (.023 - index * .0028)), tint, [6, 0, 0], 4);
    for (let j = 2; j < 7; j++) {
      const t = j / 7;
      const fan = i % 2 === 0 ? 1 : -1;
      const end = point(side * t ** 1.2 * .65 + fan * .095, taper * t + .10 + random() * .072, .14 * t);
      tube(mesh, [stem(t), end], [.011 * height, .004 * height], mul(tint, 1.16), [6, 0, 0], 3);
    }
  }
}

function fish(mesh, origin, size, phase, tint) {
  const model = [[1, 0, 0], [.38, .29, 0], [.25, .02, .21], [.25, .02, -.21],
    [.31, -.23, 0], [-.62, 0, 0], [-1.04, .33, 0], [-1.04, -.28, 0], [-.12, .51, 0]];
  const points = model.map(point => add(origin, mul(point, size)));
  const faces = [[0, 1, 2], [0, 3, 1], [0, 2, 4], [0, 4, 3], [5, 2, 1], [5, 1, 3], [5, 4, 2], [5, 3, 4], [5, 6, 7], [1, 5, 8]];
  faces.forEach(([a, b, c], i) => mesh.triangle(points[a], points[b], points[c], mul(tint, i % 2 ? .74 : 1.25), [3, phase, origin[0]]));
}

function jelly(mesh, origin, size, tint, phase) {
  const data = [4, phase, origin[1]];
  const ring = (i, j) => {
    const phi = i / 7 * Math.PI / 2;
    const angle = j / 24 * TAU;
    const lip = .9 + .1 * Math.cos(angle * 8) * (i / 7) ** 4;
    return add(origin, mul([Math.cos(angle) * Math.sin(phi) * lip, Math.cos(phi) * .64, Math.sin(angle) * Math.sin(phi) * lip], size));
  };
  for (let i = 1; i <= 7; i++) {
    for (let j = 0; j < 24; j++) {
      const points = [ring(i - 1, j), ring(i - 1, j + 1), ring(i, j + 1), ring(i, j)];
      const normals = points.map(point => unit(sub(point, origin)));
      const ribs = mul(tint, i === 7 || j % 3 === 0 ? 1.55 : .69);
      mesh.triangle(points[0], points[1], points[2], ribs, data, [normals[0], normals[1], normals[2]]);
      mesh.triangle(points[0], points[2], points[3], ribs, data, [normals[0], normals[2], normals[3]]);
    }
  }
  for (let j = 0; j < 11; j++) {
    const phi = j * TAU / 11;
    const points = Array.from({length: 12}, (_, i) => {
      const t = i / 11;
      const swell = (.53 + .25 * Math.sin(phi * 2 + t * 7)) * (1 - t * .3);
      return add(origin, mul([Math.cos(phi + t * .9) * swell, -t * (1.65 + .54 * Math.sin(phi * 3)), Math.sin(phi + t * .9) * swell], size));
    });
    tube(mesh, points, points.map((_, i) => size * (.024 - .019 * i / 11)), tint, [5, phase, origin[1]], 3);
  }
}

export function buildWorld() {
  const random = randomSource(81021);
  const sample = list => list[Math.floor(random() * list.length)];
  const solid = new Mesh();
  const translucent = new Mesh();
  const obstacles = [];
  const ground = (x, z) => [x, seabed(x, z), z];
  const normal = (x, z) => unit([seabed(x - .2, z) - seabed(x + .2, z), .4, seabed(x, z - .2) - seabed(x, z + .2)]);
  const limit = 160;
  const step = 2;
  for (let x = -limit; x < limit; x += step) {
    for (let z = -118; z < 95; z += step) {
      const a = ground(x, z), b = ground(x, z + step), c = ground(x + step, z + step), d = ground(x + step, z);
      const na = normal(x, z), nb = normal(x, z + step), nc = normal(x + step, z + step), nd = normal(x + step, z);
      const band = (Math.sin(x * .22 + z * .13) + Math.cos(x * .069 - z * .23) + 2) / 4;
      const base = silt[0].map((channel, i) => mix(channel, silt[1][i], band));
      const tint = base.map((channel, i) => mix(mix(channel, silt[4][i], clamp((x - 55) / 22, 0, 1)), silt[2][i], .10 + random() * .04));
      solid.triangle(a, b, c, tint, [1, 0, 0], [na, nb, nc]);
      solid.triangle(a, c, d, tint, [1, 0, 0], [na, nc, nd]);
    }
  }

  for (let i = 0; i < 595; i++) {
    const x = -120 + random() * 264, z = -102 + random() * 151;
    const size = .23 + random() ** 3 * 2.8;
    rock(solid, ground(x, z), [size, size * (.25 + random() * .7), size * (.7 + random() * .65)], sample(stone), random, 3, 6);
  }
  const stacks = [
    [-86, -14, 7, 7, 9], [-82, 8, 6, 6, 8], [-76, -37, 5, 11, 6],
    [-45, -25, 6, 9, 7], [-37, -33, 5, 6, 8], [-26, -54, 10, 8, 16],
    [37, -13, 6, 4, 6], [48, -25, 7, 9, 11], [6, -36, 4, 10, 6],
    [79, -28, 5, 7, 7], [119, -25, 7, 10, 11], [126, -39, 8, 13, 12],
  ];
  for (const [x, z, w, h, d] of stacks) {
    const y = seabed(x, z);
    rock(solid, [x, y - .1, z], [w, h, d], sample(stone), random, 7, 11);
    obstacles.push({center: [x, y - .1, z], radius: [w * .89, h * .86, d * .89]});
    for (let i = 0; i < 14; i++) {
      const a = random() * TAU;
      const distance = .46 + random() * .6;
      const px = x + Math.cos(a) * w * distance, pz = z + Math.sin(a) * d * distance;
      const scale = .25 + random() * 2.5;
      rock(solid, [px, seabed(px, pz) + h * (1 - distance) * .47, pz], [scale, scale * .82, scale * .74], sample(stone), random, 4, 6);
    }
  }

  for (let i = 0; i < 315; i++) {
    const x = -97 + random() * 71, z = -82 + random() * 118;
    const path = -60 + 6 * Math.sin(z * .067);
    const clearing = Math.abs(x - path) < 7.3 && z > -42;
    if (clearing && random() < .92) continue;
    const height = clearing ? .9 + random() * 2.7 : 3.7 + random() ** .8 * 12;
    kelp(solid, x, z, height, random, sample);
  }

  for (let i = 0; i < 224; i++) {
    const x = -4 + random() * 56, z = -46 + random() * 67;
    if (z > 1 && Math.abs(x - 15) < 5.5) continue;
    coral(solid, ground(x, z), .26 + random() ** 1.6 * 2.1, sample(reef), random);
    if (i % 4 === 0) {
      const y = seabed(x, z) + .28;
      rock(solid, [x, y, z], [.39, .62 + random() * .59, .39], sample(reef), random, 5, 9);
    }
  }
  for (const [cx, cz, scale] of [[22, 6, 1.3], [12, 7, .95], [32, -2, 1.1], [19, -14, 1.35], [7, -13, 1.2], [36, -20, 1.5]]) {
    for (let i = 0; i < 24; i++) {
      const x = cx + (random() - .5) * 9, z = cz + (random() - .5) * 8;
      const size = scale * (.48 + random() ** 1.9 * 1.68);
      const tint = sample(reef);
      const root = ground(x, z);
      if (i % 3 === 0) seaFan(solid, root, size * 1.27, random() * TAU, tint, random);
      else coral(solid, root, size, tint, random);
    }
  }

  for (let i = 0; i < 102; i++) {
    const x = 67 + random() * 63, z = -46 + random() * 72;
    coral(solid, ground(x, z), .31 + random() * .7, color(i % 2 ? 0x627f9e : 0x564276), random);
  }

  for (const zone of zones) {
    for (let school = 0; school < 4; school++) {
      const x = zone.center + (random() - .5) * 31;
      const y = zone.position[1] + (random() - .48) * 12;
      const z = -7 - school * 10;
      const phase = random() * 6;
      for (let i = 0; i < 31; i++) {
        const size = .17 + random() * .24;
        fish(solid, [x + (random() - .5) * 12, y + (random() - .5) * 3, z + (random() - .5) * 7], size, phase, sample(fishColors));
      }
    }
  }

  const bellPositions = [
    [98, -41, 1, 2.3], [105, -40, -5, 3.0], [95, -45, -9, 1.45],
    [105, -47, 2, 1.44], [91, -39, 4, 1.12], [113, -36, -14, 2.05],
    [83, -45, -14, 1.4], [100, -34, -25, 1.9], [99, -46, -17, 1.05],
  ];
  for (let i = 0; i < 23; i++) {
    const x = 77 + random() * 46, z = -17 - random() * 55;
    bellPositions.push([x, -34 - random() * 19, z, .39 + random() * 1.14]);
  }
  bellPositions.sort((a, b) => a[2] - b[2]);
  bellPositions.forEach(([x, y, z, size], i) => jelly(translucent, [x, y, z], size, jellies[i % jellies.length], random() * TAU));

  const particles = [];
  for (const zone of zones) {
    for (let i = 0; i < 1100; i++) {
      particles.push(zone.center + (random() - .5) * 78, -2 - random() * 57, 37 - random() * 118, random());
    }
  }
  return { solid: solid.build(), translucent: translucent.build(), particles: new Float32Array(particles), obstacles };
}
