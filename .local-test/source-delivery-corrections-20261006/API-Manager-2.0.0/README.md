# API Manager v2.0.0

v2.0.0 is a major upgrade to the original v1.0.0 release. See [CHANGELOG.md](CHANGELOG.md) for added features, changes, fixes, and the original release history.

API Manager is an account-free desktop HTTP, REST, and SOAP client with familiar Postman-style collections, tabs, and editors. Collections, environments, globals, cookies, drafts, responses, and the latest 200 API runs stay on your computer. Your workspace resumes when the application reopens.

No API Manager login, cloud synchronization, or telemetry is required. Request authorization authenticates to **your API**. Network traffic consists of requests you explicitly send, including OAuth token requests. Editors, icons, and script libraries are bundled locally.

![API Manager desktop workspace](docs/screenshot.png)

## Contents

- [Installation](#installation)
- [Build from source](#build-from-source)
- [First request](#first-request)
- [Tabs and editors](#tabs-and-editors)
- [Parameters, headers, and bodies](#parameters-headers-and-bodies)
- [SOAP](#soap)
- [Collections and folders](#collections-and-folders)
- [Environments, globals, and dynamic variables](#environments-globals-and-dynamic-variables)
- [Authorization](#authorization)
- [Pre-request and post-response scripts](#pre-request-and-post-response-scripts)
- [Response tools](#response-tools)
- [History and console](#history-and-console)
- [Cookies](#cookies)
- [Import and export](#import-and-export)
- [Generate request code](#generate-request-code)
- [Settings and shortcuts](#settings-and-shortcuts)
- [About, release notes, and bug reports](#about-release-notes-and-bug-reports)
- [Storage and recovery](#storage-and-recovery)
- [Troubleshooting](#troubleshooting)
- [Compatibility and limits](#compatibility-and-limits)
- [Development and verification](#development-and-verification)

## Installation

Windows x64 is the packaged target. Use a supported Windows version compatible with the bundled Electron runtime. Installed users do not need Node.js or npm.

### Download, unzip, and start

1. Download **API-Manager-2.0.0.zip** and save it to a folder on your computer.
2. Right-click the ZIP in File Explorer and choose **Extract All**. Open the extracted folder; run the application from this folder rather than from inside the ZIP.
3. Open the extracted **release** folder. For a normal installation, double-click **API Manager Setup 2.0.0.exe**, follow the installer, and open **API Manager** from its shortcut.
4. To run without installation, double-click **release/API Manager 2.0.0.exe** instead. Use one version at a time.
5. Make your first request using the steps below. Closing and reopening restores your local workspace.

The ZIP contains the complete source project: `src/`, `electron/`, `shared/`, `build/`, `tests/`, configuration files, `package.json`, `package-lock.json`, the built assets in `dist/`, and both Windows executables in `release/`. It also includes this README, the license, a `CHECKSUMS.txt` file for the executables, detailed guides in `docs/`, and importable examples in `examples/`. See [the example guide](examples/README.md) to try the optional local demonstration server.

Node.js is needed only for that demonstration server or building from source, not for installing or running the packaged application. Dependencies for source development are installed with `npm ci` using the included lockfile. The ZIP excludes generated dependency/cache folders, test profiles, Git history, and hosted CI metadata. All application source, build configuration, and local tests are included.

### Windows installer

1. Find **API Manager Setup 2.0.0.exe** in the extracted ZIP's **release** folder.
2. Run the setup executable, choose the installation directory, and follow the prompts.
3. Start **API Manager** from its desktop or Start menu shortcut.
4. The first launch opens an untitled request tab, which you can close. No signup is needed.

Builds are unsigned unless the owner supplies signing credentials; Windows may show an unknown publisher. Obtain builds from this repository or build from source.

### Portable version

Run **API Manager 2.0.0.exe** when a portable build is provided. It needs no installer. Workspace data still uses the Windows application data folder, rather than a directory beside the executable. Transfer the workspace using a backup export/import.

### Upgrade and uninstall

Export a workspace backup and close API Manager v1.0.0 before installing v2.0.0. This upgrade keeps the application ID, local data folder, and workspace schema unchanged, so compatible existing workspaces are retained. Application binaries and workspace data are separate. To intentionally remove workspace data, locate it through **Settings → Local storage → Open data folder**, close the application, retain any needed backup, then remove that directory yourself.

## Build from source

Prerequisites: **Node.js 24 LTS**, npm, Windows x64, and internet access for dependency/runtime downloads.

After extracting the source ZIP, open a terminal in the folder containing `package.json` and this README. Git is optional; the ZIP already contains the source files.

Install dependencies and launch development:

```powershell
npm ci
node node_modules/electron/install.js
npm run dev
```

`dev` starts the local development server and desktop window together. Stop with **Ctrl+C** in the terminal. The explicit Electron installation handles npm setups that do not automatically permit dependency install scripts.

Launch a production build from source:

```powershell
npm run build
$env:API_MANAGER_PRODUCTION = '1'
npm start
```

Package binaries:

```powershell
npm run dist
npm run dist:portable
```

Outputs are in `release/`. `npm run dist:dir` creates an unpacked app for local checks. Installed application assets and editors work offline; reaching an API still requires access to that endpoint.

## First request

1. Click **New** or the plus beside the tabs in the workspace toolbar.
2. Choose an HTTP method and enter a complete `http://` or `https://` URL.
3. Add fields in **Params** and **Headers** as needed.
4. For JSON, select **Body → raw → JSON** and enter a document.
5. Select **Authorization** if the endpoint requires credentials.
6. Click **Send** or press **Ctrl+Enter**.
7. Inspect the response body, status, duration, size, headers, and cookies.
8. Click **Save** to store the request in a collection. Unsaved drafts also survive normal application closure.

Requests run in the native desktop process, so browser CORS restrictions do not prevent localhost/private API calls. The server must still be reachable and accept the request's authentication/TLS configuration.

## Tabs and editors

- Tabs sit in the workspace toolbar. Click one to activate it; the active tab is brought into view. Left/right arrows appear when tabs overflow and scroll the strip without switching the selected request. They use your selected accent and become paler at either end. Dividers separate the tab strip from workspace actions and Environment.
- With the pointer over the tab strip, use the mouse wheel to scroll it, or **Ctrl+mouse wheel** to switch to the previous/next tab. Tab switching stops at the first/last tab. While a tab has keyboard focus, **Left/Right**, **Home**, and **End** select and reveal tabs.
- Each tab retains its draft, response, selected request/response views, and response zoom. Requests in different tabs can run independently.
- **Duplicate tab** in the request menu creates a separate unsaved draft. **Duplicate request** in a collection row's menu immediately creates a saved copy beside the original in the same collection/folder, without opening a tab. Rename saved requests from their collection row menu.
- Use a tab's close button or **middle-click** the tab to close it, including the last tab. Closing a modified tab asks before discarding an unsaved draft. With every tab closed, the workspace offers **New request** and **Import cURL**, or you can open a saved API from Collections/History. An empty workspace stays empty after reopening. Closing the whole application preserves open drafts.
- Drag the sidebar divider to resize it and the request/response divider to change panel heights.
- Smaller windows automatically reserve space for the response body and clamp the console to fit. Your preferred request and console heights return when more space is available; scroll within a compact request panel to reach its fields and editor.
- **Description** stores notes; notes are not sent to the server.
- Monaco editors offer highlighting, folding, undo/redo, and **Ctrl+F** search. Retained cursor/scroll state is restored between sessions.
- **Beautify** formats valid JSON/XML. Invalid text reports an error and stays unchanged. JSON formatting preserves large integer text and duplicate keys.
- Request and response **Wrap lines** controls have independent saved preferences. Changing one leaves the other alone, and both resume after reopening. Wrapping is visual and does not modify payload bytes. Existing wrapping preferences are retained on upgrade.

## Parameters, headers, and bodies

### Field tables

Type in an empty row to add a key/value/description. The checkbox enables or disables the row; the delete button removes it. Disabled rows remain in drafts/exports but are not sent.

**Params** and the URL stay synchronized, including URLs imported from cURL or Postman collections and older saved drafts. Repeated keys, empty values, disabled rows, descriptions, and variable references are retained. Disabling/deleting a parameter changes the URL sent to the server. The URL field preserves imported spelling; editing a parameter keeps readable `@` characters while safely encoding query delimiters. The native request may encode `@` as `%40`; both represent the same value. Explicit disabled rows are excluded even if the imported raw URL contains that key.

**Headers** shows an expandable **Auto-generated headers** section above your editable custom headers. It starts collapsed: click its heading to expand it. Leaving Headers or switching request tabs resets it to collapsed, including after relaunch. Basic, Bearer, API Key (header), and OAuth 2 credentials show their current values, including inherited authorization and environment/global/collection/folder substitutions. Defaults include User-Agent, Accept-Encoding, and the applicable body Content-Type. Generated headers are read-only and do not create saved custom rows; replacement notes identify overridden custom headers. Query credentials are described as query parameters. Dynamic values, multipart boundaries, and signing/challenge authorization are generated on Send. Pre-request scripts, cookies, and transport framing can change headers; Console shows the actual sent request. Invalid names and values containing line breaks are rejected. Remove manually entered credential headers if changing auth should also remove them.

### Body modes

| Mode | Instructions |
| --- | --- |
| None | Send without a body. |
| Raw | Enter JSON, text, XML, HTML, or JavaScript. Select its language for highlighting/default content type. |
| URL-encoded | Add enabled key/value rows; the client generates form-encoded bytes. |
| Form data | Add text rows or select **File** and choose a local file. Multipart boundaries are generated automatically. |
| Binary | Choose one file as the entire body; add a content type if required. |

Raw variables are substituted literally. Supply JSON escaping yourself when a value needs it. Files must exist at their saved paths and each upload must be at most 100 MB. Exports retain file paths, not file contents.

## SOAP

1. Select SOAP in the request protocol control.
2. Choose **SOAP 1.1** or **SOAP 1.2**, enter the endpoint and SOAP action.
3. Edit the envelope in **Body**. An empty body receives an envelope; SOAP configures POST/XML.
4. Use **Beautify** and **Wrap lines** as needed.
5. Configure headers, variables, and authentication, then **Send**.

SOAP 1.1 uses `text/xml; charset=utf-8` and `SOAPAction`. SOAP 1.2 uses `application/soap+xml; charset=utf-8` with an action parameter. Switching versions updates headers and the envelope namespace. Existing nonempty XML stays editable; supply the service's operation/namespaces/schema. A SOAP fault may have an HTTP error status; its XML remains inspectable.

WSDL discovery, generated operation forms, schema validation against a service, and automatic WS-Security are not included. This release sends SOAP envelopes over HTTP(S).

## Collections and folders

1. Open **Collections** and create a named collection using the add/menu control.
2. Use its **…** menu for rename, settings, export, requests/folders, and deletion.
3. Add nested folders to organize operations.
4. **Save** a request; choose its name, collection, and folder. The dialog can create a collection.
5. Reopen requests from the tree. Editing keeps a draft; **Save** updates the collection entry. After saving an imported cURL for the first time, subsequent **Save** clicks update that same entry. **Save as…** deliberately creates another saved request.
6. A saved request's menu supports rename, move, duplicate, and delete. Moving changes its inherited context.
7. Use sidebar search to filter requests.

Collection/folder settings contain variables, auth, and pre-request/post-response scripts. Collection settings also have a description. Deletion is confirmed; open requests remain drafts. Export preserves hierarchy and order.

## Environments, globals, and dynamic variables

### Saved variables

1. Open **Environments**; select **Globals**, or create/select an environment.
2. Add a name, value, and optional description. Enable the row. Changes save automatically; **Save** writes the current values to local storage immediately.
3. Activate an environment using the top selector or **Set active**.
4. Use `{{name}}` in URL/params/headers/auth/body.

Example: `base_url = http://localhost:3000`, `token = your-token`; request `{{base_url}}/users` with Bearer token `{{token}}`.

Precedence, low to high: **globals → collection → ancestor folders → closest folder → active environment → script-local values**. Disabled rows are ignored. Names are case-sensitive. Nested references are supported; missing/circular references or more than 30 nested levels produce an error before sending. Select **Global** in the toolbar to use global/collection/folder values without environment overrides. Global variables remain available when a named environment is active; matching environment values take precedence.

Environments support rename, activation, export, and confirmed deletion using the **Delete** text button. Globals are workspace-wide; environment values override them.

The **Edit active environment** button beside the toolbar's environment selector opens **Environment values** without leaving your request. Edit variable names/values or enable/disable rows. Start typing a name or value in the blank last row to create a checked variable automatically; a fresh blank row appears while your typing focus is preserved. Use the trash icon at the end of a populated row to delete that variable. Editing a disabled variable keeps it disabled until you enable it. Click **Save** or press **Ctrl+S** anywhere in this popup to apply changes; the next request uses them. Empty rows are skipped, and a value without a name asks you to enter a name. **Cancel**, Escape, or closing the popup discards its pending edits. With **Global** selected, the popup edits Globals. You can also add or remove rows in the full Environments editor. Selecting an environment in the sidebar opens its editor; select it in the toolbar or use **Set active** to use it when sending. Globals also has **Set active** when a named environment is active. Activating Globals clears environment overrides, retains their saved values, and restores Global selection on relaunch.

Variable references are colored in URL, field tables, authorization inputs, and supported raw-body editors. Resolved references use the chosen accent; missing/circular references use the error color; dynamic references have a dotted underline. Hover a reference to inspect its current value, source scope, and active environment. Hovering dynamic references describes generation on Send and does not generate a random value or contact a server. JavaScript editors retain their normal syntax highlighting; use the documented script variable APIs there.

### Dynamic variables

Use the standard braces and dollar sign:

```text
{{$timestamp}}       Unix timestamp in seconds
{{$isoTimestamp}}    ISO date/time
{{$guid}}            UUID
{{$randomInt}}       Integer from 0 to 1000
```

No saved row is required. A saved value with the same name overrides the built-in. Values are stable within one run across repeated references and script/request stages; later runs generate new values. See [every supported dynamic variable](docs/dynamic-variables.md) for names/categories/examples. The correct spelling is `{{$timestamp}}`; `(($timestamp}}` is not variable syntax.

## Authorization

Open **Authorization**, select a type, and enter your server's fields. Credential values support variables. **Inherit auth from parent** uses the nearest explicit folder auth, then collection auth. **No Auth** generates no credentials; arbitrary manually entered headers remain your responsibility.

| Type | Required/typical configuration |
| --- | --- |
| Basic | Username/password; generated Basic header. |
| Bearer Token | Token; generated Bearer header. |
| API Key | Name/value and header/query location. |
| Digest | Username/password; optional Digest fields; bounded retry using the server's 401 challenge. MD5, SHA-256, and SHA-512-256 variants. |
| OAuth 1.0 | Consumer key/secret, access token/token secret, signature method, optional nonce/timestamp/realm. HMAC-SHA1, HMAC-SHA256, RSA-SHA1, RSA-SHA256, PLAINTEXT. |
| OAuth 2.0 | Existing access token or grant/token-endpoint/client configuration and **Get token**. |
| Hawk | Credential ID/key/algorithm and optional Hawk fields. |
| AWS Signature | Access/secret key, region/service, optional session token; AWS Signature Version 4. |
| NTLM | Username/password/domain/workstation; NTLMv2 challenge over one connection. |
| Akamai EdgeGrid | Client/access token, client secret, optional timestamp/nonce. |
| JWT Bearer | JSON payload/header, algorithm, secret or private key, prefix/header/query settings. |
| ASAP | Private key, key ID, issuer/audience, optional subject/lifetime; RS256 assertion. |

JWT algorithms: **HS256/384/512, RS256/384/512, ES256/384/512, PS256/384/512**. HMAC needs a shared secret. Other algorithms need a matching PEM private key and any applicable passphrase. Header/payload must be JSON objects.

### OAuth 2 token acquisition

1. Select a grant and supply the HTTP(S) token endpoint, client ID, applicable secret and scope.
2. Select client authentication in Basic header or form body.
3. **Client credentials:** no user code needed.
4. **Authorization code:** obtain the code through your provider's consent flow, then supply code/redirect URI and PKCE verifier if required. API Manager exchanges the supplied code; it does not launch/capture consent.
5. **Refresh token:** enter a refresh token. **Password:** enter user credentials only for providers supporting that grant.
6. Click **Get token**; successful token values populate the form.
7. Choose token placement and send. Refresh is explicit; there is no background auto-refresh.

Tracked credentials are stripped on cross-origin redirects. Eligible signatures are regenerated for redirects. NTLMv1, mandatory NTLM MIC/channel binding, SPNEGO/Kerberos, client certificates, and interactive OAuth capture are not included. Body-dependent signing (AWS/EdgeGrid, OAuth 1 body hashes, Hawk payload hashes, or Digest auth-int) rejects multipart when exact body bytes are unavailable rather than sending an invalid signature.

## Pre-request and post-response scripts

Write JavaScript in **Pre-request** and **Post-response** tabs. Collection/folder scripts apply to descendants. Each stage runs **collection → ancestor folders → closest folder → request**.

Pre-request runs before sending and can change variables/outgoing request data. Post-response checks the returned response or saves values for later requests. Environment/global/collection mutations persist; script-local values last for the run. Runtime request changes do not overwrite the saved draft.

Pre-request example:

```javascript
pm.environment.set('request_id', pm.variables.replaceIn('{{$guid}}'));
pm.request.headers.upsert({ key: 'X-Request-ID', value: '{{request_id}}' });
console.log('Preparing', pm.info.requestName);
```

Post-response example:

```javascript
pm.test('Status is 200', () => pm.response.to.have.status(200));
pm.test('Response has an identifier', () => {
  const body = pm.response.json();
  pm.expect(body).to.have.property('id');
  pm.environment.set('last_id', String(body.id));
});
console.log('Received', pm.response.code, pm.response.responseTime);
```

Inspect test results in the response panel and logs in Console. Assertion failures are recorded. A pre-request runtime error stops sending; post-response errors retain the response. Cancel stops the active stage. Every script program has a **three-second deadline**, including asynchronous work. Source is capped at 1 MB, a returned result at 32 MB, and captured tests/logs/timers at 1,000; the displayed combined run retains up to 1,000 tests and logs.

Supported APIs:

- `pm.environment`, `pm.globals`, `pm.collectionVariables`, `pm.variables`: `get`, `set`, `has`, `unset`, `clear`, `toObject`, `replaceIn`.
- `pm.request` URL, headers and body; `pm.response.code`, `status`, `responseTime`, `headers`, `text()`, `json()` and common response assertions.
- `pm.test`, async/done tests, and `pm.expect` with bundled Chai.
- `console.log/info/warn/error/debug`, bounded timers, `pm.info`, and basic legacy `postman` variable helpers.

Scripts run separately without Node/files/DOM/application IPC/direct networking. `pm.sendRequest`, collection-runner control, external packages/`require`, and full Postman Sandbox SDK compatibility are not supported. Importing alone never executes scripts; sending an imported request executes its retained supported scripts.

## Response tools

| Control | Behavior |
| --- | --- |
| Pretty | Formatted valid JSON/XML view. |
| Raw | Original decoded text. |
| Search / Ctrl+F | Highlight matching response text and show the current/total match count. Enter moves to the next match, Shift+Enter moves to the previous match, and navigation wraps around. Search from Preview opens the raw body. |
| Preview | Supported preview; HTML scripts/external resources are isolated/blocked. |
| Headers | Returned header rows, including repeated values, plus copy action. |
| Cookies | Locally stored cookie jar. |
| Test results | Script assertions, failures, and runtime errors. |
| Beautify | Format for display; stored raw response stays intact. |
| Wrap lines | Visual response wrapping without changing text; saved independently of request wrapping. |
| Zoom + / − | Response font size 10–32 px; click percentage to reset to 14 px/100%. |
| Copy body | Raw body text. |
| Copy body with headers | Status line, header lines, blank line, raw body. |
| Save body (.json) | Valid JSON document; non-JSON body becomes a JSON string. |
| Save body with headers (.json) | JSON envelope with `status`, `statusText`, `url`, `headers`, `body`. |

To search a response, click the magnifying-glass **Search** button and type in the **Find** box. Matches are highlighted and the counter shows your position, for example **1 of 3**. Keep the Find box focused and press **Enter** for the next match or **Shift+Enter** for the previous match; both wrap around. **Escape** closes Find. You can also focus the response editor and press **Ctrl+F**. A search with no matches shows **No results**.

Status/duration/observed decoded body size appear above the response. A truncated response does not report the unknown full body size. Truncated and binary responses are marked. Binary is base64 text; JSON downloads retain base64. JSON formatting/download avoids rounding original large integers. Copy/save never resends a request. A truncated run remains truncated until you increase the limit and resend.

## History and console

### History

Open **History**. The latest **200 API runs** are retained newest first with request snapshot, timestamp, saved response/error, and script results. Restarting preserves history; exceeding the cap removes the oldest entry.

Click a run to inspect its request/response without contacting the server. Use the main **Send** button to send the opened request, or the send icon beside a History entry to replay it directly. Sending creates a new run. Replay uses the current active environment, current inherited configuration, and files at current paths. Credentials, files, and API state may have changed since the original call.

Search filters by name/URL. **Clear history** requires confirmation; collections/open tabs remain. Assertion failures are separate from HTTP failures.

### Console

Use **Console** in the left sidebar, between **Environments** and **History**, to toggle its dock. It shows request activity, responses/errors, timing, and script logs, with the most recent runs at the top and older runs below. Messages within each run also appear newest first. Display ordering does not change the retained history or script results. Filter entries, expand a run for details, or use its replay action. **Clear console** clears its display without deleting history. Details can include credential/payload values.

Expand a run to see **Request cURL** and copy the command actually captured during sending, after pre-request scripts, variable substitution, authorization, cookies, and native headers. The final attempt is shown after redirects or authorization challenges. The saved command stays tied to that run across edits and relaunches; viewing it never regenerates tokens, signatures, or random values. A failed connection can still retain the attempted command. Old history created before this update has no native capture and says so. Small binary/multipart bodies up to 2 MB embed captured bytes; larger uploads use local file references and display a replay limitation. Commands above the capture size limit are omitted with an explicit note. Replaying a command with captured credentials uses those original credentials.

Each new run replaces the response editor content, including HTTP 401/403/404 and empty bodies. A connection failure clears the previous body and records the error instead of reusing an earlier response.

Drag the console's upper divider upward to increase its height or downward to reduce it. The divider is also keyboard accessible: focus **Resize console** with Tab, use **Arrow Up/Down** to change height, **Shift+Arrow Up/Down** for a larger step, or **Home/End** for the smallest/largest available height. The preferred height survives closing the console and relaunching the application. Smaller windows temporarily clamp it so the request/response workspace stays usable.

## Cookies

`Set-Cookie` responses update a native local jar. Matching cookies are sent according to domain/path/secure/expiry rules. An explicit Cookie header can override generated cookies.

Use the **Cookies** response tab or **Cookie manager** action to inspect names/values/domains/paths/flags/expiration and clear cookie data. Cookies persist separately from workspace/collection JSON exports.

## Import and export

### Import

Click **Import**, choose JSON files or paste JSON/cURL, then **Import text** for pasted content. Review warnings. Collections/environments are added to the workspace. Full workspace restore requires confirmation because it replaces the workspace.

Supported formats:

- **Postman Collection v2.0/v2.1 JSON:** nested order/hierarchy, descriptions, disabled fields, variables, scripts, supported auth, preserved extras.
- **Postman environment/globals JSON:** names/values/descriptions/enabled state/extras.
- **API Manager workspace JSON:** complete workspace/session backup.
- **cURL:** common quoting, methods, headers, raw bodies, Basic auth, URL-encoded and multipart fields/files. Parsed as data; never executed by a shell.

Unsupported cURL flags fail explicitly. Unsupported Postman metadata is preserved where possible with warnings, rather than silently pretending to support it. File paths from other computers need correction.

### Export

| Action | Output |
| --- | --- |
| Collection **… → Export** | Postman v2.1 collection JSON, with hierarchy/scripts. |
| Environment **Export** | Postman-compatible environment JSON. |
| Globals **Export** | Postman-compatible globals JSON. |
| Workspace **Export workspace backup** / Settings **Export backup** | API Manager JSON including drafts/tabs/responses/history/settings. |
| Workspace **Copy request as cURL** icon below Send | Quoted preview command with current variables resolved. |
| Request **Generate code…** | Preview and copy cURL, Python, Java, JavaScript, C, or C++ request code. |

Native Save dialogs choose filename/destination. Cancelling writes nothing. cURL export reports unsupported advanced auth/signing instead of producing an incorrect command, and does not run scripts. Backups do not bundle attachments, cookies, native window geometry, or separate local appearance/layout/editor preferences such as accent colour and console height.

## Generate request code

1. Prepare a request, including its method, URL, parameters, headers, authorization, and body. Select the intended environment first.
2. Open the request's **…** menu beside **Save** and select **Generate code…**.
3. Choose **cURL**, **Python**, **Java**, **JavaScript**, **C**, or **C++** from **Code language**. Review the dependency/run notes and any compatibility warnings.
4. Click **Copy code**, paste into a file using the suggested name, and run it with the indicated runtime/compiler. **Done** closes the preview. Selecting or copying code never sends the request or modifies its draft.

The generator resolves current scoped variables and inherited authorization, includes enabled query parameters and headers, and supports raw/JSON/XML/SOAP, URL-encoded, multipart, and binary bodies. File uploads retain local paths; those files must exist on the machine running the snippet. Dynamic variables are sampled when generating a snippet, so review time-sensitive values before running it later. Generated code can contain resolved credentials and payload values.

Python uses its standard library, Java uses Java 11+ `HttpClient`, JavaScript uses Node.js 22+ `fetch`, and C/C++ use libcurl. The generated file includes run/build instructions. cURL still uses the existing exporter; the **Copy request as cURL** icon below Send remains available for one-click preview copying. Console's saved **Request cURL** reflects the actual run, including script/native changes.

Snippets represent a standalone request. They do not execute API Manager pre-request/post-response scripts or copy its cookie jar and transport settings. Runtime signatures, token acquisition, and challenge authentication depend on the selected language; the preview identifies unsupported authorization cases explicitly so you can adapt the snippet using the appropriate client library.

Unsupported signing/challenge examples stop before making a network request. C/C++ libcurl examples can negotiate Digest/NTLM when the installed libcurl supports them. JavaScript Fetch does not permit a GET/HEAD body and combines repeated header names; choose another client when those behaviours matter. Java HttpClient manages certain restricted headers. Generated clients calculate their own body framing and multipart boundaries; the preview explains relevant differences.

## Settings and shortcuts

Open **Settings** at the bottom of the left sidebar or the request **Settings** tab. Request settings apply to the workspace. **About and Help** sits immediately above Settings in the left sidebar.

| Setting | Effect/default |
| --- | --- |
| Timeout | HTTP milliseconds, default 30,000; 0 disables HTTP timeout. Script timeout is separate. |
| Follow redirects | Bounded redirects with tracked credential protection. |
| SSL verification | HTTPS certificate verification, enabled by default. |
| Response size | Decoded body limit, default 20 MB; larger responses are marked truncated. |
| Theme | Dark, Grey, or Light, persisted. Grey uses medium neutral backgrounds and matching code editors, darker than Light while remaining lighter than Dark. |
| Accent color | Blue (default), red, orange, green, or purple; saved locally. Changes accent controls while retaining the selected background theme and status/syntax colours. |
| Open data folder / Export backup | Find data or save backup. |

| Shortcut | Action |
| --- | --- |
| Ctrl/Cmd+N | New request. |
| Ctrl+mouse wheel | Previous/next request tab while the pointer is over the tab strip; stops at either end. |
| Middle-click tab | Close that tab; asks before discarding an unsaved draft. |
| Left / Right / Home / End | Select and reveal a tab while a request tab has keyboard focus. |
| Ctrl/Cmd+S | Save request/open Save dialog; save environment/global variables while their popup is open. |
| Ctrl/Cmd+Enter | Send active request. |
| Ctrl/Cmd+F | Find inside focused editor. |
| Arrow Up/Down; Shift+Arrow Up/Down; Home/End | Resize the Console while its upper divider is focused; Shift uses a larger step, Home/End select the available minimum/maximum. |
| Enter / Shift+Enter | Next/previous match while the editor's search box is focused; wraps at the first/last match. |
| Ctrl+H | Find and replace inside an editable code editor on Windows. |
| Ctrl+Z / Ctrl+Y | Editor undo/redo on Windows. |
| Escape | Close dialog/menu. |
| Tab / Shift+Tab | Move between controls; focus stays inside an open dialog. |

Request Send/Save shortcuts do not run while a blocking dialog is open. The environment popup handles **Ctrl/Cmd+S** to save its own values.

## About, release notes, and bug reports

Click **About and Help** in the left sidebar, above **Settings**, to open it. **About** contains developer details (**Developed by Manish Kumar Singh**, **manishkumars264@gmail.com**) and keyboard shortcuts. **Version history** combines both releases and their notes on one page: **v2.0.0 Major upgrade** starts expanded and **v1.0.0 Initial release** starts collapsed. Expanding one collapses the other; click an expanded heading to collapse it. Inside either expanded version, **View release notes** displays its notes in that same section, and **Hide release notes** hides them. The full release changes are also in [CHANGELOG.md](CHANGELOG.md).

Choose **Report bugs** to open a draft in the default email application, such as Outlook. The recipient is **manishkumars264@gmail.com**, and the subject identifies an issue in API Manager v2.0.0. The body includes a summary/description, numbered reproduction steps, expected and actual results, and a place to describe or attach screenshots/videos. Fill in the details and attach files in the email application. Opening the draft does not send it automatically.

If no default email application is configured, API Manager shows an error with the contact address. Configure the Windows default mail application or draft the report manually.

## Storage and recovery

Normally `%APPDATA%/API Manager/`. Settings displays the actual path.

| Data | Contents |
| --- | --- |
| `workspace.json` | Collections/environments/globals/drafts/responses/history/settings. |
| `cookies.json` | Native cookie jar. |
| `window-state.json` | Native bounds/maximized state. |
| Validated `.backup` files | Previous valid versions for recovery. |
| Chromium local profile | Editor view state, tree expansion, panel sizes, wrapping/display preferences. |

Saves are serialized/validated/atomic. Check the bottom save status. Normal close requests a final save; failures offer retry, keep working, or explicit close without saving. Corrupt files are retained and validated backup recovery reports a warning. Off-screen windows are brought onto an available display.

Open tabs/drafts/responses/views/zoom/theme and retained editor state resume. In-flight operations stop; reopening never automatically resends them. A normal profile supports one running instance.

Export backups regularly and before restoration/upgrades. Transfer attachments separately. Copy corresponding profile files if cookies/exact display state are needed. Local files and exports contain entered tokens/passwords/signing keys and response bodies in plain data. No encrypted credential vault is included.

## Troubleshooting

| Problem | Check |
| --- | --- |
| Invalid URL | Include HTTP(S) and valid host/port. |
| Missing variable | Spelling/case, selected environment, enabled state, `{{name}}` syntax. |
| Circular variable | Remove the reference chain shown in the error. |
| Connection/DNS error | Endpoint running, address/port correct, network reachable. |
| TLS error | Certificate trust/hostname/expiry; check workspace SSL setting for your test endpoint. |
| 401/403 | Auth fields, token expiry, scopes/audience/region/service, clock requirements. Inspect response body. |
| Expired OAuth | Explicitly acquire/refresh token and resend. |
| Beautify failure | Fix malformed JSON/XML; formatting is not syntax repair. |
| Missing upload | Choose existing file; exports do not include file bytes. |
| Truncated body | Increase response limit as appropriate and resend. |
| Script timeout | Remove loops/long timers; three seconds per program. |
| Unsupported script API | Use the documented subset; full Sandbox SDK is not implemented. |
| Save failure | Disk space/access/workspace size; export if possible and retry before closing. |
| Recovery warning | Retain corrupt files, inspect backups, restore a known good export if needed. |
| Preview differs | Preview blocks scripts and external resources. |
| Source startup | Use Node 24, `npm ci`, install Electron, and build. |
| PowerShell blocks `npm.ps1` | Run `npm.cmd` instead of `npm`, for example `npm.cmd ci`. |
| Browser preview cannot send | Launch Electron; native requests/files/OAuth/scripts need the desktop bridge. |

## Compatibility and limits

This release is a substantial local REST/SOAP workspace. Complete parity with every Postman product feature is not claimed.

Not included: cloud collaboration, monitors, collection/data runners, scheduling, GraphQL schema tooling, WebSocket/gRPC/MQTT clients, mocking, OpenAPI/WSDL discovery, Postman v3 YAML import, proxy/mTLS configuration, full cookie editing, interactive OAuth capture, or full Postman Sandbox SDK. Raw payload sending does not imply protocol-specific tooling.

Limits include **200 history runs**, **100 MB per upload**, **256 MB serialized workspace**, configured response truncation, **three seconds per script program**, and bounded input sizes. Oversized workspaces fail saving explicitly rather than overwriting valid stored data; reduce retained history/open responses or export/remove unneeded data. Large responses consume memory/disk.

No software can guarantee zero bugs. Report reproducible issues with version, steps, and sanitized examples. Observed checks are recorded in [docs/verification.md](docs/verification.md).

## Development and verification

The code-generation runtime tests also need **Python 3.10+** on PATH (`python` on Windows, `python3` elsewhere). To use another installation, set `API_MANAGER_TEST_PYTHON` to its executable path before running the tests. Installing or launching API Manager itself needs no Python.

```powershell
npm run check
npm run test:e2e
npm run dist
```

`check`: TypeScript/build, formats/variables, accents/console sizing, generated Python/JavaScript requests, and native request/auth/storage/scripts. `test:e2e`: real Electron against local HTTP fixtures, UI workflows and relaunch recovery. These checks are included in the source project and can be repeated locally.

| Environment variable | Purpose |
| --- | --- |
| `API_MANAGER_DATA_DIR` | Absolute isolated data directory for tests/development. |
| `API_MANAGER_PRODUCTION=1` | Built `dist/` assets rather than dev server. |
| `API_MANAGER_TEST_MODE=1` | Hidden native window for automated tests. |
| `API_MANAGER_TEST_PYTHON` | Optional Python executable override for generated-request runtime tests. |

Architecture: React/TypeScript/Monaco in a sandboxed renderer; context-isolated native bridge; Undici HTTP, tough-cookie, Node cryptography/protocol signing libraries, isolated script worker with Chai, explicit Faker dynamic mapping. Remote HTML has no application bridge access. Unit-test VM harnesses are not the production scripting mechanism.

References: [Postman import](https://learning.postman.com/docs/getting-started/importing-and-exporting/importing-data/), [export](https://learning.postman.com/docs/getting-started/importing-and-exporting/exporting-data/), [authorization](https://learning.postman.com/docs/use/send-requests/authorization/authorization-types/), [Electron security](https://www.electronjs.org/docs/latest/tutorial/security/). [MIT license](LICENSE).
