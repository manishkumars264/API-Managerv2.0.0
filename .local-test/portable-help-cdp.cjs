'use strict';
const { chromium, expect } = require('@playwright/test');
const fs = require('node:fs/promises'), path = require('node:path'), http = require('node:http');
const { once } = require('node:events'), { execFileSync } = require('node:child_process');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  const profile = await fs.mkdtemp(path.resolve('.local-test/portable-cdp-profile-'));
  const requests = [], fixture = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    requests.push({ method: req.method, url: req.url, contentType: req.headers['content-type'], bodyBytes: Buffer.byteLength(body) });
    if (req.url === '/soap') { res.setHeader('content-type','application/soap+xml'); res.end('<Envelope><Body><Result>Portable SOAP accepted</Result></Body></Envelope>'); }
    else { res.setHeader('content-type','application/json'); res.end('{"portable":true,"message":"Portable JSON accepted"}'); }
  });
  fixture.listen(0,'127.0.0.1'); await once(fixture,'listening'); const base = `http://127.0.0.1:${fixture.address().port}`;
  const reservation = http.createServer(); reservation.listen(0,'127.0.0.1'); await once(reservation,'listening'); const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  const env = { ...process.env, API_MANAGER_DATA_DIR: profile, API_MANAGER_TEST_MODE: '1', API_MANAGER_PRODUCTION: '1' }; delete env.ELECTRON_RUN_AS_NODE;
  let browser, ownedPid, endpointOwner;
  try {
    const executableLiteral = "'" + path.resolve('release/API Manager 1.0.0.exe').replaceAll("'", "''") + "'";
    const launched = JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',`$portableProcess = Start-Process -FilePath ${executableLiteral} -ArgumentList '--remote-debugging-port=${port}' -WindowStyle Hidden -PassThru; @{ id = $portableProcess.Id; started = $portableProcess.StartTime.ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress`],{env,encoding:'utf8'}));
    ownedPid = launched.id; console.log(`Owned portable wrapper PID ${ownedPid}, debugging port ${port}`);
    let endpoint;
    for (let index=0; index<50; index++) {
      try { endpoint = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); if (endpoint.webSocketDebuggerUrl) break; } catch {}
      await sleep(500);
    }
    if (!endpoint?.webSocketDebuggerUrl) throw new Error('Portable wrapper did not expose a debugging endpoint.');
    const ancestry = JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command', `$listener = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction Stop | Select-Object -First 1; $seen = @(); $current = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"; for($count=0;$count -lt 20 -and $current;$count++){ $seen += @{ id=$current.ProcessId; parent=$current.ParentProcessId; path=$current.ExecutablePath; command=$current.CommandLine }; $current = Get-CimInstance Win32_Process -Filter "ProcessId=$($current.ParentProcessId)" }; ConvertTo-Json -InputObject $seen -Compress`],{encoding:'utf8'}));
    if (!ancestry.some(item=>item.id===ownedPid)) throw new Error('Debug endpoint does not belong to the launched portable process tree.');
    endpointOwner = ancestry[0].id;
    browser = await chromium.connectOverCDP(endpoint.webSocketDebuggerUrl,{timeout:15000});
    const page = browser.contexts()[0].pages().find(page=>page.url().includes('/dist/index.html')) || browser.contexts()[0].pages()[0];
    if (!page) throw new Error('Packaged app renderer page missing.');
    const cdp = await page.context().newCDPSession(page); await cdp.send('Page.setWebLifecycleState',{state:'active'});
    await page.getByRole('textbox',{name:'Request URL',exact:true}).waitFor({timeout:15000});
    const loaded = await page.evaluate(()=>window.apiManager.loadWorkspace());
    if (path.resolve(loaded.storagePath)!==profile) throw new Error('App opened an unexpected profile.');
    await page.getByRole('textbox',{name:'Request URL',exact:true}).fill(`${base}/json`); await page.getByRole('button',{name:'Send',exact:true}).click();
    await expect(page.locator('.response-body .view-lines')).toContainText('Portable JSON accepted',{timeout:15000});
    await page.getByRole('button', { name: 'Search response body', exact: true }).click();
    const find = page.locator('.response-body .find-widget');
    await find.getByRole('textbox', { name: 'Find', exact: true }).fill('Portable JSON accepted');
    await expect(find.locator('.matchesCount')).toHaveText('1 of 1');
    await expect(page.locator('.response-body .currentFindMatch')).not.toHaveCount(0);
    await find.getByRole('textbox', { name: 'Find', exact: true }).press('Escape');
    await page.getByRole('button', { name: 'Help', exact: true }).click();
    const help = page.getByRole('dialog', { name: 'About and Help', exact: true });
    await expect(help).toContainText('Manish Kumar Singh');
    await help.getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByRole('combobox',{name:'Request protocol'}).selectOption('SOAP'); await page.getByRole('combobox',{name:'SOAP version'}).selectOption('1.2');
    await page.getByRole('textbox',{name:'SOAP action'}).fill('urn:PortableEcho'); await page.getByRole('textbox',{name:'Request URL',exact:true}).fill(`${base}/soap`); await page.getByRole('button',{name:'Send',exact:true}).click();
    // CDP connects only to the renderer and cannot change Electron's native
    // hidden-window throttling. Verify the saved SOAP response after Send.
    await expect.poll(async()=>{try{return JSON.parse(await fs.readFile(path.join(profile,'workspace.json'),'utf8')).history[0]?.response?.body}catch{return ''}},{timeout:15000}).toContain('Portable SOAP accepted');
    await expect.poll(async()=>{try{return JSON.parse(await fs.readFile(path.join(profile,'workspace.json'),'utf8')).history.length}catch{return 0}},{timeout:15000}).toBe(2);
    const workspace = JSON.parse(await fs.readFile(path.join(profile,'workspace.json'),'utf8'));
    if(workspace.history.some(entry=>entry.response?.status!==200)||requests[1].method!=='POST'||!requests[1].contentType.includes('urn:PortableEcho'))throw new Error('Native response or SOAP transport verification failed.');
    const result={passed:true,actualPortable:true,wrapper:launched,executable:ancestry[0].path,profile,requests,savedRuns:workspace.history.length,jsonRendered:true,helpAndResponseSearch:true,soapTransportAndPersistence:true,visualLimitation:'Hidden renderer connected through CDP cannot have native background throttling disabled; SOAP Monaco redraw is not asserted.'};
    await fs.writeFile(path.resolve('.local-test/portable-help-cdp-result.json'),JSON.stringify(result,null,2)); console.log(JSON.stringify(result));
    await cdp.send('Browser.close').catch(()=>{});
  } catch(error){console.error(error.stack||error);process.exitCode=1;}
  finally{
    if(browser) await browser.close().catch(()=>{});
    if(endpointOwner) { try{execFileSync('powershell.exe',['-NoProfile','-Command',`Stop-Process -Id ${endpointOwner} -ErrorAction SilentlyContinue`],{encoding:'utf8'});}catch{} }
    if(ownedPid) { try{execFileSync('powershell.exe',['-NoProfile','-Command',`Stop-Process -Id ${ownedPid} -ErrorAction SilentlyContinue`],{encoding:'utf8'});}catch{} }
    fixture.closeAllConnections(); await new Promise(resolve=>fixture.close(resolve));
  }
})();

