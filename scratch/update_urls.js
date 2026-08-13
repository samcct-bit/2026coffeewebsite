const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, '../index.html');
let html = fs.readFileSync(indexPath, 'utf8');

// Use regex to find all urls like `./folder/index.html` inside the beans array
// We need to map them to `./bean.html?id=[bean.id]`
// A simpler way: just replace them using regex if we can extract the id from the same object.

const startIdx = html.indexOf('let coffeeDatabase = [');
const endIdx = html.indexOf('];', startIdx) + 1;
const beansText = html.substring(startIdx, endIdx).replace('let coffeeDatabase = ', '');
let beans = eval(beansText);

for (const bean of beans) {
    if (bean.url && bean.url.includes('/index.html') && !bean.url.includes('bean.html')) {
        const oldUrl = bean.url;
        const newUrl = `./bean.html?id=${bean.id}`;
        html = html.replace(`url: '${oldUrl}'`, `url: '${newUrl}'`);
    }
}

fs.writeFileSync(indexPath, html);
console.log("Updated index.html successfully!");
