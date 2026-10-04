const { _electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
(async()=>{
  const profile = await fs.mkdtemp(path.resolve('.local-test/find-hover-'));
  const request={id:'request',name:'Hover test',method:'GET',url:'http://localhost',params:[],headers:[],auth:{type:'none'},description:'',body:{mode:'none',language:'json',raw:'',fields:[]}};
  const workspace={version:1,collections:[],environments:[],globals:[],activeEnvironmentId:null,tabs:[{id:'tab',request,response:{status:200,statusText:'OK',headers:[{id:'header',key:'Content-Type',value:'application/json',enabled:true}],body:'{"message":"find hover test"}',duration:1,size:29,url:'http://localhost',receivedAt:new Date().toISOString()},dirty:false,editorTab:'Params',responseTab:'Body:Pretty',responseZoom:14}],activeTabId:'tab',history:[],settings:{theme:'dark',timeout:30000,followRedirects:true,verifySsl:true,maxResponseMB:20},sidebarView:'collections',sidebarWidth:268};
  await fs.writeFile(path.join(profile,'workspace.json'),JSON.stringify(workspace));
  const env={...process.env,API_MANAGER_DATA_DIR:profile,API_MANAGER_PRODUCTION:'1',API_MANAGER_TEST_MODE:'1'};delete env.ELECTRON_RUN_AS_NODE;
  const app=await _electron.launch({args:[path.resolve('.')],env,timeout:15000});
  try {
    const page=await app.firstWindow();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false));
    await page.getByRole('button',{name:'Search response body'}).waitFor();await page.getByRole('button',{name:'Search response body'}).click();
    await page.locator('.response-body .find-widget .monaco-custom-toggle').first().hover();
    await page.locator('.monaco-hover').last().waitFor({timeout:5000});
    console.log(JSON.stringify(await page.locator('.monaco-hover').last().evaluate(node=>{const root=document.querySelector('.response-body .monaco-editor'),context=node.closest('.context-view'),find=document.querySelector('.response-body .find-widget');let parent=node;const ancestors=[];while(parent){ancestors.push(parent.tagName+'.'+parent.className);parent=parent.parentElement;}return{html:context.outerHTML,rect:node.getBoundingClientRect().toJSON(),ancestors,rootContainsHover:root.contains(node),rootContainsFind:root.contains(find),findClasses:find.className,contextParent:context.parentElement.outerHTML.slice(0,400),toolbar:document.querySelector('.response-controls').getBoundingClientRect().toJSON(),find:find.getBoundingClientRect().toJSON()};})));
  }finally{await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
