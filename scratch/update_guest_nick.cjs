const fs = require('fs');
let code = fs.readFileSync('apps/api-server/src/index.ts', 'utf8');
code = code.replace("const nickname = '尊贵牌友_' + rand;", "const nickname = '牌友_' + rand;");
fs.writeFileSync('apps/api-server/src/index.ts', code, 'utf8');
console.log('Updated guest nickname in api-server successfully');
