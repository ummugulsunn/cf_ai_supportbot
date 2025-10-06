#!/usr/bin/env node

/**
 * Simple build script for the frontend
 * Copies files to a dist directory for deployment
 */

const fs = require('fs');
const path = require('path');

const sourceDir = 'pages';
const distDir = 'pages/dist';

// Create dist directory
if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
}

// Files to copy
const filesToCopy = [
    'index.html',
    'demo.html',
    'styles.css',
    'app.jsx',
    'websocket-manager.js',
    'voice-manager.js'
];

// Copy files
filesToCopy.forEach(file => {
    const sourcePath = path.join(sourceDir, file);
    const destPath = path.join(distDir, file);
    
    if (fs.existsSync(sourcePath)) {
        fs.copyFileSync(sourcePath, destPath);
        console.log(`Copied ${file} to dist/`);
    } else {
        console.warn(`Warning: ${file} not found in ${sourceDir}/`);
    }
});

console.log('Frontend build complete!');