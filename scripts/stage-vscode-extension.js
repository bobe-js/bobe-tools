#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function resolveRepoRoot() {
  if (process.env.GITHUB_WORKSPACE && fs.existsSync(process.env.GITHUB_WORKSPACE)) {
    return process.env.GITHUB_WORKSPACE;
  }
  return path.resolve(__dirname, '..');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

function copyDir(from, to) {
  fs.cpSync(from, to, {
    recursive: true,
    filter: source => {
      const parts = source.split(path.sep);
      return !parts.includes('node_modules');
    }
  });
}

function main() {
  const repoRoot = resolveRepoRoot();
  const stage = path.join(repoRoot, '.release/vscode');
  const vscodeDir = path.join(repoRoot, 'packages/vscode');
  const pluginDir = path.join(repoRoot, 'packages/ts-service-plugin');
  const pluginStageDir = path.join(stage, 'node_modules/bobe-ts-service-plugin');

  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  copyDir(vscodeDir, stage);

  const rootPkgPath = path.join(stage, 'package.json');
  const rootPkg = readJson(rootPkgPath);
  const pluginPkg = readJson(path.join(pluginDir, 'package.json'));

  rootPkg.dependencies = {
    ...(rootPkg.dependencies || {}),
    'bobe-ts-service-plugin': pluginPkg.version
  };
  writeJson(rootPkgPath, rootPkg);

  fs.mkdirSync(pluginStageDir, { recursive: true });
  copyDir(path.join(pluginDir, 'dist'), path.join(pluginStageDir, 'dist'));
  writeJson(path.join(pluginStageDir, 'package.json'), {
    name: pluginPkg.name,
    version: pluginPkg.version,
    main: pluginPkg.main,
    types: pluginPkg.types
  });

  console.log(
    JSON.stringify(
      {
        repoRoot,
        stage,
        vscodeDir,
        pluginDir,
        pluginStageDir
      },
      null,
      2
    )
  );
}

main();
