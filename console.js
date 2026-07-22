/* DUCKi by AEON DUX — a browser-based agent (DUCKi Console).
 * Bring-your-own-key. Everything runs client-side; keys live in localStorage
 * and are sent only to the provider you choose. No backend.
 */
(function () {
  'use strict'

  // ----- tiny helpers -----
  var $ = function (id) { return document.getElementById(id) }
  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v } catch (e) { return d } },
    set: function (k, v) { try { localStorage.setItem(k, v) } catch (e) {} }
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }
  function renderMarkdown(s) {
    // minimal: escape, code fences, inline code, line breaks
    var text = esc(s)
    text = text.replace(/```([\s\S]*?)```/g, function (_, c) { return '<pre><code>' + c.replace(/^\n/, '') + '</code></pre>' })
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>')
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    text = text.replace(/!\[([^\]]*)\]\((https?:[^)\s]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;border-radius:10px;margin:6px 0;display:block" loading="lazy">')
    text = text.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    return text
  }
  function setDot(id, state) {
    var el = $(id); if (!el) return
    el.className = 'dot' + (state === 'on' ? ' on' : state === 'err' ? ' err' : '')
  }
  function status(id, msg, kind) {
    var el = $(id); if (!el) return
    el.textContent = msg || ''
    el.className = 'status-line' + (kind ? ' ' + kind : '')
  }

  // ----- default models per provider -----
  var DEFAULT_MODEL = {
    openai: 'gpt-4o-mini',
    anthropic: 'claude-3-5-sonnet-latest',
    gemini: 'gemini-2.0-flash',
    deepseek: 'deepseek-chat',
    glm: 'glm-4-flash',
    qwen: 'qwen-turbo',
    kimi: 'moonshot-v1-8k',
    openrouter: 'deepseek/deepseek-chat-v3-0324:free',
    siliconflow: 'deepseek-ai/DeepSeek-V3',
    ondevice: 'Llama-3.2-1B (on-device, no key)',
    ondevice_light: 'Qwen2.5-0.5B (on-device, no key)'
  }
  var MODELS = {
    openai: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1', 'gpt-4.1-mini', 'o4-mini'],
    anthropic: ['claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest', 'claude-3-7-sonnet-latest'],
    gemini: ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-1.5-flash-latest'],
    deepseek: ['deepseek-chat', 'deepseek-reasoner'],
    glm: ['glm-4-flash', 'glm-4-plus', 'glm-4-air', 'glm-4-long'],
    qwen: ['qwen-turbo', 'qwen-plus', 'qwen-max', 'qwen2.5-72b-instruct'],
    kimi: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    openrouter: ['deepseek/deepseek-chat-v3-0324:free', 'deepseek/deepseek-r1:free', 'qwen/qwen-2.5-72b-instruct', 'meta-llama/llama-3.3-70b-instruct', 'google/gemini-2.0-flash-exp:free'],
    siliconflow: ['deepseek-ai/DeepSeek-V3', 'deepseek-ai/DeepSeek-R1', 'Qwen/Qwen2.5-72B-Instruct', 'Qwen/QwQ-32B', 'THUDM/glm-4-9b-chat']
  }

  // ----- state -----
  var state = {
    llm: { provider: LS.get('ec_llm_provider', 'openai'), model: '', key: '' },
    gh: { token: '', user: null },
    fc: { key: '' },
    gm: { clientId: '', token: null, email: null, tokenClient: null },
    allowWrites: LS.get('ec_allow_writes', '1') === '1',
    history: [] // {role:'user'|'assistant'|'tool', text, toolCalls, id, name, result}
  }

  // ======================================================================
  //  TOOLS
  // ======================================================================
  function ghHeaders() {
    return {
      Authorization: 'Bearer ' + state.gh.token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  }
  function b64utf8(str) {
    var bytes = new TextEncoder().encode(str), bin = ''
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
    return btoa(bin)
  }
  function requireGitHub() { if (!state.gh.token) throw new Error('GitHub is not connected. Ask the user to paste a token in the sidebar.') }
  function requireWrite() { if (!state.allowWrites) throw new Error('Write actions are disabled. Ask the user to enable "Allow write actions" in the sidebar.') }

  var TOOLS = {
    github_me: {
      description: 'Get the authenticated GitHub user (login, name, public repo count).',
      parameters: { type: 'object', properties: {} },
      run: function () {
        requireGitHub()
        return fetch('https://api.github.com/user', { headers: ghHeaders() }).then(function (r) {
          var scopes = r.headers.get('x-oauth-scopes') || ''
          return r.json().then(function (u) {
            return { login: u.login, name: u.name, public_repos: u.public_repos, total_private_repos: u.total_private_repos, followers: u.followers, token_scopes: scopes, can_access_private: /repo/.test(scopes) }
          })
        })
      }
    },
    github_list_repos: {
      description: 'List ALL of the authenticated user\'s repositories including PRIVATE ones, most recently updated first.',
      parameters: { type: 'object', properties: { limit: { type: 'number', description: 'max repos (default 100)' } } },
      run: function (a) {
        requireGitHub()
        var want = a && a.limit ? a.limit : 100
        var out = []
        function page(p) {
          var url = 'https://api.github.com/user/repos?visibility=all&affiliation=owner,collaborator,organization_member&sort=updated&per_page=100&page=' + p
          return fetch(url, { headers: ghHeaders() }).then(checkJson).then(function (rs) {
            rs.forEach(function (r) { out.push({ full_name: r.full_name, private: r.private, description: r.description, updated_at: r.updated_at, stars: r.stargazers_count }) })
            if (rs.length === 100 && out.length < want) return page(p + 1)
            return { count: out.length, private_count: out.filter(function (r) { return r.private }).length, repos: out.slice(0, want) }
          })
        }
        return page(1)
      }
    },
    github_get_file: {
      description: 'Read a file from a GitHub repo. Returns decoded text content.',
      parameters: { type: 'object', properties: {
        repo: { type: 'string', description: 'owner/repo' },
        path: { type: 'string', description: 'file path in the repo' },
        ref: { type: 'string', description: 'branch or commit (optional)' }
      }, required: ['repo', 'path'] },
      run: function (a) {
        requireGitHub()
        var url = 'https://api.github.com/repos/' + a.repo + '/contents/' + encodeURIComponent(a.path).replace(/%2F/g, '/')
        if (a.ref) url += '?ref=' + encodeURIComponent(a.ref)
        return fetch(url, { headers: ghHeaders() }).then(checkJson).then(function (f) {
          var content = f.content ? decodeURIComponent(escape(atob(f.content.replace(/\n/g, '')))) : ''
          if (content.length > 8000) content = content.slice(0, 8000) + '\n…[truncated]'
          return { path: f.path, size: f.size, content: content }
        })
      }
    },
    github_search_repos: {
      description: 'Search public GitHub repositories.',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      run: function (a) {
        requireGitHub()
        return fetch('https://api.github.com/search/repositories?per_page=8&q=' + encodeURIComponent(a.query), { headers: ghHeaders() })
          .then(checkJson).then(function (d) {
            return (d.items || []).map(function (r) { return { full_name: r.full_name, description: r.description, stars: r.stargazers_count, url: r.html_url } })
          })
      }
    },
    github_create_issue: {
      description: 'Create an issue in a GitHub repo. Requires write actions to be enabled.',
      parameters: { type: 'object', properties: {
        repo: { type: 'string', description: 'owner/repo' },
        title: { type: 'string' },
        body: { type: 'string' }
      }, required: ['repo', 'title'] },
      run: function (a) {
        requireGitHub(); requireWrite()
        return fetch('https://api.github.com/repos/' + a.repo + '/issues', {
          method: 'POST', headers: ghHeaders(), body: JSON.stringify({ title: a.title, body: a.body || '' })
        }).then(checkJson).then(function (i) { return { number: i.number, url: i.html_url } })
      }
    },
    github_create_repo: {
      description: 'Create a NEW GitHub repository for the user. Requires write actions.',
      parameters: { type: 'object', properties: {
        name: { type: 'string', description: 'repo name' },
        description: { type: 'string', description: 'short description (optional)' },
        private: { type: 'boolean', description: 'true for private repo (default false)' },
        auto_init: { type: 'boolean', description: 'initialize with a README so files can be added (default true)' }
      }, required: ['name'] },
      run: function (a) {
        requireGitHub(); requireWrite()
        return fetch('https://api.github.com/user/repos', {
          method: 'POST', headers: ghHeaders(),
          body: JSON.stringify({ name: a.name, description: a.description || '', private: !!a.private, auto_init: a.auto_init !== false })
        }).then(checkJson).then(function (r) { return { name: r.full_name, url: r.html_url, default_branch: r.default_branch } })
      },
    },
    github_put_file: {
      description: 'Create or update a file in a repo and commit it (this is how you push work/code). Requires write actions.',
      parameters: { type: 'object', properties: {
        repo: { type: 'string', description: 'owner/repo' },
        path: { type: 'string', description: 'file path in the repo, e.g. src/app.js' },
        content: { type: 'string', description: 'the full new file content (plain text, not base64)' },
        message: { type: 'string', description: 'commit message' },
        branch: { type: 'string', description: 'branch (optional, defaults to repo default)' }
      }, required: ['repo', 'path', 'content', 'message'] },
      run: function (a) {
        requireGitHub(); requireWrite()
        var base = 'https://api.github.com/repos/' + a.repo + '/contents/' + encodeURIComponent(a.path).replace(/%2F/g, '/')
        // look up existing sha (needed for updates); ignore 404 for new files
        var getUrl = base + (a.branch ? '?ref=' + encodeURIComponent(a.branch) : '')
        return fetch(getUrl, { headers: ghHeaders() }).then(function (r) {
          return r.ok ? r.json().then(function (f) { return f.sha }) : null
        }).then(function (sha) {
          var body = { message: a.message, content: b64utf8(a.content) }
          if (a.branch) body.branch = a.branch
          if (sha) body.sha = sha
          return fetch(base, { method: 'PUT', headers: ghHeaders(), body: JSON.stringify(body) })
            .then(checkJson).then(function (res) {
              return { committed: a.path, commit: res.commit && res.commit.sha, url: res.content && res.content.html_url }
            })
        })
      },
    },
        remember_fact: {
      description: 'Save a durable fact about the user to persistent on-device memory so you get smarter every session. Use for lasting facts (username, stack, projects, preferences, goals), not trivia.',
      parameters: { type: 'object', properties: { fact: { type: 'string', description: 'a concise fact to remember, e.g. "User\'s GitHub is Fame510 and they build browser AI agents"' } }, required: ['fact'] },
      run: function (a) { addNote(a.fact); return { remembered: a.fact, total_notes: loadNotes().length } },
    },
    firecrawl_search: {
      description: 'Search the WEB and get top results (title, url, snippet). Use this to research anything, find sources, or get current info before scraping specific pages.',
      parameters: { type: 'object', properties: { query: { type: 'string', description: 'search query' }, limit: { type: 'number', description: 'number of results (default 5, max 10)' } }, required: ['query'] },
      run: function (a) {
        if (!state.fc.key) throw new Error('Firecrawl is not connected. Ask the user to paste a Firecrawl key in the sidebar.')
        return fetch('https://api.firecrawl.dev/v1/search', {
          method: 'POST', headers: { Authorization: 'Bearer ' + state.fc.key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: a.query, limit: Math.min(a.limit || 5, 10) })
        }).then(checkJson).then(function (d) {
          var items = (d.data || d.results || []).map(function (r) { return { title: r.title, url: r.url, snippet: (r.description || r.snippet || '').slice(0, 300) } })
          return { query: a.query, results: items }
        }).catch(function (e) { throw new Error('Firecrawl search failed: ' + e.message) })
      },
    },
    firecrawl_interact: {
      description: 'Drive a real browser like a human: click buttons, type into fields, press keys, scroll, and wait, THEN read the resulting page. Use for JavaScript-heavy sites, multi-step flows, search boxes, infinite scroll, and forms. This is your browser-automation tool.',
      parameters: { type: 'object', properties: {
        url: { type: 'string', description: 'starting URL' },
        actions: { type: 'array', description: 'ordered steps. Each: {type:"click"|"write"|"press"|"scroll"|"wait", selector?:CSS, text?:string, key?:"ENTER"|"TAB"..., direction?:"down"|"up", pixels?:number, milliseconds?:number}', items: { type: 'object' } }
      }, required: ['url', 'actions'] },
      run: function (a) {
        if (!state.fc.key) throw new Error('Firecrawl is not connected. Ask the user to paste a Firecrawl key in the sidebar.')
        return fetch('https://api.firecrawl.dev/v1/scrape', {
          method: 'POST', headers: { Authorization: 'Bearer ' + state.fc.key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: a.url, actions: a.actions || [], formats: ['markdown'], onlyMainContent: true })
        }).then(checkJson).then(function (d) {
          var doc = d.data || d
          return { url: a.url, actionsRun: (a.actions || []).length, content: (doc.markdown || '').slice(0, 8000) }
        }).catch(function (e) { throw new Error('Firecrawl interact failed: ' + e.message) })
      },
    },
    firecrawl_extract: {
      description: 'Scrape a page and extract STRUCTURED data matching a schema you define (great for pulling specific fields: prices, names, tables, listings). Returns clean JSON.',
      parameters: { type: 'object', properties: {
        url: { type: 'string', description: 'URL to extract from' },
        schema: { type: 'object', description: 'JSON schema of fields you want, e.g. {type:"object",properties:{price:{type:"string"},title:{type:"string"}}}' },
        prompt: { type: 'string', description: 'optional natural-language instruction for what to extract' }
      }, required: ['url'] },
      run: function (a) {
        if (!state.fc.key) throw new Error('Firecrawl is not connected. Ask the user to paste a Firecrawl key in the sidebar.')
        var jsonOptions = {}
        if (a.schema) jsonOptions.schema = a.schema
        if (a.prompt) jsonOptions.prompt = a.prompt
        return fetch('https://api.firecrawl.dev/v1/scrape', {
          method: 'POST', headers: { Authorization: 'Bearer ' + state.fc.key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: a.url, formats: ['json'], jsonOptions: jsonOptions })
        }).then(checkJson).then(function (d) {
          var doc = d.data || d
          return { url: a.url, data: doc.json || doc.llm_extraction || doc }
        }).catch(function (e) { throw new Error('Firecrawl extract failed: ' + e.message) })
      },
    },
    firecrawl_scrape: {
      description: 'Scrape a web page and return its content as markdown (uses Firecrawl).',
      parameters: { type: 'object', properties: { url: { type: 'string', description: 'full URL to read' }, onlyMainContent: { type: 'boolean', description: 'strip nav/ads (default true)' } }, required: ['url'] },
      run: function (a) {
        if (!state.fc.key) throw new Error('Firecrawl is not connected. Ask the user to paste a Firecrawl key.')
        return fetch('https://api.firecrawl.dev/v1/scrape', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + state.fc.key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: a.url, formats: ['markdown'], onlyMainContent: a.onlyMainContent !== false })
        }).then(checkJson).then(function (d) {
          var md = (d.data && d.data.markdown) || d.markdown || ''
          if (md.length > 8000) md = md.slice(0, 8000) + '\n…[truncated]'
          return { url: a.url, markdown: md }
        }).catch(function (e) {
          throw new Error('Firecrawl request failed (likely CORS from the browser): ' + e.message)
        })
      }
    },
    gmail_list: {
      description: 'List recent Gmail messages matching an optional query (e.g. "is:unread").',
      parameters: { type: 'object', properties: {
        query: { type: 'string', description: 'Gmail search query, optional' },
        limit: { type: 'number', description: 'max messages (default 5)' }
      } },
      run: function (a) {
        requireGmail()
        var n = Math.min(a && a.limit ? a.limit : 5, 15)
        var url = 'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=' + n
        if (a && a.query) url += '&q=' + encodeURIComponent(a.query)
        return fetch(url, { headers: { Authorization: 'Bearer ' + state.gm.token } }).then(checkJson).then(function (d) {
          var ids = (d.messages || []).map(function (m) { return m.id })
          return Promise.all(ids.map(getGmailMeta)).then(function (msgs) { return msgs })
        })
      }
    },
    gmail_get: {
      description: 'Get a single Gmail message by id, including a snippet of its body.',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      run: function (a) {
        requireGmail()
        return fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/' + a.id + '?format=full', {
          headers: { Authorization: 'Bearer ' + state.gm.token }
        }).then(checkJson).then(parseGmailFull)
      }
    },
    web_search: {
      description: 'Search the web WITHOUT any API key (keyless). Returns top results as readable text (titles, links, snippets). Use this to research or find sources, then read_url the best hits. This is your default search — no setup needed.',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      run: function (a) {
        return fetch('https://s.jina.ai/' + encodeURIComponent(a.query), { headers: { 'X-Respond-With': 'no-content' } })
          .then(function (r) { return r.text() })
          .then(function (t) { if (t.length > 7000) t = t.slice(0, 7000) + '\n\u2026[truncated]'; return { query: a.query, results: t } })
          .catch(function (e) { throw new Error('Keyless search failed (' + e.message + '). Try read_url on a known page, or add a Firecrawl key for premium search.') })
      }
    },
    read_url: {
      description: 'Read ANY web page as clean text/markdown WITHOUT any API key (keyless). The default way to read articles, docs, and pages. Returns readable content.',
      parameters: { type: 'object', properties: { url: { type: 'string', description: 'full URL incl. https://' } }, required: ['url'] },
      run: function (a) {
        return fetch('https://r.jina.ai/' + a.url).then(function (r) { return r.text() })
          .then(function (t) { if (t.length > 9000) t = t.slice(0, 9000) + '\n\u2026[truncated]'; return { url: a.url, content: t } })
          .catch(function (e) { throw new Error('Keyless read failed (' + e.message + '). Add a Firecrawl key for a more robust reader.') })
      }
    },
    generate_image: {
      description: 'Generate an image from a text prompt WITHOUT any API key (keyless). Returns an image_url. ALWAYS show it to the user in your reply with markdown: ![prompt](image_url).',
      parameters: { type: 'object', properties: { prompt: { type: 'string' }, width: { type: 'number', description: 'default 1024' }, height: { type: 'number', description: 'default 1024' } }, required: ['prompt'] },
      run: function (a) {
        var w = a.width || 1024, h = a.height || 1024
        var url = 'https://image.pollinations.ai/prompt/' + encodeURIComponent(a.prompt) + '?width=' + w + '&height=' + h + '&nologo=true&seed=' + Math.floor(Math.random() * 1e6)
        return Promise.resolve({ prompt: a.prompt, image_url: url, show_with: '![' + a.prompt + '](' + url + ')' })
      }
    },
    run_js: {
      description: 'Execute JavaScript in the browser sandbox and return the result. Use for math, data processing, parsing, algorithms, generating tables/text, or any computation. Use `return` to produce output. `fetch` is available (subject to CORS).',
      parameters: { type: 'object', properties: { code: { type: 'string', description: 'JS function body; use return to produce output' } }, required: ['code'] },
      run: function (a) {
        return new Promise(function (resolve) {
          try {
            var fn = new Function('"use strict";\n' + a.code)
            Promise.resolve(fn()).then(
              function (v) { resolve({ result: (typeof v === 'undefined' ? '(ran, no return value)' : v) }) },
              function (e) { resolve({ error: String(e && e.message || e) }) }
            )
          } catch (e) { resolve({ error: String(e && e.message || e) }) }
        })
      }
    },
    datetime_now: {
      description: 'Get the current date and time (local + UTC).',
      parameters: { type: 'object', properties: {} },
      run: function () { var d = new Date(); return Promise.resolve({ local: d.toString(), iso_utc: d.toISOString(), timestamp: d.getTime() }) }
    },
    create_gist: {
      description: 'Create a GitHub Gist (a quick shareable file/snippet). Requires GitHub connected + write actions enabled. Returns the gist URL.',
      parameters: { type: 'object', properties: { filename: { type: 'string' }, content: { type: 'string' }, description: { type: 'string' }, 'public': { type: 'boolean' } }, required: ['filename', 'content'] },
      run: function (a) {
        requireGitHub(); requireWrite()
        var files = {}; files[a.filename] = { content: a.content }
        return fetch('https://api.github.com/gists', { method: 'POST', headers: ghHeaders(), body: JSON.stringify({ description: a.description || '', 'public': !!a['public'], files: files }) })
          .then(checkJson).then(function (g) { return { url: g.html_url, id: g.id, raw: (g.files && g.files[a.filename] && g.files[a.filename].raw_url) || null } })
      }
    },
    http_request: {
      description: 'Call ANY REST API over HTTPS \u2014 your universal connector to thousands of services (Notion, Airtable, Linear, Stripe, weather, news, CRMs \u2014 anything with an API). Provide method, url, optional headers and body. To use a saved secret safely, put {{vault:NAME}} in a header/url/body value; it is substituted on-device and NEVER sent to the model provider. Returns status + parsed JSON/text.',
      parameters: { type: 'object', properties: {
        method: { type: 'string', description: 'GET, POST, PUT, PATCH, DELETE (default GET)' },
        url: { type: 'string' },
        headers: { type: 'object', description: 'header name -> value; values may contain {{vault:NAME}}' },
        body: { type: 'string', description: 'raw request body (usually a JSON string) for write methods' }
      }, required: ['url'] },
      run: function (a) {
        var hdrs = a.headers || {}, out = {}
        Object.keys(hdrs).forEach(function (k) { out[k] = subVault(String(hdrs[k])) })
        var init = { method: (a.method || 'GET').toUpperCase(), headers: out }
        if (a.body && init.method !== 'GET' && init.method !== 'HEAD') init.body = subVault(a.body)
        return fetch(subVault(a.url), init).then(function (r) {
          return r.text().then(function (t) {
            var data; try { data = JSON.parse(t) } catch (e) { data = t }
            if (typeof data === 'string' && data.length > 8000) data = data.slice(0, 8000) + '\n\u2026[truncated]'
            return { status: r.status, ok: r.ok, data: data }
          })
        }).catch(function (e) { throw new Error('Request failed (' + e.message + '). Many APIs block direct browser calls via CORS; if so this service needs a backend proxy.') })
      }
    },
    list_capabilities: {
      description: 'Return DUCKi\'s full, current ability list (all tools, brains, and connection types). Call this whenever the user asks what you can do, then present it richly, grouped by category, emphasizing what the tools do TOGETHER.',
      parameters: { type: 'object', properties: {} },
      run: function () { return Promise.resolve(CAPABILITIES) }
    }
  }


  // ----- Connections vault: on-device API secrets, injected client-side only -----
  var VAULT_KEY = 'ducki_vault_v1'
  function loadVault() { try { return JSON.parse(LS.get(VAULT_KEY, '{}')) || {} } catch (e) { return {} } }
  function saveVault(o) { try { LS.set(VAULT_KEY, JSON.stringify(o)) } catch (e) {} }
  function subVault(s) { return String(s).replace(/\{\{\s*vault:([^}]+)\}\}/g, function (_, n) { var v = loadVault(); n = n.trim(); return v[n] != null ? v[n] : '' }) }

  // ----- the honest, data-driven capability manifest (what "what can you do?" returns) -----
  var CAPABILITIES = {
    identity: 'DUCKi by AEON DUX \u2014 an autonomous agent running fully in your browser (bring-your-own-key, nothing on a server).',
    brains: ['On-device Genius (Llama-3.2-1B, WebGPU, no key)', 'On-device Light (Qwen2.5-0.5B, no key, runs anywhere)', 'Any cloud LLM with your own key: OpenAI, Anthropic/Claude, Gemini, DeepSeek, GLM, Qwen, Kimi, OpenRouter, SiliconFlow'],
    web_keyless: ['web_search \u2014 search the web, no key', 'read_url \u2014 read any page as clean text, no key', 'generate_image \u2014 text-to-image, no key'],
    web_premium: ['firecrawl_search / firecrawl_scrape / firecrawl_extract (structured JSON) / firecrawl_interact (drive a browser: click, type, scroll, submit forms)'],
    code_and_data: ['run_js \u2014 execute JavaScript for math, parsing, algorithms, data crunching', 'datetime_now'],
    github: ['github_me, github_list_repos (incl. private), github_get_file, github_search_repos, github_create_issue, github_create_repo, github_put_file (commit/push code), create_gist'],
    email: ['gmail_list, gmail_get (read your Gmail)'],
    universal_connector: 'http_request \u2014 call ANY REST API (Notion, Airtable, Linear, Stripe, weather, news, CRMs, thousands more). Store keys in the Connections vault and reference them as {{vault:NAME}}; secrets are injected on-device and never sent to the model.',
    memory: ['remember_fact \u2014 persistent on-device memory that makes DUCKi smarter every session'],
    superpowers: [
      'Research + build + ship: web_search \u2192 read_url \u2192 run_js \u2192 github_create_repo \u2192 github_put_file, then hand you the live links.',
      'Connect + act: store an API key once, then http_request drives that service on command.',
      'Automate the web: firecrawl_interact behaves like a human on JS-heavy sites and forms.',
      'Private by default: your keys, your chats, your machine \u2014 no backend.'
    ],
    honest_limits: 'Runs client-side with no server, so it cannot do OAuth-only logins that need server-held secrets, or run jobs while the app is closed. Everything else \u2014 fair game.'
  }

  function requireGmail() { if (!state.gm.token) throw new Error('Gmail is not connected. Ask the user to click "Connect Gmail" in the sidebar.') }
  function getGmailMeta(id) {
    return fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/' + id + '?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date', {
      headers: { Authorization: 'Bearer ' + state.gm.token }
    }).then(checkJson).then(function (m) {
      var h = {}; ((m.payload && m.payload.headers) || []).forEach(function (x) { h[x.name.toLowerCase()] = x.value })
      return { id: id, from: h.from, subject: h.subject, date: h.date, snippet: m.snippet }
    })
  }
  function parseGmailFull(m) {
    var h = {}; ((m.payload && m.payload.headers) || []).forEach(function (x) { h[x.name.toLowerCase()] = x.value })
    var body = ''
    function walk(p) {
      if (!p) return
      if (p.mimeType === 'text/plain' && p.body && p.body.data) { body += b64url(p.body.data) }
      else if (p.parts) p.parts.forEach(walk)
    }
    walk(m.payload)
    if (!body && m.payload && m.payload.body && m.payload.body.data) body = b64url(m.payload.body.data)
    if (body.length > 6000) body = body.slice(0, 6000) + '\n…[truncated]'
    return { id: m.id, from: h.from, subject: h.subject, date: h.date, snippet: m.snippet, body: body }
  }
  function b64url(d) { try { return decodeURIComponent(escape(atob(d.replace(/-/g, '+').replace(/_/g, '/')))) } catch (e) { return '' } }

  function checkJson(r) {
    return r.text().then(function (t) {
      var data; try { data = t ? JSON.parse(t) : {} } catch (e) { data = { raw: t } }
      if (!r.ok) {
        var msg = (data && (data.message || data.error || (data.error && data.error.message))) || r.status + ' ' + r.statusText
        if (data && data.error && data.error.message) msg = data.error.message
        throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
      }
      return data
    })
  }

  // tool schema for the LLMs
  function toolSpecs() {
    return Object.keys(TOOLS).map(function (name) {
      return { name: name, description: TOOLS[name].description, parameters: TOOLS[name].parameters }
    })
  }

  // ======================================================================
  //  LLM ADAPTERS  (normalize history -> request, response -> {text, toolCalls})
  // ======================================================================
  var SYSTEM = [
    "You are DUCKi, an autonomous AI agent by AEON DUX, running live in the user's own browser. Your name is DUCKi; you were created by AEON DUX. NEVER call yourself OpenClaw, EasyClaw, Claw, Claude, ChatGPT, or any other name, and never mention the framework or base model you run on. If asked who you are: DUCKi by AEON DUX.",
    "VOICE: sharp, warm, a little witty, genuinely helpful. Explain your reasoning. NEVER give terse, robotic one-line answers unless asked for brevity \u2014 write rich, well-structured replies with concrete detail, a friendly human voice, and a useful next step. Write like a brilliant teammate, not a status terminal.",
    "OPERATING LOOP (behave like a senior autonomous agent): 1) Understand the real goal. 2) Make a quick plan. 3) USE YOUR TOOLS to get real data or do real work \u2014 do not guess, and do not ask permission for read-only steps. 4) Chain many tools across steps (dozens if needed) until the task is truly finished. 5) VERIFY before you claim: something is done only when a tool result confirms it \u2014 report the real links/values, never a maybe. 6) Synthesize a thorough final answer from the actual results.",
    "YOUR TOOLS \u2014 a compounding toolkit; use them aggressively and in combination:",
    "\u2022 Web, NO KEY NEEDED: web_search (search the web keyless), read_url (read any page as clean text keyless), generate_image (text-to-image keyless \u2014 ALWAYS show the result with markdown ![prompt](image_url)). These work with zero setup, so never tell the user you can't browse or make images.",
    "\u2022 Web, premium (free Firecrawl key): firecrawl_search, firecrawl_scrape, firecrawl_extract (structured JSON by schema), firecrawl_interact (DRIVE a browser: click/type/scroll/press/wait then read \u2014 real automation for JS-heavy sites and forms).",
    "\u2022 Code & data: run_js (execute JavaScript for math, parsing, algorithms, data crunching, building tables). datetime_now.",
    "\u2022 GitHub: github_me, github_list_repos (incl. private), github_get_file, github_search_repos, github_create_issue, github_create_repo, github_put_file (create/commit files = push code), create_gist (shareable snippet).",
    "\u2022 Gmail: gmail_list, gmail_get.",
    "\u2022 UNIVERSAL CONNECTOR: http_request \u2014 call ANY REST API over HTTPS (Notion, Airtable, Linear, Stripe, weather, news, CRMs \u2014 thousands of services). This is how you reach almost anything. To use a saved secret safely, put {{vault:NAME}} in a header/url/body value; it is substituted on-device and never sent to the model provider. If a service has an API, wire it with http_request instead of saying you can't.",
    "\u2022 Memory: remember_fact (save durable facts about the user to on-device memory so you get smarter every session). list_capabilities (your full current ability list).",
    "WHEN ASKED 'what can you do?' or anything about your abilities: CALL list_capabilities, then present the full compounded picture grouped by category \u2014 never a short canned blurb. Emphasize what the tools do TOGETHER (research+build+push, connect+act, read+automate).",
    "BUILDING: when asked to build/create/push/save, actually do it \u2014 github_create_repo then github_put_file for each file \u2014 and report the real repo + commit URLs. Perform the actions; don't just describe them.",
    "KEYS & CONNECTIONS: read-only web and image generation need no key. Premium web wants a free Firecrawl key; GitHub wants a token; Gmail is one click; any other API just needs a key added to the Connections vault. If a tool isn't connected, tell the user exactly which sidebar connection unlocks it. If a tool errors, explain plainly and suggest a fix.",
    "HONESTY: you run fully client-side with no server, and you can do a great deal this way. If something genuinely needs a backend (OAuth-only logins, jobs that run while the app is closed), say so honestly instead of pretending. Use markdown throughout. Be the most capable, personable agent the user has ever used."
  ].join('\n\n')

  // ----- persona-only system for on-device (tool-free) brains -----
  var PERSONA = 'You are DUCKi, an AI assistant by AEON DUX, running 100% on the user\'s own device in their browser \u2014 no server, no API key, fully private. ' +
    'Your name is DUCKi, created by AEON DUX; never call yourself any other name and never mention the framework you run on. ' +
    'You are sharp, warm, a little witty, and genuinely helpful. Explain your reasoning and NEVER give terse, robotic one-line answers unless asked for brevity \u2014 aim for rich, well-structured replies with concrete detail and a friendly human voice, and offer a useful next step. Use markdown. ' +
    'You are a compact on-device model, so right now you do NOT have live web / GitHub / Gmail tools. Answer thoroughly from your own knowledge; if a task truly needs live data or an action (search, push code, read email), say so plainly and suggest switching to a cloud brain with the user\'s own key in Settings for full tool power.'
  function buildPersona() {
    // On-device models have a tiny (~4k token) context window, so keep this SMALL:
    // a short persona + a few durable notes. Conversation turns are added (and capped)
    // by odMessages(); we deliberately do NOT dump the full memory log here — doing so
    // overflowed the window and the model returned nothing.
    var sys = PERSONA
    var notes = loadNotes()
    if (notes.length) {
      var few = notes.slice(-6).map(function (n) { return String(n).slice(0, 160) })
      sys += '\n\nWHAT YOU KNOW ABOUT THIS USER:\n- ' + few.join('\n- ')
    }
    return sys
  }

  // ----- on-device engines: WebLLM (genius) + transformers.js (light) -----
  var odGenius = null, odGeniusLoading = null          // WebLLM engine
  var odLight = null, odLightLoading = null             // transformers.js pipeline
  function odIsProvider(p) { return p === 'ondevice' || p === 'ondevice_light' }
  function loadGenius() {
    if (odGenius) return Promise.resolve(odGenius)
    if (odGeniusLoading) return odGeniusLoading
    if (!navigator.gpu) return Promise.reject(new Error('This browser has no WebGPU. Pick "On-device light" (works anywhere), or a cloud brain with your own key.'))
    status('llmStatus', 'Loading Genius model (Llama-3.2-1B) on your device\u2026 first load ~900MB, then it caches.', '')
    odGeniusLoading = import('https://esm.run/@mlc-ai/web-llm@0.2.79').then(function (M) {
      return M.CreateMLCEngine('Llama-3.2-1B-Instruct-q4f32_1-MLC', { initProgressCallback: function (p) { status('llmStatus', 'Genius model: ' + ((p && p.text) || 'loading\u2026'), '') } })
    }).then(function (e) { odGenius = e; odGeniusLoading = null; setDot('dot-llm', 'on'); status('llmStatus', '\u2713 Genius on-device ready \u2014 runs fully on your device, no key.', 'ok'); return e })
      .catch(function (err) { odGeniusLoading = null; setDot('dot-llm', 'err'); status('llmStatus', '\u2717 ' + err.message, 'err'); throw err })
    return odGeniusLoading
  }
  function loadLight() {
    if (odLight) return Promise.resolve(odLight)
    if (odLightLoading) return odLightLoading
    status('llmStatus', 'Loading light on-device model (Qwen2.5-0.5B)\u2026 first load downloads once, then caches.', '')
    odLightLoading = import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2').then(function (T) {
      return T.pipeline('text-generation', 'onnx-community/Qwen2.5-0.5B-Instruct', { dtype: 'q4', device: (navigator.gpu ? 'webgpu' : 'wasm'), progress_callback: function (p) { if (p.status === 'progress' && p.progress) status('llmStatus', 'Downloading model: ' + Math.round(p.progress) + '%', '') } })
    }).then(function (g) { odLight = g; odLightLoading = null; setDot('dot-llm', 'on'); status('llmStatus', '\u2713 Light on-device ready \u2014 runs fully on your device, no key.', 'ok'); return g })
      .catch(function (err) { odLightLoading = null; setDot('dot-llm', 'err'); status('llmStatus', '\u2717 ' + err.message, 'err'); throw err })
    return odLightLoading
  }
  function loadOndevice() { return state.llm.provider === 'ondevice_light' ? loadLight() : loadGenius() }
  function odMessages() {
    var sys = buildPersona()
    if (sys.length > 1400) sys = sys.slice(0, 1400)
    var msgs = [{ role: 'system', content: sys }]
    // Small context window: send only the most recent turns, each truncated,
    // so the prompt never exceeds the on-device model's limit.
    var turns = []
    state.history.forEach(function (h) {
      if (h.role === 'user') turns.push({ role: 'user', content: String(h.text || '').slice(0, 700) })
      else if (h.role === 'assistant' && h.text) turns.push({ role: 'assistant', content: String(h.text).slice(0, 700) })
      // tool turns skipped: on-device runs tool-free
    })
    return msgs.concat(turns.slice(-4))
  }
  function callWebLLM() {
    if (state.llm.provider === 'ondevice_light') {
      return loadLight().then(function (g) {
        return g(odMessages(), { max_new_tokens: 700, temperature: 0.7, do_sample: true }).then(function (out) {
          var r = out[0].generated_text
          if (Array.isArray(r)) r = r[r.length - 1].content
          else if (typeof r === 'string') { var parts = r.split('assistant'); r = (parts[parts.length - 1] || r).trim() }
          return { text: (r || '').trim(), toolCalls: [] }
        })
      })
    }
    return loadGenius().then(function (e) {
      return e.chat.completions.create({ messages: odMessages(), temperature: 0.7, max_tokens: 768 }).then(function (r) {
        var out = r && r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content
        return { text: (out || '').trim(), toolCalls: [] }
      })
    })
  }

  // ===================== CLIENT-SIDE MEMORY (on-device) =====================
  var MEM_KEY = 'ducki_memory_v1'
  var NOTES_KEY = 'ducki_notes_v1'
  var MAX_MEM_MSGS = 1600
  function loadMem() { try { return JSON.parse(LS.get(MEM_KEY, '[]')) || [] } catch (e) { return [] } }
  function saveMem(arr) { try { LS.set(MEM_KEY, JSON.stringify(arr.slice(-MAX_MEM_MSGS))) } catch (e) {} }
  function rememberTurn(role, text) {
    if (!text) return
    var m = loadMem(); m.push({ r: role, t: String(text).slice(0, 4000), ts: Date.now() }); saveMem(m)
  }
  function loadNotes() { try { return JSON.parse(LS.get(NOTES_KEY, '[]')) || [] } catch (e) { return [] } }
  function saveNotes(arr) { try { LS.set(NOTES_KEY, JSON.stringify(arr.slice(-200))) } catch (e) {} }
  function addNote(note) { if (!note) return; var ns = loadNotes(); if (ns.indexOf(note) === -1) { ns.push(note); saveNotes(ns) } }
  function recentMemoryText() {
    var m = loadMem().slice(-40)
    if (!m.length) return ''
    return m.map(function (x) { return (x.r === 'user' ? 'User' : 'DUCKi') + ': ' + x.t }).join('\n')
  }
  function buildSystem() {
    var sys = SYSTEM
    var notes = loadNotes()
    if (notes.length) sys += '\n\nWHAT YOU HAVE LEARNED ABOUT THIS USER (persistent memory, use it naturally and keep improving it):\n- ' + notes.join('\n- ')
    var mem = recentMemoryText()
    if (mem) sys += '\n\nRECENT CONVERSATION MEMORY (earlier sessions on this device, for continuity):\n' + mem
    sys += '\n\nMEMORY TOOL: When you learn a durable fact about the user (GitHub username, preferred stack, projects, style, goals), call remember_fact to save it so you get smarter every session. Do this proactively but only for genuinely useful, lasting facts.'
    return sys
  }

  function groupForToolResults(history) {
    // returns history as-is; adapters handle grouping
    return history
  }

  // ---- OpenAI / DeepSeek (OpenAI-compatible) ----
  function callOpenAI(baseURL) {
    return function () {
      var messages = [{ role: 'system', content: buildSystem() }]
      state.history.forEach(function (h) {
        if (h.role === 'user') messages.push({ role: 'user', content: h.text })
        else if (h.role === 'assistant') {
          var m = { role: 'assistant', content: h.text || null }
          if (h.toolCalls && h.toolCalls.length) {
            m.tool_calls = h.toolCalls.map(function (tc) {
              return { id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.args || {}) } }
            })
          }
          messages.push(m)
        } else if (h.role === 'tool') {
          messages.push({ role: 'tool', tool_call_id: h.id, content: JSON.stringify(h.result) })
        }
      })
      var body = {
        model: state.llm.model,
        messages: messages,
        tools: toolSpecs().map(function (t) { return { type: 'function', function: t } }),
        tool_choice: 'auto'
      }
      return fetch(baseURL + '/chat/completions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + state.llm.key, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).then(checkJson).then(function (d) {
        var msg = d.choices[0].message
        var toolCalls = (msg.tool_calls || []).map(function (tc) {
          var args = {}; try { args = JSON.parse(tc.function.arguments || '{}') } catch (e) {}
          return { id: tc.id, name: tc.function.name, args: args }
        })
        return { text: msg.content || '', toolCalls: toolCalls }
      })
    }
  }

  // ---- Anthropic ----
  function callAnthropic() {
    var messages = []
    state.history.forEach(function (h) {
      if (h.role === 'user') messages.push({ role: 'user', content: [{ type: 'text', text: h.text }] })
      else if (h.role === 'assistant') {
        var content = []
        if (h.text) content.push({ type: 'text', text: h.text })
        ;(h.toolCalls || []).forEach(function (tc) { content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.args || {} }) })
        messages.push({ role: 'assistant', content: content })
      } else if (h.role === 'tool') {
        // merge into previous user message if it already holds tool_results
        var block = { type: 'tool_result', tool_use_id: h.id, content: JSON.stringify(h.result) }
        var last = messages[messages.length - 1]
        if (last && last.role === 'user' && Array.isArray(last.content) && last.content[0] && last.content[0].type === 'tool_result') {
          last.content.push(block)
        } else {
          messages.push({ role: 'user', content: [block] })
        }
      }
    })
    var body = {
      model: state.llm.model,
      max_tokens: 2048,
      system: buildSystem(),
      messages: messages,
      tools: toolSpecs().map(function (t) { return { name: t.name, description: t.description, input_schema: t.parameters } })
    }
    return fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': state.llm.key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    }).then(checkJson).then(function (d) {
      var text = '', toolCalls = []
      ;(d.content || []).forEach(function (b) {
        if (b.type === 'text') text += b.text
        else if (b.type === 'tool_use') toolCalls.push({ id: b.id, name: b.name, args: b.input || {} })
      })
      return { text: text, toolCalls: toolCalls }
    })
  }

  // ---- Google Gemini ----
  function callGemini() {
    var contents = []
    state.history.forEach(function (h) {
      if (h.role === 'user') contents.push({ role: 'user', parts: [{ text: h.text }] })
      else if (h.role === 'assistant') {
        var parts = []
        if (h.text) parts.push({ text: h.text })
        ;(h.toolCalls || []).forEach(function (tc) { parts.push({ functionCall: { name: tc.name, args: tc.args || {} } }) })
        contents.push({ role: 'model', parts: parts })
      } else if (h.role === 'tool') {
        var fr = { functionResponse: { name: h.name, response: { result: h.result } } }
        var last = contents[contents.length - 1]
        if (last && last.role === 'user' && last.parts[0] && last.parts[0].functionResponse) last.parts.push(fr)
        else contents.push({ role: 'user', parts: [fr] })
      }
    })
    var body = {
      systemInstruction: { parts: [{ text: buildSystem() }] },
      contents: contents,
      tools: [{ functionDeclarations: toolSpecs() }]
    }
    var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + state.llm.model + ':generateContent?key=' + encodeURIComponent(state.llm.key)
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(checkJson).then(function (d) {
        var cand = d.candidates && d.candidates[0]
        var text = '', toolCalls = []
        if (cand && cand.content && cand.content.parts) {
          cand.content.parts.forEach(function (p, i) {
            if (p.text) text += p.text
            else if (p.functionCall) toolCalls.push({ id: 'g_' + Date.now() + '_' + i, name: p.functionCall.name, args: p.functionCall.args || {} })
          })
        }
        return { text: text, toolCalls: toolCalls }
      })
  }

  function callLLM() {
    var p = state.llm.provider
    if (p === 'openai') return callOpenAI('https://api.openai.com/v1')()
    if (p === 'deepseek') return callOpenAI('https://api.deepseek.com/v1')()
    if (p === 'glm') return callOpenAI('https://open.bigmodel.cn/api/paas/v4')()
    if (p === 'qwen') return callOpenAI('https://dashscope-international.aliyuncs.com/compatible-mode/v1')()
    if (p === 'kimi') return callOpenAI('https://api.moonshot.cn/v1')()
    if (p === 'openrouter') return callOpenAI('https://openrouter.ai/api/v1')()
    if (p === 'siliconflow') return callOpenAI('https://api.siliconflow.com/v1')()
    if (p === 'anthropic') return callAnthropic()
    if (p === 'gemini') return callGemini()
    if (odIsProvider(p)) return callWebLLM()
    return Promise.reject(new Error('Unknown provider'))
  }

  // ======================================================================
  //  AGENT LOOP
  // ======================================================================
  var running = false
  function send() {
    var inputEl = $('input')
    var text = inputEl.value.trim()
    if (!text || running) return
    if (!odIsProvider(state.llm.provider) && !state.llm.key) { banner('Add an LLM API key in the sidebar — or pick an on-device brain (no key needed) at the top of the list.'); return }
    inputEl.value = ''; autosize(inputEl)
    pushUser(text)
    runAgent()
  }

  var MAX_STEPS = 40
  function runAgent() {
    running = true
    setComposer(false)
    var thinking = addThinking()
    var steps = 0
    function step() {
      callLLM().then(function (res) {
        steps++
        // record assistant turn
        state.history.push({ role: 'assistant', text: res.text, toolCalls: res.toolCalls })
        if (res.text) { rememberTurn('assistant', res.text); addMessage('assistant', res.text) }
        if (res.toolCalls && res.toolCalls.length && steps < MAX_STEPS) {
          // execute tools sequentially
          var i = 0
          function next() {
            if (i >= res.toolCalls.length) { step(); return }
            var tc = res.toolCalls[i++]
            var card = addToolCard(tc)
            executeTool(tc).then(function (result) {
              state.history.push({ role: 'tool', id: tc.id, name: tc.name, result: result })
              fillToolCard(card, result, false)
              next()
            }).catch(function (err) {
              var result = { error: err.message }
              state.history.push({ role: 'tool', id: tc.id, name: tc.name, result: result })
              fillToolCard(card, result, true)
              next()
            })
          }
          next()
        } else {
          finish()
        }
      }).catch(function (err) {
        addMessage('assistant', '⚠️ ' + err.message)
        finish()
      })
    }
    function finish() { thinking.remove(); running = false; setComposer(true); scrollDown() }
    step()
  }

  function executeTool(tc) {
    var tool = TOOLS[tc.name]
    if (!tool) return Promise.reject(new Error('Unknown tool: ' + tc.name))
    try { return Promise.resolve(tool.run(tc.args || {})) }
    catch (e) { return Promise.reject(e) }
  }

  // ======================================================================
  //  UI RENDERING
  // ======================================================================
  function clearEmpty() { var e = $('empty'); if (e) e.remove() }
  function pushUser(text) { state.history.push({ role: 'user', text: text }); rememberTurn('user', text); addMessage('user', text) }
  function speakText(t, btn) {
    try {
      if (!('speechSynthesis' in window)) { banner('Text-to-speech is not supported in this browser.'); return }
      if (window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel()
        if (btn && btn.dataset.speaking === '1') { btn.dataset.speaking = '0'; btn.textContent = '🔊'; return }
      }
      var u = new SpeechSynthesisUtterance(t)
      u.rate = 1.02; u.pitch = 1.0
      if (btn) {
        btn.dataset.speaking = '1'; btn.textContent = '⏹'
        u.onend = function () { btn.dataset.speaking = '0'; btn.textContent = '🔊' }
        u.onerror = function () { btn.dataset.speaking = '0'; btn.textContent = '🔊' }
      }
      window.speechSynthesis.speak(u)
    } catch (e) { banner('TTS error: ' + e.message) }
  }
  function copyText(t, btn) {
    function done() { if (btn) { var o = btn.textContent; btn.textContent = '✓'; setTimeout(function () { btn.textContent = '📋' }, 1200) } }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(done, function () { fallbackCopy(t); done() })
    } else { fallbackCopy(t); done() }
  }
  function fallbackCopy(t) {
    var ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select()
    try { document.execCommand('copy') } catch (e) {}
    document.body.removeChild(ta)
  }
  function msgActions(role, text) {
    if (role === 'user') return ''
    var safe = esc(text).replace(/'/g, '&#39;')
    return '<div class="msg-actions">' +
      '<button class="msg-btn copy-btn" title="Copy">📋</button>' +
      '<button class="msg-btn tts-btn" title="Read aloud" data-speaking="0">🔊</button>' +
      '</div>'
  }
  function wireActions(wrap, text) {
    var c = wrap.querySelector('.copy-btn'), s = wrap.querySelector('.tts-btn')
    if (c) c.addEventListener('click', function () { copyText(text, c) })
    if (s) s.addEventListener('click', function () { speakText(text, s) })
  }
  function addMessage(role, text) {
    clearEmpty()
    var wrap = document.createElement('div')
    wrap.className = 'msg ' + role
    wrap.innerHTML = '<div class="role">' + (role === 'user' ? 'You' : 'DUCKi') + '</div><div class="bubble">' + renderMarkdown(text) + '</div>' + msgActions(role, text)
    $('messages').appendChild(wrap); wireActions(wrap, text); scrollDown(); return wrap
  }
  function addThinking() {
    clearEmpty()
    var el = document.createElement('div')
    el.className = 'msg assistant'
    el.innerHTML = '<div class="role">DUCKi</div><div class="bubble">…thinking</div>'
    $('messages').appendChild(el); scrollDown(); return el
  }
  function addToolCard(tc) {
    var el = document.createElement('details')
    el.className = 'tool'; el.open = false
    el.innerHTML = '<summary>🔧 ' + esc(tc.name) + '(' + esc(JSON.stringify(tc.args || {})) + ')</summary><pre>running…</pre>'
    $('messages').appendChild(el); scrollDown(); return el
  }
  function fillToolCard(el, result, isErr) {
    var pre = el.querySelector('pre')
    pre.textContent = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
    if (isErr) { el.style.borderColor = 'rgba(251,113,133,0.4)'; el.open = true }
    scrollDown()
  }
  function scrollDown() { var m = $('messages'); m.scrollTop = m.scrollHeight }
  function setComposer(enabled) { $('send').disabled = !enabled; $('input').disabled = !enabled }
  function banner(msg) {
    var b = $('banner'); b.textContent = msg; b.style.display = 'block'
    setTimeout(function () { b.style.display = 'none' }, 5000)
  }
  function autosize(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 160) + 'px' }

  // ======================================================================
  //  CONNECTION HANDLERS
  // ======================================================================
  function populateModels(p) {
    var dl = $('modelList'); if (!dl) return
    var opts = (MODELS[p] || []).map(function (m) { return '<option value="' + m + '"></option>' }).join('')
    dl.innerHTML = opts
    var ph = $('llmModel'); if (ph) ph.placeholder = 'e.g. ' + (DEFAULT_MODEL[p] || 'model id') + ' — or pick from list'
  }
  function loadLlmFields() {
    var p = state.llm.provider
    $('llmProvider').value = p
    state.llm.key = LS.get('ec_llm_key_' + p, '')
    state.llm.model = LS.get('ec_llm_model_' + p, DEFAULT_MODEL[p])
    $('llmKey').value = state.llm.key
    $('llmModel').value = state.llm.model
    populateModels(p)
    setDot('dot-llm', odIsProvider(p) ? ((odGenius || odLight) ? 'on' : '') : (state.llm.key ? 'on' : ''))
  }

  function renderVault() {
    var el = $('vaultList'); if (!el) return
    var v = loadVault(), names = Object.keys(v)
    setDot('dot-vault', names.length ? 'on' : '')
    if (!names.length) { el.innerHTML = 'No keys saved yet.'; return }
    el.innerHTML = names.map(function (n) { return '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin:3px 0"><code>' + esc(n) + '</code> <button class="vault-del" data-n="' + esc(n) + '" style="margin:0;padding:1px 7px;font-size:11px">remove</button></div>' }).join('')
    Array.prototype.forEach.call(el.querySelectorAll('.vault-del'), function (b) {
      b.addEventListener('click', function () { var o = loadVault(); delete o[b.getAttribute('data-n')]; saveVault(o); renderVault() })
    })
  }

  function initEvents() {
    $('originHint').textContent = location.origin

    $('llmProvider').addEventListener('change', function () {
      state.llm.provider = this.value; LS.set('ec_llm_provider', this.value); loadLlmFields(); status('llmStatus', '', '')
    })
    $('saveLlm').addEventListener('click', function () {
      var p = state.llm.provider
      if (odIsProvider(p)) { loadOndevice(); return }
      state.llm.key = $('llmKey').value.trim()
      state.llm.model = $('llmModel').value.trim() || DEFAULT_MODEL[p]
      LS.set('ec_llm_key_' + p, state.llm.key); LS.set('ec_llm_model_' + p, state.llm.model)
      if (!state.llm.key) { setDot('dot-llm', ''); status('llmStatus', 'Key cleared.', ''); return }
      setDot('dot-llm', 'on'); status('llmStatus', 'Saved. Verifying…', '')
      verifyLlm().then(function () { status('llmStatus', '✓ ' + p + ' / ' + state.llm.model + ' ready', 'ok') })
        .catch(function (e) { setDot('dot-llm', 'err'); status('llmStatus', '✗ ' + e.message, 'err') })
    })

    $('saveGh').addEventListener('click', function () {
      state.gh.token = $('ghToken').value.trim()
      LS.set('ec_github_pat', state.gh.token)
      if (!state.gh.token) { setDot('dot-gh', ''); status('ghStatus', 'Token cleared.', ''); return }
      status('ghStatus', 'Connecting…', '')
      fetch('https://api.github.com/user', { headers: ghHeaders() }).then(checkJson).then(function (u) {
        state.gh.user = u.login; setDot('dot-gh', 'on'); status('ghStatus', '✓ Connected as ' + u.login, 'ok')
      }).catch(function (e) { setDot('dot-gh', 'err'); status('ghStatus', '✗ ' + e.message, 'err') })
    })

    $('saveFc').addEventListener('click', function () {
      state.fc.key = $('fcKey').value.trim(); LS.set('ec_firecrawl_key', state.fc.key)
      setDot('dot-fc', state.fc.key ? 'on' : ''); status('fcStatus', state.fc.key ? '✓ Key saved' : 'Key cleared.', state.fc.key ? 'ok' : '')
    })

    $('connectGm').addEventListener('click', connectGmail)

    $('allowWrites').addEventListener('change', function () {
      state.allowWrites = this.checked; LS.set('ec_allow_writes', this.checked ? '1' : '0')
    })

    $('send').addEventListener('click', send)
    $('input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
    })
    $('input').addEventListener('input', function () { autosize(this) })

    var ex = $('examples')
    if (ex) ex.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return
      $('input').value = b.getAttribute('data-ex'); autosize($('input')); $('input').focus()
    })

    var svb = $('saveVault')
    if (svb) svb.addEventListener('click', function () {
      var n = $('vaultName').value.trim(), val = $('vaultValue').value.trim()
      if (!n || !val) { status('vaultStatus', 'Enter a name and a secret.', 'err'); return }
      var o = loadVault(); o[n] = val; saveVault(o)
      $('vaultName').value = ''; $('vaultValue').value = ''
      status('vaultStatus', '✓ Saved ' + n, 'ok'); renderVault()
    })

    $('menuBtn').addEventListener('click', function () { $('sidebar').classList.toggle('open') })
  }

  function verifyLlm() {
    // lightweight: a 1-token ping per provider
    var p = state.llm.provider
    if (p === 'gemini') {
      return fetch('https://generativelanguage.googleapis.com/v1beta/models/' + state.llm.model + '?key=' + encodeURIComponent(state.llm.key)).then(checkJson)
    }
    if (p === 'anthropic') {
      return fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': state.llm.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true', 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: state.llm.model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] })
      }).then(checkJson)
    }
    var VERIFY_BASE = {
      openai: 'https://api.openai.com/v1',
      deepseek: 'https://api.deepseek.com/v1',
      glm: 'https://open.bigmodel.cn/api/paas/v4',
      qwen: 'https://dashscope-international.aliyuncs.com/compatible-mode/v1',
      kimi: 'https://api.moonshot.cn/v1',
      openrouter: 'https://openrouter.ai/api/v1',
      siliconflow: 'https://api.siliconflow.com/v1'
    }
    var base = VERIFY_BASE[p] || 'https://api.openai.com/v1'
    return fetch(base + '/models', { headers: { Authorization: 'Bearer ' + state.llm.key } }).then(checkJson)
  }

  // ----- Gmail via Google Identity Services token client -----
  function connectGmail() {
    var clientId = $('gmClientId').value.trim()
    if (!clientId) { status('gmStatus', 'Enter your Google OAuth Client ID first.', 'err'); return }
    LS.set('ec_google_client_id', clientId); state.gm.clientId = clientId
    if (!window.google || !google.accounts || !google.accounts.oauth2) {
      status('gmStatus', 'Google library still loading — try again in a moment.', 'err'); return
    }
    status('gmStatus', 'Opening Google sign-in…', '')
    state.gm.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'https://www.googleapis.com/auth/gmail.readonly',
      callback: function (resp) {
        if (resp.error) { setDot('dot-gm', 'err'); status('gmStatus', '✗ ' + resp.error, 'err'); return }
        state.gm.token = resp.access_token
        fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { Authorization: 'Bearer ' + state.gm.token } })
          .then(checkJson).then(function (pr) {
            state.gm.email = pr.emailAddress; setDot('dot-gm', 'on'); status('gmStatus', '✓ Connected: ' + pr.emailAddress, 'ok')
          }).catch(function (e) { setDot('dot-gm', 'err'); status('gmStatus', '✗ ' + e.message, 'err') })
      }
    })
    state.gm.tokenClient.requestAccessToken()
  }

  // ----- restore saved connections on load -----
  function restore() {
    loadLlmFields()
    if (state.llm.key) status('llmStatus', 'Loaded saved key for ' + state.llm.provider + '.', '')

    state.gh.token = LS.get('ec_github_pat', '')
    if (state.gh.token) { $('ghToken').value = state.gh.token; setDot('dot-gh', 'on'); status('ghStatus', 'Saved token loaded (not re-verified).', '') }

    state.fc.key = LS.get('ec_firecrawl_key', '')
    if (state.fc.key) { $('fcKey').value = state.fc.key; setDot('dot-fc', 'on') }

    state.gm.clientId = LS.get('ec_google_client_id', '')
    if (state.gm.clientId) $('gmClientId').value = state.gm.clientId

    $('allowWrites').checked = state.allowWrites
    renderVault()
  }

  document.addEventListener('DOMContentLoaded', function () { initEvents(); restore() })
})()
