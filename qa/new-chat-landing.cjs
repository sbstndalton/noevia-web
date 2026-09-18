const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');const {navClick}=require('./nav.cjs');
const assert=require('node:assert/strict');const {createFixture}=require('./diary-fixture.cjs');
(async()=>{const f=createFixture(31254);await f.listen();const browser=await chromium.launch({headless:true,channel:'chrome'});
try{const p=await browser.newPage();let historyReads=0;p.on('request',r=>{if(/\/history/.test(r.url()))historyReads++;});
await p.goto('http://localhost:31254');await p.getByRole('textbox',{name:'Message',exact:true}).waitFor();assert.equal(await p.locator('.chat-workspace.is-empty').count(),1);
// A reload returns to where you were rather than to a new chat (user review of ab2720a),
// and still costs no history read and no generation.
await navClick(p,'Projects');await p.locator('.projects-head, .projects-grid, .empty-state-card').first().waitFor();
await p.reload();await p.locator('.projects-head, .projects-grid, .empty-state-card').first().waitFor();
assert.equal(await p.getByRole('textbox',{name:'Message',exact:true}).isVisible().catch(()=>false),false,'a reload must not drop back to a new chat');
assert.equal(historyReads,0);assert.equal(f.requests.length,0);
// A browser with no stored place still opens an unsaved New chat.
const fresh=await browser.newPage();await fresh.goto('http://localhost:31254');
await fresh.getByRole('textbox',{name:'Message',exact:true}).waitFor();assert.equal(await fresh.locator('.chat-workspace.is-empty').count(),1);
await fresh.close();
console.log('PASS fresh launch opens an unsaved New chat; a reload returns to where you were; no history reads or generation');
}finally{await browser.close();await f.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
