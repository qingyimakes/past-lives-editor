# Still — editor

A single static page. No server, no database, no build step. The **repo is the
database**: the editor reads and writes `Content/source.json` through the GitHub
API, so hosting is free and every edit is a commit you can revert.

## Where it lives

- **Editor (public):** https://qingyimakes.github.io/past-lives-editor/
  Served from `qingyimakes/past-lives-editor`, which holds only these five
  files. No content, so nothing to leak.
- **Content and app (private):** `qingyimakes/philosophy-app`. Drafts, hidden posts
  and the archive stay private because this repo is private.

Editing here and running `Tools/publish-editor.sh` pushes the editor to the
public repo. Never copy `source.json` into it.

## First run

1. Open the editor URL on any device, phone included.
2. Press **Connect**:
   - repo `qingyimakes/philosophy-app`, branch `main`, path `Content/source.json`
   - a **fine-grained personal access token** with *Contents: read and write*
     scoped to `philosophy-app` only
     (github.com → Settings → Developer settings → Fine-grained tokens).

The token is kept in that browser's localStorage and is sent only to
api.github.com. Use a short expiry, and don't do this on a shared machine.

To work offline instead, press **Open a file instead**, pick `source.json`, and
use **Download source.json** when you're done.

## The workflow

- **New post** builds a prompt for a whole post — question, four options and
  6–8 sourced comments. Nothing is generated here; you run the prompt in the
  Claude you already pay for and paste the reply back. A Claude subscription
  does not include API access, so calling an API would bill per token.
- Everything on the phone is editable in place. Hover a block for
  *rewrite / shorter / longer* — each builds a prompt for that field alone.
- Click a **Voted for** pill to move a voice to a different option. There is no
  "against": disagreement is voices sitting under different answers.
- **Status** is draft → published → hidden → archived. Only `published`
  questions are built into the app and the web.
- **Check** runs the same rules as `Tools/validate-content.py`, including the
  one that matters: every comment must carry a quote with a source.

## Publishing

Saving commits `Content/source.json` to `main`, and that is the whole job. The
`publish-content` workflow (`.github/workflows/publish-content.yml`) then:

1. runs `Content/build.py`, which builds `PastLives/Resources/content.json`
   and `Web/assets/content.json` from the **published** questions only, runs
   `Tools/validate-content.py` on the result, and writes nothing if it fails —
   so a save that breaks the quote rule never reaches anyone;
2. commits the regenerated files back to `main`;
3. publishes the web page and its assets to the public repo
   `qingyimakes/still` (`Tools/publish-web.sh`, which refuses to publish any
   question that is not `published`, or any file that is not the page or its
   assets).

The app fetches `https://qingyimakes.github.io/still/assets/content.json` at
launch, so a save shows on the web and in the app within a few minutes, with
no release. A failed run shows as a red ✗ on the commit in GitHub; the site
and the app keep the last good content.

Both `content.json` files are generated. Never edit them by hand: the next
build overwrites them, and `Tools/check-pipeline.sh` fails while they differ.
To check locally:

```bash
Tools/check-pipeline.sh
```

### One-time setup (repo owner)

The workflow needs one secret, a token that can push to the public site repo:

1. github.com → Settings → Developer settings → Fine-grained tokens →
   **Generate new token**. Resource owner `qingyimakes`; repository access
   *Only select repositories* → `qingyimakes/still`; permissions
   **Contents: Read and write** (nothing else). Pick an expiry and note it.
2. `qingyimakes/philosophy-app` → Settings → Secrets and variables → Actions →
   **New repository secret**: name `STILL_DEPLOY_TOKEN`, value the token.
3. `qingyimakes/philosophy-app` → Settings → Actions → General → Workflow
   permissions: **Read and write permissions** (lets the workflow commit the
   regenerated content back). If `main` is protected against direct pushes,
   allow GitHub Actions to bypass it, or the commit step fails.
4. Actions tab → *Publish content* → **Run workflow** once to check it.

When the token expires the run fails at the publish step; repeat 1–2.
