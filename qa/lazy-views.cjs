// Deferred import/rejection contract with the real lazy-view and fallback components.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
(async()=>{
  const {createServer}=await import('vite');
  const server=await createServer({configFile:false,root:require('node:path').resolve(__dirname,'..'),server:{host:'127.0.0.1',port:0},plugins:[(await import('@vitejs/plugin-react')).default()]});
  await server.listen(); const origin=server.resolvedUrls.local[0];
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  try {
    const page=await browser.newPage();
    await page.route('**/api/**',r=>r.abort());
    for(const name of ['Coding','Models','Projects','Diary','Settings']) {
      await page.goto(origin+'qa/fixtures/lazy-views.html?name='+name);
      await page.getByRole('status').filter({hasText:'Loading '+name+'…'}).waitFor();
      assert.equal(await page.getByRole('status').count(),1);
      assert.ok(await page.getByRole('navigation',{name:'App navigation'}).isVisible());
      assert.ok((await page.locator('.app-stack').boundingBox()).height>=160);
      await page.getByRole('button',{name:'Finish import'}).click();
      await page.getByRole('heading',{name:'Loaded '+name}).waitFor();
      assert.equal(await page.getByRole('status').count(),0);
    }
    await page.goto(origin+'qa/fixtures/lazy-views.html?name=Diary&hidden=1');
    assert.equal(await page.getByRole('status').count(),0);
    await page.getByRole('button',{name:'Open view'}).click();
    await page.getByRole('status').filter({hasText:'Loading Diary…'}).waitFor();
    await page.goto(origin+'qa/fixtures/lazy-views.html?fail=1');
    await page.getByRole('alert').waitFor();
    await Promise.all([page.waitForEvent('load'),page.getByRole('button',{name:'Reload',exact:true}).click()]);
    await page.getByRole('alert').waitFor();
    console.log('Five loading destinations, hidden Diary silence, preserved frame and rejected-import reload: passed');
  }finally{await browser.close();await server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
