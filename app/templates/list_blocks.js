const fs = require('fs');
const content = fs.readFileSync('crm_home.html', 'utf-8');
const scriptRegex = /<script.*?>([\s\S]*?)<\/script>/gi;
let match;
let i = 1;
while ((match = scriptRegex.exec(content)) !== null) {
    console.log(`Block ${i}: ${match[1].trim().substring(0, 100).replace(/\n/g, ' ')}`);
    i++;
}
