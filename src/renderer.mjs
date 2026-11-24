import { shader } from './shaders.mjs';

const vertexLayout = [{
  arrayStride: 48,
  attributes: [0, 1, 2, 3].map(shaderLocation => ({
    shaderLocation, offset: shaderLocation * 12, format: 'float32x3',
  })),
}];
const alphaBlend = {
  color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
  alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
};

export function orientation(yaw, pitch) {
  const sine = Math.sin(yaw), cosine = Math.cos(yaw);
  const tilt = Math.sin(pitch), level = Math.cos(pitch);
  return {
    forward: [-sine * level, tilt, -cosine * level],
    right: [cosine, 0, -sine],
    up: [sine * tilt, level, cosine * tilt],
  };
}

export async function createRenderer(canvas, buildWorld, onLost) {
  if (!navigator.gpu) throw new Error('WebGPU를 지원하는 브라우저에서 열어 주세요.');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('사용 가능한 WebGPU 어댑터를 찾지 못했습니다.');
  const device = await adapter.requestDevice();

  try {
    const context = canvas.getContext('webgpu');
    if (!context) throw new Error('WebGPU 캔버스를 초기화할 수 없습니다.');
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'opaque' });

    const shaderModule = device.createShaderModule({ code: shader, label: 'Afterlight ocean' });
    const info = await shaderModule.getCompilationInfo();
    const errors = info.messages.filter(message => message.type === 'error');
    if (errors.length) throw new Error(errors.map(message => `${message.lineNum}: ${message.message}`).join('\n'));

    const camera = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const bindGroupLayout = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }],
    });
    const bindGroup = device.createBindGroup({ layout: bindGroupLayout, entries: [{ binding: 0, resource: { buffer: camera } }] });
    const layout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });

    function pipeline(vertex, fragment, buffers, blend, depthWriteEnabled, depthCompare = 'less') {
      return device.createRenderPipelineAsync({
        label: fragment,
        layout,
        vertex: { module: shaderModule, entryPoint: vertex, buffers },
        fragment: { module: shaderModule, entryPoint: fragment, targets: [{ format, blend }] },
        primitive: { topology: 'triangle-list' },
        depthStencil: { format: 'depth24plus', depthWriteEnabled, depthCompare },
      });
    }
    const [sky, solid, translucent, particles] = await Promise.all([
      pipeline('skyVertex', 'skyFragment', [], undefined, false, 'always'),
      pipeline('worldVertex', 'worldFragment', vertexLayout, undefined, true),
      pipeline('worldVertex', 'worldFragment', vertexLayout, alphaBlend, false),
      pipeline('particleVertex', 'particleFragment', [{
        arrayStride: 16, stepMode: 'instance', attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' }],
      }], alphaBlend, false),
    ]);

    const world = buildWorld();
    function upload(data, stride) {
      const buffer = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.VERTEX, mappedAtCreation: true });
      new Float32Array(buffer.getMappedRange()).set(data);
      buffer.unmap();
      return { buffer, count: data.length / stride };
    }
    const land = upload(world.solid, 12);
    const fauna = upload(world.translucent, 12);
    const specks = upload(world.particles, 4);
    let depth, width, height;
    const data = new Float32Array(20);
    let lost = false;

    device.lost.then(info => {
      lost = true;
      if (info.reason !== 'destroyed') onLost();
    });

    return {
      obstacles: world.obstacles,
      render(view, time) {
        if (lost) return;
        const scale = Math.min(devicePixelRatio, 1.4, 1550 / Math.max(canvas.clientWidth, 1), 1050 / Math.max(canvas.clientHeight, 1));
        const nextWidth = Math.max(1, Math.round(canvas.clientWidth * scale));
        const nextHeight = Math.max(1, Math.round(canvas.clientHeight * scale));
        if (nextWidth !== width || nextHeight !== height) {
          width = canvas.width = nextWidth;
          height = canvas.height = nextHeight;
          depth?.destroy();
          depth = device.createTexture({ size: [width, height], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT });
        }

        const aspect = width / height;
        const lens = 1 / Math.tan((aspect < .85 ? 1.47 : 1.04) / 2);
        const { forward, right, up } = orientation(view.yaw, view.pitch);
        data.set([...view.position, time, ...forward, 0, ...right, lens / aspect, ...up, lens, width, height, 0, 0]);
        device.queue.writeBuffer(camera, 0, data);

        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
          colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: 'clear', clearValue: [0, .03, .035, 1], storeOp: 'store' }],
          depthStencilAttachment: { view: depth.createView(), depthLoadOp: 'clear', depthClearValue: 1, depthStoreOp: 'discard' },
        });
        pass.setBindGroup(0, bindGroup);
        pass.setPipeline(sky);
        pass.draw(3);
        pass.setPipeline(solid);
        pass.setVertexBuffer(0, land.buffer);
        pass.draw(land.count);
        pass.setPipeline(translucent);
        pass.setVertexBuffer(0, fauna.buffer);
        pass.draw(fauna.count);
        pass.setPipeline(particles);
        pass.setVertexBuffer(0, specks.buffer);
        pass.draw(6, specks.count);
        pass.end();
        device.queue.submit([encoder.finish()]);
      },
    };
  } catch (error) {
    device.destroy();
    throw error;
  }
}
