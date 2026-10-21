import { mkdir, rm, cp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const root=path.resolve(import.meta.dirname,'..');
await rm(path.join(root,'dist/assets'),{recursive:true,force:true});
await mkdir(path.join(root,'dist/assets'),{recursive:true});
await cp(path.join(root,'public/assets'),path.join(root,'dist/assets'),{recursive:true});
let html=await readFile(path.join(root,'resources/views/app.blade.php'),'utf8');
html=html.replace("{{ $serverMode ?? 'static' }}",'static');
html=html.replace("@include('partials.admin')",await readFile(path.join(root,'resources/views/partials/admin.blade.php'),'utf8'));
html=html.replace("@include('partials.kyc')",await readFile(path.join(root,'resources/views/partials/kyc.blade.php'),'utf8'));
html=html.replace("@include('partials.support')",await readFile(path.join(root,'resources/views/partials/support.blade.php'),'utf8'));
html=html.replace("@include('partials.promo')",await readFile(path.join(root,'resources/views/partials/promo.blade.php'),'utf8'));
html=html.replace("@include('partials.manual-methods')",await readFile(path.join(root,'resources/views/partials/manual-methods.blade.php'),'utf8'));
const {stdout}=await promisify(execFile)('php',[path.join(root,'scripts/render-marketing.php')],{cwd:root,maxBuffer:4*1024*1024});
const marketingPages=JSON.parse(stdout);
await mkdir(path.join(root,'dist/app'),{recursive:true});
await mkdir(path.join(root,'dist/admin'),{recursive:true});
for(const [url,markup] of Object.entries(marketingPages)){
  const directory=path.join(root,'dist',url.slice(1));
  await mkdir(directory,{recursive:true});
  await writeFile(path.join(directory,'index.html'),markup);
}
await writeFile(path.join(root,'dist/app/index.html'),html);
await writeFile(path.join(root,'dist/admin/index.html'),html);
console.log(`Built landing page, ${Object.keys(marketingPages).length-1} information pages, and static platform preview in dist/.`);
