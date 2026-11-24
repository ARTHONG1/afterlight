export const shader = /* wgsl */ String.raw`
struct Camera {
  eye: vec4f,
  forward: vec4f,
  right: vec4f,
  up: vec4f,
  viewport: vec4f,
};

@group(0) @binding(0) var<uniform> camera: Camera;

const SUN = vec3f(.37, .74, -.56);
const TAU = 6.2831853;

fn hash2(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}

fn noise(p: vec2f) -> f32 {
  let cell = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(cell), hash2(cell + vec2f(1, 0)), u.x),
    mix(hash2(cell + vec2f(0, 1)), hash2(cell + vec2f(1, 1)), u.x), u.y);
}

fn filaments(p: vec2f, time: f32) -> f32 {
  let a = sin(p.x * 1.17 + p.y * .62 + time * .84 + sin(p.y * .91 - time * .4) * 1.48);
  let b = sin(p.y * 1.52 - p.x * .44 - time * .63 + cos(p.x * 1.13 + time * .57) * 1.24);
  let c = sin(p.x * .7 - p.y * 1.25 + time * .33);
  return pow(1.0 - clamp(abs(a + b + c * .5) * .66, 0.0, 1.0), 8.0);
}

fn depthLight(y: f32) -> f32 {
  return exp(min(y + 2.0, 0.0) * .038);
}

fn waterColor(y: f32) -> vec3f {
  let dark = vec3f(.008, .013, .038);
  let teal = vec3f(.018, .162, .174);
  return mix(dark, teal, depthLight(y));
}

fn lightRays(end: vec3f, lengthToEye: f32) -> f32 {
  let time = camera.eye.w;
  let beta = vec2f(.37, -.56) / .74;
  let delta = end - camera.eye.xyz;
  var integrated = 0.0;
  for (var i: i32 = 0; i < 6; i++) {
    let t = (f32(i) + .45) / 6.0;
    let point = camera.eye.xyz + delta * t;
    let p = point.xz - point.y * beta;
    let broad = pow(.5 + .5 * sin(p.x * .364 + p.y * .158 + sin(p.y * .23) * .62 + time * .23), 11.0);
    let fine = pow(.5 + .5 * sin(p.x * .79 + p.y * .34 + time * .38), 7.0);
    let shade = mix(.17, 1.0, noise(p * .09 + vec2f(time * .03)));
    integrated += (broad * .82 + fine * .26) * depthLight(point.y) * shade;
  }
  return integrated * (1.0 - exp(-lengthToEye * .039)) * .10;
}

fn atmosphere(ray: vec3f, distance: f32) -> vec3f {
  let time = camera.eye.w;
  let eye = camera.eye.xyz;
  let base = waterColor(eye.y + max(ray.y, -.17) * 27.0);
  let sunglow = pow(max(dot(ray, SUN), 0.0), 7.0);
  var tint = base * (.50 + .67 * smoothstep(-.35, .31, ray.y));
  tint += vec3f(.10, .28, .23) * sunglow * depthLight(eye.y);
  if ray.y > .018 {
    let hit = eye.xz + ray.xz * (0.0 - eye.y) / ray.y;
    let wave = filaments(hit * .57 + vec2f(time * .17, -.14 * time), time);
    let detail = filaments(hit * 1.34, time * 1.31) * smoothstep(.16, .48, ray.y);
    let shimmer = noise(hit * .24 + vec2f(time * .18, time * -.1));
    let viewBlend = smoothstep(.055, .42, ray.y);
    let surface = vec3f(.025, .22, .25) * (.68 + .65 * shimmer) + vec3f(.24, .49, .43) * (wave * .44 + detail * .17);
    tint = mix(tint, surface * (.44 + .56 * depthLight(eye.y)), viewBlend * (.51 + .49 * depthLight(eye.y)));
    let disc = pow(max(dot(ray, SUN), 0.0), 115.0);
    tint += vec3f(.59, .80, .56) * disc * depthLight(eye.y);
  }
  tint += vec3f(.56, 1.0, .87) * lightRays(eye + ray * distance, distance);
  return tint;
}

fn display(color: vec3f) -> vec3f {
  return pow(max(vec3f(0.0), color / (vec3f(.9) + color * .42)), vec3f(.48));
}

fn project(world: vec3f) -> vec4f {
  let relative = world - camera.eye.xyz;
  let depth = dot(relative, camera.forward.xyz);
  return vec4f(
    dot(relative, camera.right.xyz) * camera.right.w,
    dot(relative, camera.up.xyz) * camera.up.w,
    depth * 1.0006 - .08,
    depth
  );
}

struct ScreenOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@vertex fn skyVertex(@builtin(vertex_index) index: u32) -> ScreenOut {
  let positions = array(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  let p = positions[index];
  return ScreenOut(vec4f(p, 0.0, 1.0), p);
}

@fragment fn skyFragment(input: ScreenOut) -> @location(0) vec4f {
  let ray = normalize(camera.forward.xyz + camera.right.xyz * input.uv.x / camera.right.w
    + camera.up.xyz * input.uv.y / camera.up.w);
  let distance = select(72.0, min(72.0, -camera.eye.y / max(ray.y, .001)), ray.y > 0.0);
  return vec4f(display(atmosphere(ray, distance)), 1.0);
}

struct WorldOut {
  @builtin(position) position: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) tint: vec3f,
  @location(3) @interpolate(flat) kind: f32,
};

@vertex fn worldVertex(
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) tint: vec3f,
  @location(3) motion: vec3f,
) -> WorldOut {
  let time = camera.eye.w;
  var p = position;
  if motion.x == 2.0 {
    let height = max(0.0, p.y - motion.z);
    p.x += .34 * sin(time * 1.27 + motion.y + height * .33) * min(height * .19, 2.5);
    p.z += .17 * cos(time * .81 + motion.y - height * .2) * min(height * .19, 2.5);
  } else if motion.x == 3.0 {
    let cycle = time * .55 + motion.y;
    let turn = cos(cycle);
    p.x = motion.z + (p.x - motion.z) * tanh(turn * 13.0) + 9.4 * sin(cycle);
    p.y += sin(time * .95 + motion.y) * .37;
    p.z += 3.2 * sin(cycle + .82) + .24 * sin(time * 8.0 + p.x * 1.3) * abs(position.x - motion.z);
  } else if motion.x == 4.0 || motion.x == 5.0 {
    let pulse = time * 1.14 + motion.y;
    let below = clamp(motion.z - p.y, 0.0, 6.0);
    p.y += sin(pulse) * .48 + sin(pulse * .72) * (p.y - motion.z) * .115;
    p.x += sin(time * .6 + motion.y) * .73 + sin(pulse + below) * below * .092;
    p.z += cos(time * .52 + motion.y) * .56 + cos(pulse - below) * below * .09;
  }
  return WorldOut(project(p), p, normal, tint, motion.x);
}

@fragment fn worldFragment(input: WorldOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  let offset = input.world - camera.eye.xyz;
  let distance = length(offset);
  let ray = offset / max(.001, distance);
  let time = camera.eye.w;
  let normal = normalize(select(-input.normal, input.normal, front) + vec3f(.0001, .00005, .0001));
  let light = depthLight(input.world.y);
  let sunDot = abs(dot(normal, SUN));
  let cloudy = atmosphere(ray, min(distance, 73.0));
  let fogDensity = mix(.054, .037, depthLight(camera.eye.y));
  let transmission = exp(-distance * fogDensity);
  let position = input.world;
  let shift = position.xz - position.y * vec2f(.38, -.55);
  let highlights = filaments(shift * .78, time);
  let detail = noise(position.xz * 1.36 + vec2f(position.y * 1.4, -position.y));
  let scattered = .43 * highlights * light * (.43 + .57 * sunDot);
  var tint = input.tint * (.28 + .59 * max(dot(normal, SUN), .06) + light * .52);
  tint *= mix(vec3f(.62, .74, 1.17), vec3f(1.04, 1.15, .91), light);
  tint *= .69 + detail * .42;
  tint += input.tint * scattered * 2.4;
  if input.kind == 1.0 {
    let ripples = .5 + .5 * sin(position.z * 4.7 + sin(position.x * .75) * 2.9 + noise(position.xz * .43) * 2.2);
    tint *= .85 + .18 * ripples;
    tint += vec3f(.10, .22, .14) * scattered;
  } else if input.kind == 2.0 {
    tint += input.tint * (sunDot * .46 + .21) * light;
  } else if input.kind == 3.0 {
    let flash = pow(max(0.0, dot(reflect(-SUN, normal), -ray)), 14.0);
    tint += vec3f(.24, .37, .37) * flash;
  } else if input.kind == 4.0 || input.kind == 5.0 {
    let edge = pow(1.0 - abs(dot(normal, ray)), 2.0);
    let glow = mix(.48, 1.25, edge) * (.86 + .14 * sin(position.y * 2.4 - time * 1.5));
    let opacity = select(.33 + .57 * edge, .85, input.kind > 4.0) * exp(-distance * .012);
    let lit = mix(cloudy, input.tint * glow + vec3f(.042, .055, .13), exp(-distance * .015));
    return vec4f(display(lit), opacity);
  } else if input.kind == 6.0 {
    tint += input.tint * (.32 + sunDot * .16);
  }
  return vec4f(display(mix(cloudy, tint, transmission)), 1.0);
}

struct ParticleOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) strength: f32,
  @location(2) seed: f32,
};

@vertex fn particleVertex(@builtin(vertex_index) index: u32, @location(0) source: vec4f) -> ParticleOut {
  let corners = array(vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1), vec2f(-1, 1), vec2f(1, -1), vec2f(1, 1));
  let uv = corners[index];
  let t = camera.eye.w;
  let seed = source.w;
  let bubble = seed > .94;
  var world = source.xyz + vec3f(sin(t * .35 + seed * 20.0) * 1.5, sin(t * .44 + seed * 6.0) * .59, cos(t * .37 + seed * 22.0) * 1.0);
  if bubble {
    world.y = -1.0 - fract((-source.y - 1.0) / 54.0 - t * .031 * seed) * 54.0;
  }
  var p = project(world);
  let distance = length(world - camera.eye.xyz);
  let pixels = clamp((.4 + seed * 1.3) * 28.0 / max(distance, 2.0), .60, 3.3);
  let size = select(pixels, pixels * 2.0, bubble);
  p.x += uv.x * size * 2.0 / camera.viewport.x * p.w;
  p.y += uv.y * size * 2.0 / camera.viewport.y * p.w;
  let strength = exp(-distance * .041) * smoothstep(.6, 2.0, distance) * (.62 + .38 * sin(t * .86 + seed * 106.0));
  return ParticleOut(p, uv, strength, seed);
}

@fragment fn particleFragment(input: ParticleOut) -> @location(0) vec4f {
  let radius = length(input.uv);
  if radius > 1.0 { discard; }
  let bubble = input.seed > .94;
  let dotGlow = pow(1.0 - radius, 1.7);
  let rim = smoothstep(.54, .72, radius) * (1.0 - smoothstep(.78, 1.0, radius));
  let alpha = select(dotGlow * .81, rim * .75 + dotGlow * .12, bubble) * input.strength;
  return vec4f(mix(vec3f(.65, .95, .91), vec3f(.95, .97, .64), input.seed), alpha);
}
`;
