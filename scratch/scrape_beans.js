const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const indexContent = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const startIdx = indexContent.indexOf('let coffeeDatabase = [');
const endIdx = indexContent.indexOf('];', startIdx) + 1;
const beansText = indexContent.substring(startIdx, endIdx).replace('let coffeeDatabase = ', '');
let beans = [];
try {
    beans = eval(beansText);
} catch (e) {
    console.error("Failed to eval beans array", e);
    process.exit(1);
}

const fallbackDatabase = [];

for (const bean of beans) {
    if (bean.url && bean.url.includes('/index.html') && !bean.url.includes('bean.html')) {
        const dirMatch = bean.url.match(/\.\/([^/]+)\/index\.html/);
        if (dirMatch) {
            const dir = dirMatch[1];
            const htmlPath = path.join(__dirname, '..', dir, 'index.html');
            if (fs.existsSync(htmlPath)) {
                console.log(`Processing ${dir}...`);
                const html = fs.readFileSync(htmlPath, 'utf8');
                const $ = cheerio.load(html);
                
                let storyParagraphs = [];
                const storyDiv = $('.text-justify.text-gray-300');
                if (storyDiv.length) {
                    storyDiv.find('p').each((i, p) => storyParagraphs.push($(p).text().trim()));
                } else {
                    // fallback to any p under section that isn't brew guide
                    $('section p').each((i, p) => {
                        const txt = $(p).text().trim();
                        if (txt && !txt.includes('建議') && txt.length > 20) {
                            storyParagraphs.push(txt);
                        }
                    });
                }
                const storyCopy = storyParagraphs.join('\n\n');
                
                let brewTemp = "";
                let brewMethod = "";
                let brewGuideNote = "";
                
                $('p.text-brass-gold').each((i, p) => {
                    const text = $(p).text().trim();
                    if (text.includes('°C')) {
                        brewTemp = text;
                        brewGuideNote = $(p).next('p.text-gray-400').text().trim();
                    } else if (text.includes('研磨') || text.includes('濾杯') || text.includes('法')) {
                        brewMethod = text;
                        const note = $(p).next('p.text-gray-400').text().trim();
                        if (!brewGuideNote) {
                            brewGuideNote = note;
                        } else if (note) {
                            brewGuideNote += '\n' + note;
                        }
                    }
                });
                
                let dashboardUrl = "";
                $('a').each((i, a) => {
                    const href = $(a).attr('href');
                    if (href && (href.includes('batch') || href.includes('dashboard') || href.includes('curve'))) {
                        dashboardUrl = `./${dir}/${href.replace('./', '')}`;
                    }
                });
                
                const record = {
                    id: bean.id,
                    beanName: bean.name,
                    origin: bean.origin,
                    machine: "SCA 認證烘豆機", // 預設值
                    roastDate: bean.roastDate.replace(/\./g, '-'),
                    roastLevel: bean.roast,
                    lossRatio: "N/A",
                    dtrRatio: "N/A",
                    flavorTop: bean.flavors[0] || "",
                    flavorMid: bean.flavors[1] || "",
                    flavorBase: bean.flavors[2] || "",
                    storyCopy: storyCopy,
                    brewTemp: brewTemp || "88°C - 92°C",
                    brewMethod: brewMethod || "中偏粗研磨 / V60 濾杯",
                    brewGuideNote: brewGuideNote,
                    dashboardUrl: dashboardUrl
                };
                
                fallbackDatabase.push(record);
            }
        }
    }
}

const jsContent = `/**
 * 金成淬精品咖啡 · 靜態經典豆庫
 * 由自動化腳本自舊版 HTML 萃取產生
 */
export const classicBeansDatabase = ${JSON.stringify(fallbackDatabase, null, 4)};
`;

fs.writeFileSync(path.join(__dirname, '../js/classic_beans.js'), jsContent);
console.log("Successfully generated js/classic_beans.js with", fallbackDatabase.length, "records.");
