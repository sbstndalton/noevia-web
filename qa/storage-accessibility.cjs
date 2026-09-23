// Actual components and browser modality; all API calls are synthetic.
// PLAYWRIGHT_MODULE=/path/to/playwright node qa/storage-accessibility.cjs
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
(async()=>{
  const {createServer}=await import('vite');
  const server=await createServer({configFile:false,root:require('node:path').resolve(__dirname,'..'),server:{host:'127.0.0.1',port:0},plugins:[(await import('@vitejs/plugin-react')).default()]});
  await server.listen();
  const origin=server.resolvedUrls.local[0];
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  try {
    const page=await browser.newPage();
    let kind='webdav', failure='', tested;
    await page.route('**/api/**', async route=>{
      const path=new URL(route.request().url()).pathname;
      let body={}; let status=200;
      if(path==='/api/integrations/storage') body={kind,baseUrl:'https://storage.example/dav',username:'synthetic-user',corpusRoot:'Notes',bucket:'synthetic',secretConfigured:true};
      else if(path.endsWith('/test')){tested=route.request().postDataJSON();body={ok:true};}
      else if(path.endsWith('/files')){body={entries:[{name:'note.md',path:'note.md',isDir:false,size:10}]};if(failure==='browse'){status=502;body={error:'Synthetic browse failure'};}}
      else if(path.endsWith('/file')){status=502;body={error:'Synthetic read failure'};}
      else throw Error('Unexpected API: '+path);
      await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
    });
    for(kind of ['nextcloud','webdav','s3']) {
      await page.goto(origin+'qa/fixtures/storage.html');
      const labels=['Storage type',kind==='nextcloud'?'Nextcloud URL':kind==='s3'?'Endpoint URL':'WebDAV base URL',kind==='s3'?'Folder inside the bucket (optional)':'Corpus folder'];
      if(kind==='s3')labels.push('Bucket','Access key ID','Secret access key');
      if(kind==='webdav')labels.push('Username','App password');
      for(const label of labels){const input=page.getByLabel(label,{exact:true});await input.waitFor();await input.isEnabled().then(v=>assert.ok(v));assert.equal(await input.evaluate(el=>el.labels.length),1);}
      const url=page.getByLabel(labels[1],{exact:true});await url.fill('https://storage.example/edited');
      if(kind!=='nextcloud'){
        await page.getByRole('button',{name:'Test',exact:true}).click();
        await page.getByText('Connection successful.').waitFor();
        assert.equal(tested.baseUrl,'https://storage.example/edited');assert.equal(tested.useSavedSecret,true);assert.equal(tested.secret,'');
      }
      for(const width of [375,768,1440])for(const theme of ['light','dark']){
        await page.setViewportSize({width,height:900});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      }
    }
    for(failure of ['', 'browse']){
      const trigger=page.getByRole('button',{name:'Browse storage'});await trigger.click();
      const dialog=page.getByRole('dialog',{name:'Pull from your storage'});await dialog.waitFor();
      assert.ok(await dialog.evaluate(el=>el.contains(document.activeElement)));
      await dialog.getByRole('button',{name:'Done',exact:true}).focus();await page.keyboard.press('Tab');
      assert.ok(await dialog.evaluate(el=>el.contains(document.activeElement)));
      await dialog.getByRole('button',{name:'Close',exact:true}).focus();await page.keyboard.press('Shift+Tab');
      assert.ok(await dialog.evaluate(el=>el.contains(document.activeElement)));
      if(failure==='browse')await dialog.getByRole('alert').filter({hasText:'Synthetic browse failure'}).waitFor();
      else{await dialog.getByRole('button',{name:'add',exact:true}).click();await dialog.getByRole('alert').filter({hasText:'Synthetic read failure'}).waitFor();}
      await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
      assert.ok(await trigger.evaluate(el=>document.activeElement===el));
    }
    console.log('Storage labels, edited Test payload, dialog focus/Escape/errors and 375/768/1440 light/dark: passed');
  }finally{await browser.close();await server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
