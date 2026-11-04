// Question types, their configuration and answer validation.
import { fail, str } from "./http.js";

export const CAPABILITIES = ["info", "decide", "adapt", "align", "lead", "customer", "execute"];
export const TYPES = ["single", "multi", "likert", "slider", "grid", "rank", "text", "longtext", "number", "yesno"];
const OPTION_TYPES = new Set(["single", "multi", "rank"]);

const shortId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 10);
const intIn = (v, lo, hi, dflt) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : dflt;
};
const bi = (v, max = 300) => ({ en: str(v && v.en, max), he: str(v && v.he, max) });
const cap = (v) => (CAPABILITIES.includes(v) ? v : null);

function items(list, min, max, withCapability = false) {
  if (!Array.isArray(list)) list = [];
  if (list.length > max) fail(422, "too_many_items");
  const seen = new Set();
  const out = list.map((o) => {
    let id = typeof o.id === "string" && /^[a-z0-9]{1,16}$/.test(o.id) && !seen.has(o.id) ? o.id : shortId();
    seen.add(id);
    const item = { id, ...bi(o, 300) };
    if (withCapability) item.capability = cap(o.capability);
    return item;
  });
  if (out.length < min) fail(422, "too_few_items");
  return out;
}

function scaleLabels(labels, points) {
  const arr = Array.isArray(labels) ? labels : [];
  return Array.from({ length: points }, (_, i) => bi(arr[i] || {}, 80));
}

// Validates and normalizes an editor-supplied config for a question type.
export function normalizeConfig(type, cfg = {}) {
  if (!TYPES.includes(type)) fail(422, "bad_type");
  const c = cfg && typeof cfg === "object" ? cfg : {};
  switch (type) {
    case "single":
      return { options: items(c.options, 2, 40) };
    case "multi": {
      const options = items(c.options, 2, 40);
      const max = c.max === null || c.max === undefined || c.max === "" ? null : intIn(c.max, 1, options.length, null);
      return { options, max };
    }
    case "rank": {
      const options = items(c.options, 2, 20);
      const limit = c.limit === null || c.limit === undefined || c.limit === "" ? null : intIn(c.limit, 1, options.length, null);
      return { options, limit };
    }
    case "likert": {
      const points = intIn(c.points, 2, 11, 5);
      return { points, start: intIn(c.start, 0, 1, 1), labels: scaleLabels(c.labels, points), na: !!c.na };
    }
    case "grid": {
      const points = intIn(c.points, 2, 11, 5);
      return { rows: items(c.rows, 1, 30, true), points, start: intIn(c.start, 0, 1, 1), labels: scaleLabels(c.labels, points), na: !!c.na };
    }
    case "slider":
      return { start: intIn(c.start, -100, 100, 0), units: intIn(c.units, 1, 100, 10), left: bi(c.left, 80), right: bi(c.right, 80), na: !!c.na };
    case "text":
      return { maxLength: intIn(c.maxLength, 1, 500, 300) };
    case "longtext":
      return { maxLength: intIn(c.maxLength, 1, 5000, 3000) };
    case "number": {
      const num = (v) => (v === "" || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
      const min = num(c.min), max = num(c.max);
      if (min !== null && max !== null && min > max) fail(422, "bad_range");
      return { min, max, integer: !!c.integer };
    }
    case "yesno":
      return { na: !!c.na };
  }
}

// The parts of a config that answers depend on. Once a survey has answers these may not change.
export function structureOf(type, cfg) {
  const ids = (l) => (l || []).map((o) => o.id).join(",");
  switch (type) {
    case "single": case "multi": case "rank": return `${type}|${ids(cfg.options)}|${cfg.max ?? ""}|${cfg.limit ?? ""}`;
    case "likert": return `${type}|${cfg.points}|${cfg.start}|${cfg.na}`;
    case "grid": return `${type}|${ids(cfg.rows)}|${(cfg.rows || []).map((r) => r.capability || "").join(",")}|${cfg.points}|${cfg.start}|${cfg.na}`;
    case "slider": return `${type}|${cfg.start}|${cfg.units}|${cfg.na}`;
    case "number": return `${type}|${cfg.min}|${cfg.max}|${cfg.integer}`;
    case "yesno": return `${type}|${cfg.na}`;
    default: return `${type}|${cfg.maxLength}`;
  }
}

// Validates one answer. Returns the normalized value, or null for "no answer".
export function validateAnswer(q, value) {
  if (value === null || value === undefined || value === "") return null;
  const c = q.config;
  const bad = () => fail(422, "bad_answer", { question: q.id });
  const optIds = () => new Set((c.options || []).map((o) => o.id));
  switch (q.type) {
    case "single":
      if (typeof value !== "string" || !optIds().has(value)) bad();
      return value;
    case "multi": {
      if (!Array.isArray(value)) bad();
      const ids = optIds();
      const v = [...new Set(value)];
      if (v.some((x) => !ids.has(x))) bad();
      if (c.max && v.length > c.max) bad();
      return v.length ? v : null;
    }
    case "rank": {
      if (!Array.isArray(value)) bad();
      const ids = optIds();
      const v = [...new Set(value)];
      if (v.some((x) => !ids.has(x))) bad();
      if (c.limit && v.length > c.limit) bad();
      return v.length ? v : null;
    }
    case "likert":
      if (value === "na" && c.na) return "na";
      if (!Number.isInteger(value) || value < c.start || value > c.start + c.points - 1) bad();
      return value;
    case "grid": {
      if (typeof value !== "object" || Array.isArray(value)) bad();
      const rows = new Set(c.rows.map((r) => r.id));
      const out = {};
      for (const [k, v] of Object.entries(value)) {
        if (!rows.has(k)) bad();
        if (v === null || v === undefined || v === "") continue;
        if (v === "na" && c.na) out[k] = "na";
        else if (Number.isInteger(v) && v >= c.start && v <= c.start + c.points - 1) out[k] = v;
        else bad();
      }
      return Object.keys(out).length ? out : null;
    }
    case "slider":
      if (value === "na" && c.na) return "na";
      if (!Number.isInteger(value) || value < c.start || value > c.start + c.units) bad();
      return value;
    case "text":
    case "longtext": {
      if (typeof value !== "string") bad();
      const s = value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").trim();
      if (s.length > c.maxLength) fail(422, "too_long", { question: q.id });
      return s || null;
    }
    case "number": {
      const n = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(n)) bad();
      if (c.integer && !Number.isInteger(n)) bad();
      if ((c.min !== null && n < c.min) || (c.max !== null && n > c.max)) bad();
      return n;
    }
    case "yesno":
      if (value === "yes" || value === "no" || (value === "na" && c.na)) return value;
      bad();
  }
  bad();
}

// Is a required question fully answered?
export function isComplete(q, value) {
  if (value === null || value === undefined) return false;
  if (q.type === "grid") return q.config.rows.every((r) => value[r.id] !== undefined);
  return true;
}

export const hasOptions = (type) => OPTION_TYPES.has(type);
