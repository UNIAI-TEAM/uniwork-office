# GO-1 AI baseline

GO-1 does **not** add UniWork AI Gateway, UniWork credentials, or Supabase keys.

## Current behavior (inherited)

- Default provider: `genspark` with empty keys (`packages/ai-provider/src/providers.ts`).
- Genspark sign-in is a device-code flow (`packages/ai-search/src/genoffice-auth.ts`), `app_type=genoffice`. Token is stored in `~/.genoffice/auth.json`, not in git.
- BYOK: Settings → AI, stored as plaintext `userData/ai-settings.json`.
- Key resolution: `GSK_API_KEY` → `~/.genoffice/auth.json` → `~/.genspark-tool-cli/config.json`.
- `AI_SEARCH_DISABLE_GSK=1` disables the gsk search backend.
- Without credentials, document editing still works. AI requests show a sign-in / missing-key error. Search can fall back to DuckDuckGo.

## Safe UniWork configuration

- Leave Genspark unsigned-in.
- Do not set `GSK_API_KEY`.
- Do not add UniWork provider credentials to the repo.
- Use BYOK or a local OpenAI-compatible `baseUrl` if AI is needed.
- Do not inject `GENOFFICE_GA4_*`.

See `.env.example` for names only.

## What GO-1 changed

- Product chrome that said “Genspark” as the **app AI brand** now says “AI”.
- Sign-in strings that name Genspark as the **vendor** remain, because that backend is still the inherited default.
- HTTP User-Agent is `UniWorkOffice`.
- Codex `clientInfo.title` is `UniWork Office`; protocol `name` remains `genoffice`.
