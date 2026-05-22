/**
 * SheetsConnector — fetches a published Google Sheets CSV export and
 * converts it into the fellow scenario shape the agent expects.
 * Requires GOOGLE_SHEETS_CSV_URL.
 */
import { config } from "../config/env.js";
import { parseOnboardingCsv } from "../services/csv.js";

export class SheetsConnector {
  constructor({ csvUrl = config.sheets.csvUrl } = {}) {
    this.csvUrl = csvUrl;
  }

  status() {
    return {
      id: "google_sheets",
      label: "Google Sheets",
      connected: Boolean(this.csvUrl),
      required_env: ["GOOGLE_SHEETS_CSV_URL"],
      capabilities: ["pull_onboarding_csv"],
    };
  }

  async fetchScenario() {
    if (!this.csvUrl) {
      throw new Error("Google Sheets CSV sync is not configured. Set GOOGLE_SHEETS_CSV_URL.");
    }

    const response = await fetch(this.csvUrl);
    if (!response.ok) {
      throw new Error(`Could not fetch sheet CSV: ${response.status} ${response.statusText}`);
    }

    return parseOnboardingCsv(await response.text());
  }
}
