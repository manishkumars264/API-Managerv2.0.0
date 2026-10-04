# Verification report

Date: 2026-10-02. Target: Windows x64. Runtime: Electron 44.5.1, Node.js 24 build tooling. Tests use isolated local profiles and loopback HTTP fixtures, not a user's existing workspace or remote production API.

## Observed checks

The release build passed TypeScript checks, production bundling, 196 Vitest tests, 55 native engine tests, and all 9 desktop scenarios against the final packaged executable in the final full run. Hidden-window tests disable background timer throttling so autosave and editor layout checks use active renderer timers. There were no remaining failures in the final test suite.

| Check | Observed result | Coverage |
| --- | --- | --- |
| TypeScript and production build | Passed | Interfaces and locally bundled application/editor assets. |
| Format, variable, and script-scope tests | 196 passed | Postman collection/environment/globals/native backup/cURL round trips, scopes, all explicit dynamic mappings, large-number JSON preservation, SOAP formatting, and inherited script ordering. |
| Native engine/auth/storage/script tests | 55 passed | Real HTTP bodies/uploads/headers, cookies, gzip, TLS, redirects, cancellation/timeouts/limits, auth signing/challenge behavior, validated storage recovery, and actual isolated Electron script workers. |
| Packaged desktop end-to-end tests | 9 scenarios passed | Collection/environment import, sending, clipboard/download dialogs, tabs/session restoration, backup replacement, errors/cancellation, safe preview, scripts, console/history replay, SOAP, auth forms, the Cancel click completion race, and minimum-window/console sizing with resize and relaunch. |
| Dependency audit | 0 known vulnerabilities | Installed dependency tree checked with `npm audit --audit-level moderate`. |
| Windows packaging | Passed | Windows x64 NSIS installer and portable executable, with locally bundled runtime assets. |

## Release artifacts

The following unsigned binaries were generated locally from this release build and are included in the source ZIP's `release/` folder. The ZIP also includes its own `CHECKSUMS.txt` file.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `API Manager Setup 1.0.0.exe` | 132914796 | `93E1353F728CC92D0F2099C4A2C8EFEADCFC11FD5C2DE326FF126551C8E50AD5` |
| `API Manager 1.0.0.exe` | 132704620 | `5548D1794541ABEECE8857751D8D32432D4CE2A2AD38A7FED1234F3DA3E29891` |

## Coverage details

- Native request fixtures exercise body modes, duplicate headers/query parameters, variable substitution, redirects with credential stripping, file bounds, cookies, decompression, invalid inputs, cancellation, timeouts, and response truncation.
- Auth checks include published Digest/OAuth1/AWS/JWT vectors and independent Hawk/EdgeGrid/asymmetric JWT verification. Digest and NTLM are also exercised through a real loopback handshake; NTLM retains one connection for its challenge exchange. OAuth2 grants use a local token endpoint.
- Scripts run through the production Electron sandbox in addition to pure test harnesses. Checks cover no Node/DOM/bridge access, denied network requests, three-second infinite-loop termination, cancellation, worker/window cleanup, Chai assertions, scoped mutations, and dynamic value consistency across pre-request/send/post-response.
- Storage checks cover queued atomic writes, validated backups, corrupt-file retention/recovery, missing-primary recovery, close acknowledgments, input bounds, and off-screen window recovery.
- Desktop tests interact with the built application, native clipboard, and stubbed native file dialog choices. They close the native window normally and relaunch the same isolated profile to verify session continuity.
- Compact-window coverage uses the minimum 1000 by 650 native window size, checks visible response content and console space, grows/shrinks the window, and confirms the preferred split and usable response layout survive reopening.
- The five bundled examples were imported and exercised through the native transport against `examples/mock-server.mjs`: GET echo with repeated query values, JSON with consistent dynamic UUIDs, SOAP 1.2, token retrieval, and a protected Bearer request all returned HTTP 200. Missing credentials correctly returned HTTP 401; native OAuth token acquisition also succeeded.
- The actual portable executable was launched separately in an isolated profile. JSON and SOAP 1.2 requests succeeded and both responses were persisted. The hidden portable smoke check verified JSON display and SOAP transport/persistence; SOAP editor rendering is covered by the packaged desktop suite rather than that separate hidden portable check.

## Practical limits

Passing tests demonstrate the listed scenarios, not an absence of all defects or complete Postman parity. External API servers, enterprise authentication policies, proxy networks, and every possible imported collection cannot be exhaustively tested here. Native Windows installer user interaction and reputation/signing behavior depend on the machine and signing credentials.

The current compatibility exclusions are listed in [README.md](../README.md#compatibility-and-limits). Scripts implement the documented subset of Postman's APIs, not its whole SDK. NTLM requires NTLMv2 and does not support mandatory MIC/channel binding. OAuth consent/code capture is manual. SOAP covers HTTP envelope sending rather than WSDL-generated operations. Image dynamic variables use documented placeholder-provider fallbacks.

Responses/history and credentials are retained locally as plain data. Size caps and truncation are explicit. Packaging bundles the editor/workers/script library/shared variable mapping; installed runtime assets do not depend on a CDN.

## Reproduce

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
