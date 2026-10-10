#!/usr/bin/env node
// Informational report only. Never installs dependencies or follows symlinks.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const artifactDir=path.resolve(process.env.VISUAL_QA_ARTIFACT_DIR||"visual-qa-artifacts");
const report={status:"NOT_AVAILABLE",buildDirectories:[],dependencies:[],devDependencyCount:0,notes:[]};

try {
  const pkgFile=path.join(root,"package.json");
  if(fs.existsSync(pkgFile)){
    const pkg=JSON.parse(fs.readFileSync(pkgFile,"utf8"));
    report.dependencies=Object.entries(pkg.dependencies||{})
      .map(([name,version])=>({name,version})).sort((a,b)=>a.name.localeCompare(b.name));
    report.devDependencyCount=Object.keys(pkg.devDependencies||{}).length;
  } else {
    report.notes.push("No package.json found; no runtime dependency inventory available");
  }
  for(const dir of ["dist","build","out"]){
    const target=path.join(root,dir);
    if(!fs.existsSync(target)||!fs.lstatSync(target).isDirectory())continue;
    let bytes=0,files=0;
    const stack=[target];
    while(stack.length){
      const current=stack.pop();
      for(const entry of fs.readdirSync(current,{withFileTypes:true})){
        const pathname=path.join(current,entry.name);
        if(entry.isSymbolicLink())continue;
        if(entry.isDirectory())stack.push(pathname);
        else if(entry.isFile()){bytes+=fs.statSync(pathname).size;files++;}
      }
    }
    report.buildDirectories.push({directory:dir,bytes,files});
  }
  report.status=report.buildDirectories.length?"MEASURED":"NO_BUILD_DIRECTORY";
  if(!report.buildDirectories.length) report.notes.push("No dist/build/out directory found; build size not measured");
}catch(error){
  report.status="ERROR";
  report.notes.push(String(error?.message??error));
  process.exitCode=1;
}finally{
  fs.mkdirSync(artifactDir,{recursive:true});
  fs.writeFileSync(path.join(artifactDir,"bundle-report.json"),JSON.stringify(report,null,2)+"\n");
}
