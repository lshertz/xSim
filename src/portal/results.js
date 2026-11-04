// Results: aggregates, capability scores (Pulse methodology), individual responses, CSV export.
//
// Methodology (from the Pulse facilitator notes):
//   current state  = mean of the current-state items for a capability across respondents, N/A excluded
//   importance     = mean importance rating for the capability
//   priority gap   = importance x (scale maximum - current state); 5 - current on the Pulse's 1 to 5 scale
//   spread         = standard deviation of each respondent's own capability mean (perception divergence)
//   CEO vs team    = the CEO's scores against the rest of the team (xSim only)
import { fail, json, csvCell } from "./http.js";
import { access, loadStructure, isOpenFor } from "./surveys.js";
import { CAPABILITIES } from "./schema.js";

export const MIN_GROUP = 3; // customer Viewers see nothing until at least this many people have submitted

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const sd = (a) => {
  if (a.length < 2) return a.length ? 0 : null;
  const m = mean(a);
  return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1));
};
const r2 = (x) => (x === null || x === undefined ? null : Math.round(x * 100) / 100);

function shuffle(a) {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

async function loadData(env, s, includePartial) {
  const sections = await loadStructure(env, s.id);
  const asg = await env.DB.prepare(
    `SELECT a.user_id, a.is_ceo, a.started_at, a.submitted_at, a.answer_lang, u.name, u.email
       FROM survey_assignments a JOIN users u ON u.id = a.user_id WHERE a.survey_id = ?1 ORDER BY u.name COLLATE NOCASE`
  ).bind(s.id).all();
  const people = asg.results;
  const included = people.filter((p) => p.submitted_at || (includePartial && p.started_at));
  const ids = new Set(included.map((p) => p.user_id));
  const ans = await env.DB.prepare("SELECT user_id, question_id, value FROM survey_answers WHERE survey_id = ?1").bind(s.id).all();
  const byUser = new Map();
  for (const r of ans.results) {
    if (!ids.has(r.user_id)) continue;
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, new Map());
    byUser.get(r.user_id).set(r.question_id, JSON.parse(r.value));
  }
  return { sections, people, included, byUser };
}

function questionStats(q, included, byUser, full) {
  const vals = included.map((p) => byUser.get(p.user_id)?.get(q.id)).filter((v) => v !== undefined);
  const c = q.config;
  const out = { id: q.id, type: q.type, answered: vals.length };
  const scale = (list, start, points) => {
    const counts = Array.from({ length: points }, () => 0);
    let na = 0;
    const nums = [];
    for (const v of list) {
      if (v === "na") na++;
      else if (Number.isInteger(v)) {
        counts[v - start] = (counts[v - start] || 0) + 1;
        nums.push(v);
      }
    }
    return { counts, na, n: nums.length, mean: r2(mean(nums)), sd: r2(sd(nums)) };
  };
  switch (q.type) {
    case "likert":
      Object.assign(out, scale(vals, c.start, c.points));
      break;
    case "slider":
      Object.assign(out, scale(vals, c.start, c.units + 1));
      break;
    case "grid":
      out.rows = c.rows.map((row) => ({ id: row.id, ...scale(vals.map((v) => v[row.id]).filter((v) => v !== undefined), c.start, c.points) }));
      break;
    case "single":
    case "multi": {
      const counts = Object.fromEntries(c.options.map((o) => [o.id, 0]));
      for (const v of vals) for (const id of Array.isArray(v) ? v : [v]) if (id in counts) counts[id]++;
      out.counts = counts;
      break;
    }
    case "yesno": {
      const counts = { yes: 0, no: 0, na: 0 };
      for (const v of vals) counts[v] = (counts[v] || 0) + 1;
      out.counts = counts;
      break;
    }
    case "rank": {
      // Points: first place gets as many points as there are options, then one fewer for each place.
      const n = c.options.length;
      const score = Object.fromEntries(c.options.map((o) => [o.id, { points: 0, first: 0, picked: 0 }]));
      for (const v of vals) v.forEach((id, i) => {
        if (!score[id]) return;
        score[id].points += n - i;
        score[id].picked++;
        if (i === 0) score[id].first++;
      });
      out.scores = score;
      break;
    }
    case "number": {
      const nums = vals.filter((v) => typeof v === "number");
      out.n = nums.length;
      out.mean = r2(mean(nums));
      out.sd = r2(sd(nums));
      out.min = nums.length ? Math.min(...nums) : null;
      out.max = nums.length ? Math.max(...nums) : null;
      break;
    }
    case "text":
    case "longtext":
      // Free text is never shown to customer Viewers. For xSim it is listed without names, in random order.
      if (full) out.texts = shuffle(vals.filter((v) => typeof v === "string"));
      break;
  }
  return out;
}

// Capability scores across the people given.
function capabilityScores(sections, people, byUser) {
  const res = {};
  for (const key of CAPABILITIES) {
    const items = sections.filter((s) => s.capability === key).flatMap((s) => s.questions).filter((q) => q.type === "likert");
    const impRows = sections.flatMap((s) => s.questions).filter((q) => q.type === "grid")
      .flatMap((q) => q.config.rows.filter((r) => r.capability === key).map((r) => ({ q, r })));
    if (!items.length && !impRows.length) continue;
    const all = [];
    const perPerson = [];
    for (const p of people) {
      const mine = [];
      for (const q of items) {
        const v = byUser.get(p.user_id)?.get(q.id);
        if (Number.isInteger(v)) mine.push(v);
      }
      all.push(...mine);
      if (mine.length) perPerson.push(mean(mine));
    }
    const imp = [];
    for (const p of people) for (const { q, r } of impRows) {
      const v = byUser.get(p.user_id)?.get(q.id)?.[r.id];
      if (Number.isInteger(v)) imp.push(v);
    }
    const scaleMax = items.length ? items[0].config.start + items[0].config.points - 1 : null;
    const current = mean(all);
    const importance = mean(imp);
    res[key] = {
      items: items.length,
      current: r2(current),
      importance: r2(importance),
      gap: current !== null && importance !== null && scaleMax !== null ? r2(importance * (scaleMax - current)) : null,
      scale_max: scaleMax,
      spread: r2(sd(perPerson)),
      low: perPerson.length ? r2(Math.min(...perPerson)) : null,
      high: perPerson.length ? r2(Math.max(...perPerson)) : null,
      n: perPerson.length,
    };
  }
  return res;
}

export async function routeResults(ctx) {
  const { env, path, method, me, url } = ctx;
  const m = path.match(/^surveys\/([0-9a-f-]{36})\/(results|responses|export)(?:\/([0-9a-f-]{36}))?$/);
  if (!m || method !== "GET") return null;
  const [, sid, sub, userId] = m;
  const { survey: s, can } = await access(env, me, sid);
  if (!can.results) fail(403, "forbidden");
  const full = can.results === "full";

  if (sub === "results") {
    const partial = full && url.searchParams.get("partial") === "1";
    const { sections, people, included, byUser } = await loadData(env, s, partial);
    const counts = {
      assigned: people.length,
      started: people.filter((p) => p.started_at && !p.submitted_at).length,
      submitted: people.filter((p) => p.submitted_at).length,
      included: included.length,
    };
    // Customer Viewers see results only once the survey is closed, so they cannot compare results before and
    // after one more person submits (which would reveal that person's answers), and only with enough respondents.
    if (!full && isOpenFor(s)) {
      return json({ ok: true, hidden: true, reason: "open", min_group: MIN_GROUP, counts: { submitted: counts.submitted } });
    }
    if (!full && included.length < MIN_GROUP) {
      return json({ ok: true, hidden: true, reason: "few", min_group: MIN_GROUP, counts: { submitted: counts.submitted } });
    }
    const out = {
      ok: true,
      full,
      partial,
      min_group: MIN_GROUP,
      counts,
      capabilities: capabilityScores(sections, included, byUser),
      questions: sections.flatMap((sec) => sec.questions)
        .filter((q) => full || !["text", "longtext"].includes(q.type))
        .map((q) => questionStats(q, included, byUser, full)),
    };
    if (full) {
      out.people = people.map((p) => ({
        id: p.user_id, name: p.name, email: p.email, is_ceo: !!p.is_ceo, started_at: p.started_at, submitted_at: p.submitted_at, answer_lang: p.answer_lang,
      }));
      const ceo = included.find((p) => p.is_ceo);
      if (ceo) {
        out.ceo = {
          ceo: capabilityScores(sections, [ceo], byUser),
          team: capabilityScores(sections, included.filter((p) => !p.is_ceo), byUser),
        };
      }
    }
    return json(out);
  }

  if (!full) fail(403, "forbidden");

  // GET surveys/:id/responses/:userId -> one person's answers (xSim only)
  if (sub === "responses" && userId) {
    const a = await env.DB.prepare(
      "SELECT a.*, u.name, u.email FROM survey_assignments a JOIN users u ON u.id = a.user_id WHERE a.survey_id = ?1 AND a.user_id = ?2"
    ).bind(s.id, userId).first();
    if (!a) fail(404, "not_found");
    const ans = await env.DB.prepare("SELECT question_id, value, updated_at FROM survey_answers WHERE survey_id = ?1 AND user_id = ?2").bind(s.id, userId).all();
    return json({
      ok: true,
      person: { id: a.user_id, name: a.name, email: a.email, is_ceo: !!a.is_ceo, started_at: a.started_at, submitted_at: a.submitted_at, answer_lang: a.answer_lang },
      answers: Object.fromEntries(ans.results.map((r) => [r.question_id, JSON.parse(r.value)])),
    });
  }

  // GET surveys/:id/export?lang=en|he -> CSV, one row per respondent (xSim only)
  if (sub === "export") {
    const lang = url.searchParams.get("lang") === "he" ? "he" : "en";
    const pick = (o) => (o ? o[lang] || o.en || o.he || "" : "");
    const qText = (q) => (lang === "he" ? q.text_he || q.text_en : q.text_en || q.text_he);
    const { sections, people } = await loadData(env, s, true);
    const ans = await env.DB.prepare("SELECT user_id, question_id, value FROM survey_answers WHERE survey_id = ?1").bind(s.id).all();
    const byUser = new Map();
    for (const r of ans.results) {
      if (!byUser.has(r.user_id)) byUser.set(r.user_id, new Map());
      byUser.get(r.user_id).set(r.question_id, JSON.parse(r.value));
    }
    const qs = sections.flatMap((sec) => sec.questions);
    const header = ["UID", "Name", "Email", "CEO", "Started", "Submitted", "Language"];
    const cols = [];
    qs.forEach((q, i) => {
      if (q.type === "grid") q.config.rows.forEach((r) => { header.push(`Q${i + 1} ${qText(q)}: ${pick(r)}`); cols.push({ q, row: r.id }); });
      else { header.push(`Q${i + 1} ${qText(q)}`); cols.push({ q }); }
    });
    const label = (q, id) => pick((q.config.options || []).find((o) => o.id === id)) || id;
    const cell = (q, v, row) => {
      if (v === undefined || v === null) return "";
      if (row) return v[row] ?? "";
      if (q.type === "single") return label(q, v);
      if (q.type === "multi") return v.map((id) => label(q, id)).join("; ");
      if (q.type === "rank") return v.map((id, i) => `${i + 1}. ${label(q, id)}`).join("; ");
      return v;
    };
    const lines = [header.map(csvCell).join(",")];
    for (const p of people) {
      const mine = byUser.get(p.user_id) || new Map();
      const row = [p.user_id, p.name, p.email, p.is_ceo ? "yes" : "", p.started_at || "", p.submitted_at || "", p.answer_lang || ""];
      for (const c of cols) row.push(cell(c.q, mine.get(c.q.id), c.row));
      lines.push(row.map(csvCell).join(","));
    }
    const name = `xsim-survey-${s.id.slice(0, 8)}.csv`;
    return new Response("﻿" + lines.join("\r\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  return null;
}
