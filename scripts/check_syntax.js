const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = path.resolve(__dirname, '..', 'js');
let hasError = false;

for (const file of fs.readdirSync(dir)) {
  if (!file.endsWith('.js')) continue;
  const filePath = path.join(dir, file);
  const code = fs.readFileSync(filePath, 'utf8');
  try {
    // ES Module 構文解析
    new vm.SourceTextModule(code, { initializeImportMeta() {} });
    console.log(`[PASS] ${file}`);
  } catch (err) {
    console.error(`[FAIL] ${file}: ${err.message}`);
    hasError = true;
  }
}

if (hasError) {
  process.exit(1);
} else {
  console.log('All JS files passed syntax check.');
}

