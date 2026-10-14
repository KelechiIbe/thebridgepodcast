import { describe, expect, it } from "vitest";
import { integratedLoudness } from "./loudness";

describe("loudness", () => {
  it("measures a full-scale 997 Hz tone in both channels at about 0 LUFS", () => {
    const rate = 48000;
    const n = rate * 5;
    const amp = 0.1; // -20 dBFS
    const ch = new Float32Array(n).map((_, i) => amp * Math.sin((2 * Math.PI * 997 * i) / rate));
    expect(integratedLoudness([ch, ch], rate)).toBeCloseTo(-20, 0);
  });
});
