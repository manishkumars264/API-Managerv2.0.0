# Verification report

Date: 2026-10-03. Target: Windows x64. Runtime: Electron 44.5.1, Node.js 24 build tooling. Tests use isolated local profiles and loopback HTTP fixtures, not a user's existing workspace or remote production API.

## Observed checks

The release build passed TypeScript checks, production bundling, 239 Vitest tests, 57 native tests, and all 16 desktop scenarios against the final packaged executable: 312 unique automated checks in total. Fifteen desktop scenarios passed in the complete run; the code-generation scenario passed in a separate isolated rerun after one native clipboard assertion returned an empty value in the complete run. That assertion's cause was not established; the isolated rerun verified all six clipboard copies, invalid-URL error handling, recovery, and saved language selection. Hidden-window tests disable background timer throttling so autosave and editor layout checks use active renderer timers. Help uses functional and layout assertions without optional documentation screenshot capture. There were no remaining functional failures in the final checks.

| Check | Observed result | Coverage |
| --- | --- | --- |
| TypeScript and production build | Passed | Interfaces and locally bundled application/editor assets. |
| Format, variable, script-scope, appearance, console-height, and code-generation tests | 239 passed | Postman collection/environment/globals/native backup/cURL round trips, scopes, all explicit dynamic mappings, large-number JSON preservation, SOAP formatting, inherited script ordering, contrast-tested accent palettes, saved console height bounds, and generated request programs. |
| Native engine/auth/storage/script/mail-draft tests | 57 passed | Real HTTP bodies/uploads/headers, cookies, gzip, TLS, redirects, cancellation/timeouts/limits, auth signing/challenge behavior, validated storage recovery, actual isolated Electron script workers, encoded email drafts, and friendly mail-association errors. |
| Packaged desktop end-to-end tests | All 16 scenarios passed across a complete run and one focused repeat | Collection/environment import, sending, clipboard/download dialogs, tabs/session restoration, overflow arrows and mouse navigation/closing, independent wrapping, variable resolution, backup replacement, errors/cancellation, safe preview, scripts, console/history replay, SOAP, auth forms, the Cancel click completion race, minimum-window/console sizing with resize and relaunch, Help, response Search, tooltip placement/cleanup, all accent choices in both themes, persistent console resizing, and all six code-generation options with preview/copy/error recovery. |
| Production dependency audit | 0 reported vulnerabilities | Application dependency tree checked with `npm audit --omit=dev`. |
| Full dependency audit | 8 high-severity findings | Development/build dependency chain through `@electron/get`, `app-builder-lib`, and `electron-builder`; the findings trace to the `http-cache-semantics` advisory described below. |
| Windows packaging | Passed | Windows x64 NSIS installer and portable executable, with locally bundled runtime assets. |

## Release artifacts

The following unsigned binaries were generated locally from this release build and are included in the source ZIP's `release/` folder. The ZIP also includes its own `CHECKSUMS.txt` file.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `API Manager Setup 1.0.0.exe` | 132949191 | `C6523CDC94ED16C9DFC8CB6F3C258ED308E478585351D7F4FB88AA32697E14DE` |
| `API Manager 1.0.0.exe` | 132731824 | `55F177BE5581752AF0F00AB33759882E3359AF56AB31B7EC236954379744D57C` |

Dependency versions and the lockfile are unchanged by this console/appearance/code-generation update. The dependency audit results above were recorded earlier on 2026-10-03 and are retained for this unchanged dependency tree.

## Coverage details

- Native request fixtures exercise body modes, duplicate headers/query parameters, variable substitution, redirects with credential stripping, file bounds, cookies, decompression, invalid inputs, cancellation, timeouts, and response truncation.
- Auth checks include published Digest/OAuth1/AWS/JWT vectors and independent Hawk/EdgeGrid/asymmetric JWT verification. Digest and NTLM are also exercised through a real loopback handshake; NTLM retains one connection for its challenge exchange. OAuth2 grants use a local token endpoint.
- Scripts run through the production Electron sandbox in addition to pure test harnesses. Checks cover no Node/DOM/bridge access, denied network requests, three-second infinite-loop termination, cancellation, worker/window cleanup, Chai assertions, scoped mutations, and dynamic value consistency across pre-request/send/post-response.
- Storage checks cover queued atomic writes, validated backups, corrupt-file retention/recovery, missing-primary recovery, close acknowledgments, input bounds, and off-screen window recovery.
- Desktop tests interact with the built application, native clipboard, and stubbed native file dialog choices. They close the native window normally and relaunch the same isolated profile to verify session continuity.
- Tab checks verify placement in the workspace toolbar, overflowing tab arrows without overlap, scrolling without changing selection, adjacent Ctrl+wheel switching that stops at the ends and does not zoom the application, keyboard End navigation, active-tab visibility, and middle-click closing. A dirty-tab cancellation retains the draft; confirmation closes it. Clean tabs close without a dialog.
- Wrapping checks use actual rendered line counts, independent request/response toggles, migration from the earlier shared preference, and normal-close/relaunch persistence. Raw payload bytes stay unchanged. URLs, query values, headers, authorization, and bodies still resolve saved variables after the inline variable announcements are removed.
- History checks inspect saved responses without sending, then exercise the main Send button and the retained send icon beside a History entry. Replay adds a run while retaining the 200-run cap; the former separate replay banner is absent.
- Console checks verify its sidebar position between Environments and History, removal of the earlier bottom shortcut, pointer dragging in both directions, keyboard Arrow/Home/End sizing, closing/reopening, normal relaunch, and viewport clamping that preserves the saved preferred height. Response content remains visible in smaller windows.
- Appearance checks exercise blue (default), red, orange, green, and purple in both dark/light modes while sending real requests, retaining payloads/URLs, rendering responses, and restoring saved choices. Palette checks preserve semantic colours and verify button/hover and accent-text contrast.
- Code-generation checks cover all six previews and native clipboard copies, scoped values and inherited Bearer authorization, disabled rows, no request/draft mutation or network activity during generation, invalid-URL errors, recovery, and remembered language. Windows clipboard line-ending normalization is accounted for.
- Seventeen generator tests execute sixteen successful standalone Python/Node requests against a loopback server, including repeated parameters/headers, Basic/Bearer authentication, empty-header native defaults, raw UTF-8/NUL bodies, SOAP 1.2, URL-encoded duplicates, binary files, multipart metadata, and stable dynamic values. A blocked Fetch GET-body example sends nothing. Java/C/C++ escaping, byte lengths, large Java literal chunks, and compatibility guards are checked by source assertions/review; those languages were not compiled or run because the required toolchains are unavailable.
- Compact-window coverage uses the minimum 1000 by 650 native window size, checks visible response content and console space, grows/shrinks the window, and confirms the preferred split and usable response layout survive reopening.
- Help coverage checks developer details, keyboard shortcuts, release notes, version history, and suppression of request shortcuts while the dialog is open. The dialog footer remains visible at 1000 by 650, 1024 by 768, 1420 by 820, and 1420 by 900 window sizes.
- Bug-report checks verify a fixed-recipient `mailto:` URL with an encoded subject and template, including CRLF reproduction steps and attachment prompts, plus a friendly error when no email association is available. Native `shell.openExternal` is stubbed in these checks; they do not prove that an actual email application opened.
- Response Search checks visible match highlighting and counts, Enter and Shift+Enter navigation that cycles through results, no-result handling, Escape dismissal, and switching from Preview to Raw when Search is opened. Searching does not send another request or create another history entry.
- Tooltip checks place all six response toolbar hints below their controls, within the horizontal viewport, without intercepting pointer input. A toolbar hint is also checked below an open Find widget. Native Match Case and Next Match hints remain below Find. Escape clears the response-specific native tooltip markers and context styling.
- The five bundled examples were imported and exercised through the native transport against `examples/mock-server.mjs`: GET echo with repeated query values, JSON with consistent dynamic UUIDs, SOAP 1.2, token retrieval, and a protected Bearer request all returned HTTP 200. Missing credentials correctly returned HTTP 401; native OAuth token acquisition also succeeded.
- The actual portable executable was launched separately in an isolated profile. JSON and SOAP 1.2 requests returned HTTP 200 and both responses were persisted. This smoke check also verified JSON display, the Help popup with developer details, response Search highlighting with a `1 of 1` match count, a persisted red accent selection, keyboard console resizing, and the six-option code-generation selector with a Python preview. SOAP transport and persistence were checked in the hidden portable window; SOAP editor rendering is covered by the packaged desktop suite.

## Practical limits

Passing tests demonstrate the listed scenarios, not an absence of all defects or complete Postman parity. External API servers, enterprise authentication policies, proxy networks, and every possible imported collection cannot be exhaustively tested here. Native Windows installer user interaction and reputation/signing behavior depend on the machine and signing credentials.

The full development dependency audit reports eight high-severity findings associated with [GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp), which concerns `http-cache-semantics` shared-cache handling of `max-stale` directives. The reviewed advisory lists no patched version as of 2026-10-03. The production-only dependency audit reports zero vulnerabilities. Build-tool dependencies remain unchanged; the suggested forced audit fix would change the packaging toolchain and requires separate verification.

The current compatibility exclusions are listed in [README.md](../README.md#compatibility-and-limits). Scripts implement the documented subset of Postman's APIs, not its whole SDK. NTLM requires NTLMv2 and does not support mandatory MIC/channel binding. OAuth consent/code capture is manual. SOAP covers HTTP envelope sending rather than WSDL-generated operations. Image dynamic variables use documented placeholder-provider fallbacks.

Responses/history and credentials are retained locally as plain data. Size caps and truncation are explicit. Packaging bundles the editor/workers/script library/shared variable mapping; installed runtime assets do not depend on a CDN.

## Reproduce

The generated-Python runtime tests need Python 3.10+ on PATH, or an `API_MANAGER_TEST_PYTHON` executable override. Application installation and use require no Python.

```powershell
npm ci
node node_modules/electron/install.js
npm run check
npm run test:e2e
npm run dist -- --publish never
npm run dist:portable -- --publish never
```

To run selected tests against an unpacked packaged executable:

```powershell
$env:API_MANAGER_EXECUTABLE = (Resolve-Path 'release/win-unpacked/API Manager.exe').Path
npx playwright test
```

Test artifacts live in ignored `.local-test/` and `test-results/` directories. Runtime data for normal application use is separate.
