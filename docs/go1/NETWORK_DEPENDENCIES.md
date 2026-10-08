# GO-1 network dependencies

Renderer CSP keeps `connect-src` at `'self'` plus local Vite websockets. Outbound calls run in the Electron main process.

| DOMAIN | PURPOSE | WHEN_CALLED | REQUIRED | OPTIONAL | CAN_DISABLE |
| --- | --- | --- | --- | --- | --- |
| `www.google-analytics.com` | GA4 MP | packaged + keys + user has not opted out | | OPTIONAL | omit GA4 env at pack; Settings opt-out |
| `www.genspark.ai` | LLM proxy, device-code login, tool_cli, credits, projects | Genspark AI / sign-in / search / cloud projects | | OPTIONAL | do not sign in; no `GSK_API_KEY`; BYOK |
| `sspark.genspark.ai` | generated-image CDN | inserting Genspark images | | OPTIONAL | do not use Genspark image gen |
| `github.com` / `api.github.com` | About stars, updater fallback, README | About pane / failed update | | OPTIONAL | ignore About; no updater URL |
| Update CDN | electron-updater | only if `GENOFFICE_UPDATE_URL` baked | | OPTIONAL | omit env (GO-1 default) |
| Font CDN | optional OFL catalog | only if `GENOFFICE_FONT_CDN_URL` baked | | OPTIONAL | omit env |
| `api.anthropic.com` | Claude BYOK | user key | | OPTIONAL | no key |
| `generativelanguage.googleapis.com` | Gemini BYOK | user key | | OPTIONAL | no key |
| `api.openai.com` | OpenAI BYOK | user key | | OPTIONAL | no key |
| `api.deepseek.com` / `api.moonshot.ai` / `open.bigmodel.cn` / `dashscope.aliyuncs.com` / `ark.cn-beijing.volces.com` / `api.minimax.io` / `api.x.ai` / `api.mistral.ai` / `openrouter.ai` / `router.requesty.ai` / `opencode.ai` | other BYOK providers | user key | | OPTIONAL | no key |
| `google.serper.dev` / `api.tavily.com` | search BYOK | user key | | OPTIONAL | no key |
| `html.duckduckgo.com` | keyless search fallback | AI search without gsk/serper/tavily | | OPTIONAL | do not invoke search |
| `registry.npmjs.org` | install | `npm ci` | REQUIRED to build | | N/A |
| localhost `:5173`–`:5178` | Vite HMR | `npm run dev` | REQUIRED for dev | | N/A |

No license server exists in source. `ee/` describes future license verification only.

`genoffice.ai` onboarding join URL was replaced with the UniWork origin GitHub repo.
