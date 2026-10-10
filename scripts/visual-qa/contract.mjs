import fs from "node:fs";
import path from "node:path";

const localPath = (x) => typeof x === "string" &&
  x.startsWith("/") && !x.startsWith("//") && !/[?#\\\u0000-\u001f]/.test(x) &&
  !x.split("/").some(s=>s==="."||s==="..") && x.length<=160;
const plain = x => x!==null && typeof x==="object" && !Array.isArray(x);
const sameKeys = (obj,keys,label,errors) => {
  for(const key of Object.keys(obj)) if(!keys.includes(key)) errors.push(label+" unknown field: "+key);
};
const bounded = (n,min,max) => typeof n==="number" && Number.isFinite(n) && n>=min && n<=max;
export const DEFAULT_BUDGETS = Object.freeze({maxLcpMs:2500,maxCls:0.1,maxTotalBlockingTimeMs:200});

export function validateVisualConfig(cfg) {
  const errors=[];
  if(!plain(cfg)) return ["visual QA config must be an object"];
  sameKeys(cfg,["version","routes","viewports","budgets","requireReducedMotion","requireNoHorizontalOverflow","requireNoExternalImages"],"config",errors);
  if(cfg.version!==1) errors.push("config.version must be 1");
  if(!Array.isArray(cfg.routes)||cfg.routes.length<1||cfg.routes.length>10)
    errors.push("config.routes must contain 1-10 routes");
  else {
    const seen=new Set();
    cfg.routes.forEach((route,i)=>{
      const label="routes["+i+"]";
      if(!plain(route)){errors.push(label+" must be an object");return;}
      sameKeys(route,["path","primaryCtaSelector","expectedCtaHref"],label,errors);
      if(!localPath(route.path)) errors.push(label+".path must be a safe local path");
      if(seen.has(route.path)) errors.push(label+".path duplicate");
      seen.add(route.path);
      if(typeof route.primaryCtaSelector!=="string"||route.primaryCtaSelector.length<1||route.primaryCtaSelector.length>120)
        errors.push(label+".primaryCtaSelector required");
      if(!localPath(route.expectedCtaHref)) errors.push(label+".expectedCtaHref must be a safe local path");
    });
  }
  if(!Array.isArray(cfg.viewports)||cfg.viewports.length!==2)
    errors.push("config.viewports must contain desktop and mobile");
  else {
    const seen=new Set();
    for(const v of cfg.viewports){
      if(!plain(v)){errors.push("viewport must be an object");continue;}
      sameKeys(v,["name","width","height"],"viewport",errors);
      if(!["desktop","mobile"].includes(v.name)||seen.has(v.name)) errors.push("viewport must be unique desktop/mobile");
      seen.add(v.name);
      if(!Number.isInteger(v.width)||!bounded(v.width,320,3840)) errors.push("viewport width out of bounds");
      if(!Number.isInteger(v.height)||!bounded(v.height,480,2160)) errors.push("viewport height out of bounds");
      if(v.name==="desktop"&&v.width<800) errors.push("desktop viewport must be at least 800px");
      if(v.name==="mobile"&&v.width>768) errors.push("mobile viewport must be <=768px");
    }
    if(!seen.has("desktop")||!seen.has("mobile")) errors.push("both desktop and mobile viewports required");
  }
  if(!plain(cfg.budgets)) errors.push("config.budgets required");
  else {
    sameKeys(cfg.budgets,Object.keys(DEFAULT_BUDGETS),"budgets",errors);
    if(!Number.isInteger(cfg.budgets.maxLcpMs)||!bounded(cfg.budgets.maxLcpMs,100,10000))
      errors.push("budgets.maxLcpMs out of bounds");
    if(!bounded(cfg.budgets.maxCls,0,1)) errors.push("budgets.maxCls out of bounds");
    if(!Number.isInteger(cfg.budgets.maxTotalBlockingTimeMs)||!bounded(cfg.budgets.maxTotalBlockingTimeMs,0,5000))
      errors.push("budgets.maxTotalBlockingTimeMs out of bounds");
  }
  for(const key of ["requireReducedMotion","requireNoHorizontalOverflow","requireNoExternalImages"])
    if(cfg[key]!==true) errors.push("config."+key+" must be true");
  return errors;
}
export function assertVisualConfig(cfg) {
  const errors=validateVisualConfig(cfg);
  if(errors.length) throw Error("Invalid visual QA config:\n"+errors.join("\n"));
  return cfg;
}
export function parseLocalBaseURL(raw) {
  const u=new URL(raw);
  if(u.protocol!=="http:"||!["127.0.0.1","localhost"].includes(u.hostname)||
    u.username||u.password||u.hash||u.search||u.pathname!=="/"||
    !Number(u.port)||Number(u.port)<1024||Number(u.port)>65535)
    throw Error("Visual QA server_url must be http://127.0.0.1:<port>/ (or localhost)");
  return u;
}
export function routeURL(base,pathname){
  const u=parseLocalBaseURL(base);
  if(!localPath(pathname)) throw Error("Unsafe route pathname");
  return new URL(pathname,u).toString();
}
export function evaluateLighthouse(lhr,budgets) {
  const errors=[];
  if(!plain(lhr)||!plain(lhr.audits)){
    return {ok:false,errors:["Lighthouse JSON result missing audits"],metrics:{}};
  }
  const fields=[
    ["lcp","largest-contentful-paint","maxLcpMs"],
    ["cls","cumulative-layout-shift","maxCls"],
    ["tbt","total-blocking-time","maxTotalBlockingTimeMs"]
  ];
  const metrics={};
  for(const [short,key,budget] of fields){
    const raw=lhr.audits[key]?.numericValue;
    if(typeof raw!=="number"||!Number.isFinite(raw)||raw<0){
      errors.push(key+" missing/invalid numericValue");
      continue;
    }
    metrics[short]={value:raw,limit:budgets[budget],pass:raw<=budgets[budget]};
    if(raw>budgets[budget]) errors.push(short+"="+raw.toFixed(2)+" exceeds "+budget+"="+budgets[budget]);
  }
  return {ok:errors.length===0,errors,metrics};
}

export function visualGateSummary(results,requiredKeys) {
  const keys = new Set(requiredKeys);
  const outcomes = {};
  const errors=[];
  for(const key of keys){
    const item=results[key];
    const status=item?.status??"NOT_RUN";
    outcomes[key]=status;
    if(status!=="PASS") errors.push(key+": "+status);
  }
  return {ok:errors.length===0,gates:outcomes,errors};
}
export function atomicEvidenceOutput(folder,data){
  fs.mkdirSync(folder,{recursive:true});
  const file=path.join(folder,"result.json");
  fs.writeFileSync(file,JSON.stringify(data,null,2)+"\n");
  return file;
}
