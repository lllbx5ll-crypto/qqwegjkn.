import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
test('Banknote used by PlansPage and AdminPage is imported',()=>{
 const icons=app.match(/import\{([^;]+)\}from\'lucide-react\';/s)?.[1]||'';
 assert.match(icons,/(?:^|,)Banknote(?:,|$)/);
 assert.match(app,/function PlansPage\(\)/);
 assert.match(app,/function AdminPage\(\)/);
});
test('trailing slash does not cause route not found',()=>{
 assert.match(app,/loc\.pathname\.replace\(\/\\\/\+\$\/, ''\)\|\|'\/'/);
});
test('project upload remains imported and unchanged',()=>{
 assert.match(app,/submitProjectWithFallback/);
});
