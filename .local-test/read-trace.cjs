const fs = require('fs'), path = require('path'), zip = require('yauzl');
const dir = fs.readdirSync('test-results').find(x => x.startsWith('workspace-imports'));
zip.open(path.join('test-results', dir, 'trace.zip'), { lazyEntries: true }, (error, archive) => {
  if (error) throw error;
  archive.readEntry(); archive.on('entry', entry => {
    if (!entry.fileName.endsWith('.trace')) { archive.readEntry(); return; }
    archive.openReadStream(entry, (error, stream) => {
      if (error) throw error;
      let source = ''; stream.on('data', data => source += data);
      stream.on('end', () => {
        console.log(entry.fileName);
        const events = source.split('\n').filter(Boolean).map(line => JSON.parse(line));
        for (const event of events.filter(e => ['before', 'after'].includes(e.type)).slice(-25)) console.log(JSON.stringify(event));
        archive.readEntry();
      });
    });
  });
});
