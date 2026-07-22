/**
 * Build script — bundles service/service.js into dist/service.js
 * using @vercel/ncc for TizenBrew's Node.js VM sandbox compatibility.
 *
 * Usage: node build-service.js
 * Output: ../dist/service.js
 */

var ncc = require('@vercel/ncc');
var path = require('path');
var fs = require('fs');

var input = path.join(__dirname, 'service.js');
var outputDir = path.join(__dirname, '..', 'dist');
var outputFile = path.join(outputDir, 'service.js');

ncc(input, {
    cache: false,
    minify: true,
    sourceMap: false,
    target: 'es5'
}).then(function (result) {
    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    var code = result.code;

    // Fix for TizenBrew VM sandbox: the sandbox excludes `module` from the
    // global context, so `module.exports = ...` throws ReferenceError and
    // crashes the service before Express starts. Strip it — the service
    // just needs to run and listen on port 8098.
    code = code.replace(';module.exports=__webpack_exports__', '');

    // Write bundled output
    fs.writeFileSync(outputFile, code, 'utf8');

    // Log summary
    var kb = (Buffer.byteLength(code, 'utf8') / 1024).toFixed(1);
    console.log('Built dist/service.js (' + kb + ' KB)');
}).catch(function (err) {
    console.error('Build failed:', err);
    process.exit(1);
});
