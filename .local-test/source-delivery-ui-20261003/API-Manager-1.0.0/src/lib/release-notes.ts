export interface ReleaseNoteSection {
  title: string;
  items: string[];
}

export interface ReleaseNote {
  version: string;
  date: string;
  title: string;
  summary: string;
  sections: ReleaseNoteSection[];
}

/** Kept in one place so About, release notes, and version history stay consistent. */
export const releases: ReleaseNote[] = [{
  version: '1.0.0',
  date: '2026-10-02',
  title: 'Initial release',
  summary: 'A local desktop API client with familiar request tabs, collections, and editors. No API Manager account or cloud synchronization is required.',
  sections: [
    {
      title: 'Local workspace and restored sessions',
      items: [
        'Store collections, nested folders, requests, environments, globals, cookies, response history, and drafts on this computer.',
        'Automatically save changes and restore open tabs, the selected request/environment, editor modes, response zoom, cursor/scroll positions, split preference, theme, and window position/size on relaunch.',
        'Create, switch, duplicate, and close request tabs in the workspace toolbar; use arrows for overflowing tabs, Ctrl plus mouse wheel to navigate, and middle click to close a tab. Resize the sidebar and request/response split.',
        'Dark and light themes, compact-window layouts, keyboard navigation, and confirmation before discarding a draft or deleting saved data.',
      ],
    },
    {
      title: 'Requests and editors',
      items: [
        'Send HTTP/HTTPS requests with editable method, URL, query parameters, headers, authorization, descriptions, and request bodies.',
        'Enable, disable, add, and delete parameter/header rows. Query parameters and the URL stay synchronized, including duplicate keys.',
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
        'Manage collection descriptions and collection/folder variables, inherited authorization, and scripts.',
        'Create, rename, activate, export, and delete environments. Manage enabled global and environment values with optional descriptions.',
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
      ],
    },
    {
      title: 'History, Console, and cookies',
      items: [
        'Retain the latest 200 API runs with request snapshots, saved responses/errors, timestamps, and script results.',
        'Open a historical response without contacting the server. Use Send to resend with the current environment and inherited configuration.',
        'Use Console for pending/completed network activity, request/response details, test results, script logs, filtering, and run replay.',
        'Clear the Console display independently of saved history. Confirm before clearing history.',
        'Persist a local cookie jar, send matching cookies with requests, and inspect or clear stored cookies.',
      ],
    },
    {
      title: 'Import, export, and backups',
      items: [
        'Import pasted cURL commands, Postman v2/v2.1 collections, environments, globals, and API Manager workspace backups, from files or text.',
        'Export Postman-compatible collections/environments/globals, copy a generated cURL command, and export a complete local workspace backup.',
        'Preserve unsupported imported metadata for export where possible; display compatibility warnings and validate malformed imports.',
        'Confirm before replacing the workspace with a backup. Open the local data folder from settings for storage inspection.',
      ],
    },
    {
      title: 'Desktop application and Help',
      items: [
        'Provide a Windows desktop application with installer and portable builds, locally bundled editors/icons/libraries, and no required signup or telemetry.',
        'Show developer details, keyboard shortcuts, release notes, and version history in Help.',
        'Open a prepared bug-report draft in the default email app, addressed to the developer, with summary, reproduction steps, and screenshot/video prompts.',
      ],
    },
  ],
}];

export const currentRelease = releases[0];
