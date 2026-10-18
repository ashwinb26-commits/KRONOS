# Setup guide

Everything needed to take this from a clone to a deployed site with a working
publish button. Expect about 30 minutes the first time.

The order matters in one place only: Cloudflare has to exist before the GitHub
OAuth app, because the OAuth app needs the final URL. Everything else can be
done in any order.

## 1. Get the repository into GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/dcf-valuation-lab.git
git push -u origin main
```

The repository can be public or private. Cloudflare Pages works with either.
The published financial figures are meant to be public, so a public repository
is the simpler choice. Nothing secret is ever committed: secrets live in
Cloudflare, and `.dev.vars` is gitignored.

## 2. Create the Cloudflare Pages project

1. Sign in at [dash.cloudflare.com](https://dash.cloudflare.com).
2. Go to **Workers and Pages**, then **Create**, then the **Pages** tab, then
   **Connect to Git**.
3. Authorise Cloudflare for your GitHub account and pick this repository.
4. Build settings:

   | Setting | Value |
   | --- | --- |
   | Framework preset | None |
   | Build command | `npm run build` |
   | Build output directory | `dist` |
   | Root directory | leave empty |

5. Save and deploy. The first build takes a couple of minutes.

You now have a URL such as `https://dcf-valuation-lab.pages.dev`. The public
dashboard works already. Sign-in does not, because there is nothing configured
for it yet.

Write that URL down. The rest of this guide calls it **your site URL**.

## 3. Create the GitHub OAuth app, for sign-in

This is what proves you are you. It does not grant any write access.

1. Go to [github.com/settings/developers](https://github.com/settings/developers),
   then **OAuth Apps**, then **New OAuth App**.
2. Fill it in:

   | Field | Value |
   | --- | --- |
   | Application name | DCF Valuation Lab |
   | Homepage URL | your site URL |
   | Authorization callback URL | your site URL followed by `/api/auth/callback` |

3. Create it, then **Generate a new client secret**. Copy both the client ID
   and the secret now. GitHub shows the secret once.

If you also want to sign in on `http://localhost:8788` while developing, make a
second OAuth app with localhost URLs. One OAuth app has one callback URL, so
local and production need separate apps.

## 4. Create the write credential

The site needs permission to commit one JSON file. There are 2 ways to do that.
The first is better and takes 5 minutes longer.

### Option A: a GitHub App (preferred)

A GitHub App mints a fresh token for each request, and that token expires in an
hour on its own. There is no long-lived secret sitting in a dashboard.

1. Go to [github.com/settings/apps](https://github.com/settings/apps), then
   **New GitHub App**.
2. Fill it in:
   - **Name**: anything unique, for example `dcf-lab-publisher`
   - **Homepage URL**: your site URL
   - **Webhook**: untick **Active**. This App never receives webhooks.
   - **Repository permissions**: set **Contents** to **Read and write**. Leave
     everything else at **No access**.
   - **Where can this App be installed**: **Only on this account**
3. Create it. Note the **App ID** from the top of the settings page.
4. Scroll to **Private keys** and choose **Generate a private key**. A `.pem`
   file downloads.
5. Go to **Install App** in the left sidebar, install it on your account, and
   choose **Only select repositories**, then this repository.
6. After installing, the browser URL ends in a number, as in
   `.../installations/12345678`. That number is the **installation ID**.

The downloaded key is in PKCS#1 format, which WebCrypto cannot read. Convert it:

```bash
openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt \
  -in your-app.private-key.pem \
  -out key-pkcs8.pem
```

The converted file starts with `-----BEGIN PRIVATE KEY-----`. If yours starts
with `-----BEGIN RSA PRIVATE KEY-----` the conversion has not happened, and the
publish endpoint will tell you so rather than failing cryptically.

### Option B: a fine-grained personal access token

Simpler, but it is a long-lived secret and it needs rotating by hand.

1. Go to
   [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new).
2. Set:
   - **Resource owner**: your account
   - **Repository access**: **Only select repositories**, then this repository
   - **Repository permissions**: **Contents** to **Read and write**. Nothing
     else.
   - **Expiration**: 90 days. Put the renewal in your calendar.
3. Generate and copy the token. It starts with `github_pat_`.

Do not use a classic token. A classic `repo` token can reach every repository
you own, which is far more access than committing one JSON file needs.

## 5. Generate a session secret

```bash
openssl rand -base64 48
```

This signs session and OAuth state cookies. It has to be at least 32
characters, and the deployment refuses to start sign-in if it is shorter.
Anybody who learns this value can forge an administrator session, so treat it
like a password.

## 6. Put the secrets into Cloudflare

In the Cloudflare dashboard, go to **Workers and Pages**, your project,
**Settings**, then **Variables and secrets**. Add each of these for the
**Production** environment. Use the **Secret** type for anything marked secret,
so the value is write-only afterwards.

| Name | Type | Value |
| --- | --- | --- |
| `GITHUB_OAUTH_CLIENT_ID` | Text | From step 3 |
| `GITHUB_OAUTH_CLIENT_SECRET` | Secret | From step 3 |
| `SESSION_SECRET` | Secret | From step 5 |
| `ADMIN_GITHUB_LOGINS` | Text | Your GitHub username. Comma separate for several. |
| `GITHUB_REPO_OWNER` | Text | Your GitHub username or organisation |
| `GITHUB_REPO_NAME` | Text | `dcf-valuation-lab` |
| `GITHUB_REPO_BRANCH` | Text | `main` |
| `DATA_FILE_PATH` | Text | `public/data/valuations.json` |

Then the write credential, from step 4. Option A:

| Name | Type | Value |
| --- | --- | --- |
| `GITHUB_APP_ID` | Text | The App ID |
| `GITHUB_APP_INSTALLATION_ID` | Text | The installation ID |
| `GITHUB_APP_PRIVATE_KEY` | Secret | The whole contents of `key-pkcs8.pem`, `BEGIN` and `END` lines included |

Or option B:

| Name | Type | Value |
| --- | --- | --- |
| `GITHUB_DATA_TOKEN` | Secret | The `github_pat_` token |

If both are set, the GitHub App is used and the token is ignored.

Two optional settings:

| Name | Type | Value |
| --- | --- | --- |
| `SESSION_TTL_SECONDS` | Text | Session lifetime. Default 28800, which is 8 hours. Capped at 86400. |
| `PUBLIC_SITE_ORIGIN` | Text | Leave unset. Only needed behind a proxy that rewrites the host. |

**Redeploy after adding variables.** Cloudflare does not apply them to the
running deployment. Go to **Deployments** and retry the latest one, or push any
commit.

## 7. Check it works

1. Open your site URL. The dashboard loads with the illustrative banner.
2. Select **Sign in**, then **Sign in with GitHub**. Authorise.
3. You should land in the studio. If you land back on sign-in with a message,
   the table in [the troubleshooting section](#when-sign-in-fails) says what
   each one means.
4. Go to **Validate and publish** and select **Preview update**. The diff shows
   no changes, because nothing has been edited yet.
5. Change the valuation date in **Company and sources**, then preview again.
   The diff now shows the change.
6. Select **Publish update** and confirm. Within a few seconds you get a commit
   link. Within a minute or 2 Cloudflare redeploys and the dashboard shows 2
   published releases in the selector.

If step 6 works, everything works.

## 8. Local development with sign-in

```bash
cp .dev.vars.example .dev.vars
```

Fill `.dev.vars` with the localhost OAuth app's credentials from step 3, the
same session secret or a different one, and the same repository settings. For
the write credential, either reuse the production one, which means a local
publish commits for real, or leave it out, in which case the studio still
loads, edits and previews and tells you publishing is not configured.

```bash
npm run preview:functions
```

This builds and serves the whole thing, Functions included, on
`http://localhost:8788`. Session cookies drop the `Secure` flag on plain-HTTP
localhost so sign-in works, and nowhere else.

`npm run dev` is faster for front-end work but has no API, so the studio will
report that it cannot reach the repository and fall back to the deployed data
file.

## When sign-in fails

Every failure sends you back to the sign-in page with a code. What each one
means:

| Message on screen | Cause | Fix |
| --- | --- | --- |
| Sign-in is not set up on this deployment yet | A variable is missing | Check step 6, then redeploy |
| The session secret is too short | Under 32 characters | Regenerate with `openssl rand -base64 48` |
| No GitHub login has been added | `ADMIN_GITHUB_LOGINS` empty | Set it to your username |
| That sign-in attempt has expired | More than 10 minutes, or a different browser | Start again |
| That GitHub account does not have studio access | Signed in as someone not on the list | Check `ADMIN_GITHUB_LOGINS` spelling. Case does not matter. |
| That sign-in link has already been used | The callback was reloaded | Start again |
| Sign-in was cancelled | Authorisation was declined | Start again |

A redirect that lands on a GitHub error page instead of coming back usually
means the callback URL in the OAuth app does not exactly match your site URL
plus `/api/auth/callback`. It has to match exactly, including `https://` and
with no trailing slash.

## When publishing fails

| Message on screen | Cause | Fix |
| --- | --- | --- |
| Publishing is not configured on this deployment | No write credential | Add one, step 4, then redeploy |
| GitHub refused to issue an installation token | App ID, installation ID or key wrong | Re-check step 4. A PKCS#1 key gives its own message with the conversion command. |
| GitHub refused the commit | The credential lost Contents write access | Re-check the App permissions or regenerate the token |
| The data file changed in GitHub since the studio loaded | Something else committed it | Select **Reload published data**, then publish again |
| The data file in GitHub is not valid JSON | The file was hand-edited and broken | Fix it in the repository. The studio will not overwrite a file it cannot parse. |
| This snapshot has N problems that block publication | Validation failed | Each problem has a **Go to** button |

## Hosting somewhere other than Cloudflare

The dashboard is a static build and will run on any static host, GitHub Pages
included. Sign-in and publishing will not: they are Cloudflare Pages Functions.

To host the dashboard on GitHub Pages and give up the studio, set `base` in
`vite.config.ts` to `'/your-repo-name/'`, add a workflow that publishes `dist`,
and edit the data file in the repository by hand. The six-month maintenance
guide assumes the studio exists, so most of it stops applying.

Porting the Functions to another platform means rewriting them for that
platform's runtime. The logic in `functions/_lib/` is plain WebCrypto and fetch
with no Cloudflare-specific API, so the port is mostly re-wiring the route
handlers.
