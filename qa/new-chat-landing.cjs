const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');const {createFixture}=require('./diary-fixture.cjs');
(async()=>{const f=createFixture(31254);await f.listen();const browser=await chromium.launch({headless:true,channel:'chrome'});
try{const p=await browser.newPage();let historyReads=0;p.on('request',r=>{if(/\/history/.test(r.url()))historyReads++;});
await p.goto('http://localhost:31254');await p.getByRole('textbox',{name:'Message',exact:true}).waitFor();assert.equal(await p.locator('.chat-workspace.is-empty').count(),1);
await p.getByRole('button',{name:'Projects',exact:true}).click();await p.reload();await p.getByRole('textbox',{name:'Message',exact:true}).waitFor();assert.equal(historyReads,0);assert.equal(f.requests.length,0);
console.log('PASS fresh launch/reload opens an unsaved New chat without history reads or generation');
}finally{await browser.close();await f.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
