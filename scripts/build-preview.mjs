import { mkdir, rm, cp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
await rm(path.join(root,'dist/assets'),{recursive:true,force:true});
await mkdir(path.join(root,'dist/assets'),{recursive:true});
await cp(path.join(root,'public/assets'),path.join(root,'dist/assets'),{recursive:true});
await writeFile(path.join(root,'dist/index.html'),await readFile(path.join(root,'resources/views/app.blade.php'),'utf8'));
console.log('Built static UI preview in dist/. Laravel serves the same Blade view and assets.');
