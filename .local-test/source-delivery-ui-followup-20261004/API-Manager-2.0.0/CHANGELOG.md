# Changelog

## v2.0.0 — 2026-10-04

A major upgrade to API Manager v1.0.0, which remains the initial release.

### Added and expanded

- Resizable Console with newest runs and script messages first, network activity, saved request/response details, filtering, replay, and copying the cURL captured from the actual send. Display sorting preserves stored history and script order. The capture includes resolved variables, script changes, authorization, cookies, and native headers.
- History retaining the latest 200 API runs, including request snapshots, responses, errors, and script results. Open a past response or send the request again.
- Blue as the default accent, with red, orange, green, and purple choices in Settings, alongside Dark, Grey, and Light themes. Grey uses light-leaning neutral backgrounds and matching code editors. Theme changes preserve requests and workspace state.
- Authorization controls for inherited/No Auth, Basic, Bearer, API Key, Digest, OAuth 1.0/2.0, Hawk, AWS Signature v4, NTLMv2, Akamai EdgeGrid, JWT Bearer, and ASAP. Supported signatures and tokens are generated locally. OAuth token acquisition and refresh are explicit actions.
- Pre-request and Post-response JavaScript editors and tests on requests, collections, and folders, with ordered execution, snippets, an isolated sandbox, assertions, and persistent variable changes.
- SOAP 1.1/1.2 HTTP envelope support, action/content-type controls, and XML formatting.
- Scoped globals, collection/folder/environment variables, nested references, and documented dynamic variables. Colored variable tokens and hover details show current values, source scope, and active environment; dynamic values are generated on Send.
- Editable toolbar environment popup, including Globals when no environment is selected, **+ Add variable**, editable names/values, and **Ctrl+S** saving throughout the popup. Explicit environment Save controls, clearer environment icons, and a **Delete** text button.
- Request code generation for cURL, Python, Java, JavaScript, C, and C++, with resolved values, dependencies, and compatibility notes.
- Response Pretty/Raw/safe HTML Preview, JSON/XML beautify, independent request/response wrap controls, zoom, body search with highlighting/counts and Enter/Shift+Enter navigation, copy/download body with or without headers, and explicit binary/truncation indicators.
- Session restoration for tabs/drafts, responses, editor views/positions, zoom, wrapping, selected environment, appearance, panel heights, and window geometry.
- About and Help with developer details, keyboard shortcuts, and a combined version-history page with inline release notes. Exclusive version accordions start with v2 expanded and v1 collapsed. A prepared bug-report email draft remains available.

### Changed

- Request tabs sit in the toolbar between workspace actions and Environment. Overflow arrows, Ctrl+wheel navigation, keyboard navigation, and middle-click closing replace the visible tab scrollbar.
- Every request tab can close, including the last one. The empty workspace offers new requests/import and survives relaunch; saved APIs still open from Collections/History. The header describes the tool in one short sentence.
- Console sits between Environments and History in the left navigation. About and Help sits above Settings.
- Compact controls leave more space for request and response editors. Response/search tooltips appear below their controls and stay inside the viewport.
- Collection **Duplicate request** creates a saved copy beside the original in its collection/folder. **Duplicate tab** creates a separate draft.
- Request menu retains Save as, Duplicate tab, and Generate code. Rename stays in the collection menu; one-click cURL copying stays below Send.
- Removed the redundant History Run Again ribbon and variable announcement notices; replay and variable substitution remain supported.

### Fixed

- Imported cURL and Postman URL query parameters populate Params, including duplicate keys, empty values, disabled rows, and preserved descriptions/metadata. Existing drafts and restored backups are hydrated too.
- URL editing retains readable `@` characters and variable references, safely encodes delimiters, and avoids double encoding imported query values. Native transport can encode `@` as `%40`, which represents the same value.
- Save updates the same collection request after an imported cURL's first save, rather than opening Save as.
- The response editor refreshes for successive HTTP 401/403/404 responses and empty bodies; connection failures clear the previous response and retain the new error.
- The toolbar environment gear opens editable values even with no selected environment. Saved changes are used by the next request.
- Request and response wrapping remain independent; tab arrows do not cover close buttons.

### Compatibility and verification

- Application ID, local storage location, and workspace schema remain unchanged. Export a workspace backup and close v1 before installing v2. Both installer and portable builds use the same local data location.
- The README includes unzip/install/build instructions and detailed usage. See [verification](docs/verification.md) for observed test results and practical limits.
- OAuth consent/code capture and token refresh are manual. SOAP does not generate forms from WSDL. Scripts implement the documented subset of Postman's APIs. Large upload cURL captures may use file references with explicit replay notes.

## v1.0.0 — 2026-02-11

The original release, as recorded in the supplied v1 About and Help screenshot:

- Initial API Manager release.
- Collections and environment management.
- Basic, Bearer Token, and API Key authorization.
- Code generation.

Known limitations recorded at the time: OAuth 2.0 token auto-refresh was not implemented, and response bodies above 10 MB could cause slight UI lag. The v2 release retains explicit token refresh and documents response-size limits.
