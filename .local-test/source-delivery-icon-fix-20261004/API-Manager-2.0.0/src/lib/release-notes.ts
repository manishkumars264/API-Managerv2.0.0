export interface ReleaseNoteSection {
  title: string;
  items: string[];
}

export interface ReleaseNote {
  version: string;
  date: string;
  title: string;
  summary: string;
  historyDescription?: string;
  sections: ReleaseNoteSection[];
}

/** Kept in one place so About, release notes, and version history stay consistent. */
export const releases: ReleaseNote[] = [{
  version: '2.0.0',
  date: '2026-10-04',
  title: 'Major upgrade',
  summary: 'A resizable Console, selectable themes, expanded authorization and code generation, scripts, response tools, and improved import, save, environment, and tab workflows. Your local workspace and account-free workflow are retained.',
  historyDescription: 'A comprehensive redesign of API Manager v1.0.0, with a more flexible workspace and expanded tools for building and testing APIs.',
  sections: [
    {
      title: 'Local workspace and restored sessions',
      items: [
        'Store collections, nested folders, requests, environments, globals, cookies, response history, and drafts on this computer.',
        'Automatically save changes and restore open tabs, the selected request/environment, editor modes, response zoom, cursor/scroll positions, split preference, theme, and window position/size on relaunch.',
        'Create, switch, duplicate, and close request tabs in the workspace toolbar, including the last tab; the empty workspace explains how to begin. Use arrows for overflowing tabs, Ctrl plus mouse wheel to navigate, and middle click to close a tab. Resize the sidebar and request/response split.',
        'Dark, light, and soft grey themes with blue (default), red, orange, green, and purple accent choices in Settings; compact-window layouts, keyboard navigation, and confirmation before discarding a draft or deleting saved data.',
      ],
    },
    {
      title: 'Requests and editors',
      items: [
        'Send HTTP/HTTPS requests with editable method, URL, query parameters, headers, authorization, descriptions, and request bodies.',
        'Enable, disable, add, and delete parameter/header rows. Query parameters and the URL stay synchronized, including duplicate keys.',
        'Populate Params from imported URLs, retain raw URL spelling and readable email addresses, and preserve disabled rows and query metadata.',
        'Support raw JSON, XML, HTML, JavaScript, and text; multipart form-data with local files; URL-encoded forms; and binary file bodies.',
        'Use locally bundled Monaco editors with syntax highlighting, find/replace, folding, undo/redo, JSON/XML beautify, and line wrapping.',
        'Set timeout, SSL verification, redirect behavior, and maximum response size. Cancel an active request or script stage safely.',
      ],
    },
    {
      title: 'SOAP',
      items: [
        'Choose SOAP 1.1 or 1.2 and edit the XML envelope and action.',
        'Configure POST, the envelope namespace, Content-Type, and SOAPAction/action parameter for the selected version.',
        'Inspect and beautify XML responses, including SOAP faults. SOAP support sends HTTP envelopes; WSDL-generated forms and automatic WS-Security are outside this release.',
      ],
    },
    {
      title: 'Collections, environments, and variables',
      items: [
        'Create and rename collections/folders, organize nested folders, save or move requests, duplicate requests, and search the collection tree.',
        'Duplicate a saved request beside its original inside the same collection/folder; duplicate tabs remain separate drafts. Save updates the same imported request after its first collection save.',
        'Manage collection descriptions and collection/folder variables, inherited authorization, and scripts.',
        'Create, rename, activate, export, and delete environments. Manage enabled global and environment values with optional descriptions.',
        'Save environment values explicitly or edit the active environment from the toolbar popup, with automatic checked variable rows as you type, per-variable delete controls, and Ctrl+S to save. With no environment selected, the popup edits Globals.',
        'Color variable references and hover them to see their current value, source scope, and environment without generating random values or contacting servers.',
        'Resolve variables across URLs, parameters, headers, auth, and bodies. Apply global → collection → folders → environment → script-local precedence.',
        'Support recursive references and documented Postman-style dynamic variables, with stable values within one run.',
      ],
    },
    {
      title: 'Authorization',
      items: [
        'Provide No Auth, inherited auth, Basic, Bearer Token, API Key, Digest, OAuth 1.0, OAuth 2.0, Hawk, AWS Signature v4, NTLMv2, Akamai EdgeGrid, JWT Bearer, and ASAP controls.',
        'Generate signatures/tokens locally and handle supported Digest/NTLM server challenges. Auth fields support variables.',
        'Explicitly acquire OAuth 2 tokens using client credentials, password, refresh token, or a supplied authorization code, including PKCE verifier fields.',
        'OAuth consent/code capture and token refresh are manual. Advanced enterprise variants and signing limitations are documented in the project README.',
      ],
    },
    {
      title: 'Pre-request scripts and response tests',
      items: [
        'Edit JavaScript Pre-request and Post-response scripts on requests, collections, and folders, with ready-to-insert snippets.',
        'Run scripts in collection → ancestor folders → request order in an isolated, bounded sandbox.',
        'Support the documented pm variable/request/response APIs, pm.test(), pm.expect() assertions, console logging, bounded timers, and basic legacy variable helpers.',
        'Persist global, environment, and collection variable changes while keeping runtime request changes separate from saved drafts.',
        'Display assertion results and runtime errors. A pre-request error stops sending; a post-response error keeps the received response.',
      ],
    },
    {
      title: 'Response tools',
      items: [
        'Inspect Pretty, Raw, and Preview views, response headers, cookies, and test results, alongside HTTP status, duration, and body size.',
        'Beautify JSON/XML and wrap or unwrap response lines without changing the stored raw response. Request and response line wrapping have independent saved preferences.',
        'Zoom response text in/out, or reset to 100%. Use Search or Ctrl+F in Pretty/Raw response editors to highlight matches and see the match count; Enter moves to the next match and Shift+Enter to the previous match, cycling through results while the Find input is focused.',
        'Copy the response body alone or with the HTTP status and response headers.',
        'Download the body as .json, or download a JSON envelope containing body and response headers. Preserve original large JSON integers; non-JSON bodies become JSON strings.',
        'Clearly mark binary/base64 and truncated bodies. HTML preview isolates content and blocks scripts, external resources, and navigation.',
        'Refresh the editor for every response, including HTTP errors and empty bodies; clear the old response on connection failure.',
      ],
    },
    {
      title: 'History, Console, and cookies',
      items: [
        'Retain the latest 200 API runs with request snapshots, saved responses/errors, timestamps, and script results.',
        'Open a historical response without contacting the server. Use Send to resend with the current environment and inherited configuration.',
        'Open Console between Environments and History; drag or use the keyboard on its upper divider to resize it. Restore its preferred height when reopening or relaunching.',
        'Use Console for pending/completed network activity, request/response details, test results, script logs, filtering, and run replay, with the newest entries at the top.',
        'Inspect and copy the saved cURL captured from each actual send, with resolved values, scripts, authorization, cookies, and native headers; retain it across edits and relaunches.',
        'Clear the Console display independently of saved history. Confirm before clearing history.',
        'Persist a local cookie jar, send matching cookies with requests, and inspect or clear stored cookies.',
      ],
    },
    {
      title: 'Import, export, and backups',
      items: [
        'Import pasted cURL commands, Postman v2/v2.1 collections, environments, globals, and API Manager workspace backups, from files or text.',
        'Export Postman-compatible collections/environments/globals, copy a generated cURL command, and export a complete local workspace backup.',
        'Inspect read-only generated headers for Basic, Bearer, API Key, and OAuth 2 authorization, scoped/inherited credentials, and body/default headers; dynamic and signed values are created on Send.',
        'Generate request code for cURL, Python, Java, JavaScript, C, and C++, with scoped variables, inherited authorization, enabled headers/parameters, body modes, dependencies, and explicit compatibility notes.',
        'Preserve unsupported imported metadata for export where possible; display compatibility warnings and validate malformed imports.',
        'Confirm before replacing the workspace with a backup. Open the local data folder from settings for storage inspection.',
      ],
    },
    {
      title: 'Desktop application and Help',
      items: [
        'Provide a Windows desktop application with installer and portable builds, locally bundled editors/icons/libraries, and no required signup or telemetry.',
        'Open About and Help above Settings in the left sidebar for developer details and keyboard shortcuts. Browse version history in an accordion, with release notes displayed inline for each version.',
        'Open a prepared bug-report draft in the default email app, addressed to the developer, with summary, reproduction steps, and screenshot/video prompts.',
      ],
    },
  ],
}, {
  version: '1.0.0',
  date: '2026-02-11',
  title: 'Initial release',
  summary: 'The original API Manager release with collections, environments, API requests, and code generation.',
  sections: [{
    title: 'Original release',
    items: [
      'Initial local desktop API Manager application.',
      'Collections and environment management.',
      'Basic, Bearer Token, and API Key authorization.',
      'Request code generation.',
    ],
  }, {
    title: 'Known limitations recorded in v1.0.0',
    items: [
      'OAuth 2.0 token auto-refresh was not implemented; acquisition and refresh remain explicit actions in v2.0.0.',
      'Large response bodies above 10 MB were reported to cause slight UI lag in the original release.',
    ],
  }],
}];

export const currentRelease = releases[0];
