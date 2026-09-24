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
      if(path==='/api/integrations/storage'){
        if(failure==='load'){status=502;body={error:'Synthetic storage load failure'};}
        else body={kind,baseUrl:'https://storage.example/dav',username:'synthetic-user',corpusRoot:'Notes',bucket:'synthetic',secretConfigured:true};
      }
      else if(path.endsWith('/test')){tested=route.request().postDataJSON();body={ok:true};}
      else if(path.includes('/files')){body={entries:[{name:'Examples',path:'Examples',isDir:true,size:null},{name:'note.md',path:'note.md',isDir:false,size:10}]};if(failure==='browse'){status=502;body={error:'Synthetic browse failure'};}}
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
        if(kind==='webdav'){
          await page.getByLabel('Storage type',{exact:true}).selectOption('s3');
          assert.equal(await page.getByText('A secret is saved. Leave blank to test with it on the same server.',{exact:true}).count(),0);
          await page.getByRole('button',{name:'Test',exact:true}).click();
          await page.getByText('Connection successful.').waitFor();
          assert.equal(tested.useSavedSecret,false);
        }
      }
      for(const width of [375,768,1440])for(const theme of ['light','dark']){
        await page.setViewportSize({width,height:900});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      }
    }
    for(failure of ['', 'browse', 'load']){
      const trigger=page.getByRole('button',{name:'Browse storage'});await trigger.click();
      const dialog=page.getByRole('dialog',{name:'Pull from your storage'});await dialog.waitFor();
      assert.ok(await dialog.evaluate(el=>el.contains(document.activeElement)));
      await dialog.getByRole('button',{name:'Done',exact:true}).focus();await page.keyboard.press('Tab');
      assert.ok(await dialog.evaluate(el=>el.contains(document.activeElement)));
      await dialog.getByRole('button',{name:'Close',exact:true}).focus();await page.keyboard.press('Shift+Tab');
      assert.ok(await dialog.evaluate(el=>el.contains(document.activeElement)));
      if(failure==='load'){
        await dialog.getByRole('alert').filter({hasText:'Could not load your storage connection'}).waitFor();
        assert.equal(await dialog.getByRole('button',{name:'Root',exact:true}).count(),0);
      } else if(failure==='browse')await dialog.getByRole('alert').filter({hasText:'Synthetic browse failure'}).waitFor();
      else{await dialog.getByRole('button',{name:'add',exact:true}).click();await dialog.getByRole('alert').filter({hasText:'Synthetic read failure'}).waitFor();}
      await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
      assert.ok(await trigger.evaluate(el=>document.activeElement===el));
    }
    failure='';
    const surface=async locator=>locator.evaluate(el=>{
      const css=getComputedStyle(el),box=el.getBoundingClientRect();
      return {background:css.backgroundColor,image:css.backgroundImage,filter:css.backdropFilter||css.webkitBackdropFilter||'none',
        border:css.borderTopWidth,box:{left:box.left,right:box.right,top:box.top,bottom:box.bottom},
        viewport:{width:innerWidth,height:innerHeight},scrollWidth:document.documentElement.scrollWidth};
    });
    // Blur by itself does not paint a sheet: the old reset left .aero's blur active.
    const hasSurface=style=>(style.background!=='rgba(0, 0, 0, 0)' && style.background!=='transparent') || style.image!=='none';
    for(const material of ['editorial','glass','contemporary'])for(const theme of ['light','dark'])for(const width of [375,768,1440]){
      await page.setViewportSize({width,height:900});
      await page.evaluate(({material,theme})=>{
        document.documentElement.dataset.family=material;
        document.documentElement.dataset.theme=theme;
      },{material,theme});
      for(const [triggerName,dialogName] of [['Browse storage','Pull from your storage'],['Choose folder','Choose a folder']]){
        const trigger=page.getByRole('button',{name:triggerName,exact:true});await trigger.click();
        const dialog=page.getByRole('dialog',{name:dialogName});await dialog.waitFor();
        await dialog.evaluate(el=>Promise.all(el.getAnimations().map(animation=>animation.finished.catch(()=>{}))));
        const style=await surface(dialog);
        assert.ok(hasSurface(style),`${material}/${theme}/${width} ${dialogName} lost its surface: ${JSON.stringify(style)}`);
        assert.ok(style.box.left>=-1 && style.box.right<=width+1 && style.box.top>=-1 && style.box.bottom<=901,
          `${material}/${theme}/${width} ${dialogName} escaped viewport: ${JSON.stringify(style.box)}`);
        assert.ok(style.scrollWidth<=width,`${material}/${theme}/${width} caused horizontal overflow`);
        assert.ok(await dialog.evaluate(el=>el.contains(document.activeElement)),`${dialogName} did not receive focus`);
        if(material==='liquid' && theme==='dark' && width===375 && dialogName==='Choose a folder' && process.env.QA_SCREENSHOT)
          await page.screenshot({path:process.env.QA_SCREENSHOT});
        await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
        assert.ok(await trigger.evaluate(el=>document.activeElement===el),`${dialogName} did not restore focus`);
      }
      const trigger=page.getByRole('button',{name:'Open wrapper'});await trigger.click();
      const wrapper=page.getByRole('dialog',{name:'Synthetic wrapper'});await wrapper.waitFor();
      await wrapper.locator(':scope > .dialog-sheet').evaluate(el=>Promise.all(el.getAnimations().map(animation=>animation.finished.catch(()=>{}))));
      const outer=await surface(wrapper),inner=await surface(wrapper.locator(':scope > .dialog-sheet'));
      assert.equal(outer.background,'rgba(0, 0, 0, 0)',`${material}/${theme}/${width} wrapper acquired a background`);
      assert.equal(outer.image,'none',`${material}/${theme}/${width} wrapper acquired an image`);
      assert.ok(hasSurface(inner),`${material}/${theme}/${width} wrapped panel lost its surface`);
      assert.ok(inner.box.left>=-1 && inner.box.right<=width+1 && inner.box.top>=-1 && inner.box.bottom<=901,
        `${material}/${theme}/${width} wrapped panel escaped viewport`);
      await page.keyboard.press('Escape');await wrapper.waitFor({state:'hidden'});
    }
    console.log('Storage labels, errors, focus/Escape and direct/wrapped dialog surfaces: 3 materials × 2 themes × 3 widths passed');
  }finally{await browser.close();await server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
