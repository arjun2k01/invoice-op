import  { useEffect, useMemo, useRef, useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as htmlToImage from "html-to-image";
import {
  Moon, Sun, Download as FileDown, ImageDown,
  Save, History, Plus, Trash2
} from "lucide-react";

/* ---------- helpers (theme + money) ------------------------------------- */
const getCssVar = (name: string, fallback = "") =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

const nf2 = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const moneyFmt = (symbol: string) => (n: number) => `${symbol}${nf2.format(+n || 0)}`;

// color helpers for syncing PDF colors with CSS variables
const hexToRgb = (hex: string): [number, number, number] => {
  const h = hex.replace("#", "").trim();
  const f = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
  const n = parseInt(f, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const parseCssColor = (value: string, fallback: string): [number, number, number] => {
  const v = value || fallback;
  if (v.startsWith("#")) return hexToRgb(v);
  const m = v.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (m) return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
  const el = document.createElement("span");
  el.style.color = v;
  document.body.appendChild(el);
  const cs = getComputedStyle(el).color;
  document.body.removeChild(el);
  const mm = cs.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  return mm ? [parseInt(mm[1]), parseInt(mm[2]), parseInt(mm[3])] : hexToRgb(fallback);
};
const fmtDate = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
};

/* ---------- types -------------------------------------------------------- */
type Item = {
  description: string;
  qty: number | string;
  unit: string;
  rate: number | string;
  discount: number | string;
  hsn: string;
  sku: string;
};

type Form = {
  businessName: string;
  customerName: string;
  invoiceNo: string;
  date: string;
  place: string;
  symbol: string;
  items: Item[];
  overallDiscount: number | string;
};

const newItem = (): Item => ({
  description: "", qty: 0, unit: "Pcs.", rate: 0, discount: 0, hsn: "", sku: ""
});

const NEW_FORM = (): Form => ({
  businessName: "",
  customerName: "",
  invoiceNo: "INV-" +
    new Date().toISOString().slice(0, 10).replaceAll("-", "") +
    "-" + new Date().toTimeString().slice(0, 5).replace(":", ""),
  date: new Date().toISOString().slice(0, 10),
  place: "",
  symbol: "₹",
  items: [newItem()],
  overallDiscount: 0,
});

/* ---------- localStorage keys ------------------------------------------- */
const DRAFT_KEY = "invoice_draft_v3";
const SAVE_PREFIX = "invoice_save_"; // followed by name

/* ======================================================================== */
/*                                COMPONENT                                 */
/* ======================================================================== */
export default function InvoiceApp() {
  /* theme */
  const [dark, setDark] = useState<boolean>(() =>
    document.documentElement.classList.contains("dark")
  );
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  /* form + autosave */
  const [form, setForm] = useState<Form>(() => {
    const draft = localStorage.getItem(DRAFT_KEY);
    if (draft) try { return JSON.parse(draft) as Form; } catch {}
    return NEW_FORM();
  });
  useEffect(() => { localStorage.setItem(DRAFT_KEY, JSON.stringify(form)); }, [form]);

  const formatMoney = useMemo(() => moneyFmt(form.symbol), [form.symbol]);

  /* items CRUD */
  const addItem = () => setForm(f => ({ ...f, items: [...f.items, newItem()] }));
  const rmItem = (i: number) =>
    setForm(f => ({ ...f, items: f.items.filter((_, idx) => idx !== i) }));
  const setItem = (i: number, patch: Partial<Item>) =>
    setForm(f => {
      const items = [...f.items]; items[i] = { ...items[i], ...patch }; return { ...f, items };
    });

  /* totals */
  const totals = useMemo(() => {
    const subtotal = form.items.reduce((s, it) =>
      s + Math.max(0, (+it.qty || 0) * (+it.rate || 0) - (+it.discount || 0)), 0);
    const afterDisc = Math.max(0, subtotal - (+form.overallDiscount || 0));
    const grand = Math.round(afterDisc);
    const roundoff = +(grand - afterDisc).toFixed(2);
    return { subtotal, roundoff, grand };
  }, [form.items, form.overallDiscount]);

  /* history modal */
  const [showHistory, setShowHistory] = useState(false);
  const savedKeys = (): string[] =>
    Object.keys(localStorage).filter(k => k.startsWith(SAVE_PREFIX)).sort();

  const saveNamed = async () => {
    const name = prompt("Save as (letters, numbers, hyphen/underscore only):", "INV-0001");
    if (!name) return;
    const key = SAVE_PREFIX + name.replace(/[^a-z0-9-_]/gi, "_");
    localStorage.setItem(key, JSON.stringify(form));
    alert("Saved!");
  };
  const loadNamed = (key: string) => {
    const raw = localStorage.getItem(key); if (!raw) return;
    try { setForm(JSON.parse(raw)); setShowHistory(false); } catch {}
  };
  const deleteNamed = (key: string) => {
    if (!confirm("Delete this saved invoice?")) return;
    localStorage.removeItem(key);
    setShowHistory(true); // re-render list
  };

  /* PNG export (theme-synced) */
  const previewRef = useRef<HTMLDivElement | null>(null);
  const downloadPNG = async () => {
    if (!previewRef.current) return;
    const bg = getCssVar("--color-surface") || "#ffffff";
    const url = await htmlToImage.toPng(previewRef.current, {
      pixelRatio: 2,
      backgroundColor: bg,
    });
    const a = document.createElement("a");
    a.href = url; a.download = `${form.invoiceNo}.png`; a.click();
  };

  /* PDF export (theme-synced) */
  const downloadPDF = () => {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();

  // read theme vars from CSS
  const bgVar      = getCssVar("--color-bg", "#FFFFFF");
  const textVar    = getCssVar("--color-text", "#0A0A0A");
  const accentVar  = getCssVar("--color-accent", "#2563EB");
  const surfaceVar = getCssVar("--color-surface", "#FFFFFF");

  const bgRGB      = parseCssColor(bgVar, "#FFFFFF");
  const textRGB    = parseCssColor(textVar, "#0A0A0A");
  const accentRGB  = parseCssColor(accentVar, "#2563EB");
  const surfaceRGB = parseCssColor(surfaceVar, "#FFFFFF");

  // tiny helper to make a very subtle tint for zebra rows / lines
  const tint = ([r, g, b]: [number, number, number], amt = 10): [number, number, number] => {
    const clamp = (x: number) => Math.max(0, Math.min(255, x));
    return [clamp(r + amt), clamp(g + amt), clamp(b + amt)];
  };

  // Paint full-page background so dark mode exports dark
  doc.setFillColor(...bgRGB);
  doc.rect(0, 0, pageW, doc.internal.pageSize.getHeight(), "F");

  // Header
  doc.setTextColor(...textRGB);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(form.businessName || "Invoice", 14, 18);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Invoice No: ${form.invoiceNo}`, 14, 26);
  doc.text(`Date: ${fmtDate(form.date)}`, 14, 31);
  if (form.place) doc.text(`Place: ${form.place}`, 14, 36);

  // Table
  const currency = form.symbol === "₹" ? "Rs." : form.symbol;

  autoTable(doc, {
    startY: 44,
    head: [[
      "S.N", "Description", "Qty", "Unit",
      `Rate (${currency})`, `Disc (${currency})`, `Amount (${currency})`
    ]],
    body: form.items.map((it, i) => {
      const amount = Math.max(0, (+it.qty || 0) * (+it.rate || 0) - (+it.discount || 0));
      return [
        String(i + 1),
        it.description || "",
        String(it.qty || 0),
        it.unit || "",
        nf2.format(+it.rate || 0),
        nf2.format(+it.discount || 0),
        nf2.format(amount),
      ];
    }),
    theme: "grid",

    // header in accent
    headStyles: {
      fillColor: accentRGB,
      textColor: [255, 255, 255],
      fontStyle: "bold",
      halign: "left",
    },

    // IMPORTANT: force body background & borders to theme
    styles: {
      font: "helvetica",
      fontSize: 9,
      cellPadding: 2,
      textColor: textRGB,
      fillColor: surfaceRGB,           // <-- this is the key line
      lineColor: tint(surfaceRGB, 18),
      lineWidth: 0.15,
    },
    alternateRowStyles: {
      fillColor: tint(surfaceRGB, 8),  // subtle zebra that still matches theme
    },
    tableLineColor: tint(surfaceRGB, 18),
    columnStyles: {
      0: { halign: "center", cellWidth: 10 },
      2: { halign: "right",  cellWidth: 14 },
      3: { halign: "center", cellWidth: 14 },
      4: { halign: "right",  cellWidth: 22 },
      5: { halign: "right",  cellWidth: 22 },
      6: { halign: "right",  cellWidth: 24 },
    },

    // safety: if any cell still comes out pure white, repaint it
    didParseCell: (data) => {
      const fc = data.cell.styles.fillColor as [number, number, number] | undefined;
      if (fc && fc[0] === 255 && fc[1] === 255 && fc[2] === 255) {
        data.cell.styles.fillColor = surfaceRGB;
      }
    },
  });

  // Totals
  const m = (n: number) => `${currency}${nf2.format(+n || 0)}`;
  let y = (doc as any).lastAutoTable.finalY + 8;
  const rightX = pageW - 12;
  const row = (label: string, value: string, strong = false, accent = false) => {
    doc.setFont("helvetica", strong ? "bold" : "normal");
    doc.setFontSize(strong ? 11 : 10);
    doc.setTextColor(...(accent ? accentRGB : textRGB));
    doc.text(label, rightX - 60, y);
    doc.text(value, rightX, y, { align: "right" });
    y += 6;
  };

  row("Subtotal",         m(totals.subtotal));
  row("Overall Discount", m(+form.overallDiscount || 0));
  row("Round Off",        m(totals.roundoff));
  row("Grand Total",      m(totals.grand), true, true);

  doc.save(`${form.invoiceNo.replace(/[^a-zA-Z0-9-_]/g, "_")}.pdf`);
};


  return (
    <div className="min-h-screen bg-bg text-text py-8 px-4">
      <div className="mx-auto max-w-6xl space-y-6">

        {/* Top bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 grid place-items-center rounded-2xl text-white font-extrabold shadow"
              style={{ background: "var(--color-accent)" }}>
              IN
            </div>
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight">Modern Invoice Generator</h1>
              <p className="text-sm opacity-70">Theme-synced PDF & PNG • Draft autosave • History</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button className="btn-ghost inline-flex items-center gap-2" onClick={() => setDark(d => !d)}>
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              {dark ? "Light" : "Dark"}
            </button>
            <button className="btn-ghost inline-flex items-center gap-2" onClick={() => saveNamed()}>
              <Save className="h-4 w-4" /> Save
            </button>
            <button className="btn-ghost inline-flex items-center gap-2" onClick={() => setShowHistory(true)}>
              <History className="h-4 w-4" /> History
            </button>
          </div>
        </div>

        {/* Form + Items */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* left */}
          <section className="lg:col-span-2 space-y-4">
            <div className="bg-surface rounded-xl p-5 shadow">
              <h3 className="font-semibold mb-3">Header</h3>
              <div className="grid sm:grid-cols-2 gap-3">
                <input className="input" placeholder="Business Name"
                  value={form.businessName}
                  onChange={e => setForm({ ...form, businessName: e.target.value })} />
                <input className="input" placeholder="Customer Name"
                  value={form.customerName}
                  onChange={e => setForm({ ...form, customerName: e.target.value })} />
                <input className="input" placeholder="Invoice No"
                  value={form.invoiceNo}
                  onChange={e => setForm({ ...form, invoiceNo: e.target.value })} />
                <input className="input" type="date"
                  value={form.date}
                  onChange={e => setForm({ ...form, date: e.target.value })} />
                <input className="input" placeholder="Place of Issue"
                  value={form.place}
                  onChange={e => setForm({ ...form, place: e.target.value })} />
                <div className="flex items-center gap-2">
                  <select
                    className="input"
                    value={form.symbol === "₹" ? "INR" : "OTHER"}
                    onChange={(e) => setForm({ ...form, symbol: e.target.value === "INR" ? "₹" : form.symbol })}
                  >
                    <option value="INR">INR – ₹</option>
                    <option value="OTHER">Custom</option>
                  </select>
                  <input className="input" value={form.symbol}
                    onChange={e => setForm({ ...form, symbol: e.target.value })} />
                </div>
              </div>
            </div>

            <div className="bg-surface rounded-xl p-5 shadow">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-semibold">Items</h3>
                <button className="btn-ghost inline-flex items-center gap-2" onClick={addItem}>
                  <Plus className="h-4 w-4" /> Add row
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left">
                      <th className="px-2 py-2 w-10 text-center">#</th>
                      <th className="px-2 py-2">Description</th>
                      <th className="px-2 py-2 w-24 text-right">Qty</th>
                      <th className="px-2 py-2 w-24 text-center">Unit</th>
                      <th className="px-2 py-2 w-28 text-right">Rate</th>
                      <th className="px-2 py-2 w-28 text-right">Discount</th>
                      <th className="px-2 py-2 w-24 text-center hidden md:table-cell">HSN</th>
                      <th className="px-2 py-2 w-24 text-center hidden md:table-cell">SKU</th>
                      <th className="px-2 py-2 w-28 text-right">Amount</th>
                      <th className="px-2 py-2 w-12 text-center">Del</th>
                    </tr>
                  </thead>
                  <tbody className="align-middle">
                    {form.items.map((it, i) => {
                      const amount = Math.max(0, (+it.qty || 0) * (+it.rate || 0) - (+it.discount || 0));
                      return (
                        <tr key={i} className="border-t">
                          <td className="px-2 py-2 text-center">{i + 1}</td>
                          <td className="px-2 py-2">
                            <input className="input" placeholder="Description"
                              value={it.description}
                              onChange={e => setItem(i, { description: e.target.value })} />
                          </td>
                          <td className="px-2 py-2">
                            <input className="input text-right" type="number" step={0.001}
                              value={it.qty}
                              onChange={e => setItem(i, { qty: e.target.value })} />
                          </td>
                          <td className="px-2 py-2">
                            <select className="input" value={it.unit}
                              onChange={e => setItem(i, { unit: e.target.value })}>
                              {["Pcs.", "Kg", "Ltr", "Mtr", "Set", "Box", "Nos"].map(u =>
                                <option key={u} value={u}>{u}</option>
                              )}
                            </select>
                          </td>
                          <td className="px-2 py-2">
                            <input className="input text-right" type="number" step={0.01}
                              value={it.rate}
                              onChange={e => setItem(i, { rate: e.target.value })} />
                          </td>
                          <td className="px-2 py-2">
                            <input className="input text-right" type="number" step={0.01}
                              value={it.discount}
                              onChange={e => setItem(i, { discount: e.target.value })} />
                          </td>
                          <td className="px-2 py-2 hidden md:table-cell">
                            <input className="input text-center" value={it.hsn}
                              onChange={e => setItem(i, { hsn: e.target.value })} />
                          </td>
                          <td className="px-2 py-2 hidden md:table-cell">
                            <input className="input text-center" value={it.sku}
                              onChange={e => setItem(i, { sku: e.target.value })} />
                          </td>
                          <td className="px-2 py-2">
                            <input className="input text-right bg-surface" readOnly
                              value={formatMoney(amount)} />
                          </td>
                          <td className="px-2 py-2 text-center">
                            <button className="inline-flex items-center justify-center h-9 w-9 rounded-xl border"
                              onClick={() => rmItem(i)}>
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 grid sm:grid-cols-[1fr,200px] gap-3">
                <div />
                <div>
                  <label className="block text-sm mb-1">Overall Discount</label>
                  <input className="input text-right" type="number" step={0.01}
                    value={form.overallDiscount}
                    onChange={e => setForm({ ...form, overallDiscount: e.target.value })} />
                </div>
              </div>
            </div>
          </section>

          {/* right: preview + totals */}
          <section className="space-y-4">
            <div className="bg-surface rounded-xl p-5 shadow">
              <h3 className="font-semibold mb-3">Preview</h3>
              <div ref={previewRef} className="rounded-xl border border-accent p-4 bg-surface">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-xl font-bold">{form.businessName || "Business"}</div>
                    <div className="text-sm opacity-70">Bill To: {form.customerName || "—"}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-accent font-bold">INVOICE</div>
                    <div className="text-sm">No: {form.invoiceNo}</div>
                    <div className="text-sm">Date: {form.date}</div>
                    {form.place && <div className="text-sm">Place: {form.place}</div>}
                  </div>
                </div>

                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left">
                        <th className="py-1 pr-2 w-8 text-center">#</th>
                        <th className="py-1 pr-2">Description</th>
                        <th className="py-1 pr-2 w-16 text-right">Qty</th>
                        <th className="py-1 pr-2 w-16 text-center">Unit</th>
                        <th className="py-1 pr-2 w-24 text-right">Rate ({form.symbol})</th>
                        <th className="py-1 pr-2 w-24 text-right">Disc ({form.symbol})</th>
                        <th className="py-1 pr-0 w-28 text-right">Amount ({form.symbol})</th>
                      </tr>
                    </thead>
                    <tbody>
                      {form.items.map((it, i) => {
                        const a = Math.max(0, (+it.qty || 0) * (+it.rate || 0) - (+it.discount || 0));
                        return (
                          <tr className="border-t" key={i}>
                            <td className="py-1 pr-2 text-center">{i + 1}</td>
                            <td className="py-1 pr-2">{it.description}</td>
                            <td className="py-1 pr-2 text-right">{String(it.qty || 0)}</td>
                            <td className="py-1 pr-2 text-center">{it.unit}</td>
                            <td className="py-1 pr-2 text-right">{nf2.format(+it.rate || 0)}</td>
                            <td className="py-1 pr-2 text-right">{nf2.format(+it.discount || 0)}</td>
                            <td className="py-1 pr-0 text-right">{nf2.format(a)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="bg-surface rounded-xl p-5 shadow space-y-2">
              <div className="flex justify-between"><span>Subtotal</span><span>{formatMoney(totals.subtotal)}</span></div>
              <div className="flex justify-between"><span>Overall Discount</span><span>{formatMoney(+form.overallDiscount || 0)}</span></div>
              <div className="flex justify-between"><span>Round Off</span><span>{formatMoney(totals.roundoff)}</span></div>
              <div className="border-t pt-2 mt-1 flex justify-between text-lg font-bold">
                <span>Grand Total</span><span className="text-accent">{formatMoney(totals.grand)}</span>
              </div>

              <div className="mt-3 flex gap-2">
                <button className="btn-primary inline-flex items-center gap-2" onClick={downloadPDF}>
                  <FileDown className="h-4 w-4" /> PDF
                </button>
                <button className="btn-ghost inline-flex items-center gap-2" onClick={downloadPNG}>
                  <ImageDown className="h-4 w-4" /> Image
                </button>
              </div>
            </div>
          </section>
        </div>

        {/* History modal */}
        {showHistory && (
          <div className="fixed inset-0 bg-black/40 grid place-items-center z-50">
            <div className="bg-surface rounded-xl p-5 w-[min(680px,92vw)] shadow-xl">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">Saved Invoices</h3>
                <button className="btn-ghost" onClick={() => setShowHistory(false)}>Close</button>
              </div>
              {savedKeys().length === 0 ? (
                <div className="text-sm opacity-70">No saved invoices yet.</div>
              ) : (
                <ul className="divide-y">
                  {savedKeys().map(k => (
                    <li key={k} className="py-2 flex items-center justify-between">
                      <div className="font-mono text-sm">{k.replace(SAVE_PREFIX, "")}</div>
                      <div className="flex gap-2">
                        <button className="btn-ghost" onClick={() => loadNamed(k)}>Load</button>
                        <button className="btn-ghost" onClick={() => deleteNamed(k)}>Delete</button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
