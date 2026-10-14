import type { Bar, Card, CardType, Tone } from "../../shared/types";
import { useApp } from "../ctx";
import { uploadAsset } from "../../lib/assets";

export const CARD_LABELS: Record<CardType, string> = {
  stat: "Big figure",
  note: "Key point",
  shift: "Before → after",
  split: "Share of a total",
  bars: "Comparison bars",
  formula: "Formula",
  steps: "Numbered steps",
  list: "List",
  dodont: "Legal / not legal",
  quote: "Listener question",
  cta: "Call to action",
  image: "Image",
};

const TONES: Tone[] = ["accent", "good", "mid", "bad"];

export function CardForm({ card, onChange, lineText }: { card: Card; onChange: (c: Card) => void; lineText: string }) {
  const app = useApp();
  const set = (patch: Partial<Card>) => onChange({ ...card, ...patch });
  const text = (key: keyof Card, label: string, placeholder = "") => (
    <label className="field">
      {label}
      <input className="input" value={(card[key] as string) ?? ""} placeholder={placeholder} onChange={(e) => set({ [key]: e.target.value } as Partial<Card>)} />
    </label>
  );
  const num = (key: keyof Card, label: string) => (
    <label className="field">
      {label}
      <input className="input" inputMode="decimal" value={(card[key] as number | undefined) ?? ""} onChange={(e) => set({ [key]: e.target.value === "" ? undefined : Number(e.target.value.replace(/[^0-9.-]/g, "")) } as Partial<Card>)} />
    </label>
  );
  const list = (key: "steps" | "parts", label: string, hint: string) => (
    <label className="field">
      {label} <span className="small muted">{hint}</span>
      <textarea className="input" rows={3} value={(card[key] ?? []).join("\n")} onChange={(e) => set({ [key]: e.target.value.split("\n").filter((x) => x.trim()) } as Partial<Card>)} />
    </label>
  );
  const anchorOk = !card.anchor || lineText.toLowerCase().includes(card.anchor.toLowerCase().replace(/[.,]$/, ""));
  return (
    <div className="stack tight">
      <div className="grid2">
        <label className="field">
          Type
          <select className="input" value={card.type} onChange={(e) => set({ type: e.target.value as CardType })}>
            {Object.entries(CARD_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Appears when these words are spoken
          <input className="input" value={card.anchor} onChange={(e) => set({ anchor: e.target.value })} style={anchorOk ? undefined : { borderColor: "var(--warn)" }} />
          {!anchorOk && <span className="small" style={{ color: "var(--warn)" }}>Not found in the line; the card will appear at the start of the line.</span>}
        </label>
      </div>
      {(card.type === "stat" || card.type === "note" || card.type === "cta" || card.type === "split") && (
        <div className="grid2">
          {text("big", "Big text", "₦100m")}
          {text("label", "Label")}
          {text("sub", "Small print")}
          {card.type !== "split" && (
            <label className="field">
              Colour
              <select className="input" value={card.tone ?? "accent"} onChange={(e) => set({ tone: e.target.value as Tone })}>
                {TONES.map((t) => <option key={t} value={t}>{t === "accent" ? "Brand" : t === "bad" ? "Warning" : t === "good" ? "Positive" : "Neutral"}</option>)}
              </select>
            </label>
          )}
        </div>
      )}
      {card.type === "split" && (
        <div className="grid2">
          {num("part", "Your share (₦)")}
          {num("total", "Total (₦)")}
          {text("partLabel", "Share label", "revenue")}
          {text("restLabel", "Rest label", "passes through")}
        </div>
      )}
      {card.type === "shift" && (
        <div className="grid2">
          {text("from", "Before", "₦25m")}
          {text("to", "After", "₦100m")}
          {text("label", "Label")}
          {text("sub", "Small print")}
        </div>
      )}
      {card.type === "bars" && (
        <div className="stack tight">
          {text("unit", "What is measured", "Total tax on ₦60m profit")}
          {(card.bars ?? []).map((b, i) => (
            <div className="row" key={i}>
              <input className="input" style={{ flex: 2 }} value={b.label} onChange={(e) => set({ bars: card.bars!.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} aria-label="Bar label" />
              <input className="input" style={{ flex: 1 }} inputMode="decimal" value={b.value} onChange={(e) => set({ bars: card.bars!.map((x, j) => (j === i ? { ...x, value: Number(e.target.value.replace(/[^0-9.]/g, "")) || 0 } : x)) })} aria-label="Bar value in naira" />
              <select className="input" style={{ flex: 1 }} value={b.tone} onChange={(e) => set({ bars: card.bars!.map((x, j) => (j === i ? { ...x, tone: e.target.value as Tone } : x)) })} aria-label="Bar colour">
                {TONES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <button className="icon-btn" onClick={() => set({ bars: card.bars!.filter((_, j) => j !== i) })} aria-label="Remove bar">✕</button>
            </div>
          ))}
          <button className="btn sm" style={{ justifySelf: "start" }} onClick={() => set({ bars: [...(card.bars ?? []), { label: "New bar", value: 0, tone: "mid" } as Bar] })}>Add bar</button>
        </div>
      )}
      {card.type === "formula" && (
        <>
          {list("parts", "Parts", "one per line, use − + = × as their own lines")}
          {text("label", "Caption")}
        </>
      )}
      {(card.type === "steps" || card.type === "list") && (
        <>
          {text("label", "Heading")}
          {list("steps", "Items", "one per line")}
        </>
      )}
      {card.type === "dodont" && (
        <div className="grid2">
          {text("doText", "Legal / do")}
          {text("dontText", "Not legal / don't")}
        </div>
      )}
      {card.type === "quote" && (
        <div className="grid2">
          {text("quote", "Question, short")}
          {text("attribution", "Attribution", "Funke asks")}
        </div>
      )}
      {card.type === "image" && (
        <div className="grid2">
          <label className="field">
            Image
            <input
              type="file"
              accept="image/*"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const a = await uploadAsset(app.show.id, f, "image", "cards");
                set({ image: a });
              }}
            />
            {card.image && <span className="small muted">{card.image.name}</span>}
          </label>
          {text("label", "Caption")}
          {text("sub", "Small print")}
        </div>
      )}
    </div>
  );
}
