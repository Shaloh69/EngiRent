import { useEffect, useRef, useState } from "react";

// Animated aurora background (design mandate §1.5). Adapted from react-bits'
// Aurora — its registry serves raw source, so this is vendored as a real file
// rather than pulled in as an opaque dependency, which lets it carry the two
// hardening requirements the mandate attaches to every animated background:
//
//   1. prefers-reduced-motion freezes it to a static first frame.
//   2. WebGL failure degrades to a CSS gradient instead of a blank rectangle.
//
// Renders via `ogl` (~30KB) rather than three.js — this sits behind auth and
// shell chrome, so it must not carry a 600KB 3D engine for a gradient.

const VERT = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

const FRAG = `#version 300 es
precision highp float;

uniform float uTime;
uniform float uAmplitude;
uniform vec3 uColorStops[3];
uniform vec2 uResolution;
uniform float uBlend;

out vec4 fragColor;

vec3 permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                      -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

struct ColorStop { vec3 color; float position; };

#define COLOR_RAMP(colors, factor, finalColor) {              \\
  int index = 0;                                              \\
  for (int i = 0; i < 2; i++) {                               \\
     ColorStop currentColor = colors[i];                      \\
     bool isInBetween = currentColor.position <= factor;       \\
     index = int(mix(float(index), float(i), float(isInBetween))); \\
  }                                                           \\
  ColorStop currentColor = colors[index];                     \\
  ColorStop nextColor = colors[index + 1];                    \\
  float range = nextColor.position - currentColor.position;   \\
  float lerpFactor = (factor - currentColor.position) / range; \\
  finalColor = mix(currentColor.color, nextColor.color, lerpFactor); \\
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;

  ColorStop colors[3];
  colors[0] = ColorStop(uColorStops[0], 0.0);
  colors[1] = ColorStop(uColorStops[1], 0.5);
  colors[2] = ColorStop(uColorStops[2], 1.0);

  vec3 rampColor;
  COLOR_RAMP(colors, uv.x, rampColor);

  float height = snoise(vec2(uv.x * 2.0 + uTime * 0.1, uTime * 0.25)) * 0.5 * uAmplitude;
  height = exp(height);
  height = (uv.y * 2.0 - height + 0.2);
  float intensity = 0.6 * height;

  float midPoint = 0.20;
  float auroraAlpha = smoothstep(midPoint - uBlend * 0.5, midPoint + uBlend * 0.5, intensity);

  vec3 auroraColor = intensity * rampColor;
  fragColor = vec4(auroraColor * auroraAlpha, auroraAlpha);
}
`;

export interface AuroraBackgroundProps {
  /** Three ramp stops, left→right. Defaults to the Vault teal/gold/coral trio. */
  colorStops?: [string, string, string];
  amplitude?: number;
  blend?: number;
  speed?: number;
  /** Multiplied into the canvas opacity — mandate caps this low behind dense screens. */
  opacity?: number;
  className?: string;
}

export function AuroraBackground({
  colorStops = ["#4DA3E8", "#F5B85C", "#FF8A95"],
  amplitude = 1.0,
  blend = 0.5,
  speed = 0.6,
  opacity = 1,
  className,
}: AuroraBackgroundProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  // Starts true so SSR and the first client paint agree; WebGL flips it off
  // only once a context actually exists. A failed init therefore leaves the
  // CSS gradient visible rather than showing an empty box.
  const [fallback, setFallback] = useState(true);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    let renderer: import("ogl").Renderer | undefined;
    let raf = 0;
    let disposed = false;

    (async () => {
      try {
        const { Renderer, Program, Mesh, Color, Triangle } = await import("ogl");
        if (disposed) return;

        renderer = new Renderer({ alpha: true, premultipliedAlpha: true, antialias: true });
        const gl = renderer.gl;
        gl.clearColor(0, 0, 0, 0);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.canvas.style.backgroundColor = "transparent";

        const geometry = new Triangle(gl);
        // Triangle ships a uv attribute the vertex shader above doesn't
        // declare; leaving it bound trips a shader-link warning in some
        // drivers, so drop it explicitly.
        if (geometry.attributes.uv) delete (geometry.attributes as Record<string, unknown>).uv;

        const stops = colorStops.map((hex) => {
          const c = new Color(hex);
          return [c.r, c.g, c.b];
        });

        const program = new Program(gl, {
          vertex: VERT,
          fragment: FRAG,
          uniforms: {
            uTime: { value: 0 },
            uAmplitude: { value: amplitude },
            uColorStops: { value: stops },
            uResolution: { value: [host.offsetWidth, host.offsetHeight] },
            uBlend: { value: blend },
          },
        });

        const mesh = new Mesh(gl, { geometry, program });
        host.appendChild(gl.canvas);
        setFallback(false);

        const resize = () => {
          if (!host) return;
          renderer!.setSize(host.offsetWidth, host.offsetHeight);
          program.uniforms.uResolution.value = [host.offsetWidth, host.offsetHeight];
        };
        window.addEventListener("resize", resize);
        resize();

        const frame = (t: number) => {
          raf = requestAnimationFrame(frame);
          // Reduced motion: render one frame at a fixed time and stop
          // advancing, so the visual is still present but perfectly still.
          program.uniforms.uTime.value = reduced ? 0 : (t * 0.001) * speed;
          renderer!.render({ scene: mesh });
          if (reduced) cancelAnimationFrame(raf);
        };
        raf = requestAnimationFrame(frame);

        return () => window.removeEventListener("resize", resize);
      } catch {
        // No WebGL, blocked context, or driver failure — keep the gradient.
        setFallback(true);
      }
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      const canvas = renderer?.gl.canvas;
      if (canvas && host.contains(canvas)) host.removeChild(canvas);
      renderer?.gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [colorStops, amplitude, blend, speed]);

  return (
    <div
      ref={hostRef}
      aria-hidden
      className={className}
      style={{
        position: "absolute",
        inset: 0,
        opacity,
        pointerEvents: "none",
        overflow: "hidden",
        background: fallback
          ? `radial-gradient(120% 80% at 15% 0%, ${colorStops[0]}55, transparent 60%),
             radial-gradient(100% 70% at 85% 10%, ${colorStops[1]}33, transparent 55%),
             radial-gradient(90% 60% at 50% 100%, ${colorStops[2]}22, transparent 60%)`
          : undefined,
      }}
    />
  );
}
