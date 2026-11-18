# Student Scholarship Monitoring and Academic Compliance System

Section B manages semester grade submissions, evidence verification, compliance evaluations, and scholarship renewal. The demo roster uses fictional records for academic year 2026–2027, semester 1.

## Interface

- Scholars can see their assigned program, latest grades, verification, compliance, and renewal status. The submission page checks academic inputs and lets a scholar correct a returned record after reading the staff reason. History shows prior submissions and program assignments.
- Staff can choose a semester, search by name or student ID, filter the roster, register scholars, and assign programs. The verification, compliance, renewal, and reports views open the relevant part of a submission and its audit history.
- The desktop sidebar becomes a keyboard-accessible navigation drawer on smaller screens. Form warnings, confirmation dialogs, and visible focus indicators apply throughout the interface.

## Images and branding

The app uses `images/logo.png` for the university branding and favicon, and `images/bg-login.jpg` for the login photograph. Add assets to `image/` or the existing `images/` folder. The app checks `image/` first and prefers a file named `logo` for the logo and `bg-login` or `login-bg` for the photograph. It accepts PNG, JPEG, SVG, and WebP. Restart the dev server or rebuild after adding assets. The sign-in layout also works with a gradient background when a photograph is unavailable.

## Run locally

Use Node.js 22.12 or later. To run with local Auth and a local database, install the Supabase CLI and a supported container runtime. [Supabase CLI setup](https://supabase.com/docs/guides/local-development/cli/getting-started)

1. Run `npm ci` and start Supabase with `supabase start`. The project configuration applies the migrations and seeds the demo roster on a fresh local database.
2. Copy `.env.example` to `.env.local`. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to the API URL and publishable or `anon` key for that Supabase instance.
3. Copy `.env.test.example` to `.env.test.local`. Set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_ADMIN_KEY`, and the demo accounts’ passwords. For new accounts, local Supabase requires at least 12 characters. For an existing hosted account, use its current password. Keep the secret or `service_role` key in `.env.test.local`.
4. Run `npm run provision:demo` and `npm run dev`. Open `http://127.0.0.1:5173`.

| Role | Demo email | Password setting |
| --- | --- | --- |
| Scholarship Staff | `staff@adssu.edu.ph` | `TEST_STAFF_PASSWORD` |
| Scholar B01 | `b01@adssu.edu.ph` | `TEST_SCHOLAR_A_PASSWORD` |
| Scholar B02 | `b02@scholarship.example` | `TEST_SCHOLAR_B_PASSWORD` |

Staff can review the seeded submissions and register scholars. Registered scholars can sign in once an Auth account with their confirmed email exists. The app links the scholar profile on first sign-in.

To use a hosted Supabase project, apply `supabase/migrations/*.sql` in filename order and run `supabase/seed.sql` on a demo database. Set the same environment variables to the hosted project URL and keys. Use the project URL without `/rest/v1`. The browser needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. The backend demo script also needs `SUPABASE_ADMIN_KEY` in `.env.test.local`.

## GitHub Pages

In repository Settings → Secrets and variables → Actions → Variables, set `VITE_SUPABASE_URL` to the hosted project URL and `VITE_SUPABASE_PUBLISHABLE_KEY` to its public browser key. In Settings → Pages, choose **GitHub Actions** as the source. Pushing to `main` runs the **Publish Scholarship Office** workflow, which tests the code, builds it with Vite and deploys `dist/`. To republish after changing a variable, open that workflow under Actions and select **Run workflow**.

## Verify

- `npm test` checks validation, assignment dates, roster filtering, the advisory policy comparison, and browser key handling.
- `npm run test:db:embedded` applies the real migrations and seed in isolated PostgreSQL and runs TC01–TC10 plus registration and assignment.
- `npm run test:auth` checks live sign-in, the seeded roster, dashboard counts, and direct permission checks against the demo project in `.env.test.local`.
- `npm run test:browser` checks live desktop, tablet, and phone flows. Start the dev server and provision the demo accounts first. The test looks for standard Chrome, Chromium, or Edge executables. Use `BROWSER_PATH` for a different executable and `BROWSER_BASE_URL` for a different server URL. Set `BROWSER_CAPTURE=1` to save screenshots under `.cache/`.
- `npm run build` generates the production frontend in `dist/` using the browser environment settings.

| Case | Verified behavior |
| --- | --- |
| TC01 | B01 meets the exact GWA, unit, and deadline boundaries. |
| TC02 | B02 exceeds the GWA limit and receives a GWA deficiency. |
| TC03 | B03 meets the Access Scholar limit for dropped subjects. |
| TC04 | B04 receives both the units and incomplete-grade deficiencies. |
| TC05 | B05 receives both the failed-subject and late-submission deficiencies. |
| TC06 | Pending B06 is blocked from compliance evaluation. |
| TC07 | Duplicate submissions and invalid inputs are rejected. |
| TC08 | Scholar accounts cannot read another scholar’s records or run staff actions. |
| TC09 | Returning and correcting a record retains the original timestamp and audit history. |
| TC10 | Staff can approve compliant records or hold deficient records. Scholars cannot decide renewal. |

## Known limitations

- Live browser tests exercise the seeded records, validation, and confirmation dialogs without changing those records. The embedded tests commit and read back workflow changes in an isolated database.
- Staff registration creates the profile and assignment. A Supabase administrator creates the confirmed Auth identity through the existing secure provisioning flow.
