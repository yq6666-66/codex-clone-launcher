import { readFileSync, writeFileSync } from 'fs';

// Paths
const PACKAGE_JSON_PATH = 'package.json';
const TAURI_CONF_PATH = 'src-tauri/tauri.conf.json';
const CARGO_TOML_PATH = 'src-tauri/Cargo.toml';

try {
  // 1. Read version from package.json
  const packageJson = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf-8'));
  const version = packageJson.version;
  console.log(`Target version from package.json: ${version}`);

  // 2. Update tauri.conf.json
  const tauriConf = JSON.parse(readFileSync(TAURI_CONF_PATH, 'utf-8'));
  if (tauriConf.version !== version) {
    tauriConf.version = version;
    writeFileSync(TAURI_CONF_PATH, JSON.stringify(tauriConf, null, 2) + '\n');
    console.log(`Updated ${TAURI_CONF_PATH} to ${version}`);
  } else {
    console.log(`${TAURI_CONF_PATH} is already up to date.`);
  }

  // 3. Update Cargo.toml
  let cargoToml = readFileSync(CARGO_TOML_PATH, 'utf-8');
  // Match version = "x.y.z" exactly at the start of a line (standard for [package] section)
  const cargoVersionRegex = /^version\s*=\s*"[^"]+"/m;
  
  if (cargoToml.match(cargoVersionRegex)) {
    const currentCargoEntry = cargoToml.match(cargoVersionRegex)[0];
    const newCargoEntry = `version = "${version}"`;
    
    if (currentCargoEntry !== newCargoEntry) {
      cargoToml = cargoToml.replace(cargoVersionRegex, newCargoEntry);
      writeFileSync(CARGO_TOML_PATH, cargoToml);
      console.log(`Updated ${CARGO_TOML_PATH} to ${version}`);
    } else {
      console.log(`${CARGO_TOML_PATH} is already up to date.`);
    }
  } else {
    console.warn(`Could not find version key in ${CARGO_TOML_PATH}`);
  }

  console.log('Version sync complete!');
} catch (error) {
  console.error('Error syncing versions:', error);
  process.exit(1);
}
