#!/usr/bin/env node
// Run only in an unprivileged CI job. Dependencies are installed in a temporary,
// isolated runner directory. No production secrets or cloud permissions needed.
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import {
  assertVisualConfig, parseLocalBaseURL, routeURL,
  evaluateLighthouse, visualGateSummary, atomicEvidenceOutput
} from "./contract.mjs";

const requiredEnv = (key) => {
  const value=process.env[key];
  if(!value) throw Error(key+" is required");
  return value;
};
const folder=path.resolve(process.env.VISUAL_QA_ARTIFACT_DIR||"visual-qa-artifacts");
const results={};
const evidence={runId:process.env.GITHUB_RUN_ID??null,commit:process.env.GITHUB_SHA??null,
  date:new Date().toISOString(),config:null,results,metrics:{},notes:[]};
let browser;
let failure=false;
const safeName=(s)=>s.replace(/[^A-Za-z0-9_-]/g,"_").slice(0,70);
const gate=(key,ok,detail)=>{
  results[key]={status:ok?"PASS":"FAIL",detail};
  if(!ok) failure=true;
};
const passPage=async (page,route,scope)=>{
  const cta=page.locator(route.primaryCtaSelector).first();
  const count=await page.locator(route.primaryCtaSelector).count();
  if(!count) {gate(scope+":cta",false,"CTA selector not found");return;}
  const element=await cta.evaluate(el=>{
    const box=el.getBoundingClientRect();
    const styles=getComputedStyle(el);
    const target=el instanceof HTMLAnchorElement?el.getAttribute("href"):null;
    return {tag:el.tagName,target,visible:box.width>0&&box.height>0&&
      styles.visibility!=="hidden"&&styles.display!=="none" };
  });
  if(!element.visible) {gate(scope+":cta",false,"Primary CTA is not visible");return;}
  if(element.tag!=="A" || element.target!==route.expectedCtaHref) {
    gate(scope+":cta",false,"Primary CTA must be a link to the configured internal route");
    return;
  }
  gate(scope+":cta",true,"Visible link to "+element.target);
  let seen=false;
  let styleResult=null;
  // Focus through keyboard rather than programmatically focusing the CTA.
  await page.evaluate(()=>{if(document.activeElement instanceof HTMLElement)document.activeElement.blur();});
  for(let i=0;i<100;i++){
    await page.keyboard.press("Tab");
    const isFocused=await cta.evaluate(el=>document.activeElement===el);
    if(isFocused){
      seen=true;
      styleResult=await cta.evaluate(el=>{
        const c=getComputedStyle(el);
        return {focusVisible:el.matches(":focus-visible"),
          visibleIndicator:(c.outlineStyle!=="none"&&parseFloat(c.outlineWidth)>0)||
            c.boxShadow!=="none"||c.textDecorationLine.includes("underline")};
      });
      break;
    }
  }
  gate(scope+":keyboard",seen&&styleResult?.focusVisible&&styleResult?.visibleIndicator,
    seen?styleResult:"CTA not reachable via Tab within 100 steps");
};

async function renderRoute(route,index,viewport,config,baseURL){
  const scope="route"+index+":"+viewport.name;
  const page=await browser.newPage({viewport:{width:viewport.width,height:viewport.height},
    reducedMotion:"no-preference",deviceScaleFactor:1});
  const problems={console:[],page:[],http:[],images:[]};
  page.on("console",m=>{if(m.type()==="error") problems.console.push(m.text().slice(0,300));});
  page.on("pageerror",e=>problems.page.push(String(e).slice(0,400)));
  page.on("request",req=>{
    if(req.resourceType()!=="image")return;
    try {
      const u=new URL(req.url());
      if(["data:","blob:"].includes(u.protocol))return;
      if(u.origin!==new URL(baseURL).origin) problems.images.push(req.url());
    }catch{problems.images.push(req.url());}
  });
  page.on("response",r=>{
    if(r.request().resourceType()==="image"&&r.status()>=400)
      problems.http.push(r.status()+" "+r.url());
  });
  try{
    const resp=await page.goto(routeURL(baseURL,route.path),{waitUntil:"domcontentloaded",timeout:30000});
    gate(scope+":route",Boolean(resp&&resp.status()<400),resp?.status()??"no response");
    await page.evaluate(()=>document.fonts.ready);
    // Trigger lazy assets before saving the full-page screenshot.
    const total=await page.evaluate(()=>document.documentElement.scrollHeight);
    const steps=Math.min(60,Math.ceil(total/Math.max(400,viewport.height-150)));
    for(let i=0;i<=steps;i++){
      await page.evaluate(y=>window.scrollTo(0,y),i*Math.max(400,viewport.height-150));
      await page.waitForTimeout(70);
    }
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.waitForTimeout(250);
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
    gate(scope+":overflow",!config.requireNoHorizontalOverflow||overflow<=1,
      "horizontal overflow="+Math.max(0,overflow)+"px");
    const broken=await page.locator("img").evaluateAll(images=>
      images.filter(img=>img.complete&&img.naturalWidth===0)
        .map(img=>img.currentSrc||img.src||"unknown").slice(0,40));
    gate(scope+":media",broken.length===0&&problems.http.length===0,
      {broken,failedRequests:problems.http});
    gate(scope+":external-images",!config.requireNoExternalImages||problems.images.length===0,
      [...new Set(problems.images)].slice(0,25));
    await passPage(page,route,scope);
    const axe=await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21a","wcag21aa"]).analyze();
    const violations=axe.violations
      .filter(v=>v.impact==="serious"||v.impact==="critical")
      .map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.length,help:v.help})).slice(0,30);
    gate(scope+":accessibility",violations.length===0,violations);
    const capture=path.join(folder,scope+".png");
    await page.screenshot({path:capture,fullPage:true,animations:"disabled"});
    gate(scope+":screenshot",fs.existsSync(capture)&&fs.statSync(capture).size>200,
      capture);
    // Reduced-motion must render content and permit CTA operation without animations.
    const reduced=await browser.newPage({viewport:{width:viewport.width,height:viewport.height},
      reducedMotion:"reduce",deviceScaleFactor:1});
    try{
      await reduced.goto(routeURL(baseURL,route.path),{waitUntil:"domcontentloaded",timeout:30000});
      const matches=await reduced.evaluate(()=>matchMedia("(prefers-reduced-motion: reduce)").matches);
      const cta=await reduced.locator(route.primaryCtaSelector).first().isVisible().catch(()=>false);
      gate(scope+":reduced-motion",!config.requireReducedMotion||(matches&&cta),
        {mediaQueryActive:matches,ctaVisible:cta,
          note:"Preference and functional CTA checked; individual animations require manual review"});
      await reduced.screenshot({path:path.join(folder,scope+"-reduced-motion.png"),fullPage:true,animations:"disabled"});
    }finally{await reduced.close();}
    gate(scope+":console",problems.console.length===0&&problems.page.length===0,
      {console:problems.console,pageErrors:problems.page});
  }catch(error){
    gate(scope+":render",false,String(error?.stack??error).slice(0,3000));
  }finally{await page.close();}
}

function runLighthouse(route,index,viewport,config,baseURL){
  const scope="route"+index+":"+viewport.name;
  const out=path.join(folder,scope+"-lighthouse.json");
  const executable=path.join(path.dirname(new URL(import.meta.url).pathname),"node_modules/lighthouse/cli/index.js");
  const flags=[
    executable,routeURL(baseURL,route.path),"--quiet",
    "--only-categories=performance","--output=json","--output-path="+out,
    "--chrome-flags=--headless --no-sandbox --disable-dev-shm-usage --disable-gpu",
    "--throttling-method=simulate"
  ];
  if(viewport.name==="desktop") flags.push("--preset=desktop");
  const exec=spawnSync(process.execPath,flags,{encoding:"utf8",timeout:180000,
    env:{...process.env,CHROME_PATH:chromium.executablePath()},maxBuffer:1024*1024});
  if(exec.error||exec.status!==0||!fs.existsSync(out)){
    gate(scope+":performance",false,{exit:exec.status,error:String(exec.error??""),
      stderr:String(exec.stderr??"").slice(-1800)});
    return;
  }
  try{
    const lhr=JSON.parse(fs.readFileSync(out,"utf8"));
    const report=evaluateLighthouse(lhr,config.budgets);
    evidence.metrics[scope]=report.metrics;
    gate(scope+":performance",report.ok,
      {metrics:report.metrics,errors:report.errors,lighthouseVersion:lhr.lighthouseVersion});
  }catch(error){
    gate(scope+":performance",false,"Cannot parse Lighthouse output: "+error.message);
  }
}
function emitFinal(){
  const cfg=evidence.config;
  const required=[];
  if(cfg)for(let i=0;i<cfg.routes.length;i++)
    for(const v of cfg.viewports)
      for(const key of ["route","overflow","media","external-images","cta","keyboard",
        "accessibility","screenshot","reduced-motion","console","performance"])
        required.push("route"+i+":"+v.name+":"+key);
  const summary=visualGateSummary(results,required);
  evidence.gateSummary=summary;
  evidence.ok=Boolean(cfg)&&summary.ok&&!failure;
  atomicEvidenceOutput(folder,evidence);
  const markdown=[
    "# AppFactory Visual QA",
    "",
    "- Overall: **"+(evidence.ok?"PASS":"FAIL")+"**",
    "- Commit: "+(evidence.commit??"unknown"),
    "- Routes: "+(cfg?.routes.length??"not loaded"),
    "- Viewports: "+(cfg?.viewports.map(v=>v.name+" "+v.width+"px").join(", ")??"not loaded"),
    "",
    "| Gate | Status |",
    "| --- | --- |",
    ...Object.entries(summary.gates).map(([key,status])=>"| "+key+" | "+status+" |"),
    "",
    "Lighthouse raw JSON, full-page screenshots and per-check detail are in the artifact.",
    "LCP/CLS/TBT are Lighthouse **lab measurements** and may vary by CI environment.",
    "Reduced-motion checks verify the preference and CTA usability; motion timelines still need manual review.",
    ""
  ].join("\n");
  fs.writeFileSync(path.join(folder,"summary.md"),markdown);
  if(process.env.GITHUB_STEP_SUMMARY)
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,markdown+"\n");
  if(!evidence.ok)process.exitCode=1;
}
try{
  fs.mkdirSync(folder,{recursive:true});
  const cfg=assertVisualConfig(JSON.parse(fs.readFileSync(requiredEnv("VISUAL_QA_CONFIG"),"utf8")));
  const baseURL=parseLocalBaseURL(requiredEnv("VISUAL_QA_BASE_URL")).toString();
  evidence.config=cfg;
  browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
  try{
    for(let i=0;i<cfg.routes.length;i++)
      for(const viewport of cfg.viewports)
        await renderRoute(cfg.routes[i],i,viewport,cfg,baseURL);
  }finally{await browser.close();browser=undefined;}
  for(let i=0;i<cfg.routes.length;i++)
    for(const viewport of cfg.viewports)
      runLighthouse(cfg.routes[i],i,viewport,cfg,baseURL);
}catch(error){
  evidence.notes.push("Runner fatal failure: "+String(error?.stack??error).slice(0,3000));
  gate("runner",false,String(error?.message??error));
}finally{
  if(browser)await browser.close();
  emitFinal();
}
