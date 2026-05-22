/**
 * csv.js — zero-dependency CSV parser for onboarding uploads.
 *
 * Required columns: fellow_name, start_date, task, status, owner, due_date, criticality
 * Optional columns: location, task_id
 *
 * One row per task. Multiple tasks for the same fellow share the same fellow_name and start_date.
 */

export function parseOnboardingCsv(csvText) {
  const rows = parseCsv(csvText.trim());
  if (rows.length < 2) throw new Error("CSV needs a header row and at least one data row.");

  const headers = rows[0].map(normalizeHeader);
  const records = rows.slice(1).map((row) => Object.fromEntries(headers.map((h, i) => [h, row[i] || ""])));

  const fellows = new Map();

  records.forEach((record, index) => {
    const name      = record.fellow_name || record.name;
    const startDate = record.start_date  || record.startdate;
    const taskLabel = record.task        || record.task_label;

    if (!name || !startDate || !taskLabel) {
      throw new Error(`CSV row ${index + 2} needs fellow_name, start_date, and task.`);
    }

    const id = slugify(name);
    if (!fellows.has(id)) {
      fellows.set(id, { id, name, startDate, location: record.location || "Unknown", tasks: [] });
    }

    fellows.get(id).tasks.push({
      id:          record.task_id || slugify(taskLabel),
      label:       taskLabel,
      owner:       normalizeOwner(record.owner || "ops"),
      dueDate:     record.due_date || record.duedate || startDate,
      status:      normalizeStatus(record.status || "pending"),
      criticality: normalizeCriticality(record.criticality || "medium"),
    });
  });

  return { label: "Uploaded onboarding data", generatedAt: new Date().toISOString(), fellows: Array.from(fellows.values()) };
}

// ── CSV tokeniser — handles quoted fields, escaped quotes, CRLF ──────────

function parseCsv(text) {
  const rows = [];
  let row = [], value = "", quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i], next = text[i + 1];

    if (char === '"' && quoted && next === '"') { value += '"'; i++; }
    else if (char === '"')                       { quoted = !quoted; }
    else if (char === "," && !quoted)            { row.push(value.trim()); value = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i++;
      row.push(value.trim()); rows.push(row); row = []; value = "";
    } else { value += char; }
  }

  row.push(value.trim());
  rows.push(row);
  return rows.filter((r) => r.some(Boolean));
}

// ── Normalizers ───────────────────────────────────────────────────────────

function normalizeHeader(h) {
  return h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function normalizeStatus(s) {
  const v = s.toLowerCase().trim().replace(/[\s-]+/g, "_");
  return ["done", "pending", "not_started", "blocked"].includes(v) ? v : "pending";
}

function normalizeOwner(o) {
  const v = o.toLowerCase().trim();
  return ["ops", "tech", "welcome-pack"].includes(v) ? v : "ops";
}

function normalizeCriticality(c) {
  const v = c.toLowerCase().trim();
  return ["low", "medium", "high"].includes(v) ? v : "medium";
}

function slugify(v) {
  return v.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
