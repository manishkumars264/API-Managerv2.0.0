# Try API Manager with a local API

The installed or portable **API Manager application does not require Node.js**. Node.js 24 is needed only for this optional demo server. The server uses built-in Node modules: no npm installation is needed. Everything below contacts `127.0.0.1` on this computer and uses fixed fake credentials.

## Start the demo

1. Unzip the software bundle. Install/run API Manager using the bundle's main README.
2. To run these optional local examples, install Node.js 24 and open a terminal in this `examples` folder.
3. Start the server:

   ```powershell
   node mock-server.mjs
   ```

4. Keep the terminal open. It prints `http://127.0.0.1:3000`. Stop it with **Ctrl+C** when finished.
5. In API Manager, click **Import → Choose files to import** and select both `Local Echo.postman_collection.json` and `Local.postman_environment.json` from this folder.
6. Choose **Local** in the environment selector at the top. Open **Collections → Local Echo**.

If port 3000 is occupied, use a different port and change `base_url` in **Environments → Local** to match:

```powershell
$env:API_MANAGER_DEMO_PORT = '3100'
node mock-server.mjs
```

`API_MANAGER_DEMO_PORT=0` selects an available port automatically; use the exact URL printed by the server. The server always listens on `127.0.0.1`.

## Send the examples

| Request | What to do | Expected result |
| --- | --- | --- |
| **Echo → GET echo** | Open and click **Send**. | HTTP 200 JSON, method `GET`, echoed message, and repeated query values `["first", "second"]`. |
| **Echo → Send JSON with dynamic values** | Click **Send**, then send again. | HTTP 200. `json.created` is UNIX seconds. `json.requestId` matches `headers.x-request-id` within a run and changes between runs. Two passing test results. |
| **Echo → Send SOAP 1.2** | Open the imported SOAP request and click **Send**. | HTTP 200 XML containing `EchoResponse`, `Hello from API Manager`, and a received-byte count. Two passing tests. |
| **Authorization demo → Get demo token** | Click **Send** before the protected request. | HTTP 200 JSON with `access_token`; the post-response script stores it in Local as `demo_token`. |
| **Authorization demo → Echo with OAuth 2.0** | After the previous step, click **Send**. | HTTP 200 protected echo using the demo Bearer token. You can also open **Authorization → Get token**, then send, to try native token acquisition. |

Without a token, the protected endpoint returns HTTP 401. Re-importing Local creates a separate environment; select the correct one. The fake token endpoint supports only **client credentials**, with client authentication in a Basic header or form body. It has no real accounts or refresh flow.

## Try the response and workspace controls

- Switch **Pretty**, **Raw**, and **Preview**, inspect **Headers**, and use **Beautify**, **Wrap lines**, and **Zoom + / −**.
- Use **Copy body** or **Copy body with headers**. The save menu downloads **Save body (.json)** or **Save body with headers (.json)**. XML saves as a JSON string/envelope.
- Open multiple requests and scroll the tab strip. Toggle **Console** at the bottom to inspect sample logs and requests. Inspect **Test results** in the response panel.
- Open **History** to inspect previous requests/responses. Use the main **Send** button or the send icon beside a History entry to create another local request.
- Close API Manager normally and reopen it: drafts, tabs, responses, and history resume. Restart this demo server separately if you stopped it; reopening the application does not start or resend requests automatically.
- Export a collection/environment or workspace backup, then import it to try portability and session restoration. A full backup restore asks for confirmation.

The demo SOAP endpoint is a fixed example, not a WSDL service or schema validator. Request bodies are limited to 1 MB. Echoed headers show only the fake demo credentials supplied here.
