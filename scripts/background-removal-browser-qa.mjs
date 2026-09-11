import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

// 復用 04 的真 WHIP/WHEP harness；保留原測試並加入去背實際遠端像素驗證。
const temp = path.resolve("tmp/background-removal-browser");
await fs.mkdir(temp, { recursive: true });
let source = await fs.readFile("scripts/presenter-browser-qa.mjs", "utf8");
source = 'import os from "node:os";\n' + source;
source = source.replace('instructor = await browser.newPage', 'receipt.conditions = {browser:browser.version(),os:os.platform()+" "+os.release(),cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,ramGiB:Math.round(os.totalmem()/1024**3),input:"synthetic 640x360 camera, 1024x768 PPT",output:"1920x1080 canvas/WHIP/WHEP",model:"MediaPipe CPU worker"}; instructor = await browser.newPage');
source = source.replace('window.qaTracks = [];', `window.qaTracks = [];
    window.qaSegmentation = {created:0,terminated:0,frames:0,errors:[],durations:[]};
    const NativeWorker=window.Worker;
    window.Worker=class extends NativeWorker {
      constructor(...args){super(...args);window.qaSegmentation.created++;
        this.addEventListener("message",e=>{if(e.data.type==="frame"){window.qaSegmentation.frames++;if(window.qaSegmentation.durations.length<900)window.qaSegmentation.durations.push(e.data.durationMs);}if(e.data.type==="error")window.qaSegmentation.errors.push(e.data.error);});
      }
      terminate(){window.qaSegmentation.terminated++;super.terminate();}
    };`);
source = source.replace('receipt.failure = error.message;', 'receipt.failure = error.message; receipt.segmentation = await instructor?.evaluate(()=>window.qaSegmentation).catch(()=>null);');
source = source.replace('"./private-chat-disposable-qa.mjs"', JSON.stringify(pathToFileURL(path.resolve("scripts/private-chat-disposable-qa.mjs")).href));
source = source.replace('const require = createRequire(import.meta.url);', 'const require = createRequire(path.join(root, "package.json"));');
source = source.replace('if (url.pathname === "/app.js")', `if (url.pathname.startsWith("/presenter-segmentation/")) {
      const name = url.pathname.slice("/presenter-segmentation/".length);
      if (!/^[a-zA-Z0-9_.-]+$/.test(name)) { res.writeHead(404); res.end(); return; }
      res.setHeader("Content-Type", name.endsWith(".js") ? "text/javascript" : name.endsWith(".wasm") ? "application/wasm" : "application/octet-stream");
      res.end(await fs.readFile(path.join(root, "public/presenter-segmentation", name))); return;
    }
    if (url.pathname === "/app.js")`);
source = source.replace('await viewer.setViewportSize', `
  receipt.phase = "background-removal";
  const toggle = instructor.getByLabel("講師透明人像去背", {exact:true});
  await toggle.check();
  await instructor.getByRole("status").filter({hasText:"本機去背中"}).waitFor({timeout:30000});
  // 合成的無人紅色攝影機應被移除，PPT 藍色應在觀眾實際解碼影格可見。
  await viewer.waitForFunction(() => {
    const v = document.querySelector("video"); const c = document.createElement("canvas"); c.width=1920;c.height=1080;
    const ctx=c.getContext("2d");ctx.drawImage(v,0,0,1920,1080);const p=ctx.getImageData(1400,900,1,1).data;
    return p[2]>150 && p[0]<100;
  });
  receipt.checks.push("real local segmentation removes synthetic empty background in actual WHEP decoded PPT pixels");
  receipt.soak = {durationSeconds:120,samples:[],scope:"synthetic empty camera; not real hardware or 30-minute memory validation"};
  for(let sample=0;sample<6;sample++){
    await instructor.waitForTimeout(20000);
    assert.equal(await toggle.isChecked(),true,"background removal remains active during soak");
    const stats=await instructor.evaluate(()=>({frames:window.qaSegmentation.frames,liveWorkers:window.qaSegmentation.created-window.qaSegmentation.terminated}));
    assert.equal(stats.liveWorkers,1);assert.ok(stats.frames>(receipt.soak.samples.at(-1)?.frames??0));
    receipt.soak.samples.push(stats);console.log("Background soak: "+((sample+1)*20)+" seconds");
  }
  receipt.checks.push("120-second real worker/remote broadcast soak retains one worker and continues producing frames");
  await instructor.screenshot({path:path.join(out,"background-removal-active.png"),fullPage:true});
  await toggle.uncheck();
  await viewer.waitForFunction(() => {
    const v=document.querySelector("video");const c=document.createElement("canvas");c.width=1920;c.height=1080;
    const ctx=c.getContext("2d");ctx.drawImage(v,0,0,1920,1080);const p=ctx.getImageData(1400,900,1,1).data;
    return p[0]>150 && p[2]<100;
  });
  receipt.checks.push("disable restores ordinary camera in remote stream without replacing output track");
  await instructor.route("**/presenter-segmentation/worker.js", route=>route.abort());
  await toggle.check();
  await instructor.getByRole("status").filter({hasText:"去背失敗"}).waitFor();
  assert.equal(await toggle.isChecked(),false);
  await instructor.unroute("**/presenter-segmentation/worker.js");
  receipt.checks.push("worker load failure returns unchecked toggle and ordinary camera");
  await toggle.check();await instructor.getByRole("status").filter({hasText:"本機去背中"}).waitFor();
  await viewer.setViewportSize`);
source = source.replace('receipt.checks.push("source ended handled; stop releases all captured tracks");', `receipt.checks.push("source ended handled; stop releases all captured tracks");
  receipt.segmentation = await instructor.evaluate(()=>window.qaSegmentation);
  assert.equal(receipt.segmentation.created,receipt.segmentation.terminated,"all segmentation workers terminated");
  const timings=receipt.segmentation.durations.sort((a,b)=>a-b);
  receipt.segmentation.timingMs={samples:timings.length,median:timings[Math.floor(timings.length/2)],p95:timings[Math.floor(timings.length*0.95)],max:timings.at(-1)};
  delete receipt.segmentation.durations;
  receipt.checks.push("all created background workers terminated after source end/stop");`);
source = source.replaceAll('"presenter-viewer-mobile.png"', '"background-removal-viewer-mobile.png"').replaceAll('"presenter-studio.png"', '"background-removal-studio.png"').replaceAll('"presenter-browser-failure.png"', '"background-removal-browser-failure.png"').replaceAll('"presenter-browser-evidence.json"', '"background-removal-browser-evidence.json"');
const generated = path.join(temp, "run.mjs");
await fs.writeFile(generated, source);
await import(pathToFileURL(generated).href);
