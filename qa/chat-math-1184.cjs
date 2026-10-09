// #1184: LaTeX in a chat reply (`$...$`, `\(...\)`, `$$...$$`) must render as typeset KaTeX math, not
// as literal dollar-sign text. Currency like "$5 and $10" must stay text. Fails on main (no .katex).
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {createFixture}=require('./diary-fixture.cjs');

(async()=>{
 const fixture=createFixture(31396);await fixture.listen();
 const browser=await chromium.launch({headless:true,channel:'chrome'});const errors=[];
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://localhost:31396');
  const box=page.getByRole('textbox',{name:'Message',exact:true});
  await box.fill('math synthetic');
  await box.press('Enter');
  await page.getByTitle('Stop generating').waitFor({state:'detached',timeout:8000}).catch(()=>{});
  await page.waitForFunction(()=>document.querySelector('.transcript')?.textContent.includes('Prices stay text'),null,{timeout:5000});
  await page.waitForFunction(()=>document.querySelectorAll('.transcript .katex').length>=3,null,{timeout:8000}).catch(()=>{});
  const r=await page.evaluate(()=>{
   const t=document.querySelector('.transcript');
   return {katex:t.querySelectorAll('.katex').length,display:t.querySelectorAll('.katex-display').length};
  });
  console.log(JSON.stringify({katex:r.katex,display:r.display}));
  assert.ok(r.katex>=3,'inline $..$, \\(..\\) and $$..$$ must each render through KaTeX');
  assert.ok(r.display>=1,'$$..$$ must render as display math');
  const visible=await page.evaluate(()=>{const c=document.querySelector('.transcript').cloneNode(true);c.querySelectorAll('.katex-mathml').forEach(n=>n.remove());return c.textContent;});
  assert.ok(!visible.includes('\\sqrt'),'raw LaTeX commands must not be visible');
  assert.ok(visible.includes('costs $5 and $10 today'),'dollar amounts must stay literal text');
  // Review follow-ups: a huge \rule is clamped, and an unclosed $$ block swallows nothing.
  await box.fill('math size synthetic');
  await box.press('Enter');
  await page.waitForFunction(()=>document.querySelector('.transcript')?.textContent.includes('After heading'),null,{timeout:8000});
  await page.waitForTimeout(800);
  const size=await page.evaluate(()=>({doc:document.documentElement.scrollWidth,win:window.innerWidth,
    wide:Math.max(0,...[...document.querySelectorAll('.transcript .katex')].map(n=>n.parentElement.getBoundingClientRect().width)),
    heading:!![...document.querySelectorAll('.transcript h2, .transcript h3, .transcript h4')].find(h=>h.textContent==='After heading'),
    list:!![...document.querySelectorAll('.transcript li')].find(l=>l.textContent==='after list')}));
  console.log(JSON.stringify(size));
  assert.ok(size.doc<=size.win,'page must not grow a horizontal scrollbar from huge math');
  assert.ok(size.wide<=size.win,'rendered math is contained to the viewport');
  assert.ok(size.heading&&size.list,'an unclosed $$ block must not swallow the heading and list after it');
  assert.deepEqual(errors,[]);
  console.log('PASS chat math: KaTeX renders inline and display LaTeX; currency stays text.');
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
