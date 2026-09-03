# Past Lives — editor

A single static page. No server, no database, no build step. The **repo is the
database**: the editor reads and writes `Content/source.json` through the GitHub
API, so hosting is free and every edit is a commit you can revert.

## Getting it online (free)

1. Push this repo to GitHub.
2. Settings → Pages → deploy from branch, `main`, folder `/Editor`.
3. Open the Pages URL on any device, phone included.
4. Press **Connect** and give it:
   - owner/repo, branch, and `Content/source.json`
   - a **fine-grained personal access token** with *Contents: read and write*
     on this repository only.

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
  questions are built into the app.
- **Check** runs the same rules as `Tools/validate-content.py`, including the
  one that matters: every comment must carry a quote with a source.

## Publishing

Saving writes `Content/source.json`. Then:

```bash
python3 Content/build.py && python3 Tools/validate-content.py
```

which regenerates `PastLives/Resources/content.json` from the published
questions only.
