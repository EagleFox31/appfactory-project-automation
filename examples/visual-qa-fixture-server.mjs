import http from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const html=readFileSync(fileURLToPath(new URL("../test/fixtures/visual-qa-site/index.html",import.meta.url)));
const host="127.0.0.1";
const port=4173;
http.createServer((req,res)=>{
  const pathname = new URL(req.url,"http://"+host+":"+port).pathname;
  if(pathname!=="/" && pathname!=="/app") {
    res.writeHead(404,{"content-type":"text/plain"});
    res.end("not found");
    return;
  }
  res.writeHead(200,{"content-type":"text/html; charset=utf-8","cache-control":"no-store"});
  res.end(html);
}).listen(port,host,()=>console.log("Visual QA fixture server listening at http://"+host+":"+port));
