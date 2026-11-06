import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile, readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CastController } from '../src/controller.js';
import { ChromiumCastTransport } from '../src/cast-support.js';
import { PreferenceStore } from '../src/storage.js';
import { ReceiverVolumeControl } from '../src/receiver-volume.js';

class Cdp extends EventEmitter {
  sent:string[]=[];
  async send(method:string) {this.sent.push(method);}
  discover(session?:string, missing=false) {this.emit('Cast.sinksUpdated',{sinks:missing?[]:[{id:'cast:test',name:'Receiver',session}]});}
}
async function fixture(t:{after(fn:()=>Promise<void>):void}) {
  const temp=await mkdtemp(join(tmpdir(),'raumcast-regression-'));
  const cdp=new Cdp(),transport=new ChromiumCastTransport({} as any,cdp as any);
  transport.assertSystemAudioSupported=async()=>{};
  const store=new PreferenceStore(join(temp,'rooms.json'));
  const c=new CastController(transport,store);
  t.after(async()=>{c.dispose();await store.flush();await rm(temp,{recursive:true,force:true});});
  return {temp,cdp,transport,store,c};
}
test('Discovery-Verlust und fremde Wiederbelegung führen nie zu generischem Audio-Stop',async t=>{
  const {cdp,transport,c}=await fixture(t); let stopped=0,closed=0;
  (transport as any).startSystemAudio=async(_name:string,_id:string,requestId:number)=>{
    (transport as any).audio={name:'Receiver',requestId,suspended:false,page:{close:async()=>{}},stream:{close(){closed++;}},volume:{close(){}},direct:{stop:async()=>{stopped++;},close(){}}};
  };
  cdp.discover();await c.start('Receiver','audio');
  cdp.emit('Raumcast.audioState',{requestId:1,state:'active'});
  cdp.discover(undefined,true);
  assert.ok((transport as any).audio);assert.ok(closed>0);
  cdp.discover('Fremde Sitzung');
  assert.equal(c.phase,'uncertain');
  await c.stop();
  assert.ok(stopped>0);assert.deepEqual(cdp.sent,[]);
  assert.equal(c.phase,'idle');
  await transport.send('Raumcast.stopSystemAudio',{sinkName:'Receiver'});
  assert.deepEqual(cdp.sent,[]);
});
test('Receiver-App bestätigt keinen Audiostart; späte fremde Medienereignisse werden ignoriert',async t=>{
  const {cdp,transport,c}=await fixture(t);
  let reject!:(error:Error)=>void;
  (transport as any).startSystemAudio=()=>new Promise((_,fail)=>{reject=fail;});
  cdp.discover();const start=c.start('Receiver','audio');const rejected=assert.rejects(start,/Ladefehler/);
  await new Promise(resolve=>setImmediate(resolve));
  cdp.discover('Default Media Receiver');assert.equal(c.phase,'starting');
  reject(new Error('Ladefehler'));await rejected;assert.equal(c.phase,'uncertain');
  cdp.emit('Raumcast.audioState',{requestId:99,state:'active'});assert.equal(c.phase,'uncertain');
});
test('Speicherfehler verändern bestätigte Einstellungen nicht und bleiben bis zum erfolgreichen Retry sichtbar',async()=>{
  const temp=await mkdtemp(join(tmpdir(),'raumcast-store-'));
  try {
    const blocker=join(temp,'parent');await writeFile(blocker,'file');
    const store=new PreferenceStore(join(blocker,'rooms.json'));
    await assert.rejects(store.update('Raum',{favorite:true}));
    assert.equal(store.value.Raum,undefined);await assert.rejects(store.flush());
    await unlink(blocker);
    await Promise.all([store.update('Raum',{favorite:true}),store.update('Raum',{alias:'Physik'})]);
    await store.flush();
    const saved=Object.values(store.value)[0];
    assert.equal(saved.favorite,true);assert.equal(saved.alias,'Physik');
    assert.deepEqual(JSON.parse(await readFile(store.filename,'utf8')).Raum,saved);
  } finally {await rm(temp,{recursive:true,force:true});}
});
test('Relative Lautstärkeschritte basieren auf dem aktuellen Gerät und werden seriell angewendet',async()=>{
  const control=new ReceiverVolumeControl('cast:audit-only');let level=0.10;
  (control as any).request=async(patch?:{level?:number})=>{
    await new Promise(resolve=>setImmediate(resolve));
    if(patch?.level!==undefined)level=patch.level;
    return {level,muted:false};
  };
  await Promise.all([control.adjust(0.005),control.adjust(0.005)]);
  assert.equal(level,0.11);
  level=0.07;await control.adjust(0.005);assert.equal(level,0.075);
  await assert.rejects(control.adjust(NaN));control.close();
});
