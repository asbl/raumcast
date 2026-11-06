// Confirms the fixes for A1–A7. Uses simulated receivers, never physical Cast.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

execFileSync(process.execPath,['--import','tsx','--test','test/audit-regressions.test.ts','test/direct-audio.test.ts'],{stdio:'inherit'});
if(process.argv.includes('--browser')) {
  const temp=await mkdtemp(join(tmpdir(),'raumcast-fixed-audit-'));
  process.env.RAUMCAST_DATA_DIR=temp;
  process.argv.push('--demo');
  const {DemoTransport}=await import('../src/demo.js');
  const original=DemoTransport.prototype.send;
  let first=true;
  DemoTransport.prototype.send=async function(method,params) {
    if(method==='Cast.enable' && first){first=false;throw new Error('Simulierter vorübergehender Initialisierungsfehler');}
    return original.call(this,method,params);
  };
  const {launch}=await import('../src/main.js');
  const app=await launch();
  try {
    assert.ok(app.browser.process()!.spawnargs.includes(`--user-data-dir=${join(temp,'demo','browser-profile')}`));
    await app.page.waitForFunction(()=>document.querySelector('#connection')?.textContent==='Cast ist nicht bereit');
    assert.equal(await app.page.$eval('#refresh',e=>(e as HTMLButtonElement).disabled),false);
    await app.page.click('#refresh');
    await app.page.waitForFunction(()=>document.querySelector('#connection')?.textContent==='Zur Bildschirmübertragung bereit');
    assert.equal(app.initializationError,'');
    assert.equal(await app.page.$eval('#error',e=>(e as HTMLElement).hidden),true);
    console.log('A5/A6 behoben: dauerhaftes Profil und Wiederholung über die Oberfläche bestätigt.');
    const {serveSystemAudio}=await import('../src/system-audio.js');
    const ui=await serveSystemAudio('audit-no-capture',()=>{});
    const page=await app.browser.newPage();
    let level=0.25,reads=0;
    try {
      await page.exposeFunction('raumcastAudio',(action:string,patch:{level?:number;delta?:number})=>{
        if(action==='status')reads++;
        if(action==='adjust')level=Math.round((level + patch.delta!)*10000)/10000;
        if(action==='volume')level=patch.level!;
        return {ok:true,data:{level,muted:false,controlType:'master'}};
      });
      await page.goto(ui.url,{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>!(document.querySelector('#receiver-volume') as HTMLInputElement).disabled);
      await page.focus('#receiver-volume');
      const before=reads;level=0.10;
      await page.waitForFunction(()=>document.querySelector('#volume-value')?.textContent==='10 %');
      assert.ok(reads>before);
      await page.click('#volume-up');
      await page.waitForFunction(()=>document.querySelector('#volume-value')?.textContent==='10,5 %');
      assert.equal(level,0.105);
      // Even a change made before the next poll must use the fresh device value.
      level=0.05;
      await page.click('#volume-up');
      await page.waitForFunction(()=>document.querySelector('#volume-value')?.textContent==='5,5 %');
      assert.equal(level,0.055);
      console.log('A7 behoben: Fokus blockiert keine Statusabfragen; +0,5 basiert auf dem aktuellen Gerätewert.');
    } finally {await page.close();ui.close();}
  } finally {DemoTransport.prototype.send=original;await app.shutdown();await rm(temp,{recursive:true,force:true});}
}
