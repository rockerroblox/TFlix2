/**
 * Build script — bundles service/service.js into dist/service.js
 * using Rollup + Babel for TizenBrew's Node.js VM sandbox compatibility.
 *
 * Unlike @vercel/ncc (which does NOT transpile syntax), Rollup + Babel
 * properly converts modern JS down to ES5 via @babel/preset-env,
 * targeting Node 4.4.3 (Tizen TV runtime).
 *
 * Usage: node build-service.js
 * Output: ../dist/service.js
 */

const rollup = require('rollup');
const babel = require('@rollup/plugin-babel').default || require('@rollup/plugin-babel');
const commonjs = require('@rollup/plugin-commonjs');
const resolve = require('@rollup/plugin-node-resolve');
const json = require('@rollup/plugin-json');
const path = require('path');
const fs = require('fs');

const input = path.join(__dirname, 'service.js');
const outputFile = path.join(__dirname, '..', 'dist', 'service.js');
const outputDir = path.dirname(outputFile);

async function build() {
    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const bundle = await rollup.rollup({
        input,
        plugins: [
            // Resolve bare module specifiers to node_modules
            resolve({
                preferBuiltins: true
            }),
            // Convert JSON imports to ES modules
            json(),
            // Convert CommonJS modules to ES modules
            commonjs(),
            // Transpile modern JS to ES5 for Node 4.4.3 (Tizen TV)
            babel({
                babelHelpers: 'bundled',
                presets: [
                    ['@babel/preset-env', {
                        targets: { node: '4.4.3' },
                        modules: false
                    }]
                ],
                // Transpile everything including node_modules —
                // Express deps may use const/let/arrow functions
                exclude: []
            })
        ]
    });

    await bundle.write({
        file: outputFile,
        format: 'cjs',
        // Don't add module.exports = ... — the service runs itself
        // (starts Express server), it doesn't export anything.
        // This avoids potential ReferenceError in TizenBrew's VM sandbox.
        exports: 'none'
    });

    await bundle.close();

    const stats = fs.statSync(outputFile);
    const kb = (stats.size / 1024).toFixed(1);
    console.log('Built dist/service.js (' + kb + ' KB)');
}

build().catch(err => {
    console.error('Build failed:', err);
    process.exit(1);
});
