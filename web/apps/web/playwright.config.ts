import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineConfig, devices } from "@playwright/test";

// Ports are fixed on purpose: never the real YouTube Music (26538) or a live jam (:8080).
const STUB_PORT = 26999;
const SERVER_PORT = 8095;
export const BASE_URL = `http://127.0.0.1:${SERVER_PORT}`;

// Point at an already-installed Chromium when the bundled one is missing.
const executablePath = process.env.E2E_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: "e2e",
  // The server is one shared room, so tests run one at a time.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    colorScheme: "dark",
    viewport: { width: 390, height: 844 },
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, launchOptions: { executablePath } },
    },
  ],
  webServer: [
    {
      command: `python3 e2e/ytm-stub.py ${STUB_PORT}`,
      url: `http://127.0.0.1:${STUB_PORT}/api/v1/song`,
      reuseExistingServer: false,
    },
    {
      // A temp token file keeps the real token cache untouched.
      command: `../../../nimbrung -listen 127.0.0.1:${SERVER_PORT} -ytm http://127.0.0.1:${STUB_PORT} -name "Test jam" -code TEST -host-key e2e-host-key -skip-votes 50 -state-file "" -lyrics http://127.0.0.1:${STUB_PORT} -youtube http://127.0.0.1:${STUB_PORT} -token-file ${join(tmpdir(), `nimbrung-e2e-token-${process.pid}.json`)}`,
      url: `${BASE_URL}/`,
      reuseExistingServer: false,
    },
  ],
});
