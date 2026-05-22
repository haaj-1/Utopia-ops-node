/**
 * Utopia Ops — dashboard UI
 *
 * Single-file vanilla JS app wrapped in an IIFE to avoid polluting global scope.
 * No bundler, no framework — just fetch() calls to the backend API.
 *
 * Data flow:
 *   Boot → runAgent() → /api/analyze/linear → render()
 *   Add fellow → createNewFellow() → /api/analyze/new-fellow-linear → render()
 *   Send Slack → sendDeptReminder() → /api/actions/slack/reminders
 *   Generate AI → generateAllDeptMessages() → /api/actions/llm/all-departments
 */
(function () {

  // ── State ─────────────────────────────────────────────────────────────────
  // Single source of truth for the current agent result and UI state.
  const state = {
    scenarioKey: "baseline",
    result: null,
    source: "linear",           // always boot from Linear
    sentDepts: new Set(),       // depts whose drafts have been sent — skip re-render until refresh
  };

  // ── Element refs ──────────────────────────────────────────────────────────
  const el = {
    pageTitle:          document.querySelector("#page-title"),
    apiStatus:          document.querySelector("#api-status"),
    themeToggle:        document.querySelector("#theme-toggle"),
    refreshAgent:       document.querySelector("#refresh-agent"),
    copyJson:           document.querySelector("#copy-json"),
    copyJsonLogs:       document.querySelector("#copy-json-logs"),
    sourceLabel:        document.querySelector("#source-label"),
    csvUpload:          document.querySelector("#csv-upload"),
    newFellowForm:      document.querySelector("#new-fellow-form"),
    newFellowFeedback:  document.querySelector("#new-fellow-feedback"),
    createFellowLinear: document.querySelector("#create-fellow-linear"),
    linearSyncBtn:      document.querySelector("#linear-sync-btn"),
    refreshConnectors:  document.querySelector("#refresh-connectors"),
    schedulerDot:       document.querySelector("#scheduler-dot"),
    schedulerSummary:   document.querySelector("#scheduler-summary"),
    schedulerToggle:    document.querySelector("#scheduler-toggle"),
    schedulerRunNow:    document.querySelector("#scheduler-run-now"),
    schedulerLastRun:   document.querySelector("#scheduler-last-run"),
    // Dashboard-page scheduler (mirrors the Integrations card)
    schedulerDotMain:     document.querySelector("#scheduler-dot-main"),
    schedulerSummaryMain: document.querySelector("#scheduler-summary-main"),
    schedulerToggleMain:  document.querySelector("#scheduler-toggle-main"),
    schedulerRunNowMain:  document.querySelector("#scheduler-run-now-main"),
    schedulerLastRunMain: document.querySelector("#scheduler-last-run-main"),
    kpiTrack:           document.querySelector("#kpi-track"),
    kpiTrackNote:       document.querySelector("#kpi-track-note"),
    kpiRisk:            document.querySelector("#kpi-risk"),
    kpiHealth:          document.querySelector("#kpi-health"),
    kpiActions:         document.querySelector("#kpi-actions"),
    riskRows:           document.querySelector("#risk-rows"),
    // Dept tabs
    deptTabs:           document.querySelectorAll(".dept-tab"),
    deptPanels:         document.querySelectorAll(".dept-panel"),
    slackMsgOps:        document.querySelector("#slack-msg-ops"),
    slackMsgTech:       document.querySelector("#slack-msg-tech"),
    deptChannelOps:     document.querySelector("#dept-channel-ops"),
    deptChannelTech:    document.querySelector("#dept-channel-tech"),
    generateAllDepts:   document.querySelector("#generate-all-depts"),
    editOps:            document.querySelector("#edit-ops"),
    editTech:           document.querySelector("#edit-tech"),
    sendOps:            document.querySelector("#send-ops"),
    sendTech:           document.querySelector("#send-tech"),
    sendAllDepts:       document.querySelector("#send-all-depts"),
    // Other panels
    escalationSide:     document.querySelector("#escalation-side"),
    escCount:           document.querySelector("#esc-count"),
    slackList:          document.querySelector("#slack-list"),
    escalationList:     document.querySelector("#escalation-list"),
    postDigestAlt:      document.querySelector("#post-digest-alt"),
    jsonOutput:         document.querySelector("#json-output"),
    navButtons:         document.querySelectorAll(".nav-button"),
    panels:             document.querySelectorAll(".page-panel")
  };

  // ── API calls ─────────────────────────────────────────────────────────────

  /**
   * Primary data fetch. Always tries Linear first.
   * CSV source can't be re-fetched so it keeps the current result on refresh.
   */
  async function runAgent() {
    try {
      el.refreshAgent.textContent = "Loading...";
      let res;
      if (state.source === "linear" || state.source === "scenario") {
        // Always try Linear first on boot and refresh
        res = await fetch("/api/analyze/linear", { method: "POST" });
        if (res.ok) {
          state.source = "linear";
        } else {
          // Linear not configured or no projects — show empty state
          state.result = null;
          renderEmpty();
          return;
        }
      } else if (state.source === "sheets") {
        res = await fetch("/api/analyze/sheets", { method: "POST" });
      } else if (state.source === "csv") {
        // CSV can't be re-fetched — keep current result
        return;
      } else {
        res = await fetch("/api/analyze/linear", { method: "POST" });
        if (res.ok) state.source = "linear";
        else { renderEmpty(); return; }
      }
      const payload = await res.json();
      if (!res.ok) { renderEmpty(payload.error); return; }
      if (payload._empty) { renderEmpty(); return; }
      state.result = payload;
      render();
    } finally {
      el.refreshAgent.textContent = "↻ Refresh";
    }
  }

  function renderEmpty(message) {
    const msg = message || "No onboarding projects found in Linear. Add a fellow to get started.";
    if (el.riskRows) el.riskRows.innerHTML = `<div class="empty-state" style="padding:24px;color:var(--muted);">${escHtml(msg)}</div>`;
    if (el.kpiTrack) el.kpiTrack.textContent = "—";
    if (el.kpiTrackNote) el.kpiTrackNote.textContent = "No data";
    if (el.kpiRisk) el.kpiRisk.textContent = "—";
    if (el.kpiHealth) el.kpiHealth.textContent = "—";
    if (el.kpiActions) el.kpiActions.textContent = "—";
    if (el.sourceLabel) el.sourceLabel.textContent = "No data";
    if (el.escalationSide) el.escalationSide.innerHTML = `<div class="empty-state">No data.</div>`;
    if (el.slackMsgOps) el.slackMsgOps.innerHTML = `<p style="color:var(--faint)">Add a fellow to generate a draft.</p>`;
    if (el.slackMsgTech) el.slackMsgTech.innerHTML = `<p style="color:var(--faint)">Add a fellow to generate a draft.</p>`;
  }

  async function importCsv(file) {
    if (!file) return;
    const text = await file.text();
    const res = await fetch("/api/analyze/csv", {
      method: "POST",
      headers: { "Content-Type": "text/csv" },
      body: text
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || "CSV import failed.");
    state.result = payload;
    state.source = "csv";
    render();
  }

  async function createNewFellow(form) {
    const data = new FormData(form);
    const name = String(data.get("name") || "").trim();
    const startDate = String(data.get("startDate") || "").trim();
    if (!name || !startDate) return;

    const btn = el.createFellow || form.querySelector("button[type=submit]");
    const orig = btn?.textContent;
    try {
      if (btn) btn.textContent = "Generating...";
      if (el.newFellowFeedback) {
        el.newFellowFeedback.textContent = "";
        el.newFellowFeedback.classList.remove("error");
      }

      // If Linear is connected, push to Linear and then sync all fellows back
      const linearConnected = document.querySelector('[data-connector="linear"] .status-dot')?.classList.contains("ready");

      if (linearConnected) {
        if (btn) btn.textContent = "Pushing to Linear...";
        const res = await fetch("/api/analyze/new-fellow-linear", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, startDate })
        });
        const payload = await res.json();
        if (!res.ok) throw new Error(payload.error || "Could not push to Linear.");

        const projectUrl = payload.linear?.project?.url;

        // Build draft only for the new fellow before syncing
        const newFellowDrafts = buildSingleFellowDrafts(name, startDate, payload.fellows?.[0]?.tasks || []);

        // Sync all fellows from Linear for the risk table
        if (btn) btn.textContent = "Syncing...";
        let fullResult = payload;
        try {
          const syncRes = await fetch("/api/analyze/linear", { method: "POST" });
          const syncPayload = await syncRes.json();
          if (syncRes.ok && !syncPayload._empty) fullResult = syncPayload;
        } catch { /* keep single-fellow result */ }

        // Use full result for risk table/KPIs but only new fellow's draft
        state.result = { ...fullResult, slack_drafts: newFellowDrafts };
        state.source = "linear";
        state.sentDepts.clear();
        form.reset();
        render();

        if (el.newFellowFeedback) {
          el.newFellowFeedback.innerHTML = projectUrl
            ? `Pushed to Linear and dashboard synced. <a href="${projectUrl}" target="_blank" rel="noopener">Open project ↗</a>`
            : "Pushed to Linear and dashboard synced.";
          el.newFellowFeedback.classList.remove("error");
        }
      } else {
        // No Linear — just generate locally
        const res = await fetch("/api/analyze/new-fellow", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, startDate })
        });
        const payload = await res.json();
        if (!res.ok) throw new Error(payload.error || "Could not create fellow checklist.");
        state.result = payload;
        form.reset();
        render();
        if (el.newFellowFeedback) el.newFellowFeedback.textContent = "Checklist generated.";
      }
    } catch (err) {
      if (el.newFellowFeedback) {
        el.newFellowFeedback.textContent = err.message || "Could not create checklist.";
        el.newFellowFeedback.classList.add("error");
      }
    } finally {
      if (btn && orig) btn.textContent = orig;
    }
  }

  // Create fellow AND push all 7 tasks to Linear as a project
  async function createFellowInLinear() {
    const form = el.newFellowForm;
    if (!form) return;
    const data = new FormData(form);
    const name = String(data.get("name") || "").trim();
    const startDate = String(data.get("startDate") || "").trim();
    if (!name || !startDate) {
      if (el.newFellowFeedback) {
        el.newFellowFeedback.textContent = "Enter a name and start date first.";
        el.newFellowFeedback.classList.add("error");
      }
      return;
    }

    const btn = el.createFellowLinear;
    const orig = btn?.textContent;
    try {
      if (btn) btn.textContent = "Pushing to Linear...";
      if (el.newFellowFeedback) {
        el.newFellowFeedback.textContent = "";
        el.newFellowFeedback.classList.remove("error");
      }

      const res = await fetch("/api/analyze/new-fellow-linear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, startDate })
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Could not push to Linear.");

      const projectUrl = payload.linear?.project?.url;

      // Build draft only for this new fellow before syncing
      const newFellowDrafts = buildSingleFellowDrafts(name, startDate, payload.fellows?.[0]?.tasks || []);

      // Sync all fellows from Linear for the risk table
      let fullResult = payload;
      try {
        const syncRes = await fetch("/api/analyze/linear", { method: "POST" });
        const syncPayload = await syncRes.json();
        if (syncRes.ok && !syncPayload._empty) fullResult = syncPayload;
      } catch { /* keep single-fellow result */ }

      state.result = { ...fullResult, slack_drafts: newFellowDrafts };
      state.sentDepts.clear();
      form.reset();
      render();

      if (el.newFellowFeedback) {
        el.newFellowFeedback.innerHTML = projectUrl
          ? `Project created in Linear. <a href="${projectUrl}" target="_blank" rel="noopener">Open in Linear ↗</a>`
          : "Project created in Linear.";
        el.newFellowFeedback.classList.remove("error");
      }
    } catch (err) {
      if (el.newFellowFeedback) {
        el.newFellowFeedback.textContent = err.message || "Could not push to Linear.";
        el.newFellowFeedback.classList.add("error");
      }
    } finally {
      if (btn && orig) btn.textContent = orig;
    }
  }

  /**
   * Build Slack draft messages for a single new fellow on the frontend.
   * Used immediately after adding a fellow so the draft shows only that person —
   * not the full Linear sync which would include all existing fellows.
   */
  function buildSingleFellowDrafts(fellowName, startDate, tasks) {
    const drafts = {};
    for (const owner of ["ops", "tech"]) {
      const teamLabel = owner === "ops" ? "Ops Team" : "Tech Team";
      const ownerTasks = tasks.filter(t => t.owner === owner && t.status !== "done");
      if (!ownerTasks.length) {
        drafts[owner] = `Hi ${teamLabel},\n\nAll onboarding items for your function are currently on track. Please confirm your checklist is complete ahead of ${fellowName}'s start date.`;
        continue;
      }
      const lines = ownerTasks.map(task => {
        const isRed = task.is_overdue || task.status === "blocked";
        if (isRed) {
          return `🔴 ${fellowName} (starts ${startDate}) — ${task.label}: overdue — was due ${task.due_date}. Requires immediate action.`;
        }
        const statusNote = task.status === "not_started" ? "to be started" : (task.status_label || task.status).toLowerCase();
        return `• ${fellowName} (starts ${startDate}) — ${task.label}: ${statusNote}.`;
      }).join("\n");
      drafts[owner] = [
        `Hi ${teamLabel},`,
        ``,
        `Please action the following onboarding items for your function:`,
        ``,
        lines,
        ``,
        `Please update your progress on Linear once each item is complete. Thank you.`,
      ].join("\n");
    }
    return drafts;
  }

  // Pull live status from all active Linear onboarding projects
  async function syncFromLinear() {
    const btn = el.linearSyncBtn;
    const orig = btn?.textContent;
    try {
      if (btn) btn.textContent = "Syncing...";
      const res = await fetch("/api/analyze/linear", { method: "POST" });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Linear sync failed.");
      state.result = payload;
      state.source = "linear";
      render();
      if (btn) btn.textContent = "Synced ✓";
    } catch (err) {
      if (btn) btn.textContent = err.message.includes("No onboarding") ? "No projects found" : "Sync failed";
    } finally {
      setTimeout(() => { if (btn) btn.textContent = orig; }, 2500);
    }
  }

  async function loadConnectorStatus() {
    try {
      const res = await fetch("/api/connectors/status");
      const payload = await res.json();
      payload.connectors.forEach(updateConnectorCard);
    } catch {
      document.querySelectorAll("[data-connector]").forEach((card) => {
        const dot = card.querySelector(".status-dot");
        const btn = card.querySelector("button");
        if (dot) dot.className = "status-dot offline";
        if (btn) btn.textContent = "Server offline";
      });
    }
  }

  async function checkApiHealth() {
    try {
      const res = await fetch("/api/health");
      const payload = await res.json();
      el.apiStatus.textContent = payload.ok ? "Live" : "Issue";
      el.apiStatus.closest(".status-pill").style.background = payload.ok
        ? "var(--green-bg)" : "var(--red-bg)";
      el.apiStatus.closest(".status-pill").style.color = payload.ok
        ? "var(--green)" : "var(--red)";
      el.apiStatus.previousElementSibling.style.background = payload.ok
        ? "var(--green)" : "var(--red)";
    } catch {
      el.apiStatus.textContent = "Offline";
    }
  }

  async function runConnectorAction(action) {
    if (!state.result) await runAgent();

    if (action === "sheets-sync") {
      const res = await fetch("/api/analyze/sheets", { method: "POST" });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Sheet sync failed.");
      state.result = payload;
      render();
      return "Synced";
    }

    // "llm-status" has no dedicated route — just refresh connector status
    if (action === "llm-status") {
      await loadConnectorStatus();
      return "Refreshed";
    }

    const routes = {
      "slack-digest":  "/api/actions/slack/digest",
      "linear-issues": "/api/actions/linear/issues",
      "webhook":       "/api/actions/webhook"
    };

    if (!routes[action]) throw new Error(`Unknown action: ${action}`);

    const res = await fetch(routes[action], {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentResult: state.result })
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || "Action failed.");
    return "Sent ✓";
  }

  async function generateAllDeptMessages() {
    if (!state.result) return;
    const orig = el.generateAllDepts.textContent;
    try {
      el.generateAllDepts.textContent = "Generating...";
      const res = await fetch("/api/actions/llm/all-departments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentResult: state.result })
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "LLM failed.");

      const msgEls = { ops: el.slackMsgOps, tech: el.slackMsgTech };
      for (const [dept, data] of Object.entries(payload)) {
        if (msgEls[dept]) {
          msgEls[dept].innerHTML = data.error
            ? `<p style="color:var(--red)">${escHtml(data.error)}</p>`
            : safeP(data.message);
        }
      }
    } catch (err) {
      [el.slackMsgOps, el.slackMsgTech].forEach(e => {
        if (e) e.innerHTML = `<p style="color:var(--red)">${err.message}</p>`;
      });
    } finally {
      el.generateAllDepts.textContent = orig;
    }
  }

  async function sendDeptReminder(dept) {
    if (!state.result) return;
    const res = await fetch("/api/actions/slack/reminders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentResult: state.result })
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || "Send failed.");
    // Return result for the specific dept
    const deptResult = payload.results?.find(r => r.department === dept);
    if (deptResult && !deptResult.sent) throw new Error(deptResult.error || "Not configured.");
    return "Sent ✓";
  }

  async function sendAllDeptReminders() {
    if (!state.result) return;
    const res = await fetch("/api/actions/slack/reminders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentResult: state.result })
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || "Send failed.");
    const sent = payload.results?.filter(r => r.sent).length || 0;
    const failed = payload.results?.filter(r => !r.sent).length || 0;
    return `Sent to ${sent} dept${sent !== 1 ? "s" : ""}${failed ? `, ${failed} failed` : ""}`;
  }

  // ── Render ────────────────────────────────────────────────────────────────

  /**
   * Main render function. Called after every data fetch.
   * Reads state.result and updates all dashboard elements in one pass.
   */
  function render() {
    const r = state.result;
    if (!r) return;

    const totalTasks = r.fellows.reduce((s, f) => s + f.tasks.length, 0);
    const doneTasks  = r.fellows.reduce((s, f) => s + f.tasks.filter(t => t.status === "done").length, 0);
    const health     = totalTasks ? Math.round((doneTasks / totalTasks) * 100) : 0;
    const atRisk     = r.risk_counts.amber + r.risk_counts.red;
    const openActions = r.actions.slack_reminders.length + r.actions.escalations.length;

    el.kpiTrack.textContent     = r.fellows.length;
    el.kpiTrackNote.textContent = `${r.risk_counts.green} stable, ${r.risk_counts.amber} amber, ${r.risk_counts.red} red`;
    el.kpiRisk.textContent      = atRisk;
    el.kpiHealth.textContent    = `${health}%`;
    el.kpiActions.textContent   = openActions;
    el.sourceLabel.textContent  = state.source === "linear"
      ? "Live Linear data"
      : state.source === "csv"
        ? "Imported CSV"
        : r.source?.scenario || "Uploaded data";

    el.riskRows.innerHTML       = r.fellows.map(renderRiskRow).join("");
    renderDeptDrafts(r);
    el.escalationSide.innerHTML = renderEscalationSide(r.actions.escalations);
    el.escCount.textContent     = `${r.actions.escalations.length} item${r.actions.escalations.length !== 1 ? "s" : ""}`;
    el.slackList.innerHTML      = renderMessageList(r.actions.slack_reminders);
    el.escalationList.innerHTML = renderEscalationList(r.actions.escalations);
    el.jsonOutput.textContent   = JSON.stringify(r, null, 2);
  }

  function renderRiskRow(fellow) {
    const missing = renderMissingItems(fellow.missing_items);
    const owner   = fellow.blockers[0]?.owner || fellow.tasks.find(t => t.status !== "done")?.owner || "ops";
    const action  = fellow.risk_level === "green"
      ? "No action needed"
      : fellow.risk_level === "red"
        ? "Escalate today"
        : "Follow up with owner";

    return `
      <div class="risk-row">
        <div class="person-cell">
          <span class="avatar">${initials(fellow.name)}</span>
          <div>
            <div class="person-name">${fellow.name}</div>
            <div class="person-sub">Starts ${fellow.start_date}</div>
          </div>
        </div>
        <div><span class="risk-badge ${fellow.risk_level}">${riskLabel(fellow.risk_level)}</span></div>
        <div class="missing-cell">${missing}</div>
        <div class="owner-cell">${ownerLabel(owner)}</div>
        <div class="action-cell">${action}</div>
      </div>
    `;
  }

  /**
   * Render the Slack draft composer boxes.
   * Uses pre-built slack_drafts from the agent result when available.
   * Skips departments in state.sentDepts to preserve "Sent. Refresh to reload." messages.
   */
  function renderDeptDrafts(r) {
    const depts = { ops: el.slackMsgOps, tech: el.slackMsgTech };
    const channels = { ops: "#ops-onboarding", tech: "#studio-tech" };
    const channelEls = { ops: el.deptChannelOps, tech: el.deptChannelTech };

    for (const [dept, msgEl] of Object.entries(depts)) {
      if (!msgEl) continue;
      if (channelEls[dept]) channelEls[dept].textContent = channels[dept];

      // Don't overwrite a sent draft — keep "Sent. Refresh to reload."
      if (state.sentDepts.has(dept)) continue;

      // Use pre-built slack_drafts from agent if available
      const draft = r.slack_drafts?.[dept];
      if (draft) {
        msgEl.innerHTML = draft.split("\n").map(line => {
          if (!line.trim()) return `<br>`;
          const escaped = escHtml(line);
          if (line.startsWith("🔴")) return `<p style="color:var(--red);margin:2px 0;">${escaped}</p>`;
          if (line.startsWith("•")) return `<p style="margin:2px 0;">${escaped}</p>`;
          if (line.startsWith("Hi ")) return `<p style="font-weight:600;margin:0 0 8px;">${escaped}</p>`;
          return `<p style="margin:2px 0;color:var(--muted);">${escaped}</p>`;
        }).join("");
        continue;
      }

      // Fallback to raw reminders if no draft
      const reminders = r.actions.slack_reminders.filter(rem => rem.owner === dept);
      if (!reminders.length) {
        msgEl.innerHTML = `<p style="color:var(--muted)">No outstanding items for ${escHtml(dept)}.</p>`;
        continue;
      }
      msgEl.innerHTML = reminders.map(rem =>
        `<p>• <strong>${escHtml(rem.fellow_name)}</strong>: ${escHtml(rem.task)} — ${escHtml(rem.message)}</p>`
      ).join("");
    }
  }

  function renderEscalationSide(escalations) {
    if (!escalations.length) {
      return `<div class="empty-state">No escalations — all fellows on track.</div>`;
    }
    return `<div class="escalation-list">${escalations.map(esc => `
      <div class="escalation-item ${esc.risk_level}">
        <div class="esc-header">
          <span class="esc-name">${escHtml(esc.fellow_name)}</span>
          <span class="esc-level ${esc.risk_level}">${esc.risk_level.toUpperCase()}</span>
        </div>
        <div class="esc-reason">${escHtml(esc.reason)}</div>
      </div>
    `).join("")}</div>`;
  }

  function renderMessageList(items) {
    if (!items.length) return `<div class="empty-state">No reminders for this scenario.</div>`;
    return items.map(item => `
      <div class="message-card">
        <div class="message-card-channel">${item.channel}</div>
        <p>${renderReminderText(item)}</p>
      </div>
    `).join("");
  }

  function renderReminderText(item) {
    if (!item.due_date || !item.start_date) return item.message;
    const timing = item.timing_label || "target date set";
    const lead = typeof item.days_before_start === "number"
      ? `${item.days_before_start} day(s) before start`
      : "before start";
    return `${item.task} for ${item.fellow_name} is pending. Target date: ${item.due_date} (${timing}, ${lead}). Start date: ${item.start_date}. Please update owner/ETA.`;
  }

  function renderEscalationList(items) {
    if (!items.length) return `<div class="empty-state">No escalations generated.</div>`;
    return items.map(item => `
      <div class="message-card">
        <div class="message-card-channel">${item.risk_level.toUpperCase()} · ${ownerLabel(item.owner)}</div>
        <p><strong>${escHtml(item.fellow_name)}:</strong> ${escHtml(item.reason)}</p>
      </div>
    `).join("");
  }

  // ── UI helpers ────────────────────────────────────────────────────────────

  function updateConnectorCard(connector) {
    const card = document.querySelector(`[data-connector="${connector.id}"]`);
    if (!card) return;
    const dot = card.querySelector(".status-dot");
    const actionBtn = card.querySelector("button[data-action]");
    const configureBtn = card.querySelector(".configure-btn");
    const actionLabels = {
      slack: "Send digest",
      linear: "Create issues",
      google_sheets: "Sync sheet",
      json_webhook: "Send payload",
      llm: "Check LLM"
    };

    dot.className = `status-dot ${connector.connected ? "ready" : "offline"}`;
    if (actionBtn) {
      actionBtn.textContent = connector.connected
        ? actionLabels[connector.id] || "Run"
        : "Not configured";
      actionBtn.disabled = !connector.connected;
      actionBtn.title = connector.connected
        ? connector.capabilities?.join(", ") || ""
        : `Missing: ${connector.required_env?.join(", ") || ""}`;
    }
    if (configureBtn) {
      configureBtn.textContent = connector.connected ? "Reconfigure" : "Set env vars";
      configureBtn.title = connector.connected
        ? "Update your connector settings"
        : `Set ${connector.required_env?.join(", ")} to enable this connector`;
    }
  }

  function showPanel(section, activeBtn) {
    el.navButtons.forEach(b => b.classList.toggle("active", b === activeBtn));
    el.panels.forEach(p => p.classList.toggle("hidden", p.dataset.panel !== section));
    const titles = { dashboard: "Dashboard", actions: "Slack Actions", integrations: "Integrations", logs: "Agent Logs" };
    el.pageTitle.textContent = titles[section] || section;
  }

  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("utopia-theme", theme);
    el.themeToggle.textContent = theme === "dark" ? "Light mode" : "Dark mode";
  }

  // ── Safe text helpers (XSS prevention) ──────────────────────────────────
  function escHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function safeP(text) {
    // Converts newlines to <p> tags with escaped content
    return text.split(/\n+/).filter(Boolean)
      .map(line => `<p>${escHtml(line)}</p>`).join("");
  }

  function initials(name) {
    return name.split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase();
  }

  function riskLabel(risk) {
    return risk === "red" ? "Critical" : risk === "amber" ? "Warning" : "Stable";
  }

  function ownerLabel(owner) {
    return { ops: "Ops", tech: "Tech" }[owner] || owner;
  }

  // ── Event listeners ───────────────────────────────────────────────────────

  el.refreshAgent.addEventListener("click", () => {
    state.sentDepts.clear();
    runAgent();
  });

  el.themeToggle.addEventListener("click", () => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  });

  [el.copyJson, el.copyJsonLogs].forEach(btn => {
    if (!btn) return;
    btn.addEventListener("click", async () => {
      await navigator.clipboard.writeText(el.jsonOutput.textContent);
      const orig = btn.textContent;
      btn.textContent = "Copied ✓";
      setTimeout(() => { btn.textContent = orig; }, 1400);
    });
  });

  el.csvUpload.addEventListener("change", async e => {
    const orig = el.sourceLabel.textContent;
    try {
      el.sourceLabel.textContent = "Importing...";
      await importCsv(e.target.files[0]);
    } catch {
      el.sourceLabel.textContent = "Import failed";
      setTimeout(() => { el.sourceLabel.textContent = orig; }, 1800);
    } finally {
      e.target.value = "";
    }
  });

  if (el.newFellowForm) {
    el.newFellowForm.addEventListener("submit", async e => {
      e.preventDefault();
      await createNewFellow(e.currentTarget);
    });
  }

  if (el.createFellowLinear) {
    el.createFellowLinear.addEventListener("click", createFellowInLinear);
  }

  if (el.linearSyncBtn) {
    el.linearSyncBtn.addEventListener("click", syncFromLinear);
  }

  // CSV format popover — opens on ? click, closes on outside click
  const csvFormatBtn = document.querySelector("#csv-format-btn");
  const csvFormatPopover = document.querySelector("#csv-format-popover");
  if (csvFormatBtn && csvFormatPopover) {
    csvFormatBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      csvFormatPopover.classList.toggle("hidden");
    });
    document.addEventListener("click", (e) => {
      if (!csvFormatPopover.classList.contains("hidden") &&
          !csvFormatPopover.contains(e.target) &&
          e.target !== csvFormatBtn) {
        csvFormatPopover.classList.add("hidden");
      }
    });
  }

  function renderMissingItems(items) {
    if (!items.length) return "—";
    if (items.length === 1) return items[0];

    const [first, ...rest] = items;
    const restItems = rest.map(item => `<li>${item}</li>`).join("");
    return `
      <details class="missing-menu">
        <summary>${first} <span>+${rest.length}</span></summary>
        <ul>${restItems}</ul>
      </details>
    `;
  }

  async function loadSchedulerStatus() {
    const res = await fetch("/api/actions/scheduler/status");
    const status = await res.json();
    renderSchedulerStatus(status);
  }

  /**
   * Render scheduler status into both the dashboard card and the Integrations card.
   * Both cards share the same toggle/run-now logic so they stay in sync.
   */
  function renderSchedulerStatus(status) {
    function applyToEls(dotEl, summaryEl, toggleEl, lastRunEl) {
      if (toggleEl) {
        toggleEl.textContent = status.enabled ? "Turn off" : "Turn on";
        toggleEl.dataset.enabled = status.enabled ? "true" : "false";
        toggleEl.className = status.enabled ? "btn btn-primary" : "btn";
      }
      if (dotEl) dotEl.className = `status-dot ${status.enabled ? "ready" : "offline"}`;
      if (summaryEl) {
        summaryEl.textContent = status.enabled
          ? `Runs daily at ${status.time} Doha time.`
          : `Disabled — runs daily at ${status.time} Doha time when enabled.`;
      }
      if (lastRunEl) {
        const last = status.last_result;
        if (last) {
          const time = last.finished_at || last.started_at;
          const date = time ? new Date(time).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" }) : "—";
          const badge = last.ok
            ? `<span style="color:var(--green);">✓ ok</span>`
            : `<span style="color:var(--red);">✗ failed</span>`;
          lastRunEl.innerHTML = `Last run: ${date} — ${badge}`;
        } else {
          lastRunEl.textContent = "No scheduled run yet.";
        }
      }
    }

    // Integrations panel
    applyToEls(el.schedulerDot, el.schedulerSummary, el.schedulerToggle, el.schedulerLastRun);
    // Dashboard panel
    applyToEls(el.schedulerDotMain, el.schedulerSummaryMain, el.schedulerToggleMain, el.schedulerLastRunMain);
  }

  async function toggleScheduler() {
    // Read from whichever toggle button is present (dashboard or integrations panel)
    const currentState = (el.schedulerToggle?.dataset.enabled ?? el.schedulerToggleMain?.dataset.enabled) === "true";
    const enabled = !currentState;
    const res = await fetch("/api/actions/scheduler/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled })
    });
    renderSchedulerStatus(await res.json());
  }

  async function runSchedulerNow(e) {
    const btn = e?.currentTarget;
    if (!btn) return;
    const orig = btn.textContent;
    try {
      btn.textContent = "Running...";
      const res = await fetch("/api/actions/scheduler/run-now", { method: "POST" });
      const result = await res.json();
      await loadSchedulerStatus();
      btn.textContent = result.ok ? "Ran ✓" : "Failed";
    } catch {
      btn.textContent = "Failed";
    } finally {
      setTimeout(() => { btn.textContent = orig; }, 1800);
    }
  }

  el.refreshConnectors.addEventListener("click", async () => {
    el.refreshConnectors.textContent = "Refreshing...";
    await Promise.all([loadConnectorStatus(), loadSchedulerStatus(), checkApiHealth()]);
    setTimeout(() => { el.refreshConnectors.textContent = "Refresh status"; }, 900);
  });

  if (el.schedulerToggle) el.schedulerToggle.addEventListener("click", toggleScheduler);
  if (el.schedulerRunNow) el.schedulerRunNow.addEventListener("click", runSchedulerNow);
  if (el.schedulerToggleMain) el.schedulerToggleMain.addEventListener("click", toggleScheduler);
  if (el.schedulerRunNowMain) el.schedulerRunNowMain.addEventListener("click", runSchedulerNow);

  // Join all channels button
  const slackJoinBtn = document.querySelector("#slack-join-btn");
  if (slackJoinBtn) {
    slackJoinBtn.addEventListener("click", async () => {
      const orig = slackJoinBtn.textContent;
      try {
        slackJoinBtn.textContent = "Fetching channels...";

        // Fetch workspace channels
        const res = await fetch("/api/actions/slack/channels");
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Could not fetch channels");
        }
        const channels = await res.json();

        // Show picker modal
        showChannelPicker(channels, async (selected) => {
          if (!selected.length) return;
          slackJoinBtn.textContent = "Joining...";
          const joinRes = await fetch("/api/actions/slack/join-selected", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ channels: selected.map(c => c.id) })
          });
          const result = await joinRes.json();
          const joined = result.joined?.length || 0;
          const already = result.already?.length || 0;
          const failed = result.failed?.length || 0;
          slackJoinBtn.textContent = `Joined ${joined + already} channel${joined + already !== 1 ? "s" : ""}${failed ? `, ${failed} failed` : ""}`;
          setTimeout(() => { slackJoinBtn.textContent = orig; }, 3000);
        });

        slackJoinBtn.textContent = orig;
      } catch (err) {
        const msg = err.message.includes("Bot Token") ? "Set bot token first"
          : err.message.includes("missing_scope") ? "Add channels:read scope in Slack app"
          : err.message || "Failed";
        slackJoinBtn.textContent = msg;
        setTimeout(() => { slackJoinBtn.textContent = orig; }, 3500);
      }
    });
  }

  function showChannelPicker(channels, onConfirm) {
    // Remove any existing picker
    document.querySelector("#channel-picker-modal")?.remove();

    const modal = document.createElement("div");
    modal.id = "channel-picker-modal";
    modal.className = "channel-picker-overlay";
    modal.innerHTML = `
      <div class="channel-picker">
        <div class="channel-picker-header">
          <h3>Select channels to join</h3>
          <button class="btn btn-ghost" id="picker-close">✕</button>
        </div>
        <div class="channel-picker-search">
          <input type="text" id="picker-search" placeholder="Search channels…" autocomplete="off" />
        </div>
        <div class="channel-picker-list" id="picker-list">
          ${channels.map(ch => `
            <label class="channel-picker-item ${ch.is_member ? "is-member" : ""}">
              <input type="checkbox" value="${ch.id}" data-name="${ch.name}" ${ch.is_member ? "checked" : ""} />
              <span class="ch-name">#${ch.name}</span>
              <span class="ch-meta">${ch.num_members} members${ch.is_member ? " · already joined" : ""}</span>
            </label>
          `).join("")}
        </div>
        <div class="channel-picker-footer">
          <span id="picker-count">0 selected</span>
          <div style="display:flex;gap:8px;">
            <button class="btn btn-ghost" id="picker-cancel">Cancel</button>
            <button class="btn btn-primary" id="picker-confirm">Join selected</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const list = modal.querySelector("#picker-list");
    const search = modal.querySelector("#picker-search");
    const countEl = modal.querySelector("#picker-count");

    function updateCount() {
      const n = list.querySelectorAll("input:checked").length;
      countEl.textContent = `${n} selected`;
    }

    list.addEventListener("change", updateCount);
    updateCount();

    search.addEventListener("input", () => {
      const q = search.value.toLowerCase();
      list.querySelectorAll(".channel-picker-item").forEach(item => {
        item.style.display = item.querySelector(".ch-name").textContent.toLowerCase().includes(q) ? "" : "none";
      });
    });

    modal.querySelector("#picker-close").addEventListener("click", () => modal.remove());
    modal.querySelector("#picker-cancel").addEventListener("click", () => modal.remove());
    modal.querySelector("#picker-confirm").addEventListener("click", () => {
      const selected = [...list.querySelectorAll("input:checked")].map(i => ({
        id: i.value,
        name: i.dataset.name
      }));
      modal.remove();
      onConfirm(selected);
    });

    // Close on backdrop click
    modal.addEventListener("click", e => { if (e.target === modal) modal.remove(); });
    search.focus();
  }

  el.navButtons.forEach(btn => {
    btn.addEventListener("click", () => showPanel(btn.dataset.section, btn));
  });

  el.generateAllDepts.addEventListener("click", generateAllDeptMessages);

  // Department tab switching
  el.deptTabs.forEach(tab => {
    tab.addEventListener("click", () => {
      el.deptTabs.forEach(t => t.classList.remove("active"));
      el.deptPanels.forEach(p => p.classList.add("hidden"));
      tab.classList.add("active");
      const panel = document.querySelector(`#dept-panel-${tab.dataset.dept}`);
      if (panel) panel.classList.remove("hidden");
    });
  });

  // Per-dept edit buttons — toggle contenteditable on the composer box
  [el.editOps, el.editTech].forEach(btn => {
    if (!btn) return;
    btn.addEventListener("click", () => {
      const dept = btn.dataset.dept;
      const msgEl = { ops: el.slackMsgOps, tech: el.slackMsgTech }[dept];
      if (!msgEl) return;
      const isEditing = msgEl.contentEditable === "true";
      if (isEditing) {
        // Save — lock it back
        msgEl.contentEditable = "false";
        btn.textContent = "✎ Edit";
      } else {
        // Enter edit mode
        msgEl.contentEditable = "true";
        msgEl.focus();
        // Move cursor to end
        const range = document.createRange();
        range.selectNodeContents(msgEl);
        range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        btn.textContent = "✓ Done";
      }
    });
  });

  // Per-dept send buttons
  [el.sendOps, el.sendTech].forEach(btn => {
    if (!btn) return;
    btn.addEventListener("click", async () => {
      const dept = btn.dataset.dept;
      const msgEl = { ops: el.slackMsgOps, tech: el.slackMsgTech }[dept];
      const orig = btn.textContent;
      try {
        btn.textContent = "Sending...";
        await sendDeptReminder(dept);
        btn.textContent = "Sent ✓";
        state.sentDepts.add(dept);
        if (msgEl) msgEl.innerHTML = `<p style="color:var(--faint)">Sent. Refresh to reload.</p>`;
      } catch {
        btn.textContent = "Not configured";
      }
      setTimeout(() => { btn.textContent = orig; }, 2000);
    });
  });

  // Send to all departments
  el.sendAllDepts.addEventListener("click", async () => {
    const orig = el.sendAllDepts.textContent;
    try {
      el.sendAllDepts.textContent = "Sending...";
      el.sendAllDepts.textContent = await sendAllDeptReminders();
      state.sentDepts.add("ops");
      state.sentDepts.add("tech");
      if (el.slackMsgOps) el.slackMsgOps.innerHTML = `<p style="color:var(--faint)">Sent. Refresh to reload.</p>`;
      if (el.slackMsgTech) el.slackMsgTech.innerHTML = `<p style="color:var(--faint)">Sent. Refresh to reload.</p>`;
    } catch {
      el.sendAllDepts.textContent = "Not configured";
    }
    setTimeout(() => { el.sendAllDepts.textContent = orig; }, 2500);
  });

  // Send all red alerts
  const sendRedBtn = document.querySelector("#send-red-alerts");
  if (sendRedBtn) {
    sendRedBtn.addEventListener("click", async () => {
      if (!state.result) return;
      const orig = sendRedBtn.textContent;
      try {
        sendRedBtn.textContent = "Sending...";
        const res = await fetch("/api/actions/slack/red-alerts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentResult: state.result })
        });
        const payload = await res.json();
        if (!res.ok) throw new Error(payload.error || "Failed");
        const sent = payload.results?.filter(r => r.sent).length || 0;
        const failed = payload.results?.filter(r => !r.sent).length || 0;
        sendRedBtn.textContent = sent ? `Sent to ${sent} dept${sent !== 1 ? "s" : ""}` : "No red fellows";
        if (failed) sendRedBtn.textContent += `, ${failed} failed`;
      } catch (err) {
        sendRedBtn.textContent = err.message.includes("No red") ? "No red fellows" : "Not configured";
      }
      setTimeout(() => { sendRedBtn.textContent = orig; }, 2500);
    });
  }

  document.querySelectorAll(".connector-card button[data-action]").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (btn.disabled) return;
      const orig = btn.textContent;
      try {
        btn.textContent = "Working...";
        btn.textContent = await runConnectorAction(btn.dataset.action);
      } catch {
        btn.textContent = "Not configured";
      }
      setTimeout(() => { btn.textContent = orig; }, 2000);
    });
  });

  document.querySelectorAll(".configure-btn").forEach(btn => {
    btn.addEventListener("click", () => openConfigForm(btn.dataset.target));
  });

  // Linear — fetch team ID button
  const linearFetchBtn = document.querySelector("#linear-fetch-team-btn");
  if (linearFetchBtn) {
    linearFetchBtn.addEventListener("click", async () => {
      const apiKeyInput = document.querySelector("#linear-api-key-input");
      const teamIdInput = document.querySelector("#linear-team-id-input");
      const teamList   = document.querySelector("#linear-team-list");
      const apiKey = apiKeyInput?.value.trim() || "";
      const orig = linearFetchBtn.textContent;

      try {
        linearFetchBtn.textContent = "Fetching...";
        const res = await fetch("/api/connectors/linear/teams", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey }),
        });
        const data = await res.json();

        if (data.error) {
          teamList.style.display = "block";
          teamList.innerHTML = `<p style="color:var(--red);font-size:0.8rem;">${escHtml(data.error)}</p>`;
          return;
        }

        if (!data.teams?.length) {
          teamList.style.display = "block";
          teamList.innerHTML = `<p style="color:var(--muted);font-size:0.8rem;">No teams found for this key.</p>`;
          return;
        }

        // Show clickable team list
        teamList.style.display = "block";
        teamList.innerHTML = data.teams.map(t => `
          <button type="button" class="btn btn-ghost" style="width:100%;text-align:left;margin-bottom:4px;font-size:0.8rem;"
            data-team-id="${escHtml(t.id)}" data-team-name="${escHtml(t.name)}">
            ${escHtml(t.name)}<br>
            <span style="color:var(--faint);font-size:0.72rem;">${escHtml(t.id)}</span>
          </button>
        `).join("");

        // Click a team to fill the input
        teamList.querySelectorAll("button[data-team-id]").forEach(btn => {
          btn.addEventListener("click", () => {
            if (teamIdInput) teamIdInput.value = btn.dataset.teamId;
            teamList.style.display = "none";
          });
        });

        // Auto-fill if only one team
        if (data.teams.length === 1 && teamIdInput) {
          teamIdInput.value = data.teams[0].id;
          teamList.style.display = "none";
        }

      } catch (err) {
        teamList.style.display = "block";
        teamList.innerHTML = `<p style="color:var(--red);font-size:0.8rem;">${escHtml(err.message)}</p>`;
      } finally {
        linearFetchBtn.textContent = orig;
      }
    });
  }

  // LLM provider select — show only the relevant key fields
  const llmProviderSelect = document.querySelector("#llm-provider-select");
  if (llmProviderSelect) {
    function syncLlmFields() {
      const selected = llmProviderSelect.value;
      document.querySelectorAll(".llm-fields").forEach(div => {
        div.classList.toggle("hidden", div.dataset.provider !== selected);
      });
    }
    llmProviderSelect.addEventListener("change", syncLlmFields);
    // Run once on page load to match current value
    syncLlmFields();
  }

  document.querySelectorAll(".config-form [data-dismiss]").forEach(btn => {
    btn.addEventListener("click", () => {
      const form = btn.closest(".config-form");
      if (form) form.classList.add("hidden");
    });
  });

  document.querySelectorAll(".config-form").forEach(form => {
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const submitBtn = form.querySelector("button[type=submit]");
      const dismissBtn = form.querySelector("[data-dismiss]");
      const feedback = getConfigFeedback(form);
      const orig = submitBtn ? submitBtn.textContent : "Save";
      let saved = false;
      feedback.textContent = "";
      feedback.classList.remove("error");
      try {
        if (submitBtn) submitBtn.textContent = "Saving...";
        if (dismissBtn) dismissBtn.disabled = true;
        await saveConnectorEnv(form);
        saved = true;
        feedback.textContent = "Saved successfully.";
        setTimeout(() => hideAllConfigForms(), 500);
        await loadConnectorStatus();
      } catch (err) {
        feedback.textContent = err.message || "Save failed.";
        feedback.classList.add("error");
        if (submitBtn) submitBtn.textContent = "Save failed";
        console.error(err);
        setTimeout(() => { if (submitBtn) submitBtn.textContent = orig; }, 1800);
        return;
      } finally {
        if (submitBtn && saved) submitBtn.textContent = orig;
        if (dismissBtn) dismissBtn.disabled = false;
      }
    });
  });

  function getConfigFeedback(form) {
    let feedback = form.querySelector(".config-feedback");
    if (!feedback) {
      feedback = document.createElement("div");
      feedback.className = "config-feedback";
      feedback.setAttribute("aria-live", "polite");
      const actions = form.querySelector(".config-form-actions");
      if (actions) form.insertBefore(feedback, actions);
      else form.appendChild(feedback);
    }
    return feedback;
  }

  function hideAllConfigForms() {
    document.querySelectorAll(".config-form").forEach(form => form.classList.add("hidden"));
  }

  function openConfigForm(targetId) {
    hideAllConfigForms();
    const form = document.getElementById(targetId);
    if (!form) return;
    form.classList.remove("hidden");

    // Pre-fill Slack channel names (non-secret) from the server
    if (targetId === "cfg-slack") {
      fetch("/api/config/slack").then(r => r.json()).then(data => {
        const set = (name, val) => {
          const input = form.querySelector(`input[name="${name}"]`);
          if (input && val) input.value = val.replace(/^#/, "");
        };
        set("SLACK_DEFAULT_CHANNEL", data.defaultChannel);
        set("SLACK_CHANNEL_OPS",     data.channelOps);
        set("SLACK_CHANNEL_FINANCE", data.channelFinance);
        set("SLACK_CHANNEL_TECH",    data.channelTech);

        // Show token status without revealing the value
        const tokenInput = form.querySelector('input[name="SLACK_BOT_TOKEN"]');
        if (tokenInput && data.hasBotToken) {
          tokenInput.placeholder = "✓ Token saved — paste new token to update";
        }
        const webhookInput = form.querySelector('input[name="SLACK_WEBHOOK_URL"]');
        if (webhookInput && data.hasWebhook) {
          webhookInput.placeholder = "✓ Webhook saved — paste new URL to update";
        }
        const signingInput = form.querySelector('input[name="SLACK_SIGNING_SECRET"]');
        if (signingInput && data.hasSigningSecret) {
          signingInput.placeholder = "✓ Signing secret saved — paste new value to update";
        }
      }).catch(() => {});
    }

    // If this is the LLM form, sync the provider select and fields
    if (targetId === "cfg-llm") {
      const sel = form.querySelector("#llm-provider-select");
      if (sel) {
        document.querySelectorAll(".llm-fields").forEach(div => {
          div.classList.toggle("hidden", div.dataset.provider !== sel.value);
        });
      }
    }

    const first = form.querySelector("input, select, textarea");
    if (first) first.focus();
  }

  /**
   * Save connector env vars via the API.
   * Normalises Slack channel names to always include the # prefix.
   * Logs saved keys (not values) to the console for debugging.
   */
  async function saveConnectorEnv(form) {
    const vars = {};
    form.querySelectorAll("input[name], select[name]").forEach(input => {
      if (!input.name) return;
      let value = input.value.trim();
      if (!value) return;
      // Normalize Slack channel names — always store with # prefix
      if (input.name.includes("CHANNEL") || input.name === "SLACK_DEFAULT_CHANNEL") {
        if (!value.startsWith("#")) value = `#${value}`;
      }
      vars[input.name] = value;
    });

    if (!Object.keys(vars).length) {
      throw new Error("Enter at least one value.");
    }

    // Log saved keys only — never log values (they may contain secrets)
    console.log("Saving env vars:", Object.keys(vars));

    const res = await fetch("/api/config/env", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vars })
    });
    const payload = await res.json();
    if (!res.ok || payload.error) {
      throw new Error(payload.error || "Save failed.");
    }
    return payload;
  }

  // ── Boot ──────────────────────────────────────────────────────────────────

  setTheme(localStorage.getItem("utopia-theme") || "light");
  checkApiHealth();
  loadConnectorStatus();
  loadSchedulerStatus();
  runAgent();

}());
