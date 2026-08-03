const fs = require('fs');
const https = require('https');

https.get('https://firestore.googleapis.com/v1/projects/my-teaching-tools-01/databases/(default)/documents/coffee_roasts', (resp) => {
  let data = '';
  resp.on('data', (chunk) => { data += chunk; });
  resp.on('end', () => {
    const json = JSON.parse(data);
    const docs = json.documents || [];
    
    const records = docs.map(doc => {
      const fields = doc.fields;
      let obj = { id: doc.name.split('/').pop() };
      for (let k in fields) {
        if (fields[k].stringValue !== undefined) obj[k] = fields[k].stringValue;
        else if (fields[k].integerValue !== undefined) obj[k] = parseInt(fields[k].integerValue);
        else if (fields[k].doubleValue !== undefined) obj[k] = parseFloat(fields[k].doubleValue);
      }
      return obj;
    });

    const haydn = records.filter(r => r.beanName && r.beanName.includes('海頓'));
    const whiteRock = records.filter(r => r.beanName && r.beanName.includes('白岩'));

    fs.writeFileSync('db_extract.json', JSON.stringify({
      haydn: haydn,
      whiteRock: whiteRock
    }, null, 2));

    console.log(`Found ${haydn.length} Haydn records and ${whiteRock.length} White Rock records.`);
  });
}).on("error", (err) => {
  console.log("Error: " + err.message);
});
