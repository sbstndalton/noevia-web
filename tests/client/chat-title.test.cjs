const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const result={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../../src/chat-title.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:result});
test('first-prompt edits update derived titles while later edits and custom names survive',()=>{
 const first={role:'user',content:'Original prompt'},reply={role:'assistant',content:'Answer'};
 assert.equal(result.titleAfterSend('Original prompt',[first,reply],[],'Corrected prompt'),'Corrected prompt');
 assert.equal(result.titleAfterSend('My custom name',[first,reply],[],'Corrected prompt'),'My custom name');
 assert.equal(result.titleAfterSend('Original prompt',[first,reply],[first,reply],'Later edit'),'Original prompt');
 assert.equal(result.titleAfterSend('Original prompt',[first],undefined,'Follow-up'),'Original prompt');
 assert.equal(result.titleAfterSend('x'.repeat(80),[{role:'user',content:'x'.repeat(120)}],[],'y'.repeat(120)),'y'.repeat(79)+'…');
});
// #1601: the title was a bare slice(0, 80), so a long first prompt was stored cut mid-word with no ellipsis,
// and the list's CSS ellipsis never ran (the cut string already fit the row). A cut now lands on a word.
test('#1601 a long first message becomes a title cut at a word boundary with an ellipsis',()=>{
 const text="QA Haiku T1: What's the latest stable version of Node.js and when was it released? Cite sources with links.";
 assert.equal(result.deriveChatTitle(text),"QA Haiku T1: What's the latest stable version of Node.js and when was it…");
});
test('#1601 short titles and an exact 80-character message are kept whole',()=>{
 assert.equal(result.deriveChatTitle('Short question'),'Short question');
 const eighty='w'.repeat(40)+' '+'w'.repeat(39);
 assert.equal(eighty.length,80);
 assert.equal(result.deriveChatTitle(eighty),eighty);
});
test('#1601 a word too long to leave a boundary is cut hard with an ellipsis, never splitting an emoji',()=>{
 assert.equal(result.deriveChatTitle('y'.repeat(120)),'y'.repeat(79)+'…');
 const emoji=result.deriveChatTitle('😀'.repeat(60));
 assert.equal(emoji.length,79);
 assert.ok(emoji.endsWith('…'));
 assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(emoji),'no lone surrogate');
});
test('#1601 an automatic title from the old 80-character cut still follows a corrected first prompt',()=>{
 const longFirst="QA Haiku T1: What's the latest stable version of Node.js and when was it released? Cite sources with links.";
 const first={role:'user',content:longFirst},reply={role:'assistant',content:'Answer'};
 assert.equal(result.titleAfterSend(longFirst.slice(0,80),[first,reply],[],'Corrected prompt'),'Corrected prompt');
});
test('#1601 both places a send names a new chat use the word-boundary title, not a bare cut',()=>{
 const app=fs.readFileSync(path.join(__dirname,'../../src/App.tsx'),'utf8');
 assert.ok(!/text\.slice\(0, ?80\)/.test(app),'no bare 80-character cut left in App.tsx');
 assert.equal(app.match(/deriveChatTitle\(text\)/g)?.length,2);
});
// #1785: the server names a chat after its first reply (a `title` event). The client takes it only over the title it
// derived from the first message, so the next list save carries it, and a name the person gave meanwhile is kept.
test('#1785 a generated title replaces the derived title only',()=>{
 const first='QA-SYNTH-2 Say hello in one short sentence.';
 assert.equal(result.adoptGeneratedTitle(first,first,'Friendly Greeting'),'Friendly Greeting');
 assert.equal(result.adoptGeneratedTitle(undefined,first,'Friendly Greeting'),'Friendly Greeting');
 assert.equal(result.adoptGeneratedTitle('My own name',first,'Friendly Greeting'),null,'a rename wins');
 const long='z '.repeat(60).trim();
 assert.equal(result.adoptGeneratedTitle(result.deriveChatTitle(long),long,'Zed Notes'),'Zed Notes');
 assert.equal(result.adoptGeneratedTitle(long.slice(0,80),long,'Zed Notes'),'Zed Notes','the old bare 80-character cut');
 assert.equal(result.adoptGeneratedTitle(first,first,'   '),null);
 assert.equal(result.adoptGeneratedTitle(first,first,42),null);
 assert.equal(result.adoptGeneratedTitle('Friendly Greeting',first,'Friendly Greeting'),null,'nothing to change');
 assert.equal(result.adoptGeneratedTitle(first,first,'A  title\nwith   spaces'),'A title with spaces');
 assert.ok(result.adoptGeneratedTitle(first,first,'x'.repeat(200)).length<=result.GENERATED_TITLE_MAX);
});
test('#1785 the chat stream adopts the title event through the list patch, against the meta at save time',()=>{
 const app=fs.readFileSync(path.join(__dirname,'../../src/App.tsx'),'utf8');
 assert.match(app,/ev\.type === 'title' && typeof ev\.title === 'string'/);
 // Reopen: judged against the chat's FIRST message, so a title after a stopped first reply is still adopted.
 assert.match(app,/const firstMessage = existing\.find\(\(m\) => m\.role === 'user'\)\?\.content \?\? text;/);
 assert.match(app,/\(current\) => \{ const title = adoptGeneratedTitle\(current\.title, firstMessage, generated\); return title \? \{ title \} : null; \}/);
});
test('#1785 reopen: a title after a later turn is adopted over the title derived from the FIRST message',()=>{
 const first='QA-1785 explain synthetic photosynthesis in six paragraphs.';
 assert.equal(result.adoptGeneratedTitle(first,first,'Synthetic Notes'),'Synthetic Notes');
 assert.equal(result.adoptGeneratedTitle(first,'QA-1785 now list three facts.','Synthetic Notes'),null,'judged against the follow-up it is refused: the old bug');
});
