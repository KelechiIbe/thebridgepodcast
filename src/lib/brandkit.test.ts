import { describe, expect, it } from "vitest";
import { googleFamilies, guessFromKit, normalizeColor, pickFace, readCss, type BrandKit, type KitFont } from "./brandkit";
import { defaultShow } from "../shared/defaults";

describe("brand kit reader", () => {
  it("normalises CSS colours and skips see-through ones", () => {
    expect(normalizeColor("#f5c518")).toBe("#F5C518");
    expect(normalizeColor("#abc")).toBe("#AABBCC");
    expect(normalizeColor("#0B191Cff")).toBe("#0B191C");
    expect(normalizeColor("#00000033")).toBeNull();
    expect(normalizeColor("rgb(245, 197, 24)")).toBe("#F5C518");
    expect(normalizeColor("rgb(245 197 24 / 0.9)")).toBe("#F5C518");
    expect(normalizeColor("rgba(0,0,0,0.2)")).toBeNull();
    expect(normalizeColor("hsl(0, 100%, 50%)")).toBe("#FF0000");
    expect(normalizeColor("red")).toBeNull();
  });

  it("reads Google Fonts links", () => {
    expect(googleFamilies("https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;700&display=swap")).toEqual(["Bebas Neue", "DM Sans"]);
    expect(googleFamilies("https://fonts.googleapis.com/css?family=Inter:400,700|Roboto+Mono")).toEqual(["Inter", "Roboto Mono"]);
    expect(googleFamilies("styles/site.css")).toEqual([]);
  });

  it("reads tokens, faces and font roles from a stylesheet", () => {
    const f = readCss(
      `/* brand */
      @import url("https://fonts.googleapis.com/css2?family=JetBrains+Mono");
      @font-face { font-family: "Bridge Sans"; src: url("../fonts/BridgeSans-Bold.woff2") format("woff2"), url(../fonts/BridgeSans-Bold.ttf); font-weight: 700; }
      @font-face { font-family: 'Bridge Sans'; src: url(../fonts/BridgeSans.woff2); font-weight: 100 900; font-style: normal; }
      :root { --brand-primary: #F5C518; --color-bg: rgb(11, 25, 28); --font-heading: "Bridge Sans", sans-serif; --font-code: 'JetBrains Mono', monospace; }
      h1, .title { font-family: var(--font-heading); color: var(--brand-primary); }
      body { font-family: Inter, system-ui, sans-serif; background: #0B191C; }
      @media (max-width: 600px) { p { font-family: Inter; } }`,
      "css/site.css",
    );
    expect(f.vars.get("--brand-primary")).toBe("#F5C518");
    expect(f.faces).toHaveLength(2);
    expect(f.faces[0]).toMatchObject({ family: "Bridge Sans", weight: 700, weightMax: 700, url: "../fonts/BridgeSans-Bold.woff2" });
    expect(f.faces[1]).toMatchObject({ weight: 100, weightMax: 900 });
    expect(f.google.has("JetBrains Mono")).toBe(true);
    expect([...f.families.get("Bridge Sans")!.hints]).toContain("heading");
    expect([...f.families.get("Inter")!.hints]).toContain("body");
    expect([...f.families.get("JetBrains Mono")!.hints]).toContain("mono");
    expect(f.colorCounts.get("#0B191C")).toBeGreaterThanOrEqual(2);
  });

  it("picks a heavy file for headlines and a regular one for text", () => {
    const file = (name: string) => ({ path: name, name, data: new Uint8Array(1), mime: "font/woff2" });
    const font: KitFont = {
      family: "Bridge Sans",
      uses: 3,
      google: false,
      hints: [],
      faces: [
        { weight: 400, weightMax: 400, italic: false, file: file("Regular.woff2") },
        { weight: 400, weightMax: 400, italic: true, file: file("Italic.woff2") },
        { weight: 800, weightMax: 800, italic: false, file: file("ExtraBold.woff2") },
      ],
    };
    expect(pickFace(font, "display")?.file?.name).toBe("ExtraBold.woff2");
    expect(pickFace(font, "body")?.file?.name).toBe("Regular.woff2");
    const variable: KitFont = { ...font, faces: [{ weight: 100, weightMax: 900, italic: false, file: file("Var.woff2") }] };
    expect(pickFace(variable, "display")?.file?.name).toBe("Var.woff2");
  });

  it("guesses stage colours and fonts from token names", () => {
    const kit: BrandKit = {
      source: "kit.zip",
      text: "",
      tokens: [
        { name: "--color-background", value: "#0A1416" },
        { name: "--color-surface", value: "#F4F4F4" },
        { name: "--text-primary", value: "#EEF2EE" },
        { name: "--text-muted", value: "#8FA3A0" },
        { name: "--brand-primary", value: "#F5C518" },
        { name: "--brand-secondary", value: "#2BB673" },
        { name: "--color-danger", value: "#E5484D" },
      ],
      colors: [],
      fonts: [
        { family: "Inter", uses: 5, google: true, hints: ["body"], faces: [] },
        { family: "Bebas Neue", uses: 2, google: true, hints: ["heading"], faces: [] },
        { family: "JetBrains Mono", uses: 1, google: true, hints: [], faces: [] },
      ],
      logos: [],
      title: "",
      pdf: null,
      counts: { pages: 1, stylesheets: 1, fontFiles: 0, images: 0 },
    };
    const g = guessFromKit(kit, defaultShow().brand);
    expect(g.palette.bg).toBe("#0A1416");
    expect(g.palette.ink).toBe("#EEF2EE");
    expect(g.palette.dim).toBe("#8FA3A0");
    expect(g.palette.accent).toBe("#F5C518");
    expect(g.palette.accent2).toBe("#2BB673");
    expect(g.palette.bad).toBe("#E5484D");
    expect(g).toMatchObject({ display: "Bebas Neue", body: "Inter", mono: "JetBrains Mono" });
  });
});
